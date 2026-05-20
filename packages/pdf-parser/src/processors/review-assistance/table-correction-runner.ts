import type { ReviewAssistanceDecision } from '@heripo/model';

import type {
  ReviewAssistancePageOutput,
  ReviewAssistanceRawCommand,
} from '../../types/review-assistance-schema';
import type {
  PageReviewContext,
  PageReviewTableCell,
} from './page-review-context-builder';
import type { ReviewAssistanceValidatorOptions } from './review-assistance-validator';
import type { ReviewAssistanceWorkItem } from './review-assistance-work-scheduler';
import type { TableCorrectionContext } from './table-correction-context-builder';

import { buildTableCorrectionPrompt } from '../../prompts/table-correction-prompt';
import {
  REVIEW_ASSISTANCE_EVIDENCE_MAX_LENGTH,
  REVIEW_ASSISTANCE_RATIONALE_MAX_LENGTH,
} from '../../types/review-assistance-schema';
import { TableCorrectionContextBuilder } from './table-correction-context-builder';
import { TableCorrectionValidator } from './table-correction-validator';

// Footnote markers and unit-bearing tokens, mirroring page-review-context-
// builder's detectFootnoteMarkers / detectUnitHints. Used to re-attach markers
// the model dropped during text correction (see carryOverTableStructure).
const FOOTNOTE_MARKER_RE = /(?:※|\*|[¹²³⁴⁵⁶⁷⁸⁹]|\[[0-9]+\]|\([0-9]+\))/gu;
const UNIT_BEARING_RE = /\d+(?:\.\d+)?\s?(mm|cm|m²|m|㎝|㎜|㎡|kg|g|점|개)/giu;

type SparseCellEdit = Extract<
  ReviewAssistanceRawCommand,
  { op: 'updateTableCell' }
