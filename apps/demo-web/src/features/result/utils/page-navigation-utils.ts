import type {
  Chapter,
  ProcessedFootnote,
  ProcessedImage,
  ProcessedTable,
  TextBlock,
} from '@heripo/model';

/**
 * Get all unique PDF page numbers in a chapter (sorted ascending)
 */
export function getChapterPdfPages(chapter: Chapter): number[] {
  const pages = new Set<number>();

  for (const block of chapter.textBlocks) {
    pages.add(block.pdfPageNo);
  }

  return Array.from(pages).sort((a, b) => a - b);
}

/**
 * Get minimum PDF page number from a chapter (for determining chapter boundaries)
 */
export function getChapterMinPdfPage(chapter: Chapter): number | null {
  if (chapter.textBlocks.length === 0) {
    return null;
  }
  return Math.min(...chapter.textBlocks.map((b) => b.pdfPageNo));
}

/**
 * Get maximum PDF page number from a chapter
 */
export function getChapterMaxPdfPage(chapter: Chapter): number | null {
  if (chapter.textBlocks.length === 0) {
    return null;
  }
  return Math.max(...chapter.textBlocks.map((b) => b.pdfPageNo));
}

/**
 * Get all unique PDF page numbers across all chapters (for global navigation)
 * Includes pages from images, tables, and footnotes as well
 */
export function getAllPdfPages(
  chapters: Chapter[],
  images: ProcessedImage[],
  tables: ProcessedTable[],
  footnotes: ProcessedFootnote[],
): number[] {
  const pages = new Set<number>();

  // Recursively collect from chapters
  function collectFromChapter(chapter: Chapter) {
    for (const block of chapter.textBlocks) {
      pages.add(block.pdfPageNo);
    }
    chapter.children?.forEach(collectFromChapter);
  }

  chapters.forEach(collectFromChapter);
  images.forEach((img) => pages.add(img.pdfPageNo));
  tables.forEach((tbl) => pages.add(tbl.pdfPageNo));
  footnotes.forEach((fn) => pages.add(fn.pdfPageNo));

  return Array.from(pages).sort((a, b) => a - b);
}

/**
 * Build a flat list of all chapters (including nested children) with their page ranges
 */
interface ChapterPageRange {
  chapter: Chapter;
  minPage: number;
  maxPage: number;
}

function buildChapterPageRanges(chapters: Chapter[]): ChapterPageRange[] {
  const result: ChapterPageRange[] = [];

  function traverse(chapter: Chapter) {
    const minPage = getChapterMinPdfPage(chapter);
    const maxPage = getChapterMaxPdfPage(chapter);

    if (minPage !== null && maxPage !== null) {
      result.push({ chapter, minPage, maxPage });
    }

    chapter.children?.forEach(traverse);
  }

  chapters.forEach(traverse);

  return result;
}

/**
 * Find which chapter contains a specific PDF page.
 * Returns the most specific (deepest nested) chapter that contains content on this page.
 */
export function findChapterForPage(
  chapters: Chapter[],
  pdfPageNo: number,
): Chapter | null {
  const ranges = buildChapterPageRanges(chapters);

  // Filter chapters that contain this page
  const matching = ranges.filter(
    (r) => r.minPage <= pdfPageNo && r.maxPage >= pdfPageNo,
  );

  if (matching.length === 0) {
    return null;
  }

  // Return the chapter with the smallest range (most specific)
  // This prioritizes deeper nested chapters
  matching.sort((a, b) => {
    const rangeA = a.maxPage - a.minPage;
    const rangeB = b.maxPage - b.minPage;
    return rangeA - rangeB;
  });

  return matching[0].chapter;
}

/**
 * Filter text blocks by PDF page
 */
export function filterTextBlocksByPage(
  textBlocks: TextBlock[],
  pdfPageNo: number,
): TextBlock[] {
  return textBlocks.filter((block) => block.pdfPageNo === pdfPageNo);
}

/**
 * Filter image IDs by PDF page
 */
export function filterImageIdsByPage(
  imageIds: string[],
  imageMap: Map<string, ProcessedImage>,
  pdfPageNo: number,
): string[] {
  return imageIds.filter((id) => {
    const image = imageMap.get(id);
    return image?.pdfPageNo === pdfPageNo;
  });
}

/**
 * Filter table IDs by PDF page
 */
export function filterTableIdsByPage(
  tableIds: string[],
  tableMap: Map<string, ProcessedTable>,
  pdfPageNo: number,
): string[] {
  return tableIds.filter((id) => {
    const table = tableMap.get(id);
    return table?.pdfPageNo === pdfPageNo;
  });
}

/**
 * Filter footnote IDs by PDF page
 */
export function filterFootnoteIdsByPage(
  footnoteIds: string[],
  footnoteMap: Map<string, ProcessedFootnote>,
  pdfPageNo: number,
): string[] {
  return footnoteIds.filter((id) => {
    const footnote = footnoteMap.get(id);
    return footnote?.pdfPageNo === pdfPageNo;
  });
}
