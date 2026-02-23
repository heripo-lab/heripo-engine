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
 * Schema for Vision LLM response evaluating the role of Hanja characters on a page
 */
const HanjaRoleResponseSchema = z.object({
  hasHanja: z
    .boolean()
    .describe(
      'Whether the page contains any Hanja (Chinese/漢字) characters in the original image',
    ),
  hanjaRole: z
    .enum(['none', 'supplementary', 'essential'])
    .describe(
      'The role of Hanja: "none" if no Hanja found, "supplementary" if Hanja only appears as parenthetical annotations after Korean text, "essential" if the document uses mixed Korean-Hanja text where Hanja is integral to understanding',
    ),
  explanation: z
    .string()
    .describe('Brief explanation of how Hanja is used on this page'),
});

type HanjaRoleResponse = z.infer<typeof HanjaRoleResponseSchema>;

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
 * Determines the role of Hanja (漢字) characters in OCR-processed Korean documents.
 * Samples a subset of pages and uses Vision LLM to classify whether Hanja is used
 * as supplementary annotations (parenthetical, e.g., "한글(漢字)") or as essential
 * text in mixed Korean-Hanja (국한문 혼용) documents.
 *
 * This is used to determine whether a document should be re-parsed using the
 * VLM pipeline when OCR corrupts Hanja characters.
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
   * Assess the role of Hanja characters in the document
   *
   * @param doclingDoc - DoclingDocument to assess
   * @returns Assessment result indicating whether VLM re-parse is needed
   */
  async assess(doclingDoc: DoclingDocument): Promise<HanjaAssessment> {
    const totalPages = Object.keys(doclingDoc.pages).length;
    this.log('info', 'Starting Hanja role assessment...');

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
        hanjaRole: 'none',
        hanjaPageCount: 0,
        sampledPageCount: 0,
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

    // Step 4: Evaluate each sampled page with Vision LLM (early break on essential)
    const results = await this.evaluatePages(sampled);

    // Step 5: Aggregate results
    const assessment = this.aggregateResults(
      textPages.length,
      sampled.length,
      results,
    );

    this.log(
      'info',
      `Assessment complete: hanjaRole=${assessment.hanjaRole}, ` +
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
   * These pages (e.g., photo plates/도판) are unsuitable for Hanja role assessment.
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
   * Evaluate sampled pages using Vision LLM.
   * Stops early when essential Hanja is detected to save VLM calls.
   */
  private async evaluatePages(pages: PageData[]): Promise<HanjaRoleResponse[]> {
    const results: HanjaRoleResponse[] = [];

    for (const page of pages) {
      const result = await this.evaluateSinglePage(page);
      results.push(result);

      if (result.hanjaRole === 'essential') {
        this.log(
          'info',
          `Essential Hanja detected on page ${page.pageNo}, skipping remaining pages`,
        );
        break;
      }
    }

    return results;
  }

  /**
   * Evaluate a single page to determine the role of Hanja characters
   */
  private async evaluateSinglePage(page: PageData): Promise<HanjaRoleResponse> {
    // Page images use 0-based indexing (page_1 -> page_0.png)
    const imagePath = `pages/page_${page.pageNo - 1}.png`;

    let imageContent;
    try {
      imageContent = this.buildImageContent(imagePath);
    } catch {
      this.log(
        'warn',
        `Failed to load page image for page ${page.pageNo}, marking as no Hanja`,
      );
      return {
        hasHanja: false,
        hanjaRole: 'none',
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
      HanjaRoleResponseSchema,
      messages,
      `page-${page.pageNo}`,
    );

    this.log(
      'info',
      `Page ${page.pageNo}: hasHanja=${output.hasHanja}, role=${output.hanjaRole}`,
    );

    return output;
  }

  /**
   * Aggregate individual page results into final assessment
   */
  private aggregateResults(
    totalTextPages: number,
    sampledCount: number,
    results: HanjaRoleResponse[],
  ): HanjaAssessment {
    const essentialCount = results.filter(
      (r) => r.hanjaRole === 'essential',
    ).length;
    const supplementaryCount = results.filter(
      (r) => r.hanjaRole === 'supplementary',
    ).length;

    let hanjaRole: HanjaAssessment['hanjaRole'];
    let needsVlmReparse: boolean;
    let reason: string;

    if (essentialCount > 0) {
      hanjaRole = 'essential';
      needsVlmReparse = true;
      reason = `${essentialCount}/${results.length} sampled pages contain essential Hanja (mixed Korean-Hanja text)`;
    } else if (supplementaryCount > 0) {
      hanjaRole = 'supplementary';
      needsVlmReparse = false;
      reason = `Hanja appears only as parenthetical annotations in ${supplementaryCount}/${results.length} sampled pages`;
    } else {
      hanjaRole = 'none';
      needsVlmReparse = false;
      reason = 'No Hanja characters found in sampled pages';
    }

    return {
      needsVlmReparse,
      hanjaRole,
      hanjaPageCount: totalTextPages,
      sampledPageCount: sampledCount,
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
    return `You are analyzing how Hanja (漢字/Chinese characters) is used in a Korean archaeological report page.

Look at the page image carefully and determine the ROLE of Hanja characters in the document.

## Classification

1. **none**: No Hanja characters appear in the page image.

2. **supplementary**: Hanja appears only in non-essential areas where the Korean text alone is sufficient.
   - Parenthetical annotations: Korean word followed by Hanja in parentheses, e.g., "토기(土器)", "유구(遺構)"
   - Footnotes/endnotes: Hanja appearing only in footnote or endnote sections at the bottom of the page
   - Even if the OCR text shows corrupted Hanja, the main content is understandable without it

3. **essential**: The document uses mixed Korean-Hanja text (국한문 혼용체) where Hanja is integral to the BODY text.
   - Hanja characters appear directly in the body text, not just in parentheses or footnotes
   - Removing Hanja would make sentences incomplete or incomprehensible
   - Example: sentences where Hanja replaces Korean words entirely in the main body

## Important Notes
- Focus on the ORIGINAL page image, not the OCR text (OCR may have corrupted the Hanja)
- A single page with parenthetical Hanja like "유물(遺物)" is "supplementary"
- Hanja appearing ONLY in footnotes/endnotes is "supplementary", not "essential"
- If Hanja appears in the body text (not just parentheses or footnotes), classify as "essential"
- Look at the actual image to determine character usage patterns

## OCR Text (for reference only - may contain corrupted Hanja)
${ocrText}

Examine the page image and classify the role of Hanja characters.`;
  }
}
