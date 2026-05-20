import type { PageReviewTableCell } from '../processors/review-assistance/page-review-context-builder';
import type { TableCorrectionContext } from '../processors/review-assistance/table-correction-context-builder';

import {
  REVIEW_ASSISTANCE_EVIDENCE_MAX_LENGTH,
  REVIEW_ASSISTANCE_PAGE_NOTE_MAX_LENGTH,
  REVIEW_ASSISTANCE_RATIONALE_MAX_LENGTH,
} from '../types/review-assistance-schema';

export const TABLE_CORRECTION_SYSTEM_PROMPT = `You are a table correction engine for Docling JSON produced from archaeological and cultural heritage report PDFs.

Analyze exactly one target table using the page image and the provided table-specific context. Return only table correction commands that are grounded in the visible page image, table bbox, nearby caption text, or deterministic table hints.

You MUST respond with valid JSON only. No markdown, no code fences, no explanation.

Output shape:
{
  "pageNo": number,
  "commands": [Command, ...],
  "pageNotes": string[]
}

Each command in commands[] is one of the op-specific shapes below. There is NO top-level "targetRef" wrapper and NO "payload" wrapper — write every op-specific field directly on the command object. Every command also includes the shared metadata fields "confidence" (number 0..1), "rationale" (string), and "evidence" (string or null).

- { "op": "updateTableCell", "tableRef": <targetTable.ref>, "row": <int>, "col": <int>, "text": <corrected cell text>, confidence, rationale, evidence }
- { "op": "replaceTable", "tableRef": <targetTable.ref>, "grid": [[{ "text": <cell text>, "rowSpan": <int or null>, "colSpan": <int or null>, "columnHeader": <bool or null>, "rowHeader": <bool or null>, "bbox": <or null> }, ...], ...], "caption": <or null>, confidence, rationale, evidence }
- { "op": "linkContinuedTable", "sourceTableRef": <targetTable.ref>, "continuedTableRef": <adjacent-page table ref>, "relation": "continues_on_next_page" | "continued_from_previous_page", confidence, rationale, evidence }

Rules:
- The only editable table is targetTable.ref. Do not modify otherTablesOnPage; use them only as boundaries so content does not leak between tables.
- Always set tableRef (sourceTableRef for linkContinuedTable) to targetTable.ref exactly as given. Never wrap fields in a "payload" object and never invent a different ref.
- Keep the target table identity and bbox fixed. Do not move the target bbox, merge it with another same-page table, or borrow rows or cells from another table.
- Compare each cell against the page image and correct only the cells whose text is clearly wrong. Do not normalize blank cells into invented values, and preserve every unit and footnote marker that is visible in the table.
- Suggest linkContinuedTable only when an adjacent-page table ref is provided and the image or context supports matching columns, headers, or caption continuation.
- If no grounded table correction is needed, return {"pageNo": <current pageNo>, "commands": [], "pageNotes": []}.
- Set confidence to how clearly the page image supports the change. Table corrections always require human review regardless of confidence, so do not suppress a grounded correction with an artificially low score.
- Keep rationale <= ${REVIEW_ASSISTANCE_RATIONALE_MAX_LENGTH} characters, evidence <= ${REVIEW_ASSISTANCE_EVIDENCE_MAX_LENGTH} characters, and each page note <= ${REVIEW_ASSISTANCE_PAGE_NOTE_MAX_LENGTH} characters.`;

