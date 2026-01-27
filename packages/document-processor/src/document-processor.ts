import type { LoggerMethods } from '@heripo/logger';
import type {
  Caption,
  Chapter,
  DoclingDocument,
  DocumentProcessResult,
  PageRange,
  ProcessedDocument,
  ProcessedFootnote,
  ProcessedImage,
  ProcessedTable,
  ProcessedTableCell,
  TextBlock,
} from '@heripo/model';
import type { LanguageModel } from 'ai';

import type { TocEntry } from './types';

import { LLMTokenUsageAggregator } from '@heripo/shared';

import { ChapterConverter } from './converters';
import {
  TocExtractor,
  TocFinder,
  TocNotFoundError,
  VisionTocExtractor,
} from './extractors';
import { CaptionParser, PageRangeParser } from './parsers';
import {
  IdGenerator,
  MarkdownConverter,
  RefResolver,
  TextCleaner,
} from './utils';
import { CaptionValidator, TocContentValidator } from './validators';

/**
 * DocumentProcessor Options
 */
export interface DocumentProcessorOptions {
  /**
   * Logger instance
   */
  logger: LoggerMethods;

  /**
   * Fallback model - used as fallback when component-specific models are not provided or fail.
   * This is the only required model. Should be set to a frontier model (e.g., Claude Opus 4.5, GPT-5.2)
   * to ensure reliable fallback performance across all components.
   */
  fallbackModel: LanguageModel;

  /**
   * Model for PageRangeParser - extracts page numbers from page images.
   * Requires vision capabilities. Falls back to 'fallbackModel' if not provided.
   */
  pageRangeParserModel?: LanguageModel;

  /**
   * Model for TocExtractor - extracts structured TOC from Markdown representation.
   * Falls back to 'fallbackModel' if not provided.
   */
  tocExtractorModel?: LanguageModel;

  /**
   * Model for validators (TOC content validation, caption validation).
   * Falls back to 'fallbackModel' if not provided.
   */
  validatorModel?: LanguageModel;

  /**
   * Model for VisionTocExtractor - extracts TOC directly from page images.
   * Requires vision capabilities. Falls back to 'fallbackModel' if not provided.
   */
  visionTocExtractorModel?: LanguageModel;

  /**
   * Model for CaptionParser - extracts caption prefix and number from image/table captions.
   * Falls back to 'fallbackModel' if not provided.
   */
  captionParserModel?: LanguageModel;

  /**
   * Batch size for TextCleaner text normalization (synchronous processing)
   */
  textCleanerBatchSize: number;

  /**
   * Batch size for CaptionParser LLM parsing (async parallel processing)
   */
  captionParserBatchSize: number;

  /**
   * Batch size for CaptionValidator LLM validation (async parallel processing)
   */
  captionValidatorBatchSize: number;

  /**
   * Maximum retry count (default: 3)
   */
  maxRetries?: number;

  /**
   * Enable fallback retry mechanism - automatically retries with fallback model on failure (default: true)
   * Set to false to disable automatic fallback retry and fail immediately on component-specific model errors
   */
  enableFallbackRetry?: boolean;

  /**
   * Abort signal for cancellation support.
   * When aborted, processing stops at the next checkpoint between stages.
   */
  abortSignal?: AbortSignal;
}

/**
 * DocumentProcessor
 *
 * Main class that converts DoclingDocument to ProcessedDocument.
 *
 * ## Conversion Process
 *
 * 1. Initialize RefResolver - indexing for $ref resolution
 * 2. Initialize IdGenerator - unique ID generator
 * 3. Text filtering and PageRangeMap generation (visionModel)
 * 4. TOC extraction (model) - core step
 * 5. Parallel processing block:
 *    - Images conversion (caption extraction)
 *    - Tables conversion (excluding TOC tables)
 * 6. Chapters conversion (based on TOC)
 * 7. Assemble ProcessedDocument
 *
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 * import { anthropic } from '@ai-sdk/anthropic';
 * import { DocumentProcessor } from '@heripo/document-processor';
 * import { getLogger } from '@heripo/logger';
 *
 * const logger = getLogger();
 *
 * // Basic usage - all components use the fallback model
 * const processor = new DocumentProcessor({
 *   logger,
 *   fallbackModel: anthropic('claude-opus-4-5-20251101'), // Frontier model for reliable fallback
 * });
 *
 * // Advanced usage - component-specific models with frontier fallback
 * const advancedProcessor = new DocumentProcessor({
 *   logger,
 *   fallbackModel: anthropic('claude-opus-4-5-20251101'), // Frontier model for fallback
 *   pageRangeParserModel: openai('gpt-5.2'), // Vision-capable
 *   tocExtractorModel: openai('gpt-5-mini'), // Structured output
 *   validatorModel: openai('gpt-5.2'), // Validation (TOC + caption)
 *   visionTocExtractorModel: openai('gpt-5.1'), // Vision-capable
 *   captionParserModel: openai('gpt-5-mini'),
 *   textCleanerBatchSize: 20,      // Sync text processing
 *   captionParserBatchSize: 10,    // LLM caption parsing
 *   captionValidatorBatchSize: 10, // LLM caption validation
 *   maxRetries: 3,
 * });
 *
 * const result = await processor.process(
 *   doclingDoc,
 *   'report-001',
 *   outputPath
 * );
 * ```
 */
