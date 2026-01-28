import type { LoggerMethods } from '@heripo/logger';
import type { DoclingDocument, DoclingPage, PageRange } from '@heripo/model';
import type {
  ExtendedTokenUsage,
  LLMTokenUsageAggregator,
} from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { PageSizeGroup } from '../types';

import {
  LLMCaller,
  LLMTokenUsageAggregator as LLMTokenUsageAggregatorClass,
} from '@heripo/shared';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

import { VisionLLMComponent } from '../core/vision-llm-component';
import { PageRangeParseError } from './page-range-parse-error';

/**
 * Pattern types for page number sequences
 */
export enum PagePattern {
  /** Simple increment: [1, 2, 3, 4, ...] */
  SIMPLE_INCREMENT = 'simple_increment',
  /** Double-sided scan: [1-2, 3-4, 5-6, ...] */
  DOUBLE_SIDED = 'double_sided',
  /** Offset pattern: PDF page != actual page (consistent offset) */
  OFFSET = 'offset',
  /** No clear pattern detected */
  UNKNOWN = 'unknown',
}

/**
 * Pattern analysis result
 */
interface PatternAnalysis {
  pattern: PagePattern;
  offset: number;
  increment: number;
}

/**
 * Sample extraction result from Vision LLM
 */
interface SampleResult {
  pdfPageNo: number;
  startPageNo: number | null;
  endPageNo: number | null;
}

/**
 * PageRangeParser
 *
 * Extracts actual document page numbers from PDF page images using Vision LLM.
 * Uses random sampling + pattern detection to minimize LLM calls.
 * Extends VisionLLMComponent for standardized vision LLM call handling.
 *
 * ## Algorithm
 *
 * 1. Group pages by size (consecutive pages with same dimensions)
 * 2. For each group:
 *    - If ≤3 pages: send all to LLM at once
 *    - If >3 pages: random sample 3 pages, detect pattern, apply to all
 * 3. Post-process: handle drops, normalize negatives, backfill failed pages
 */
export class PageRangeParser extends VisionLLMComponent {
  // Configuration constants
  private readonly SAMPLE_SIZE = 3;
  private readonly MAX_PATTERN_RETRIES = 6;
  private readonly SIZE_TOLERANCE = 5.0;

  constructor(
    logger: LoggerMethods,
    model: LanguageModel,
    outputPath: string,
    maxRetries: number = 3,
    fallbackModel?: LanguageModel,
    aggregator?: LLMTokenUsageAggregator,
    abortSignal?: AbortSignal,
  ) {
    super(
      logger,
      model,
      'PageRangeParser',
      outputPath,
      { maxRetries, abortSignal },
      fallbackModel,
      aggregator ?? new LLMTokenUsageAggregatorClass(),
    );
  }

  /**
   * Main parse method
   *
   * Extracts page range mapping from DoclingDocument using Vision LLM.
   * Automatically tracks token usage in the aggregator if one was provided.
   *
   * @param doclingDoc - DoclingDocument to extract page ranges from
   * @returns Object with page range mapping and token usage information
   */
  async parse(doclingDoc: DoclingDocument): Promise<{
    pageRangeMap: Record<number, PageRange>;
    usage: ExtendedTokenUsage[];
  }> {
    this.log('info', 'Starting page range parsing...');

    // Step 1: Extract and group pages by size
    const pages = this.extractPages(doclingDoc);
    if (pages.length === 0) {
      this.log('warn', 'No pages found');
      const emptyUsage = this.createEmptyUsage('sampling');
      this.trackUsage(emptyUsage);
      return {
        pageRangeMap: {},
        usage: [emptyUsage],
      };
    }

    const sizeGroups = this.analyzeSizes(pages);
    this.log(
      'info',
      `Found ${sizeGroups.length} size group(s), total ${pages.length} pages`,
    );

    // Step 2: Process each size group
    const pageRangeMap: Record<number, PageRange> = {};
    const usageList: ExtendedTokenUsage[] = [];

    for (let i = 0; i < sizeGroups.length; i++) {
      const group = sizeGroups[i];
      this.log(
        'info',
        `Processing group ${i + 1}/${sizeGroups.length}: ${group.pageNos.length} pages`,
      );

      const groupResult = await this.processGroup(pages, group, this.model);
      Object.assign(pageRangeMap, groupResult.pageRangeMap);
      usageList.push(...groupResult.usage);
    }

    // Step 3: Track all usage in aggregator
    for (const usage of usageList) {
      this.trackUsage(usage);
    }

    // Step 4: Post-processing
    this.postProcess(pageRangeMap);

    this.log(
      'info',
      `Completed: ${Object.keys(pageRangeMap).length} pages mapped`,
    );

    return { pageRangeMap, usage: usageList };
  }

