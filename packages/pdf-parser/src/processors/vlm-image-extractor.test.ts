import type { PictureLocation } from './vlm-image-extractor';

import { spawnAsync } from '@heripo/shared';
import { existsSync, mkdirSync } from 'node:fs';
import { type Mock, beforeEach, describe, expect, test, vi } from 'vitest';

import { VlmImageExtractor } from './vlm-image-extractor';

vi.mock('@heripo/shared', () => ({
  spawnAsync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockSpawnAsync = spawnAsync as Mock;
const mockExistsSync = existsSync as Mock;

/** Helper to set up magick identify to return specific dimensions */
function mockPageDimensions(dims: Record<string, string>) {
  mockSpawnAsync.mockImplementation(async (_cmd: string, args: string[]) => {
    // Check if this is an identify call
    if (args[0] === 'identify') {
      const filePath = args[3];
      const dimStr = dims[filePath];
      if (dimStr) {
        return { code: 0, stdout: dimStr, stderr: '' };
      }
      return { code: 1, stdout: '', stderr: 'not found' };
    }
    // Crop call
    return { code: 0, stdout: '', stderr: '' };
  });
}

describe('VlmImageExtractor', () => {
  let extractor: VlmImageExtractor;

  beforeEach(() => {
    vi.clearAllMocks();
    extractor = new VlmImageExtractor(mockLogger);
    mockExistsSync.mockReturnValue(false);
  });

  describe('extractImages', () => {
    test('returns empty array for empty pictures', async () => {
      const result = await extractor.extractImages([], [], '/tmp/output');

      expect(result).toEqual([]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VlmImageExtractor] No pictures to extract',
      );
      expect(mockSpawnAsync).not.toHaveBeenCalled();
    });

    test('creates images directory if it does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      mockPageDimensions({ '/tmp/pages/page_0.png': '1000 1400' });

      const pictures: PictureLocation[] = [
        { pageNo: 1, bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 } },
      ];

      await extractor.extractImages(
        ['/tmp/pages/page_0.png'],
        pictures,
        '/tmp/output',
      );

      expect(mkdirSync).toHaveBeenCalledWith('/tmp/output/images', {
        recursive: true,
      });
    });

    test('skips creating images directory if it already exists', async () => {
      mockExistsSync.mockReturnValue(true);
      mockPageDimensions({ '/tmp/pages/page_0.png': '1000 1400' });

      const pictures: PictureLocation[] = [
        { pageNo: 1, bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 } },
      ];

      await extractor.extractImages(
        ['/tmp/pages/page_0.png'],
        pictures,
        '/tmp/output',
      );

      expect(mkdirSync).not.toHaveBeenCalled();
    });

    test('extracts single picture and returns relative path', async () => {
      mockPageDimensions({ '/tmp/pages/page_0.png': '1000 1400' });

      const pictures: PictureLocation[] = [
        { pageNo: 1, bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 } },
      ];

      const result = await extractor.extractImages(
        ['/tmp/pages/page_0.png'],
        pictures,
        '/tmp/output',
      );

      expect(result).toEqual(['images/image_0.png']);
    });

    test('extracts multiple pictures with correct indices', async () => {
      mockPageDimensions({ '/tmp/pages/page_0.png': '1000 1400' });

      const pictures: PictureLocation[] = [
        { pageNo: 1, bbox: { l: 0.1, t: 0.1, r: 0.5, b: 0.5 } },
        { pageNo: 1, bbox: { l: 0.5, t: 0.5, r: 0.9, b: 0.9 } },
      ];

      const result = await extractor.extractImages(
        ['/tmp/pages/page_0.png'],
        pictures,
        '/tmp/output',
      );

      expect(result).toEqual(['images/image_0.png', 'images/image_1.png']);
    });

    test('handles pictures from different pages', async () => {
      mockPageDimensions({
        '/tmp/pages/page_0.png': '1000 1400',
        '/tmp/pages/page_1.png': '800 1200',
      });

      const pictures: PictureLocation[] = [
        { pageNo: 1, bbox: { l: 0.1, t: 0.1, r: 0.5, b: 0.5 } },
        { pageNo: 2, bbox: { l: 0.2, t: 0.3, r: 0.8, b: 0.7 } },
      ];

      const result = await extractor.extractImages(
        ['/tmp/pages/page_0.png', '/tmp/pages/page_1.png'],
        pictures,
        '/tmp/output',
      );

      expect(result).toEqual(['images/image_0.png', 'images/image_1.png']);
    });

    test('queries dimensions only once per unique page', async () => {
      mockPageDimensions({ '/tmp/pages/page_0.png': '1000 1400' });

      const pictures: PictureLocation[] = [
        { pageNo: 1, bbox: { l: 0.1, t: 0.1, r: 0.3, b: 0.3 } },
        { pageNo: 1, bbox: { l: 0.5, t: 0.5, r: 0.7, b: 0.7 } },
        { pageNo: 1, bbox: { l: 0.2, t: 0.2, r: 0.4, b: 0.4 } },
      ];

      await extractor.extractImages(
        ['/tmp/pages/page_0.png'],
        pictures,
        '/tmp/output',
      );

      // Only one identify call for page 1 (3 crop calls)
      const identifyCalls = mockSpawnAsync.mock.calls.filter(
        (call: string[][]) => call[1][0] === 'identify',
      );
      expect(identifyCalls).toHaveLength(1);
    });

    test('calls magick identify with correct arguments', async () => {
      mockPageDimensions({ '/tmp/pages/page_0.png': '1000 1400' });

      const pictures: PictureLocation[] = [
        { pageNo: 1, bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 } },
      ];

      await extractor.extractImages(
        ['/tmp/pages/page_0.png'],
        pictures,
        '/tmp/output',
      );

      expect(mockSpawnAsync).toHaveBeenCalledWith('magick', [
        'identify',
        '-format',
        '%w %h',
        '/tmp/pages/page_0.png',
      ]);
    });

    test('calls magick crop with correct arguments', async () => {
      mockPageDimensions({ '/tmp/pages/page_0.png': '1000 1400' });

      const pictures: PictureLocation[] = [
        { pageNo: 1, bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 } },
      ];

      await extractor.extractImages(
        ['/tmp/pages/page_0.png'],
        pictures,
        '/tmp/output',
      );

      // Find the crop call (not identify)
      const cropCalls = mockSpawnAsync.mock.calls.filter(
        (call: string[][]) => call[1][0] !== 'identify',
      );
      expect(cropCalls).toHaveLength(1);
      expect(cropCalls[0][0]).toBe('magick');
      expect(cropCalls[0][1]).toContain('-crop');
      expect(cropCalls[0][1]).toContain('+repage');
      expect(cropCalls[0][1]).toContain('/tmp/output/images/image_0.png');
    });

    test('skips picture when page file is not found', async () => {
      mockPageDimensions({});
      // pageFiles has only 1 page, but picture references page 3
      const pictures: PictureLocation[] = [
        { pageNo: 3, bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 } },
      ];

      const result = await extractor.extractImages(
        ['/tmp/pages/page_0.png'],
        pictures,
        '/tmp/output',
      );

      expect(result).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[VlmImageExtractor] Skipping picture 0: page 3 not found',
      );
    });

    test('skips picture when page dimensions cannot be determined', async () => {
      mockSpawnAsync.mockResolvedValue({
        code: 1,
        stdout: '',
        stderr: 'error',
      });

      const pictures: PictureLocation[] = [
        { pageNo: 1, bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 } },
      ];

      const result = await extractor.extractImages(
        ['/tmp/pages/page_0.png'],
        pictures,
        '/tmp/output',
      );

      expect(result).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[VlmImageExtractor] Skipping picture 0: page 1 not found',
      );
    });

    test('throws error when magick crop fails', async () => {
      mockSpawnAsync.mockImplementation(
        async (_cmd: string, args: string[]) => {
          if (args[0] === 'identify') {
            return { code: 0, stdout: '1000 1400', stderr: '' };
          }
          return {
            code: 1,
            stdout: '',
            stderr: 'magick: unable to crop',
          };
        },
      );

      const pictures: PictureLocation[] = [
        { pageNo: 1, bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 } },
      ];

      await expect(
        extractor.extractImages(
          ['/tmp/pages/page_0.png'],
          pictures,
          '/tmp/output',
        ),
      ).rejects.toThrow(
        '[VlmImageExtractor] Failed to crop image: magick: unable to crop',
      );
    });

    test('throws error with fallback message when stderr is empty on crop failure', async () => {
      mockSpawnAsync.mockImplementation(
        async (_cmd: string, args: string[]) => {
          if (args[0] === 'identify') {
            return { code: 0, stdout: '1000 1400', stderr: '' };
          }
          return { code: 1, stdout: '', stderr: '' };
        },
      );

      const pictures: PictureLocation[] = [
        { pageNo: 1, bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 } },
      ];

      await expect(
        extractor.extractImages(
          ['/tmp/pages/page_0.png'],
          pictures,
          '/tmp/output',
        ),
      ).rejects.toThrow(
        '[VlmImageExtractor] Failed to crop image: Unknown error',
      );
    });

    test('warns for very small crop region', async () => {
      mockPageDimensions({ '/tmp/pages/page_0.png': '1000 1400' });

      // bbox that results in < 20px width or height
      const pictures: PictureLocation[] = [
        { pageNo: 1, bbox: { l: 0.1, t: 0.1, r: 0.11, b: 0.11 } },
      ];

      await extractor.extractImages(
        ['/tmp/pages/page_0.png'],
        pictures,
        '/tmp/output',
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('is very small'),
      );
    });

    test('warns for very large crop region', async () => {
      mockPageDimensions({ '/tmp/pages/page_0.png': '1000 1400' });

      // bbox that covers > 90% of page
      const pictures: PictureLocation[] = [
        { pageNo: 1, bbox: { l: 0.0, t: 0.0, r: 1.0, b: 1.0 } },
      ];

      await extractor.extractImages(
        ['/tmp/pages/page_0.png'],
        pictures,
        '/tmp/output',
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('covers > 90% of page'),
      );
    });

    test('does not warn for normal-sized crop region', async () => {
      mockPageDimensions({ '/tmp/pages/page_0.png': '1000 1400' });

      const pictures: PictureLocation[] = [
        { pageNo: 1, bbox: { l: 0.1, t: 0.2, r: 0.5, b: 0.6 } },
      ];

      await extractor.extractImages(
        ['/tmp/pages/page_0.png'],
        pictures,
        '/tmp/output',
      );

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    test('logs extraction start and completion', async () => {
      mockPageDimensions({ '/tmp/pages/page_0.png': '1000 1400' });

      const pictures: PictureLocation[] = [
        { pageNo: 1, bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 } },
      ];

      await extractor.extractImages(
        ['/tmp/pages/page_0.png'],
        pictures,
        '/tmp/output',
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VlmImageExtractor] Extracting 1 images...',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VlmImageExtractor] Extracted 1 images',
      );
    });

    test('handles identify returning empty stdout', async () => {
      mockSpawnAsync.mockResolvedValue({
        code: 0,
        stdout: '',
        stderr: '',
      });

      const pictures: PictureLocation[] = [
        { pageNo: 1, bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 } },
      ];

      const result = await extractor.extractImages(
        ['/tmp/pages/page_0.png'],
        pictures,
        '/tmp/output',
      );

      // Cannot get dimensions, so skips
      expect(result).toEqual([]);
    });

    test('handles identify returning NaN values', async () => {
      mockSpawnAsync.mockResolvedValue({
        code: 0,
        stdout: 'invalid values',
        stderr: '',
      });

      const pictures: PictureLocation[] = [
        { pageNo: 1, bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 } },
      ];

      const result = await extractor.extractImages(
        ['/tmp/pages/page_0.png'],
        pictures,
        '/tmp/output',
      );

      // NaN dimensions, so skips
      expect(result).toEqual([]);
    });
  });

  describe('computeCropRegion', () => {
    test('converts normalized bbox to pixel coordinates with padding', () => {
      const bbox = { l: 0.1, t: 0.2, r: 0.9, b: 0.8 };
      const crop = extractor.computeCropRegion(bbox, 1000, 1400);

      // rawW = 0.8 * 1000 = 800, padX = 800 * 0.03 = 24
      // rawH = 0.6 * 1400 = 840, padY = 840 * 0.03 = 25.2
      // x = max(0, round(100 - 24)) = 76
      // y = max(0, round(280 - 25.2)) = 255
      // w = min(1000 - 76, round(800 + 48)) = min(924, 848) = 848
      // h = min(1400 - 255, round(840 + 50.4)) = min(1145, 890) = 890
      expect(crop.x).toBe(76);
      expect(crop.y).toBe(255);
      expect(crop.w).toBe(848);
      expect(crop.h).toBe(890);
    });

    test('clamps x to 0 when padding extends beyond left edge', () => {
      // bbox near left edge: rawX=5, padX=295*0.03=8.85, x=max(0,-4)=0
      const bbox = { l: 0.005, t: 0.5, r: 0.3, b: 0.6 };
      const crop = extractor.computeCropRegion(bbox, 1000, 1000);

      expect(crop.x).toBe(0); // Should not be negative
    });

    test('clamps y to 0 when padding extends beyond top edge', () => {
      // bbox near top edge: rawY=2, padY=148*0.03=4.44, y=max(0,-2)=0
      const bbox = { l: 0.5, t: 0.002, r: 0.7, b: 0.15 };
      const crop = extractor.computeCropRegion(bbox, 1000, 1000);

      expect(crop.y).toBe(0); // Should not be negative
    });

    test('clamps width when crop extends beyond right edge', () => {
      // bbox near right edge
      const bbox = { l: 0.7, t: 0.5, r: 0.99, b: 0.6 };
      const crop = extractor.computeCropRegion(bbox, 1000, 1000);

      expect(crop.x + crop.w).toBeLessThanOrEqual(1000);
    });

    test('clamps height when crop extends beyond bottom edge', () => {
      // bbox near bottom edge
      const bbox = { l: 0.5, t: 0.85, r: 0.7, b: 0.99 };
      const crop = extractor.computeCropRegion(bbox, 1000, 1000);

      expect(crop.y + crop.h).toBeLessThanOrEqual(1000);
    });

    test('returns integer values for all crop dimensions', () => {
      const bbox = { l: 0.123, t: 0.456, r: 0.789, b: 0.987 };
      const crop = extractor.computeCropRegion(bbox, 1000, 1000);

      expect(Number.isInteger(crop.x)).toBe(true);
      expect(Number.isInteger(crop.y)).toBe(true);
      expect(Number.isInteger(crop.w)).toBe(true);
      expect(Number.isInteger(crop.h)).toBe(true);
    });
  });
});
