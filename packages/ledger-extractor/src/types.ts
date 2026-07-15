import type { LoggerMethods } from '@heripo/logger';

/**
 * Logger interface accepted by {@link import('./ledger-extractor').LedgerExtractor}.
 *
 * Structurally compatible with the `Logger` class from `@heripo/logger`,
 * so any existing engine logger can be injected as-is.
 */
export type LedgerExtractorLogger = LoggerMethods;

/**
 * Summary of a ProcessedDocument produced by the ledger extraction preview.
 *
 * This is NOT the ledger domain model. It only proves that a
 * ProcessedDocument was delivered intact to the ledger extraction stage by
 * aggregating counts and carrying a few representative samples.
 *
 * @interface LedgerExtractionPreview
 */
export interface LedgerExtractionPreview {
  /**
   * Report identifier copied from the input document
   * @type {string}
   */
  reportId: string;

  /**
   * Schema version of the input document, or null when absent
   * @type {string | null}
   */
  schemaVersion: string | null;

  /**
   * Aggregated counts across the whole document (chapters are counted
   * recursively including nested children)
   */
  counts: {
    chapters: number;
    textBlocks: number;
    images: number;
    tables: number;
    tableCells: number;
    footnotes: number;
  };

  /**
   * Representative samples, each limited to the configured sample limit
   */
  samples: {
    /**
     * Chapter titles in depth-first order
     * @type {string[]}
     */
    chapterTitles: string[];

    /**
     * Text blocks in depth-first chapter order. Long text is truncated.
     */
    textBlocks: Array<{
      chapterId: string;
      pdfPageNo: number;
      text: string;
    }>;

    /**
     * Images with their `ProcessedImage.path` carried verbatim as `url`.
     * The extractor never fetches, signs, or rewrites these URLs.
     */
    images: Array<{
      id: string;
      pdfPageNo: number;
      url: string;
    }>;

    /**
     * Tables with caption text and grid dimensions
     */
    tables: Array<{
      id: string;
      caption: string | null;
      pdfPageNo: number;
      numRows: number;
      numCols: number;
    }>;
  };
}

/**
 * Options for {@link import('./ledger-extractor').LedgerExtractor}.
 *
 * @interface LedgerExtractorOptions
 */
export interface LedgerExtractorOptions {
  /**
   * Logger used for progress output. Defaults to a no-op logger, so the
   * package never writes to the console on its own.
   * @type {LedgerExtractorLogger}
   */
  logger?: LedgerExtractorLogger;

  /**
   * Maximum number of entries per sample list (default: 5)
   * @type {number}
   */
  sampleLimit?: number;
}
