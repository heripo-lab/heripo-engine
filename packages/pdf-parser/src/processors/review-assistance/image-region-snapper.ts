import type { LoggerMethods } from '@heripo/logger';
import type { DoclingBBox } from '@heripo/model';

import { spawnAsync } from '@heripo/shared';

export interface SnappedImageRegion {
  source: 'vlm_rough_bbox' | 'deterministic_component' | 'edge_snap';
  originalBbox: DoclingBBox;
  snappedBbox: DoclingBBox;
  confidence: number;
  warnings: string[];
}

export interface ImageRegionSnapperOptions {
  minIou?: number;
  minWidth?: number;
  minHeight?: number;
  trimFuzzPercent?: number;
}

interface ImageDimensions {
  width: number;
  height: number;
}

interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_MIN_IOU = 0.2;
const DEFAULT_MIN_SIZE = 20;
const DEFAULT_TRIM_FUZZ_PERCENT = 8;

export class ImageRegionSnapper {
  constructor(
    private readonly logger: LoggerMethods,
    private readonly options: ImageRegionSnapperOptions = {},
  ) {}

  async snap(
    pageImagePath: string,
    pageSize: { width: number; height: number } | null,
    bbox: DoclingBBox,
  ): Promise<SnappedImageRegion> {
    const warnings: string[] = [];
    const dims = await this.getImageDimensions(pageImagePath);
    if (!dims) {
      warnings.push('page_image_dimensions_unavailable');
      return this.roughResult(bbox, warnings);
    }

    const roughRect = this.bboxToPixelRect(bbox, pageSize, dims);
    const cropRect = this.clampRect(roughRect, dims);
    if (!this.isUsableRect(cropRect)) {
      warnings.push('rough_bbox_unusable');
      return this.roughResult(bbox, warnings);
    }

    const trim = await this.trimCrop(pageImagePath, cropRect);
    if (!trim) {
      warnings.push('trim_geometry_unavailable');
      return this.roughResult(bbox, warnings);
    }

    const snappedRect = this.clampRect(
      {
        x: cropRect.x + trim.x,
        y: cropRect.y + trim.y,
        width: trim.width,
        height: trim.height,
      },
      dims,
    );

    if (!this.isUsableRect(snappedRect)) {
      warnings.push('snapped_bbox_too_small');
      return this.roughResult(bbox, warnings);
    }

    const iou = this.rectIou(cropRect, snappedRect);
    if (iou < (this.options.minIou ?? DEFAULT_MIN_IOU)) {
      warnings.push('snapped_bbox_iou_too_low');
      return this.roughResult(bbox, warnings, 0.6);
    }

    return {
      source: 'edge_snap',
      originalBbox: bbox,
      snappedBbox: this.pixelRectToBbox(snappedRect, pageSize, dims, bbox),
      confidence: Math.min(1, 0.8 + iou * 0.2),
      warnings,
    };
  }

  bboxToPixelRect(
    bbox: DoclingBBox,
    pageSize: { width: number; height: number } | null,
    dims: ImageDimensions,
  ): PixelRect {
    const docWidth = pageSize?.width || dims.width;
    const docHeight = pageSize?.height || dims.height;
    const scaleX = dims.width / docWidth;
    const scaleY = dims.height / docHeight;
    const left = Math.min(bbox.l, bbox.r) * scaleX;
    const right = Math.max(bbox.l, bbox.r) * scaleX;

    if (bbox.coord_origin === 'BOTTOMLEFT') {
      const top = (docHeight - Math.max(bbox.t, bbox.b)) * scaleY;
      const bottom = (docHeight - Math.min(bbox.t, bbox.b)) * scaleY;
      return {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(right - left),
        height: Math.round(bottom - top),
      };
    }

    const top = Math.min(bbox.t, bbox.b) * scaleY;
    const bottom = Math.max(bbox.t, bbox.b) * scaleY;
    return {
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(right - left),
      height: Math.round(bottom - top),
    };
  }

