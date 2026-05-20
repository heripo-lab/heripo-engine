import type { ReviewAssistanceDecision } from '@heripo/model';

import type { ReviewAssistancePageOutput } from '../../types/review-assistance-schema';
import type { PageReviewContext } from './page-review-context-builder';
import type { ReviewAssistanceValidatorOptions } from './review-assistance-validator';
import type { ReviewAssistanceWorkItem } from './review-assistance-work-scheduler';
import type { TableCorrectionContext } from './table-correction-context-builder';

import { buildTableCorrectionPrompt } from '../../prompts/table-correction-prompt';
import { TableCorrectionContextBuilder } from './table-correction-context-builder';
import { TableCorrectionValidator } from './table-correction-validator';

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
      this.bindCommandsToTargetTable(context, output),
      options,
    );
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
