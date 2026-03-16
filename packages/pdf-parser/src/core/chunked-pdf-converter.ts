import type { LoggerMethods } from '@heripo/logger';
import type { DoclingDocument, TokenUsageReport } from '@heripo/model';
import type { ConversionOptions, DoclingAPIClient } from 'docling-sdk';

import type {
  ConversionCompleteCallback,
  PDFConvertOptions,
} from './pdf-converter';

import { spawnAsync } from '@heripo/shared';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PAGE_RENDERING, PDF_CONVERTER } from '../config/constants';
import { DoclingDocumentMerger } from '../processors/docling-document-merger';
import { ImageExtractor } from '../processors/image-extractor';
import { PageRenderer } from '../processors/page-renderer';
import { runJqFileJson, runJqFileToFile } from '../utils/jq';
import { LocalFileServer } from '../utils/local-file-server';
import { getTaskFailureDetails } from '../utils/task-failure-details';

/** Configuration for chunked conversion */
export interface ChunkedConversionConfig {
  chunkSize: number;
  maxRetries: number;
}

/** Page range for a single chunk [start, end] (1-based, inclusive) */
type PageRange = [number, number];

/**
 * Converts large PDFs in chunks using Docling's page_range option.
 *
 * Splits the PDF into fixed-size page ranges, converts each chunk sequentially,
 * then merges the resulting DoclingDocuments into a single output that is
 * indistinguishable from a single-pass conversion.
 */
export class ChunkedPDFConverter {
  constructor(
    private readonly logger: LoggerMethods,
    private readonly client: DoclingAPIClient,
    private readonly config: ChunkedConversionConfig,
    private readonly timeout: number = PDF_CONVERTER.DEFAULT_TIMEOUT_MS,
  ) {}

  /**
   * Convert a local PDF in chunks.
   *
   * @param url - file:// URL to the source PDF
   * @param reportId - Unique report identifier for output directory naming
   * @param onComplete - Callback invoked with the final output directory
   * @param cleanupAfterCallback - Whether to clean up the output directory after callback
   * @param options - PDF conversion options (chunked-specific fields are stripped internally)
   * @param buildConversionOptions - Function to build Docling ConversionOptions from PDFConvertOptions
   * @param abortSignal - Optional abort signal for cancellation
   */
  async convertChunked(
    url: string,
    reportId: string,
    onComplete: ConversionCompleteCallback,
    cleanupAfterCallback: boolean,
    options: PDFConvertOptions,
    buildConversionOptions: (options: PDFConvertOptions) => ConversionOptions,
    abortSignal?: AbortSignal,
  ): Promise<TokenUsageReport | null> {
    const pdfPath = url.slice(7); // Remove 'file://' prefix
    const cwd = process.cwd();
    const outputDir = join(cwd, 'output', reportId);
    const chunksBaseDir = join(cwd, 'output', reportId, '_chunks');

    // Step 1: Get total page count
    const totalPages = await this.getPageCount(pdfPath);
    if (totalPages === 0) {
      throw new Error(
        '[ChunkedPDFConverter] Failed to detect page count from PDF',
      );
    }

    // Step 2: Calculate chunk ranges
    const chunks = this.calculateChunks(totalPages);
    this.logger.info(
      `[ChunkedPDFConverter] Starting: ${totalPages} pages → ${chunks.length} chunks of ${this.config.chunkSize}`,
    );

    // Step 3: Start local file server (once for all chunks)
    const server = new LocalFileServer();
    const httpUrl = await server.start(pdfPath);
    this.logger.info(
      '[ChunkedPDFConverter] Started local file server:',
      httpUrl,
    );

    const chunkDocuments: DoclingDocument[] = [];

    try {
      // Step 4: Process each chunk sequentially
      for (let i = 0; i < chunks.length; i++) {
        this.checkAbort(abortSignal);

        const [start, end] = chunks[i];
        const chunkDir = join(chunksBaseDir, `_chunk_${i}`);
        mkdirSync(chunkDir, { recursive: true });

        const doc = await this.convertChunk(
          i,
          chunks.length,
          start,
          end,
          httpUrl,
          chunkDir,
          options,
          buildConversionOptions,
        );

        chunkDocuments.push(doc);
      }
    } finally {
      // Always stop the local file server
      this.logger.info('[ChunkedPDFConverter] Stopping local file server...');
      await server.stop();
    }

    this.checkAbort(abortSignal);

    // Step 5: Merge all chunk documents
    this.logger.info(
      `[ChunkedPDFConverter] All ${chunks.length} chunks completed, merging...`,
    );
    const merger = new DoclingDocumentMerger();
    const picFileOffsets = this.buildPicFileOffsets(
      chunksBaseDir,
      chunks.length,
    );
    const merged = merger.merge(chunkDocuments, picFileOffsets);

    this.logger.info(
      `[ChunkedPDFConverter] Merged: ${merged.texts.length} texts, ${merged.pictures.length} pictures, ${merged.tables.length} tables, ${Object.keys(merged.pages).length} pages`,
    );

    // Step 6: Build final output directory
    mkdirSync(outputDir, { recursive: true });
    const imagesDir = join(outputDir, 'images');
    mkdirSync(imagesDir, { recursive: true });

    // Relocate images from chunk directories with global indexing
    this.relocateImages(chunksBaseDir, chunks.length, imagesDir);

    // Save merged result.json
    const resultPath = join(outputDir, 'result.json');
    writeFileSync(resultPath, JSON.stringify(merged));

    try {
      // Step 7: Render page images (ImageMagick, same as non-chunked)
      await this.renderPageImages(pdfPath, outputDir);

      // Step 7.5: Clean up orphaned pic_ files
      this.cleanupOrphanedPicFiles(resultPath, imagesDir);

      this.checkAbort(abortSignal);

      // Step 8: Execute completion callback
      this.logger.info(
        '[ChunkedPDFConverter] Executing completion callback...',
      );
      await onComplete(outputDir);
    } finally {
      // Step 9: Cleanup (always runs)
      if (existsSync(chunksBaseDir)) {
        rmSync(chunksBaseDir, { recursive: true, force: true });
      }

      if (cleanupAfterCallback) {
        this.logger.info(
          '[ChunkedPDFConverter] Cleaning up output directory:',
          outputDir,
        );
        if (existsSync(outputDir)) {
          rmSync(outputDir, { recursive: true, force: true });
        }
      } else {
        this.logger.info(
          '[ChunkedPDFConverter] Output preserved at:',
          outputDir,
        );
      }
    }

    return null;
  }

