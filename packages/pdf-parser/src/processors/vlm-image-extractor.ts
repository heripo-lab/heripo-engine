import type { LoggerMethods } from '@heripo/logger';

import type { VlmBBox } from '../types/vlm-page-result';

import { spawnAsync } from '@heripo/shared';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Padding ratio applied to crop regions (3% of crop dimensions) */
const PADDING_RATIO = 0.03;

/** Minimum valid crop dimension in pixels */
const MIN_CROP_SIZE = 20;

/** Maximum ratio of page area for a valid crop */
const MAX_AREA_RATIO = 0.9;

/** Location of a picture element on a page */
export interface PictureLocation {
  /** 1-based page number */
  pageNo: number;
  /** Normalized bounding box (0-1, top-left origin) */
  bbox: VlmBBox;
}

/**
 * Extracts picture elements from page images using VLM-detected bounding boxes.
 *
 * For each picture detected by VLM, crops the corresponding region from the
 * page image with padding and saves it as a separate PNG file.
 * Uses ImageMagick for image cropping and dimension queries.
 */
export class VlmImageExtractor {
  private readonly logger: LoggerMethods;

  constructor(logger: LoggerMethods) {
    this.logger = logger;
  }

  /**
   * Extract picture regions from page images and save as individual files.
   *
   * @param pageFiles - Page image file paths (index 0 → page 1)
   * @param pictures - Picture locations with page numbers and bounding boxes
   * @param outputDir - Base output directory (images saved to outputDir/images/)
   * @returns Array of relative image paths (e.g., "images/image_0.png")
   */
  async extractImages(
    pageFiles: string[],
    pictures: PictureLocation[],
    outputDir: string,
  ): Promise<string[]> {
    if (pictures.length === 0) {
      this.logger.info('[VlmImageExtractor] No pictures to extract');
      return [];
    }

    const imagesDir = join(outputDir, 'images');
    if (!existsSync(imagesDir)) {
      mkdirSync(imagesDir, { recursive: true });
    }

    this.logger.info(
      `[VlmImageExtractor] Extracting ${pictures.length} images...`,
    );

    // Get dimensions for pages that have pictures (one call per unique page)
    const pageDimensions = await this.getPageDimensions(pageFiles, pictures);

    const imagePaths: string[] = [];

    for (let i = 0; i < pictures.length; i++) {
      const picture = pictures[i];
      const pageFile = pageFiles[picture.pageNo - 1];
      const dims = pageDimensions.get(picture.pageNo);

      if (!pageFile || !dims) {
        this.logger.warn(
          `[VlmImageExtractor] Skipping picture ${i}: page ${picture.pageNo} not found`,
        );
        continue;
      }

      const crop = this.computeCropRegion(
        picture.bbox,
        dims.width,
        dims.height,
      );

      // Warn for outlier crop regions but still attempt extraction
      this.validateCropRegion(i, crop.w, crop.h, dims.width, dims.height);

      const relativePath = `images/image_${i}.png`;
      const outputPath = join(outputDir, relativePath);

      await this.cropImage(pageFile, outputPath, crop);
      imagePaths.push(relativePath);
    }

    this.logger.info(
      `[VlmImageExtractor] Extracted ${imagePaths.length} images`,
    );

    return imagePaths;
  }

  /**
   * Get pixel dimensions for pages that contain pictures.
   * Uses ImageMagick identify to read image metadata.
   * Only queries each unique page once.
   */
  private async getPageDimensions(
    pageFiles: string[],
    pictures: PictureLocation[],
  ): Promise<Map<number, { width: number; height: number }>> {
    const uniquePages = [...new Set(pictures.map((p) => p.pageNo))];
    const dimensions = new Map<number, { width: number; height: number }>();

    for (const pageNo of uniquePages) {
      const pageFile = pageFiles[pageNo - 1];
      if (!pageFile) continue;

      const result = await spawnAsync('magick', [
        'identify',
        '-format',
        '%w %h',
        pageFile,
      ]);

      if (result.code === 0 && result.stdout.trim()) {
        const parts = result.stdout.trim().split(' ');
        const width = Number(parts[0]);
        const height = Number(parts[1]);

        if (!isNaN(width) && !isNaN(height)) {
          dimensions.set(pageNo, { width, height });
        }
      }
    }

    return dimensions;
  }

  /**
   * Compute pixel crop region from normalized bounding box.
   * Applies padding (PADDING_RATIO) and clamps to page boundaries.
   *
   * @param bbox - Normalized bounding box (0-1, top-left origin)
   * @param pageWidth - Page width in pixels
   * @param pageHeight - Page height in pixels
   * @returns Pixel crop region { x, y, w, h }
   */
  computeCropRegion(
    bbox: VlmBBox,
    pageWidth: number,
    pageHeight: number,
  ): { x: number; y: number; w: number; h: number } {
    // Convert normalized bbox to pixel coordinates
    const rawX = bbox.l * pageWidth;
    const rawY = bbox.t * pageHeight;
    const rawW = (bbox.r - bbox.l) * pageWidth;
    const rawH = (bbox.b - bbox.t) * pageHeight;

    // Apply padding
    const padX = rawW * PADDING_RATIO;
    const padY = rawH * PADDING_RATIO;

    // Compute padded region, clamped to page boundaries
    const x = Math.max(0, Math.round(rawX - padX));
    const y = Math.max(0, Math.round(rawY - padY));
    const w = Math.min(pageWidth - x, Math.round(rawW + 2 * padX));
    const h = Math.min(pageHeight - y, Math.round(rawH + 2 * padY));

    return { x, y, w, h };
  }

  /**
   * Log warnings for outlier crop regions.
   * Does not prevent extraction — only logs for diagnostic purposes.
   */
  private validateCropRegion(
    index: number,
    w: number,
    h: number,
    pageWidth: number,
    pageHeight: number,
  ): void {
    if (w < MIN_CROP_SIZE || h < MIN_CROP_SIZE) {
      this.logger.warn(
        `[VlmImageExtractor] Picture ${index}: crop region ${w}x${h} is very small (< ${MIN_CROP_SIZE}px)`,
      );
    }

    if (w * h > MAX_AREA_RATIO * pageWidth * pageHeight) {
      this.logger.warn(
        `[VlmImageExtractor] Picture ${index}: crop region covers > ${MAX_AREA_RATIO * 100}% of page`,
      );
    }
  }

  /**
   * Crop a region from an image using ImageMagick.
   */
  private async cropImage(
    inputPath: string,
    outputPath: string,
    crop: { x: number; y: number; w: number; h: number },
  ): Promise<void> {
    const result = await spawnAsync('magick', [
      inputPath,
      '-crop',
      `${crop.w}x${crop.h}+${crop.x}+${crop.y}`,
      '+repage',
      outputPath,
    ]);

    if (result.code !== 0) {
      throw new Error(
        `[VlmImageExtractor] Failed to crop image: ${result.stderr || 'Unknown error'}`,
      );
    }
  }
}