  pixelRectToBbox(
    rect: PixelRect,
    pageSize: { width: number; height: number } | null,
    dims: ImageDimensions,
    originalBbox: DoclingBBox,
  ): DoclingBBox {
    const docWidth = pageSize?.width || dims.width;
    const docHeight = pageSize?.height || dims.height;
    const scaleX = docWidth / dims.width;
    const scaleY = docHeight / dims.height;
    const l = rect.x * scaleX;
    const r = (rect.x + rect.width) * scaleX;

    if (originalBbox.coord_origin === 'BOTTOMLEFT') {
      return {
        l,
        r,
        t: docHeight - rect.y * scaleY,
        b: docHeight - (rect.y + rect.height) * scaleY,
        coord_origin: 'BOTTOMLEFT',
      };
    }

    return {
      l,
      r,
      t: rect.y * scaleY,
      b: (rect.y + rect.height) * scaleY,
      coord_origin: originalBbox.coord_origin || 'TOPLEFT',
    };
  }

  async getImageDimensions(
    pageImagePath: string,
  ): Promise<ImageDimensions | undefined> {
    try {
      const result = await spawnAsync('magick', [
        'identify',
        '-format',
        '%w %h',
        pageImagePath,
      ]);
      if (result.code !== 0) {
        this.logger.warn(
          `[ImageRegionSnapper] Failed to identify page image: ${result.stderr || 'Unknown error'}`,
        );
        return undefined;
      }

      const [width, height] = result.stdout.trim().split(/\s+/).map(Number);
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        return undefined;
      }
      return { width, height };
    } catch (error) {
      this.logger.warn(
        '[ImageRegionSnapper] Failed to read page image dimensions',
        error,
      );
      return undefined;
    }
  }

  private async trimCrop(
    pageImagePath: string,
    rect: PixelRect,
  ): Promise<PixelRect | undefined> {
    try {
      const result = await spawnAsync('magick', [
        pageImagePath,
        '-crop',
        `${rect.width}x${rect.height}+${rect.x}+${rect.y}`,
        '+repage',
        '-fuzz',
        `${this.options.trimFuzzPercent ?? DEFAULT_TRIM_FUZZ_PERCENT}%`,
        '-trim',
        '-format',
        '%@',
        'info:',
      ]);
      if (result.code !== 0) {
        this.logger.warn(
          `[ImageRegionSnapper] Failed to trim crop: ${result.stderr || 'Unknown error'}`,
        );
        return undefined;
      }

      return this.parseGeometry(result.stdout.trim());
    } catch (error) {
      this.logger.warn('[ImageRegionSnapper] Crop trim failed', error);
      return undefined;
    }
  }

  private parseGeometry(value: string): PixelRect | undefined {
    const match = value.match(/^(\d+)x(\d+)\+(-?\d+)\+(-?\d+)$/);
    if (!match) return undefined;
    const width = Number(match[1]);
    const height = Number(match[2]);
    const x = Number(match[3]);
    const y = Number(match[4]);
    if (![width, height, x, y].every(Number.isFinite)) return undefined;
    return { x, y, width, height };
  }

  private roughResult(
    bbox: DoclingBBox,
    warnings: string[],
    confidence = 0.5,
  ): SnappedImageRegion {
    return {
      source: 'vlm_rough_bbox',
      originalBbox: bbox,
      snappedBbox: bbox,
      confidence,
      warnings,
    };
  }

  private clampRect(rect: PixelRect, dims: ImageDimensions): PixelRect {
    const x = Math.max(0, Math.min(dims.width, rect.x));
    const y = Math.max(0, Math.min(dims.height, rect.y));
    const right = Math.max(x, Math.min(dims.width, rect.x + rect.width));
    const bottom = Math.max(y, Math.min(dims.height, rect.y + rect.height));
    return {
      x,
      y,
      width: right - x,
      height: bottom - y,
    };
  }

  private isUsableRect(rect: PixelRect): boolean {
    const minSize = this.options.minWidth ?? this.options.minHeight;
    const minWidth = this.options.minWidth ?? minSize ?? DEFAULT_MIN_SIZE;
    const minHeight = this.options.minHeight ?? minSize ?? DEFAULT_MIN_SIZE;
    return rect.width >= minWidth && rect.height >= minHeight;
  }

  private rectIou(a: PixelRect, b: PixelRect): number {
    const left = Math.max(a.x, b.x);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    const union = areaA + areaB - intersection;
    return union === 0 ? 0 : intersection / union;
  }
}
