import type { LoggerMethods } from '@heripo/logger';
import type { Caption } from '@heripo/model';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { CaptionParser } from '../parsers';
import type { RefResolver } from '../utils';
import type { CaptionValidator } from '../validators';

/**
 * Dependencies required by CaptionProcessingPipeline
 */
export interface CaptionProcessingPipelineDeps {
  logger: LoggerMethods;
  captionParser: CaptionParser;
  captionValidator: CaptionValidator;
  refResolver?: RefResolver;
  fallbackModel: LanguageModel;
  enableFallbackRetry: boolean;
  maxRetries: number;
  captionParserBatchSize: number;
  captionValidatorBatchSize: number;
  usageAggregator: LLMTokenUsageAggregator;
  abortSignal?: AbortSignal;
}

/**
 * CaptionProcessingPipeline
 *
 * Processes resource captions through a multi-step pipeline:
 * 1. Parse captions in batch (CaptionParser)
 * 2. Handle length mismatch recovery
 * 3. Validate parsed captions (CaptionValidator)
 * 4. Reparse failed captions with fallback model
 */
export class CaptionProcessingPipeline {
  private readonly logger: LoggerMethods;
  private readonly captionParser: CaptionParser;
  private readonly captionValidator: CaptionValidator;
  private readonly refResolver?: RefResolver;
  private readonly fallbackModel: LanguageModel;
  private readonly enableFallbackRetry: boolean;
  private readonly maxRetries: number;
  private readonly captionParserBatchSize: number;
  private readonly captionValidatorBatchSize: number;
  private readonly usageAggregator: LLMTokenUsageAggregator;
  private readonly abortSignal?: AbortSignal;

  constructor(deps: CaptionProcessingPipelineDeps) {
    this.logger = deps.logger;
    this.captionParser = deps.captionParser;
    this.captionValidator = deps.captionValidator;
    this.refResolver = deps.refResolver;
    this.fallbackModel = deps.fallbackModel;
    this.enableFallbackRetry = deps.enableFallbackRetry;
    this.maxRetries = deps.maxRetries;
    this.captionParserBatchSize = deps.captionParserBatchSize;
    this.captionValidatorBatchSize = deps.captionValidatorBatchSize;
    this.usageAggregator = deps.usageAggregator;
    this.abortSignal = deps.abortSignal;
  }

