import type { LoggerMethods } from '@heripo/logger';
import type { AsyncConversionTask, DoclingAPIClient } from 'docling-sdk';

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ImageExtractor } from '../processors/image-extractor';
import { downloadTaskResult } from '../utils/docling-result-downloader';
import { LocalFileServer } from '../utils/local-file-server';
import { renderAndUpdatePageImages } from '../utils/page-image-updater';
import { trackTaskProgress } from '../utils/task-progress-tracker';
import { buildConversionOptions } from './conversion-options-builder';
import { DoclingConversionExecutor } from './docling-conversion-executor';

vi.mock('./conversion-options-builder', () => ({
  buildConversionOptions: vi.fn(),
}));

vi.mock('../utils/local-file-server', () => ({
  LocalFileServer: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock('node:path', () => ({
  join: vi.fn(),
}));

vi.mock('../utils/docling-result-downloader', () => ({
  downloadTaskResult: vi.fn(),
}));

vi.mock('../processors/image-extractor', () => ({
  ImageExtractor: {
    extractAndSaveDocumentsFromZip: vi.fn(),
  },
}));

vi.mock('../utils/page-image-updater', () => ({
  renderAndUpdatePageImages: vi.fn(),
}));

vi.mock('../utils/task-progress-tracker', () => ({
  trackTaskProgress: vi.fn(),
}));

function createMockTask(): AsyncConversionTask {
  const task = {
    taskId: 'task-123',
    poll: vi.fn().mockResolvedValue({
      task_id: 'task-123',
      task_status: 'success',
    }),
    getResult: vi.fn().mockResolvedValue({
      document: {},
      status: 'success',
      processing_time: 0,
    }),
  };
  return task as unknown as AsyncConversionTask;
}

describe('DoclingConversionExecutor', () => {
  let logger: LoggerMethods;
  let client: DoclingAPIClient;
  let executor: DoclingConversionExecutor;
  const DEFAULT_TIMEOUT = 600_000;

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    client = {
      convertSourceAsync: vi.fn(),
      getTaskResultFile: vi.fn(),
      getConfig: vi.fn().mockReturnValue({ baseUrl: 'http://localhost:5001' }),
    } as unknown as DoclingAPIClient;

    executor = new DoclingConversionExecutor(logger, client, DEFAULT_TIMEOUT);

    vi.spyOn(process, 'cwd').mockReturnValue('/test/cwd');
    vi.spyOn(Date, 'now').mockReturnValue(1000000);

    vi.mocked(buildConversionOptions).mockReturnValue({
      to_formats: ['json', 'html'],
      image_export_mode: 'embedded',
      ocr_engine: 'ocrmac',
      ocr_options: {
        kind: 'ocrmac',
        lang: ['ko-KR', 'en-US'],
        recognition: 'accurate',
        framework: 'livetext',
      },
      generate_picture_images: true,
      do_picture_classification: true,
      do_picture_description: true,
      generate_page_images: false,
      images_scale: 2.0,
      force_ocr: true,
      accelerator_options: { device: 'mps', num_threads: 4 },
    });

    vi.mocked(join).mockImplementation((...args) => args.join('/'));

    vi.mocked(LocalFileServer).mockImplementation(function () {
      return {
        start: vi.fn().mockResolvedValue('http://127.0.0.1:12345/test.pdf'),
        stop: vi.fn().mockResolvedValue(undefined),
      } as unknown as LocalFileServer;
    });
  });

  describe('execute', () => {
    test('should successfully execute conversion with http URL and cleanupAfterCallback=false', async () => {
      const mockTask = createMockTask();
      const onComplete = vi.fn().mockResolvedValue(undefined);

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      const result = await executor.execute(
        'http://test.com/doc.pdf',
        'report123',
        onComplete,
        false,
        {},
      );

      expect(result).toBeNull();
      expect(client.convertSourceAsync).toHaveBeenCalled();
      expect(downloadTaskResult).toHaveBeenCalled();
      expect(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).toHaveBeenCalledWith(
        logger,
        '/test/cwd/result.zip',
        '/test/cwd/result_extracted',
        '/test/cwd/output/report123',
      );
      expect(onComplete).toHaveBeenCalledWith('/test/cwd/output/report123');
      expect(rmSync).toHaveBeenCalledWith('/test/cwd/result.zip', {
        force: true,
      });
      expect(rmSync).toHaveBeenCalledWith('/test/cwd/result_extracted', {
        recursive: true,
        force: true,
      });
      expect(rmSync).not.toHaveBeenCalledWith(
        '/test/cwd/output/report123',
        expect.any(Object),
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Output preserved at:',
        '/test/cwd/output/report123',
      );
    });

    test('should cleanup output directory when cleanupAfterCallback=true', async () => {
      const mockTask = createMockTask();
      const onComplete = vi.fn().mockResolvedValue(undefined);

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(true);

      await executor.execute(
        'http://test.com/doc.pdf',
        'report456',
        onComplete,
        true,
        {},
      );

      expect(onComplete).toHaveBeenCalledWith('/test/cwd/output/report456');
      expect(rmSync).toHaveBeenCalledWith('/test/cwd/output/report456', {
        recursive: true,
        force: true,
      });
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Cleaning up output directory:',
        '/test/cwd/output/report456',
      );
    });

    test('should cleanup temporary files even if callback throws error', async () => {
      const mockTask = createMockTask();
      const onComplete = vi.fn().mockRejectedValue(new Error('Callback error'));

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(true);

      await expect(
        executor.execute(
          'http://test.com/doc.pdf',
          'report789',
          onComplete,
          false,
          {},
        ),
      ).rejects.toThrow('Callback error');

      expect(rmSync).toHaveBeenCalledWith('/test/cwd/result.zip', {
        force: true,
      });
      expect(rmSync).toHaveBeenCalledWith('/test/cwd/result_extracted', {
        recursive: true,
        force: true,
      });
    });

    test('should handle non-existent files during cleanup', async () => {
      const mockTask = createMockTask();
      const onComplete = vi.fn().mockResolvedValue(undefined);

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(false);

      await executor.execute(
        'http://test.com/doc.pdf',
        'report-no-files',
        onComplete,
        true,
        {},
      );

      expect(rmSync).not.toHaveBeenCalled();
    });

    test('should handle conversion task failure', async () => {
      const mockTask = createMockTask();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(trackTaskProgress).mockRejectedValue(
        new Error('Task failed: Processing failed'),
      );

      await expect(
        executor.execute(
          'http://test.com/doc.pdf',
          'report-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Task failed: Processing failed');
    });

    test('should handle download failure', async () => {
      const mockTask = createMockTask();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(downloadTaskResult).mockRejectedValue(
        new Error('Download failed'),
      );

      await expect(
        executor.execute(
          'http://test.com/doc.pdf',
          'report-download-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Download failed');
    });

    test('should handle processing failure and cleanup', async () => {
      const mockTask = createMockTask();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockRejectedValue(new Error('Processing failed'));
      vi.mocked(existsSync).mockReturnValue(true);

      await expect(
        executor.execute(
          'http://test.com/doc.pdf',
          'report-process-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Processing failed');

      expect(rmSync).toHaveBeenCalledWith('/test/cwd/result.zip', {
        force: true,
      });
      expect(rmSync).toHaveBeenCalledWith('/test/cwd/result_extracted', {
        recursive: true,
        force: true,
      });
    });

    test('should log OCR languages and conversion info', async () => {
      const mockTask = createMockTask();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(false);

      await executor.execute(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('OCR languages:'),
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Converting document with Async Source API...',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Server will download from URL directly',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Results will be returned as ZIP to avoid memory limits',
      );
    });

    test('should log completion time on success', async () => {
      const mockTask = createMockTask();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(false);

      await executor.execute(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Conversion completed successfully!',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Total time:',
        0,
        'ms',
      );
    });
  });

  describe('resolveUrl', () => {
    test('should start local server for file:// URLs', async () => {
      const result = await executor.resolveUrl('file:///test/doc.pdf');

      expect(LocalFileServer).toHaveBeenCalled();
      expect(result.httpUrl).toBe('http://127.0.0.1:12345/test.pdf');
      expect(result.server).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Started local file server:',
        'http://127.0.0.1:12345/test.pdf',
      );
    });

    test('should return http URL as-is', async () => {
      const result = await executor.resolveUrl('http://test.com/doc.pdf');

      expect(LocalFileServer).not.toHaveBeenCalled();
      expect(result.httpUrl).toBe('http://test.com/doc.pdf');
      expect(result.server).toBeUndefined();
    });

    test('should stop local server on execute error', async () => {
      const mockStop = vi.fn().mockResolvedValue(undefined);
      vi.mocked(LocalFileServer).mockImplementation(function () {
        return {
          start: vi.fn().mockResolvedValue('http://127.0.0.1:12345/test.pdf'),
          stop: mockStop,
        } as unknown as LocalFileServer;
      });

      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(trackTaskProgress).mockRejectedValue(new Error('Task failed'));

      await expect(
        executor.execute(
          'file:///test/doc.pdf',
          'report-server-stop',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Task failed');

      expect(mockStop).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Stopping local file server...',
      );
    });
  });

  describe('startConversionTask', () => {
    test('should start conversion task and log task ID', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

      const result = await executor.startConversionTask(
        'http://test.com/doc.pdf',
        { to_formats: ['json'] },
      );

      expect(client.convertSourceAsync).toHaveBeenCalledWith({
        sources: [{ kind: 'http', url: 'http://test.com/doc.pdf' }],
        options: { to_formats: ['json'] },
        target: { kind: 'zip' },
      });
      expect(result).toBe(mockTask);
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Task created: task-123',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Polling for progress...',
      );
    });
  });

  describe('trackTaskProgress delegation', () => {
    test('should call trackTaskProgress with showDetailedProgress', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(existsSync).mockReturnValue(false);

      await executor.execute(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(trackTaskProgress).toHaveBeenCalledWith(
        mockTask,
        DEFAULT_TIMEOUT,
        logger,
        '[PDFConverter]',
        { showDetailedProgress: true },
      );
    });
  });

  describe('renderPageImages', () => {
    test('should call renderAndUpdatePageImages for file:// URLs', async () => {
      const mockTask = createMockTask();
      const onComplete = vi.fn().mockResolvedValue(undefined);

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(false);

      await executor.execute(
        'file:///test/doc.pdf',
        'report-render',
        onComplete,
        false,
        {},
      );

      expect(renderAndUpdatePageImages).toHaveBeenCalledWith(
        '/test/doc.pdf',
        '/test/cwd/output/report-render',
        logger,
        '[PDFConverter]',
      );
    });

    test('should skip rendering and log warning for http:// URLs', async () => {
      const mockTask = createMockTask();
      const onComplete = vi.fn().mockResolvedValue(undefined);

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(false);

      await executor.execute(
        'http://test.com/doc.pdf',
        'report-skip-render',
        onComplete,
        false,
        {},
      );

      expect(renderAndUpdatePageImages).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        '[PDFConverter] Page image rendering skipped: only supported for local files (file:// URLs)',
      );
    });
  });

  describe('abort signal handling', () => {
    test('should throw AbortError when aborted after docling task completes', async () => {
      const abortController = new AbortController();
      const mockTask = createMockTask();

      vi.mocked(trackTaskProgress).mockImplementation(async () => {
        abortController.abort();
      });
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

      await expect(
        executor.execute(
          'http://test.com/doc.pdf',
          'report-abort-docling',
          vi.fn(),
          false,
          {},
          abortController.signal,
        ),
      ).rejects.toThrow('PDF conversion was aborted');

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Conversion aborted after docling completion',
      );
    });

    test('should throw AbortError when aborted before callback', async () => {
      const mockTask = createMockTask();
      const abortController = new AbortController();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockImplementation(async () => {
        abortController.abort();
      });
      vi.mocked(existsSync).mockReturnValue(true);

      await expect(
        executor.execute(
          'http://test.com/doc.pdf',
          'report-abort-callback',
          vi.fn(),
          false,
          {},
          abortController.signal,
        ),
      ).rejects.toThrow('PDF conversion was aborted');

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Conversion aborted before callback',
      );
    });
  });

  describe('processConvertedFiles', () => {
    test('should call ImageExtractor with correct paths', async () => {
      const mockTask = createMockTask();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(false);

      await executor.execute(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).toHaveBeenCalledWith(
        logger,
        '/test/cwd/result.zip',
        '/test/cwd/result_extracted',
        '/test/cwd/output/report123',
      );
    });
  });
});