export class DocumentProcessor {
  private readonly logger: LoggerMethods;
  private readonly fallbackModel: LanguageModel;
  private readonly pageRangeParserModel: LanguageModel;
  private readonly tocExtractorModel: LanguageModel;
  private readonly validatorModel: LanguageModel;
  private readonly visionTocExtractorModel: LanguageModel;
  private readonly captionParserModel: LanguageModel;
  private readonly textCleanerBatchSize: number;
  private readonly captionParserBatchSize: number;
  private readonly captionValidatorBatchSize: number;
  private readonly maxRetries: number;
  private readonly enableFallbackRetry: boolean;
  private readonly abortSignal?: AbortSignal;
  private idGenerator = new IdGenerator();
  private refResolver?: RefResolver;
  private pageRangeParser?: PageRangeParser;
  private tocFinder?: TocFinder;
  private tocExtractor?: TocExtractor;
  private tocContentValidator?: TocContentValidator;
  private captionValidator?: CaptionValidator;
  private visionTocExtractor?: VisionTocExtractor;
  private captionParser?: CaptionParser;
  private chapterConverter?: ChapterConverter;
  private textCleaner = TextCleaner;
  private readonly usageAggregator = new LLMTokenUsageAggregator();

  constructor(options: DocumentProcessorOptions) {
    this.logger = options.logger;
    this.fallbackModel = options.fallbackModel;
    this.pageRangeParserModel =
      options.pageRangeParserModel ?? options.fallbackModel;
    this.tocExtractorModel = options.tocExtractorModel ?? options.fallbackModel;
    this.validatorModel = options.validatorModel ?? options.fallbackModel;
    this.visionTocExtractorModel =
      options.visionTocExtractorModel ?? options.fallbackModel;
    this.captionParserModel =
      options.captionParserModel ?? options.fallbackModel;
    this.textCleanerBatchSize = options.textCleanerBatchSize;
    this.captionParserBatchSize = options.captionParserBatchSize;
    this.captionValidatorBatchSize = options.captionValidatorBatchSize;
    this.maxRetries = options.maxRetries ?? 3;
    this.enableFallbackRetry = options.enableFallbackRetry ?? false;
    this.abortSignal = options.abortSignal;
  }

  /**
   * Check if abort has been requested and throw error if so
   *
   * @throws {Error} with name 'AbortError' if aborted
   */
  private checkAborted(): void {
    if (this.abortSignal?.aborted) {
      const error = new Error('Document processing was aborted');
      error.name = 'AbortError';
      throw error;
    }
  }

