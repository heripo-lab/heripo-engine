import type { LoggerMethods } from '@heripo/logger';

import { spawnAsync } from '@heripo/shared';

/**
 * Extracts text from PDF pages using the pdftotext command-line tool.
 *
 * Uses the `-layout` flag to preserve the original page layout.
 * Failures are logged as warnings and produce empty strings,
 * allowing the pipeline to gracefully fall back to VLM-only OCR.
 *
 * ## System Requirements
 * - Poppler utils (`brew install poppler`)
 */
export class PdfTextExtractor {
  constructor(private readonly logger: LoggerMethods) {}

  /**
   * Extract text from all pages of a PDF.
   *
   * @param pdfPath - Absolute path to the source PDF file
   * @param totalPages - Total number of pages in the PDF
   * @returns Map of 1-based page numbers to extracted text strings
   */
  async extractText(
    pdfPath: string,
    totalPages: number,
  ): Promise<Map<number, string>> {
    this.logger.info(
      `[PdfTextExtractor] Extracting text from ${totalPages} pages...`,
    );

    const pageTexts = new Map<number, string>();

    for (let page = 1; page <= totalPages; page++) {
      const text = await this.extractPageText(pdfPath, page);
      pageTexts.set(page, text);
    }

    const nonEmptyCount = [...pageTexts.values()].filter(
      (t) => t.trim().length > 0,
    ).length;
    this.logger.info(
      `[PdfTextExtractor] Extracted text from ${nonEmptyCount}/${totalPages} pages`,
    );

    return pageTexts;
  }

  /**
   * Get total page count of a PDF using pdfinfo.
   * Returns 0 on failure.
   */
  async getPageCount(pdfPath: string): Promise<number> {
    const result = await spawnAsync('pdfinfo', [pdfPath]);
    if (result.code !== 0) {
      this.logger.warn(
        `[PdfTextExtractor] pdfinfo failed: ${result.stderr || 'Unknown error'}`,
      );
      return 0;
    }
    const match = result.stdout.match(/^Pages:\s+(\d+)/m);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Extract text from a single PDF page using pdftotext.
   * Returns empty string on failure (logged as warning).
   */
  async extractPageText(pdfPath: string, page: number): Promise<string> {
    const result = await spawnAsync('pdftotext', [
      '-f',
      page.toString(),
      '-l',
      page.toString(),
      '-layout',
      pdfPath,
      '-',
    ]);

    if (result.code !== 0) {
      this.logger.warn(
        `[PdfTextExtractor] pdftotext failed for page ${page}: ${result.stderr || 'Unknown error'}`,
      );
      return '';
    }

    return result.stdout;
  }
}
