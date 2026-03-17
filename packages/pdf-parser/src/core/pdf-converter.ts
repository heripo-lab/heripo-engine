import type { LoggerMethods } from '@heripo/logger';
import type { OcrStrategy, TokenUsageReport } from '@heripo/model';
import type { LanguageModel } from 'ai';
import type { ConversionOptions, DoclingAPIClient } from 'docling-sdk';

import { LLMTokenUsageAggregator } from '@heripo/shared';

import { CHUNKED_CONVERSION, PDF_CONVERTER } from '../config/constants';
import { ImagePdfFallbackError } from '../errors/image-pdf-fallback-error';
import { PdfTextExtractor } from '../processors/pdf-text-extractor';
import { DocumentTypeValidator } from '../validators/document-type-validator';
import { ChunkedPDFConverter } from './chunked-pdf-converter';
import { DoclingConversionExecutor } from './docling-conversion-executor';
import { ImagePdfConverter } from './image-pdf-converter';
import { StrategyResolver } from './strategy-resolver';
import { VlmConversionPipeline } from './vlm-conversion-pipeline';

/**
 * Callback function invoked after PDF conversion completes
 * @param outputPath Absolute path to the output directory containing result files
 */
export type ConversionCompleteCallback = (
  outputPath: string,
) => Promise<void> | void;

/**
 * Extended options for PDF conversion.
 */
export type PDFConvertOptions = Omit<
  ConversionOptions,
  | 'to_formats'
  | 'image_export_mode'
  | 'ocr_engine'
  | 'accelerator_options'
  | 'ocr_options'
  | 'generate_picture_images'
  | 'generate_page_images'
  | 'images_scale'
  | 'force_ocr'
  | 'pipeline'
  | 'vlm_pipeline_model_local'
  | 'vlm_pipeline_model_api'
> & {
  num_threads?: number;
  /**
   * Force pre-conversion to image-based PDF before processing.
   * Requires ImageMagick and Ghostscript.
   */
  forceImagePdf?: boolean;
  /** Vision model for OCR strategy sampling (enables new strategy-based flow) */
  strategySamplerModel?: LanguageModel;
  /** Vision model for VLM page processing (required when strategy selects VLM) */
  vlmProcessorModel?: LanguageModel;
  /** Concurrency for VLM page processing (default: 1) */
  vlmConcurrency?: number;
  /** Skip sampling and default to ocrmac */
  skipSampling?: boolean;
  /** Force a specific OCR method, bypassing sampling */
  forcedMethod?: 'ocrmac' | 'vlm';
  /** Token usage aggregator for tracking across sampling and VLM processing */
  aggregator?: LLMTokenUsageAggregator;
  /** Callback fired after each batch of VLM pages completes, with cumulative token usage */
  onTokenUsage?: (report: TokenUsageReport) => void;
  /** Document processing timeout in seconds for the Docling server (default: server default) */
  document_timeout?: number;
  /** Enable chunked conversion for large PDFs (local files only) */
  chunkedConversion?: boolean;
  /** Pages per chunk (default: CHUNKED_CONVERSION.DEFAULT_CHUNK_SIZE) */
  chunkSize?: number;
  /** Max retry attempts per failed chunk (default: CHUNKED_CONVERSION.DEFAULT_MAX_RETRIES) */
  chunkMaxRetries?: number;
  /** LLM model for document type validation (opt-in: skipped when not set) */
  documentValidationModel?: LanguageModel;
};

/** Result of strategy-based conversion */
export interface ConvertWithStrategyResult {
  /** The OCR strategy that was determined */
  strategy: OcrStrategy;
  /** Token usage report from sampling and/or VLM processing (null when no LLM usage occurs) */
  tokenUsageReport: TokenUsageReport | null;
}

export class PDFConverter {
  private documentTypeValidated = false;

  constructor(
    private readonly logger: LoggerMethods,
    private readonly client: DoclingAPIClient,
    private readonly enableImagePdfFallback: boolean = false,
    private readonly timeout: number = PDF_CONVERTER.DEFAULT_TIMEOUT_MS,
  ) {}

  /**
   * Validate that the PDF is a Korean archaeological investigation report.
   * Skipped when no documentValidationModel is configured or for non-local URLs.
   * Only runs once per converter instance (flag prevents duplicate checks on recursive calls).
   */
  private async validateDocumentType(
    url: string,
    options: PDFConvertOptions,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    if (this.documentTypeValidated) return;
    this.documentTypeValidated = true;

    if (!options.documentValidationModel) return;

    const pdfPath = url.startsWith('file://') ? url.slice(7) : null;
    if (!pdfPath) return;

    const textExtractor = new PdfTextExtractor(this.logger);
    const validator = new DocumentTypeValidator(textExtractor);
    await validator.validate(pdfPath, options.documentValidationModel, {
      abortSignal,
    });
  }

