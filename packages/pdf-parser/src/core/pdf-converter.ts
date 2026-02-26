import type { LoggerMethods } from '@heripo/logger';
import type { OcrStrategy, TokenUsageReport } from '@heripo/model';
import type { LanguageModel } from 'ai';
import type {
  AsyncConversionTask,
  ConversionOptions,
  DoclingAPIClient,
} from 'docling-sdk';

import { LLMTokenUsageAggregator } from '@heripo/shared';
import { omit } from 'es-toolkit';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { PDF_CONVERTER } from '../config/constants';
import { ImagePdfFallbackError } from '../errors/image-pdf-fallback-error';
import { ImageExtractor } from '../processors/image-extractor';
import { PageRenderer } from '../processors/page-renderer';
import { PdfTextExtractor } from '../processors/pdf-text-extractor';
import { VlmTextCorrector } from '../processors/vlm-text-corrector';
import { OcrStrategySampler } from '../samplers/ocr-strategy-sampler';
import { LocalFileServer } from '../utils/local-file-server';
import { ImagePdfConverter } from './image-pdf-converter';

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
};

/** Result of strategy-based conversion */
export interface ConvertWithStrategyResult {
  /** The OCR strategy that was determined */
  strategy: OcrStrategy;
  /** Token usage report from sampling and/or VLM processing (null when no LLM usage occurs) */
  tokenUsageReport: TokenUsageReport | null;
}

export class PDFConverter {
  constructor(
    private readonly logger: LoggerMethods,
    private readonly client: DoclingAPIClient,
    private readonly enableImagePdfFallback: boolean = false,
    private readonly timeout: number = PDF_CONVERTER.DEFAULT_TIMEOUT_MS,
  ) {}

