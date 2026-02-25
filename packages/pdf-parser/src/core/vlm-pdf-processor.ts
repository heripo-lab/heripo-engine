import type { LoggerMethods } from '@heripo/logger';
import type { DoclingDocument, TokenUsageReport } from '@heripo/model';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { AssemblerMetadata } from '../processors/docling-document-assembler';
import type { PictureLocation } from '../processors/vlm-image-extractor';
import type { VlmPageResult } from '../types/vlm-page-result';

import { spawnAsync } from '@heripo/shared';

import { DoclingDocumentAssembler } from '../processors/docling-document-assembler';
import { PageRenderer } from '../processors/page-renderer';
import { VlmDocumentBuilder } from '../processors/vlm-document-builder';
import { VlmImageExtractor } from '../processors/vlm-image-extractor';
import { VlmPageProcessor } from '../processors/vlm-page-processor';

/** Options for VlmPdfProcessor */
export interface VlmPdfProcessorOptions {
  /** DPI for page rendering (default: 144) */
  renderDpi?: number;
  /** Concurrency for VLM page processing (default: 1) */
  concurrency?: number;
  /** Max retries per VLM call (default: 3) */
  maxRetries?: number;
  /** Temperature for VLM generation (default: 0) */
  temperature?: number;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Fallback model for retry */
  fallbackModel?: LanguageModel;
  /** Token usage aggregator for tracking */
  aggregator?: LLMTokenUsageAggregator;
  /** Callback fired after each batch of pages completes, with cumulative token usage */
  onTokenUsage?: (report: TokenUsageReport) => void;
  /** Primary document language for quality validation (ISO 639-1, e.g., 'ko') */
  documentLanguage?: string;
}

/** Result of VLM-based PDF processing */
export interface VlmPdfProcessorResult {
  /** Assembled DoclingDocument with image URIs filled */
  document: DoclingDocument;
}

/**
 * Orchestrates the VLM-based PDF processing pipeline.
 *
 * Execution order:
 * 1. PageRenderer.renderPages() — PDF → page images (PNG)
 * 2. VlmPageProcessor.processPages() — page images → VlmPageResult[]
 * 3. DoclingDocumentAssembler.assemble() — VlmPageResult[] → DoclingDocument
 * 4. VlmImageExtractor.extractImages() — crop picture regions
 * 5. VlmDocumentBuilder.build() — fill image URIs
 *
 * This processor bypasses Docling entirely, producing a DoclingDocument
 * directly from VLM output.
 */
export class VlmPdfProcessor {
  constructor(
    private readonly logger: LoggerMethods,
    private readonly pageRenderer: PageRenderer,
    private readonly vlmPageProcessor: VlmPageProcessor,
    private readonly assembler: DoclingDocumentAssembler,
    private readonly imageExtractor: VlmImageExtractor,
    private readonly documentBuilder: VlmDocumentBuilder,
  ) {}

  /**
   * Factory method for creating a VlmPdfProcessor with default sub-components.
   */
  static create(logger: LoggerMethods): VlmPdfProcessor {
    return new VlmPdfProcessor(
      logger,
      new PageRenderer(logger),
      new VlmPageProcessor(logger),
      new DoclingDocumentAssembler(),
      new VlmImageExtractor(logger),
      new VlmDocumentBuilder(logger),
    );
  }

  /**
   * Process a PDF file through the VLM pipeline.
   *
   * @param pdfPath - Path to the PDF file
   * @param outputDir - Directory for output files (pages/, images/)
   * @param filename - Original filename (e.g., "report.pdf")
   * @param model - Vision language model for page analysis
   * @param options - Processing options
   * @returns VlmPdfProcessorResult with assembled DoclingDocument
   */
  async process(
    pdfPath: string,
    outputDir: string,
    filename: string,
    model: LanguageModel,
    options?: VlmPdfProcessorOptions,
  ): Promise<VlmPdfProcessorResult> {
    this.logger.info('[VlmPdfProcessor] Starting VLM-based PDF processing...');

    // Step 1: Render PDF pages to images
    const renderResult = await this.pageRenderer.renderPages(
      pdfPath,
      outputDir,
      { dpi: options?.renderDpi },
    );
    this.logger.info(
      `[VlmPdfProcessor] Rendered ${renderResult.pageCount} pages`,
    );

    // Step 2: Process pages through VLM
    const pageResults = await this.vlmPageProcessor.processPages(
      renderResult.pageFiles,
      model,
      {
        concurrency: options?.concurrency,
        maxRetries: options?.maxRetries,
        temperature: options?.temperature,
        abortSignal: options?.abortSignal,
        fallbackModel: options?.fallbackModel,
        aggregator: options?.aggregator,
        onTokenUsage: options?.onTokenUsage,
        documentLanguage: options?.documentLanguage,
      },
    );

    // Step 3: Get page dimensions for assembler metadata
    const pageDimensions = await this.getPageDimensions(renderResult.pageFiles);

    // Step 4: Assemble DoclingDocument
    const name = filename.replace(/\.[^.]+$/, '');
    const metadata: AssemblerMetadata = { name, filename, pageDimensions };
    const doc = this.assembler.assemble(pageResults, metadata);

    // Step 5: Extract picture images
    const pictureLocations = this.extractPictureLocations(pageResults);
    const imageFiles = await this.imageExtractor.extractImages(
      renderResult.pageFiles,
      pictureLocations,
      outputDir,
    );

    // Step 6: Build final document with image URIs
    const finalDoc = this.documentBuilder.build(
      doc,
      renderResult.pageFiles,
      imageFiles,
    );

    this.logger.info('[VlmPdfProcessor] VLM processing complete');

    return { document: finalDoc };
  }

  /**
   * Extract picture locations from VLM page results.
   * Collects all picture elements that have bounding boxes.
   */
  extractPictureLocations(pageResults: VlmPageResult[]): PictureLocation[] {
    const locations: PictureLocation[] = [];
    for (const page of pageResults) {
      for (const element of page.elements) {
        if (element.type === 'picture' && element.bbox) {
          locations.push({ pageNo: page.pageNo, bbox: element.bbox });
        }
      }
    }
    return locations;
  }

  /**
   * Get pixel dimensions for all page images using ImageMagick identify.
   */
  private async getPageDimensions(
    pageFiles: string[],
  ): Promise<Map<number, { width: number; height: number }>> {
    const dims = new Map<number, { width: number; height: number }>();

    for (let i = 0; i < pageFiles.length; i++) {
      const result = await spawnAsync('magick', [
        'identify',
        '-format',
        '%w %h',
        pageFiles[i],
      ]);

      if (result.code === 0 && result.stdout.trim()) {
        const parts = result.stdout.trim().split(' ');
        const width = Number(parts[0]);
        const height = Number(parts[1]);

        if (!isNaN(width) && !isNaN(height)) {
          dims.set(i + 1, { width, height });
        }
      }
    }

    return dims;
  }
}
