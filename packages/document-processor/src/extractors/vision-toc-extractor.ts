import type { LoggerMethods } from '@heripo/logger';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import {
  LLMCaller,
  LLMTokenUsageAggregator as LLMTokenUsageAggregatorClass,
} from '@heripo/shared';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

import {
  VisionLLMComponent,
  type VisionLLMComponentOptions,
} from '../core/vision-llm-component';

/**
 * Schema for vision-based TOC extraction response
 */
export const VisionTocExtractionSchema = z.object({
  hasToc: z.boolean().describe('Whether a TOC is visible on these pages'),
  tocMarkdown: z
    .string()
    .nullable()
    .describe('Extracted TOC in markdown format, null if not found'),
  continuesOnNextPage: z
    .boolean()
    .describe('Whether TOC continues beyond these pages'),
});

export type VisionTocExtractionResult = z.infer<
  typeof VisionTocExtractionSchema
>;

/**
 * Options for VisionTocExtractor
 */
export interface VisionTocExtractorOptions extends VisionLLMComponentOptions {
  /**
   * Number of pages for first batch (default: 10)
   */
  firstBatchSize?: number;

  /**
   * Number of pages for second batch (default: 10)
   */
  secondBatchSize?: number;
}

/**
 * VisionTocExtractor
 *
 * Uses vision LLM to find and extract TOC directly from page images.
 * Fallback strategy when rule-based extraction fails or produces invalid content.
 * Extends VisionLLMComponent for standardized vision LLM call handling.
 *
 * Output format matches MarkdownConverter.convert() for consistency.
 */
export class VisionTocExtractor extends VisionLLMComponent {
  private readonly firstBatchSize: number;
  private readonly secondBatchSize: number;

  constructor(
    logger: LoggerMethods,
    model: LanguageModel,
    outputPath: string,
    options?: VisionTocExtractorOptions,
    fallbackModel?: LanguageModel,
    aggregator?: LLMTokenUsageAggregator,
  ) {
    super(
      logger,
      model,
      'VisionTocExtractor',
      outputPath,
      options,
      fallbackModel,
      aggregator ?? new LLMTokenUsageAggregatorClass(),
    );
    this.firstBatchSize = options?.firstBatchSize ?? 10;
    this.secondBatchSize = options?.secondBatchSize ?? 10;
  }

  /**
   * Extract TOC from page images
   *
   * Searches pages 1-10 first, then 11-20 if not found.
   *
   * @param totalPages - Total number of pages in the document
   * @returns Extracted TOC markdown or null if not found
   */
  async extract(totalPages: number): Promise<string | null> {
    this.log('info', `Starting TOC extraction from ${totalPages} pages`);

    if (totalPages === 0) {
      this.log('info', 'No pages to search');
      return null;
    }

    // First batch: pages 1-10 (or fewer if document is smaller)
    const firstBatchEnd = Math.min(this.firstBatchSize, totalPages);
    this.log('info', `Searching first batch: pages 1-${firstBatchEnd}`);

    const firstResult = await this.extractFromBatch(1, firstBatchEnd);

    if (firstResult.hasToc && firstResult.tocMarkdown) {
      // Check if TOC continues
      if (firstResult.continuesOnNextPage && firstBatchEnd < totalPages) {
        this.log('info', 'TOC continues on next pages, extracting more');
        const continuationEnd = Math.min(
          firstBatchEnd + this.secondBatchSize,
          totalPages,
        );
        const continuationResult = await this.extractFromBatch(
          firstBatchEnd + 1,
          continuationEnd,
        );

        if (continuationResult.hasToc && continuationResult.tocMarkdown) {
          const merged = this.mergeMarkdown(
            firstResult.tocMarkdown,
            continuationResult.tocMarkdown,
          );
          this.aggregator!.logSummary(this.logger);
          this.log(
            'info',
            `TOC extracted with continuation (${merged.length} chars)`,
          );
          return merged;
        }
      }

      this.aggregator!.logSummary(this.logger);
      this.log(
        'info',
        `TOC found in first batch (${firstResult.tocMarkdown.length} chars)`,
      );
      return firstResult.tocMarkdown;
    }

    // Second batch: pages 11-20 (only if first batch didn't find TOC)
    if (firstBatchEnd < totalPages) {
      const secondBatchStart = firstBatchEnd + 1;
      const secondBatchEnd = Math.min(
        firstBatchEnd + this.secondBatchSize,
        totalPages,
      );

      this.log(
        'info',
        `Searching second batch: pages ${secondBatchStart}-${secondBatchEnd}`,
      );

      const secondResult = await this.extractFromBatch(
        secondBatchStart,
        secondBatchEnd,
      );

      if (secondResult.hasToc && secondResult.tocMarkdown) {
        this.aggregator!.logSummary(this.logger);
        this.log(
          'info',
          `TOC found in second batch (${secondResult.tocMarkdown.length} chars)`,
        );
        return secondResult.tocMarkdown;
      }
    }

    this.aggregator!.logSummary(this.logger);
    this.log('info', 'TOC not found in any batch');
    return null;
  }