  /**
   * Extract pages array from DoclingDocument
   */
  private extractPages(doclingDoc: DoclingDocument): DoclingPage[] {
    const pageKeys = Object.keys(doclingDoc.pages)
      .map(Number)
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);

    return pageKeys.map((key) => doclingDoc.pages[String(key)]);
  }

  /**
   * Analyze page sizes and group consecutive pages with same dimensions
   */
  private analyzeSizes(pages: DoclingPage[]): PageSizeGroup[] {
    const groups: PageSizeGroup[] = [];
    let currentGroup: PageSizeGroup | null = null;

    for (const page of pages) {
      const sizeKey = this.createSizeKey(page.size.width, page.size.height);

      if (!currentGroup || currentGroup.sizeKey !== sizeKey) {
        // Start new group
        currentGroup = { sizeKey, pageNos: [page.page_no] };
        groups.push(currentGroup);
      } else {
        // Add to current group
        currentGroup.pageNos.push(page.page_no);
      }
    }

    return groups;
  }

  /**
   * Create size key with tolerance for floating point comparison
   */
  private createSizeKey(width: number, height: number): string {
    const roundedWidth = Math.round(width / this.SIZE_TOLERANCE);
    const roundedHeight = Math.round(height / this.SIZE_TOLERANCE);
    return `${roundedWidth}x${roundedHeight}`;
  }

  /**
   * Process a single size group
   */
  private async processGroup(
    pages: DoclingPage[],
    group: PageSizeGroup,
    model: LanguageModel,
  ): Promise<{
    pageRangeMap: Record<number, PageRange>;
    usage: ExtendedTokenUsage[];
  }> {
    const { pageNos } = group;
    const usageList: ExtendedTokenUsage[] = [];

    // Special case: 3 or fewer pages - send all at once
    if (pageNos.length <= this.SAMPLE_SIZE) {
      this.log(
        'info',
        `Small group (${pageNos.length} pages), extracting all at once`,
      );
      const result = await this.extractMultiplePages(pages, pageNos, model);
      usageList.push(result.usage);
      return {
        pageRangeMap: this.samplesToMap(result.samples),
        usage: usageList,
      };
    }

    // Larger groups: random sampling + pattern detection
    const sampledPages = new Set<number>();

    for (let attempt = 0; attempt <= this.MAX_PATTERN_RETRIES; attempt++) {
      // Select 3 random pages (excluding previously sampled if possible)
      const samplePageNos = this.selectRandomSamples(
        pageNos,
        this.SAMPLE_SIZE,
        sampledPages,
      );

      // Track which pages we've sampled
      for (const p of samplePageNos) {
        sampledPages.add(p);
      }

      this.log(
        'info',
        `Attempt ${attempt + 1}/${this.MAX_PATTERN_RETRIES + 1}: sampling pages ${samplePageNos.join(', ')}`,
      );

      // Send all 3 images at once to Vision LLM
      const result = await this.extractMultiplePages(
        pages,
        samplePageNos,
        model,
      );
      usageList.push(result.usage);
      const samples = result.samples;

      // Try to detect pattern
      const pattern = this.detectPattern(samples);

      if (pattern.pattern !== PagePattern.UNKNOWN) {
        // Pattern found! Apply to all pages
        this.log(
          'info',
          `Pattern detected: ${pattern.pattern} (offset=${pattern.offset}, increment=${pattern.increment})`,
        );
        return {
          pageRangeMap: this.applyPattern(pageNos, pattern),
          usage: usageList,
        };
      }

      // Pattern not found - log and retry
      this.log(
        'warn',
        `Pattern detection failed, attempt ${attempt + 1}/${this.MAX_PATTERN_RETRIES + 1}`,
      );
    }

    // All retries exhausted - throw error
    throw new PageRangeParseError(
      `Failed to detect page pattern after ${this.MAX_PATTERN_RETRIES + 1} attempts for size group with ${pageNos.length} pages`,
    );
  }

  /**
   * Select random samples from page numbers
   */
  private selectRandomSamples(
    pageNos: number[],
    count: number,
    exclude: Set<number> = new Set(),
  ): number[] {
    // Get available pages (not previously sampled)
    const available = pageNos.filter((p) => !exclude.has(p));

    // If not enough unsampled pages, allow reuse
    const pool = available.length >= count ? available : pageNos;

    // Fisher-Yates shuffle for random selection
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Return first 'count' elements, sorted by page number for consistency
    return shuffled.slice(0, count).sort((a, b) => a - b);
  }

  /**
   * Extract page numbers from multiple pages in a single LLM call
   */
  private async extractMultiplePages(
    pages: DoclingPage[],
    pageNos: number[],
    model: LanguageModel,
  ): Promise<{ samples: SampleResult[]; usage: ExtendedTokenUsage }> {
    this.log('info', `Extracting ${pageNos.length} pages in single LLM call`);

    // Build image content array
    const imageContents: Array<{ type: 'image'; image: string }> = [];

    for (const pageNo of pageNos) {
      const page = pages[pageNo - 1];
      const imagePath = path.resolve(this.outputPath, page.image.uri);
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = page.image.mimetype || 'image/png';

      imageContents.push({
        type: 'image',
        image: `data:${mimeType};base64,${base64Image}`,
      });
    }

    // Build schema for multi-page response
    const schema = z.object({
      pages: z
        .array(
          z.object({
            imageIndex: z
              .number()
              .describe('0-based index of the image in the request'),
            startPageNo: z
              .number()
              .nullable()
              .describe('Start page number (null if not found)'),
            endPageNo: z
              .number()
              .nullable()
              .describe(
                'End page number for double-sided scans (null for single page)',
              ),
          }),
        )
        .describe('Extracted page numbers for each image'),
    });

    try {
      const result = await LLMCaller.callVision({
        schema,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: this.buildUserPrompt(pageNos) },
              ...imageContents,
            ],
          },
        ],
        primaryModel: model,
        fallbackModel: this.fallbackModel,
        maxRetries: this.maxRetries,
        temperature: 0,
        abortSignal: this.abortSignal,
        component: 'PageRangeParser',
        phase: 'sampling',
      });

      // Convert response to SampleResult array
      const samples = result.output.pages.map((p) => ({
        pdfPageNo: pageNos[p.imageIndex],
        startPageNo: p.startPageNo,
        endPageNo: p.endPageNo,
      }));

      return { samples, usage: result.usage };
    } catch (error) {
      this.log('error', 'Multi-image extraction failed:', error);
      throw PageRangeParseError.fromError(
        'Multi-image extraction failed',
        error,
      );
    }
  }

  /**
   * Detect pattern from sample results
   */
  private detectPattern(samples: SampleResult[]): PatternAnalysis {
    // Filter out null results
    const validSamples = samples.filter((s) => s.startPageNo !== null);

    if (validSamples.length < 2) {
      return { pattern: PagePattern.UNKNOWN, offset: 0, increment: 1 };
    }

    // Sort by PDF page number
    validSamples.sort((a, b) => a.pdfPageNo - b.pdfPageNo);

    // Check for SIMPLE_INCREMENT pattern
    const isSimple = validSamples.every((s, i) => {
      // startPageNo should equal endPageNo (or endPageNo is null)
      if (s.endPageNo !== null && s.startPageNo !== s.endPageNo) return false;
      if (i === 0) return true;
      const prev = validSamples[i - 1];
      const expectedIncrease = s.pdfPageNo - prev.pdfPageNo;
      return s.startPageNo === prev.startPageNo! + expectedIncrease;
    });

    if (isSimple) {
      const firstSample = validSamples[0];
      const offset = firstSample.startPageNo! - firstSample.pdfPageNo;
      return { pattern: PagePattern.SIMPLE_INCREMENT, offset, increment: 1 };
    }

    // Check for DOUBLE_SIDED pattern
    // Each PDF page contains 2 actual pages: [startPageNo, startPageNo+1]
    // Formula: startPageNo = pdfPageNo * 2 + offset (where offset is usually -1 for 1-based)
    const isDoubleSided = validSamples.every((s, i) => {
      // Each page must have endPageNo = startPageNo + 1
      if (s.endPageNo === null) return false;
      if (s.endPageNo !== s.startPageNo! + 1) return false;
      if (i === 0) return true;

      // For non-consecutive samples, check the formula consistency
      // startPageNo should follow: pdfPageNo * 2 + offset
      const prev = validSamples[i - 1];
      const pdfDiff = s.pdfPageNo - prev.pdfPageNo;
      const expectedStartDiff = pdfDiff * 2; // Each PDF page = 2 actual pages
      const actualStartDiff = s.startPageNo! - prev.startPageNo!;
      return actualStartDiff === expectedStartDiff;
    });

    if (isDoubleSided) {
      const firstSample = validSamples[0];
      const offset = firstSample.startPageNo! - firstSample.pdfPageNo * 2;
      return { pattern: PagePattern.DOUBLE_SIDED, offset, increment: 2 };
    }

    // Check for OFFSET pattern (consistent offset with ±1 tolerance)
    const offsets = validSamples.map((s) => s.startPageNo! - s.pdfPageNo);
    const avgOffset = Math.round(
      offsets.reduce((a, b) => a + b, 0) / offsets.length,
    );
    const isConsistentOffset = offsets.every(
      (o) => Math.abs(o - avgOffset) <= 1,
    );

    if (isConsistentOffset) {
      return { pattern: PagePattern.OFFSET, offset: avgOffset, increment: 1 };
    }

    return { pattern: PagePattern.UNKNOWN, offset: 0, increment: 1 };
  }

  /**
   * Apply detected pattern to generate page range map
   */
  private applyPattern(
    pageNos: number[],
    pattern: PatternAnalysis,
  ): Record<number, PageRange> {
    const result: Record<number, PageRange> = {};

    for (const pdfPageNo of pageNos) {
      switch (pattern.pattern) {
        case PagePattern.SIMPLE_INCREMENT:
        case PagePattern.OFFSET: {
          const pageNo = pdfPageNo + pattern.offset;
          result[pdfPageNo] = {
            startPageNo: pageNo,
            endPageNo: pageNo,
          };
          break;
        }

        case PagePattern.DOUBLE_SIDED: {
          const start = pdfPageNo * 2 + pattern.offset;
          result[pdfPageNo] = {
            startPageNo: start,
            endPageNo: start + 1,
          };
          break;
        }

        default:
          result[pdfPageNo] = { startPageNo: 0, endPageNo: 0 };
      }
    }

    return result;
  }

  /**
   * Convert sample results to page range map (for small groups)
   */
  private samplesToMap(samples: SampleResult[]): Record<number, PageRange> {
    const result: Record<number, PageRange> = {};

    for (const sample of samples) {
      if (sample.startPageNo !== null) {
        result[sample.pdfPageNo] = {
          startPageNo: sample.startPageNo,
          endPageNo: sample.endPageNo ?? sample.startPageNo,
        };
      } else {
        result[sample.pdfPageNo] = { startPageNo: 0, endPageNo: 0 };
      }
    }

    return result;
  }

  /**
   * Post-process the page range map
   */
  private postProcess(pageRangeMap: Record<number, PageRange>): void {
    // Order matters:
    // 1. Detect outliers (abnormally high values at beginning)
    // 2. Handle drops
    // 3. Normalize negatives
    // 4. Backfill failed pages
    this.detectAndHandleOutliers(pageRangeMap);
    this.detectAndHandleDrops(pageRangeMap);
    this.normalizeNegatives(pageRangeMap);
    this.backfillFailedPages(pageRangeMap);
  }

  /**
   * Detect and handle outlier page numbers at the beginning of document
   *
   * When early PDF pages have abnormally high page numbers compared to
   * subsequent pages (e.g., PDF 1-9 = 75-83, but PDF 10+ = 2,3,4...),
   * the LLM likely misread figure/photo numbers as page numbers.
   *
   * Detection: If page numbers at the beginning are significantly higher
   * than subsequent pages (which follow a normal pattern), mark them as failed.
   */
  private detectAndHandleOutliers(
    pageRangeMap: Record<number, PageRange>,
  ): void {
    const pdfPages = Object.keys(pageRangeMap)
      .map(Number)
      .sort((a, b) => a - b);

    if (pdfPages.length < 3) return;

    // Find the first "normal" sequence (at least 3 consecutive pages following a pattern)
    const normalSequenceStart = this.findNormalSequenceStart(
      pageRangeMap,
      pdfPages,
    );

    if (normalSequenceStart === null || normalSequenceStart <= 0) return;

    const normalStartPdfPage = pdfPages[normalSequenceStart];
    const normalStartPageNo = pageRangeMap[normalStartPdfPage].startPageNo;

    // Check if pages before the normal sequence are outliers
    // (their page numbers are much higher than what they should be)
    let hasOutliers = false;
    for (let i = 0; i < normalSequenceStart; i++) {
      const pdfPage = pdfPages[i];
      const pageNo = pageRangeMap[pdfPage].startPageNo;

      if (pageNo === 0) continue;

      // Calculate expected page number based on the normal sequence
      const pdfDiff = normalStartPdfPage - pdfPage;

      // For double-sided: each PDF page = 2 actual pages
      const isDoubleSided = this.isDoubleSidedRange(
        pageRangeMap[normalStartPdfPage],
      );
      const expectedPageNo = isDoubleSided
        ? normalStartPageNo - pdfDiff * 2
        : normalStartPageNo - pdfDiff;

      // If actual page number is significantly higher than expected, it's an outlier
      // Use threshold: actual > expected + 10 (to avoid false positives)
      if (pageNo > expectedPageNo + 10) {
        this.log(
          'info',
          `Outlier detected: PDF ${pdfPage}=${pageNo} (expected ~${expectedPageNo})`,
        );
        pageRangeMap[pdfPage] = { startPageNo: 0, endPageNo: 0 };
        hasOutliers = true;
      }
    }

    if (hasOutliers) {
      this.log('info', `Outliers marked as failed, will be backfilled later`);
    }
  }

  /**
   * Find the start index of a "normal" sequence in the page range map
   *
   * A normal sequence is defined as at least 3 consecutive PDF pages where:
   * - Page numbers are increasing (for single-page) or increasing by 2 (for double-sided)
   * - The pattern is consistent
   *
   * Returns the index in pdfPages array, or null if not found.
   */
  private findNormalSequenceStart(
    pageRangeMap: Record<number, PageRange>,
    pdfPages: number[],
  ): number | null {
    const MIN_SEQUENCE_LENGTH = 3;

    for (
      let startIdx = 0;
      startIdx <= pdfPages.length - MIN_SEQUENCE_LENGTH;
      startIdx++
    ) {
      let isValidSequence = true;
      let expectedIncrement: number | null = null;

      for (let i = 0; i < MIN_SEQUENCE_LENGTH - 1; i++) {
        const currPdfPage = pdfPages[startIdx + i];
        const nextPdfPage = pdfPages[startIdx + i + 1];
        const currRange = pageRangeMap[currPdfPage];
        const nextRange = pageRangeMap[nextPdfPage];

        // Skip if either has failed extraction
        if (currRange.startPageNo === 0 || nextRange.startPageNo === 0) {
          isValidSequence = false;
          break;
        }

        // Calculate increment
        const pageIncrement = nextRange.startPageNo - currRange.startPageNo;
        const pdfIncrement = nextPdfPage - currPdfPage;

        // Determine expected increment (1 for single-page, 2 for double-sided per PDF page)
        const isDoubleSided = this.isDoubleSidedRange(currRange);
        const expectedIncrementPerPdf = isDoubleSided ? 2 : 1;
        const expected = pdfIncrement * expectedIncrementPerPdf;

        if (expectedIncrement === null) {
          expectedIncrement = pageIncrement;
        }

        // Check if increment is reasonable (should match expected pattern)
        if (pageIncrement !== expected) {
          isValidSequence = false;
          break;
        }
      }

      if (isValidSequence) {
        return startIdx;
      }
    }

    return null;
  }

  /**
   * Check if a page range represents a double-sided scan
   */
  private isDoubleSidedRange(range: PageRange): boolean {
    return (
      range.endPageNo !== null &&
      range.endPageNo !== range.startPageNo &&
      range.endPageNo === range.startPageNo + 1
    );
  }

  /**
   * Detect and handle page number drops
   *
   * When page numbers suddenly decrease (e.g., 8,9 -> 3,4),
   * recalculate previous pages based on the drop point.
   */
  private detectAndHandleDrops(pageRangeMap: Record<number, PageRange>): void {
    const pdfPages = Object.keys(pageRangeMap)
      .map(Number)
      .sort((a, b) => a - b);

    if (pdfPages.length < 2) return;

    for (let i = 1; i < pdfPages.length; i++) {
      const prevPdfPage = pdfPages[i - 1];
      const currPdfPage = pdfPages[i];
      const prevPageNo = pageRangeMap[prevPdfPage].startPageNo;
      const currPageNo = pageRangeMap[currPdfPage].startPageNo;

      // Skip if either is 0 (extraction failed)
      if (prevPageNo === 0 || currPageNo === 0) continue;

      // Detect significant drop (more than 1)
      if (
        currPageNo > 0 &&
        prevPageNo > currPageNo &&
        prevPageNo - currPageNo > 1
      ) {
        this.log(
          'info',
          `Page drop detected: PDF ${prevPdfPage}=${prevPageNo} -> PDF ${currPdfPage}=${currPageNo}`,
        );

        // Determine if the reference page is double-sided
        const isDoubleSided = this.isDoubleSidedRange(
          pageRangeMap[currPdfPage],
        );

        // Recalculate all previous pages based on drop point
        for (let j = i - 1; j >= 0; j--) {
          const pdfPage = pdfPages[j];
          const distance = currPdfPage - pdfPage;

          if (isDoubleSided) {
            // Double-sided: each PDF page = 2 actual pages
            const expectedStartPageNo = currPageNo - distance * 2;

            if (expectedStartPageNo < 1) {
              pageRangeMap[pdfPage] = { startPageNo: 0, endPageNo: 0 };
            } else {
              pageRangeMap[pdfPage] = {
                startPageNo: expectedStartPageNo,
                endPageNo: expectedStartPageNo + 1,
              };
            }
          } else {
            // Single-page pattern
            const expectedPageNo = currPageNo - distance;

            if (expectedPageNo < 1) {
              pageRangeMap[pdfPage] = { startPageNo: 0, endPageNo: 0 };
            } else {
              pageRangeMap[pdfPage] = {
                startPageNo: expectedPageNo,
                endPageNo: expectedPageNo,
              };
            }
          }
          this.log(
            'info',
            `Recalculated PDF ${pdfPage} -> ${pageRangeMap[pdfPage].startPageNo}`,
          );
        }
      }
    }
  }

  /**
   * Normalize negative page numbers to 0
   */
  private normalizeNegatives(pageRangeMap: Record<number, PageRange>): void {
    for (const [pdfPageStr, range] of Object.entries(pageRangeMap)) {
      if (range.startPageNo < 0 || range.endPageNo < 0) {
        this.log('info', `Normalizing negative: PDF ${pdfPageStr} -> 0`);
        pageRangeMap[Number(pdfPageStr)] = { startPageNo: 0, endPageNo: 0 };
      }
    }
  }

  /**
   * Backfill pages marked with 0 using detected pattern
   */
  private backfillFailedPages(pageRangeMap: Record<number, PageRange>): void {
    const pdfPages = Object.keys(pageRangeMap)
      .map(Number)
      .sort((a, b) => a - b);

    // Find pages with startPageNo === 0 (extraction failed)
    const failedPages = pdfPages.filter(
      (p) => pageRangeMap[p].startPageNo === 0,
    );
    if (failedPages.length === 0) return;

    // Find successful pages to detect pattern
    const successfulPages = pdfPages
      .filter((p) => pageRangeMap[p].startPageNo > 0)
      .map((p) => ({
        pdfPage: p,
        pageNo: pageRangeMap[p].startPageNo,
        isDoubleSided: this.isDoubleSidedRange(pageRangeMap[p]),
      }));

    if (successfulPages.length < 2) {
      this.log('warn', 'Not enough successful pages for backfill');
      return;
    }

    // Detect if this is a double-sided pattern
    const doubleSidedCount = successfulPages.filter(
      (s) => s.isDoubleSided,
    ).length;
    const isDoubleSided = doubleSidedCount > successfulPages.length / 2;

    if (isDoubleSided) {
      // For double-sided: calculate offset using formula startPageNo = pdfPage * 2 + offset
      const offsets = successfulPages.map((s) => s.pageNo - s.pdfPage * 2);
      const avgOffset = Math.round(
        offsets.reduce((a, b) => a + b, 0) / offsets.length,
      );

      this.log(
        'info',
        `Backfilling ${failedPages.length} pages with double-sided pattern (offset=${avgOffset})`,
      );

      for (const pdfPage of failedPages) {
        const expectedStartPageNo = pdfPage * 2 + avgOffset;

        if (expectedStartPageNo < 1) {
          this.log(
            'info',
            `Backfill skipped for PDF ${pdfPage} (would be ${expectedStartPageNo})`,
          );
          // Mark as cover/intro page with 0
          continue;
        }

        this.log(
          'info',
          `Backfill PDF ${pdfPage}: 0 -> ${expectedStartPageNo}-${expectedStartPageNo + 1}`,
        );
        pageRangeMap[pdfPage] = {
          startPageNo: expectedStartPageNo,
          endPageNo: expectedStartPageNo + 1,
        };
      }
    } else {
      // For single-page: calculate simple offset
      const offsets = successfulPages.map((s) => s.pageNo - s.pdfPage);
      const avgOffset = Math.round(
        offsets.reduce((a, b) => a + b, 0) / offsets.length,
      );

      this.log(
        'info',
        `Backfilling ${failedPages.length} pages with offset ${avgOffset}`,
      );

      for (const pdfPage of failedPages) {
        const expectedPageNo = pdfPage + avgOffset;

        if (expectedPageNo < 1) {
          this.log(
            'info',
            `Backfill skipped for PDF ${pdfPage} (would be ${expectedPageNo})`,
          );
          continue;
        }

        this.log('info', `Backfill PDF ${pdfPage}: 0 -> ${expectedPageNo}`);
        pageRangeMap[pdfPage] = {
          startPageNo: expectedPageNo,
          endPageNo: expectedPageNo,
        };
      }
    }
  }

  /**
   * Build system prompt for Vision LLM
   */
  protected buildSystemPrompt(): string {
    return `You are a page number extraction specialist for document images.
You will receive multiple document page images. For EACH image, extract the visible page number(s).

**SCAN TYPES:**
1. SINGLE PAGE: One document page per image. Return startPageNo only, endPageNo should be null.
2. DOUBLE-SIDED: Two document pages per image (spread). Return startPageNo (left) and endPageNo (right).

**WHERE TO LOOK:**
- Bottom center, bottom corners (most common)
- Top corners (less common)
- Page numbers are SMALL numbers in MARGINS, NOT in content area

**WHAT TO IGNORE - These are NOT page numbers:**
- Roman numerals (i, ii, iii, iv, v...) - return null
- Figure numbers: "Figure 5", "Fig. 5", "도 5", "그림 5"
- Table numbers: "Table 3", "표 3"
- Photo numbers: "Photo 8", "사진 8", "Plate 4", "도판 4"
- Years in content: "2015", "(1998)"
- Any numbers with text prefix or inside content area

**RESPONSE FORMAT:**
For each image (in order), provide:
- imageIndex: 0-based index of the image
- startPageNo: The page number found (null if not visible/readable)
- endPageNo: Right page number for double-sided scans (null for single pages)`;
  }

  /**
   * Build user prompt for Vision LLM
   */
  protected buildUserPrompt(pageNos: number[]): string {
    return `I am providing ${pageNos.length} document page images.
These are PDF pages: ${pageNos.join(', ')}.

For each image (in order), extract the visible page number(s).
Return null for pages where no page number is visible or readable.

Remember: Look for SMALL numbers in MARGINS only. Ignore figure/table/photo numbers.`;
  }
}
