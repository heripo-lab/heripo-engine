import type { LoggerMethods } from '@heripo/logger';
import type { OcrStrategy } from '@heripo/model';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { PageRenderer } from '../processors/page-renderer';

import { LLMCaller } from '@heripo/shared';
import { readFileSync } from 'node:fs';
import { z } from 'zod/v4';

import { PdfTextExtractor } from '../processors/pdf-text-extractor';

/** DPI for sampling pages */
const SAMPLE_DPI = 150;

/** Ratio of pages to trim from front and back (covers, TOC, appendices) */
const EDGE_TRIM_RATIO = 0.1;

/** Default maximum number of pages to sample */
const DEFAULT_MAX_SAMPLE_PAGES = 15;

/** Default max retries per VLM call */
const DEFAULT_MAX_RETRIES = 3;

/** Regex to detect CJK Unified Ideographs (Hanja/Kanji/Hanzi) */
const CJK_REGEX = /[\u4E00-\u9FFF]/;

/** Regex to detect Hangul syllables */
const HANGUL_REGEX = /[\uAC00-\uD7AF]/;

/** Zod schema for VLM Korean-Hanja mix detection response */
const koreanHanjaMixSchema = z.object({
  hasKoreanHanjaMix: z
    .boolean()
    .describe(
      'Whether the page contains any Hanja (漢字/Chinese characters) mixed with Korean text',
    ),
  detectedLanguages: z
    .array(z.string())
    .describe(
      'BCP 47 language tags of languages found on this page, ordered by prevalence (e.g., ["ko-KR", "en-US"])',
    ),
});

/** System prompt for Korean-Hanja mix detection */
const KOREAN_HANJA_MIX_PROMPT = `Look at this page image carefully. Does it contain any Hanja (漢字/Chinese characters) mixed with Korean text?

Hanja examples: 遺蹟, 發掘, 調査, 報告書, 文化財
Note: Hanja are Chinese characters used in Korean documents, different from modern Korean (한글).

Answer whether any Hanja characters are present on this page.

Also identify all languages present on this page. Return an array of BCP 47 language tags ordered by prevalence (primary language first).
Examples: ["ko-KR", "en-US"], ["ja-JP"], ["zh-TW", "en-US"]`;

/** Options for OcrStrategySampler */
export interface OcrStrategySamplerOptions {
  /** Maximum number of pages to sample (default: 15) */
  maxSamplePages?: number;
  /** Maximum retries per VLM call (default: 3) */
  maxRetries?: number;
  /** Temperature for VLM generation (default: 0) */
  temperature?: number;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Fallback model for retry after primary exhausts maxRetries */
  fallbackModel?: LanguageModel;
  /** Token usage aggregator for tracking */
  aggregator?: LLMTokenUsageAggregator;
}

/**
 * Samples pages from a PDF to determine whether to use ocrmac or VLM for processing.
 *
 * First attempts to detect Hangul-Hanja mix directly from the PDF text layer using
 * pdftotext (zero-cost, high accuracy for PDFs with embedded text). Only falls back
 * to VLM-based image analysis for image-only PDFs without a text layer.
 *
 * VLM fallback sampling strategy:
 * - Trim front/back 10% of pages (covers, TOC, appendices)
 * - Select up to 15 pages evenly distributed across the eligible range
 * - Early exit on first Korean-Hanja mix detection
 */
export class OcrStrategySampler {
  private readonly logger: LoggerMethods;
  private readonly pageRenderer: PageRenderer;
  private readonly textExtractor: PdfTextExtractor;

  constructor(
    logger: LoggerMethods,
    pageRenderer: PageRenderer,
    textExtractor?: PdfTextExtractor,
  ) {
    this.logger = logger;
    this.pageRenderer = pageRenderer;
    this.textExtractor = textExtractor ?? new PdfTextExtractor(logger);
  }

