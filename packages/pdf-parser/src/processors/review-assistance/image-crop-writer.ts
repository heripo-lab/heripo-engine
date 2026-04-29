import type { LoggerMethods } from '@heripo/logger';
import type { DoclingBBox } from '@heripo/model';

import { spawnAsync } from '@heripo/shared';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { ImageRegionSnapper } from './image-region-snapper';

export interface ImageCropWriteInput {
  outputDir: string;
  pageNo: number;
  pageImagePath: string;
  pageSize: { width: number; height: number } | null;
  bbox: DoclingBBox;
  decisionId: string;
  regionId?: string;
}

export interface ImageCropWriteResult {
  imageUri: string;
  outputPath: string;
}

export class ImageCropWriter {
  private readonly snapper: ImageRegionSnapper;

  constructor(private readonly logger: LoggerMethods) {
    this.snapper = new ImageRegionSnapper(logger);
  }

  async writeCrop(input: ImageCropWriteInput): Promise<ImageCropWriteResult> {
    const imagesDir = join(input.outputDir, 'images');
    if (!existsSync(imagesDir)) {
      mkdirSync(imagesDir, { recursive: true });
    }

    const filename = this.buildFilename(input);
    const imageUri = `images/${filename}`;
    const outputPath = join(input.outputDir, imageUri);
    if (existsSync(outputPath)) {
      return { imageUri, outputPath };
    }

    const dims = await this.snapper.getImageDimensions(input.pageImagePath);
    if (!dims) {
      throw new Error('page_image_dimensions_unavailable');
    }

    const rect = this.snapper.bboxToPixelRect(input.bbox, input.pageSize, dims);
    const x = Math.max(0, Math.round(rect.x));
    const y = Math.max(0, Math.round(rect.y));
    const width = Math.max(1, Math.min(dims.width - x, Math.round(rect.width)));
    const height = Math.max(
      1,
      Math.min(dims.height - y, Math.round(rect.height)),
    );

    const result = await spawnAsync('magick', [
      input.pageImagePath,
      '-crop',
      `${width}x${height}+${x}+${y}`,
      '+repage',
      outputPath,
    ]);

    if (result.code !== 0) {
      throw new Error(
        `[ImageCropWriter] Failed to write crop: ${result.stderr || 'Unknown error'}`,
      );
    }

    this.logger.info(`[ImageCropWriter] Wrote assisted image ${imageUri}`);
    return { imageUri, outputPath };
  }

  private buildFilename(input: ImageCropWriteInput): string {
    const suffix = input.regionId ? `_${this.safeId(input.regionId)}` : '';
    return `assisted_page${input.pageNo}_${this.safeId(input.decisionId)}${suffix}.png`;
  }

  private safeId(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  }
}
