import type { LoggerMethods } from '@heripo/logger';
import type {
  Chapter,
  DoclingTextItem,
  PageRange,
  ProcessedFootnote,
  ProcessedImage,
  ProcessedTable,
  TextBlock,
} from '@heripo/model';

import type { TocEntry } from '../types';
import type { IdGenerator } from '../utils';

import { TextCleaner } from '../utils';

/**
 * Flattened chapter with TOC page number for range calculation
 */
interface FlatChapter {
  chapter: Chapter;
  tocPageNo: number;
}

/**
 * Chapter page range for content assignment
 */
interface ChapterRange {
  startPage: number;
  endPage: number;
}

/**
 * ChapterConverter
 *
 * Converts TocEntry[] to Chapter[] with text blocks, images, and tables.
 *
 * ## Conversion Process
 *
 * 1. Create Front Matter chapter (ch-000) for pre-TOC content
 * 2. Build chapter tree from TocEntry[] (recursive)
 * 3. Calculate page ranges for each chapter
 * 4. Assign text blocks to chapters based on page ranges
 * 5. Link images/tables to chapters based on page ranges
 *
 * ## Page Assignment Strategy
 *
 * Uses "start page first" strategy: resources are assigned to the chapter
 * whose startPage is the largest value that is still <= the resource's page.
 *
 * ## Front Matter
 *
 * A special chapter (ch-000) is always created to hold content that appears
 * before the first TOC entry (e.g., cover, preface, table of contents itself).
 */
export class ChapterConverter {
  private static readonly FRONT_MATTER_ID = 'ch-000';
  private static readonly FRONT_MATTER_TITLE = 'Front Matter';

  private readonly logger: LoggerMethods;
  private readonly idGenerator: IdGenerator;

  constructor(logger: LoggerMethods, idGenerator: IdGenerator) {
    this.logger = logger;
    this.idGenerator = idGenerator;
  }

  /**
   * Convert TocEntry[] to Chapter[]
   *
   * @param tocEntries - Table of contents entries
   * @param textItems - DoclingDocument.texts (with prov for page numbers)
   * @param pageRangeMap - PDF page to actual page mapping
   * @param images - Converted images
   * @param tables - Converted tables
   * @param footnotes - Converted footnotes
   * @returns Converted chapters with text blocks and resource references
   */
  convert(
    tocEntries: TocEntry[],
    textItems: DoclingTextItem[],
    pageRangeMap: Record<number, PageRange>,
    images: ProcessedImage[],
    tables: ProcessedTable[],
    footnotes: ProcessedFootnote[],
  ): Chapter[] {
    this.logger.info('[ChapterConverter] Starting chapter conversion...');

    // Step 1: Create Front Matter chapter
    const frontMatter = this.createFrontMatterChapter();

    // Step 2: Build chapter tree from TOC
    const tocChapters = this.buildChapterTree(tocEntries);
    this.logger.info(
      `[ChapterConverter] Built ${tocChapters.length} TOC chapters + Front Matter`,
    );

    // Step 3: Combine all chapters (Front Matter first)
    const allChapters = [frontMatter, ...tocChapters];

    // Step 4: Calculate page ranges
    const flatChapters = this.flattenChapters(allChapters);
    const chapterRanges = this.calculatePageRanges(flatChapters, tocEntries);
    this.logger.info(
      `[ChapterConverter] Calculated ranges for ${chapterRanges.size} chapters`,
    );

    // Step 5: Convert and assign text blocks
    const textBlocks = this.convertTextBlocks(textItems, pageRangeMap);
    this.assignTextBlocks(allChapters, textBlocks, chapterRanges, pageRangeMap);
    this.logger.info(
      `[ChapterConverter] Assigned ${textBlocks.length} text blocks`,
    );

    // Step 6: Link resources
    this.linkResources(
      allChapters,
      images,
      tables,
      footnotes,
      chapterRanges,
      pageRangeMap,
    );
    this.logger.info(
      `[ChapterConverter] Linked ${images.length} images, ${tables.length} tables, and ${footnotes.length} footnotes`,
    );

    return allChapters;
  }

