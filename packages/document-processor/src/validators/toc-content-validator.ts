import type { LoggerMethods } from '@heripo/logger';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { BaseValidatorOptions } from './base-validator';

import { z } from 'zod';

import { BaseValidator } from './base-validator';

/**
 * Schema for TOC content validation response
 */
export const TocContentValidationSchema = z.object({
  isToc: z.boolean().describe('Whether the content is a table of contents'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence score between 0 and 1'),
  reason: z.string().describe('Brief explanation for the decision'),
});

export type TocContentValidationResult = z.infer<
  typeof TocContentValidationSchema
>;

/**
 * Options for TocContentValidator
 */
export interface TocContentValidatorOptions extends BaseValidatorOptions {
  /**
   * Minimum confidence to consider valid (default: 0.7)
   */
  confidenceThreshold?: number;
}

/**
 * TocContentValidator
 *
 * Uses LLM to validate whether extracted markdown content is actually a TOC.
 * This is a semantic validation, not structural validation.
 */
export class TocContentValidator extends BaseValidator<
  typeof TocContentValidationSchema,
  TocContentValidationResult
> {
  private readonly confidenceThreshold: number;

  constructor(
    logger: LoggerMethods,
    model: LanguageModel,
    options?: TocContentValidatorOptions,
    fallbackModel?: LanguageModel,
    aggregator?: LLMTokenUsageAggregator,
  ) {
    super(
      logger,
      model,
      'TocContentValidator',
      options,
      fallbackModel,
      aggregator,
    );
    this.confidenceThreshold = options?.confidenceThreshold ?? 0.7;
  }

  /**
   * Validate if the markdown content is a table of contents
   *
   * @param markdown - Markdown content to validate
   * @returns Validation result with isToc, confidence, and reason
   */
  async validate(markdown: string): Promise<TocContentValidationResult> {
    this.logger.info(
      `[TocContentValidator] Validating content (${markdown.length} chars)`,
    );

    if (!markdown.trim()) {
      this.logger.info(
        '[TocContentValidator] Empty markdown, returning invalid',
      );
      return {
        isToc: false,
        confidence: 1.0,
        reason: 'Empty content',
      };
    }

    const { output: result } = await this.callLLM(
      TocContentValidationSchema,
      this.buildSystemPrompt(),
      this.buildUserPrompt(markdown),
      'validation',
      this.aggregator,
    );

    this.logger.info(
      `[TocContentValidator] Result: isToc=${result.isToc}, confidence=${result.confidence}`,
    );

    return result;
  }

  /**
   * Check if validation result passes threshold
   *
   * @param result - Validation result from validate()
   * @returns true if content is valid TOC with sufficient confidence
   */
  isValid(result: TocContentValidationResult): boolean {
    return result.isToc && result.confidence >= this.confidenceThreshold;
  }

  /**
   * Build system prompt for TOC content validation
   */
  protected buildSystemPrompt(): string {
    return `You are a document structure analyst. Your task is to determine if the provided content is a Table of Contents (TOC).

## What IS a Table of Contents:
- A structured list of chapters/sections with corresponding page numbers
- Contains hierarchical section titles (e.g., "Chapter 1", "제1장", "1.1 Introduction", etc.)
- Has page number references for each entry (e.g., "..... 10", "... 5", or just a number at the end)
- Multiple entries organized by document structure
- Main document outline listing major chapters and sections

## What is NOT a Table of Contents:
- Photo/image indices (사진 목차, 사진목차, Photo Index, List of Figures, List of Photos)
- Table indices (표 목차, 표목차, Table Index, List of Tables)
- Drawing/diagram indices (도면 목차, 도면목차, Drawing Index, List of Drawings)
- Appendix indices (부록 목차, Appendix Index)
- Random body text from the document
- Single entries or incomplete lists (fewer than 3 items)
- Reference lists or bibliographies
- Index pages (alphabetical keyword lists)

## Response Guidelines:
- Set isToc to true ONLY if content is clearly a main document TOC
- Set confidence between 0.0 and 1.0 based on your certainty
- Provide a brief reason explaining your decision (1-2 sentences)`;
  }

  /**
   * Build user prompt with markdown content
   */
  protected buildUserPrompt(markdown: string): string {
    return `Determine if the following content is a Table of Contents:

${markdown}`;
  }
}