  /**
   * Convert a single chunk with retry logic.
   */
  private async convertChunk(
    chunkIndex: number,
    totalChunks: number,
    startPage: number,
    endPage: number,
    httpUrl: string,
    chunkDir: string,
    options: PDFConvertOptions,
    buildConversionOptions: (options: PDFConvertOptions) => ConversionOptions,
  ): Promise<DoclingDocument> {
    const chunkLabel = `Chunk ${chunkIndex + 1}/${totalChunks} (pages ${startPage}-${endPage})`;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.logger.info(
            `[ChunkedPDFConverter] ${chunkLabel}: retrying (${attempt}/${this.config.maxRetries})...`,
          );
        } else {
          this.logger.info(
            `[ChunkedPDFConverter] ${chunkLabel}: converting...`,
          );
        }

        const startTime = Date.now();

        // Build conversion options with page_range
        const conversionOptions = buildConversionOptions({
          ...options,
          page_range: [startPage, endPage],
        });

        // Start conversion task
        const task = await this.client.convertSourceAsync({
          sources: [{ kind: 'http', url: httpUrl }],
          options: conversionOptions,
          target: { kind: 'zip' },
        });

        // Poll until completion
        await this.trackTaskProgress(task);

        // Download ZIP result
        const zipPath = join(chunkDir, 'result.zip');
        await this.downloadResult(task.taskId, zipPath);

        // Extract ZIP and process images
        const extractDir = join(chunkDir, 'extracted');
        const chunkOutputDir = join(chunkDir, 'output');
        await ImageExtractor.extractAndSaveDocumentsFromZip(
          this.logger,
          zipPath,
          extractDir,
          chunkOutputDir,
        );

        // Parse result.json into a DoclingDocument object
        const resultJsonPath = join(chunkOutputDir, 'result.json');
        const doc = await runJqFileJson<DoclingDocument>('.', resultJsonPath);

