import type { LoggerMethods } from '@heripo/logger';
import type {
  AsyncConversionTask,
  ConversionOptions,
  DoclingAPIClient,
} from 'docling-sdk';

import type {
  ConversionCompleteCallback,
  PDFConvertOptions,
} from './pdf-converter';

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { ImageExtractor } from '../processors/image-extractor';
import { downloadTaskResult } from '../utils/docling-result-downloader';
import { LocalFileServer } from '../utils/local-file-server';
import { renderAndUpdatePageImages } from '../utils/page-image-updater';
import { trackTaskProgress } from '../utils/task-progress-tracker';
import { buildConversionOptions } from './conversion-options-builder';

/**
 * Executes a single-pass Docling conversion: task -> poll -> download -> extract -> render.
 */
export class DoclingConversionExecutor {
  constructor(
    private readonly logger: LoggerMethods,
    private readonly client: DoclingAPIClient,
    private readonly timeout: number,
  ) {}

  /**
   * Execute a full Docling conversion pipeline.
   *
   * Steps: resolve URL -> start task -> poll progress -> download result ->
   * extract files -> render page images -> invoke callback -> cleanup.
   */
  async execute(
    url: string,
    reportId: string,
    onComplete: ConversionCompleteCallback,
    cleanupAfterCallback: boolean,
    options: PDFConvertOptions,
    abortSignal?: AbortSignal,
  ): Promise<null> {
    const startTime = Date.now();
    const conversionOptions = buildConversionOptions(options);

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
      await trackTaskProgress(
        task,
        this.timeout,
        this.logger,
        '[PDFConverter]',
        {
          showDetailedProgress: true,
        },
      );

      // Check abort after docling task completes
      if (abortSignal?.aborted) {
        this.logger.info(
          '[PDFConverter] Conversion aborted after docling completion',
        );
        const error = new Error('PDF conversion was aborted');
        error.name = 'AbortError';
        throw error;
      }

      const cwd = process.cwd();
      const zipPath = join(cwd, 'result.zip');
      await downloadTaskResult(
        this.client,
        task.taskId,
        zipPath,
        this.logger,
        '[PDFConverter]',
      );
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

      // Render page images using ImageMagick (replaces Docling's page image generation)
      if (url.startsWith('file://')) {
        await renderAndUpdatePageImages(
          url.slice(7),
          outputDir,
          this.logger,
          '[PDFConverter]',
        );
      } else {
        this.logger.warn(
          '[PDFConverter] Page image rendering skipped: only supported for local files (file:// URLs)',
        );
      }

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

  /**
   * Start a local file server for file:// URLs.
   *
   * @param url URL to check (file:// or http://)
   * @returns Object with httpUrl and optional server to stop later
   */
  async resolveUrl(
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

  /**
   * Start an async conversion task on the Docling server.
   */
  async startConversionTask(
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
   * Extract converted documents from ZIP and save to output directory.
   */
  private async processConvertedFiles(
    zipPath: string,
    extractDir: string,
    outputDir: string,
  ): Promise<void> {
    await ImageExtractor.extractAndSaveDocumentsFromZip(
      this.logger,
      zipPath,
      extractDir,
      outputDir,
    );
  }
}
