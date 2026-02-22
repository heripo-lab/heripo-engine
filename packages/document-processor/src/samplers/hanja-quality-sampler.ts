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
 * Minimum number of KCJ characters on a page to consider it for sampling
 */
const MIN_KCJ_CHARS_THRESHOLD = 5;

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
 * Unicode range regex for KCJ characters (Chinese/Japanese/Korean ideographs)
 *
 * Covers:
 * - KCJ Unified Ideographs (4E00-9FFF)
 * - KCJ Unified Ideographs Extension A (3400-4DBF)
 * - KCJ Compatibility Ideographs (F900-FAFF)
 */
const KCJ_CHAR_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/g;

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
 * Page data with KCJ character density information
 */
interface KcjPageData {
  pageNo: number;
  kcjCharCount: number;
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

    // Step 2: Find ALL pages with KCJ characters (no filtering)
    const kcjPages = this.findKcjPages(doclingDoc);

    if (kcjPages.length === 0) {
      this.log('info', 'No KCJ characters found in document');
      return {
        needsVlmReparse: false,
        severity: 'none',
        kcjPageCount: 0,
        sampledPageCount: 0,
        corruptedRatio: 0,
        reason: 'No KCJ characters found in document',
      };
    }

    this.log(
      'info',
      `Found ${kcjPages.length} pages with KCJ characters (threshold: ${MIN_KCJ_CHARS_THRESHOLD})`,
    );

    // Step 3: Select pages to sample (prefer eligible, non-image pages; fallback to all)
    const sampled = this.selectSamplePages(
      kcjPages,
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
      kcjPages.length,
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
   * Find all pages containing KCJ characters above the threshold.
   * No filtering is applied here — filtering happens during sample selection.
   */
  private findKcjPages(doclingDoc: DoclingDocument): KcjPageData[] {
    const pageMap = new Map<number, { kcjCount: number; texts: string[] }>();

    for (const text of doclingDoc.texts) {
      const pageNo = this.getPageNo(text);
      const kcjChars = text.text.match(KCJ_CHAR_REGEX);
      if (!kcjChars || kcjChars.length === 0) continue;

      const entry = pageMap.get(pageNo) ?? { kcjCount: 0, texts: [] };
      entry.kcjCount += kcjChars.length;
      entry.texts.push(text.text);
      pageMap.set(pageNo, entry);
    }

    return Array.from(pageMap.entries())
      .filter(([, data]) => data.kcjCount >= MIN_KCJ_CHARS_THRESHOLD)
      .map(([pageNo, data]) => ({
        pageNo,
        kcjCharCount: data.kcjCount,
        texts: data.texts,
      }));
  }

  /**
   * Select sample pages with highest KCJ density.
   * Prefers pages in the eligible range (not edge-trimmed) and not image-only.
   * Falls back to all KCJ pages if filtering leaves too few candidates.
   */
  private selectSamplePages(
    kcjPages: KcjPageData[],
    totalPages: number,
    imageOnlyPages: Set<number>,
  ): KcjPageData[] {
    const { frontCutoff, backCutoff } = this.getEligiblePageRange(totalPages);

    // Apply filters: prefer eligible range and non-image pages
    const filtered =
      totalPages > 0
        ? kcjPages.filter(
            (p) =>
              p.pageNo > frontCutoff &&
              p.pageNo <= backCutoff &&
              !imageOnlyPages.has(p.pageNo),
          )
        : kcjPages;

    // Fall back to all KCJ pages if filtering removes everything
    const candidates = filtered.length > 0 ? filtered : kcjPages;

    if (candidates !== filtered) {
      this.log(
        'warn',
        `All KCJ pages were filtered out by edge/image exclusion. Falling back to all ${kcjPages.length} KCJ pages.`,
      );
    }

    const sorted = [...candidates].sort(
      (a, b) => b.kcjCharCount - a.kcjCharCount,
    );
    const count = Math.min(MAX_SAMPLE_PAGES, sorted.length);
    return sorted.slice(0, count);
  }

  /**
   * Evaluate sampled pages using Vision LLM
   */
  private async evaluatePages(
    pages: KcjPageData[],
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
    page: KcjPageData,
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
        totalKcjCharCount: page.kcjCharCount,
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
    totalKcjPages: number,
    sampledCount: number,
    results: HanjaQualityResponse[],
  ): HanjaAssessment {
    const corruptedCount = results.filter((r) => r.isCorrupted).length;
    const corruptedRatio = sampledCount > 0 ? corruptedCount / sampledCount : 0;

    let severity: HanjaAssessment['severity'];
    let needsVlmReparse: boolean;

    if (corruptedRatio >= CORRUPTION_THRESHOLD) {
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
        ? 'No KCJ character corruption detected'
        : `${corruptedCount}/${sampledCount} sampled pages have corrupted KCJ characters (ratio: ${corruptedRatio.toFixed(2)})`;

    return {
      needsVlmReparse,
      severity,
      kcjPageCount: totalKcjPages,
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
    return `You are evaluating the quality of OCR text extraction for KCJ (Chinese/Japanese/Korean) characters, specifically Hanja (漢字) used in Korean archaeological reports.

Compare the KCJ characters in the OCR text below with what you can see in the page image.

## Evaluation Criteria
- Focus ONLY on KCJ ideographic characters (漢字/한자), not Korean hangul (한글)
- A character is "corrupted" if the OCR text shows a wrong character, garbled text, or unrecognizable symbols where a KCJ character should be
- Common corruption patterns: wrong character substitution, partial character recognition, question marks or boxes replacing characters
- Minor font rendering differences are NOT corruption

## OCR Text to Evaluate
${ocrText}

Evaluate the accuracy of the KCJ characters in the OCR text compared to the page image.`;
  }
}
