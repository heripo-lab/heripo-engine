import type { LoggerMethods } from '@heripo/logger';
import type { Bcp47LanguageTag } from '@heripo/model';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { PageRenderer } from '../processors/page-renderer';

import { normalizeToBcp47 } from '@heripo/model';
import { LLMCaller } from '@heripo/shared';
import { readFileSync } from 'node:fs';
import { z } from 'zod/v4';

import { PAGE_RENDERING } from '../config/constants';
import { PdfTextExtractor } from '../processors/pdf-text-extractor';
import { KOREAN_DOCUMENT_DETECTION_PROMPT } from '../prompts/korean-document-detection-prompt';

const DEFAULT_MAX_SAMPLE_PAGES = 15;
const DEFAULT_MAX_RETRIES = 3;
const EDGE_TRIM_RATIO = 0.1;

const HANGUL_REGEX = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g;
const JAPANESE_KANA_REGEX = /[\u3040-\u30ff]/g;
const LATIN_REGEX = /[A-Za-z]/g;

export const DEFAULT_OCR_LANGUAGES: Bcp47LanguageTag[] = ['ko-KR', 'en-US'];

const languageDetectionSchema = z.object({
  detectedLanguages: z
    .array(z.string())
    .describe(
      'BCP 47 language tags found on this page, ordered by prevalence.',
    ),
});

export interface PdfLanguageDetectionOptions {
  model?: LanguageModel;
  /** model 실패 시 fallback. */
  fallbackModel?: LanguageModel;
  maxSamplePages?: number;
  maxRetries?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
  aggregator?: LLMTokenUsageAggregator;
}

export interface PdfLanguageDetectionResult {
  detectedLanguages: Bcp47LanguageTag[];
  reason: string;
  sampledPages: number;
  totalPages: number;
  source: 'text-layer' | 'vlm' | 'default';
}

export class PdfLanguageDetector {
  private readonly textExtractor: PdfTextExtractor;

  constructor(
    private readonly logger: LoggerMethods,
    private readonly pageRenderer: PageRenderer,
    textExtractor?: PdfTextExtractor,
  ) {
    this.textExtractor = textExtractor ?? new PdfTextExtractor(logger);
  }

  async detect(
    pdfPath: string,
    outputDir: string,
    options?: PdfLanguageDetectionOptions,
  ): Promise<PdfLanguageDetectionResult> {
    this.logger.info(
      '[PdfLanguageDetector] Starting PDF language detection...',
    );

    const textLayerResult = await this.detectFromTextLayer(pdfPath);
    if (textLayerResult) {
      return textLayerResult;
    }

    if (!options?.model) {
      this.logger.info(
        `[PdfLanguageDetector] Language detection model not configured; using default OCR languages: ${JSON.stringify(DEFAULT_OCR_LANGUAGES)}`,
      );
      return {
        detectedLanguages: [...DEFAULT_OCR_LANGUAGES],
        reason: 'Language detection model not configured',
        sampledPages: 0,
        totalPages: 0,
        source: 'default',
      };
    }

    return this.detectFromSampledPages(pdfPath, outputDir, {
      ...options,
      model: options.model,
    });
  }

  private async detectFromTextLayer(
    pdfPath: string,
  ): Promise<PdfLanguageDetectionResult | null> {
    try {
      const totalPages = await this.textExtractor.getPageCount(pdfPath);
      if (totalPages === 0) return null;

      const fullText = await this.textExtractor.extractFullText(pdfPath);
      if (fullText.trim().length === 0) {
        this.logger.debug(
          '[PdfLanguageDetector] No text in text layer; falling back to sampled language detection',
        );
        return null;
      }

      const detectedLanguages = this.detectLanguagesFromText(fullText);
      if (detectedLanguages.length === 0) {
        this.logger.debug(
          '[PdfLanguageDetector] No known language signal in text layer; falling back to sampled language detection',
        );
        return null;
      }

      this.logger.info(
        `[PdfLanguageDetector] Languages detected in text layer: ${detectedLanguages.join(', ')}`,
      );
      return {
        detectedLanguages,
        reason: `Languages found in PDF text layer (${totalPages} pages checked)`,
        sampledPages: totalPages,
        totalPages,
        source: 'text-layer',
      };
    } catch {
      this.logger.debug(
        '[PdfLanguageDetector] Text layer language detection failed; falling back to sampled language detection',
      );
      return null;
    }
  }

  private detectLanguagesFromText(text: string): Bcp47LanguageTag[] {
    const scores: Array<{ tag: Bcp47LanguageTag; count: number }> = [
      { tag: 'ko-KR', count: this.countMatches(text, HANGUL_REGEX) },
      { tag: 'ja-JP', count: this.countMatches(text, JAPANESE_KANA_REGEX) },
      { tag: 'en-US', count: this.countMatches(text, LATIN_REGEX) },
    ];

    return scores
      .filter(({ count }) => count > 0)
      .sort((a, b) => b.count - a.count)
      .map(({ tag }) => tag);
  }

  private countMatches(text: string, regex: RegExp): number {
    regex.lastIndex = 0;
    return text.match(regex)?.length ?? 0;
  }