  /**
   * Converts DoclingDocument to ProcessedDocument with token usage tracking.
   *
   * Conversion process:
   * 1. Initialize processors and resolvers
   * 2. Normalize and filter texts
   * 3. Clean texts and parse page ranges (parallel)
   * 4. Extract table of contents
   * 5. Convert images and tables (parallel)
   * 6. Convert chapters and link resources
   * 7. Assemble final ProcessedDocument
   * 8. Collect and report token usage
   *
   * @param doclingDoc - Original document extracted from Docling SDK
   * @param reportId - Report unique identifier
   * @param outputPath - Path containing images and pages subdirectories (images/image_0.png, pages/page_0.png, etc.)
   * @returns Document processing result with ProcessedDocument and token usage report
   *
   * @throws {TocExtractError} When TOC extraction fails
   * @throws {PageRangeParseError} When page range parsing fails
   * @throws {ConversionError} When error occurs during conversion
   */
  async process(
    doclingDoc: DoclingDocument,
    reportId: string,
    outputPath: string,
  ): Promise<DocumentProcessResult> {
    this.logger.info('[DocumentProcessor] Starting document processing...');
    this.logger.info('[DocumentProcessor] Report ID:', reportId);

    // Reset token usage aggregator for new processing run
    this.usageAggregator.reset();

    // Check abort before starting
    this.checkAborted();

    this.initializeProcessors(doclingDoc, outputPath);

    const startTimeFilter = Date.now();
    const filtered = this.normalizeAndFilterTexts(doclingDoc);
    const filteringTime = Date.now() - startTimeFilter;
    this.logger.info(
      `[DocumentProcessor] Text filtering took ${filteringTime}ms`,
    );

    // Check abort after text filtering
    this.checkAborted();

    const startTimePageRange = Date.now();
    const pageRangeMap = await this.parsePageRanges(doclingDoc);
    const pageRangeTime = Date.now() - startTimePageRange;
    this.logger.info(
      `[DocumentProcessor] Page range parsing took ${pageRangeTime}ms`,
    );

    // Check abort after page range parsing
    this.checkAborted();

    const startTimeToc = Date.now();
    const tocEntries = await this.extractTableOfContents(doclingDoc, filtered);
    const tocTime = Date.now() - startTimeToc;
    this.logger.info(`[DocumentProcessor] TOC extraction took ${tocTime}ms`);

    // Check abort after TOC extraction
    this.checkAborted();

    const startTimeResources = Date.now();
    const { images, tables, footnotes } = await this.convertResources(
      doclingDoc,
      outputPath,
    );
    const resourcesTime = Date.now() - startTimeResources;
    this.logger.info(
      `[DocumentProcessor] Resource conversion took ${resourcesTime}ms`,
    );

    // Check abort after resource conversion
    this.checkAborted();

    const startTimeChapters = Date.now();
    const chapters = await this.convertChapters(
      doclingDoc,
      tocEntries,
      pageRangeMap,
      images,
      tables,
      footnotes,
    );
    const chaptersTime = Date.now() - startTimeChapters;
    this.logger.info(
      `[DocumentProcessor] Chapter conversion took ${chaptersTime}ms`,
    );

    const startTimeAssemble = Date.now();
    const processedDoc = this.assembleProcessedDocument(
      reportId,
      pageRangeMap,
      chapters,
      images,
      tables,
      footnotes,
    );
    const assembleTime = Date.now() - startTimeAssemble;
    this.logger.info(
      `[DocumentProcessor] Document assembly took ${assembleTime}ms`,
    );

    this.logger.info('[DocumentProcessor] Document processing completed');

    return {
      document: processedDoc,
      usage: this.usageAggregator.getReport(),
    };
  }

  /**
   * Initialize all processors and resolvers
   *
   * Sets up RefResolver, PageRangeParser, TocFinder, and TocExtractor
   */
  private initializeProcessors(
    doclingDoc: DoclingDocument,
    outputPath: string,
  ): void {
    this.logger.info('[DocumentProcessor] Initializing processors...');

    this.logger.info('[DocumentProcessor] - RefResolver');
    this.refResolver = new RefResolver(this.logger, doclingDoc);

    this.logger.info('[DocumentProcessor] - PageRangeParser');
    this.pageRangeParser = new PageRangeParser(
      this.logger,
      this.pageRangeParserModel,
      outputPath,
      this.maxRetries,
      this.enableFallbackRetry ? this.fallbackModel : undefined,
      this.usageAggregator,
      this.abortSignal,
    );

    this.logger.info('[DocumentProcessor] - TocFinder');
    this.tocFinder = new TocFinder(this.logger, this.refResolver);

    this.logger.info('[DocumentProcessor] - TocExtractor');
    this.tocExtractor = new TocExtractor(
      this.logger,
      this.tocExtractorModel,
      {
        maxRetries: this.maxRetries,
      },
      this.enableFallbackRetry ? this.fallbackModel : undefined,
      this.abortSignal,
    );

    this.logger.info('[DocumentProcessor] - TocContentValidator');
    this.tocContentValidator = new TocContentValidator(
      this.logger,
      this.validatorModel,
      { maxRetries: this.maxRetries, abortSignal: this.abortSignal },
      this.enableFallbackRetry ? this.fallbackModel : undefined,
      this.usageAggregator,
    );

    this.logger.info('[DocumentProcessor] - CaptionValidator');
    this.captionValidator = new CaptionValidator(
      this.logger,
      this.validatorModel,
      { maxRetries: this.maxRetries, abortSignal: this.abortSignal },
      this.enableFallbackRetry ? this.fallbackModel : undefined,
      this.usageAggregator,
    );

    this.logger.info('[DocumentProcessor] - VisionTocExtractor');
    this.visionTocExtractor = new VisionTocExtractor(
      this.logger,
      this.visionTocExtractorModel,
      outputPath,
      { maxRetries: this.maxRetries, abortSignal: this.abortSignal },
      this.enableFallbackRetry ? this.fallbackModel : undefined,
      this.usageAggregator,
    );

    this.logger.info('[DocumentProcessor] - CaptionParser');
    this.captionParser = new CaptionParser(
      this.logger,
      this.captionParserModel,
      { maxRetries: this.maxRetries, abortSignal: this.abortSignal },
      this.enableFallbackRetry ? this.fallbackModel : undefined,
      this.usageAggregator,
    );

    this.logger.info('[DocumentProcessor] - ChapterConverter');
    this.chapterConverter = new ChapterConverter(this.logger, this.idGenerator);

    this.logger.info('[DocumentProcessor] All processors initialized');
  }

