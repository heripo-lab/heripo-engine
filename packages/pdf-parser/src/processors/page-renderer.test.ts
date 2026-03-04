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
    vi.useRealTimers();
    renderer = new PageRenderer(mockLogger);
    mockExistsSync.mockReturnValue(false);
    // Default: pdfinfo returns empty (page count unknown), magick succeeds
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
        '200',
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

    test('logs rendering start and completion when page count is unknown', async () => {
      mockReaddirSync.mockReturnValue(['page_0.png', 'page_1.png']);

      await renderer.renderPages('/tmp/input.pdf', '/tmp/output');

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[PageRenderer] Rendering PDF at 200 DPI...',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[PageRenderer] Rendered 2 pages to /tmp/output/pages',
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

    test('logs page count when pdfinfo returns valid count', async () => {
      mockSpawnAsync.mockImplementation((cmd: string) => {
        if (cmd === 'pdfinfo') {
          return Promise.resolve({
            code: 0,
            stdout: 'Pages:          244',
            stderr: '',
          });
        }
        return Promise.resolve({ code: 0, stdout: '', stderr: '' });
      });
      mockReaddirSync.mockReturnValue([]);

      await renderer.renderPages('/tmp/input.pdf', '/tmp/output');

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[PageRenderer] Rendering 244 pages at 200 DPI...',
      );
    });

    test('falls back to generic log when pdfinfo fails', async () => {
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

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[PageRenderer] Rendering PDF at 200 DPI...',
      );
    });

    test('falls back to generic log when pdfinfo throws', async () => {
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
  });

  describe('progress logging', () => {
    test('logs rendering progress during magick execution', async () => {
      vi.useFakeTimers();

      let readdirCallCount = 0;
      mockReaddirSync.mockImplementation(() => {
        readdirCallCount++;
        // 1st call (progress poll at 2s): 1 file rendered
        if (readdirCallCount === 1) return ['page_0.png'];
        // 2nd call (progress poll at 4s): 2 files rendered
        if (readdirCallCount === 2) return ['page_0.png', 'page_1.png'];
        // 3rd+ call (final listing after render): all 3 files
        return ['page_0.png', 'page_1.png', 'page_2.png'];
      });

      mockSpawnAsync.mockImplementation((cmd: string) => {
        if (cmd === 'pdfinfo') {
          return Promise.resolve({
            code: 0,
            stdout: 'Pages:          3',
            stderr: '',
          });
        }
        // magick takes 5 seconds
        return new Promise((resolve) => {
          setTimeout(() => resolve({ code: 0, stdout: '', stderr: '' }), 5000);
        });
      });

      const promise = renderer.renderPages('/tmp/input.pdf', '/tmp/output');

      // First progress poll at 2s
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[PageRenderer] Rendering pages: 1/3',
      );

      // Second progress poll at 4s
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[PageRenderer] Rendering pages: 2/3',
      );

      // magick completes at 5s
      await vi.advanceTimersByTimeAsync(1000);
      await promise;
    });

    test('skips duplicate progress logs when count has not changed', async () => {
      vi.useFakeTimers();

      // Always return same count during progress polls
      mockReaddirSync.mockReturnValue(['page_0.png']);

      mockSpawnAsync.mockImplementation((cmd: string) => {
        if (cmd === 'pdfinfo') {
          return Promise.resolve({
            code: 0,
            stdout: 'Pages:          5',
            stderr: '',
          });
        }
        return new Promise((resolve) => {
          setTimeout(() => resolve({ code: 0, stdout: '', stderr: '' }), 5000);
        });
      });

      const promise = renderer.renderPages('/tmp/input.pdf', '/tmp/output');

      // Two polls, same file count
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);

      // Should only log "1/5" once (deduplication)
      const progressCalls = mockLogger.info.mock.calls.filter(
        (args: string[]) =>
          typeof args[0] === 'string' && args[0].includes('Rendering pages:'),
      );
      expect(progressCalls).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1000);
      await promise;
    });

    test('cleans up progress interval when magick fails', async () => {
      vi.useFakeTimers();

      mockReaddirSync.mockReturnValue([]);

      mockSpawnAsync.mockImplementation((cmd: string) => {
        if (cmd === 'pdfinfo') {
          return Promise.resolve({
            code: 0,
            stdout: 'Pages:          5',
            stderr: '',
          });
        }
        return new Promise((resolve) => {
          setTimeout(
            () => resolve({ code: 1, stdout: '', stderr: 'render error' }),
            3000,
          );
        });
      });

      const promise = renderer.renderPages('/tmp/input.pdf', '/tmp/output');
      // Attach a no-op catch to prevent PromiseRejectionHandledWarning
      // (the rejection is still asserted below via rejects.toThrow)
      promise.catch(() => {});

      await vi.advanceTimersByTimeAsync(3000);
      await expect(promise).rejects.toThrow(
        '[PageRenderer] Failed to render PDF pages: render error',
      );

      // Verify no more interval callbacks after error (interval was cleared)
      mockLogger.info.mockClear();
      await vi.advanceTimersByTimeAsync(4000);
      const progressCalls = mockLogger.info.mock.calls.filter(
        (args: string[]) =>
          typeof args[0] === 'string' && args[0].includes('Rendering pages:'),
      );
      expect(progressCalls).toHaveLength(0);
    });

    test('does not start progress interval when page count is unknown', async () => {
      vi.useFakeTimers();

      mockReaddirSync.mockReturnValue([]);

      mockSpawnAsync.mockImplementation((cmd: string) => {
        if (cmd === 'pdfinfo') {
          return Promise.resolve({ code: 0, stdout: '', stderr: '' });
        }
        return new Promise((resolve) => {
          setTimeout(() => resolve({ code: 0, stdout: '', stderr: '' }), 3000);
        });
      });

      const promise = renderer.renderPages('/tmp/input.pdf', '/tmp/output');

      await vi.advanceTimersByTimeAsync(2000);

      // No progress log when page count is 0
      const progressCalls = mockLogger.info.mock.calls.filter(
        (args: string[]) =>
          typeof args[0] === 'string' && args[0].includes('Rendering pages:'),
      );
      expect(progressCalls).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1000);
      await promise;
    });
  });
});
