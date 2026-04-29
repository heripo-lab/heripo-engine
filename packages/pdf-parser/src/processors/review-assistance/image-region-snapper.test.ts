import type { DoclingBBox } from '@heripo/model';

import { describe, expect, test, vi } from 'vitest';

import { ImageRegionSnapper } from './image-region-snapper';

const { mockSpawnAsync } = vi.hoisted(() => ({
  mockSpawnAsync: vi.fn(),
}));

vi.mock('@heripo/shared', () => ({
  spawnAsync: mockSpawnAsync,
}));

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const topLeftBbox: DoclingBBox = {
  l: 10,
  t: 10,
  r: 90,
  b: 90,
  coord_origin: 'TOPLEFT',
};

describe('ImageRegionSnapper', () => {
  test('snaps a top-left bbox using trimmed crop geometry', async () => {
    mockSpawnAsync
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '80x70+10+20', stderr: '', code: 0 });

    const result = await new ImageRegionSnapper(logger).snap(
      '/tmp/page.png',
      { width: 100, height: 100 },
      topLeftBbox,
    );

    expect(result.source).toBe('edge_snap');
    expect(result.snappedBbox).toMatchObject({
      l: 15,
      t: 20,
      r: 55,
      b: 55,
      coord_origin: 'TOPLEFT',
    });
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  test('converts bottom-left bboxes to and from pixel rects', () => {
    const snapper = new ImageRegionSnapper(logger);
    const bbox: DoclingBBox = {
      l: 10,
      t: 90,
      r: 60,
      b: 40,
      coord_origin: 'BOTTOMLEFT',
    };

    const rect = snapper.bboxToPixelRect(
      bbox,
      { width: 100, height: 100 },
      {
        width: 200,
        height: 200,
      },
    );
    const roundTrip = snapper.pixelRectToBbox(
      rect,
      { width: 100, height: 100 },
      { width: 200, height: 200 },
      bbox,
    );

    expect(rect).toEqual({ x: 20, y: 20, width: 100, height: 100 });
    expect(roundTrip).toEqual(bbox);
  });

  test('returns rough bbox when dimensions are unavailable', async () => {
    mockSpawnAsync.mockRejectedValueOnce(new Error('missing magick'));

    const result = await new ImageRegionSnapper(logger).snap(
      '/tmp/page.png',
      null,
      topLeftBbox,
    );

    expect(result).toMatchObject({
      source: 'vlm_rough_bbox',
      snappedBbox: topLeftBbox,
      warnings: ['page_image_dimensions_unavailable'],
    });
    expect(logger.warn).toHaveBeenCalledWith(
      '[ImageRegionSnapper] Failed to read page image dimensions',
      expect.any(Error),
    );
  });

  test('returns undefined dimensions for identify failures and invalid output', async () => {
    mockSpawnAsync
      .mockResolvedValueOnce({ stdout: '', stderr: 'bad', code: 1 })
      .mockResolvedValueOnce({ stdout: 'nan 200', stderr: '', code: 0 });
    const snapper = new ImageRegionSnapper(logger);

    await expect(
      snapper.getImageDimensions('/tmp/a.png'),
    ).resolves.toBeUndefined();
    await expect(
      snapper.getImageDimensions('/tmp/b.png'),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      '[ImageRegionSnapper] Failed to identify page image: bad',
    );
  });

  test('keeps rough bbox for unusable rough or snapped regions', async () => {
    mockSpawnAsync
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '1x1+0+0', stderr: '', code: 0 });
    const snapper = new ImageRegionSnapper(logger);

    const rough = await snapper.snap(
      '/tmp/page.png',
      { width: 100, height: 100 },
      {
        l: 10,
        t: 10,
        r: 10.5,
        b: 10.5,
        coord_origin: 'TOPLEFT',
      },
    );
    const snapped = await snapper.snap(
      '/tmp/page.png',
      { width: 100, height: 100 },
      topLeftBbox,
    );

    expect(rough.warnings).toContain('rough_bbox_unusable');
    expect(snapped.warnings).toContain('snapped_bbox_too_small');
  });

  test('keeps rough bbox when trim fails, is invalid, or moves too far', async () => {
    mockSpawnAsync
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'trim failed', code: 1 })
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: 'not-geometry', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '20x20+0+0', stderr: '', code: 0 });
    const snapper = new ImageRegionSnapper(logger, { minWidth: 10 });

    const failed = await snapper.snap(
      '/tmp/page.png',
      { width: 100, height: 100 },
      topLeftBbox,
    );
    const invalid = await snapper.snap(
      '/tmp/page.png',
      { width: 100, height: 100 },
      topLeftBbox,
    );
    const lowIou = await snapper.snap(
      '/tmp/page.png',
      { width: 100, height: 100 },
      topLeftBbox,
    );

    expect(failed.warnings).toContain('trim_geometry_unavailable');
    expect(invalid.warnings).toContain('trim_geometry_unavailable');
    expect(lowIou.warnings).toContain('snapped_bbox_iou_too_low');
    expect(lowIou.confidence).toBe(0.6);
  });

  test('keeps rough bbox when trim throws and covers default conversions', async () => {
    mockSpawnAsync
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockRejectedValueOnce(new Error('trim crashed'));
    const snapper = new ImageRegionSnapper(logger);

    const result = await snapper.snap('/tmp/page.png', null, {
      l: 10,
      t: 10,
      r: 90,
      b: 90,
      coord_origin: '',
    });
    const bbox = snapper.pixelRectToBbox(
      { x: 10, y: 20, width: 30, height: 40 },
      null,
      { width: 100, height: 200 },
      { l: 0, t: 0, r: 0, b: 0, coord_origin: '' },
    );

    expect(result.warnings).toContain('trim_geometry_unavailable');
    expect(logger.warn).toHaveBeenCalledWith(
      '[ImageRegionSnapper] Crop trim failed',
      expect.any(Error),
    );
    expect(bbox.coord_origin).toBe('TOPLEFT');
  });

  test('uses unknown warning text when ImageMagick stderr is empty', async () => {
    mockSpawnAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 1 })
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 1 });
    const snapper = new ImageRegionSnapper(logger);

    await expect(
      snapper.getImageDimensions('/tmp/page.png'),
    ).resolves.toBeUndefined();
    const result = await snapper.snap(
      '/tmp/page.png',
      { width: 100, height: 100 },
      topLeftBbox,
    );

    expect(result.warnings).toContain('trim_geometry_unavailable');
    expect(logger.warn).toHaveBeenCalledWith(
      '[ImageRegionSnapper] Failed to identify page image: Unknown error',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      '[ImageRegionSnapper] Failed to trim crop: Unknown error',
    );
  });

  test('returns zero IoU for empty private rects', () => {
    const snapper = new ImageRegionSnapper(logger) as unknown as {
      rectIou: (
        a: { x: number; y: number; width: number; height: number },
        b: { x: number; y: number; width: number; height: number },
      ) => number;
      parseGeometry: (value: string) => unknown;
    };

    expect(snapper.parseGeometry('1x1+a+b')).toBeUndefined();
    expect(snapper.parseGeometry(`${'9'.repeat(400)}x1+0+0`)).toBeUndefined();
    expect(
      snapper.rectIou(
        { x: 0, y: 0, width: 0, height: 0 },
        { x: 0, y: 0, width: 0, height: 0 },
      ),
    ).toBe(0);
  });
});