  async convert(
    url: string,
    reportId: string,
    onComplete: ConversionCompleteCallback,
    cleanupAfterCallback: boolean,
    options: PDFConvertOptions,
    abortSignal?: AbortSignal,
  ): Promise<TokenUsageReport | null> {
    this.logger.info('[PDFConverter] Converting:', url);

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

    // Step 1: Determine OCR strategy
    const strategy = await this.determineStrategy(
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
      await this.convertWithVlm(
        pdfPath,
        reportId,
        onComplete,
        cleanupAfterCallback,
        trackedOptions,
        abortSignal,
        strategy.detectedLanguages,
      );
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
   * Determine the OCR strategy based on options and page sampling.
   *
   * When sampling is possible (strategySamplerModel + local file), it always
   * runs — even with forcedMethod — so that detectedLanguages are available
   * for OCR engine configuration. The forced method simply overrides the
   * sampled method choice.
   */
  private async determineStrategy(
    pdfPath: string | null,
    reportId: string,
    options: PDFConvertOptions,
    abortSignal?: AbortSignal,
  ): Promise<OcrStrategy> {
    // Cannot sample: skip, no sampler model, or non-local URL
    if (options.skipSampling || !options.strategySamplerModel || !pdfPath) {
      const method = options.forcedMethod ?? 'ocrmac';
      const reason = options.forcedMethod
        ? `Forced: ${options.forcedMethod}`
        : !pdfPath
          ? 'Non-local URL, sampling skipped'
          : 'Sampling skipped';
      return { method, reason, sampledPages: 0, totalPages: 0 };
    }

    // Sample pages to determine strategy (also detects languages)
    const samplingDir = join(process.cwd(), 'output', reportId, '_sampling');
    const sampler = new OcrStrategySampler(
      this.logger,
      new PageRenderer(this.logger),
      new PdfTextExtractor(this.logger),
    );

    try {
      const strategy = await sampler.sample(
        pdfPath,
        samplingDir,
        options.strategySamplerModel,
        {
          aggregator: options.aggregator,
          abortSignal,
        },
      );

      // Override method when forced, preserving detected languages from sampling
      if (options.forcedMethod) {
        return {
          ...strategy,
          method: options.forcedMethod,
          reason: `Forced: ${options.forcedMethod} (${strategy.reason})`,
        };
      }

      return strategy;
    } finally {
      // Always clean up sampling temp directory
      if (existsSync(samplingDir)) {
        rmSync(samplingDir, { recursive: true, force: true });
      }
    }
  }

  /**
   * Execute VLM-enhanced PDF conversion.
   *
   * Runs the standard OCR pipeline (Docling) first, then applies VLM text
   * correction to fix garbled Chinese characters (漢字/Hanja) in OCR output.
   */
  private async convertWithVlm(
    pdfPath: string | null,
    reportId: string,
    onComplete: ConversionCompleteCallback,
    cleanupAfterCallback: boolean,
    options: PDFConvertOptions,
    abortSignal?: AbortSignal,
    detectedLanguages?: string[],
  ): Promise<void> {
    if (!options.vlmProcessorModel) {
      throw new Error('vlmProcessorModel is required when OCR strategy is VLM');
    }
    if (!pdfPath) {
      throw new Error('VLM conversion requires a local file (file:// URL)');
    }

    const url = `file://${pdfPath}`;

    // Wrap the original callback with VLM text correction
    const wrappedCallback: ConversionCompleteCallback = async (outputDir) => {
      // Pre-extract text from PDF text layer for VLM reference
      let pageTexts: Map<number, string> | undefined;
      try {
        const resultPath = join(outputDir, 'result.json');
        const doc = JSON.parse(readFileSync(resultPath, 'utf-8'));
        const totalPages = Object.keys(doc.pages).length;
        const textExtractor = new PdfTextExtractor(this.logger);
        pageTexts = await textExtractor.extractText(pdfPath, totalPages);
      } catch {
        this.logger.warn(
          '[PDFConverter] pdftotext extraction failed, proceeding without text reference',
        );
      }

      // Save OCR-only result before VLM correction for debugging
      const resultPath = join(outputDir, 'result.json');
      const ocrOriginPath = join(outputDir, 'result_ocr_origin.json');
      copyFileSync(resultPath, ocrOriginPath);

      const corrector = new VlmTextCorrector(this.logger);
      await corrector.correctAndSave(outputDir, options.vlmProcessorModel!, {
        concurrency: options.vlmConcurrency,
        aggregator: options.aggregator,
        abortSignal,
        onTokenUsage: options.onTokenUsage,
        documentLanguages: detectedLanguages,
        pageTexts,
      });
      await onComplete(outputDir);
    };

    // Run the standard OCR pipeline, then apply VLM correction via the wrapped callback
    const vlmOptions: PDFConvertOptions = detectedLanguages
      ? { ...options, ocr_lang: detectedLanguages }
      : options;
    await this.convert(
      url,
      reportId,
      wrappedCallback,
      cleanupAfterCallback,
      vlmOptions,
      abortSignal,
    );

    this.logger.info('[PDFConverter] VLM conversion completed successfully');
  }

  /**
   * Convert by first creating an image PDF, then running the conversion.
   * Used when forceImagePdf option is enabled.
   */
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
    const imagePdfConverter = new ImagePdfConverter(this.logger);
    let imagePdfPath: string | null = null;

    try {
      imagePdfPath = await imagePdfConverter.convert(url, reportId);
      const localUrl = `file://${imagePdfPath}`;
      this.logger.info(
        '[PDFConverter] Image PDF ready, starting conversion:',
        localUrl,
      );

      return await this.performConversion(
        localUrl,
        reportId,
        onComplete,
        cleanupAfterCallback,
        options,
        abortSignal,
      );
    } finally {
      if (imagePdfPath) {
        imagePdfConverter.cleanup(imagePdfPath);
      }
    }
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
    let originalError: Error | null = null;

    try {
      return await this.performConversion(
        url,
        reportId,
        onComplete,
        cleanupAfterCallback,
        options,
        abortSignal,
      );
    } catch (error) {
      // If aborted, don't try fallback - re-throw immediately
      if (abortSignal?.aborted) {
        throw error;
      }

      originalError = error as Error;
      this.logger.error('[PDFConverter] Conversion failed:', error);

      if (!this.enableImagePdfFallback) {
        throw error;
      }
    }

    // Fallback: Convert to image PDF and retry
    this.logger.info('[PDFConverter] Attempting image PDF fallback...');
    const imagePdfConverter = new ImagePdfConverter(this.logger);
    let imagePdfPath: string | null = null;

    try {
      imagePdfPath = await imagePdfConverter.convert(url, reportId);

      // Use file:// URL for local file
      const localUrl = `file://${imagePdfPath}`;
      this.logger.info('[PDFConverter] Retrying with image PDF:', localUrl);

      const report = await this.performConversion(
        localUrl,
        reportId,
        onComplete,
        cleanupAfterCallback,
        options,
        abortSignal,
      );

      this.logger.info('[PDFConverter] Fallback conversion succeeded');
      return report;
    } catch (fallbackError) {
      this.logger.error(
        '[PDFConverter] Fallback conversion also failed:',
        fallbackError,
      );
      throw new ImagePdfFallbackError(originalError!, fallbackError as Error);
    } finally {
      // Cleanup temp image PDF
      if (imagePdfPath) {
        imagePdfConverter.cleanup(imagePdfPath);
      }
    }
  }

  private async performConversion(
    url: string,
    reportId: string,
    onComplete: ConversionCompleteCallback,
    cleanupAfterCallback: boolean,
    options: PDFConvertOptions,
    abortSignal?: AbortSignal,
  ): Promise<TokenUsageReport | null> {
    const startTime = Date.now();
    const conversionOptions = this.buildConversionOptions(options);

    this.logger.info(
      `[PDFConverter] OCR languages: ${JSON.stringify(conversionOptions.ocr_options?.lang)}`,
    );
    this.logger.info(
      '[PDFConverter] Converting document with Async Source API...',
    );
    this.logger.info('[PDFConverter] Server will download from URL directly');
    this.logger.info(
      '[PDFConverter] Results will be returned as ZIP to avoid memory limits',
    );

    // Resolve URL (start local server for file:// URLs)
    const { httpUrl, server } = await this.resolveUrl(url);

    try {
      const task = await this.startConversionTask(httpUrl, conversionOptions);
      await this.trackTaskProgress(task);

      // Check abort after docling task completes
      if (abortSignal?.aborted) {
        this.logger.info(
          '[PDFConverter] Conversion aborted after docling completion',
        );
        const error = new Error('PDF conversion was aborted');
        error.name = 'AbortError';
        throw error;
      }

      await this.downloadResult(task.taskId);
    } finally {
      // Stop local file server if started
      if (server) {
        this.logger.info('[PDFConverter] Stopping local file server...');
        await server.stop();
      }
    }

    const cwd = process.cwd();
    const zipPath = join(cwd, 'result.zip');
    const extractDir = join(cwd, 'result_extracted');
    const outputDir = join(cwd, 'output', reportId);

    try {
      await this.processConvertedFiles(zipPath, extractDir, outputDir);

      // Check abort before callback
      if (abortSignal?.aborted) {
        this.logger.info('[PDFConverter] Conversion aborted before callback');
        const error = new Error('PDF conversion was aborted');
        error.name = 'AbortError';
        throw error;
      }

      // Execute callback with absolute output path
      this.logger.info('[PDFConverter] Executing completion callback...');
      await onComplete(outputDir);

      const duration = Date.now() - startTime;
      this.logger.info('[PDFConverter] Conversion completed successfully!');
      this.logger.info('[PDFConverter] Total time:', duration, 'ms');
    } finally {
      // Clean up temporary files (always cleanup temp files)
      this.logger.info('[PDFConverter] Cleaning up temporary files...');
      if (existsSync(zipPath)) {
        rmSync(zipPath, { force: true });
      }
      if (existsSync(extractDir)) {
        rmSync(extractDir, { recursive: true, force: true });
      }

      // Cleanup output directory only if requested
      if (cleanupAfterCallback) {
        this.logger.info(
          '[PDFConverter] Cleaning up output directory:',
          outputDir,
        );
        if (existsSync(outputDir)) {
          rmSync(outputDir, { recursive: true, force: true });
        }
      } else {
        this.logger.info('[PDFConverter] Output preserved at:', outputDir);
      }
    }

    return null;
  }

  private buildConversionOptions(
    options: PDFConvertOptions,
  ): ConversionOptions {
    return {
      ...omit(options, [
        'num_threads',
        'forceImagePdf',
        'strategySamplerModel',
        'vlmProcessorModel',
        'skipSampling',
        'forcedMethod',
        'aggregator',
        'onTokenUsage',
      ]),
      to_formats: ['json', 'html'],
      image_export_mode: 'embedded',
      ocr_engine: 'ocrmac',
      ocr_options: {
        kind: 'ocrmac',
        lang: options.ocr_lang ?? ['ko-KR', 'en-US'],
        recognition: 'accurate',
        framework: 'livetext',
      },
      generate_picture_images: true,
      images_scale: 2.0,
      /**
       * While disabling this option yields the most accurate text extraction for readable PDFs,
       * text layers overlaid on images or drawings can introduce noise when not merged properly.
       * In practice, archaeological report PDFs almost always contain such overlapping cases.
       * Enabling force_ocr mitigates this risk. Although OCR may introduce minor errors compared
       * to direct text extraction, the accuracy remains high since the source is digital, not scanned paper.
       */
      force_ocr: true,
      accelerator_options: {
        device: 'mps',
        num_threads: options.num_threads,
      },
    };
  }

  private async startConversionTask(
    url: string,
    conversionOptions: ConversionOptions,
  ): Promise<AsyncConversionTask> {
    const task = await this.client.convertSourceAsync({
      sources: [
        {
          kind: 'http',
          url,
        },
      ],
      options: conversionOptions,
      target: {
        kind: 'zip',
      },
    });

    this.logger.info(`[PDFConverter] Task created: ${task.taskId}`);
    this.logger.info('[PDFConverter] Polling for progress...');

    return task;
  }

  /**
   * Start a local file server for file:// URLs
   *
   * @param url URL to check (file:// or http://)
   * @returns Object with httpUrl and optional server to stop later
   */
  private async resolveUrl(
    url: string,
  ): Promise<{ httpUrl: string; server?: LocalFileServer }> {
    if (url.startsWith('file://')) {
      const filePath = url.slice(7); // Remove 'file://' prefix
      const server = new LocalFileServer();
      const httpUrl = await server.start(filePath);

      this.logger.info('[PDFConverter] Started local file server:', httpUrl);

      return { httpUrl, server };
    }

    return { httpUrl: url };
  }

  private async trackTaskProgress(task: AsyncConversionTask): Promise<void> {
    const conversionStartTime = Date.now();
    let lastProgressLine = '';

    const logProgress = (status: {
      task_status: string;
      task_position?: number;
      task_meta?: { total_documents?: number; processed_documents?: number };
    }) => {
      const parts: string[] = [`Status: ${status.task_status}`];

      if (status.task_position !== undefined) {
        parts.push(`position: ${status.task_position}`);
      }

      const meta = status.task_meta;
      if (meta) {
        if (
          meta.processed_documents !== undefined &&
          meta.total_documents !== undefined
        ) {
          parts.push(
            `progress: ${meta.processed_documents}/${meta.total_documents}`,
          );
        }
      }

      const progressLine = `\r[PDFConverter] ${parts.join(' | ')}`;
      if (progressLine !== lastProgressLine) {
        lastProgressLine = progressLine;
        process.stdout.write(progressLine);
      }
    };

    while (true) {
      if (Date.now() - conversionStartTime > this.timeout) {
        throw new Error('Task timeout');
      }

      const status = await task.poll();

      logProgress(status);

      if (status.task_status === 'success') {
        this.logger.info('\n[PDFConverter] Conversion completed!');
        return;
      }

      if (status.task_status === 'failure') {
        // Try to get detailed error info from the task result
        const errorDetails = await this.getTaskFailureDetails(task);
        const elapsed = Math.round((Date.now() - conversionStartTime) / 1000);
        this.logger.error(
          `\n[PDFConverter] Task failed after ${elapsed}s: ${errorDetails}`,
        );
        throw new Error(`Task failed: ${errorDetails}`);
      }

      await new Promise((resolve) =>
        setTimeout(resolve, PDF_CONVERTER.POLL_INTERVAL_MS),
      );
    }
  }

  /**
   * Fetch detailed error information from a failed task result.
   */
  private async getTaskFailureDetails(
    task: AsyncConversionTask,
  ): Promise<string> {
    try {
      const result = await task.getResult();
      if (result.errors?.length) {
        return result.errors
          .map((e: { message: string }) => e.message)
          .join('; ');
      }
      /* v8 ignore start -- status is always present in ConvertDocumentResponse */
      return `status: ${result.status ?? 'unknown'}`;
      /* v8 ignore stop */
    } catch (err) {
      this.logger.error('[PDFConverter] Failed to retrieve task result:', err);
      return 'unable to retrieve error details';
    }
  }

  private async downloadResult(taskId: string): Promise<void> {
    this.logger.info(
      '\n[PDFConverter] Task completed, downloading ZIP file...',
    );

    const zipResult = await this.client.getTaskResultFile(taskId);

    if (!zipResult.success || !zipResult.fileStream) {
      throw new Error('Failed to get ZIP file result');
    }

    const zipPath = join(process.cwd(), 'result.zip');

    this.logger.info('[PDFConverter] Saving ZIP file to:', zipPath);
    const writeStream = createWriteStream(zipPath);
    await pipeline(zipResult.fileStream, writeStream);
  }

  private async processConvertedFiles(
    zipPath: string,
    extractDir: string,
    outputDir: string,
  ): Promise<void> {
    // Extract and save documents with images
    await ImageExtractor.extractAndSaveDocumentsFromZip(
      this.logger,
      zipPath,
      extractDir,
      outputDir,
    );
  }
}
