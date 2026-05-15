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
    return this.validator.validatePageOutput(context, output, options);
  }
}
