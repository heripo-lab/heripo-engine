import type { LoggerMethods } from '@heripo/logger';
import type {
  Chapter,
  DoclingDocument,
  DocumentProcessResult,
  PageRange,
  ProcessedDocument,
  ProcessedFootnote,
  ProcessedImage,
  ProcessedTable,
  TokenUsageReport,
} from '@heripo/model';
import type { LanguageModel } from 'ai';

import type { TocEntry } from './types';

import { LLMTokenUsageAggregator } from '@heripo/shared';

import { ChapterConverter, ResourceConverter } from './converters';
import {
  TocExtractor,
  TocFinder,
  TocNotFoundError,
  VisionTocExtractor,
} from './extractors';
import { CaptionParser, PageRangeParser } from './parsers';
import { CaptionProcessingPipeline, TocExtractionPipeline } from './pipelines';
import { IdGenerator, RefResolver, TextCleaner } from './utils';
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
   * This is the only required model. Should be set to a frontier model (e.g., Claude Opus 4.6, GPT-5.2)
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
   * Enable fallback retry mechanism - automatically retries with fallback model on failure (default: false)
   * Set to true to enable automatic fallback retry with fallback model on component-specific model errors
   */
  enableFallbackRetry?: boolean;

  /**
   * Abort signal for cancellation support.
   * When aborted, processing stops at the next checkpoint between stages.
   */
  abortSignal?: AbortSignal;

  /**
   * Callback fired after each major processing phase completes.
   * Receives the current cumulative token usage report.
   * Useful for real-time token usage monitoring during processing.
   */
  onTokenUsage?: (report: TokenUsageReport) => void;
}

/**
 * Per-document processing inputs.
 */
