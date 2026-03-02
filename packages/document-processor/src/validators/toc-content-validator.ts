import type { LoggerMethods } from '@heripo/logger';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { BaseValidatorOptions } from './base-validator';

import { z } from 'zod';

import { BaseValidator } from './base-validator';

/**
 * Content type for TOC validation
 */
export type TocContentType = 'pure_toc' | 'mixed' | 'resource_only' | 'invalid';

/**
 * Schema for TOC content validation response
 */
export const TocContentValidationSchema = z.object({
  isValid: z.boolean().describe('Whether valid main document TOC was found'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence score between 0 and 1'),
  contentType: z
    .enum(['pure_toc', 'mixed', 'resource_only', 'invalid'])
    .describe('Type of content detected'),
  extractedTocMarkdown: z
    .string()
    .nullable()
    .describe('Extracted main TOC markdown when mixed; null otherwise'),
  reason: z.string().describe('Brief explanation in English'),
});

export type TocContentValidationResult = z.infer<
  typeof TocContentValidationSchema
>;

/**
 * Output type for TOC validation with resolved markdown
 */
export interface TocValidationOutput {
  isValid: boolean;
  confidence: number;
  contentType: TocContentType;
  validTocMarkdown: string | null;
  reason: string;
}

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
 * Supports mixed content extraction where main TOC is combined with resource indices.
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
   * @returns Validation output with resolved markdown for valid TOC
   */
  async validate(markdown: string): Promise<TocValidationOutput> {
    this.logger.info(
      `[TocContentValidator] Validating content (${markdown.length} chars)`,
    );

    if (!markdown.trim()) {
      this.logger.info(
        '[TocContentValidator] Empty markdown, returning invalid',
      );
      return {
        isValid: false,
        confidence: 1.0,
        contentType: 'invalid',
        validTocMarkdown: null,
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
      `[TocContentValidator] Result: isValid=${result.isValid}, contentType=${result.contentType}, confidence=${result.confidence}`,
    );

    // Resolve valid markdown based on content type
    let validTocMarkdown: string | null = null;
    if (result.isValid && result.confidence >= this.confidenceThreshold) {
      if (result.contentType === 'pure_toc') {
        validTocMarkdown = markdown;
      } else if (
        result.contentType === 'mixed' &&
        result.extractedTocMarkdown
      ) {
        validTocMarkdown = result.extractedTocMarkdown;
      }
    }

    return {
      isValid: result.isValid,
      confidence: result.confidence,
      contentType: result.contentType,
      validTocMarkdown,
      reason: result.reason,
    };
  }

  /**
   * Check if validation result passes threshold
   *
   * @param result - Validation output from validate()
   * @returns true if content is valid TOC with sufficient confidence
   */
  isValid(result: TocValidationOutput): boolean {
    return result.isValid && result.confidence >= this.confidenceThreshold;
  }

  /**
   * Get the valid TOC markdown from validation result
   *
   * @param result - Validation output from validate()
   * @returns Valid TOC markdown or null if invalid
   */
  getValidMarkdown(result: TocValidationOutput): string | null {
    return result.validTocMarkdown;
  }

  /**
   * Build system prompt for TOC content validation
   */
  protected buildSystemPrompt(): string {
    return `You are a document structure analyst. Your task is to analyze the provided content and classify it into one of four categories.

## Content Type Classification:

### 1. pure_toc
The content is ONLY a main document Table of Contents with:
- Structured list of chapters/sections with page numbers
- Hierarchical section titles (e.g., "Chapter 1", "제1장", "1.1 Introduction")
- Multiple entries (3 or more) organized by document structure
- NO resource indices mixed in

### 2. mixed
The content contains BOTH:
- A valid main document TOC (chapters/sections with page numbers)
- AND resource indices (photo/table/drawing indices)

When classifying as "mixed", you MUST extract ONLY the main TOC portion and return it in extractedTocMarkdown.

### 3. resource_only
The content contains ONLY resource indices such as:
- Photo/image indices (사진 목차, 사진목차, 寫眞 目次, 寫眞目次, Photo Index, List of Figures, List of Photos)
- Table indices (표 목차, 표목차, 表 目次, 表目次, Table Index, List of Tables)
- Drawing/diagram indices (도면 목차, 도면목차, 圖面 目次, 圖面目次, Drawing Index, List of Drawings)
- Appendix indices (부록 목차, Appendix Index)

### 4. invalid
The content is none of the above:
- Random body text
- Single entries or incomplete lists (fewer than 3 items)
- Reference lists or bibliographies
- Index pages (alphabetical keyword lists)
- Unstructured content

## Response Guidelines:
- Set isValid to true for "pure_toc" and "mixed" types
- Set isValid to false for "resource_only" and "invalid" types
- Set confidence between 0.0 and 1.0 based on your certainty
- For "mixed" type: extractedTocMarkdown MUST contain only the main TOC entries (preserve original formatting)
- For other types: extractedTocMarkdown should be null
- IMPORTANT: reason MUST be written in English

## Example Scenarios:

### Scenario 1: pure_toc
Input: "제1장 서론 ..... 1\\n제2장 조사개요 ..... 5\\n제3장 조사결과 ..... 15"
Output: { isValid: true, contentType: "pure_toc", extractedTocMarkdown: null }

### Scenario 2: mixed
Input: "제1장 서론 ..... 1\\n제2장 조사개요 ..... 5\\n\\n사진목차\\n사진 1 전경 ..... 50\\n사진 2 유물 ..... 51"
Output: { isValid: true, contentType: "mixed", extractedTocMarkdown: "제1장 서론 ..... 1\\n제2장 조사개요 ..... 5" }

### Scenario 3: resource_only
Input: "사진목차\\n사진 1 전경 ..... 50\\n사진 2 유물 ..... 51"
Output: { isValid: false, contentType: "resource_only", extractedTocMarkdown: null }`;
  }

  /**
   * Build user prompt with markdown content
   */
  protected buildUserPrompt(markdown: string): string {
    return `Analyze the following content and classify it:

${markdown}`;
  }
}
