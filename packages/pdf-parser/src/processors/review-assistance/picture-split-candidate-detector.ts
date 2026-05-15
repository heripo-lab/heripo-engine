import type { LoggerMethods } from '@heripo/logger';
import type { DoclingBBox } from '@heripo/model';

import type { PageReviewPictureSplitCandidate } from './page-review-context-builder';

import { spawnAsync } from '@heripo/shared';

import { ImageRegionSnapper } from './image-region-snapper';

export interface PictureSplitCandidateDetectorInput {
  pageImagePath: string;
  pageSize: { width: number; height: number } | null;
  pictureBbox: DoclingBBox;
}

export interface PictureSplitCandidateDetectorOptions {
  minDocumentArea?: number;
  sampleSize?: number;
  blankThreshold?: number;
  maxGutterContentRatio?: number;
  minSideContentRatio?: number;
  minGutterWidthRatio?: number;
  minRegionAreaRatio?: number;
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

interface PixelSample {
  width: number;
  height: number;
  values: number[];
}

interface GutterCandidate {
  orientation: 'horizontal' | 'vertical';
  startRatio: number;
  endRatio: number;
  score: number;
  reasons: string[];
}

interface TopLeftRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const DEFAULT_MIN_DOCUMENT_AREA = 100_000;
const DEFAULT_SAMPLE_SIZE = 96;
const DEFAULT_BLANK_THRESHOLD = 245;
const DEFAULT_MAX_GUTTER_CONTENT_RATIO = 0.06;
const DEFAULT_MIN_SIDE_CONTENT_RATIO = 0.18;
const DEFAULT_MIN_GUTTER_WIDTH_RATIO = 0.025;
const DEFAULT_MIN_REGION_AREA_RATIO = 0.08;
const MIN_SCORE = 0.65;

export class PictureSplitCandidateDetector {
  private readonly snapper: ImageRegionSnapper;

  constructor(
    private readonly logger: LoggerMethods,
    private readonly options: PictureSplitCandidateDetectorOptions = {},
    snapper?: ImageRegionSnapper,
  ) {
    this.snapper = snapper ?? new ImageRegionSnapper(logger);
  }

  async detect(
    input: PictureSplitCandidateDetectorInput,
  ): Promise<PageReviewPictureSplitCandidate | undefined> {
    if (!this.isLargeEnoughForInspection(input.pictureBbox)) {
      return undefined;
    }

    const dims = await this.snapper.getImageDimensions(input.pageImagePath);
    if (!dims) return undefined;

    const cropRect = this.clampRect(
      this.snapper.bboxToPixelRect(input.pictureBbox, input.pageSize, dims),
      dims,
    );
    if (!this.isUsableRect(cropRect)) return undefined;

    const sample = await this.readGraySample(input.pageImagePath, cropRect);
    if (!sample) return undefined;

    const vertical = this.findGutterCandidate(sample, 'vertical');
    const horizontal = this.findGutterCandidate(sample, 'horizontal');
    const candidates = [vertical, horizontal].filter(
      (candidate): candidate is GutterCandidate =>
        candidate !== undefined && candidate.score >= MIN_SCORE,
    );
    if (candidates.length === 0) return undefined;

    if (
      vertical &&
      horizontal &&
      vertical.score >= MIN_SCORE &&
      horizontal.score >= MIN_SCORE
    ) {
      return this.buildCandidate(input.pictureBbox, input.pageSize, {
        orientation: 'grid',
        score: Math.min(vertical.score, horizontal.score),
        reasons: [
          ...vertical.reasons,
          ...horizontal.reasons,
          'grid_gutters_with_content_in_each_region',
        ],
        vertical,
        horizontal,
      });
    }

    const best = candidates[0];
    return this.buildCandidate(input.pictureBbox, input.pageSize, {
      orientation: best.orientation,
      score: best.score,
      reasons: best.reasons,
      vertical: best.orientation === 'vertical' ? best : undefined,
      horizontal: best.orientation === 'horizontal' ? best : undefined,
    });
  }