  /**
   * Sample pages from a PDF and determine the OCR strategy.
   *
   * @param pdfPath - Path to the PDF file
   * @param outputDir - Directory for temporary rendered pages
   * @param model - Vision language model for Korean-Hanja mix detection
   * @param options - Sampling options
   * @returns OcrStrategy with method ('ocrmac' or 'vlm') and metadata
   */
  async sample(
    pdfPath: string,
    outputDir: string,
    model: LanguageModel,
    options?: OcrStrategySamplerOptions,
  ): Promise<OcrStrategy> {
    const maxSamplePages = options?.maxSamplePages ?? DEFAULT_MAX_SAMPLE_PAGES;

    this.logger.info('[OcrStrategySampler] Starting OCR strategy sampling...');

    // Step 1: Try text layer pre-check (zero-cost Hangul-Hanja detection)
    const preCheckResult = await this.preCheckHanjaFromTextLayer(
      pdfPath,
      maxSamplePages,
    );
    if (preCheckResult) {
      return preCheckResult;
    }

    // Step 2: Render pages at medium DPI for VLM analysis (image-only PDFs)
    const renderResult = await this.pageRenderer.renderPages(
      pdfPath,
      outputDir,
      { dpi: SAMPLE_DPI },
    );

    if (renderResult.pageCount === 0) {
      this.logger.info('[OcrStrategySampler] No pages found in PDF');
      return {
        method: 'ocrmac',
        reason: 'No pages found in PDF',
        sampledPages: 0,
        totalPages: 0,
      };
    }

    // Step 3: Select sample page indices
    const sampleIndices = this.selectSamplePages(
      renderResult.pageCount,
      maxSamplePages,
    );

    this.logger.info(
      `[OcrStrategySampler] Sampling ${sampleIndices.length} of ${renderResult.pageCount} pages: [${sampleIndices.map((i) => i + 1).join(', ')}]`,
    );

    // Step 4: Check each sample page for Korean-Hanja mix (early exit on detection)
    let sampledCount = 0;
    let detectedLanguages: string[] | undefined;
    for (const idx of sampleIndices) {
      sampledCount++;
      const pageFile = renderResult.pageFiles[idx];
      const pageAnalysis = await this.analyzeSamplePage(
        pageFile,
        idx + 1,
        model,
        options,
      );

      detectedLanguages = pageAnalysis.detectedLanguages;

      if (pageAnalysis.hasKoreanHanjaMix) {
        this.logger.info(
          `[OcrStrategySampler] Korean-Hanja mix detected on page ${idx + 1} → VLM strategy`,
        );
        return {
          method: 'vlm',
          detectedLanguages,
          reason: `Korean-Hanja mix detected on page ${idx + 1}`,
          sampledPages: sampledCount,
          totalPages: renderResult.pageCount,
        };
      }
    }

    // Step 5: No Korean-Hanja mix found → ocrmac
    this.logger.info(
      '[OcrStrategySampler] No Korean-Hanja mix detected → ocrmac strategy',
    );
    return {
      method: 'ocrmac',
      detectedLanguages,
      reason: `No Korean-Hanja mix detected in ${sampledCount} sampled pages`,
      sampledPages: sampledCount,
      totalPages: renderResult.pageCount,
    };
  }

  /**
   * Pre-check for Hangul-Hanja mix in PDF text layer using pdftotext.
   * Returns an OcrStrategy if a definitive decision can be made, or null to fall back to VLM.
   */
  private async preCheckHanjaFromTextLayer(
    pdfPath: string,
    maxSamplePages: number,
  ): Promise<OcrStrategy | null> {
    try {
      const totalPages = await this.textExtractor.getPageCount(pdfPath);
      if (totalPages === 0) return null;

      const sampleIndices = this.selectSamplePages(totalPages, maxSamplePages);

      let hasText = false;
      for (const idx of sampleIndices) {
        const text = await this.textExtractor.extractPageText(pdfPath, idx + 1);
        if (text.trim().length === 0) continue;
        hasText = true;

        if (HANGUL_REGEX.test(text) && CJK_REGEX.test(text)) {
          this.logger.info(
            `[OcrStrategySampler] Hangul-Hanja mix detected in text layer (page ${idx + 1}) → VLM strategy`,
          );
          return {
            method: 'vlm',
            detectedLanguages: ['ko-KR'],
            reason: `Hangul-Hanja mix found in PDF text layer (page ${idx + 1})`,
            sampledPages: sampleIndices.length,
            totalPages,
          };
        }
      }

      if (!hasText) {
        this.logger.debug(
          '[OcrStrategySampler] Text layer empty, falling back to VLM sampling',
        );
        return null;
      }

      this.logger.info(
        '[OcrStrategySampler] No Hangul-Hanja mix in text layer → ocrmac strategy',
      );
      return {
        method: 'ocrmac',
        detectedLanguages: ['ko-KR'],
        reason: `No Hangul-Hanja mix in PDF text layer (${sampleIndices.length} pages sampled)`,
        sampledPages: sampleIndices.length,
        totalPages,
      };
    } catch {
      this.logger.debug(
        '[OcrStrategySampler] Text layer pre-check failed, falling back to VLM sampling',
      );
      return null;
    }
  }

