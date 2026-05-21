import type {
  ReviewAssistanceCommand,
  ReviewAssistanceDecision,
  ReviewAssistanceTableCell,
} from '@heripo/model';

import type { ReviewAssistancePageOutput } from '../../types/review-assistance-schema';
import type { PageReviewTableCell } from './page-review-context-builder';
import type { ReviewAssistanceValidatorOptions } from './review-assistance-validator';
import type { TableCorrectionContext } from './table-correction-context-builder';

import { REVIEW_ASSISTANCE_TASKS } from '../../prompts/review-assistance-prompt';
import { ReviewAssistanceValidator } from './review-assistance-validator';

// Single source of truth: the `tables` task definition owns the allowed ops.
// Deriving the set here keeps the validator independently callable without
// drifting from the runner's enforceTaskAllowedOps configuration.
const TABLES_TASK = REVIEW_ASSISTANCE_TASKS.find(
  (task) => task.id === 'tables',
);
/* v8 ignore start -- guard against accidental task list removal; the bundled definition always includes `tables` so this branch is unreachable in normal builds. */
if (!TABLES_TASK) {
  throw new Error(
    'TableCorrectionValidator: tables task missing from REVIEW_ASSISTANCE_TASKS',
  );
}
/* v8 ignore stop */
const TABLE_CORRECTION_ALLOWED_OPS = new Set<string>(TABLES_TASK.allowedOps);

// Bare unit token extracted from a unit hint like "10cm" → "cm". Longer units
// precede their prefixes (mm before m) so the leftmost match wins correctly.
const UNIT_TOKEN_RE = /(?:mm|cm|m²|m|㎝|㎜|㎡|kg|g|점|개)/iu;

export class TableCorrectionValidator {
  validatePageOutput(
    context: TableCorrectionContext,
    output: ReviewAssistancePageOutput,
    options: ReviewAssistanceValidatorOptions,
  ): ReviewAssistanceDecision[] {
    const baseDecisions = new ReviewAssistanceValidator().validatePageOutput(
      context.scopedPageContext,
      output,
      options,
    );

    return baseDecisions.map((decision) =>
      this.withTableValidation(context, decision),
    );
  }

  private withTableValidation(
    context: TableCorrectionContext,
    decision: ReviewAssistanceDecision,
  ): ReviewAssistanceDecision {
    const reasons = this.validateDecision(context, decision);
    const metadata = {
      ...decision.metadata,
      tableCorrection: {
        targetRef: context.targetTable.ref,
        targetBbox: context.targetTable.bbox,
        tableCountOnPage: context.tableCountOnPage,
        validationHints: context.validationHints,
      },
    };
    if (reasons.length === 0) {
      return { ...decision, metadata };
    }
    return {
      ...decision,
      disposition: 'skipped',
      reasons: [...decision.reasons, ...reasons],
      metadata,
    };
  }

  private validateDecision(
    context: TableCorrectionContext,
    decision: ReviewAssistanceDecision,
  ): string[] {
    const command = decision.command;
    if (!command) {
      const op = decision.invalidOp;
      return op && !TABLE_CORRECTION_ALLOWED_OPS.has(op)
        ? [`table_correction_op_not_allowed:${op}`]
        : [];
    }

    if (!TABLE_CORRECTION_ALLOWED_OPS.has(command.op)) {
      return [`table_correction_op_not_allowed:${command.op}`];
    }

    const reasons: string[] = [];
    if (context.tableCountOnPage > 1 && !context.targetTable.bbox) {
      reasons.push('table_correction_target_bbox_missing');
    }

    switch (command.op) {
      case 'updateTableCell':
        this.validateTargetTableRef(context, command.tableRef, reasons);
        this.validateUpdatedCellText(context, command.text, reasons);
        break;
      case 'replaceTable':
        this.validateTargetTableRef(context, command.tableRef, reasons);
        this.validateReplacementGrid(context, command.grid, reasons);
        break;
      case 'linkContinuedTable':
        this.validateTargetTableRef(context, command.sourceTableRef, reasons);
        this.validateContinuationDirection(context, command, reasons);
        break;
    }
    return reasons;
  }

  private validateTargetTableRef(
    context: TableCorrectionContext,
    tableRef: string,
    reasons: string[],
  ): void {
    if (tableRef !== context.targetTable.ref) {
      reasons.push('table_correction_target_ref_mismatch');
    }
  }

  private validateUpdatedCellText(
    context: TableCorrectionContext,
    text: string,
    reasons: string[],
  ): void {
    if (this.containsOtherTableContent(context, text)) {
      reasons.push('table_correction_other_table_content_mixed');
    }
  }

