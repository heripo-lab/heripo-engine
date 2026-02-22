import type { LoggerMethods } from '@heripo/logger';
import type {
  DoclingDocument,
  DoclingTextItem,
  HanjaAssessment,
} from '@heripo/model';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import { z } from 'zod';

import { VisionLLMComponent } from '../core';

/**
 * Minimum text length on a page to consider it for sampling.
 * Pages with fewer characters (e.g., page numbers, headers only) are excluded.
 */
const MIN_TEXT_LENGTH = 100;

/**
 * Maximum number of pages to sample for quality assessment
 */
const MAX_SAMPLE_PAGES = 10;

/**
 * Ratio of pages to trim from the front and back of the document.
 * Archaeological reports typically have covers, TOC, appendices in these ranges.
 */
const EDGE_TRIM_RATIO = 0.1;

/**
 * Maximum text length on a page with pictures to still consider it "image-only".
 * Pages with pictures and fewer characters than this threshold are excluded from sampling.
 */
const IMAGE_PAGE_TEXT_THRESHOLD = 50;

/**
 * Ratio threshold above which KCJ corruption is considered severe
 * (0.5 = 50% of sampled pages have severe corruption)
 */
const CORRUPTION_THRESHOLD = 0.5;

/**
 * Minimum number of corrupted pages to trigger severe assessment,
 * regardless of the corruption ratio.
 * Even a low ratio can indicate systemic OCR issues when multiple pages are affected.
 */
const MIN_SEVERE_CORRUPTED_COUNT = 3;

/**
 * Schema for Vision LLM response evaluating KCJ character quality
 */
const HanjaQualityResponseSchema = z.object({
  isCorrupted: z
    .boolean()
    .describe(
      'Whether the KCJ (Hanja) characters in the OCR text are significantly corrupted compared to the page image',
    ),
  corruptedCharCount: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'Approximate number of corrupted or incorrectly recognized KCJ characters',
    ),
  totalKcjCharCount: z
    .number()
    .int()
    .nonnegative()
    .describe('Total number of KCJ characters found in the OCR text'),
  explanation: z
    .string()
    .describe('Brief explanation of the assessment result'),
});

type HanjaQualityResponse = z.infer<typeof HanjaQualityResponseSchema>;

/**
 * Page data with text density information
 */
interface PageData {
  pageNo: number;
  textLength: number;
  texts: string[];
}

/**
 * HanjaQualitySampler
 *
 * Evaluates the quality of KCJ (Chinese/Japanese/Korean) character recognition
 * in OCR-processed documents. Samples a subset of pages containing KCJ text and
 * uses Vision LLM to compare the OCR output against the original page images.
 *
 * This is used to determine whether a document should be re-parsed using the
 * VLM pipeline for better KCJ character accuracy.
 */
export class HanjaQualitySampler extends VisionLLMComponent {
  constructor(
    logger: LoggerMethods,
    model: LanguageModel,
    outputPath: string,
    maxRetries?: number,
    fallbackModel?: LanguageModel,
    aggregator?: LLMTokenUsageAggregator,
    abortSignal?: AbortSignal,
  ) {
    super(
      logger,
      model,
      'HanjaQualitySampler',
      outputPath,
      { maxRetries, abortSignal },
      fallbackModel,
      aggregator,
    );
  }

  /**
   * Assess the quality of KCJ character recognition in the document
   *
   * @param doclingDoc - DoclingDocument to assess
   * @returns Assessment result indicating whether VLM re-parse is needed
   */
  async assess(doclingDoc: DoclingDocument): Promise<HanjaAssessment> {
    const totalPages = Object.keys(doclingDoc.pages).length;
    this.log('info', 'Starting KCJ quality assessment...');

    // Step 1: Compute filtering metadata for sampling
    const { frontCutoff, backCutoff } = this.getEligiblePageRange(totalPages);
    const imageOnlyPages = this.getImageOnlyPages(doclingDoc);

    this.log(
      'info',
      `Total pages: ${totalPages}, eligible range: (${frontCutoff}, ${backCutoff}], ` +
        `image-only pages excluded: ${imageOnlyPages.size}`,
    );

    // Step 2: Find ALL pages with substantial text content (no filtering)
    const textPages = this.getTextPages(doclingDoc);

    if (textPages.length === 0) {
      this.log('info', 'No text pages found for assessment');
      return {
        needsVlmReparse: false,
        severity: 'none',
        kcjPageCount: 0,
        sampledPageCount: 0,
        corruptedRatio: 0,
        reason: 'No text pages found for assessment',
      };
    }

    this.log(
      'info',
      `Found ${textPages.length} text pages (min length: ${MIN_TEXT_LENGTH})`,
    );

    // Step 3: Select pages to sample (prefer eligible, non-image pages; fallback to all)
    const sampled = this.selectSamplePages(
      textPages,
      totalPages,
      imageOnlyPages,
    );
    this.log(
      'info',
      `Sampling ${sampled.length} pages: [${sampled.map((p) => p.pageNo).join(', ')}]`,
    );

    // Step 4: Evaluate each sampled page with Vision LLM
    const results = await this.evaluatePages(sampled);

    // Step 5: Aggregate results
    const assessment = this.aggregateResults(
      textPages.length,
      sampled.length,
      results,
    );

    this.log(
      'info',
      `Assessment complete: severity=${assessment.severity}, ` +
        `corrupted=${assessment.corruptedRatio.toFixed(2)}, ` +
        `needsVlmReparse=${assessment.needsVlmReparse}`,
    );

    return assessment;
  }

