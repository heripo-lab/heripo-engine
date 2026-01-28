import type { LoggerMethods } from '@heripo/logger';
import type { Caption } from '@heripo/model';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import {
  BatchProcessor,
  LLMCaller,
  LLMTokenUsageAggregator as LLMTokenUsageAggregatorClass,
} from '@heripo/shared';
import { z } from 'zod';

import {
  type BaseLLMComponentOptions,
  TextLLMComponent,
} from '../core/text-llm-component';

/**
 * CaptionParser options
 */
export interface CaptionParserOptions extends BaseLLMComponentOptions {
  /**
   * Custom component name for token usage tracking.
   * Defaults to 'CaptionParser'.
   */
  componentName?: string;
}

/**
 * Schema for a single caption extraction result (used for sequential processing)
 */
const CaptionSingleSchema = z.object({
  num: z
    .string()
    .nullable()
    .describe('Extracted caption prefix + number (e.g., "도판 1", "Figure 2")'),
});

/**
 * Schema for a single caption extraction result with index (used for batch processing)
 */
const CaptionExtractionSchema = z.object({
  index: z.number().int().describe('Index of the caption in the input array'),
  num: z
    .string()
    .nullable()
    .describe('Extracted caption prefix + number (e.g., "도판 1", "Figure 2")'),
});

/**
 * Schema for batch caption response
 */
const CaptionBatchSchema = z.object({
  results: z.array(CaptionExtractionSchema),
});

/**
 * CaptionParser
 *
 * Extracts caption prefix and number from image/table captions using LLM.
 * Preserves original spacing from input text.
 * Extends TextLLMComponent for standardized LLM call handling.
 *
 * ## Algorithm
 *
 * 1. Collect caption texts
 * 2. Split into batches based on batchSize
 * 3. For each batch: call LLM to extract caption prefix + number
 * 4. Flatten results and return
 */
export class CaptionParser extends TextLLMComponent {
  constructor(
    logger: LoggerMethods,
    model: LanguageModel,
    options?: CaptionParserOptions,
    fallbackModel?: LanguageModel,
    aggregator?: LLMTokenUsageAggregator,
  ) {
    super(
      logger,
      model,
      options?.componentName ?? 'CaptionParser',
      options,
      fallbackModel,
      aggregator ?? new LLMTokenUsageAggregatorClass(),
    );
  }

  /**
   * Parse batch of captions
   *
   * @param captions - Array of caption full texts
   * @param batchSize - Batch size for processing. Set to 0 for sequential processing without batching.
   * @param overrideModel - Optional model to use instead of the default model
   * @returns Array of Caption objects with num extracted (maintains original order)
   */
  async parseBatch(
    captions: string[],
    batchSize: number,
    overrideModel?: LanguageModel,
  ): Promise<Caption[]> {
    const effectiveModel = overrideModel ?? this.model;
    const isOverride = overrideModel !== undefined;
    const modelName =
      (effectiveModel as { modelId?: string }).modelId ??
      (effectiveModel as { id?: string }).id ??
      'unknown';
    this.log(
      'info',
      `Starting caption parsing for ${captions.length} captions with ${isOverride ? 'override ' : ''}model: ${modelName}`,
    );

    if (captions.length === 0) {
      this.log('info', 'No captions to parse');
      return [];
    }

    try {
      if (batchSize === 0) {
        // Sequential processing (one-by-one) without batch processing
        this.log('info', 'Using sequential processing (batchSize=0)');
        const results: Caption[] = [];

        for (let i = 0; i < captions.length; i++) {
          const fullText = captions[i];

          // Log progress
          this.log('info', `Processing ${i + 1} / ${captions.length}...`);

          const result = await LLMCaller.call({
            schema: CaptionSingleSchema,
            systemPrompt: this.buildSystemPrompt('single'),
            userPrompt: this.buildUserPromptSingle(fullText),
            primaryModel: effectiveModel,
            fallbackModel: this.fallbackModel,
            maxRetries: this.maxRetries,
            temperature: this.temperature,
            abortSignal: this.abortSignal,
            component: this.componentName,
            phase: 'caption-extraction',
          });

          this.trackUsage(result.usage);

          const finalNum = this.extractNumFromFullText(
            fullText,
            result.output.num,
          );
          results.push({ fullText, num: finalNum });
        }

        // Log token usage summary
        this.aggregator!.logSummary(this.logger);

        this.log(
          'info',
          `Completed: ${results.length} captions parsed, ${results.filter((r) => r.num).length} with extracted numbers`,
        );

        return results;
      }

      // Batch processing: Convert to indexed format for batch processing
      const indexedCaptions = captions.map((text, index) => ({ index, text }));

      // Use BatchProcessor to process captions in parallel batches
      const batchResults = await BatchProcessor.processBatch(
        indexedCaptions,
        batchSize,
        async (batch) => this.parseBatchInternal(batch, effectiveModel),
      );

      // Sort results by original index to maintain order
      batchResults.sort((a, b) => a.index - b.index);
      const results = batchResults.map((r) => r.caption);

      // Log token usage summary
      this.aggregator!.logSummary(this.logger);

      this.log(
        'info',
        `Completed: ${results.length} captions parsed, ${results.filter((r) => r.num).length} with extracted numbers`,
      );

      return results;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log('error', `Parsing failed: ${message}`);
      throw new CaptionParseError(`Failed to parse captions: ${message}`, {
        cause: error,
      });
    }
  }

