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
    // Default: pdfinfo returns 0 pages, magick succeeds
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

    test('logs rendering completion', async () => {
      mockReaddirSync.mockReturnValue(['page_0.png', 'page_1.png']);

      await renderer.renderPages('/tmp/input.pdf', '/tmp/output');

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[PageRenderer] Rendered 2 pages to /tmp/output/pages',
      );
    });
  });

  describe('per-page rendering (page count known)', () => {
    beforeEach(() => {
      mockSpawnAsync.mockImplementation((cmd: string) => {
        if (cmd === 'pdfinfo') {
          return Promise.resolve({
            code: 0,
            stdout: 'Pages:          3',
            stderr: '',
          });
        }
        // magick per-page call
        return Promise.resolve({ code: 0, stdout: '', stderr: '' });
      });
      mockReaddirSync.mockReturnValue([
        'page_0.png',
        'page_1.png',
        'page_2.png',
      ]);
    });

    test('renders each page individually with correct magick arguments', async () => {
      await renderer.renderPages('/tmp/input.pdf', '/tmp/output');

      // pdfinfo + 3 magick calls
      expect(mockSpawnAsync).toHaveBeenCalledTimes(4);

      for (let i = 0; i < 3; i++) {
        expect(mockSpawnAsync).toHaveBeenCalledWith(
          'magick',
          [
            '-density',
            '200',
            `/tmp/input.pdf[${i}]`,
            '-background',
            'white',
            '-alpha',
            'remove',
            '-alpha',
            'off',
            `/tmp/output/pages/page_${i}.png`,
          ],
          { captureStdout: false },
        );
      }
    });

    test('uses custom DPI for per-page rendering', async () => {
      await renderer.renderPages('/tmp/input.pdf', '/tmp/output', { dpi: 72 });

      // Check that magick calls use custom DPI
      const magickCalls = mockSpawnAsync.mock.calls.filter(
        (call: string[]) => call[0] === 'magick',
      );
      expect(magickCalls).toHaveLength(3);
      for (const call of magickCalls) {
        expect(call[1]).toContain('72');
      }
    });

    test('logs page count at start', async () => {
      await renderer.renderPages('/tmp/input.pdf', '/tmp/output');

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[PageRenderer] Rendering 3 pages at 200 DPI...',
      );
    });

    test('throws error with page number when magick fails', async () => {
      mockSpawnAsync.mockImplementation((cmd: string) => {
        if (cmd === 'pdfinfo') {
          return Promise.resolve({
            code: 0,
            stdout: 'Pages:          3',
            stderr: '',
          });
        }
        // First page succeeds, second fails
        if (
          mockSpawnAsync.mock.calls.filter((c: string[]) => c[0] === 'magick')
            .length <= 1
        ) {
          return Promise.resolve({ code: 0, stdout: '', stderr: '' });
        }
        return Promise.resolve({
          code: 1,
          stdout: '',
          stderr: 'magick: unable to open image',
        });
      });

      await expect(
        renderer.renderPages('/tmp/input.pdf', '/tmp/output'),
      ).rejects.toThrow(
        '[PageRenderer] Failed to render page 2/3: magick: unable to open image',
      );
    });

    test('throws error with Unknown error when stderr is empty', async () => {
      mockSpawnAsync.mockImplementation((cmd: string) => {
        if (cmd === 'pdfinfo') {
          return Promise.resolve({
            code: 0,
            stdout: 'Pages:          1',
            stderr: '',
          });
        }
        return Promise.resolve({ code: 1, stdout: '', stderr: '' });
      });

      await expect(
        renderer.renderPages('/tmp/input.pdf', '/tmp/output'),
      ).rejects.toThrow(
        '[PageRenderer] Failed to render page 1/1: Unknown error',
      );
    });
  });

  describe('fallback rendering (page count unknown)', () => {
    test('calls magick with batch pattern when pdfinfo fails', async () => {
      mockSpawnAsync.mockImplementation((cmd: string) => {
        if (cmd === 'pdfinfo') {
          return Promise.resolve({
            code: 1,
            stdout: '',
            stderr: 'pdfinfo not found',
          });
        }
        return Promise.resolve({ code: 0, stdout: '', stderr: '' });
      });
      mockReaddirSync.mockReturnValue([]);

      await renderer.renderPages('/tmp/input.pdf', '/tmp/output');

      expect(mockSpawnAsync).toHaveBeenCalledWith(
        'magick',
        [
          '-density',
          '200',
          '/tmp/input.pdf',
          '-background',
          'white',
          '-alpha',
          'remove',
          '-alpha',
          'off',
          '/tmp/output/pages/page_%d.png',
        ],
        { captureStdout: false },
      );
    });

    test('calls magick with batch pattern when pdfinfo throws', async () => {
      mockSpawnAsync.mockImplementation((cmd: string) => {
        if (cmd === 'pdfinfo') {
          return Promise.reject(new Error('spawn ENOENT'));
        }
        return Promise.resolve({ code: 0, stdout: '', stderr: '' });
      });
      mockReaddirSync.mockReturnValue([]);

      await renderer.renderPages('/tmp/input.pdf', '/tmp/output');

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[PageRenderer] Rendering PDF at 200 DPI...',
      );
    });

    test('throws error when fallback magick fails', async () => {
      mockSpawnAsync.mockImplementation((cmd: string) => {
        if (cmd === 'pdfinfo') {
          return Promise.resolve({ code: 0, stdout: '', stderr: '' });
        }
        return Promise.resolve({
          code: 1,
          stdout: '',
          stderr: 'magick: unable to open image',
        });
      });

      await expect(
        renderer.renderPages('/tmp/input.pdf', '/tmp/output'),
      ).rejects.toThrow(
        '[PageRenderer] Failed to render PDF pages: magick: unable to open image',
      );
    });

    test('throws fallback error with Unknown error when stderr is empty', async () => {
      mockSpawnAsync.mockImplementation((cmd: string) => {
        if (cmd === 'pdfinfo') {
          return Promise.resolve({ code: 0, stdout: '', stderr: '' });
        }
        return Promise.resolve({ code: 1, stdout: '', stderr: '' });
      });

      await expect(
        renderer.renderPages('/tmp/input.pdf', '/tmp/output'),
      ).rejects.toThrow(
        '[PageRenderer] Failed to render PDF pages: Unknown error',
      );
    });
  });

  describe('page count detection', () => {
    test('calls pdfinfo to get page count before rendering', async () => {
      mockReaddirSync.mockReturnValue([]);

      await renderer.renderPages('/tmp/input.pdf', '/tmp/output');

      expect(mockSpawnAsync).toHaveBeenCalledWith('pdfinfo', [
        '/tmp/input.pdf',
      ]);
    });
  });

  describe('progress logging', () => {
    test('logs progress at 10% intervals', async () => {
      mockSpawnAsync.mockImplementation((cmd: string) => {
        if (cmd === 'pdfinfo') {
          return Promise.resolve({
            code: 0,
            stdout: 'Pages:          20',
            stderr: '',
          });
        }
        return Promise.resolve({ code: 0, stdout: '', stderr: '' });
      });
      mockReaddirSync.mockReturnValue(
        Array.from({ length: 20 }, (_, i) => `page_${i}.png`),
      );

      await renderer.renderPages('/tmp/input.pdf', '/tmp/output');

      // Should log at 10%, 20%, ..., 100%
      const progressCalls = mockLogger.info.mock.calls.filter(
        (args: string[]) =>
          typeof args[0] === 'string' && args[0].includes('Rendering pages:'),
      );
      expect(progressCalls.length).toBeGreaterThanOrEqual(10);
      expect(progressCalls[0][0]).toBe(
        '[PageRenderer] Rendering pages: 2/20 (10%)',
      );
      expect(progressCalls[progressCalls.length - 1][0]).toBe(
        '[PageRenderer] Rendering pages: 20/20 (100%)',
      );
    });

    test('always logs the final page', async () => {
      mockSpawnAsync.mockImplementation((cmd: string) => {
        if (cmd === 'pdfinfo') {
          return Promise.resolve({
            code: 0,
            stdout: 'Pages:          3',
            stderr: '',
          });
        }
        return Promise.resolve({ code: 0, stdout: '', stderr: '' });
      });
      mockReaddirSync.mockReturnValue([
        'page_0.png',
        'page_1.png',
        'page_2.png',
      ]);

      await renderer.renderPages('/tmp/input.pdf', '/tmp/output');

      const progressCalls = mockLogger.info.mock.calls.filter(
        (args: string[]) =>
          typeof args[0] === 'string' && args[0].includes('Rendering pages:'),
      );
      // For 3 pages: page 1 = 33%, page 2 = 66%, page 3 = 100%
      // 33% >= 10% → log; 66% >= 43% → log; 100% is final → log
      expect(progressCalls.length).toBeGreaterThanOrEqual(1);
      expect(progressCalls[progressCalls.length - 1][0]).toBe(
        '[PageRenderer] Rendering pages: 3/3 (100%)',
      );
    });

    test('does not log progress when page count is unknown', async () => {
      mockReaddirSync.mockReturnValue([]);

      await renderer.renderPages('/tmp/input.pdf', '/tmp/output');

      const progressCalls = mockLogger.info.mock.calls.filter(
        (args: string[]) =>
          typeof args[0] === 'string' && args[0].includes('Rendering pages:'),
      );
      expect(progressCalls).toHaveLength(0);
    });
  });
});