  /**
   * Select page indices for sampling.
   * Trims front/back edges and distributes samples evenly.
   *
   * @param totalPages - Total number of pages
   * @param maxSamples - Maximum number of samples
   * @returns Array of 0-based page indices
   */
  selectSamplePages(totalPages: number, maxSamples: number): number[] {
    if (totalPages === 0) return [];

    // For very small documents, sample all pages
    if (totalPages <= maxSamples) {
      return Array.from({ length: totalPages }, (_, i) => i);
    }

    // Trim front/back edges
    const trimCount = Math.max(1, Math.ceil(totalPages * EDGE_TRIM_RATIO));
    const start = trimCount;
    const end = totalPages - trimCount;
    const eligibleCount = end - start;

    // If trimming leaves no eligible pages, use middle page
    if (eligibleCount <= 0) {
      return [Math.floor(totalPages / 2)];
    }

    // If eligible pages fit within maxSamples, use all
    if (eligibleCount <= maxSamples) {
      return Array.from({ length: eligibleCount }, (_, i) => start + i);
    }

    // Distribute samples evenly across eligible range
    const indices: number[] = [];
    const step = eligibleCount / maxSamples;
    for (let i = 0; i < maxSamples; i++) {
      indices.push(start + Math.floor(i * step));
    }
    return indices;
  }

  /**
   * Analyze a single sample page for Korean-Hanja mixed script and primary language.
   *
   * @returns Object with Korean-Hanja detection result and detected languages
   */
  private async analyzeSamplePage(
    pageFile: string,
    pageNo: number,
    model: LanguageModel,
    options?: OcrStrategySamplerOptions,
  ): Promise<{ hasKoreanHanjaMix: boolean; detectedLanguages: string[] }> {
    this.logger.debug(
      `[OcrStrategySampler] Analyzing page ${pageNo} for Korean-Hanja mix and language...`,
    );

    const base64Image = readFileSync(pageFile).toString('base64');

    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: KOREAN_HANJA_MIX_PROMPT },
          {
            type: 'image' as const,
            image: `data:image/png;base64,${base64Image}`,
          },
        ],
      },
    ];

    const result = await LLMCaller.callVision({
      schema: koreanHanjaMixSchema as any,
      messages,
      primaryModel: model,
      fallbackModel: options?.fallbackModel,
      maxRetries: options?.maxRetries ?? DEFAULT_MAX_RETRIES,
      temperature: options?.temperature ?? 0,
      abortSignal: options?.abortSignal,
      component: 'OcrStrategySampler',
      phase: 'korean-hanja-mix-detection',
    });

    if (options?.aggregator) {
      options.aggregator.track(result.usage);
    }

    const output = result.output as {
      hasKoreanHanjaMix: boolean;
      detectedLanguages: string[];
    };

    this.logger.debug(
      `[OcrStrategySampler] Page ${pageNo}: hasKoreanHanjaMix=${output.hasKoreanHanjaMix}, detectedLanguages=${output.detectedLanguages.join(',')}`,
    );

    return {
      hasKoreanHanjaMix: output.hasKoreanHanjaMix,
      detectedLanguages: output.detectedLanguages,
    };
  }
}
