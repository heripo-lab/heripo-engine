import type { LoggerMethods } from '@heripo/logger';

import { spawnAsync } from '@heripo/shared';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Default rendering DPI for VLM text recognition quality */
const DEFAULT_DPI = 300;

/** Result of page rendering */
export interface PageRenderResult {
  /** Total number of pages rendered */
  pageCount: number;
  /** Absolute path to the pages directory */
  pagesDir: string;
  /** Sorted list of rendered page file paths (absolute) */
  pageFiles: string[];
}

/** Options for page rendering */
export interface PageRendererOptions {
  /** DPI for rendered images (default: 300) */
  dpi?: number;
}

/**
 * Renders PDF pages to individual PNG images using ImageMagick.
 *
 * ## System Requirements
 * - ImageMagick (`brew install imagemagick`)
 * - Ghostscript (`brew install ghostscript`)
 */
export class PageRenderer {
  constructor(private readonly logger: LoggerMethods) {}

  /**
   * Render all pages of a PDF to individual PNG files.
   *
   * @param pdfPath - Absolute path to the source PDF file
   * @param outputDir - Directory where pages/ subdirectory will be created
   * @param options - Rendering options
   * @returns Render result with page count and file paths
   */
  async renderPages(
    pdfPath: string,
    outputDir: string,
    options?: PageRendererOptions,
  ): Promise<PageRenderResult> {
    const dpi = options?.dpi ?? DEFAULT_DPI;
    const pagesDir = join(outputDir, 'pages');

    if (!existsSync(pagesDir)) {
      mkdirSync(pagesDir, { recursive: true });
    }

    this.logger.info(`[PageRenderer] Rendering PDF at ${dpi} DPI...`);

    const outputPattern = join(pagesDir, 'page_%d.png');

    const result = await spawnAsync('magick', [
      '-density',
      dpi.toString(),
      pdfPath,
      '-background',
      'white',
      '-alpha',
      'remove',
      '-alpha',
      'off',
      outputPattern,
    ]);

    if (result.code !== 0) {
      throw new Error(
        `[PageRenderer] Failed to render PDF pages: ${result.stderr || 'Unknown error'}`,
      );
    }

    const pageFiles = readdirSync(pagesDir)
      .filter((f) => f.startsWith('page_') && f.endsWith('.png'))
      .sort((a, b) => {
        const numA = parseInt(a.replace('page_', '').replace('.png', ''), 10);
        const numB = parseInt(b.replace('page_', '').replace('.png', ''), 10);
        return numA - numB;
      })
      .map((f) => join(pagesDir, f));

    this.logger.info(
      `[PageRenderer] Rendered ${pageFiles.length} pages to ${pagesDir}`,
    );

    return {
      pageCount: pageFiles.length,
      pagesDir,
      pageFiles,
    };
  }
}