export interface DocumentProcessorProcessOptions {
  /**
   * Precomputed PDF page number to actual document page range mapping.
   * When provided, automatic PageRangeParser execution is skipped.
   */
  pageRangeMap?: Record<number, PageRange>;
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
 *   artifactDir
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
  private readonly onTokenUsage?: (report: TokenUsageReport) => void;
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
  private resourceConverter?: ResourceConverter;
  private tocExtractionPipeline?: TocExtractionPipeline;
  private captionProcessingPipeline?: CaptionProcessingPipeline;
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
    this.onTokenUsage = options.onTokenUsage;
  }

  /**
   * Emit current token usage report via callback
   *
   * Calls the onTokenUsage callback with the current cumulative report
   * from the usage aggregator. Safe to call even if no callback is set.
   */
  private emitTokenUsage(): void {
    this.onTokenUsage?.(this.usageAggregator.getReport() as TokenUsageReport);
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
   * 3. Clean texts and resolve page ranges
   * 4. Extract table of contents
   * 5. Convert images and tables (parallel)
   * 6. Convert chapters and link resources
   * 7. Assemble final ProcessedDocument
   * 8. Collect and report token usage
   *
   * @param doclingDoc - Original document extracted from Docling SDK
   * @param reportId - Report unique identifier
   * @param artifactDir - Directory containing parser artifacts such as images/, pages/, and result.json
   * @param processOptions - Per-document processing inputs such as manually verified page range mappings
   * @returns Document processing result with ProcessedDocument and token usage report
   *
   * @throws {TocExtractError} When TOC extraction fails
   * @throws {PageRangeParseError} When page range parsing fails
   * @throws {ConversionError} When error occurs during conversion
   */
  async process(
    doclingDoc: DoclingDocument,
    reportId: string,
    artifactDir: string,
    processOptions: DocumentProcessorProcessOptions = {},
  ): Promise<DocumentProcessResult> {
    this.logger.info('[DocumentProcessor] Starting document processing...');
    this.logger.info('[DocumentProcessor] Report ID:', reportId);

    // Reset token usage aggregator for new processing run
    this.usageAggregator.reset();

    // Check abort before starting
    this.checkAborted();

    this.initializeProcessors(doclingDoc, artifactDir);

    const startTimeFilter = Date.now();
    const filtered = this.normalizeAndFilterTexts(doclingDoc);
    const filteringTime = Date.now() - startTimeFilter;
    this.logger.info(
      `[DocumentProcessor] Text filtering took ${filteringTime}ms`,
    );

    // Check abort after text filtering
    this.checkAborted();

    const startTimePageRange = Date.now();
    const pageRangeMap =
      processOptions.pageRangeMap !== undefined
        ? processOptions.pageRangeMap
        : await this.parsePageRanges(doclingDoc);

    if (processOptions.pageRangeMap !== undefined) {
      this.logger.info(
        `[DocumentProcessor] Using injected page range map with ${Object.keys(pageRangeMap).length} entries`,
      );
    }

    const pageRangeTime = Date.now() - startTimePageRange;
    this.logger.info(
      `[DocumentProcessor] Page range resolution took ${pageRangeTime}ms`,
    );
    this.emitTokenUsage();

    // Check abort after page range parsing
    this.checkAborted();

    const startTimeToc = Date.now();
    const tocEntries = await this.tocExtractionPipeline!.extract(
      doclingDoc,
      filtered,
    );
    const tocTime = Date.now() - startTimeToc;
    this.logger.info(`[DocumentProcessor] TOC extraction took ${tocTime}ms`);
    this.emitTokenUsage();

    // Check abort after TOC extraction
    this.checkAborted();

    const startTimeResources = Date.now();
    const { images, tables, footnotes } =
      await this.resourceConverter!.convertAll(doclingDoc, artifactDir);
    const resourcesTime = Date.now() - startTimeResources;
    this.logger.info(
      `[DocumentProcessor] Resource conversion took ${resourcesTime}ms`,
    );
    this.emitTokenUsage();

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
    artifactDir: string,
  ): void {
    this.logger.info('[DocumentProcessor] Initializing processors...');

    this.logger.info('[DocumentProcessor] - RefResolver');
    this.refResolver = new RefResolver(this.logger, doclingDoc);

    this.logger.info('[DocumentProcessor] - PageRangeParser');
    this.pageRangeParser = new PageRangeParser(
      this.logger,
      this.pageRangeParserModel,
      artifactDir,
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
      artifactDir,
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

    this.logger.info('[DocumentProcessor] - TocExtractionPipeline');
    this.tocExtractionPipeline = new TocExtractionPipeline({
      logger: this.logger,
      tocFinder: this.tocFinder!,
      tocExtractor: this.tocExtractor!,
      tocContentValidator: this.tocContentValidator!,
      visionTocExtractor: this.visionTocExtractor!,
      refResolver: this.refResolver!,
      usageAggregator: this.usageAggregator,
    });

    this.logger.info('[DocumentProcessor] - CaptionProcessingPipeline');
    this.captionProcessingPipeline = new CaptionProcessingPipeline({
      logger: this.logger,
      captionParser: this.captionParser!,
      captionValidator: this.captionValidator!,
      refResolver: this.refResolver,
      fallbackModel: this.fallbackModel,
      enableFallbackRetry: this.enableFallbackRetry,
      maxRetries: this.maxRetries,
      captionParserBatchSize: this.captionParserBatchSize,
      captionValidatorBatchSize: this.captionValidatorBatchSize,
      usageAggregator: this.usageAggregator,
      abortSignal: this.abortSignal,
    });

    this.logger.info('[DocumentProcessor] - ResourceConverter');
    this.resourceConverter = new ResourceConverter(
      this.logger,
      this.idGenerator,
      this.captionProcessingPipeline!,
    );

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
    const filtered = TextCleaner.normalizeAndFilterBatch(
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
   * Convert chapters and link resources
   *
   * Generates chapters based on TOC and links images/tables/footnotes using ChapterConverter.
   * Throws TocNotFoundError if TOC entries are empty (defensive assertion).
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

    // Defensive assertion - TOC entries should always be present at this point
    if (tocEntries.length === 0) {
      const reason = 'Cannot convert chapters without TOC entries';
      this.logger.error(`[DocumentProcessor] ${reason}`);
      throw new TocNotFoundError(reason);
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
}
