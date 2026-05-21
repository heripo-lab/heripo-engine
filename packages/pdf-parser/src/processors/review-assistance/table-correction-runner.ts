import type { ReviewAssistanceDecision } from '@heripo/model';

import type {
  ReviewAssistancePageOutput,
  ReviewAssistanceRawCommand,
  TableCorrectionGridOutput,
} from '../../types/review-assistance-schema';
import type {
  PageReviewContext,
  PageReviewTableCell,
} from './page-review-context-builder';
import type { ReviewAssistanceValidatorOptions } from './review-assistance-validator';
import type { ReviewAssistanceWorkItem } from './review-assistance-work-scheduler';
import type { TableCorrectionContext } from './table-correction-context-builder';

import { buildTableCorrectionPrompt } from '../../prompts/table-correction-prompt';
import { TableCorrectionContextBuilder } from './table-correction-context-builder';
import { TableCorrectionValidator } from './table-correction-validator';

// Footnote markers and unit-bearing tokens, mirroring page-review-context-
// builder's detectFootnoteMarkers / detectUnitHints. Used to re-attach markers
// the model dropped during text correction (see carryOverTableStructure).
const FOOTNOTE_MARKER_RE = /(?:※|\*|[¹²³⁴⁵⁶⁷⁸⁹]|\[[0-9]+\]|\([0-9]+\))/gu;
const UNIT_BEARING_RE = /\d+(?:\.\d+)?\s?(mm|cm|m²|m|㎝|㎜|㎡|kg|g|점|개)/giu;

// Table edits are always routed to human review (proposal); they never
// auto-apply (replaceTable is structural → manual review). The tight
// { grid, caption } schema carries no confidence, so this is purely the
// headline number the reviewer sees. Fixed high (0.95) so that even after the
// validator's replaceTable risk penalty (0.08 → 0.87) it stays well above the
// proposal threshold — a grounded correction is never silently skipped.
const TABLE_CORRECTION_PROPOSAL_CONFIDENCE = 0.95;

export class TableCorrectionRunner {
  private readonly contextBuilder = new TableCorrectionContextBuilder();
  private readonly validator = new TableCorrectionValidator();

  buildContext(
    context: PageReviewContext,
    workItem: ReviewAssistanceWorkItem,
  ): TableCorrectionContext {
    return this.contextBuilder.buildForWorkItem(context, workItem);
  }

  buildPrompt(
    context: TableCorrectionContext,
    options: {
      outputLanguage?: string;
      validationFeedback?: string[];
      attempt?: number;
    } = {},
  ): string {
    return buildTableCorrectionPrompt(context, options);
  }

  /**
   * Validate the model's `{ grid, caption }` table reply (the dedicated
   * structured-output shape that mirrors the backoffice AI table-correction
   * feature). The reply is wrapped into a single `replaceTable` command,
   * structure is reconciled against the source grid, and the result runs
   * through the shared validator → one table-correction proposal.
   */
  validateGridOutput(
    context: TableCorrectionContext,
    output: TableCorrectionGridOutput,
    options: ReviewAssistanceValidatorOptions,
  ): ReviewAssistanceDecision[] {
    return this.validator.validatePageOutput(
      context,
      this.carryOverTableStructure(context, this.toPageOutput(context, output)),
      options,
    );
  }

  /**
   * Wrap a `{ grid, caption }` reply into a single-`replaceTable` page output
   * for the shared validation pipeline. `tableRef` is the unambiguous work-item
   * target (so the base validator's ref check passes); `pageNo` is the target
   * page; cells are lifted to the engine cell shape. confidence/rationale/
   * evidence are synthesized — the tight schema (like the backoffice) carries
   * none, and table edits are always manual-review proposals, so they are
   * display-only.
   */
  private toPageOutput(
    context: TableCorrectionContext,
    output: TableCorrectionGridOutput,
  ): ReviewAssistancePageOutput {
    const grid = output.grid.map((row) =>
      row.map((cell) => ({
        text: cell.text,
        bbox: null,
        rowSpan: cell.rowSpan,
        colSpan: cell.colSpan,
        columnHeader: cell.columnHeader,
        rowHeader: cell.rowHeader,
      })),
    );
    const command: ReviewAssistanceRawCommand = {
      op: 'replaceTable',
      tableRef: context.targetTable.ref,
      grid,
      caption: output.caption,
      confidence: TABLE_CORRECTION_PROPOSAL_CONFIDENCE,
      rationale: '',
      evidence: null,
    };
    return { pageNo: context.pageNo, commands: [command], pageNotes: [] };
  }

