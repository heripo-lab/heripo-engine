import type { LoggerMethods } from '@heripo/logger';
import type { Caption } from '@heripo/model';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import { BatchProcessor, LLMCaller } from '@heripo/shared';
import { z } from 'zod';

import { BaseValidator, type BaseValidatorOptions } from './base-validator';

/**
 * Schema for a single caption validation result
 */
const CaptionValidationItemSchema = z.object({
  index: z.number().int().describe('Index of the caption in the input array'),
  isValid: z.boolean().describe('Whether the parsed caption is correct'),
  reason: z
    .string()
    .nullable()
    .describe('Brief explanation if invalid, null if valid'),
});

/**
 * Schema for batch caption validation response
 */
const CaptionValidationBatchSchema = z.object({
  results: z.array(CaptionValidationItemSchema),
});

type CaptionValidationBatch = z.infer<typeof CaptionValidationBatchSchema>;

/**
 * Options for CaptionValidator
 */
export interface CaptionValidatorOptions extends BaseValidatorOptions {
  // No additional options for now
}

/**
 * CaptionValidator
 *
 * Validates parsed captions against original text using LLM.
 * Processes captions in batches to optimize LLM API calls.
 *
 * ## Validation Rules
 *
 * Checks if the parsed "num" field correctly extracts the prefix + number from original text:
 * 1. **Correctness**: The "num" must contain the actual prefix+number from the original text
 *    - Example: "도판 1 유적 전경" → num="도판 1" ✓
 *    - Example: "도판 1 유적 전경" → num="도판" ✗ (incomplete)
 *
 * 2. **Spacing**: The spacing in "num" must match the original text exactly
 *    - Example: "도판 1" → num="도판 1" ✓
 *    - Example: "도판1" → num="도판1" ✓
 *    - Example: "도판 1" → num="도판1" ✗ (spacing mismatch)
 *
 * 3. **Completeness**: The number part must be fully extracted
 *    - Example: "Figure 2-3" → num="Figure 2-3" ✓
 *    - Example: "Figure 2-3" → num="Figure 2" ✗ (incomplete number)
 *
 * 4. **Null handling**: If "num" is null, verify that the original text has no number prefix
 *    - Example: "유적 전경 사진" → num=null ✓
 *    - Example: "도판 1 전경" → num=null ✗ (should extract "도판 1")
 */
export class CaptionValidator extends BaseValidator<
  typeof CaptionValidationBatchSchema,
  CaptionValidationBatch
