import type { LoggerMethods } from '@heripo/logger';
import type { TokenUsageReport } from '@heripo/model';
import type {
  AsyncConversionTask,
  ConversionOptions,
  DoclingAPIClient,
  VlmModelApi,
  VlmModelLocal,
} from 'docling-sdk';

import type { ResolveVlmApiOptions } from '../config/vlm-models';
import type { AccumulatedTokenUsage } from '../utils/vlm-proxy-server';

import { ValidationUtils } from 'docling-sdk';
import { omit } from 'es-toolkit';
import { createWriteStream, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { PDF_CONVERTER } from '../config/constants';
import {
  DEFAULT_VLM_MODEL,
  resolveVlmApiModel,
  resolveVlmModel,
} from '../config/vlm-models';
import { ImagePdfFallbackError } from '../errors/image-pdf-fallback-error';
import { ImageExtractor } from '../processors/image-extractor';
import { LocalFileServer } from '../utils/local-file-server';
import { VlmProxyServer } from '../utils/vlm-proxy-server';
import { ImagePdfConverter } from './image-pdf-converter';

// Workaround for docling-sdk@1.3.6 validation bug:
// ValidationUtils.validateProcessingPipeline() uses a Zod enum ["default","fast","accurate"]
// which doesn't include "vlm", even though the TypeScript ConversionOptions interface allows it.
// This patch strips the `pipeline` field before validation to avoid the false rejection.
// TODO: Remove this patch when docling-sdk fixes ProcessingPipelineSchema to include "vlm".
const _origAssertValidConversionOptions =
  ValidationUtils.assertValidConversionOptions.bind(ValidationUtils);
ValidationUtils.assertValidConversionOptions = (options: unknown) => {
  const { pipeline: _pipeline, ...rest } = options as Record<string, unknown>;
  _origAssertValidConversionOptions(rest);
};

/**
 * Callback function invoked after PDF conversion completes
 * @param outputPath Absolute path to the output directory containing result files
 */
export type ConversionCompleteCallback = (
  outputPath: string,
) => Promise<void> | void;

/**
 * Pipeline type for PDF conversion
 * - 'standard': Use OCR-based pipeline (default, uses ocrmac)
 * - 'vlm': Use Vision Language Model pipeline for better KCJ/complex layout handling
 */
export type PipelineType = 'standard' | 'vlm';

/**
 * Extended options for PDF conversion including pipeline selection.
 *
 * For VLM pipeline, either vlm_model (local) or vlm_api_model (remote API)
 * can be specified. If both are provided, vlm_api_model takes precedence.
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
  pipeline?: PipelineType;
  /** Local VLM model: preset key string or custom VlmModelLocal object */
  vlm_model?: string | VlmModelLocal;
  /** API VLM model: preset key string (e.g., 'openai/gpt-5.2') or custom VlmModelApi object */
  vlm_api_model?: string | VlmModelApi;
  /** Options for resolving API VLM model (API key, timeout overrides, etc.) */
  vlm_api_options?: ResolveVlmApiOptions;
  /**
   * Force pre-conversion to image-based PDF before processing.
   * Works with any pipeline type. Requires ImageMagick and Ghostscript.
   */
  forceImagePdf?: boolean;
};

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
    const pipelineType = options.pipeline ?? 'standard';

    // Set up VLM proxy for API models to capture token usage
    let proxy: VlmProxyServer | null = null;
    let effectiveOptions = options;
    let vlmModelName: string | null = null;

    if (pipelineType === 'vlm' && options.vlm_api_model !== undefined) {
      const realModel = resolveVlmApiModel(
        options.vlm_api_model,
        options.vlm_api_options,
      );
      vlmModelName =
        typeof options.vlm_api_model === 'string'
          ? options.vlm_api_model
          : ((realModel.params?.model as string | undefined) ??
            'custom-vlm-api');
      proxy = new VlmProxyServer(
        this.logger,
        realModel.url,
        realModel.headers?.Authorization ?? '',
      );
      const proxyUrl = await proxy.start();
      effectiveOptions = {
        ...options,
        vlm_api_model: { ...realModel, url: proxyUrl, headers: {} },
      };
    }

    try {
      const conversionOptions =
        pipelineType === 'vlm'
          ? this.buildVlmConversionOptions(effectiveOptions)
          : this.buildConversionOptions(effectiveOptions);

      if (pipelineType === 'vlm') {
        this.logger.info('[PDFConverter] Using VLM pipeline');
      } else {
        this.logger.info(
          `[PDFConverter] OCR languages: ${JSON.stringify(conversionOptions.ocr_options?.lang)}`,
        );
      }
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

      // Build token usage report from proxy if available
      if (proxy) {
        const usage = proxy.getAccumulatedUsage();
        return this.buildVlmTokenUsageReport(vlmModelName!, usage);
      }
      return null;
    } finally {
      if (proxy) {
        await proxy.stop();
      }
    }
  }

  private buildConversionOptions(
    options: PDFConvertOptions,
  ): ConversionOptions {
    return {
      ...omit(options, [
        'num_threads',
        'pipeline',
        'vlm_model',
        'vlm_api_model',
        'vlm_api_options',
        'forceImagePdf',
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

  /**
   * Build conversion options for VLM pipeline.
   *
   * VLM pipeline uses a Vision Language Model instead of traditional OCR,
   * providing better accuracy for KCJ characters and complex layouts.
   *
   * Supports both local models (vlm_model) and remote API models (vlm_api_model).
   * If vlm_api_model is specified, it takes precedence over vlm_model.
   */
  private buildVlmConversionOptions(
    options: PDFConvertOptions,
  ): ConversionOptions {
    const stripped = omit(options, [
      'num_threads',
      'pipeline',
      'vlm_model',
      'vlm_api_model',
      'vlm_api_options',
      'ocr_lang',
      'forceImagePdf',
    ]);

    const baseOptions = {
      ...stripped,
      to_formats: ['json', 'html'],
      image_export_mode: 'embedded',
      pipeline: 'vlm',
      generate_picture_images: true,
      images_scale: 2.0,
      accelerator_options: {
        device: 'mps',
        num_threads: options.num_threads,
      },
    } satisfies ConversionOptions;

    // API VLM model takes precedence over local VLM model
    if (options.vlm_api_model !== undefined) {
      const vlmApiModel = resolveVlmApiModel(
        options.vlm_api_model,
        options.vlm_api_options,
      );
      this.logger.info(
        `[PDFConverter] VLM API model: ${String(vlmApiModel.params?.model ?? vlmApiModel.url)} (format: ${vlmApiModel.response_format})`,
      );
      return {
        ...baseOptions,
        vlm_pipeline_model_api: vlmApiModel,
      };
    }

    // Fall back to local VLM model
    const vlmModel = resolveVlmModel(options.vlm_model ?? DEFAULT_VLM_MODEL);
    this.logger.info(
      `[PDFConverter] VLM model: ${vlmModel.repo_id} (framework: ${vlmModel.inference_framework}, format: ${vlmModel.response_format})`,
    );
    return {
      ...baseOptions,
      vlm_pipeline_model_local: vlmModel,
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

  /**
   * Build a TokenUsageReport from accumulated VLM proxy token usage.
   */
  private buildVlmTokenUsageReport(
    modelName: string,
    usage: AccumulatedTokenUsage,
  ): TokenUsageReport {
    return {
      components: [
        {
          component: 'VlmPipeline',
          phases: [
            {
              phase: 'page-conversion',
              primary: {
                modelName,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalTokens: usage.totalTokens,
              },
              total: {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalTokens: usage.totalTokens,
              },
            },
          ],
          total: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
          },
        },
      ],
      total: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      },
    };
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