  async convert(
    url: string,
    reportId: string,
    onComplete: ConversionCompleteCallback,
    cleanupAfterCallback: boolean,
    options: PDFConvertOptions,
    abortSignal?: AbortSignal,
  ): Promise<TokenUsageReport | null> {
    this.logger.info('[PDFConverter] Converting:', url);

    // Validate document type before processing
    await this.validateDocumentType(url, options, abortSignal);

    // Chunked conversion for large local PDFs
    if (options.chunkedConversion && url.startsWith('file://')) {
      const chunked = new ChunkedPDFConverter(
        this.logger,
        this.client,
        {
          chunkSize: options.chunkSize ?? CHUNKED_CONVERSION.DEFAULT_CHUNK_SIZE,
          maxRetries:
            options.chunkMaxRetries ?? CHUNKED_CONVERSION.DEFAULT_MAX_RETRIES,
        },
        this.timeout,
      );
      return chunked.convertChunked(
        url,
        reportId,
        onComplete,
        cleanupAfterCallback,
        options,
        abortSignal,
      );
    }

    // Force image PDF pre-conversion when explicitly requested
    if (options.forceImagePdf) {
      return this.convertViaImagePdf(
        url,
        reportId,
        onComplete,
        cleanupAfterCallback,
        options,
        abortSignal,
      );
    }

    // Standard pipeline: direct conversion with optional image PDF fallback
    return this.convertWithFallback(
      url,
      reportId,
      onComplete,
      cleanupAfterCallback,
      options,
      abortSignal,
    );
  }

  /**
   * Convert a PDF using OCR strategy sampling to decide between ocrmac and VLM.
   *
   * Flow:
   * 1. Determine strategy (forced, skipped, or sampled via VLM)
   * 2. If VLM → OCR pipeline + VlmTextCorrector (text correction)
   * 3. If ocrmac → existing Docling conversion
   *
   * @returns ConvertWithStrategyResult with the chosen strategy and token report
   */
  async convertWithStrategy(
    url: string,
    reportId: string,
    onComplete: ConversionCompleteCallback,
    cleanupAfterCallback: boolean,
    options: PDFConvertOptions,
    abortSignal?: AbortSignal,
  ): Promise<ConvertWithStrategyResult> {
    this.logger.info('[PDFConverter] Starting strategy-based conversion:', url);

    // Create an internal aggregator if none was provided so that
    // sampling + VLM processing token usage is always captured.
    const aggregator = options.aggregator ?? new LLMTokenUsageAggregator();
    const trackedOptions: PDFConvertOptions = { ...options, aggregator };

    const pdfPath = url.startsWith('file://') ? url.slice(7) : null;

    // Validate document type before processing
    await this.validateDocumentType(url, trackedOptions, abortSignal);

    // Step 1: Determine OCR strategy
    const strategyResolver = new StrategyResolver(this.logger);
    const strategy = await strategyResolver.resolve(
      pdfPath,
      reportId,
      trackedOptions,
      abortSignal,
    );
    this.logger.info(
      `[PDFConverter] OCR strategy: ${strategy.method} (${strategy.reason})`,
    );

    // Emit token usage after sampling phase (so frontend sees sampling cost immediately)
    if (trackedOptions.onTokenUsage) {
      const samplingReport = this.buildTokenReport(aggregator);
      if (samplingReport) {
        trackedOptions.onTokenUsage(samplingReport);
      }
    }

    // Step 2: Execute conversion based on strategy
    if (strategy.method === 'vlm') {
      if (!pdfPath) {
        throw new Error('VLM conversion requires a local file (file:// URL)');
      }

      const pipeline = new VlmConversionPipeline(this.logger);
      const wrappedCallback = pipeline.wrapCallback(
        pdfPath,
        trackedOptions,
        onComplete,
        abortSignal,
        strategy.detectedLanguages,
        strategy.koreanHanjaMixPages,
      );

      const vlmOptions: PDFConvertOptions = strategy.detectedLanguages
        ? { ...trackedOptions, ocr_lang: strategy.detectedLanguages }
        : trackedOptions;
      await this.convert(
        url,
        reportId,
        wrappedCallback,
        cleanupAfterCallback,
        vlmOptions,
        abortSignal,
      );

      this.logger.info('[PDFConverter] VLM conversion completed successfully');
      return {
        strategy,
        tokenUsageReport: this.buildTokenReport(aggregator),
      };
    }

    // ocrmac path: delegate to existing Docling conversion
    const ocrmacOptions: PDFConvertOptions = strategy.detectedLanguages
      ? { ...trackedOptions, ocr_lang: strategy.detectedLanguages }
      : trackedOptions;
    await this.convert(
      url,
      reportId,
      onComplete,
      cleanupAfterCallback,
      ocrmacOptions,
      abortSignal,
    );
    return {
      strategy,
      tokenUsageReport: this.buildTokenReport(aggregator),
    };
  }