  /**
   * Get the eligible page range after trimming front/back edges.
   * Returns cutoff values where eligible pages satisfy: pageNo > frontCutoff && pageNo <= backCutoff
   */
  private getEligiblePageRange(totalPages: number): {
    frontCutoff: number;
    backCutoff: number;
  } {
    const trimCount = Math.ceil(totalPages * EDGE_TRIM_RATIO);
    return {
      frontCutoff: trimCount,
      backCutoff: totalPages - trimCount,
    };
  }

  /**
   * Get page numbers that are "image-only" (contain pictures but minimal text).
   * These pages (e.g., photo plates/도판) are unsuitable for KCJ quality assessment.
   */
  private getImageOnlyPages(doclingDoc: DoclingDocument): Set<number> {
    const picturePages = new Set<number>();
    for (const picture of doclingDoc.pictures) {
      const pageNo = picture.prov?.[0]?.page_no;
      if (pageNo != null) {
        picturePages.add(pageNo);
      }
    }

    if (picturePages.size === 0) return new Set();

    // Compute total text length per page
    const pageTextLength = new Map<number, number>();
    for (const text of doclingDoc.texts) {
      const pageNo = this.getPageNo(text);
      if (picturePages.has(pageNo)) {
        pageTextLength.set(
          pageNo,
          (pageTextLength.get(pageNo) ?? 0) + text.text.length,
        );
      }
    }

    const imageOnlyPages = new Set<number>();
    for (const pageNo of picturePages) {
      const textLength = pageTextLength.get(pageNo) ?? 0;
      if (textLength < IMAGE_PAGE_TEXT_THRESHOLD) {
        imageOnlyPages.add(pageNo);
      }
    }

    return imageOnlyPages;
  }

  /**
   * Get all pages with substantial text content.
   * Pages with fewer characters than MIN_TEXT_LENGTH (e.g., page numbers, headers only) are excluded.
   */
  private getTextPages(doclingDoc: DoclingDocument): PageData[] {
    const pageMap = new Map<number, { textLength: number; texts: string[] }>();

    for (const text of doclingDoc.texts) {
      const pageNo = this.getPageNo(text);
      const entry = pageMap.get(pageNo) ?? { textLength: 0, texts: [] };
      entry.textLength += text.text.length;
      entry.texts.push(text.text);
      pageMap.set(pageNo, entry);
    }

    return Array.from(pageMap.entries())
      .filter(([, data]) => data.textLength >= MIN_TEXT_LENGTH)
      .map(([pageNo, data]) => ({
        pageNo,
        textLength: data.textLength,
        texts: data.texts,
      }));
  }

  /**
   * Select sample pages with highest text density.
   * Prefers pages in the eligible range (not edge-trimmed) and not image-only.
   * Falls back to all text pages if filtering leaves too few candidates.
   */
  private selectSamplePages(
    textPages: PageData[],
    totalPages: number,
    imageOnlyPages: Set<number>,
  ): PageData[] {
    const { frontCutoff, backCutoff } = this.getEligiblePageRange(totalPages);

    // Apply filters: prefer eligible range and non-image pages
    const filtered =
      totalPages > 0
        ? textPages.filter(
            (p) =>
              p.pageNo > frontCutoff &&
              p.pageNo <= backCutoff &&
              !imageOnlyPages.has(p.pageNo),
          )
        : textPages;

    // Fall back to all text pages if filtering removes everything
    const candidates = filtered.length > 0 ? filtered : textPages;

    if (candidates !== filtered) {
      this.log(
        'warn',
        `All text pages were filtered out by edge/image exclusion. Falling back to all ${textPages.length} text pages.`,
      );
    }

    const sorted = [...candidates].sort((a, b) => b.textLength - a.textLength);
    const count = Math.min(MAX_SAMPLE_PAGES, sorted.length);
    return sorted.slice(0, count);
  }

