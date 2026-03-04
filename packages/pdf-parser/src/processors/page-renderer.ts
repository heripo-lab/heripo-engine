import type { LoggerMethods } from '@heripo/logger';

import { spawnAsync } from '@heripo/shared';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PAGE_RENDERING } from '../config/constants.js';

/** Interval for progress polling in milliseconds */
const PROGRESS_POLL_INTERVAL_MS = 2000;

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
  /** DPI for rendered images (default: 200) */
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
    const dpi = options?.dpi ?? PAGE_RENDERING.DEFAULT_DPI;
    const pagesDir = join(outputDir, 'pages');

    if (!existsSync(pagesDir)) {
      mkdirSync(pagesDir, { recursive: true });
    }

    const totalPages = await this.getPageCount(pdfPath);

    if (totalPages > 0) {
      this.logger.info(
        `[PageRenderer] Rendering ${totalPages} pages at ${dpi} DPI...`,
      );
    } else {
      this.logger.info(`[PageRenderer] Rendering PDF at ${dpi} DPI...`);
    }

    const outputPattern = join(pagesDir, 'page_%d.png');

    // Poll output directory for progress during rendering
    let progressInterval: ReturnType<typeof setInterval> | null = null;
    if (totalPages > 0) {
      let lastLoggedCount = 0;
      progressInterval = setInterval(() => {
        try {
          const rendered = readdirSync(pagesDir).filter(
            (f) => f.startsWith('page_') && f.endsWith('.png'),
          ).length;
          if (rendered > 0 && rendered !== lastLoggedCount) {
            lastLoggedCount = rendered;
            this.logger.info(
              `[PageRenderer] Rendering pages: ${rendered}/${totalPages}`,
            );
          }
        } catch {
          /* ignore read errors during rendering */
        }
      }, PROGRESS_POLL_INTERVAL_MS);
    }

    try {
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
    } finally {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
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

  /**
   * Get total page count using pdfinfo.
   * Returns 0 on failure (progress logging will be skipped).
   */
  private async getPageCount(pdfPath: string): Promise<number> {
    try {
      const result = await spawnAsync('pdfinfo', [pdfPath]);
      if (result.code !== 0) return 0;
      const match = result.stdout.match(/^Pages:\s+(\d+)/m);
      return match ? parseInt(match[1], 10) : 0;
    } catch {
      return 0;
    }
  }
}
