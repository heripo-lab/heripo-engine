import type { Chapter, ProcessedDocument } from '@heripo/model';

import type {
  LedgerExtractionPreview,
  LedgerExtractorLogger,
  LedgerExtractorOptions,
} from './types';

/**
 * Default number of entries kept per sample list
 */
const DEFAULT_SAMPLE_LIMIT = 5;

/**
 * Maximum length of a sampled text block before truncation.
 * Keeps task logs and preview payloads small for large documents.
 */
const MAX_SAMPLE_TEXT_LENGTH = 120;

const noop = (): void => {
  // Intentionally empty: default logger discards all output
};

const NOOP_LOGGER: LedgerExtractorLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

function truncateText(text: string): string {
  if (text.length <= MAX_SAMPLE_TEXT_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_SAMPLE_TEXT_LENGTH)}…`;
}

/**
 * Flatten the chapter tree into depth-first order (parent before children)
 */
function flattenChapters(chapters: Chapter[]): Chapter[] {
  const flattened: Chapter[] = [];
  const visit = (chapter: Chapter): void => {
    flattened.push(chapter);
    for (const child of chapter.children ?? []) {
      visit(child);
    }
  };
  for (const chapter of chapters) {
    visit(chapter);
  }
  return flattened;
}

/**
 * Ledger extraction preview.
 *
 * This is the first vertical slice of the ledger extraction stage: it takes
 * a ProcessedDocument and produces a summary proving the data arrived
 * intact (counts plus a few samples). It performs no LLM calls, no network
 * access, and never mutates the input document. Image `path` values are
 * carried verbatim as URLs without fetching or rewriting them.
 */
export class LedgerExtractor {
  private readonly logger: LedgerExtractorLogger;
  private readonly sampleLimit: number;

  constructor(options: LedgerExtractorOptions = {}) {
    this.logger = options.logger ?? NOOP_LOGGER;
    this.sampleLimit = Math.max(
      0,
      Math.floor(options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT),
    );
  }

  /**
   * Summarize a ProcessedDocument into a LedgerExtractionPreview.
   *
   * @param document - Validated ProcessedDocument (see parseProcessedDocument)
   * @returns Aggregated counts and bounded samples
   */
  async extract(document: ProcessedDocument): Promise<LedgerExtractionPreview> {
    this.logger.info(
      `[LedgerExtractor] ProcessedDocument loaded: reportId=${document.reportId}`,
    );

    const chapters = flattenChapters(document.chapters);
    const textBlockCount = chapters.reduce(
      (sum, chapter) => sum + chapter.textBlocks.length,
      0,
    );
    const tableCellCount = document.tables.reduce(
      (sum, table) =>
        sum + table.grid.reduce((rowSum, row) => rowSum + row.length, 0),
      0,
    );

    const sampledTextBlocks: LedgerExtractionPreview['samples']['textBlocks'] =
      [];
    for (const chapter of chapters) {
      for (const textBlock of chapter.textBlocks) {
        if (sampledTextBlocks.length >= this.sampleLimit) {
          break;
        }
        sampledTextBlocks.push({
          chapterId: chapter.id,
          pdfPageNo: textBlock.pdfPageNo,
          text: truncateText(textBlock.text),
        });
      }
      if (sampledTextBlocks.length >= this.sampleLimit) {
        break;
      }
    }

    const preview: LedgerExtractionPreview = {
      reportId: document.reportId,
      schemaVersion: document.schemaVersion ?? null,
      counts: {
        chapters: chapters.length,
        textBlocks: textBlockCount,
        images: document.images.length,
        tables: document.tables.length,
        tableCells: tableCellCount,
        footnotes: document.footnotes.length,
      },
      samples: {
        chapterTitles: chapters
          .slice(0, this.sampleLimit)
          .map((chapter) => truncateText(chapter.title)),
        textBlocks: sampledTextBlocks,
        images: document.images.slice(0, this.sampleLimit).map((image) => ({
          id: image.id,
          pdfPageNo: image.pdfPageNo,
          url: image.path,
        })),
        tables: document.tables.slice(0, this.sampleLimit).map((table) => ({
          id: table.id,
          caption: table.caption ? truncateText(table.caption.fullText) : null,
          pdfPageNo: table.pdfPageNo,
          numRows: table.numRows,
          numCols: table.numCols,
        })),
      },
    };

    this.logger.info(
      `[LedgerExtractor] chapters=${preview.counts.chapters}, textBlocks=${preview.counts.textBlocks}`,
    );
    this.logger.info(
      `[LedgerExtractor] images=${preview.counts.images}, tables=${preview.counts.tables}, tableCells=${preview.counts.tableCells}, footnotes=${preview.counts.footnotes}`,
    );
    if (preview.samples.images.length > 0) {
      this.logger.info(
        `[LedgerExtractor] sample image URL: ${preview.samples.images[0].url}`,
      );
    }
    this.logger.info('[LedgerExtractor] extraction preview completed');

    return preview;
  }
}