  /**
   * Internal: Parse batch of captions using LLM
   *
   * @param captions - Batch of caption texts with original indices
   * @param model - Effective model to use
   * @returns Array of Caption objects indexed correctly
   */
  private async parseBatchInternal(
    captions: Array<{ index: number; text: string }>,
    model: LanguageModel,
  ): Promise<Array<{ index: number; caption: Caption }>> {
    const result = await LLMCaller.call({
      schema: CaptionBatchSchema,
      systemPrompt: this.buildSystemPrompt(),
      userPrompt: this.buildUserPrompt(captions),
      primaryModel: model,
      fallbackModel: this.fallbackModel,
      maxRetries: this.maxRetries,
      temperature: this.temperature,
      abortSignal: this.abortSignal,
      component: this.componentName,
      phase: 'caption-extraction',
    });

    // Track token usage
    this.trackUsage(result.usage);

    // Warn if LLM returned incomplete results (fewer results than inputs)
    if (result.output.results.length !== captions.length) {
      this.log(
        'warn',
        `LLM returned ${result.output.results.length} results for ${captions.length} captions. ` +
          `This may cause index mismatch.`,
      );
    }

    // Map LLM results back to original indices
    const captionMap = new Map(captions.map((c) => [c.index, c.text]));

    return result.output.results.map((resultItem) => {
      // resultItem.index is the position within this batch (0, 1, 2...)
      // We need to use the original caption at that position to get the actual index
      const originalCaption = captions[resultItem.index];
      const originalIndex = originalCaption?.index ?? resultItem.index;
      const fullText = captionMap.get(originalIndex) || '';
      const finalNum = this.extractNumFromFullText(fullText, resultItem.num);

      return {
        index: originalIndex,
        caption: {
          fullText,
          num: finalNum,
        },
      };
    });
  }

  /**
   * Extract and normalize caption number from full text
   *
   * Finds the extracted num pattern in the full text and extracts it
   * with original casing. Handles case-insensitive matching.
   *
   * @param fullText - The full caption text
   * @param extractedNum - The num extracted by LLM (may have different casing)
   * @returns Normalized num or undefined if no match
   */
  private extractNumFromFullText(
    fullText: string,
    extractedNum: string | null,
  ): string | undefined {
    if (!extractedNum) return undefined;

    let matchIndex = fullText.indexOf(extractedNum);

    if (matchIndex === -1) {
      // Pattern not found directly - try case-insensitive search
      const lowerFullText = fullText.toLowerCase();
      const lowerNum = extractedNum.toLowerCase();
      matchIndex = lowerFullText.indexOf(lowerNum);

      if (matchIndex !== -1) {
        // Found case-insensitive match - extract from match position using original casing
        return fullText.substring(matchIndex, matchIndex + extractedNum.length);
      }
      // If still not found, keep the original extracted num
      return extractedNum;
    }

    // Found the pattern - extract from match position to end of the matched pattern
    return fullText.substring(matchIndex, matchIndex + extractedNum.length);
  }

