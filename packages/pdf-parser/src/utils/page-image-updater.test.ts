import type { LoggerMethods } from '@heripo/logger';

import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { PAGE_RENDERING } from '../config/constants';
import { PageRenderer } from '../processors/page-renderer';
import { runJqFileToFile } from './jq';
import { renderAndUpdatePageImages } from './page-image-updater';

vi.mock('node:fs/promises', () => ({
  rename: vi.fn(),
}));

vi.mock('node:path', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
}));

vi.mock('../processors/page-renderer', () => ({
  PageRenderer: vi.fn(),
}));

vi.mock('./jq', () => ({
  runJqFileToFile: vi.fn(),
}));

describe('renderAndUpdatePageImages', () => {
  let logger: LoggerMethods;
  let mockRenderPages: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    mockRenderPages = vi.fn().mockResolvedValue({
      pageCount: 5,
      pagesDir: '/output/pages',
      pageFiles: [],
    });

    vi.mocked(PageRenderer).mockImplementation(function () {
      return { renderPages: mockRenderPages } as any;
    });

    vi.mocked(runJqFileToFile).mockResolvedValue(undefined as any);
    vi.mocked(rename).mockResolvedValue(undefined);
  });

  test('renders pages and updates result.json with jq', async () => {
    await renderAndUpdatePageImages(
      '/test/doc.pdf',
      '/output/dir',
      logger,
      '[TestPrefix]',
    );

    expect(PageRenderer).toHaveBeenCalledWith(logger);
    expect(mockRenderPages).toHaveBeenCalledWith(
      '/test/doc.pdf',
      '/output/dir',
    );

    const resultPath = '/output/dir/result.json';
    const tmpPath = resultPath + '.tmp';
    expect(runJqFileToFile).toHaveBeenCalledWith(
      expect.stringContaining('.pages |= with_entries('),
      resultPath,
      tmpPath,
    );
    expect(rename).toHaveBeenCalledWith(tmpPath, resultPath);
  });

  test('jq program includes correct pageCount in condition', async () => {
    mockRenderPages.mockResolvedValue({
      pageCount: 3,
      pagesDir: '/output/pages',
      pageFiles: [],
    });

    await renderAndUpdatePageImages(
      '/test/doc.pdf',
      '/output/dir',
      logger,
      '[Test]',
    );

    expect(runJqFileToFile).toHaveBeenCalledWith(
      expect.stringContaining('< 3'),
      expect.any(String),
      expect.any(String),
    );
  });

  test('jq program includes correct DPI value', async () => {
    await renderAndUpdatePageImages(
      '/test/doc.pdf',
      '/output/dir',
      logger,
      '[Test]',
    );

    expect(runJqFileToFile).toHaveBeenCalledWith(
      expect.stringContaining(
        `.value.image.dpi = ${PAGE_RENDERING.DEFAULT_DPI}`,
      ),
      expect.any(String),
      expect.any(String),
    );
  });

  test('jq program sets image URI and mimetype', async () => {
    await renderAndUpdatePageImages(
      '/test/doc.pdf',
      '/output/dir',
      logger,
      '[Test]',
    );

    const jqProgram = vi.mocked(runJqFileToFile).mock.calls[0][0];
    expect(jqProgram).toContain('.value.image.uri = "pages/page_');
    expect(jqProgram).toContain('.value.image.mimetype = "image/png"');
  });

  test('logs rendering start and completion with logPrefix', async () => {
    await renderAndUpdatePageImages(
      '/test/doc.pdf',
      '/output/dir',
      logger,
      '[PDFConverter]',
    );

    expect(logger.info).toHaveBeenCalledWith(
      '[PDFConverter] Rendering page images with ImageMagick...',
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[PDFConverter] Rendered 5 page images',
    );
  });

  test('logs with custom logPrefix', async () => {
    await renderAndUpdatePageImages(
      '/test/doc.pdf',
      '/output/dir',
      logger,
      '[ChunkedPDFConverter]',
    );

    expect(logger.info).toHaveBeenCalledWith(
      '[ChunkedPDFConverter] Rendering page images with ImageMagick...',
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[ChunkedPDFConverter] Rendered 5 page images',
    );
  });

  test('propagates PageRenderer error', async () => {
    mockRenderPages.mockRejectedValue(new Error('ImageMagick not found'));

    await expect(
      renderAndUpdatePageImages(
        '/test/doc.pdf',
        '/output/dir',
        logger,
        '[Test]',
      ),
    ).rejects.toThrow('ImageMagick not found');
  });

  test('propagates jq error', async () => {
    vi.mocked(runJqFileToFile).mockRejectedValue(
      new Error('jq exited with code 1'),
    );

    await expect(
      renderAndUpdatePageImages(
        '/test/doc.pdf',
        '/output/dir',
        logger,
        '[Test]',
      ),
    ).rejects.toThrow('jq exited with code 1');
  });

  test('propagates rename error', async () => {
    vi.mocked(rename).mockRejectedValue(new Error('EACCES'));

    await expect(
      renderAndUpdatePageImages(
        '/test/doc.pdf',
        '/output/dir',
        logger,
        '[Test]',
      ),
    ).rejects.toThrow('EACCES');
  });

  test('uses join to construct result path', async () => {
    await renderAndUpdatePageImages(
      '/test/doc.pdf',
      '/output/dir',
      logger,
      '[Test]',
    );

    expect(join).toHaveBeenCalledWith('/output/dir', 'result.json');
  });
});