  /**
   * Create Front Matter chapter for pre-TOC content
   */
  private createFrontMatterChapter(): Chapter {
    return {
      id: ChapterConverter.FRONT_MATTER_ID,
      originTitle: ChapterConverter.FRONT_MATTER_TITLE,
      title: ChapterConverter.FRONT_MATTER_TITLE,
      pageNo: 1,
      level: 1,
      textBlocks: [],
      imageIds: [],
      tableIds: [],
      footnoteIds: [],
    };
  }

  /**
   * Build chapter tree from TocEntry[]
   * Recursively processes children
   */
  private buildChapterTree(entries: TocEntry[]): Chapter[] {
    return entries.map((entry) => {
      const chapterId = this.idGenerator.generateChapterId();

      const chapter: Chapter = {
        id: chapterId,
        originTitle: entry.title,
        title: TextCleaner.normalize(entry.title),
        pageNo: entry.pageNo,
        level: entry.level,
        textBlocks: [],
        imageIds: [],
        tableIds: [],
        footnoteIds: [],
      };

      if (entry.children && entry.children.length > 0) {
        chapter.children = this.buildChapterTree(entry.children);
      }

      return chapter;
    });
  }

  /**
   * Flatten chapter tree for page range calculation
   * Preserves original TOC page numbers
   */
  private flattenChapters(chapters: Chapter[]): FlatChapter[] {
    const result: FlatChapter[] = [];

    const flatten = (chapterList: Chapter[]): void => {
      for (const chapter of chapterList) {
        result.push({
          chapter,
          tocPageNo: chapter.pageNo,
        });

        if (chapter.children && chapter.children.length > 0) {
          flatten(chapter.children);
        }
      }
    };

    flatten(chapters);
    return result;
  }

  /**
   * Calculate page range for each chapter
   * Uses next chapter's start page as end boundary
   *
   * Front Matter (ch-000) gets special handling:
   * - startPage: 1
   * - endPage: first TOC entry's page - 1 (or 0 if TOC starts at page 1)
   */
  private calculatePageRanges(
    flatChapters: FlatChapter[],
    tocEntries: TocEntry[],
  ): Map<string, ChapterRange> {
    const ranges = new Map<string, ChapterRange>();

    if (flatChapters.length === 0) {
      return ranges;
    }

    // Find first TOC page (minimum page number from TOC entries)
    const firstTocPage =
      tocEntries.length > 0
        ? Math.min(...tocEntries.map((e) => e.pageNo))
        : Number.MAX_SAFE_INTEGER;

    // Filter out Front Matter for sorting (it's handled separately)
    const tocChapters = flatChapters.filter(
      (fc) => fc.chapter.id !== ChapterConverter.FRONT_MATTER_ID,
    );

    // Sort by TOC page number
    const sorted = [...tocChapters].sort((a, b) => a.tocPageNo - b.tocPageNo);

    // Set Front Matter range (always page 1 to firstTocPage - 1)
    ranges.set(ChapterConverter.FRONT_MATTER_ID, {
      startPage: 1,
      endPage: firstTocPage - 1,
    });

    // Set ranges for TOC chapters
    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];