  /**
   * Normalize and filter texts using TextCleaner
   *
   * Performs basic text normalization (unicode, whitespace, punctuation)
   * and filters out invalid texts (empty, numbers-only, etc.)
   */
  private normalizeAndFilterTexts(doclingDoc: DoclingDocument): string[] {
    this.logger.info('[DocumentProcessor] Normalizing and filtering texts...');

    const texts = doclingDoc.texts.map((text) => text.text);
    const filtered = this.textCleaner.normalizeAndFilterBatch(
      texts,
      this.textCleanerBatchSize,
    );

    this.logger.info(
      `[DocumentProcessor] Filtered ${filtered.length} texts from ${texts.length} original texts`,
    );

    return filtered;
  }

  /**
   * Parse page ranges using Vision LLM
   *
   * Extracts actual page numbers from page images and creates mapping.
   * Token usage is automatically tracked by PageRangeParser into the shared aggregator.
   */
  private async parsePageRanges(
    doclingDoc: DoclingDocument,
  ): Promise<Record<number, PageRange>> {
    this.logger.info('[DocumentProcessor] Starting page range parsing...');

    const result = await this.pageRangeParser!.parse(doclingDoc);

    const pageRangeMap = result.pageRangeMap;

    this.logger.info(
      `[DocumentProcessor] Page range map entries: ${Object.keys(pageRangeMap).length}`,
    );

    return pageRangeMap;
  }

  /**
   * Convert images, tables, and footnotes
   *
   * Runs conversions:
   * - Images conversion (with caption extraction)
   * - Tables conversion (with caption extraction, excluding TOC tables)
   * - Footnotes conversion (synchronous, from text items with label='footnote')
   */
  private async convertResources(
    doclingDoc: DoclingDocument,
    outputPath: string,
  ): Promise<{
    images: ProcessedImage[];
    tables: ProcessedTable[];
    footnotes: ProcessedFootnote[];
  }> {
    this.logger.info(
      '[DocumentProcessor] Converting images, tables, and footnotes...',
    );

    const [images, tables] = await Promise.all([
      this.convertImages(doclingDoc, outputPath),
      this.convertTables(doclingDoc),
    ]);

    const footnotes = this.convertFootnotes(doclingDoc);

    this.logger.info(
      `[DocumentProcessor] Converted ${images.length} images, ${tables.length} tables, and ${footnotes.length} footnotes`,
    );

    return { images, tables, footnotes };
  }

  /**
   * Convert footnotes
   *
   * Extracts footnotes from DoclingDocument text items with label='footnote'
   */
  private convertFootnotes(doclingDoc: DoclingDocument): ProcessedFootnote[] {
    const footnoteItems = doclingDoc.texts.filter(
      (item) => item.label === 'footnote',
    );
    this.logger.info(
      `[DocumentProcessor] Converting ${footnoteItems.length} footnotes...`,
    );

    const footnotes: ProcessedFootnote[] = [];

    for (const item of footnoteItems) {
      if (!this.textCleaner.isValidText(item.text)) {
        continue;
      }

      const pdfPageNo = item.prov?.[0]?.page_no ?? 1;
      const footnoteId = this.idGenerator.generateFootnoteId();

      footnotes.push({
        id: footnoteId,
        text: this.textCleaner.normalize(item.text),
        pdfPageNo,
      });
    }

    this.logger.info(
      `[DocumentProcessor] Converted ${footnotes.length} valid footnotes`,
    );

    return footnotes;
  }