> {
  constructor(
    logger: LoggerMethods,
    model: LanguageModel,
    options?: CaptionValidatorOptions,
    fallbackModel?: LanguageModel,
    aggregator?: LLMTokenUsageAggregator,
  ) {
    super(
      logger,
      model,
      'CaptionValidator',
      options,
      fallbackModel,
      aggregator,
    );
  }

  /**
   * Validate batch of parsed captions against original texts
   *
   * @param captions - Array of parsed Caption objects
   * @param originalTexts - Array of original caption texts (same order as captions)
   * @param batchSize - Batch size for processing. Set to 0 to skip validation (assume all valid).
   * @returns Array of validation results (boolean) maintaining original order
   */
  async validateBatch(
    captions: Caption[],
    originalTexts: string[],
    batchSize: number,
  ): Promise<boolean[]> {
    this.logger.info(
      `[CaptionValidator] Validating ${captions.length} captions with batch size ${batchSize}...`,
    );

    if (captions.length !== originalTexts.length) {
      throw new Error(
        `[CaptionValidator] Captions and originalTexts length mismatch: ${captions.length} vs ${originalTexts.length}`,
      );
    }

    if (captions.length === 0) {
      this.logger.info('[CaptionValidator] No captions to validate');
      return [];
    }

    if (batchSize === 0) {
      // Skip validation, assume all captions are valid
      this.logger.info(
        '[CaptionValidator] Skipping validation (batchSize=0), assuming all captions are valid',
      );
      return new Array(captions.length).fill(true);
    }

    try {
      // Convert to indexed format for batch processing
      const indexedItems = captions.map((caption, index) => ({
        index,
        caption,
        originalText: originalTexts[index],
      }));

      // Use BatchProcessor to process in parallel batches
      const batchResults = await BatchProcessor.processBatch(
        indexedItems,
        batchSize,
        async (batch) => this.validateBatchInternal(batch, this.model),
      );

      // Sort results by original index to maintain order
      batchResults.sort((a, b) => a.index - b.index);
      const results = batchResults.map((r) => r.isValid);

      const validCount = results.filter((r) => r).length;
      this.logger.info(
        `[CaptionValidator] Completed: ${validCount}/${results.length} captions validated as correct`,
      );

      // Log token usage summary if aggregator is available
      if (this.aggregator) {
        this.aggregator.logSummary(this.logger);
      }

      return results;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[CaptionValidator] Validation failed: ${message}`);
      throw new CaptionValidationError(
        `Failed to validate captions: ${message}`,
        { cause: error },
      );
    }
  }

  /**
   * Internal: Validate batch of captions using LLM
   *
   * @param items - Batch of caption items with original indices
   * @param model - Effective model to use
   * @returns Array of validation results indexed correctly
   */
  private async validateBatchInternal(
    items: Array<{ index: number; caption: Caption; originalText: string }>,
    model: LanguageModel,
  ): Promise<Array<{ index: number; isValid: boolean }>> {
    const result = await LLMCaller.call({
      schema: CaptionValidationBatchSchema,
      systemPrompt: this.buildSystemPrompt(),
      userPrompt: this.buildUserPrompt(items),
      primaryModel: model,
      fallbackModel: this.fallbackModel,
      maxRetries: this.maxRetries,
      temperature: this.temperature,
      abortSignal: this.abortSignal,
      component: 'CaptionValidator',
      phase: 'validation',
    });

    // Track token usage if aggregator is available
    if (this.aggregator) {
      this.aggregator.track(result.usage);
    }

    // Map LLM results back to original indices
    return result.output.results.map((item) => ({
      index: item.index,
      isValid: item.isValid,
    }));
  }

  protected buildSystemPrompt(): string {
    return `You are a caption validation expert for archaeological excavation reports.

Your task is to validate whether parsed caption prefixes (num field) are correctly extracted from original caption texts.

## Caption Pattern Recognition

A valid caption follows the pattern: <prefix word(s)> <number>
- The prefix can be ANY Korean/English word(s) that label images/tables/figures
- Common examples: 도판, 사진, 그림, 원색사진, 흑백사진, Figure, Photo, Plate, etc.
- The key is the PATTERN (text followed by number), not a specific word list
- Leading punctuation/brackets should be IGNORED when extracting

Valid caption patterns:
- "원색사진 1. 조사지역" → num="원색사진 1" ✓
- "흑백사진 2 출토유물" → num="흑백사진 2" ✓
- "도판 1 유적 전경" → num="도판 1" ✓
- "(사진 16> 느티나무" → num="사진 16" ✓ (ignore leading punctuation)
- "<도판 3> 유물 사진" → num="도판 3" ✓ (ignore angle brackets)

Invalid patterns (num MUST be null):
- "39 3월 28일(백제 도로유구)" → null ✓ (starts with number, no prefix)
- "1. 유적 전경" → null ✓ (numbered list item, not a caption)
- "2024년 조사 현황" → null ✓ (year reference, not a caption)

## Extraction Algorithm:

1. Extract prefix + number from the caption
   - The prefix is the text portion before the number
   - Full extraction: "원색사진 1", "도판 2-3", "그림 3.6", "Figure 4a"

2. **Decimal point handling**: Include period/dot after number if directly following
   - "그림 3.6. 한반도" → "그림 3.6" (period as decimal separator included)
   - "도판 2. 유적" → "도판 2" (period after space, NOT included)

3. **Stop rules** (extraction must stop at first occurrence of):
   - Punctuation (except decimal point): , : ; ! ? ~ ( ) [ ] { }
   - Whitespace: space, tab, newline
   - Underscore: _
   - Exception: Periods directly after digits are included as decimal separators
   - Exception: Hyphens within numbers are included (e.g., "2-3")

## Validation Rules:

1. **Pattern requirement**: The original text MUST follow <prefix> <number> pattern
   - "원색사진 1. 조사지역" → num="원색사진 1" ✓ (valid pattern)
   - "39 3월 28일(백제)" → num="39" ✗ (starts with number, should be null)
   - "1. 조사 개요" → num="1" ✗ (numbered list, should be null)

2. **Correctness**: The parsed "num" must contain the actual prefix+number
   - "도판 1 유적 전경" → num="도판 1" ✓
   - "도판 1 유적 전경" → num="도판" ✗ (incomplete)

3. **Spacing**: The spacing in "num" must match the original text exactly
   - "도판 1" → num="도판 1" ✓
   - "도판1" → num="도판1" ✓
   - "도판 1" → num="도판1" ✗ (spacing mismatch)

4. **Completeness**: The number part must be fully extracted
   - "Figure 2-3" → num="Figure 2-3" ✓
   - "Figure 2-3" → num="Figure 2" ✗ (incomplete number)

5. **Null handling**: If "num" is null, verify:
   - Either the original text has no number
   - OR the text starts with a number (no prefix)
   - "유적 전경 사진" → num=null ✓ (no number in caption position)
   - "원색사진 1 조사" → num=null ✗ (should extract "원색사진 1")

## Response:
For each caption, return:
- index: original position
- isValid: true if parsing is correct, false otherwise
- reason: null if valid, brief explanation if invalid`;
  }

  protected buildUserPrompt(
    items: Array<{ index: number; caption: Caption; originalText: string }>,
  ): string {
    const captionList = items
      .map(
        (item) =>
          `[${item.index}] Original: "${item.originalText}" | Parsed num: ${item.caption.num !== undefined ? `"${item.caption.num}"` : 'null'}`,
      )
      .join('\n');

    return `Validate the following caption parsing results:

${captionList}

Return the results as JSON array with "index", "isValid", and "reason" (null if valid, explanation if invalid).

Example format:
{
  "results": [
    { "index": 0, "isValid": true, "reason": null },
    { "index": 1, "isValid": false, "reason": "Number incomplete: expected '1-2' but got '1'" },
    { "index": 2, "isValid": true, "reason": null }
  ]
}`;
  }
}

/**
 * Error thrown when caption validation fails
 */
export class CaptionValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CaptionValidationError';
  }
}