  /**
   * Evaluate sampled pages using Vision LLM
   */
  private async evaluatePages(
    pages: PageData[],
  ): Promise<HanjaQualityResponse[]> {
    const results: HanjaQualityResponse[] = [];

    for (const page of pages) {
      const result = await this.evaluateSinglePage(page);
      results.push(result);
    }

    return results;
  }

  /**
   * Evaluate a single page by comparing OCR text against the page image
   */
  private async evaluateSinglePage(
    page: PageData,
  ): Promise<HanjaQualityResponse> {
    // Page images use 0-based indexing (page_1 -> page_0.png)
    const imagePath = `pages/page_${page.pageNo - 1}.png`;

    let imageContent;
    try {
      imageContent = this.buildImageContent(imagePath);
    } catch {
      this.log(
        'warn',
        `Failed to load page image for page ${page.pageNo}, marking as not corrupted`,
      );
      return {
        isCorrupted: false,
        corruptedCharCount: 0,
        totalKcjCharCount: 0,
        explanation: `Page image not available for page ${page.pageNo}`,
      };
    }

    const ocrText = page.texts.join('\n');

    const messages = [
      {
        role: 'user' as const,
        content: [
          imageContent,
          {
            type: 'text' as const,
            text: this.buildUserPrompt(ocrText),
          },
        ],
      },
    ];

    const { output } = await this.callVisionLLM(
      HanjaQualityResponseSchema,
      messages,
      `page-${page.pageNo}`,
    );

    this.log(
      'info',
      `Page ${page.pageNo}: corrupted=${output.isCorrupted}, ` +
        `${output.corruptedCharCount}/${output.totalKcjCharCount} KCJ chars corrupted`,
    );

    return output;
  }

  /**
   * Aggregate individual page results into final assessment
   */
  private aggregateResults(
    totalTextPages: number,
    sampledCount: number,
    results: HanjaQualityResponse[],
  ): HanjaAssessment {
    const corruptedCount = results.filter((r) => r.isCorrupted).length;
    const corruptedRatio = sampledCount > 0 ? corruptedCount / sampledCount : 0;

    let severity: HanjaAssessment['severity'];
    let needsVlmReparse: boolean;

    if (
      corruptedRatio >= CORRUPTION_THRESHOLD ||
      corruptedCount >= MIN_SEVERE_CORRUPTED_COUNT
    ) {
      severity = 'severe';
      needsVlmReparse = true;
    } else if (corruptedCount > 0) {
      severity = 'minor';
      needsVlmReparse = false;
    } else {
      severity = 'none';
      needsVlmReparse = false;
    }

    const reason =
      corruptedCount === 0
        ? 'No Hanja character corruption detected'
        : `${corruptedCount}/${sampledCount} sampled pages have corrupted Hanja characters (ratio: ${corruptedRatio.toFixed(2)})`;

    return {
      needsVlmReparse,
      severity,
      kcjPageCount: totalTextPages,
      sampledPageCount: sampledCount,
      corruptedRatio,
      reason,
    };
  }

  /**
   * Get page number from a text item
   */
  private getPageNo(text: DoclingTextItem): number {
    return text.prov?.[0]?.page_no ?? 1;
  }

  protected buildSystemPrompt(): string {
    return '';
  }

  protected buildUserPrompt(ocrText: string): string {
    return `You are evaluating the quality of OCR text extraction for Hanja (漢字) characters used in Korean archaeological reports.

Look at the page image and find any Hanja (漢字) characters visible in the original document. Then compare them against the OCR text below.

## Evaluation Criteria
- Find Hanja (漢字) characters in the page image first
- Check if each Hanja character is correctly recognized in the OCR text
- A character is "corrupted" if a Hanja character in the image was replaced by Korean hangul, garbled text, symbols, or a completely different character in the OCR text
- Common corruption patterns: Hanja replaced by similar-looking hangul (e.g., 粘土 → 그으), wrong character substitution, partial recognition, question marks or boxes
- Minor font rendering differences are NOT corruption
- If no Hanja characters are visible in the page image, report as not corrupted with 0 total characters

## OCR Text to Evaluate
${ocrText}

Compare the Hanja characters visible in the page image against the OCR text above and assess whether they were correctly recognized.`;
  }
}
