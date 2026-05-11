import type { LoggerMethods } from '@heripo/logger';
import type { Bcp47LanguageTag, OcrStrategy } from '@heripo/model';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { PageRenderer } from '../processors/page-renderer';

import { normalizeToBcp47 } from '@heripo/model';
import { LLMCaller } from '@heripo/shared';
import { readFileSync } from 'node:fs';
import { z } from 'zod/v4';

import { PAGE_RENDERING } from '../config/constants.js';
import { PdfTextExtractor } from '../processors/pdf-text-extractor';
import { KOREAN_DOCUMENT_DETECTION_PROMPT } from '../prompts/korean-document-detection-prompt';

/** Ratio of pages to trim from front and back (covers, TOC, appendices) */
const EDGE_TRIM_RATIO = 0.1;

/** Default maximum number of pages to sample */
const DEFAULT_MAX_SAMPLE_PAGES = 15;

/** Default max retries per VLM call */
const DEFAULT_MAX_RETRIES = 3;

/** Regex to detect Hangul syllables */
const HANGUL_REGEX = /[\uAC00-\uD7AF]/;

/** Zod schema for VLM language detection response */
const koreanDocumentDetectionSchema = z.object({
  detectedLanguages: z
    .array(z.string())
    .describe(
      'BCP 47 language tags of languages found on this page, ordered by prevalence (e.g., ["ko-KR", "en-US"])',
    ),
});

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
 * First attempts to detect Korean text directly from the PDF text layer using
 * pdftotext (zero-cost, high accuracy for PDFs with embedded text). Falls back
 * to VLM-based image analysis when the text layer cannot identify Korean.
 *
 * VLM fallback sampling strategy:
 * - Trim front/back 10% of pages (covers, TOC, appendices)
 * - Select up to 15 pages evenly distributed across the eligible range
 * - Early exit on first Korean language detection
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
   * @param model - Vision language model for Korean document detection
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

    // Step 1: Try text layer pre-check (zero-cost Korean detection)
    const preCheckResult = await this.preCheckKoreanFromTextLayer(pdfPath);
    if (preCheckResult) {
      return preCheckResult;
    }

    // Step 2: Render pages at medium DPI for VLM analysis (image-only PDFs)
    const renderResult = await this.pageRenderer.renderPages(
      pdfPath,
      outputDir,
      { dpi: PAGE_RENDERING.SAMPLE_DPI },
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

    // Step 4: Check each sample page for Korean text (early exit on detection)
    const sampleResult = await this.samplePages(
      sampleIndices,
      renderResult.pageFiles,
      model,
      options,
    );

    if (sampleResult.foundKorean) {
      this.logger.info(
        `[OcrStrategySampler] Korean document detected on page ${sampleResult.koreanPageNo} → VLM strategy`,
      );
      const detectedLanguages = this.aggregateLanguages(
        sampleResult.languageFrequency,
      );
      return {
        method: 'vlm',
        detectedLanguages,
        reason: `Korean document detected on page ${sampleResult.koreanPageNo}`,
        sampledPages: sampleResult.sampledCount,
        totalPages: renderResult.pageCount,
      };
    }

    // Step 5: No Korean language found → ocrmac
    this.logger.info(
      '[OcrStrategySampler] No Korean language detected → ocrmac strategy',
    );
    const detectedLanguages = this.aggregateLanguages(
      sampleResult.languageFrequency,
    );
    return {
      method: 'ocrmac',
      detectedLanguages,
      reason: `No Korean language detected in ${sampleResult.sampledCount} sampled pages`,
      sampledPages: sampleResult.sampledCount,
      totalPages: renderResult.pageCount,
    };
  }

  /**
   * Sample pages for Korean language detection with early exit.
   */
  private async samplePages(
    sampleIndices: number[],
    pageFiles: string[],
    model: LanguageModel,
    options?: OcrStrategySamplerOptions,
  ): Promise<{
    foundKorean: boolean;
    koreanPageNo?: number;
    sampledCount: number;
    languageFrequency: Map<Bcp47LanguageTag, number>;
  }> {
    const languageFrequency = new Map<Bcp47LanguageTag, number>();

    for (let i = 0; i < sampleIndices.length; i++) {
      const idx = sampleIndices[i];
      const pageFile = pageFiles[idx];
      const pageAnalysis = await this.analyzeSamplePage(
        pageFile,
        idx + 1,
        model,
        options,
      );

      for (const lang of pageAnalysis.detectedLanguages) {
        languageFrequency.set(lang, (languageFrequency.get(lang) ?? 0) + 1);
      }

      if (pageAnalysis.detectedLanguages.includes('ko-KR')) {
        return {
          foundKorean: true,
          koreanPageNo: idx + 1,
          sampledCount: i + 1,
          languageFrequency,
        };
      }
    }

    return {
      foundKorean: false,
      sampledCount: sampleIndices.length,
      languageFrequency,
    };
  }

  /**
   * Pre-check for Korean text in PDF text layer using pdftotext.
   * Extracts full document text in a single process and checks at document level:
   * - Hangul anywhere in document → VLM (confirmed Korean document)
   * - No Hangul (English, Japanese, etc.) → null (delegates to VLM for language detection)
   */
  private async preCheckKoreanFromTextLayer(
    pdfPath: string,
  ): Promise<OcrStrategy | null> {
    try {
      const totalPages = await this.textExtractor.getPageCount(pdfPath);
      if (totalPages === 0) return null;

      const fullText = await this.textExtractor.extractFullText(pdfPath);
      if (fullText.trim().length === 0) {
        this.logger.debug(
          '[OcrStrategySampler] No text in text layer, falling back to VLM sampling',
        );
        return null;
      }

      const hasHangul = HANGUL_REGEX.test(fullText);

      if (!hasHangul) {
        this.logger.debug(
          '[OcrStrategySampler] No Hangul in text layer, falling back to VLM sampling',
        );
        return null;
      }

      this.logger.info(
        '[OcrStrategySampler] Korean text detected in text layer → VLM strategy',
      );
      return {
        method: 'vlm',
        detectedLanguages: ['ko-KR'],
        reason: `Korean text found in PDF text layer (${totalPages} pages checked)`,
        sampledPages: totalPages,
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
    const step = eligibleCount / maxSamples;
    return Array.from(
      { length: maxSamples },
      (_, i) => start + Math.floor(i * step),
    );
  }

  /**
   * Analyze a single sample page for language.
   * Normalizes raw VLM language responses to valid BCP 47 tags, filtering out invalid ones.
   *
   * @returns Object with normalized detected languages
   */
  private async analyzeSamplePage(
    pageFile: string,
    pageNo: number,
    model: LanguageModel,
    options?: OcrStrategySamplerOptions,
  ): Promise<{
    detectedLanguages: Bcp47LanguageTag[];
  }> {
    this.logger.debug(
      `[OcrStrategySampler] Analyzing page ${pageNo} for language...`,
    );

    const imageData = new Uint8Array(readFileSync(pageFile));

    const messages = [
      {
        role: 'user' as const,
        content: [
          {
            type: 'text' as const,
            text: KOREAN_DOCUMENT_DETECTION_PROMPT,
          },
          {
            type: 'image' as const,
            image: imageData,
            mediaType: 'image/png' as const,
          },
        ],
      },
    ];

    const result = await LLMCaller.callVision({
      schema: koreanDocumentDetectionSchema as any,
      messages,
      primaryModel: model,
      fallbackModel: options?.fallbackModel,
      maxRetries: options?.maxRetries ?? DEFAULT_MAX_RETRIES,
      temperature: options?.temperature ?? 0,
      abortSignal: options?.abortSignal,
      component: 'OcrStrategySampler',
      phase: 'korean-document-detection',
    });

    if (options?.aggregator) {
      options.aggregator.track(result.usage);
    }

    const output = result.output as {
      detectedLanguages: string[];
    };

    const normalizedLanguages = output.detectedLanguages
      .map(normalizeToBcp47)
      .filter((tag): tag is Bcp47LanguageTag => tag !== null);

    this.logger.debug(
      `[OcrStrategySampler] Page ${pageNo}: detectedLanguages=${normalizedLanguages.join(',')}`,
    );

    return {
      detectedLanguages: normalizedLanguages,
    };
  }

  /**
   * Aggregate language frequency map into a sorted array.
   * Returns languages sorted by frequency (descending), or undefined if empty.
   */
  private aggregateLanguages(
    frequencyMap: Map<Bcp47LanguageTag, number>,
  ): Bcp47LanguageTag[] | undefined {
    if (frequencyMap.size === 0) return undefined;

    return [...frequencyMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([lang]) => lang);
  }
}
