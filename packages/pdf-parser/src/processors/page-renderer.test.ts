import { spawnAsync } from '@heripo/shared';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { type Mock, beforeEach, describe, expect, test, vi } from 'vitest';

import { PageRenderer } from './page-renderer';

vi.mock('@heripo/shared', () => ({
  spawnAsync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
}));

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockSpawnAsync = spawnAsync as Mock;
const mockExistsSync = existsSync as Mock;
const mockReaddirSync = readdirSync as Mock;

describe('PageRenderer', () => {
  let renderer: PageRenderer;

  beforeEach(() => {
    vi.clearAllMocks();
    renderer = new PageRenderer(mockLogger);
    mockExistsSync.mockReturnValue(false);
    mockSpawnAsync.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
  });

  describe('renderPages', () => {
    test('creates pages directory if it does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      mockReaddirSync.mockReturnValue([]);

      await renderer.renderPages('/tmp/input.pdf', '/tmp/output');

      expect(mkdirSync).toHaveBeenCalledWith('/tmp/output/pages', {
        recursive: true,
      });
    });

    test('skips creating pages directory if it already exists', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      await renderer.renderPages('/tmp/input.pdf', '/tmp/output');

      expect(mkdirSync).not.toHaveBeenCalled();
    });

    test('calls magick with correct default DPI arguments', async () => {
      mockReaddirSync.mockReturnValue([]);

      await renderer.renderPages('/tmp/input.pdf', '/tmp/output');

      expect(mockSpawnAsync).toHaveBeenCalledWith('magick', [
        '-density',
        '144',
        '/tmp/input.pdf',
        '-background',
        'white',
        '-alpha',
        'remove',
        '-alpha',
        'off',
        '/tmp/output/pages/page_%d.png',
      ]);
    });

    test('uses custom DPI when specified', async () => {
      mockReaddirSync.mockReturnValue([]);

      await renderer.renderPages('/tmp/input.pdf', '/tmp/output', { dpi: 72 });

      expect(mockSpawnAsync).toHaveBeenCalledWith(
        'magick',
        expect.arrayContaining(['-density', '72']),
      );
    });

    test('returns sorted page files', async () => {
      mockReaddirSync.mockReturnValue([
        'page_2.png',
        'page_0.png',
        'page_10.png',
        'page_1.png',
      ]);

      const result = await renderer.renderPages(
        '/tmp/input.pdf',
        '/tmp/output',
      );

      expect(result.pageCount).toBe(4);
      expect(result.pageFiles).toEqual([
        '/tmp/output/pages/page_0.png',
        '/tmp/output/pages/page_1.png',
        '/tmp/output/pages/page_2.png',
        '/tmp/output/pages/page_10.png',
      ]);
    });

    test('returns correct pagesDir', async () => {
      mockReaddirSync.mockReturnValue([]);

      const result = await renderer.renderPages(
        '/tmp/input.pdf',
        '/tmp/output',
      );

      expect(result.pagesDir).toBe('/tmp/output/pages');
    });

    test('filters out non-page files from directory listing', async () => {
      mockReaddirSync.mockReturnValue([
        'page_0.png',
        'page_1.png',
        '.DS_Store',
        'other_file.txt',
        'thumbnail.png',
      ]);

      const result = await renderer.renderPages(
        '/tmp/input.pdf',
        '/tmp/output',
      );

      expect(result.pageCount).toBe(2);
      expect(result.pageFiles).toEqual([
        '/tmp/output/pages/page_0.png',
        '/tmp/output/pages/page_1.png',
      ]);
    });

    test('handles empty PDF (no pages rendered)', async () => {
      mockReaddirSync.mockReturnValue([]);

      const result = await renderer.renderPages(
        '/tmp/input.pdf',
        '/tmp/output',
      );

      expect(result.pageCount).toBe(0);
      expect(result.pageFiles).toEqual([]);
    });

    test('throws error when magick command fails', async () => {
      mockSpawnAsync.mockResolvedValue({
        code: 1,
        stdout: '',
        stderr: 'magick: unable to open image',
      });

      await expect(
        renderer.renderPages('/tmp/input.pdf', '/tmp/output'),
      ).rejects.toThrow(
        '[PageRenderer] Failed to render PDF pages: magick: unable to open image',
      );
    });

    test('throws error with fallback message when stderr is empty', async () => {
      mockSpawnAsync.mockResolvedValue({
        code: 1,
        stdout: '',
        stderr: '',
      });

      await expect(
        renderer.renderPages('/tmp/input.pdf', '/tmp/output'),
      ).rejects.toThrow(
        '[PageRenderer] Failed to render PDF pages: Unknown error',
      );
    });

    test('logs rendering start and completion', async () => {
      mockReaddirSync.mockReturnValue(['page_0.png', 'page_1.png']);

      await renderer.renderPages('/tmp/input.pdf', '/tmp/output');

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[PageRenderer] Rendering PDF at 144 DPI...',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[PageRenderer] Rendered 2 pages to /tmp/output/pages',
      );
    });
  });
});
