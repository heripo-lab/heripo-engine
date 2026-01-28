/**
 * Table of Contents Entry
 *
 * Tree node representing the table of contents structure of a document.
 */
export interface TocEntry {
  /**
   * Chapter title
   */
  title: string;

  /**
   * Hierarchy depth (1, 2, 3...)
   */
  level: number;

  /**
   * Starting page number
   */
  pageNo: number;

  /**
   * Child TOC entries
   */
  children?: TocEntry[];
}

/**
 * TOC Area Search Result
 */
export interface TocAreaResult {
  /**
   * Group or table item references corresponding to the table of contents
   */
  itemRefs: string[];

  /**
   * TOC start page
   */
  startPage: number;

  /**
   * TOC end page
   */
  endPage: number;
}

/**
 * Page Size Information
 */
export interface PageSizeGroup {
  /**
   * Size identifier (width x height)
   */
  sizeKey: string;

  /**
   * PDF page numbers with this size specification
   */
  pageNos: number[];
}