  /**
   * Build a token usage report from the aggregator.
   * Returns null when no LLM calls were tracked (e.g. forced ocrmac without sampling).
   */
  private buildTokenReport(
    aggregator: LLMTokenUsageAggregator,
  ): TokenUsageReport | null {
    const report = aggregator.getReport();
    if (report.components.length === 0) {
      return null;
    }
    return report;
  }

  /**
   * Convert by first creating an image PDF, then running the conversion.
   * Used when forceImagePdf option is enabled.
   */
  /**
   * Execute a conversion using an image PDF, handling cleanup in finally.
   */
  private async withImagePdf(
    url: string,
    reportId: string,
    fn: (localUrl: string) => Promise<TokenUsageReport | null>,
  ): Promise<TokenUsageReport | null> {
    const imagePdfConverter = new ImagePdfConverter(this.logger);
    const imagePdfPath = await imagePdfConverter.convert(url, reportId);
    try {
      const localUrl = `file://${imagePdfPath}`;
      return await fn(localUrl);
    } finally {
      imagePdfConverter.cleanup(imagePdfPath);
    }
  }

  private async convertViaImagePdf(
    url: string,
    reportId: string,
    onComplete: ConversionCompleteCallback,
    cleanupAfterCallback: boolean,
    options: PDFConvertOptions,
    abortSignal?: AbortSignal,
  ): Promise<TokenUsageReport | null> {
    this.logger.info(
      '[PDFConverter] Force image PDF mode: converting to image PDF first...',
    );

    return this.withImagePdf(url, reportId, (localUrl) => {
      this.logger.info(
        '[PDFConverter] Image PDF ready, starting conversion:',
        localUrl,
      );

      const executor = new DoclingConversionExecutor(
        this.logger,
        this.client,
        this.timeout,
      );
      return executor.execute(
        localUrl,
        reportId,
        onComplete,
        cleanupAfterCallback,
        options,
        abortSignal,
      );
    });
  }

  /**
   * Convert directly with optional image PDF fallback on failure.
   * Used by standard (OCR) pipeline.
   */
  private async convertWithFallback(
    url: string,
    reportId: string,
    onComplete: ConversionCompleteCallback,
    cleanupAfterCallback: boolean,
    options: PDFConvertOptions,
    abortSignal?: AbortSignal,
  ): Promise<TokenUsageReport | null> {
    const directResult = await this.tryDirectConversion(
      url,
      reportId,
      onComplete,
      cleanupAfterCallback,
      options,
      abortSignal,
    );

    if (directResult.success) {
      return directResult.report;
    }

    // Fallback: Convert to image PDF and retry
    const originalError = directResult.error;
    this.logger.info('[PDFConverter] Attempting image PDF fallback...');

    try {
      const report = await this.withImagePdf(
        url,
        reportId,
        async (localUrl) => {
          this.logger.info('[PDFConverter] Retrying with image PDF:', localUrl);

          const fallbackExecutor = new DoclingConversionExecutor(
            this.logger,
            this.client,
            this.timeout,
          );
          return fallbackExecutor.execute(
            localUrl,
            reportId,
            onComplete,
            cleanupAfterCallback,
            options,
            abortSignal,
          );
        },
      );

      this.logger.info('[PDFConverter] Fallback conversion succeeded');
      return report;
    } catch (fallbackError) {
      this.logger.error(
        '[PDFConverter] Fallback conversion also failed:',
        fallbackError,
      );
      throw new ImagePdfFallbackError(originalError, fallbackError as Error);
    }
  }

  /**
   * Attempt direct conversion, returning success/failure without throwing.
   */
  private async tryDirectConversion(
    url: string,
    reportId: string,
    onComplete: ConversionCompleteCallback,
    cleanupAfterCallback: boolean,
    options: PDFConvertOptions,
    abortSignal?: AbortSignal,
  ): Promise<
    | { success: true; report: TokenUsageReport | null }
    | { success: false; error: Error }
  > {
    try {
      const executor = new DoclingConversionExecutor(
        this.logger,
        this.client,
        this.timeout,
      );
      const report = await executor.execute(
        url,
        reportId,
        onComplete,
        cleanupAfterCallback,
        options,
        abortSignal,
      );
      return { success: true, report };
    } catch (error) {
      // If aborted, don't try fallback - re-throw immediately
      if (abortSignal?.aborted) {
        throw error;
      }

      this.logger.error('[PDFConverter] Conversion failed:', error);

      if (!this.enableImagePdfFallback) {
        throw error;
      }

      return { success: false, error: error as Error };
    }
  }
}
