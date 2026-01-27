import type { LoggerMethods } from '@heripo/logger';

import { spawnAsync } from '@heripo/shared';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IMAGE_PDF_CONVERTER } from '../config/constants';

/**
 * Utility class for converting PDF to image-based PDF using ImageMagick.
 * Used as a fallback when regular PDF conversion fails due to encoding issues.
 *
 * ## System Requirements
 * - ImageMagick (`brew install imagemagick`)
 * - Ghostscript (`brew install ghostscript`)
 */
export class ImagePdfConverter {
  constructor(private readonly logger: LoggerMethods) {}

  /**
   * Convert a PDF file to an image-based PDF.
   * Downloads the PDF from URL, converts it using ImageMagick, and returns the path.
   *
   * @param pdfUrl - URL of the source PDF
   * @param reportId - Report identifier for temp file naming
   * @returns Path to the converted image PDF in temp directory
   */
  async convert(pdfUrl: string, reportId: string): Promise<string> {
    const timestamp = Date.now();
    const tempDir = tmpdir();
    const inputPath = join(tempDir, `${reportId}-${timestamp}-input.pdf`);
    const outputPath = join(tempDir, `${reportId}-${timestamp}-image.pdf`);

    try {
      this.logger.info('[ImagePdfConverter] Downloading PDF from URL...');
      await this.downloadPdf(pdfUrl, inputPath);

      this.logger.info('[ImagePdfConverter] Converting to image PDF...');
      await this.convertToImagePdf(inputPath, outputPath);

      this.logger.info('[ImagePdfConverter] Image PDF created:', outputPath);
      return outputPath;
    } finally {
      // Always cleanup input file
      if (existsSync(inputPath)) {
        rmSync(inputPath, { force: true });
      }
    }
  }

  /**
   * Download PDF from URL to local path using curl
   */
  private async downloadPdf(url: string, outputPath: string): Promise<void> {
    const result = await spawnAsync('curl', [
      '-L', // Follow redirects
      '-o',
      outputPath,
      '-s', // Silent mode
      '--fail', // Fail on HTTP errors
      url,
    ]);

    if (result.code !== 0) {
      throw new Error(
        `Failed to download PDF: ${result.stderr || 'Unknown error'}`,
      );
    }
  }

  /**
   * Convert PDF to image-based PDF using ImageMagick
   */
  private async convertToImagePdf(
    inputPath: string,
    outputPath: string,
  ): Promise<void> {
    const result = await spawnAsync('magick', [
      '-density',
      IMAGE_PDF_CONVERTER.DENSITY.toString(),
      inputPath,
      '-quality',
      IMAGE_PDF_CONVERTER.QUALITY.toString(),
      outputPath,
    ]);

    if (result.code !== 0) {
      throw new Error(
        `Failed to convert PDF to image PDF: ${result.stderr || 'Unknown error'}`,
      );
    }
  }

  /**
   * Cleanup the temporary image PDF file
   */
  cleanup(imagePdfPath: string): void {
    if (existsSync(imagePdfPath)) {
      this.logger.info(
        '[ImagePdfConverter] Cleaning up temp file:',
        imagePdfPath,
      );
      rmSync(imagePdfPath, { force: true });
    }
  }
}
