import type { LoggerMethods } from '@heripo/logger';
import type {
  AsyncConversionTask,
  ConversionOptions,
  DoclingAPIClient,
  VlmModelLocal,
} from 'docling-sdk';

import { omit } from 'es-toolkit';
import { createWriteStream, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { PDF_CONVERTER } from '../config/constants';
import { DEFAULT_VLM_MODEL, resolveVlmModel } from '../config/vlm-models';
import { ImagePdfFallbackError } from '../errors/image-pdf-fallback-error';
import { ImageExtractor } from '../processors/image-extractor';
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
 * Pipeline type for PDF conversion
 * - 'standard': Use OCR-based pipeline (default, uses ocrmac)
 * - 'vlm': Use Vision Language Model pipeline for better KCJ/complex layout handling
 */
export type PipelineType = 'standard' | 'vlm';

/**
 * Extended options for PDF conversion including pipeline selection
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
> & {
  num_threads?: number;
  pipeline?: PipelineType;
  vlm_model?: string | VlmModelLocal;
};

export class PDFConverter {
  constructor(
    private readonly logger: LoggerMethods,
    private readonly client: DoclingAPIClient,
    private readonly enableImagePdfFallback: boolean = false,
  ) {}

  async convert(
    url: string,
    reportId: string,
    onComplete: ConversionCompleteCallback,
    cleanupAfterCallback: boolean,
    options: PDFConvertOptions,
    abortSignal?: AbortSignal,
  ) {
    this.logger.info('[PDFConverter] Converting:', url);

    let originalError: Error | null = null;

    try {
      await this.performConversion(
        url,
        reportId,
        onComplete,
        cleanupAfterCallback,
        options,
        abortSignal,
      );
      return;
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

      await this.performConversion(
        localUrl,
        reportId,
        onComplete,
        cleanupAfterCallback,
        options,
        abortSignal,
      );

      this.logger.info('[PDFConverter] Fallback conversion succeeded');
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
  ): Promise<void> {
    const startTime = Date.now();
    const pipelineType = options.pipeline ?? 'standard';
    const conversionOptions =
      pipelineType === 'vlm'
        ? this.buildVlmConversionOptions(options)
        : this.buildConversionOptions(options);

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
  }

  private buildConversionOptions(
    options: PDFConvertOptions,
  ): ConversionOptions {
    return {
      ...omit(options, ['num_threads', 'pipeline', 'vlm_model']),
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
   */
  private buildVlmConversionOptions(
    options: PDFConvertOptions,
  ): ConversionOptions {
    const vlmModel = resolveVlmModel(options.vlm_model ?? DEFAULT_VLM_MODEL);

    return {
      ...omit(options, ['num_threads', 'pipeline', 'vlm_model']),
      to_formats: ['json', 'html'],
      image_export_mode: 'embedded',
      pipeline: 'vlm',
      vlm_pipeline_model_local: vlmModel,
      generate_picture_images: true,
      images_scale: 2.0,
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
    let lastStatus = '';
    let isCompleted = false;

    const pollInterval = setInterval(() => {
      if (isCompleted) return;
      const elapsed = Math.floor((Date.now() - conversionStartTime) / 1000);
      process.stdout.write(
        `\r[PDFConverter] Status: ${lastStatus || 'processing'} (${elapsed}s elapsed)`,
      );
    }, PDF_CONVERTER.POLL_INTERVAL_MS);

    task.on('progress', (status) => {
      lastStatus = status.task_status;
      if (status.task_position !== undefined) {
        process.stdout.write(
          `\r[PDFConverter] Status: ${status.task_status} (position: ${status.task_position})`,
        );
      }
    });

    task.on('complete', () => {
      isCompleted = true;
      clearInterval(pollInterval);
      this.logger.info('\n[PDFConverter] Conversion completed!');
    });

    task.on('error', (error) => {
      isCompleted = true;
      clearInterval(pollInterval);
      this.logger.error('\n[PDFConverter] Conversion error:', error.message);
    });

    try {
      await task.waitForCompletion();
    } finally {
      isCompleted = true;
      clearInterval(pollInterval);
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