export function buildTableCorrectionPrompt(
  context: TableCorrectionContext,
  options: {
    outputLanguage?: string;
    validationFeedback?: string[];
    attempt?: number;
  } = {},
): string {
  const outputLanguage = options.outputLanguage?.trim();
  const languagePrompt = outputLanguage
    ? [
        `OUTPUT LANGUAGE: ${outputLanguage}`,
        `Write rationale and pageNotes in ${outputLanguage}. Keep evidence as a short verbatim source snippet when possible. Keep JSON keys, op names, refs, and cell text unchanged.`,
      ].join('\n')
    : undefined;
  const feedbackPrompt =
    options.validationFeedback && options.validationFeedback.length > 0
      ? [
          `VALIDATION FEEDBACK FOR ATTEMPT ${options.attempt ?? 2}:`,
          'Your previous JSON response failed deterministic table validation. Fix only the listed failures.',
          'If the correction cannot be grounded to the target table, return no commands.',
          ...options.validationFeedback.map((reason) => `- ${reason}`),
        ].join('\n')
      : undefined;

  return [
    TABLE_CORRECTION_SYSTEM_PROMPT,
    languagePrompt,
    feedbackPrompt,
    buildCorrectionInstructions(context.targetTable),
    'TABLE CORRECTION CONTEXT JSON:',
    JSON.stringify(toPromptContext(context)),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The correction strategy depends on table size. Small tables (fullGrid
 * present) are corrected cell by cell: the model is shown a coordinate-labeled
 * list and asked for sparse updateTableCell edits, which the runner folds onto
 * the authoritative grid (see TableCorrectionRunner.foldSparseCellEdits). This
 * is far more reliable for weak review models than regenerating a whole grid,
 * which drops spans/headers or returns the wrong dimensions. Oversized tables
 * (no fullGrid) keep the whole-grid replaceTable path against the truncated
 * gridPreview, since there are no per-cell coordinates to anchor sparse edits.
 */
function buildCorrectionInstructions(
  targetTable: TableCorrectionContext['targetTable'],
): string {
  if (!targetTable.fullGrid) {
    return [
      'HOW TO CORRECT — whole-grid mode (this table is too large to list cell by cell):',
      '- targetTable.gridPreview is a truncated text-only preview of the current grid.',
      '- Emit a single replaceTable with the full corrected grid. Keep the same number of rows and columns and re-declare every rowSpan, colSpan, columnHeader, and rowHeader. A grid that drops span or header metadata, units, or footnote markers is rejected.',
      '- Change ONLY the cells whose text is wrong in the page image; copy every other cell exactly as given.',
    ].join('\n');
  }
  return [
    'HOW TO CORRECT — cell-by-cell mode (preferred for this table):',
    '- TARGET TABLE CELLS below lists every editable cell as `[r=<row>, c=<col>] "<current text>"`, one per line, with columnHeader/rowHeader/rowSpan/colSpan tags in parentheses. The r and c numbers are the exact coordinates to edit.',
    '- For EACH cell whose text is wrong in the page image, emit exactly one updateTableCell command. Copy that cell\'s r into "row" and its c into "col" verbatim, and put the corrected text in "text".',
    '- Do NOT emit a replaceTable and do NOT restate the grid. Do NOT emit a command for any cell that already matches the image. Edit only listed coordinates — positions covered by a span are omitted on purpose.',
    "- Emit a replaceTable ONLY if the table's row or column COUNT itself is wrong (cells structurally merged, split, or missing) — never for plain text fixes.",
    '',
    'TARGET TABLE CELLS:',
    renderCellList(targetTable.fullGrid),
  ].join('\n');
}

/**
 * Render fullGrid as a coordinate-labeled list — `[r=R, c=C] "text"` with
 * header/span tags — that mirrors the { row, col, text } shape the model
 * emits. The explicit per-line coordinates make miscounting far less likely
 * than a raw 2D JSON dump. Positions covered by another cell's span (shadows)
 * are omitted so the model never targets a placeholder slot.
 */
function renderCellList(grid: PageReviewTableCell[][]): string {
  const shadows = buildShadowSet(grid);
  const lines: string[] = [];
  grid.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      if (shadows.has(`${rowIndex}:${colIndex}`)) return;
      const tags: string[] = [];
      if (cell.columnHeader) tags.push('columnHeader');
      if (cell.rowHeader) tags.push('rowHeader');
      if (cell.rowSpan > 1) tags.push(`rowSpan=${cell.rowSpan}`);
      if (cell.colSpan > 1) tags.push(`colSpan=${cell.colSpan}`);
      const tagSuffix = tags.length > 0 ? ` (${tags.join(', ')})` : '';
      lines.push(
        `[r=${rowIndex}, c=${colIndex}]${tagSuffix} ${JSON.stringify(cell.text)}`,
      );
    });
  });
  return lines.join('\n');
}

/**
 * Positions covered by an earlier cell's row/col span (excluding each span's
 * own master/top-left position). Mirrors
 * TableCorrectionRunner.buildShadowPositions; kept local so the labeled cell
 * list omits the placeholder slots a spanned cell already covers.
 */
function buildShadowSet(grid: PageReviewTableCell[][]): Set<string> {
  const shadows = new Set<string>();
  grid.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      const rowSpan = cell.rowSpan > 1 ? cell.rowSpan : 1;
      const colSpan = cell.colSpan > 1 ? cell.colSpan : 1;
      if (rowSpan === 1 && colSpan === 1) return;
      for (let dr = 0; dr < rowSpan; dr += 1) {
        for (let dc = 0; dc < colSpan; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          shadows.add(`${rowIndex + dr}:${colIndex + dc}`);
        }
      }
    });
  });
  return shadows;
}

function toPromptContext(context: TableCorrectionContext): unknown {
  return {
    pageNo: context.pageNo,
    pageSize: context.pageSize,
    pageImagePath: context.pageImagePath,
    targetTable: toPromptTargetTable(context.targetTable),
    tableCountOnPage: context.tableCountOnPage,
    otherTablesOnPage: context.otherTablesOnPage.map((table) => ({
      ref: table.ref,
      caption: table.caption,
      bbox: table.bbox,
      rowCount: table.rowCount,
      colCount: table.colCount,
    })),
    nearbyTextBlocks: context.nearbyTextBlocks.map((block) => ({
      ref: block.ref,
      label: block.label,
      text: block.text,
      bbox: block.bbox,
      suspectReasons: block.suspectReasons,
    })),
    orphanCaptions: context.orphanCaptions,
    validationHints: context.validationHints,
  };
}

/**
 * Project the target table for the prompt JSON. When fullGrid is present it is
 * rendered separately as the coordinate-labeled TARGET TABLE CELLS list, so
 * both fullGrid and the now-redundant gridPreview are dropped here — the model
 * copies coordinates from the authoritative list, not from a second grid view.
 * Oversized tables keep gridPreview as their only grid view. The validator
 * keeps both fields on the identity for its own checks; only this prompt
 * projection omits them.
 */
function toPromptTargetTable(
  targetTable: TableCorrectionContext['targetTable'],
): unknown {
  if (!targetTable.fullGrid) return targetTable;
  const {
    fullGrid: _fullGrid,
    gridPreview: _gridPreview,
    ...rest
  } = targetTable;
  return rest;
}