  /**
   * Gemini regenerates tables flat — dropping spans, headers, and unit/footnote
   * markers — even when handed the full grid; it does not reliably echo
   * structure. In OCR correction only the *cell text* is the model's to change;
   * the table shape and the units/markers in each cell are authoritative from
   * the source. So when the model returns a replaceTable grid with the same
   * dimensions as the original, deterministically rebuild it: take the original
   * spans/headers verbatim, force shadow positions (covered by a master cell's
   * span) empty, and re-attach any unit/footnote markers the model dropped per
   * cell, keeping only the model's corrected text. This is the deterministic
   * complement to the prompt's "keep the structure, fix only wrong cell text".
   *
   * Same-dimension grids are assumed positionally aligned with the original; a
   * row-shifted but same-dimension grid would misalign here — the reviewer
   * catches that in the proposal. Grids whose dimensions differ are left
   * untouched so the validator surfaces them as a genuine structural change for
   * manual review. Oversized tables (no fullGrid) are also left untouched.
   */
  private carryOverTableStructure(
    context: TableCorrectionContext,
    output: ReviewAssistancePageOutput,
  ): ReviewAssistancePageOutput {
    const original = context.targetTable.fullGrid;
    if (!original) return output;
    const shadows = this.buildShadowPositions(original);
    return {
      ...output,
      commands: output.commands.map((command) => {
        if (command.op !== 'replaceTable' || !Array.isArray(command.grid)) {
          return command;
        }
        const model = command.grid;
        const sameDimensions =
          model.length === original.length &&
          original.every((row, r) => model[r]?.length === row.length);
        if (!sameDimensions) return command;
        const grid = original.map((row, rowIndex) =>
          row.map((cell, colIndex) => {
            const modelText = model[rowIndex]?.[colIndex]?.text ?? '';
            const text = shadows.has(`${rowIndex}:${colIndex}`)
              ? ''
              : this.restoreCellMarkers(modelText, cell.text);
            return {
              text,
              bbox: null,
              rowSpan: cell.rowSpan,
              colSpan: cell.colSpan,
              columnHeader: cell.columnHeader,
              rowHeader: cell.rowHeader,
            };
          }),
        );
        return { ...command, grid };
      }),
    };
  }

  /**
   * Positions covered by an earlier cell's row/col span (excluding each span's
   * own master/top-left position). Their text must be empty so a spanned cell
   * is not duplicated across the slots it covers.
   */
  private buildShadowPositions(grid: PageReviewTableCell[][]): Set<string> {
    const shadows = new Set<string>();
    grid.forEach((row, rowIndex) =>
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
      }),
    );
    return shadows;
  }

  /**
   * Re-attach footnote markers and unit tokens that the original cell text
   * carried but the model's corrected text dropped (e.g. "10cm" → "12" loses
   * the unit; "토기※" → "토기" loses the marker). Number/character corrections
   * are kept; only the missing markers are appended. Per-cell, so a marker that
   * the model legitimately moved to another cell is not double-counted.
   */
  private restoreCellMarkers(modelText: string, originalText: string): string {
    let result = modelText;
    for (const marker of originalText.match(FOOTNOTE_MARKER_RE) ?? []) {
      if (!result.includes(marker)) result += marker;
    }
    for (const match of originalText.matchAll(UNIT_BEARING_RE)) {
      const token = match[1];
      if (token && !result.includes(token)) result += token;
    }
    return result;
  }
}