  /**
   * Extract TOC from a specific batch of pages
   */
  private async extractFromBatch(
    startPage: number,
    endPage: number,
  ): Promise<VisionTocExtractionResult> {
    this.log('info', `Extracting from pages ${startPage}-${endPage}`);

    this.log(
      'info',
      `Preparing images for vision analysis. This can be very slow (10+ minutes, sometimes 30+ minutes) depending on batch size and image resolution.`,
    );
    const imageContents = this.loadPageImages(startPage, endPage);

    this.log(
      'info',
      `Calling vision LLM for TOC extraction (pages ${startPage}-${endPage})`,
    );
    const result = await LLMCaller.callVision({
      schema: VisionTocExtractionSchema,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: this.buildUserPrompt(startPage, endPage),
            },
            ...imageContents,
          ],
        },
      ],
      primaryModel: this.model,
      fallbackModel: this.fallbackModel,
      maxRetries: this.maxRetries,
      temperature: this.temperature,
      abortSignal: this.abortSignal,
      component: 'VisionTocExtractor',
      phase: 'extraction',
    });
    this.log(
      'info',
      `Vision LLM call completed (pages ${startPage}-${endPage})`,
    );

    this.trackUsage(result.usage);

    return result.output;
  }

  /**
   * Load page images and build message content
   */
  private loadPageImages(
    startPage: number,
    endPage: number,
  ): Array<{ type: 'image'; image: string }> {
    const imageContents: Array<{ type: 'image'; image: string }> = [];

    for (let pageNo = startPage; pageNo <= endPage; pageNo++) {
      // Page files are 0-indexed: page_0.png, page_1.png, etc.
      const imagePath = path.resolve(
        this.outputPath,
        `pages/page_${pageNo - 1}.png`,
      );
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');

      imageContents.push({
        type: 'image',
        image: `data:image/png;base64,${base64Image}`,
      });
    }

    return imageContents;
  }

  /**
   * Merge markdown from multiple batches
   */
  private mergeMarkdown(first: string, continuation: string): string {
    return `${first.trim()}\n${continuation.trim()}`;
  }

  /**
   * Build system prompt for vision LLM (not used, but required by abstract class)
   */
  protected buildSystemPrompt(): string {
    return '';
  }

  /**
   * Build user prompt with page range information
   */
  protected buildUserPrompt(startPage: number, endPage: number): string {
    const pageCount = endPage - startPage + 1;
    return `You are a document analysis specialist. Your task is to find and extract the Table of Contents (TOC) from document page images.

I am providing ${pageCount} document page images (pages ${startPage}-${endPage}).

## How to Identify TOC Pages:
- TOC typically appears in the first 10-20 pages of a document
- Look for pages with a heading that indicates "Table of Contents":
  - Korean: "목차", "차례", "목 차"
  - Hanja (Chinese characters used in Korean documents): "目次", "目 次"
  - English: "Contents", "Table of Contents"
- The heading may appear in decorative or stylized fonts on a textured background
- Below the heading, look for structured lists with chapter/section titles and page numbers connected by dots or leaders

## How to Distinguish Main TOC from Supplementary Indices:
- **Main TOC** (EXTRACT THIS): The heading is simply "목차", "目次", "Contents" with NO prefix qualifier. It lists chapters/sections of the document body.
- **Supplementary indices** (DO NOT EXTRACT): The heading has a prefix qualifier specifying a resource type:
  - Photo indices: "사진 목차", "사진목차", "寫眞 目次", "寫眞目次"
  - Drawing/figure indices: "도면 목차", "도면목차", "圖面 目次", "圖面目次"
  - Table indices: "표 목차", "표목차", "表 目次", "表目次"
- Key rule: If the heading contains a qualifier word BEFORE "목차"/"目次"/"Contents", it is a supplementary index. Only extract content from pages whose heading is the unqualified "목차"/"目次"/"Contents".

## What to Extract:
Extract the TOC content as markdown format with this exact structure:
- Use "- " prefix for each list item
- Use 2-space indentation for hierarchy levels
- Include "..... " followed by page number at the end of each entry
- Preserve original chapter/section numbering from the document
- Preserve the original language of titles (Korean, Hanja, English, or mixed)

## Output Format Examples:

### Example 1: Standard Korean TOC
\`\`\`
- 제1장 서론 ..... 1
  - 1. 연구 배경 ..... 3
  - 2. 연구 목적 ..... 5
- 제2장 연구 방법 ..... 10
  - 1. 조사 지역 ..... 10
  - 2. 조사 방법 ..... 15
- 제3장 연구 결과 ..... 25
\`\`\`

### Example 2: Mixed Hanja-Korean TOC (common in archaeological reports)
\`\`\`
- Ⅰ. 調査概要 ..... 175
- Ⅱ. 調査地域의 環境 ..... 177
- Ⅲ. 調査内容 ..... 199
  - 1. 조사지역 퇴적양상 ..... 199
  - 2. 유적 조사내용 ..... 200
- Ⅳ. 調査結果 ..... 228
\`\`\`

## Important Rules:
1. Extract ONLY the main document TOC (the one with unqualified heading "목차"/"目次"/"Contents")
2. DO NOT include supplementary indices (those with prefixed headings like "사진 목차", "寫眞 目次", "圖面 目次", "表 目次", etc.)
3. Page numbers can be any valid positive integer - documents in compiled volumes may have high page numbers (e.g., 175, 228, 500+). This is normal and expected.
4. Some pages in the batch may be photographs, illustrations, blank pages, or other non-text content with no TOC. Skip these pages.
5. If no TOC is found, set hasToc to false and tocMarkdown to null
6. Set continuesOnNextPage to true if the TOC appears to continue beyond the visible pages

Please examine these pages and:
1. Determine if any page contains a main document Table of Contents
2. If found, extract the complete TOC in markdown format
3. Indicate if the TOC continues beyond these pages

Remember: Extract the main document TOC only. Ignore photo/table/figure/drawing indices.`;
  }
}
