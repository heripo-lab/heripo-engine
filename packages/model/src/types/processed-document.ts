/**
 * Caption information
 *
 * Represents captions for images, tables, etc.
 * Includes number and full text.
 *
 * @interface Caption
 */
export interface Caption {
  /**
   * Caption prefix with number (optional)
   *
   * Extracted prefix with number from caption text, preserving original spacing.
   * Example: "도판 1" from "도판 1 유적 전경", "Figure 2" from "Figure 2: Site overview"
   * Set as optional to handle captions that start without a number.
   *
   * @type {string}
   */
  num?: string;

  /**
   * Full text of the caption
   *
   * Complete caption text including number and description
   * Example: "도판 1 유적 전경", "Figure 2: Site overview", "Table 3-2. 유물 목록"
   *
   * @type {string}
   */
  fullText: string;
}

/**
 * Page range of actual document contained in one PDF page
 *
 * In the case of PDF scans, multiple pages of the actual document may be
 * contained in a single PDF page. (Example: A double-sided document scanned on one page)
 *
 * @interface PageRange
 */
export interface PageRange {
  /**
   * Starting page number in the actual document (inclusive)
   * @type {number}
   */
  startPageNo: number;

  /**
   * Ending page number in the actual document (inclusive)
   * @type {number}
   */
  endPageNo: number;
}

/**
 * Text block (paragraph, sentence, etc.)
 *
 * Represents actual text content inside a chapter.
 *
 * @interface TextBlock
 */
export interface TextBlock {
  /**
   * Content of the text block
   * @type {string}
   */
  text: string;

  /**
   * Page number in the PDF file
   * @type {number}
   */
  pdfPageNo: number;
}

/**
 * Chapter (section) of the document
 *
 * Represents the hierarchical structure of the document, with each item containing
 * original title and cleaned title, actual page number, hierarchy depth, text content,
 * images, tables, and child sections.
 *
 * @interface Chapter
 */
export interface Chapter {
  /**
   * Unique identifier of the chapter
   *
   * Used when referencing the chapter in images, tables, etc.
   *
   * @type {string}
   */
  id: string;

  /**
   * Title from the original report
   * @type {string}
   */
  originTitle: string;

  /**
   * Chapter title (cleaned title)
   * @type {string}
   */
  title: string;

  /**
   * Page number in the actual document (page where this chapter starts)
   * @type {number}
   */
  pageNo: number;

  /**
   * Hierarchy depth of the section (1 = top-level, 2 = subsection, etc.)
   * @type {number}
   */
  level: number;

  /**
   * Text blocks inside the chapter
   *
   * Stores all text content included in this chapter as an array.
   * Each text block includes a PDF page number.
   *
   * @type {TextBlock[]}
   */
  textBlocks: TextBlock[];

  /**
   * List of image IDs included in the chapter
   *
   * Images can be found by ID in ProcessedDocument.images.
   *
   * @type {string[]}
   */
  imageIds: string[];

  /**
   * List of table IDs included in the chapter
   *
   * Tables can be found by ID in ProcessedDocument.tables.
   *
   * @type {string[]}
   */
  tableIds: string[];

  /**
   * List of footnote IDs included in the chapter
   *
   * Footnotes can be found by ID in ProcessedDocument.footnotes.
   *
   * @type {string[]}
   */
  footnoteIds: string[];

  /**
   * Child chapters (recursive structure)
   * @type {Chapter[]}
   */
  children?: Chapter[];
}

/**
 * Image information included in the processed PDF document
 *
 * Represents images extracted from the document and their metadata.
 *
 * @interface ProcessedImage
 */
export interface ProcessedImage {
  /**
   * Unique identifier of the image
   *
   * Used when referencing the image in chapters.
   *
   * @type {string}
   */
  id: string;

  /**
   * Caption information for the image (if available)
   * @type {Caption}
   */
  caption?: Caption;

  /**
   * Page number in the PDF file (page where this image is located)
   * @type {number}
   */
  pdfPageNo: number;

  /**
   * Path of the extracted image file
   *
   * Location of the image file saved as absolute or relative path
   *
   * @type {string}
   */
  path: string;
}

/**
 * Cell information of a table
 *
 * @interface ProcessedTableCell
 */
export interface ProcessedTableCell {
  /**
   * Text content of the cell
   * @type {string}
   */
  text: string;

  /**
   * Number of rows to span (default: 1)
   * @type {number}
   */
  rowSpan: number;

  /**
   * Number of columns to span (default: 1)
   * @type {number}
   */
  colSpan: number;

  /**
   * Whether the cell is a header cell (column or row header)
   * @type {boolean}
   */
  isHeader: boolean;
}

/**
 * Table information included in the processed PDF document
 *
 * Represents tables extracted from the document and their metadata.
 * Structured data such as artifact lists, stratigraphy information, etc., are mainly provided in table form.
 *
 * @interface ProcessedTable
 */