  /**
   * Process resource captions (for images and tables)
   *
   * Common caption processing pipeline:
   * 1. Parse captions in batch
   * 2. Validate parsed captions
   * 3. Reparse failed captions with fallback model
   *
   * @param captionTexts - Array of caption texts to process
   * @param resourceType - Type of resource for logging (e.g., 'image', 'table')
   * @returns Parsed captions with index mapping
   */
  async processResourceCaptions(
    captionTexts: Array<string | undefined>,
    resourceType: string,
  ): Promise<Map<number, Caption>> {
    const captionsByIndex: Map<number, Caption> = new Map();

    // Build map of valid captions with indices
    const validCaptionData: Array<{
      resourceIndex: number;
      filteredIndex: number;
      text: string;
    }> = [];

    for (let i = 0; i < captionTexts.length; i++) {
      const text = captionTexts[i];
      if (text !== undefined) {
        validCaptionData.push({
          resourceIndex: i,
          filteredIndex: validCaptionData.length,
          text,
        });
      }
    }

    const validCaptionTexts = validCaptionData.map((item) => item.text);

    // Step 1: Parse captions in batch
    const parsedCaptions =
      validCaptionTexts.length > 0
        ? await this.captionParser.parseBatch(
            validCaptionTexts,
            this.captionParserBatchSize,
          )
        : [];

    // Handle length mismatch between parsed results and valid captions
    let finalValidCaptionData = validCaptionData;
    let finalParsedCaptions = parsedCaptions;

    if (parsedCaptions.length !== validCaptionData.length) {
      this.logger.warn(
        `[CaptionProcessingPipeline] Caption parsing length mismatch for ${resourceType}: ` +
          `expected ${validCaptionData.length}, got ${parsedCaptions.length}. ` +
          `Attempting recovery by matching fullText...`,
      );

      // Create a map of fullText -> parsed caption for O(1) lookup
      const parsedMap = new Map<string, Caption>();
      for (const parsed of parsedCaptions) {
        parsedMap.set(parsed.fullText, parsed);
      }

      // Filter validCaptionData to only include items that were successfully parsed
      const recoveredData: typeof validCaptionData = [];
      for (const item of validCaptionData) {
        if (parsedMap.has(item.text)) {
          recoveredData.push(item);
        } else {
          this.logger.warn(
            `[CaptionProcessingPipeline] Skipping ${resourceType} caption at index ${item.resourceIndex}: "${item.text}" (not found in parsed results)`,
          );
        }
      }

      // Re-map parsedCaptions to match the filtered data
      /* c8 ignore start - defensive guard: recoveredData only contains items where parsedMap.has() returned true */
      const recoveredCaptions: Caption[] = [];
      for (const item of recoveredData) {
        const caption = parsedMap.get(item.text);
        if (caption) {
          recoveredCaptions.push(caption);
        }
      }
      /* c8 ignore stop */

      /* c8 ignore start - defensive guard: recoveredData only contains items where parsedMap.has() returned true */
      if (recoveredCaptions.length !== recoveredData.length) {
        throw new Error(
          `[CaptionProcessingPipeline] Failed to recover from length mismatch: ` +
            `recovered ${recoveredCaptions.length} captions for ${recoveredData.length} valid items`,
        );
      }
      /* c8 ignore stop */

      finalValidCaptionData = recoveredData;
      finalParsedCaptions = recoveredCaptions;

      this.logger.info(
        `[CaptionProcessingPipeline] Successfully recovered ${finalParsedCaptions.length} ${resourceType} captions after length mismatch`,
      );
    }

    // Store parsed captions by resource index
    for (let i = 0; i < finalParsedCaptions.length; i++) {
      const resourceIndex = finalValidCaptionData[i].resourceIndex;
      captionsByIndex.set(resourceIndex, finalParsedCaptions[i]);
    }

    // Step 2: Validate parsed captions
    if (finalParsedCaptions.length > 0) {
      const finalValidCaptionTexts = finalValidCaptionData.map(
        (item) => item.text,
      );
      const validationResults = await this.captionValidator.validateBatch(
        finalParsedCaptions,
        finalValidCaptionTexts,
        this.captionValidatorBatchSize,
      );

      // Step 3: Reparse failed captions with fallback model
      const failedIndices = validationResults
        .map((isValid, index) => (isValid ? -1 : index))
        .filter((index) => index !== -1);

      if (failedIndices.length > 0) {
        for (const filteredIndex of failedIndices) {
          const captionData = finalValidCaptionData[filteredIndex];
          const originalText = captionData.text;
          const parsedNum = finalParsedCaptions[filteredIndex].num;
          const resourceIndex = captionData.resourceIndex;
          this.logger.warn(
            `[CaptionProcessingPipeline] Invalid ${resourceType} caption [${resourceIndex}]: "${originalText}" | parsed num="${parsedNum}"`,
          );
        }

        // Reparse failed captions with fallback model if enabled
        if (this.enableFallbackRetry) {
          this.logger.info(
            `[CaptionProcessingPipeline] Reparsing ${failedIndices.length} failed ${resourceType} captions with fallback model...`,
          );

          // Collect failed caption texts
          const failedCaptionTexts = failedIndices.map(
            (filteredIndex) => finalValidCaptionData[filteredIndex].text,
          );

          // Create a new CaptionParser instance with fallback model for separate token tracking
          const { CaptionParser: CaptionParserClass } =
            await import('../parsers/caption-parser');
          const fallbackCaptionParser = new CaptionParserClass(
            this.logger,
            this.fallbackModel,
            {
              maxRetries: this.maxRetries,
              componentName: 'CaptionParser-fallback',
              abortSignal: this.abortSignal,
            },
            undefined, // no fallback for the fallback
            this.usageAggregator,
          );

          // Reparse with fallback model (sequential processing for better accuracy)
          const reparsedCaptions = await fallbackCaptionParser.parseBatch(
            failedCaptionTexts,
            0, // sequential processing
          );

          // Update captionsByIndex with reparsed results
          for (let i = 0; i < failedIndices.length; i++) {
            const filteredIndex = failedIndices[i];
            const resourceIndex =
              finalValidCaptionData[filteredIndex].resourceIndex;
            captionsByIndex.set(resourceIndex, reparsedCaptions[i]);
          }

          this.logger.info(
            `[CaptionProcessingPipeline] Reparsed ${reparsedCaptions.length} ${resourceType} captions`,
          );
        } else {
          this.logger.warn(
            `[CaptionProcessingPipeline] ${failedIndices.length} ${resourceType} captions failed validation (kept as-is, fallback retry disabled)`,
          );
        }
      }
    }

    return captionsByIndex;
  }

  /**
   * Extract caption text from resource
   *
   * Handles both string references and $ref resolution
   */
  extractCaptionText(
    captions: Array<string | { $ref: string }> | undefined,
  ): string | undefined {
    if (!captions?.[0]) {
      return undefined;
    }

    const captionRef = captions[0];
    if (typeof captionRef === 'string') {
      return captionRef;
    }

    if (this.refResolver && '$ref' in captionRef) {
      const resolved = this.refResolver.resolveText(captionRef.$ref);
      return resolved?.text;
    }

    return undefined;
  }
}
