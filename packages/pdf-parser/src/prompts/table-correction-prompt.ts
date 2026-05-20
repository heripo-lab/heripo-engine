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
- Keep the target table identity and bbox fixed. Do not move the target bbox, merge it with another same-page table, or borrow rows/cells from another table.
- Inspect structure, cell text, caption evidence, spans, headers, units, footnotes, empty cells, and adjacent-page continuation hints.
- Prefer updateTableCell for localized OCR errors — it edits one cell and cannot drop structure. Use replaceTable only when the visible grid structure is clearly wrong or span/header metadata cannot be fixed cell-by-cell.
- For replaceTable, return a rectangular grid and re-declare every rowSpan, colSpan, columnHeader, and rowHeader the target table has — a corrected grid that drops span/header metadata, units, or footnote markers is rejected.
- Preserve units and footnote markers that are visible in the target table. Do not normalize blank cells into invented values.
- Suggest linkContinuedTable only when an adjacent-page table ref is provided and the image/context supports matching columns, headers, or caption continuation.
- If no grounded table correction is needed, return {"pageNo": <current pageNo>, "commands": [], "pageNotes": []}.
- Keep confidence conservative for replaceTable and linkContinuedTable.
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
        `Write rationale and pageNotes in ${outputLanguage}. Keep evidence as a short verbatim source snippet when possible. Keep JSON keys, op names, refs, and payload text unchanged.`,
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
    'TABLE CORRECTION CONTEXT JSON:',
    JSON.stringify(toPromptContext(context)),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function toPromptContext(context: TableCorrectionContext): unknown {
  return {
    pageNo: context.pageNo,
    pageSize: context.pageSize,
    pageImagePath: context.pageImagePath,
    targetTable: context.targetTable,
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
