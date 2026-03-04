import type { LoggerMethods } from '@heripo/logger';

import { spawnAsync } from '@heripo/shared';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PAGE_RENDERING } from '../config/constants.js';

/** Minimum percentage increment between progress log messages */
const PROGRESS_LOG_PERCENT_STEP = 10;

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
  private lastLoggedPercent = 0;

  constructor(private readonly logger: LoggerMethods) {}

  /**
   * Render all pages of a PDF to individual PNG files.
   *
   * Uses per-page rendering (`magick 'input.pdf[N]'`) when page count is known,
   * limiting peak memory to ~15MB/page instead of loading all pages at once.
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
      this.lastLoggedPercent = 0;

      for (let i = 0; i < totalPages; i++) {
        const result = await spawnAsync(
          'magick',
          [
            '-density',
            dpi.toString(),
            `${pdfPath}[${i}]`,
            '-background',
            'white',
            '-alpha',
            'remove',
            '-alpha',
            'off',
            join(pagesDir, `page_${i}.png`),
          ],
          { captureStdout: false },
        );

        if (result.code !== 0) {
          throw new Error(
            `[PageRenderer] Failed to render page ${i + 1}/${totalPages}: ${result.stderr || 'Unknown error'}`,
          );
        }

        this.logProgress(i + 1, totalPages);
      }
    } else {
      // Fallback: render all pages at once when pdfinfo is unavailable
      this.logger.info(`[PageRenderer] Rendering PDF at ${dpi} DPI...`);

      const result = await spawnAsync(
        'magick',
        [
          '-density',
          dpi.toString(),
          pdfPath,
          '-background',
          'white',
          '-alpha',
          'remove',
          '-alpha',
          'off',
          join(pagesDir, 'page_%d.png'),
        ],
        { captureStdout: false },
      );

      if (result.code !== 0) {
        throw new Error(
          `[PageRenderer] Failed to render PDF pages: ${result.stderr || 'Unknown error'}`,
        );
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
   * Log rendering progress at appropriate intervals (every 10%).
   */
  private logProgress(current: number, total: number): void {
    const percent = Math.floor((current / total) * 100);
    if (
      percent >= this.lastLoggedPercent + PROGRESS_LOG_PERCENT_STEP ||
      current === total
    ) {
      this.lastLoggedPercent = percent;
      this.logger.info(
        `[PageRenderer] Rendering pages: ${current}/${total} (${percent}%)`,
      );
    }
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
