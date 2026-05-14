import type { LoggerMethods } from '@heripo/logger';
import type { Caption, DoclingReference } from '@heripo/model';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { RefResolver } from '../utils';
import type { CaptionValidator } from '../validators';

import { CaptionParser } from '../parsers';

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
 * Caption text and source references extracted from Docling caption links.
 *
 * `text` is omitted when none of the captions resolved to non-empty text;
 * `sourceRefs` is always present and contains every `$ref` caption in order
 * (string captions contribute to `text` only).
 */
export interface CaptionSourceExtraction {
  text?: string;
  sourceRefs: string[];
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
  private static readonly CAPTION_JOIN_SEPARATOR = ' ';

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

    captionTexts.forEach((text, i) => {
      if (text !== undefined) {
        validCaptionData.push({
          resourceIndex: i,
          filteredIndex: validCaptionData.length,
          text,
        });
      }
    });

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
      const parsedMap = new Map<string, Caption>(
        parsedCaptions.map((parsed) => [parsed.fullText, parsed]),
      );

      // Filter validCaptionData to only include items that were successfully parsed
      const recoveredData = validCaptionData.filter((item) => {
        if (parsedMap.has(item.text)) {
          return true;
        }
        this.logger.warn(
          `[CaptionProcessingPipeline] Skipping ${resourceType} caption at index ${item.resourceIndex}: "${item.text}" (not found in parsed results)`,
        );
        return false;
      });

      // Re-map parsedCaptions to match the filtered data
      /* c8 ignore start - defensive guard: recoveredData only contains items where parsedMap.has() returned true */
      const recoveredCaptions: Caption[] = recoveredData
        .map((item) => parsedMap.get(item.text))
        .filter((caption): caption is Caption => caption !== undefined);
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
    finalParsedCaptions.forEach((caption, i) => {
      const resourceIndex = finalValidCaptionData[i].resourceIndex;
      captionsByIndex.set(resourceIndex, caption);
    });

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
        failedIndices.forEach((filteredIndex) => {
          const captionData = finalValidCaptionData[filteredIndex];
          const originalText = captionData.text;
          const parsedNum = finalParsedCaptions[filteredIndex].num;
          const resourceIndex = captionData.resourceIndex;
          this.logger.warn(
            `[CaptionProcessingPipeline] Invalid ${resourceType} caption [${resourceIndex}]: "${originalText}" | parsed num="${parsedNum}"`,
          );
        });

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
          const fallbackCaptionParser = new CaptionParser(
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
          failedIndices.forEach((filteredIndex, i) => {
            const resourceIndex =
              finalValidCaptionData[filteredIndex].resourceIndex;
            captionsByIndex.set(resourceIndex, reparsedCaptions[i]);
          });

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
   * Extract combined caption text from resource captions.
   *
   * Returns every caption joined with a single space; empty/whitespace-only
   * entries are skipped. Returns `undefined` when nothing resolves to text.
   *
   * @deprecated Use {@link extractCaptionSource} to also receive the
   * caption `$ref` list. This helper is retained as a thin wrapper for
   * legacy callers.
   */
  extractCaptionText(
    captions: Array<string | DoclingReference> | undefined,
  ): string | undefined {
    return this.extractCaptionSource(captions).text;
  }

  /**
   * Extract caption text and source references from resource captions.
   *
   * Iterates captions in order. String captions contribute to text only;
   * `$ref` captions also push the ref onto `sourceRefs` regardless of whether
   * the resolver finds text. Resolved/raw text is trimmed, and empty parts
   * are skipped before joining.
   */
  extractCaptionSource(
    captions: Array<string | DoclingReference> | undefined,
  ): CaptionSourceExtraction {
    const sourceRefs: string[] = [];
    const textParts: string[] = [];

    captions?.forEach((caption) => {
      if (typeof caption === 'string') {
        const text = caption.trim();
        if (text.length > 0) {
          textParts.push(text);
        }
        return;
      }

      sourceRefs.push(caption.$ref);
      const resolved = this.refResolver?.resolveText(caption.$ref);
      const text = resolved?.text.trim();
      if (text && text.length > 0) {
        textParts.push(text);
      }
    });

    if (textParts.length === 0) {
      return { sourceRefs };
    }

    return {
      text: textParts.join(CaptionProcessingPipeline.CAPTION_JOIN_SEPARATOR),
      sourceRefs,
    };
  }
}
