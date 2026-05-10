import type { DoclingBBox } from '@heripo/model';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ImageCropWriter } from './image-crop-writer';

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
  l: 10,
  t: 10,
  r: 90,
  b: 90,
  coord_origin: 'TOPLEFT',
};

describe('ImageCropWriter', () => {
  let outputDir: string;
  let pageImagePath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    outputDir = mkdtempSync(join(tmpdir(), 'crop-writer-'));
    mkdirSync(join(outputDir, 'pages'), { recursive: true });
    pageImagePath = join(outputDir, 'pages', 'page_0.png');
    writeFileSync(pageImagePath, Buffer.from([1]));
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  test('writes a deterministic crop path', async () => {
    mockSpawnAsync
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });

    const result = await new ImageCropWriter(logger).writeCrop({
      outputDir,
      pageNo: 1,
      pageImagePath,
      pageSize: { width: 100, height: 100 },
      bbox,
      decisionId: 'ra:test/1',
      regionId: 'left panel',
    });

    expect(result.imageUri).toBe(
      'images/assisted_page1_ra_test_1_left_panel.png',
    );
    expect(result.created).toBe(true);
    expect(mockSpawnAsync).toHaveBeenLastCalledWith('magick', [
      pageImagePath,
      '-crop',
      '160x160+20+20',
      '+repage',
      result.outputPath,
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      '[ImageCropWriter] Wrote assisted image images/assisted_page1_ra_test_1_left_panel.png',
    );
  });

  test('returns an existing deterministic crop without invoking ImageMagick', async () => {
    const imagesDir = join(outputDir, 'images');
    mkdirSync(imagesDir, { recursive: true });
    const outputPath = join(imagesDir, 'assisted_page1_existing.png');
    writeFileSync(outputPath, Buffer.from([1]));

    const result = await new ImageCropWriter(logger).writeCrop({
      outputDir,
      pageNo: 1,
      pageImagePath,
      pageSize: null,
      bbox,
      decisionId: 'existing',
    });

    expect(result).toEqual({
      imageUri: 'images/assisted_page1_existing.png',
      outputPath,
      created: false,
    });
    expect(mockSpawnAsync).not.toHaveBeenCalled();
  });

  test('throws when dimensions are unavailable or crop command fails', async () => {
    mockSpawnAsync
      .mockResolvedValueOnce({ stdout: '', stderr: 'identify failed', code: 1 })
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockImplementationOnce(async (_command, args: string[]) => {
        writeFileSync(args.at(-1)!, Buffer.from([1]));
        return { stdout: '', stderr: 'crop failed', code: 1 };
      });
    const writer = new ImageCropWriter(logger);

    await expect(
      writer.writeCrop({
        outputDir,
        pageNo: 1,
        pageImagePath,
        pageSize: null,
        bbox,
        decisionId: 'missing-dims',
      }),
    ).rejects.toThrow('page_image_dimensions_unavailable');

    await expect(
      writer.writeCrop({
        outputDir,
        pageNo: 1,
        pageImagePath,
        pageSize: null,
        bbox,
        decisionId: 'crop-failure',
      }),
    ).rejects.toThrow('[ImageCropWriter] Failed to write crop: crop failed');
    expect(
      existsSync(join(outputDir, 'images', 'assisted_page1_crop-failure.png')),
    ).toBe(false);

    mockSpawnAsync
      .mockResolvedValueOnce({ stdout: '200 200', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 1 });
    await expect(
      writer.writeCrop({
        outputDir,
        pageNo: 1,
        pageImagePath,
        pageSize: null,
        bbox,
        decisionId: 'unknown-crop-failure',
      }),
    ).rejects.toThrow('[ImageCropWriter] Failed to write crop: Unknown error');
  });
});