  private validateReplacementGrid(
    context: TableCorrectionContext,
    grid: ReviewAssistanceTableCell[][],
    reasons: string[],
  ): void {
    if (this.isNoopReplacement(context.targetTable.fullGrid, grid)) {
      // The model echoed the current grid unchanged. Skip it so the proposal
      // queue is not cluttered with whole-table "corrections" that change
      // nothing — the deterministic complement to the prompt's "return no
      // commands if the table is already correct" instruction.
      reasons.push('table_correction_noop');
      return;
    }
    this.validateSpans(grid, reasons);
    if (
      context.targetTable.hasSpans &&
      !grid
        .flat()
        .some((cell) => (cell.rowSpan ?? 1) > 1 || (cell.colSpan ?? 1) > 1)
    ) {
      reasons.push('table_correction_span_metadata_dropped');
    }
    if (
      ((context.targetTable.headerRows?.length ?? 0) > 0 ||
        (context.targetTable.headerColumns?.length ?? 0) > 0) &&
      !grid
        .flat()
        .some((cell) => cell.columnHeader === true || cell.rowHeader === true)
    ) {
      reasons.push('table_correction_header_metadata_dropped');
    }

    const replacementText = grid
      .flat()
      .map((cell) => cell.text)
      .join('\n');
    // Check the unit TOKEN (cm, mm, 점…), not the full number+unit hint. A
    // legitimate OCR correction changes the number ("10cm" → "12cm"), so
    // requiring the literal original hint would reject valid corrections; the
    // real invariant is that the unit itself is not dropped. carryOverTable
    // Structure re-attaches dropped tokens, so this passes by construction for
    // same-dimension grids and still guards the oversized-table fallback path.
    for (const unit of context.targetTable.unitHints ?? []) {
      const token = unit.match(UNIT_TOKEN_RE)?.[0];
      if (token && !this.includesNormalized(replacementText, token)) {
        reasons.push('table_correction_unit_hint_dropped');
        break;
      }
    }
    for (const marker of context.targetTable.footnoteMarkers ?? []) {
      if (!replacementText.includes(marker)) {
        reasons.push('table_correction_footnote_marker_dropped');
        break;
      }
    }
    if (this.emptyCellRatio(grid) - context.targetTable.emptyCellRatio > 0.35) {
      reasons.push('table_correction_empty_cell_explosion');
    }
    if (this.containsOtherTableContent(context, replacementText)) {
      reasons.push('table_correction_other_table_content_mixed');
    }
  }

  /**
   * True when `replacement` is structurally and textually identical to the
   * current `fullGrid` (normalized text + span/header flags). Used to drop
   * echo-only replaceTable commands. Returns false when no `fullGrid` is
   * available (oversized tables) so the regular checks still run.
   */
  private isNoopReplacement(
    current: PageReviewTableCell[][] | undefined,
    replacement: ReviewAssistanceTableCell[][],
  ): boolean {
    if (!current || current.length !== replacement.length) return false;
    return current.every((row, rowIndex) => {
      const replacementRow = replacement[rowIndex];
      if (!replacementRow || row.length !== replacementRow.length) return false;
      return row.every((cell, colIndex) => {
        const candidate = replacementRow[colIndex];
        return (
          this.normalize(cell.text) === this.normalize(candidate.text) &&
          cell.rowSpan === (candidate.rowSpan ?? 1) &&
          cell.colSpan === (candidate.colSpan ?? 1) &&
          cell.columnHeader === (candidate.columnHeader ?? false) &&
          cell.rowHeader === (candidate.rowHeader ?? false)
        );
      });
    });
  }

  private validateSpans(
    grid: ReviewAssistanceTableCell[][],
    reasons: string[],
  ): void {
    const rowCount = grid.length;
    const colCount = grid[0]?.length ?? 0;
    grid.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        const rowSpan = cell.rowSpan ?? 1;
        const colSpan = cell.colSpan ?? 1;
        if (!Number.isInteger(rowSpan) || !Number.isInteger(colSpan)) {
          reasons.push('table_correction_invalid_span');
          return;
        }
        if (rowSpan < 1 || colSpan < 1) {
          reasons.push('table_correction_invalid_span');
          return;
        }
        if (rowIndex + rowSpan > rowCount || colIndex + colSpan > colCount) {
          reasons.push('table_correction_span_out_of_bounds');
        }
      });
    });
  }

  private validateContinuationDirection(
    context: TableCorrectionContext,
    command: Extract<ReviewAssistanceCommand, { op: 'linkContinuedTable' }>,
    reasons: string[],
  ): void {
    const previousRefs = new Set(
      context.targetTable.previousPageTableRefs ?? [],
    );
    const nextRefs = new Set(context.targetTable.nextPageTableRefs ?? []);
    if (
      command.relation === 'continues_on_next_page' &&
      !nextRefs.has(command.continuedTableRef)
    ) {
      reasons.push('table_correction_continuation_ref_not_next_page');
    }
    if (
      command.relation === 'continued_from_previous_page' &&
      !previousRefs.has(command.continuedTableRef)
    ) {
      reasons.push('table_correction_continuation_ref_not_previous_page');
    }
  }

  private containsOtherTableContent(
    context: TableCorrectionContext,
    text: string,
  ): boolean {
    const normalized = this.normalize(text);
    if (!normalized) return false;
    const targetTokens = new Set(
      this.tableTokens(context.targetTable).map((token) =>
        this.normalize(token),
      ),
    );
    return context.otherTablesOnPage
      .flatMap((table) => this.tableTokens(table))
      .some((token) => {
        const normalizedToken = this.normalize(token);
        return (
          normalizedToken.length >= 4 &&
          !targetTokens.has(normalizedToken) &&
          normalized.includes(normalizedToken)
        );
      });
  }

  private tableTokens(table: {
    caption?: string;
    gridPreview: string[][];
  }): string[] {
    return [
      table.caption ?? '',
      ...table.gridPreview.flat().filter((value) => value.trim().length > 0),
    ];
  }

  private emptyCellRatio(grid: ReviewAssistanceTableCell[][]): number {
    const cells = grid.flat();
    if (cells.length === 0) return 0;
    return (
      cells.filter((cell) => cell.text.trim().length === 0).length /
      cells.length
    );
  }

  private includesNormalized(text: string, needle: string): boolean {
    return this.normalize(text).includes(this.normalize(needle));
  }

  private normalize(text: string): string {
    return text.replace(/\s+/g, '').toLowerCase();
  }
}