      ranges.set(current.chapter.id, {
        startPage: current.tocPageNo,
        endPage: next ? next.tocPageNo - 1 : Number.MAX_SAFE_INTEGER,
      });
    }

    return ranges;
  }

  /**
   * Valid labels for text blocks
   * Only these labels are included in chapter text blocks
   */
  private static readonly VALID_TEXT_LABELS = new Set([
    'text',
    'section_header',
    'list_item',
  ]);

  /**
   * Check if text item has a picture parent
   * Items with parent.$ref starting with "#/pictures/" are excluded
   */
  private static hasPictureParent(item: DoclingTextItem): boolean {
    const parentRef = item.parent?.$ref;
    return typeof parentRef === 'string' && parentRef.startsWith('#/pictures/');
  }

  /**
   * Convert text items to text blocks
   * Filters by label (text, section_header, list_item), excludes picture children,
   * and extracts page numbers from prov
   */
  private convertTextBlocks(
    textItems: DoclingTextItem[],
    _pageRangeMap: Record<number, PageRange>,
  ): TextBlock[] {
    return textItems
      .filter(
        (item) =>
          ChapterConverter.VALID_TEXT_LABELS.has(item.label) &&
          !ChapterConverter.hasPictureParent(item) &&
          TextCleaner.isValidText(item.text),
      )
      .map((item) => {
        const pdfPageNo = item.prov?.[0]?.page_no ?? 1;
        return {
          text: TextCleaner.normalize(item.text),
          pdfPageNo,
        };
      });
  }

  /**
   * Convert PDF page number to actual document page number
   * Falls back to pdfPageNo if mapping is missing
   */
  private pdfPageToActualPage(
    pdfPageNo: number,
    pageRangeMap: Record<number, PageRange>,
  ): number {
    const range = pageRangeMap[pdfPageNo];
    if (!range) {
      // Fallback: assume 1:1 mapping
      return pdfPageNo;
    }
    // Return start page for the actual document page
    return range.startPageNo;
  }

  /**
   * Find chapter ID for a given actual page number
   * Uses "start page first" strategy
   */
  private findChapterForPage(
    actualPageNo: number,
    chapterRanges: Map<string, ChapterRange>,
  ): string | null {
    let bestMatch: string | null = null;
    let bestStartPage = -1;

    for (const [chapterId, range] of chapterRanges) {
      // Check if page is within range
      if (actualPageNo >= range.startPage && actualPageNo <= range.endPage) {
        // Use "start page first" strategy: prefer chapter with largest startPage <= actualPageNo
        if (range.startPage > bestStartPage) {
          bestStartPage = range.startPage;
          bestMatch = chapterId;
        }
      }
    }

    return bestMatch;
  }

  /**
   * Assign text blocks to chapters based on page ranges
   */
  private assignTextBlocks(
    chapters: Chapter[],
    textBlocks: TextBlock[],
    chapterRanges: Map<string, ChapterRange>,
    pageRangeMap: Record<number, PageRange>,
  ): void {
    // Build chapter map for O(1) lookup
    const chapterMap = this.buildChapterMap(chapters);

    for (const textBlock of textBlocks) {
      const actualPageNo = this.pdfPageToActualPage(
        textBlock.pdfPageNo,
        pageRangeMap,
      );
      const chapterId = this.findChapterForPage(actualPageNo, chapterRanges);

      if (chapterId && chapterMap.has(chapterId)) {
        chapterMap.get(chapterId)!.textBlocks.push(textBlock);
      }
    }
  }

  /**
   * Link images, tables, and footnotes to chapters based on page ranges
   */
  private linkResources(
    chapters: Chapter[],
    images: ProcessedImage[],
    tables: ProcessedTable[],
    footnotes: ProcessedFootnote[],
    chapterRanges: Map<string, ChapterRange>,
    pageRangeMap: Record<number, PageRange>,
  ): void {
    // Build chapter map for O(1) lookup
    const chapterMap = this.buildChapterMap(chapters);

    // Link images
    for (const image of images) {
      const actualPageNo = this.pdfPageToActualPage(
        image.pdfPageNo,
        pageRangeMap,
      );
      const chapterId = this.findChapterForPage(actualPageNo, chapterRanges);

      if (chapterId && chapterMap.has(chapterId)) {
        chapterMap.get(chapterId)!.imageIds.push(image.id);
      }
    }

    // Link tables
    for (const table of tables) {
      const actualPageNo = this.pdfPageToActualPage(
        table.pdfPageNo,
        pageRangeMap,
      );
      const chapterId = this.findChapterForPage(actualPageNo, chapterRanges);

      if (chapterId && chapterMap.has(chapterId)) {
        chapterMap.get(chapterId)!.tableIds.push(table.id);
      }
    }

    // Link footnotes
    for (const footnote of footnotes) {
      const actualPageNo = this.pdfPageToActualPage(
        footnote.pdfPageNo,
        pageRangeMap,
      );
      const chapterId = this.findChapterForPage(actualPageNo, chapterRanges);

      if (chapterId && chapterMap.has(chapterId)) {
        chapterMap.get(chapterId)!.footnoteIds.push(footnote.id);
      }
    }
  }

  /**
   * Build flat chapter map for O(1) lookup
   */
  private buildChapterMap(chapters: Chapter[]): Map<string, Chapter> {
    const map = new Map<string, Chapter>();

    const addToMap = (chapterList: Chapter[]): void => {
      for (const chapter of chapterList) {
        map.set(chapter.id, chapter);

        if (chapter.children && chapter.children.length > 0) {
          addToMap(chapter.children);
        }
      }
    };

    addToMap(chapters);
    return map;
  }
}
