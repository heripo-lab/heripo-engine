import type { DoclingBBox } from '@heripo/model';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { PictureSplitCandidateDetector } from './picture-split-candidate-detector';

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

const bbox: DoclingBBox = {
  l: 0,
  t: 0,
  r: 500,
  b: 400,
  coord_origin: 'TOPLEFT',
};

function makeTxtSample(
  width: number,
  height: number,
  isContent: (x: number, y: number) => boolean,
): string {
  const lines = [
    `# ImageMagick pixel enumeration: ${width},${height},255,gray`,
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = isContent(x, y) ? 0 : 255;
      const hex = value.toString(16).padStart(2, '0').toUpperCase();
      lines.push(
        `${x},${y}: (${value},${value},${value}) #${hex}${hex}${hex} gray(${value})`,
      );
    }
  }
  return lines.join('\n');
}

function mockImageMagickSample(sample: string): void {
  mockSpawnAsync
    .mockResolvedValueOnce({ stdout: '1000 800', stderr: '', code: 0 })
    .mockResolvedValueOnce({ stdout: sample, stderr: '', code: 0 });
}

describe('PictureSplitCandidateDetector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('detects a vertical gutter with content on both sides', async () => {
    mockImageMagickSample(makeTxtSample(24, 16, (x) => x < 10 || x >= 14));

    const candidate = await new PictureSplitCandidateDetector(logger).detect({
      pageImagePath: '/tmp/page.png',
      pageSize: { width: 500, height: 400 },
      pictureBbox: bbox,
    });

    expect(candidate).toMatchObject({
      orientation: 'vertical',
      reasons: expect.arrayContaining([
        'vertical_gutter_with_content_on_both_sides',
        'separated_components_across_vertical_gutter',
      ]),
    });
    expect(candidate?.score).toBeGreaterThanOrEqual(0.65);
    expect(candidate?.suggestedRegions).toHaveLength(2);
    expect(candidate?.suggestedRegions?.[0].bbox.r).toBeGreaterThan(190);
    expect(candidate?.suggestedRegions?.[1].bbox.l).toBeLessThan(310);
  });

  test('detects a horizontal gutter with content above and below', async () => {
    mockImageMagickSample(makeTxtSample(16, 24, (_, y) => y < 10 || y >= 14));

    const candidate = await new PictureSplitCandidateDetector(logger).detect({
      pageImagePath: '/tmp/page.png',
      pageSize: { width: 500, height: 400 },
      pictureBbox: bbox,
    });

    expect(candidate).toMatchObject({
      orientation: 'horizontal',
      reasons: expect.arrayContaining([
        'horizontal_gutter_with_content_on_both_sides',
        'separated_components_across_horizontal_gutter',
      ]),
    });
    expect(candidate?.suggestedRegions).toHaveLength(2);
  });

  test('detects grid candidates when vertical and horizontal gutters are present', async () => {
    mockImageMagickSample(
      makeTxtSample(
        24,
        24,
        (x, y) => (x < 10 || x >= 14) && (y < 10 || y >= 14),
      ),
    );

    const candidate = await new PictureSplitCandidateDetector(logger).detect({
      pageImagePath: '/tmp/page.png',
      pageSize: { width: 500, height: 400 },
      pictureBbox: bbox,
    });

    expect(candidate?.orientation).toBe('grid');
    expect(candidate?.suggestedRegions).toHaveLength(4);
    expect(candidate?.reasons).toContain(
      'grid_gutters_with_content_in_each_region',
    );
  });

  test('rejects single large images without a low-content gutter', async () => {
    mockImageMagickSample(makeTxtSample(24, 16, () => true));

    await expect(
      new PictureSplitCandidateDetector(logger).detect({
        pageImagePath: '/tmp/page.png',
        pageSize: { width: 500, height: 400 },
        pictureBbox: bbox,
      }),
    ).resolves.toBeUndefined();
  });

  test('rejects blank or decorative crops without content on both sides', async () => {
    mockImageMagickSample(makeTxtSample(24, 16, () => false));

    await expect(
      new PictureSplitCandidateDetector(logger).detect({
        pageImagePath: '/tmp/page.png',
        pageSize: { width: 500, height: 400 },
        pictureBbox: bbox,
      }),
    ).resolves.toBeUndefined();
  });

  test('rejects gutters without enough content on both sides', async () => {
    mockImageMagickSample(
      makeTxtSample(24, 16, (x, y) => x < 10 || (x >= 14 && y === 0)),
    );

    await expect(
      new PictureSplitCandidateDetector(logger).detect({
        pageImagePath: '/tmp/page.png',
        pageSize: { width: 500, height: 400 },
        pictureBbox: bbox,
      }),
    ).resolves.toBeUndefined();
  });

  test('rejects gutters that are too narrow for the configured threshold', async () => {
    mockImageMagickSample(makeTxtSample(24, 16, (x) => x !== 12));

    await expect(
      new PictureSplitCandidateDetector(logger, {
        minGutterWidthRatio: 0.2,
      }).detect({
        pageImagePath: '/tmp/page.png',
        pageSize: { width: 500, height: 400 },
        pictureBbox: bbox,
      }),
    ).resolves.toBeUndefined();
  });

  test('returns no candidate when ImageMagick sampling fails', async () => {
    mockSpawnAsync
      .mockResolvedValueOnce({ stdout: '1000 800', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'bad crop', code: 1 });

    await expect(
      new PictureSplitCandidateDetector(logger).detect({
        pageImagePath: '/tmp/page.png',
        pageSize: { width: 500, height: 400 },
        pictureBbox: bbox,
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      '[PictureSplitCandidateDetector] Failed to sample picture crop: bad crop',
    );
  });

  test('returns no candidate when dimensions, crop size, or sampling are unavailable', async () => {
    mockSpawnAsync
      .mockResolvedValueOnce({ stdout: '', stderr: 'identify failed', code: 1 })
      .mockResolvedValueOnce({ stdout: '10 10', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '1000 800', stderr: '', code: 0 })
      .mockRejectedValueOnce(new Error('spawn failed'))
      .mockResolvedValueOnce({ stdout: '1000 800', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 1 });
    const detector = new PictureSplitCandidateDetector(logger);

    await expect(
      detector.detect({
        pageImagePath: '/tmp/page.png',
        pageSize: { width: 500, height: 400 },
        pictureBbox: bbox,
      }),
    ).resolves.toBeUndefined();
    await expect(
      detector.detect({
        pageImagePath: '/tmp/page.png',
        pageSize: { width: 500, height: 400 },
        pictureBbox: bbox,
      }),
    ).resolves.toBeUndefined();
    await expect(
      detector.detect({
        pageImagePath: '/tmp/page.png',
        pageSize: { width: 500, height: 400 },
        pictureBbox: bbox,
      }),
    ).resolves.toBeUndefined();
    await expect(
      detector.detect({
        pageImagePath: '/tmp/page.png',
        pageSize: { width: 500, height: 400 },
        pictureBbox: bbox,
      }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      '[PictureSplitCandidateDetector] Failed to sample picture crop',
      expect.any(Error),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      '[PictureSplitCandidateDetector] Failed to sample picture crop: Unknown error',
    );
  });

  test('skips small pictures before invoking ImageMagick', async () => {
    await expect(
      new PictureSplitCandidateDetector(logger).detect({
        pageImagePath: '/tmp/page.png',
        pageSize: { width: 500, height: 400 },
        pictureBbox: { ...bbox, r: 10, b: 10 },
      }),
    ).resolves.toBeUndefined();
    expect(mockSpawnAsync).not.toHaveBeenCalled();
  });

  test('covers parser and geometry defensive branches', async () => {
    const detector = new PictureSplitCandidateDetector(logger) as unknown as {
      parsePixelEnumeration: (
        output: string,
      ) => { width: number; height: number; values: number[] } | undefined;
      parseGrayValue: (line: string) => number | undefined;
      averageDensity: (
        densities: number[],
        start: number,
        end: number,
      ) => number;
      findGutterCandidate: (
        sample: { width: number; height: number; values: number[] },
        orientation: 'horizontal' | 'vertical',
      ) =>
        | {
            orientation: 'horizontal' | 'vertical';
            startRatio: number;
            endRatio: number;
          }
        | undefined;
      buildCandidate: (
        bbox: DoclingBBox,
        pageSize: { width: number; height: number } | null,
        input: {
          orientation: 'horizontal' | 'vertical' | 'grid';
          score: number;
          reasons: string[];
        },
      ) => unknown;
      toTopLeftRect: (
        bbox: DoclingBBox,
        pageSize: { width: number; height: number } | null,
      ) => { top: number; bottom: number };
      fromTopLeftRect: (
        rect: { left: number; top: number; right: number; bottom: number },
        bbox: DoclingBBox,
        pageSize: { width: number; height: number } | null,
      ) => DoclingBBox;
    };

    expect(
      detector.parsePixelEnumeration('not an enumeration'),
    ).toBeUndefined();
    expect(
      detector.parsePixelEnumeration(
        [
          '# ImageMagick pixel enumeration: 2,1,255,gray',
          '3,0: (0,0,0) #000000',
          '0,0: (0,0,0) gray(.)',
          '1,0: (0,0,0) #0A141E',
        ].join('\n'),
      ),
    ).toEqual({ width: 2, height: 1, values: [255, 20] });
    expect(detector.parseGrayValue('0,0: (0,0,0) gray(50%)')).toBe(128);
    expect(detector.parseGrayValue('0,0: (0,0,0) no-color')).toBeUndefined();
    expect(detector.averageDensity([], 0, 0)).toBe(0);

    const sample = {
      width: 30,
      height: 10,
      values: Array.from({ length: 300 }, (_, index) => {
        const x = index % 30;
        return x === 5 || (x >= 15 && x < 20) ? 255 : 0;
      }),
    };
    expect(detector.findGutterCandidate(sample, 'vertical')).toMatchObject({
      orientation: 'vertical',
      startRatio: 0.5,
    });
    expect(
      detector.buildCandidate(
        bbox,
        { width: 500, height: 400 },
        {
          orientation: 'vertical',
          score: 0.8,
          reasons: ['no_boundaries'],
        },
      ),
    ).toBeUndefined();

    const bottomLeftBbox: DoclingBBox = {
      l: 0,
      t: 400,
      r: 500,
      b: 0,
      coord_origin: 'BOTTOMLEFT',
    };
    expect(
      detector.toTopLeftRect(bottomLeftBbox, { width: 500, height: 400 }),
    ).toMatchObject({ top: 0, bottom: 400 });
    expect(detector.toTopLeftRect(bottomLeftBbox, null)).toMatchObject({
      top: 0,
      bottom: 400,
    });
    expect(
      detector.fromTopLeftRect(
        { left: 0, top: 0, right: 250, bottom: 200 },
        bottomLeftBbox,
        { width: 500, height: 400 },
      ),
    ).toMatchObject({ t: 400, b: 200, coord_origin: 'BOTTOMLEFT' });
    expect(
      detector.fromTopLeftRect(
        { left: 0, top: 0, right: 250, bottom: 200 },
        bottomLeftBbox,
        null,
      ),
    ).toMatchObject({ t: 400, b: 200, coord_origin: 'BOTTOMLEFT' });
    expect(
      detector.fromTopLeftRect(
        { left: 0, top: 0, right: 250, bottom: 200 },
        { l: 0, t: 0, r: 500, b: 400 } as DoclingBBox,
        { width: 500, height: 400 },
      ),
    ).toMatchObject({ coord_origin: 'TOPLEFT' });
  });

  test('rejects candidate regions that are too small', async () => {
    mockImageMagickSample(makeTxtSample(24, 16, (x) => x < 10 || x >= 14));

    await expect(
      new PictureSplitCandidateDetector(logger, {
        minRegionAreaRatio: 0.45,
      }).detect({
        pageImagePath: '/tmp/page.png',
        pageSize: { width: 500, height: 400 },
        pictureBbox: bbox,
      }),
    ).resolves.toBeUndefined();
  });
});