export interface ProcessedTable {
  /**
   * Unique identifier of the table
   *
   * Used when referencing the table in chapters.
   *
   * @type {string}
   */
  id: string;

  /**
   * Caption information for the table (if available)
   * @type {Caption}
   */
  caption?: Caption;

  /**
   * Page number in the PDF file (page where this table is located)
   * @type {number}
   */
  pdfPageNo: number;

  /**
   * Number of rows in the table
   * @type {number}
   */
  numRows: number;

  /**
   * Number of columns in the table
   * @type {number}
   */
  numCols: number;

  /**
   * Table data (2D array)
   *
   * Access using grid[row][col].
   *
   * @type {ProcessedTableCell[][]}
   */
  grid: ProcessedTableCell[][];
}

/**
 * Footnote information included in the processed PDF document
 *
 * Represents footnotes extracted from the document and their metadata.
 * Footnotes provide supplementary information referenced in the main text.
 *
 * @interface ProcessedFootnote
 */
export interface ProcessedFootnote {
  /**
   * Unique identifier of the footnote
   *
   * Used when referencing the footnote in chapters.
   *
   * @type {string}
   */
  id: string;

  /**
   * Text content of the footnote
   *
   * @type {string}
   */
  text: string;

  /**
   * Page number in the PDF file (page where this footnote is located)
   * @type {number}
   */
  pdfPageNo: number;
}

/**
 * Processed PDF document model
 *
 * An intermediate model that has been cleaned and structured to efficiently deliver
 * the original document extracted from Docling for LLM analysis.
 *
 * @interface ProcessedDocument
 */
export interface ProcessedDocument {
  /**
   * Unique identifier of the report
   * @type {string}
   */
  reportId: string;

  /**
   * Mapping of page ranges for actual document pages per PDF page
   *
   * When multiple pages of the actual document are contained in a single PDF page,
   * this map tracks which actual pages are included in each PDF page.
   *
   * @type {Record<number, PageRange>}
   *
   * @example
   * ```typescript
   * {
   *   1: { startPageNo: 1, endPageNo: 1 },     // PDF 1 = actual 1
   *   2: { startPageNo: 2, endPageNo: 3 },     // PDF 2 = actual 2~3 (double-sided)
   *   3: { startPageNo: 4, endPageNo: 4 },     // PDF 3 = actual 4
   * }
   * ```
   */
  pageRangeMap: Record<number, PageRange>;

  /**
   * Chapter structure of the document (hierarchical)
   *
   * Represents all chapters of the document in a hierarchical structure, where each chapter
   * contains title, page information, text content, and child chapters.
   *
   * @type {Chapter[]}
   *
   * @example
   * ```typescript
   * [
   *   {
   *     originTitle: '  Chapter 1  Introduction  ',
   *     title: 'Chapter 1 Introduction',
   *     pageNo: 1,
   *     level: 1,
   *     textBlocks: [
   *       {
   *         text: 'This chapter describes the background of the excavation project.',
   *         pdfPageNo: 1
   *       },
   *       {
   *         text: 'The site is located in the central region of the peninsula.',
   *         pdfPageNo: 2
   *       }
   *     ],
   *     children: [
   *       {
   *         originTitle: '1.1 Background',
   *         title: '1.1 Background',
   *         pageNo: 1,
   *         level: 2,
   *         textBlocks: [
   *           {
   *             text: 'The archaeological significance of the region...',
   *             pdfPageNo: 1
   *           }
   *         ]
   *       },
   *       {
   *         originTitle: '1.2 Objectives',
   *         title: '1.2 Objectives',
   *         pageNo: 3,
   *         level: 2,
   *         textBlocks: [
   *           {
   *             text: 'The main objectives of this survey are...',
   *             pdfPageNo: 3
   *           }
   *         ]
   *       }
   *     ]
   *   },
   *   {
   *     originTitle: 'Chapter 2 Methodology',
   *     title: 'Chapter 2 Methodology',
   *     pageNo: 5,
   *     level: 1,
   *     textBlocks: [
   *       {
   *         text: 'This chapter describes the survey methodology.',
   *         pdfPageNo: 5
   *       }
   *     ]
   *   }
   * ]
   * ```
   */
  chapters: Chapter[];

  /**
   * Images included in the document
   *
   * A list of extracted images, where each image includes unique ID, caption, PDF page number,
   * and file path. Referenced through imageIds in chapters.
   *
   * @type {ProcessedImage[]}
   */
  images: ProcessedImage[];

  /**
   * Tables included in the document
   *
   * A list of extracted tables containing structured data such as artifact lists, stratigraphy information, etc.
   * Referenced through tableIds in chapters.
   *
   * @type {ProcessedTable[]}
   */
  tables: ProcessedTable[];

  /**
   * Footnotes included in the document
   *
   * A list of extracted footnotes providing supplementary information.
   * Referenced through footnoteIds in chapters.
   *
   * @type {ProcessedFootnote[]}
   */
  footnotes: ProcessedFootnote[];
}