  private async readGraySample(
    pageImagePath: string,
    rect: PixelRect,
  ): Promise<PixelSample | undefined> {
    try {
      const sampleSize = this.options.sampleSize ?? DEFAULT_SAMPLE_SIZE;
      const result = await spawnAsync('magick', [
        pageImagePath,
        '-crop',
        `${rect.width}x${rect.height}+${rect.x}+${rect.y}`,
        '+repage',
        '-resize',
        `${sampleSize}x${sampleSize}!`,
        '-colorspace',
        'Gray',
        '-depth',
        '8',
        'txt:-',
      ]);
      if (result.code !== 0) {
        this.logger.warn(
          `[PictureSplitCandidateDetector] Failed to sample picture crop: ${result.stderr || 'Unknown error'}`,
        );
        return undefined;
      }
      return this.parsePixelEnumeration(result.stdout);
    } catch (error) {
      this.logger.warn(
        '[PictureSplitCandidateDetector] Failed to sample picture crop',
        error,
      );
      return undefined;
    }
  }

  private parsePixelEnumeration(output: string): PixelSample | undefined {
    const header = output.match(
      /# ImageMagick pixel enumeration:\s*(\d+),(\d+)/,
    );
    if (!header) return undefined;
    const width = Number(header[1]);
    const height = Number(header[2]);

    const values = Array.from({ length: width * height }, () => 255);
    for (const line of output.split('\n')) {
      const point = line.match(/^(\d+),(\d+):/);
      if (!point) continue;
      const x = Number(point[1]);
      const y = Number(point[2]);
      if (x >= width || y >= height) continue;
      const gray = this.parseGrayValue(line);
      if (gray !== undefined) {
        values[y * width + x] = gray;
      }
    }

    return { width, height, values };
  }