  private async detectFromSampledPages(
    pdfPath: string,
    outputDir: string,
    options: Required<Pick<PdfLanguageDetectionOptions, 'model'>> &
      PdfLanguageDetectionOptions,
  ): Promise<PdfLanguageDetectionResult> {
    const renderResult = await this.pageRenderer.renderPages(
      pdfPath,
      outputDir,
      {
        dpi: PAGE_RENDERING.SAMPLE_DPI,
      },
    );

    if (renderResult.pageCount === 0) {
      this.logger.info(
        `[PdfLanguageDetector] No pages found; using default OCR languages: ${JSON.stringify(DEFAULT_OCR_LANGUAGES)}`,
      );
      return {
        detectedLanguages: [...DEFAULT_OCR_LANGUAGES],
        reason: 'No pages found in PDF',
        sampledPages: 0,
        totalPages: 0,
        source: 'default',
      };
    }

    const sampleIndices = this.selectSamplePages(
      renderResult.pageCount,
      options.maxSamplePages ?? DEFAULT_MAX_SAMPLE_PAGES,
    );
    this.logger.info(
      `[PdfLanguageDetector] Sampling ${sampleIndices.length} of ${renderResult.pageCount} pages for language detection: [${sampleIndices.map((i) => i + 1).join(', ')}]`,
    );

    const languageFrequency = new Map<Bcp47LanguageTag, number>();
    let sampledPages = 0;
    for (const index of sampleIndices) {
      const pageFile = renderResult.pageFiles[index];
      if (!pageFile) continue;

      sampledPages += 1;
      const detectedLanguages = await this.analyzeSamplePage(
        pageFile,
        index + 1,
        options,
      );
      for (const language of detectedLanguages) {
        languageFrequency.set(
          language,
          (languageFrequency.get(language) ?? 0) + 1,
        );
      }
    }

    const detectedLanguages = this.aggregateLanguages(languageFrequency);
    if (detectedLanguages.length === 0) {
      this.logger.info(
        `[PdfLanguageDetector] No languages detected from sampled pages; using default OCR languages: ${JSON.stringify(DEFAULT_OCR_LANGUAGES)}`,
      );
      return {
        detectedLanguages: [...DEFAULT_OCR_LANGUAGES],
        reason: `No language detected in ${sampledPages} sampled pages`,
        sampledPages,
        totalPages: renderResult.pageCount,
        source: 'default',
      };
    }

    this.logger.info(
      `[PdfLanguageDetector] Languages detected from sampled pages: ${detectedLanguages.join(', ')}`,
    );
    return {
      detectedLanguages,
      reason: `Languages detected in ${sampledPages} sampled pages`,
      sampledPages,
      totalPages: renderResult.pageCount,
      source: 'vlm',
    };
  }

  selectSamplePages(totalPages: number, maxSamples: number): number[] {
    if (totalPages === 0) return [];
    if (totalPages <= maxSamples) {
      return Array.from({ length: totalPages }, (_, i) => i);
    }

    const trimCount = Math.max(1, Math.ceil(totalPages * EDGE_TRIM_RATIO));
    const start = trimCount;
    const end = totalPages - trimCount;
    const eligibleCount = end - start;

    if (eligibleCount <= 0) {
      return [Math.floor(totalPages / 2)];
    }
    if (eligibleCount <= maxSamples) {
      return Array.from({ length: eligibleCount }, (_, i) => start + i);
    }

    const step = eligibleCount / maxSamples;
    return Array.from(
      { length: maxSamples },
      (_, i) => start + Math.floor(i * step),
    );
  }

  private async analyzeSamplePage(
    pageFile: string,
    pageNo: number,
    options: Required<Pick<PdfLanguageDetectionOptions, 'model'>> &
      PdfLanguageDetectionOptions,
  ): Promise<Bcp47LanguageTag[]> {
    this.logger.debug(
      `[PdfLanguageDetector] Analyzing page ${pageNo} for language...`,
    );

    const imageData = new Uint8Array(readFileSync(pageFile));
    const result = await LLMCaller.callVision({
      schema: languageDetectionSchema as any,
      messages: [
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
      ],
      primaryModel: options.model,
      fallbackModel: options.fallbackModel,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      temperature: options.temperature ?? 0,
      abortSignal: options.abortSignal,
      component: 'PdfLanguageDetector',
      phase: 'language-detection',
    });

    options.aggregator?.track(result.usage);

    const output = result.output as { detectedLanguages: string[] };
    const detectedLanguages = output.detectedLanguages
      .map(normalizeToBcp47)
      .filter((tag): tag is Bcp47LanguageTag => tag !== null);

    this.logger.debug(
      `[PdfLanguageDetector] Page ${pageNo}: detectedLanguages=${detectedLanguages.join(',')}`,
    );
    return detectedLanguages;
  }

  private aggregateLanguages(
    languageFrequency: Map<Bcp47LanguageTag, number>,
  ): Bcp47LanguageTag[] {
    return [...languageFrequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([language]) => language);
  }
}
