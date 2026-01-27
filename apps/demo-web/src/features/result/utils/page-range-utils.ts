import type { PageRange } from '@heripo/model';

/**
 * Page type for modal navigation
 */
export type PageType = 'pdf' | 'document';

/**
 * Information needed to display a page in the modal
 */
export interface PageViewInfo {
  /** PDF page number (1-based) */
  pdfPageNo: number;
  /** Page index for API (0-based) */
  pageIndex: number;
  /** Display label */
  label: string;
}

/**
 * Creates a reverse lookup map from document page to PDF pages.
 * One document page can map to multiple PDF pages in edge cases,
 * but typically maps to one PDF page.
 */
export function createDocumentPageToPdfMap(
  pageRangeMap: Record<number, PageRange>,
): Map<number, number[]> {
  const map = new Map<number, number[]>();

  for (const [pdfPageStr, range] of Object.entries(pageRangeMap)) {
    const pdfPage = Number(pdfPageStr);
    for (
      let docPage = range.startPageNo;
      docPage <= range.endPageNo;
      docPage++
    ) {
      const existing = map.get(docPage) ?? [];
      existing.push(pdfPage);
      map.set(docPage, existing);
    }
  }

  return map;
}

/**
 * Get total PDF pages from pageRangeMap
 */
export function getTotalPdfPages(
  pageRangeMap: Record<number, PageRange>,
): number {
  const keys = Object.keys(pageRangeMap).map(Number);
  return keys.length > 0 ? Math.max(...keys) : 0;
}

/**
 * Resolve page view info based on page type
 */
export function resolvePageViewInfo(
  pageNo: number,
  pageType: PageType,
  pageRangeMap: Record<number, PageRange>,
): PageViewInfo | null {
  if (pageType === 'pdf') {
    // Direct PDF page
    return {
      pdfPageNo: pageNo,
      pageIndex: pageNo - 1, // 0-based for API
      label: `PDF Page ${pageNo}`,
    };
  }

  // Document page - find corresponding PDF page
  const docToPdfMap = createDocumentPageToPdfMap(pageRangeMap);
  const pdfPages = docToPdfMap.get(pageNo);

  if (!pdfPages || pdfPages.length === 0) {
    // Fallback: treat document page as PDF page if no mapping exists
    return {
      pdfPageNo: pageNo,
      pageIndex: pageNo - 1,
      label: `Page ${pageNo}`,
    };
  }

  // Use first matching PDF page
  const pdfPageNo = pdfPages[0];
  return {
    pdfPageNo,
    pageIndex: pdfPageNo - 1,
    label: `Page ${pageNo} (PDF ${pdfPageNo})`,
  };
}