  private parseGrayValue(line: string): number | undefined {
    const gray = line.match(/gray\(([\d.]+)%?\)/i);
    if (gray) {
      const value = Number(gray[1]);
      if (!Number.isFinite(value)) return undefined;
      return gray[0].includes('%')
        ? Math.max(0, Math.min(255, Math.round((value / 100) * 255)))
        : Math.max(0, Math.min(255, Math.round(value)));
    }

    const hex = line.match(/#([0-9A-Fa-f]{6})\b/);
    if (!hex) return undefined;
    const r = Number.parseInt(hex[1].slice(0, 2), 16);
    const g = Number.parseInt(hex[1].slice(2, 4), 16);
    const b = Number.parseInt(hex[1].slice(4, 6), 16);
    return Math.round((r + g + b) / 3);
  }

  private findGutterCandidate(
    sample: PixelSample,
    orientation: 'horizontal' | 'vertical',
  ): GutterCandidate | undefined {
    const axisLength =
      orientation === 'vertical' ? sample.width : sample.height;
    const densities = Array.from({ length: axisLength }, (_, index) =>
      this.contentDensity(sample, orientation, index),
    );
    const runs = this.findLowContentRuns(densities);
    const minGutterWidth = Math.max(
      1,
      Math.ceil(
        axisLength *
          (this.options.minGutterWidthRatio ?? DEFAULT_MIN_GUTTER_WIDTH_RATIO),
      ),
    );

    let best: GutterCandidate | undefined;
    for (const run of runs) {
      const runWidth = run.end - run.start;
      if (runWidth < minGutterWidth) continue;
      if (run.start <= axisLength * 0.08 || run.end >= axisLength * 0.92) {
        continue;
      }

      const before = this.averageDensity(densities, 0, run.start);
      const after = this.averageDensity(densities, run.end, axisLength);
      const minSideContent =
        this.options.minSideContentRatio ?? DEFAULT_MIN_SIDE_CONTENT_RATIO;
      if (before < minSideContent || after < minSideContent) {
        continue;
      }

      const gutterContent = this.averageDensity(densities, run.start, run.end);
      const score = this.scoreGutter(
        before,
        after,
        gutterContent,
        runWidth,
        axisLength,
      );
      const reasons =
        orientation === 'vertical'
          ? [
              'vertical_gutter_with_content_on_both_sides',
              'separated_components_across_vertical_gutter',
            ]
          : [
              'horizontal_gutter_with_content_on_both_sides',
              'separated_components_across_horizontal_gutter',
            ];
      const candidate = {
        orientation,
        startRatio: run.start / axisLength,
        endRatio: run.end / axisLength,
        score,
        reasons,
      };
      if (!best || candidate.score > best.score) {
        best = candidate;
      }
    }
    return best;
  }

  private contentDensity(
    sample: PixelSample,
    orientation: 'horizontal' | 'vertical',
    axisIndex: number,
  ): number {
    const blankThreshold =
      this.options.blankThreshold ?? DEFAULT_BLANK_THRESHOLD;
    let contentPixels = 0;
    const length = orientation === 'vertical' ? sample.height : sample.width;
    for (let offset = 0; offset < length; offset++) {
      const x = orientation === 'vertical' ? axisIndex : offset;
      const y = orientation === 'vertical' ? offset : axisIndex;
      if (sample.values[y * sample.width + x] < blankThreshold) {
        contentPixels += 1;
      }
    }
    return contentPixels / length;
  }

  private findLowContentRuns(
    densities: number[],
  ): Array<{ start: number; end: number }> {
    const maxGutterContent =
      this.options.maxGutterContentRatio ?? DEFAULT_MAX_GUTTER_CONTENT_RATIO;
    const runs: Array<{ start: number; end: number }> = [];
    let start: number | undefined;
    for (let index = 0; index <= densities.length; index++) {
      const isLow =
        index < densities.length && densities[index] <= maxGutterContent;
      if (isLow && start === undefined) {
        start = index;
      } else if (!isLow && start !== undefined) {
        runs.push({ start, end: index });
        start = undefined;
      }
    }
    return runs;
  }

  private averageDensity(
    densities: number[],
    start: number,
    end: number,
  ): number {
    if (end <= start) return 0;
    const total = densities
      .slice(start, end)
      .reduce((sum, density) => sum + density, 0);
    return total / (end - start);
  }

  private scoreGutter(
    before: number,
    after: number,
    gutterContent: number,
    gutterWidth: number,
    axisLength: number,
  ): number {
    const sideStrength = Math.min(before, after);
    const blankStrength = 1 - gutterContent;
    const widthStrength = Math.min(
      1,
      gutterWidth / Math.max(1, axisLength * 0.08),
    );
    return Math.max(
      0,
      Math.min(
        1,
        0.35 * blankStrength +
          0.45 * Math.min(1, sideStrength / 0.45) +
          0.2 * widthStrength,
      ),
    );
  }

  private buildCandidate(
    bbox: DoclingBBox,
    pageSize: { width: number; height: number } | null,
    input: {
      orientation: 'horizontal' | 'vertical' | 'grid';
      score: number;
      reasons: string[];
      vertical?: GutterCandidate;
      horizontal?: GutterCandidate;
    },
  ): PageReviewPictureSplitCandidate | undefined {
    const suggestedRegions = this.buildSuggestedRegions(
      bbox,
      pageSize,
      input.vertical,
      input.horizontal,
    );
    if (suggestedRegions.length < 2) return undefined;
    if (!this.regionsPassMinimumArea(bbox, pageSize, suggestedRegions)) {
      return undefined;
    }
    return {
      score: Number(input.score.toFixed(2)),
      orientation: input.orientation,
      reasons: [...new Set(input.reasons)],
      suggestedRegions,
    };
  }

  private buildSuggestedRegions(
    bbox: DoclingBBox,
    pageSize: { width: number; height: number } | null,
    vertical?: GutterCandidate,
    horizontal?: GutterCandidate,
  ): Array<{ bbox: DoclingBBox; confidence: number }> {
    const source = this.toTopLeftRect(bbox, pageSize);
    const xRanges = vertical
      ? [
          [
            source.left,
            this.interpolate(source.left, source.right, vertical.startRatio),
          ],
          [
            this.interpolate(source.left, source.right, vertical.endRatio),
            source.right,
          ],
        ]
      : [[source.left, source.right]];
    const yRanges = horizontal
      ? [
          [
            source.top,
            this.interpolate(source.top, source.bottom, horizontal.startRatio),
          ],
          [
            this.interpolate(source.top, source.bottom, horizontal.endRatio),
            source.bottom,
          ],
        ]
      : [[source.top, source.bottom]];
    const confidence = Math.min(vertical?.score ?? 1, horizontal?.score ?? 1);

    return yRanges.flatMap(([top, bottom]) =>
      xRanges.map(([left, right]) => ({
        bbox: this.fromTopLeftRect(
          { left, top, right, bottom },
          bbox,
          pageSize,
        ),
        confidence: Number(confidence.toFixed(2)),
      })),
    );
  }

  private regionsPassMinimumArea(
    sourceBbox: DoclingBBox,
    pageSize: { width: number; height: number } | null,
    regions: Array<{ bbox: DoclingBBox }>,
  ): boolean {
    const source = this.toTopLeftRect(sourceBbox, pageSize);
    const sourceArea = this.rectArea(source);
    const minRatio =
      this.options.minRegionAreaRatio ?? DEFAULT_MIN_REGION_AREA_RATIO;
    return regions.every((region) => {
      const rect = this.toTopLeftRect(region.bbox, pageSize);
      return this.rectArea(rect) >= sourceArea * minRatio;
    });
  }

  private isLargeEnoughForInspection(bbox: DoclingBBox): boolean {
    return (
      this.bboxArea(bbox) >=
      (this.options.minDocumentArea ?? DEFAULT_MIN_DOCUMENT_AREA)
    );
  }

  private bboxArea(bbox: DoclingBBox): number {
    return Math.abs(bbox.r - bbox.l) * Math.abs(bbox.b - bbox.t);
  }

  private isUsableRect(rect: PixelRect): boolean {
    return rect.width >= 40 && rect.height >= 40;
  }

  private clampRect(rect: PixelRect, dims: ImageDimensions): PixelRect {
    const x = Math.max(0, Math.min(dims.width, rect.x));
    const y = Math.max(0, Math.min(dims.height, rect.y));
    const right = Math.max(x, Math.min(dims.width, rect.x + rect.width));
    const bottom = Math.max(y, Math.min(dims.height, rect.y + rect.height));
    return {
      x,
      y,
      width: Math.round(right - x),
      height: Math.round(bottom - y),
    };
  }

  private toTopLeftRect(
    bbox: DoclingBBox,
    pageSize: { width: number; height: number } | null,
  ): TopLeftRect {
    const left = Math.min(bbox.l, bbox.r);
    const right = Math.max(bbox.l, bbox.r);
    if (bbox.coord_origin === 'BOTTOMLEFT') {
      const pageHeight = pageSize?.height ?? Math.max(bbox.t, bbox.b);
      return {
        left,
        right,
        top: pageHeight - Math.max(bbox.t, bbox.b),
        bottom: pageHeight - Math.min(bbox.t, bbox.b),
      };
    }
    return {
      left,
      right,
      top: Math.min(bbox.t, bbox.b),
      bottom: Math.max(bbox.t, bbox.b),
    };
  }

  private fromTopLeftRect(
    rect: TopLeftRect,
    originalBbox: DoclingBBox,
    pageSize: { width: number; height: number } | null,
  ): DoclingBBox {
    if (originalBbox.coord_origin === 'BOTTOMLEFT') {
      const pageHeight =
        pageSize?.height ?? Math.max(originalBbox.t, originalBbox.b);
      return {
        l: rect.left,
        r: rect.right,
        t: pageHeight - rect.top,
        b: pageHeight - rect.bottom,
        coord_origin: 'BOTTOMLEFT',
      };
    }
    return {
      l: rect.left,
      t: rect.top,
      r: rect.right,
      b: rect.bottom,
      coord_origin: originalBbox.coord_origin || 'TOPLEFT',
    };
  }

  private rectArea(rect: TopLeftRect): number {
    return (
      Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top)
    );
  }

  private interpolate(start: number, end: number, ratio: number): number {
    return start + (end - start) * ratio;
  }
}