  /**
   * Build system prompt for caption parsing
   *
   * @param mode - 'batch' for multiple captions, 'single' for single caption
   */
  protected buildSystemPrompt(mode: 'batch' | 'single' = 'batch'): string {
    const intro =
      mode === 'batch'
        ? 'Extract the caption prefix and number (e.g., "도판 1", "Figure 2") from image/table captions.\nReturn the prefix + number part as a string, or null if no number exists.'
        : 'Extract the caption prefix and number (e.g., "도판 1", "Figure 2") from an image/table caption.\nReturn the prefix + number part as a string, or null if no number exists.';

    return `You are a caption prefix extractor for archaeological excavation reports.

${intro}

Rules:
1. Extract if the text follows a caption pattern: <prefix word(s)> <number>
   - The prefix can be ANY Korean/English word(s) that label images/tables/figures
   - Common examples: 도판, 사진, 그림, 도면, 표, 원색사진, 흑백사진, Figure, Photo, Plate, etc.
   - The key is the PATTERN (text followed by number), not a specific word list
   - "원색사진 1. 조사지역" → "원색사진 1" (valid: prefix + number pattern)
   - "흑백사진 2 출토유물" → "흑백사진 2" (valid: prefix + number pattern)
2. IGNORE leading punctuation/brackets when extracting:
   - "(사진 16> 느티나무" → "사진 16" (ignore leading '(' and extract the pattern inside)
   - "<도판 1> 유적" → "도판 1" (ignore angle brackets)
   - "[그림 2] 전경" → "그림 2" (ignore square brackets)
3. Do NOT extract (return null) if:
   - It's a numbered list item starting with just a number: "1. 유적 전경" → null
   - It's a date/time reference: "39 3월 28일..." → null
   - It's a year reference: "2024년 조사 현황" → null
   - It starts with a number without a prefix: "123 설명" → null
4. PRESERVE original spacing from the input text exactly (after ignoring leading punctuation)
5. Include the full number (e.g., "1-2", "3a") not just the first digit
6. Include period/dot after number if it directly follows (e.g., "3.6" → "도판 3.6")
   - "그림 3.6. 한반도 중부" → "그림 3.6" (period after decimal number included)
   - "도판 2. 유적" → "도판 2" (period after space NOT included)
7. Stop at the first punctuation (except decimal point), whitespace, or underscore after the number
   - "사진 1_ㅇㅇㅇ" → "사진 1" (stop at underscore)
   - "사진 1 ㅇㅇㅇ" → "사진 1" (stop at space)
   - "그림 3.6. 한반도" → "그림 3.6" (period included as decimal separator)

Examples:
- "도판 1 유적 전경" → "도판 1"
- "원색사진 1. 조사지역 원경" → "원색사진 1"
- "흑백사진 2 출토유물" → "흑백사진 2"
- "(사진 16> 느티나무의 접선단면" → "사진 16" (ignore leading punctuation)
- "<도판 3> 유물 사진" → "도판 3" (ignore angle brackets)
- "도판1 어쩌구" → "도판1" (no space preserved)
- "사진 2. 출토 유물" → "사진 2" (period after space, not included)
- "그림 3.6. 한반도 중부 및 남부의 ㅇㅇㅇ" → "그림 3.6" (period as decimal included)
- "Figure 3: Site plan" → "Figure 3"
- "Table 4a. Artifact list" → "Table 4a"
- "도판 5-2 층위 단면" → "도판 5-2"
- "설명 없는 이미지" → null
- "39 3월 28일(백제 도로유구 내부 조사)" → null (starts with number, no prefix)
- "1. 유구 현황" → null (numbered list, not caption)
- "2024-05-01 촬영" → null (date, not caption)`;
  }

  /**
   * Build user prompt for caption parsing
   */
  protected buildUserPrompt(
    captions: Array<{ index: number; text: string }>,
  ): string {
    const captionList = captions
      .map((c) => `[${c.index}] ${c.text}`)
      .join('\n');

    return `Extract caption prefix and number from the following captions:

${captionList}

Return the results as JSON array with "index" (original position) and "num" (extracted prefix + number or null).

Example format:
[
  { "index": 0, "num": "도판 1" },
  { "index": 1, "num": "Figure 2" },
  { "index": 2, "num": null }
]`;
  }

  /**
   * Build user prompt for single caption parsing
   */
  private buildUserPromptSingle(caption: string): string {
    return `Extract caption prefix and number from the following caption:

"${caption}"

CRITICAL: Return ONLY the JSON object directly with a "num" field.
- DO NOT wrap the JSON in quotes or additional formatting
- DO NOT output "final:", "result:", or any prefix labels
- DO NOT wrap in backticks or code blocks
- Return ONLY valid JSON: { "num": value }

The value must be:
- A string with the extracted caption prefix + number (e.g., "도판 1", "Figure 2")
- null if no number exists

Valid outputs:
{ "num": "도판 1" }
{ "num": null }

Invalid outputs (NEVER do these):
- { "final": "..." } ❌
- \`\`\`json { "num": "..." } \`\`\` ❌
- "{ "num": "..." }" ❌
- { "num": { "value": "..." } } ❌`;
  }
}

/**
 * Error thrown when caption parsing fails
 */
export class CaptionParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CaptionParseError';
  }
}