  /**
   * Assemble the final ProcessedDocument
   *
   * Creates the ProcessedDocument structure with all converted components
   */
  private assembleProcessedDocument(
    reportId: string,
    pageRangeMap: Record<number, PageRange>,
    chapters: Chapter[],
    images: ProcessedImage[],
    tables: ProcessedTable[],
    footnotes: ProcessedFootnote[],
  ): ProcessedDocument {
    this.logger.info('[DocumentProcessor] Assembling ProcessedDocument...');

    const processedDoc: ProcessedDocument = {
      reportId,
      pageRangeMap,
      chapters,
      images,
      tables,
      footnotes,
    };

    this.logger.info(
      `[DocumentProcessor] Assembled document with ${chapters.length} chapters, ${images.length} images, ${tables.length} tables, ${footnotes.length} footnotes`,
    );

    return processedDoc;
  }

  /**
   * Extract table of contents (TOC)
   *
   * Uses rule-based extraction with LLM validation and vision fallback:
   * 1. TocFinder - find TOC area in document (rule-based)
   * 2. MarkdownConverter - convert TOC items to Markdown
   * 3. TocContentValidator - validate if content is actually a TOC (LLM)
   * 4. If invalid: VisionTocExtractor - extract from page images (vision LLM fallback)
   * 5. TocExtractor - LLM-based structured extraction
   */
  private async extractTableOfContents(
    doclingDoc: DoclingDocument,
    _filteredTexts: string[],
  ): Promise<TocEntry[]> {
    this.logger.info('[DocumentProcessor] Extracting TOC...');

    let markdown: string | null = null;

    // Stage 1: Try rule-based extraction
    try {
      const tocArea = this.tocFinder!.find(doclingDoc);
      this.logger.info(
        `[DocumentProcessor] Found TOC area: pages ${tocArea.startPage}-${tocArea.endPage}`,
      );

      // Stage 2: Convert to Markdown
      markdown = MarkdownConverter.convert(tocArea.itemRefs, this.refResolver!);
      this.logger.info(
        `[DocumentProcessor] Converted TOC to Markdown (${markdown.length} chars)`,
      );

      // Stage 3: Validate with LLM
      const validation = await this.tocContentValidator!.validate(markdown);
      if (!this.tocContentValidator!.isValid(validation)) {
        this.logger.warn(
          `[DocumentProcessor] TOC validation failed: ${validation.reason}`,
        );
        markdown = null;
      } else {
        this.logger.info(
          `[DocumentProcessor] TOC validation passed (confidence: ${validation.confidence})`,
        );
      }
    } catch (error) {
      if (error instanceof TocNotFoundError) {
        this.logger.info(
          '[DocumentProcessor] Rule-based TOC not found, will try vision fallback',
        );
      } else {
        throw error;
      }
    }

    // Stage 4: Vision fallback if needed
    if (!markdown) {
      this.logger.info('[DocumentProcessor] Using vision fallback for TOC');
      const totalPages = Object.keys(doclingDoc.pages).length;
      markdown = await this.visionTocExtractor!.extract(totalPages);

      if (!markdown) {
        this.logger.warn(
          '[DocumentProcessor] TOC not found in any method, returning empty',
        );
        return [];
      }

      this.logger.info(
        `[DocumentProcessor] Vision extracted TOC markdown (${markdown.length} chars)`,
      );
    }

    // Stage 5: Extract structure with LLM (with fallback retry)
    const tocResult = await this.tocExtractor!.extract(markdown);

    // Track token usage
    this.usageAggregator.track(tocResult.usage);

    this.logger.info(
      `[DocumentProcessor] Extracted ${tocResult.entries.length} top-level TOC entries`,
    );

    return tocResult.entries;
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
  private async processResourceCaptions(
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
        ? await this.captionParser!.parseBatch(
            validCaptionTexts,
            this.captionParserBatchSize,
          )
        : [];

    // Handle length mismatch between parsed results and valid captions
    let finalValidCaptionData = validCaptionData;
    let finalParsedCaptions = parsedCaptions;

    if (parsedCaptions.length !== validCaptionData.length) {
      this.logger.warn(
        `[DocumentProcessor] Caption parsing length mismatch for ${resourceType}: ` +
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
            `[DocumentProcessor] Skipping ${resourceType} caption at index ${item.resourceIndex}: "${item.text}" (not found in parsed results)`,
          );
        }
      }

      // Re-map parsedCaptions to match the filtered data
      const recoveredCaptions: Caption[] = [];
      for (const item of recoveredData) {
        const caption = parsedMap.get(item.text);
        if (caption) {
          recoveredCaptions.push(caption);
        }
      }

      /* c8 ignore start - defensive guard: recoveredData only contains items where parsedMap.has() returned true */
      if (recoveredCaptions.length !== recoveredData.length) {
        throw new Error(
          `[DocumentProcessor] Failed to recover from length mismatch: ` +
            `recovered ${recoveredCaptions.length} captions for ${recoveredData.length} valid items`,
        );
      }
      /* c8 ignore stop */

      finalValidCaptionData = recoveredData;
      finalParsedCaptions = recoveredCaptions;

      this.logger.info(
        `[DocumentProcessor] Successfully recovered ${finalParsedCaptions.length} ${resourceType} captions after length mismatch`,
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
      const validationResults = await this.captionValidator!.validateBatch(
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
            `[DocumentProcessor] Invalid ${resourceType} caption [${resourceIndex}]: "${originalText}" | parsed num="${parsedNum}"`,
          );
        }

        // Reparse failed captions with fallback model if enabled
        if (this.enableFallbackRetry) {
          this.logger.info(
            `[DocumentProcessor] Reparsing ${failedIndices.length} failed ${resourceType} captions with fallback model...`,
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
          for (let i = 0; i < failedIndices.length; i++) {
            const filteredIndex = failedIndices[i];
            const resourceIndex =
              finalValidCaptionData[filteredIndex].resourceIndex;
            captionsByIndex.set(resourceIndex, reparsedCaptions[i]);
          }

          this.logger.info(
            `[DocumentProcessor] Reparsed ${reparsedCaptions.length} ${resourceType} captions`,
          );
        } else {
          this.logger.warn(
            `[DocumentProcessor] ${failedIndices.length} ${resourceType} captions failed validation (kept as-is, fallback retry disabled)`,
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
  private extractCaptionText(
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

  /**
   * Convert images
   *
   * Converts pictures from DoclingDocument to ProcessedImage
   */
  private async convertImages(
    doclingDoc: DoclingDocument,
    outputPath: string,
  ): Promise<ProcessedImage[]> {
    this.logger.info(
      `[DocumentProcessor] Converting ${doclingDoc.pictures.length} images...`,
    );

    const images: ProcessedImage[] = [];
    const captionTexts: Array<string | undefined> = [];

    // Step 1: Collect image data and caption texts
    for (const picture of doclingDoc.pictures) {
      const pdfPageNo = picture.prov?.[0]?.page_no ?? 0;
      const imageId =
        this.idGenerator?.generateImageId() ?? `img-${images.length + 1}`;

      const captionText = this.extractCaptionText(picture.captions);
      captionTexts.push(captionText);

      images.push({
        id: imageId,
        path: `${outputPath}/images/image_${images.length}.png`,
        pdfPageNo,
        // caption will be assigned later
      });
    }

    // Step 2: Process captions
    const captionsByIndex = await this.processResourceCaptions(
      captionTexts,
      'image',
    );

    // Step 3: Assign parsed captions to images
    for (let i = 0; i < images.length; i++) {
      if (captionsByIndex.has(i)) {
        images[i].caption = captionsByIndex.get(i);
      }
    }

    return images;
  }

  /**
   * Convert tables
   *
   * Converts tables from DoclingDocument to ProcessedTable
   */
  private async convertTables(
    doclingDoc: DoclingDocument,
  ): Promise<ProcessedTable[]> {
    this.logger.info(
      `[DocumentProcessor] Converting ${doclingDoc.tables.length} tables...`,
    );

    const tables: ProcessedTable[] = [];
    const captionTexts: Array<string | undefined> = [];

    // Step 1: Collect table data and caption texts
    for (const table of doclingDoc.tables) {
      const pdfPageNo = table.prov?.[0]?.page_no ?? 0;
      const tableId =
        this.idGenerator?.generateTableId() ?? `tbl-${tables.length + 1}`;

      // Convert table cells
      const grid: ProcessedTableCell[][] = table.data.grid.map((row) =>
        row.map((cell) => ({
          text: cell.text,
          rowSpan: cell.row_span ?? 1,
          colSpan: cell.col_span ?? 1,
          isHeader: cell.column_header || cell.row_header || false,
        })),
      );

      const captionText = this.extractCaptionText(table.captions);
      captionTexts.push(captionText);

      tables.push({
        id: tableId,
        pdfPageNo,
        numRows: grid.length,
        numCols: grid[0]?.length ?? 0,
        grid,
        // caption will be assigned later
      });
    }

    // Step 2: Process captions
    const captionsByIndex = await this.processResourceCaptions(
      captionTexts,
      'table',
    );

    // Step 3: Assign parsed captions to tables
    for (let i = 0; i < tables.length; i++) {
      if (captionsByIndex.has(i)) {
        tables[i].caption = captionsByIndex.get(i);
      }
    }

    return tables;
  }

  /**
   * Convert chapters and link resources
   *
   * Generates chapters based on TOC and links images/tables/footnotes using ChapterConverter.
   * Falls back to single "Document" chapter when TOC is empty.
   */
  private async convertChapters(
    doclingDoc: DoclingDocument,
    tocEntries: TocEntry[],
    pageRangeMap: Record<number, PageRange>,
    images: ProcessedImage[],
    tables: ProcessedTable[],
    footnotes: ProcessedFootnote[],
  ): Promise<Chapter[]> {
    this.logger.info('[DocumentProcessor] Converting chapters...');

    // Handle empty TOC case - create fallback chapter
    if (tocEntries.length === 0) {
      this.logger.info(
        '[DocumentProcessor] No TOC entries, creating fallback chapter',
      );
      return this.createFallbackChapter(
        doclingDoc,
        pageRangeMap,
        images,
        tables,
        footnotes,
      );
    }

    // Use ChapterConverter for TOC-based conversion
    const chapters = this.chapterConverter!.convert(
      tocEntries,
      doclingDoc.texts,
      pageRangeMap,
      images,
      tables,
      footnotes,
    );

    this.logger.info(
      `[DocumentProcessor] Converted ${chapters.length} top-level chapters`,
    );

    return chapters;
  }

  /**
   * Create a fallback chapter when TOC is not available
   *
   * Creates a single "Document" chapter containing all text blocks,
   * images, tables, and footnotes from the document.
   */
  private createFallbackChapter(
    doclingDoc: DoclingDocument,
    pageRangeMap: Record<number, PageRange>,
    images: ProcessedImage[],
    tables: ProcessedTable[],
    footnotes: ProcessedFootnote[],
  ): Chapter[] {
    // Convert text items to text blocks (excluding footnotes - they are handled separately)
    const textBlocks: TextBlock[] = doclingDoc.texts
      .filter(
        (item) =>
          item.label !== 'footnote' && this.textCleaner.isValidText(item.text),
      )
      .map((item) => ({
        text: this.textCleaner.normalize(item.text),
        pdfPageNo: item.prov?.[0]?.page_no ?? 1,
      }));

    // Return empty if no content
    if (
      textBlocks.length === 0 &&
      images.length === 0 &&
      tables.length === 0 &&
      footnotes.length === 0
    ) {
      this.logger.info(
        '[DocumentProcessor] No content found for fallback chapter',
      );
      return [];
    }

    // Determine the first page number from pageRangeMap
    const firstPdfPage = Math.min(
      ...Object.keys(pageRangeMap)
        .map(Number)
        .filter((n) => !isNaN(n)),
      1,
    );
    const firstPageRange = pageRangeMap[firstPdfPage];
    const pageNo = firstPageRange?.startPageNo ?? 1;

    const fallbackChapter: Chapter = {
      id: this.idGenerator.generateChapterId(),
      originTitle: 'Document',
      title: 'Document',
      pageNo,
      level: 1,
      textBlocks,
      imageIds: images.map((img) => img.id),
      tableIds: tables.map((tbl) => tbl.id),
      footnoteIds: footnotes.map((ftn) => ftn.id),
      children: [],
    };

    this.logger.info(
      `[DocumentProcessor] Created fallback chapter with ${textBlocks.length} text blocks, ` +
        `${images.length} images, ${tables.length} tables, ${footnotes.length} footnotes`,
    );

    return [fallbackChapter];
  }
}