        // Cleanup chunk temp files (ZIP + extracted)
        if (existsSync(zipPath)) rmSync(zipPath, { force: true });
        if (existsSync(extractDir)) {
          rmSync(extractDir, { recursive: true, force: true });
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        if (attempt > 0) {
          this.logger.info(
            `[ChunkedPDFConverter] ${chunkLabel}: completed on retry ${attempt} (${elapsed}s)`,
          );
        } else {
          this.logger.info(
            `[ChunkedPDFConverter] ${chunkLabel}: completed (${elapsed}s)`,
          );
        }

        return doc;
      } catch (error) {
        if (attempt >= this.config.maxRetries) {
          this.logger.error(
            `[ChunkedPDFConverter] ${chunkLabel}: failed after ${this.config.maxRetries} retries`,
          );
          throw error;
        }
        this.logger.warn(
          `[ChunkedPDFConverter] ${chunkLabel}: failed, retrying (${attempt + 1}/${this.config.maxRetries})...`,
        );
      }
    }

    /* v8 ignore start -- unreachable: loop always returns or throws */
    throw new Error('Unreachable');
    /* v8 ignore stop */
  }

  /** Calculate page ranges for chunks */
  calculateChunks(totalPages: number): PageRange[] {
    if (this.config.chunkSize <= 0) {
      throw new Error('[ChunkedPDFConverter] chunkSize must be positive');
    }

    const ranges: PageRange[] = [];
    for (let start = 1; start <= totalPages; start += this.config.chunkSize) {
      const end = Math.min(start + this.config.chunkSize - 1, totalPages);
      ranges.push([start, end]);
    }
    return ranges;
  }

  /** Get total page count using pdfinfo */
  private async getPageCount(pdfPath: string): Promise<number> {
    const result = await spawnAsync('pdfinfo', [pdfPath]);
    if (result.code !== 0) {
      return 0;
    }
    const match = result.stdout.match(/^Pages:\s+(\d+)/m);
    return match ? parseInt(match[1], 10) : 0;
  }

  /** Poll task progress until completion */
  private async trackTaskProgress(task: {
    taskId: string;
    poll: () => Promise<{ task_status: string }>;
    getResult: () => Promise<{
      errors?: { message: string }[];
      status?: string;
    }>;
  }): Promise<void> {
    const startTime = Date.now();

    while (true) {
      if (Date.now() - startTime > this.timeout) {
        throw new Error('[ChunkedPDFConverter] Chunk task timeout');
      }

      const status = await task.poll();

      if (status.task_status === 'success') return;

      if (status.task_status === 'failure') {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        this.logger.error(
          `[ChunkedPDFConverter] Task ${task.taskId} failed after ${elapsed}s`,
        );
        const details = await getTaskFailureDetails(
          task,
          this.logger,
          '[ChunkedPDFConverter]',
        );
        throw new Error(`[ChunkedPDFConverter] Chunk task failed: ${details}`);
      }

      await new Promise((resolve) =>
        setTimeout(resolve, PDF_CONVERTER.POLL_INTERVAL_MS),
      );
    }
  }

  /**
   * Relocate images from chunk output directories to the final images directory
   * with global indexing.
   */
  private relocateImages(
    chunksBaseDir: string,
    totalChunks: number,
    imagesDir: string,
  ): void {
    // 1. Relocate pic_ files (JSON base64 images)
    let picGlobalIndex = 0;
    for (let i = 0; i < totalChunks; i++) {
      const chunkImagesDir = join(
        chunksBaseDir,
        `_chunk_${i}`,
        'output',
        'images',
      );
      if (!existsSync(chunkImagesDir)) continue;

      const picFiles = readdirSync(chunkImagesDir)
        .filter((f) => f.startsWith('pic_') && f.endsWith('.png'))
        .sort((a, b) => {
          const numA = parseInt(a.replace('pic_', '').replace('.png', ''), 10);
          const numB = parseInt(b.replace('pic_', '').replace('.png', ''), 10);
          return numA - numB;
        });

      for (const file of picFiles) {
        const src = join(chunkImagesDir, file);
        const dest = join(imagesDir, `pic_${picGlobalIndex}.png`);
        copyFileSync(src, dest);
        picGlobalIndex++;
      }
    }

    // 2. Relocate image_ files (HTML content images)
    let imageGlobalIndex = 0;
    for (let i = 0; i < totalChunks; i++) {
      const chunkImagesDir = join(
        chunksBaseDir,
        `_chunk_${i}`,
        'output',
        'images',
      );
      if (!existsSync(chunkImagesDir)) continue;

      const imageFiles = readdirSync(chunkImagesDir)
        .filter((f) => f.startsWith('image_') && f.endsWith('.png'))
        .sort((a, b) => {
          const numA = parseInt(
            a.replace('image_', '').replace('.png', ''),
            10,
          );
          const numB = parseInt(
            b.replace('image_', '').replace('.png', ''),
            10,
          );
          return numA - numB;
        });

      for (const file of imageFiles) {
        const src = join(chunkImagesDir, file);
        const dest = join(imagesDir, `image_${imageGlobalIndex}.png`);
        copyFileSync(src, dest);
        imageGlobalIndex++;
      }
    }

    this.logger.info(
      `[ChunkedPDFConverter] Relocated ${picGlobalIndex} pic + ${imageGlobalIndex} image files to ${imagesDir}`,
    );
  }

  /** Render page images from PDF using ImageMagick and update result.json */
  private async renderPageImages(
    pdfPath: string,
    outputDir: string,
  ): Promise<void> {
    this.logger.info(
      '[ChunkedPDFConverter] Rendering page images with ImageMagick...',
    );

    const renderer = new PageRenderer(this.logger);
    const renderResult = await renderer.renderPages(pdfPath, outputDir);

    const resultPath = join(outputDir, 'result.json');
    const tmpPath = resultPath + '.tmp';
    const jqProgram = `
      .pages |= with_entries(
        if (.value.page_no - 1) >= 0 and (.value.page_no - 1) < ${renderResult.pageCount} then
          .value.image.uri = "pages/page_\\(.value.page_no - 1).png" |
          .value.image.mimetype = "image/png" |
          .value.image.dpi = ${PAGE_RENDERING.DEFAULT_DPI}
        else . end
      )
    `;
    await runJqFileToFile(jqProgram, resultPath, tmpPath);
    await rename(tmpPath, resultPath);

    this.logger.info(
      `[ChunkedPDFConverter] Rendered ${renderResult.pageCount} page images`,
    );
  }

  /**
   * Remove pic_ files from images directory that are not referenced in result.json.
   * Chunked Docling conversion embeds page images as base64 in JSON, which get
   * extracted as pic_ files. After renderPageImages replaces page URIs with
   * pages/page_N.png, these pic_ files become orphaned.
   */
  private cleanupOrphanedPicFiles(resultPath: string, imagesDir: string): void {
    const content = readFileSync(resultPath, 'utf-8');
    const referencedPics = new Set<string>();
    const picPattern = /images\/pic_\d+\.png/g;
    let match;
    while ((match = picPattern.exec(content)) !== null) {
      referencedPics.add(match[0].replace('images/', ''));
    }

    const picFiles = readdirSync(imagesDir).filter(
      (f) => f.startsWith('pic_') && f.endsWith('.png'),
    );

    let removedCount = 0;
    for (const file of picFiles) {
      if (!referencedPics.has(file)) {
        rmSync(join(imagesDir, file), { force: true });
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.logger.info(
        `[ChunkedPDFConverter] Cleaned up ${removedCount} orphaned pic_ files (${referencedPics.size} referenced, kept)`,
      );
    }
  }

  /**
   * Build cumulative pic_ file offsets per chunk for correct URI remapping.
   * Each offset[i] is the total number of pic_ files in chunks 0..i-1.
   */
  private buildPicFileOffsets(
    chunksBaseDir: string,
    totalChunks: number,
  ): number[] {
    const offsets: number[] = [];
    let cumulative = 0;
    for (let i = 0; i < totalChunks; i++) {
      offsets.push(cumulative);
      const dir = join(chunksBaseDir, `_chunk_${i}`, 'output', 'images');
      const count = existsSync(dir)
        ? readdirSync(dir).filter(
            (f) => f.startsWith('pic_') && f.endsWith('.png'),
          ).length
        : 0;
      cumulative += count;
    }
    return offsets;
  }

  /** Check if abort has been signalled and throw if so */
  private checkAbort(signal?: AbortSignal): void {
    if (signal?.aborted) {
      const error = new Error('Chunked PDF conversion was aborted');
      error.name = 'AbortError';
      throw error;
    }
  }
}