>;

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

  validateOutput(
    context: TableCorrectionContext,
    output: ReviewAssistancePageOutput,
    options: ReviewAssistanceValidatorOptions,
  ): ReviewAssistanceDecision[] {
    return this.validator.validatePageOutput(
      context,
      this.bindOutputToTargetPage(
        context,
        this.carryOverTableStructure(
          context,
          this.foldSparseCellEdits(
            context,
            this.bindCommandsToTargetTable(context, output),
          ),
        ),
      ),
      options,
    );
  }

  /**
   * Weak review models reliably emit sparse per-cell edits
   * (`updateTableCell { row, col, text }`) but fail to regenerate a whole grid —
   * they drop spans/headers or return the wrong dimensions, which
   * carryOverTableStructure cannot rescue once dimensions diverge. So when the
   * target table has a fullGrid, deterministically fold those cell edits onto a
   * verbatim copy of the original grid and emit a SINGLE replaceTable: the
   * structure stays authoritative from the source and only the edited cells'
   * text changes. This mirrors the backoffice table-correction proposal (one
   * atomic table) while letting a weak model do only the easy part — the
   * deterministic post-processing the user asked for.
   *
   * In-bounds, non-shadow edits are applied with per-cell unit/footnote marker
   * restoration; out-of-bounds or shadow-targeting edits (a miscounting model)
   * are dropped and counted in a pageNote rather than silently clamped onto the
   * wrong cell. If no edit survives, the cell edits are removed entirely.
   * Oversized tables (no fullGrid, prompted in whole-grid mode) and responses
   * that already contain a replaceTable are left for the replaceTable /
   * carry-over path.
   */
  private foldSparseCellEdits(
    context: TableCorrectionContext,
    output: ReviewAssistancePageOutput,
  ): ReviewAssistancePageOutput {
    const original = context.targetTable.fullGrid;
    if (!original) return output;
    // Only fold edits that target this work item's table. A non-empty wrong
    // ref is left as a passthrough updateTableCell so the validator still
    // surfaces the mismatch and forces a re-ask — bindCommandsToTargetTable
    // binds only omitted refs, it never overrides a wrong one.
    const isFoldable = (
      command: ReviewAssistanceRawCommand,
    ): command is SparseCellEdit =>
      command.op === 'updateTableCell' &&
      command.tableRef === context.targetTable.ref;
    // A replaceTable for THIS table means the model chose the whole-grid path;
    // defer to it (carryOverTableStructure) instead of folding. A replaceTable
    // aimed at another ref does not block the fold — it falls through to
    // passthrough and the validator rejects it on its own.
    const hasTargetReplaceTable = output.commands.some(
      (command) =>
        command.op === 'replaceTable' &&
        command.tableRef === context.targetTable.ref,
    );
    const cellEdits = output.commands.filter(isFoldable);
    if (hasTargetReplaceTable || cellEdits.length === 0) return output;

    const shadows = this.buildShadowPositions(original);
    const grid = original.map((row) =>
      row.map((cell) => ({
        text: cell.text,
        bbox: null,
        rowSpan: cell.rowSpan,
        colSpan: cell.colSpan,
        columnHeader: cell.columnHeader,
        rowHeader: cell.rowHeader,
      })),
    );
    const applied: SparseCellEdit[] = [];
    let dropped = 0;
    for (const edit of cellEdits) {
      const rowCells = original[edit.row];
      const within =
        edit.row >= 0 &&
        edit.col >= 0 &&
        rowCells !== undefined &&
        edit.col < rowCells.length;
      if (!within || shadows.has(`${edit.row}:${edit.col}`)) {
        dropped += 1;
        continue;
      }
      grid[edit.row][edit.col].text = this.restoreCellMarkers(
        edit.text,
        rowCells[edit.col].text,
      );
      applied.push(edit);
    }

    const passthrough = output.commands.filter(
      (command) => !isFoldable(command),
    );
    if (applied.length === 0) {
      return { ...output, commands: passthrough };
    }

    // Surface dropped (out-of-range) edits on the synthetic command's
    // rationale — the only channel that reaches the decision and thus the run
    // sidecar / UI. validateOutput discards the output object (it returns
    // decisions), so pageNotes set here would never surface.
    const rationale = this.joinWithLimit(
      [
        ...applied.map((edit) => `[${edit.row},${edit.col}] ${edit.rationale}`),
        ...(dropped > 0 ? [`(dropped ${dropped} out-of-range edit(s))`] : []),
      ],
      REVIEW_ASSISTANCE_RATIONALE_MAX_LENGTH,
    );
    const synthetic: ReviewAssistanceRawCommand = {
      op: 'replaceTable',
      tableRef: context.targetTable.ref,
      grid,
      caption: null,
      confidence: Math.min(...applied.map((edit) => edit.confidence)),
      rationale,
      evidence: this.foldedEvidence(applied),
    };
    return { ...output, commands: [synthetic, ...passthrough] };
  }

  /**
   * Each table-correction work item targets exactly one page (`context.pageNo`,
   * the same value the base validator compares against). When the model returns
   * a different top-level pageNo the base validator rejects every command on
   * the page as `page_number_mismatch`. Since the target page is unambiguous,
   * clamp it — the deterministic complement to bindCommandsToTargetTable.
   */
  private bindOutputToTargetPage(
    context: TableCorrectionContext,
    output: ReviewAssistancePageOutput,
  ): ReviewAssistancePageOutput {
    return output.pageNo === context.pageNo
      ? output
      : { ...output, pageNo: context.pageNo };
  }

  /** Concatenate the folded edits' evidence snippets, dropping empty ones. */
  private foldedEvidence(edits: SparseCellEdit[]): string | null {
    const snippets = edits
      .map((edit) => edit.evidence)
      .filter((value): value is string => Boolean(value));
    return snippets.length === 0
      ? null
      : this.joinWithLimit(snippets, REVIEW_ASSISTANCE_EVIDENCE_MAX_LENGTH);
  }

  /** Join with "; " and hard-truncate to the schema's max length. */
  private joinWithLimit(parts: string[], limit: number): string {
    const joined = parts.join('; ');
    return joined.length > limit ? joined.slice(0, limit) : joined;
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
   * complement to the prompt's "copy the grid, change only wrong cells".
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

  /**
   * Each table-correction work item targets exactly one table
   * (`context.targetTable.ref`), but the flat LLM schema makes `tableRef`
   * optional — the model frequently omits it, which the flat→typed transform
   * turns into `''` and the validator then rejects as
   * `table_correction_target_ref_mismatch` / `target_ref_not_found`. Since the
   * target is unambiguous, fill an omitted ref with it so a dropped ref no
   * longer discards an otherwise valid correction. A non-empty ref is left as
   * given so a genuine mismatch is still surfaced; `continuedTableRef` is never
   * touched because it legitimately points at a different table.
   */
  private bindCommandsToTargetTable(
    context: TableCorrectionContext,
    output: ReviewAssistancePageOutput,
  ): ReviewAssistancePageOutput {
    const targetRef = context.targetTable.ref;
    return {
      ...output,
      commands: output.commands.map((command) => {
        switch (command.op) {
          case 'updateTableCell':
          case 'replaceTable':
            return command.tableRef
              ? command
              : { ...command, tableRef: targetRef };
          case 'linkContinuedTable':
            return command.sourceTableRef
              ? command
              : { ...command, sourceTableRef: targetRef };
          default:
            return command;
        }
      }),
    };
  }
}
