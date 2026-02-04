import type { LoggerMethods } from '@heripo/logger';
import type { AsyncConversionTask, DoclingAPIClient } from 'docling-sdk';
import type { Readable } from 'node:stream';

import { omit } from 'es-toolkit';
import { createWriteStream, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ImagePdfFallbackError } from '../errors/image-pdf-fallback-error';
import { ImageExtractor } from '../processors/image-extractor';
import { LocalFileServer } from '../utils/local-file-server';
import { ImagePdfConverter } from './image-pdf-converter';
import { PDFConverter } from './pdf-converter';

vi.mock('es-toolkit', () => ({
  omit: vi.fn(),
}));

vi.mock('./image-pdf-converter', () => ({
  ImagePdfConverter: vi.fn(),
}));

vi.mock('../utils/local-file-server', () => ({
  LocalFileServer: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  rmSync: vi.fn(),
  createWriteStream: vi.fn(),
}));

vi.mock('node:path', () => ({
  join: vi.fn(),
}));

vi.mock('node:stream/promises', () => ({
  pipeline: vi.fn(),
}));

vi.mock('../processors/image-extractor', () => ({
  ImageExtractor: {
    extractAndSaveDocumentsFromZip: vi.fn(),
  },
}));

describe('PDFConverter', () => {
  let logger: LoggerMethods;
  let client: DoclingAPIClient;
  let converter: PDFConverter;

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
    } as unknown as DoclingAPIClient;

    converter = new PDFConverter(logger, client);

    vi.spyOn(process, 'cwd').mockReturnValue('/test/cwd');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(global, 'setInterval').mockImplementation(((_fn: () => void) => {
      return 123 as unknown as NodeJS.Timeout;
    }) as typeof setInterval);
    vi.spyOn(global, 'clearInterval').mockImplementation(() => {});
    vi.spyOn(Date, 'now').mockReturnValue(1000000);

    vi.mocked(omit).mockImplementation((obj, keys) => {
      const result = { ...obj };
      keys.forEach((key) => delete result[key as keyof typeof result]);
      return result;
    });

    vi.mocked(join).mockImplementation((...args) => args.join('/'));

    // Mock LocalFileServer
    vi.mocked(LocalFileServer).mockImplementation(
      () =>
        ({
          start: vi.fn().mockResolvedValue('http://127.0.0.1:12345/test.pdf'),
          stop: vi.fn().mockResolvedValue(undefined),
        }) as unknown as LocalFileServer,
    );
  });

  describe('constructor', () => {
    test('should create an instance with logger and client', () => {
      expect(converter).toBeInstanceOf(PDFConverter);
    });
  });

  describe('buildConversionOptions', () => {
    test('should build conversion options with default values', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        { num_threads: 4 },
      );

      expect(client.convertSourceAsync).toHaveBeenCalledWith({
        sources: [{ kind: 'http', url: 'http://test.com/doc.pdf' }],
        options: {
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
          images_scale: 2.0,
          force_ocr: true,
          accelerator_options: {
            device: 'mps',
            num_threads: 4,
          },
        },
        target: { kind: 'zip' },
      });
    });

    test('should omit num_threads from options and use in accelerator_options', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        { num_threads: 8 },
      );

      const callArgs = vi.mocked(client.convertSourceAsync).mock.calls[0][0];
      expect(callArgs.options).toEqual({
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
        images_scale: 2.0,
        force_ocr: true,
        accelerator_options: {
          device: 'mps',
          num_threads: 8,
        },
      });
    });
  });

  describe('convert', () => {
    test('should successfully convert PDF with cleanupAfterCallback=false', async () => {
      const mockTask = createMockTask();
      const onComplete = vi.fn().mockResolvedValue(undefined);
      const writeStream = { write: vi.fn(), end: vi.fn() };

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        onComplete,
        false,
        {},
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Converting:',
        'http://test.com/doc.pdf',
      );
      expect(client.convertSourceAsync).toHaveBeenCalled();
      expect(client.getTaskResultFile).toHaveBeenCalledWith('task-123');
      expect(pipeline).toHaveBeenCalled();
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

    test('should successfully convert PDF with cleanupAfterCallback=true', async () => {
      const mockTask = createMockTask();
      const onComplete = vi.fn().mockResolvedValue(undefined);
      const writeStream = { write: vi.fn(), end: vi.fn() };

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(true);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report456',
        onComplete,
        true,
        {},
      );

      expect(onComplete).toHaveBeenCalledWith('/test/cwd/output/report456');
      expect(rmSync).toHaveBeenCalledWith('/test/cwd/result.zip', {
        force: true,
      });
      expect(rmSync).toHaveBeenCalledWith('/test/cwd/result_extracted', {
        recursive: true,
        force: true,
      });
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
      const writeStream = { write: vi.fn(), end: vi.fn() };

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(true);

      await expect(
        converter.convert(
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

    test('should handle conversion task failure', async () => {
      const mockTask = createMockTask();
      mockTask.waitForCompletion = vi
        .fn()
        .mockRejectedValue(new Error('Task failed'));

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Task failed');

      expect(logger.error).toHaveBeenCalledWith(
        '[PDFConverter] Conversion failed:',
        expect.any(Error),
      );
    });

    test('should handle download failure', async () => {
      const mockTask = createMockTask();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockRejectedValue(
        new Error('Download failed'),
      );

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-download-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Download failed');

      expect(logger.error).toHaveBeenCalledWith(
        '[PDFConverter] Conversion failed:',
        expect.any(Error),
      );
    });

    test('should handle processing failure and cleanup', async () => {
      const mockTask = createMockTask();
      const writeStream = { write: vi.fn(), end: vi.fn() };

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockRejectedValue(new Error('Processing failed'));
      vi.mocked(existsSync).mockReturnValue(true);

      await expect(
        converter.convert(
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

    test('should handle non-existent files during cleanup', async () => {
      const mockTask = createMockTask();
      const onComplete = vi.fn().mockResolvedValue(undefined);
      const writeStream = { write: vi.fn(), end: vi.fn() };

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report-no-files',
        onComplete,
        true,
        {},
      );

      expect(rmSync).not.toHaveBeenCalled();
    });
  });

  describe('startConversionTask', () => {
    test('should start conversion task and log task ID', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Task created: task-123',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Polling for progress...',
      );
    });
  });

  describe('trackTaskProgress', () => {
    test('should track progress events', async () => {
      const mockTask = createMockTask();
      const handlers: Record<string, any> = {};

      mockTask.on = vi.fn((event, handler) => {
        handlers[event] = handler;
        return mockTask;
      });

      mockTask.waitForCompletion = vi.fn(async () => {
        if (handlers['progress']) {
          handlers['progress']({
            task_id: 'task-123',
            task_status: 'started' as const,
          });
          handlers['progress']({
            task_id: 'task-123',
            task_status: 'started' as const,
            task_position: 50,
          });
        }
        return {
          task_id: 'task-123',
          task_status: 'success' as const,
        };
      });

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(process.stdout.write).toHaveBeenCalled();
      expect(clearInterval).toHaveBeenCalled();
    });

    test('should handle complete event', async () => {
      const mockTask = createMockTask();
      const handlers: Record<string, any> = {};

      mockTask.on = vi.fn((event, handler) => {
        handlers[event] = handler;
        return mockTask;
      });

      mockTask.waitForCompletion = vi.fn(async () => {
        if (handlers['complete']) {
          handlers['complete']();
        }
        return {
          task_id: 'task-123',
          task_status: 'success' as const,
        };
      });

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(logger.info).toHaveBeenCalledWith(
        '\n[PDFConverter] Conversion completed!',
      );
      expect(clearInterval).toHaveBeenCalled();
    });

    test('should handle error event', async () => {
      const mockTask = createMockTask();
      const handlers: Record<string, any> = {};

      mockTask.on = vi.fn((event, handler) => {
        handlers[event] = handler;
        return mockTask;
      });

      mockTask.waitForCompletion = vi.fn(async () => {
        if (handlers['error']) {
          handlers['error'](new Error('Task error'));
        }
        return {
          task_id: 'task-123',
          task_status: 'failure' as const,
        };
      });

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(logger.error).toHaveBeenCalledWith(
        '\n[PDFConverter] Conversion error:',
        'Task error',
      );
      expect(clearInterval).toHaveBeenCalled();
    });

    test('should update progress with elapsed time', async () => {
      const mockTask = createMockTask();
      let intervalCallback: (() => void) | undefined;
      const handlers: Record<string, any> = {};

      mockTask.on = vi.fn((event, handler) => {
        handlers[event] = handler;
        return mockTask;
      });

      mockTask.waitForCompletion = vi.fn(async () => {
        if (intervalCallback) {
          intervalCallback();
        }
        return {
          task_id: 'task-123',
          task_status: 'success' as const,
        };
      });

      vi.mocked(global.setInterval).mockImplementation(((fn: () => void) => {
        intervalCallback = fn;
        return 123 as unknown as NodeJS.Timeout;
      }) as typeof setInterval);

      vi.spyOn(Date, 'now')
        .mockReturnValueOnce(1000000)
        .mockReturnValueOnce(1002000)
        .mockReturnValue(1000000);

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(setInterval).toHaveBeenCalled();
      expect(process.stdout.write).toHaveBeenCalled();
    });

    test('should not update progress after completion', async () => {
      const mockTask = createMockTask();
      let intervalCallback: (() => void) | undefined;
      const handlers: Record<string, (arg?: unknown) => void> = {};

      mockTask.on = vi.fn((event, handler) => {
        handlers[event] = handler;
        return mockTask;
      });

      mockTask.waitForCompletion = vi.fn(async () => {
        return {
          task_id: 'task-123',
          task_status: 'success' as const,
        };
      });

      vi.mocked(global.setInterval).mockImplementation(((fn: () => void) => {
        intervalCallback = fn;
        return 123 as unknown as NodeJS.Timeout;
      }) as typeof setInterval);

      vi.spyOn(Date, 'now').mockReturnValue(1000000);

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      vi.mocked(process.stdout.write).mockClear();

      // Simulate interval callback after completion (race condition scenario)
      if (intervalCallback) {
        intervalCallback();
      }

      // Should not write to stdout after completion due to isCompleted flag
      expect(process.stdout.write).not.toHaveBeenCalled();
    });
  });

  describe('downloadResult', () => {
    test('should download result file successfully', async () => {
      const mockTask = createMockTask();
      const mockFileStream = {} as Readable;
      const writeStream = { write: vi.fn(), end: vi.fn() };

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: mockFileStream,
      });
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(logger.info).toHaveBeenCalledWith(
        '\n[PDFConverter] Task completed, downloading ZIP file...',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Saving ZIP file to:',
        '/test/cwd/result.zip',
      );
      expect(createWriteStream).toHaveBeenCalledWith('/test/cwd/result.zip');
      expect(pipeline).toHaveBeenCalledWith(mockFileStream, writeStream);
    });

    test('should throw error when success is false', async () => {
      const mockTask = createMockTask();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: false,
      } as any);

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Failed to get ZIP file result');
    });

    test('should throw error when fileStream is missing', async () => {
      const mockTask = createMockTask();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: undefined,
      } as any);

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Failed to get ZIP file result');
    });
  });

  describe('processConvertedFiles', () => {
    test('should call ImageExtractor with correct paths', async () => {
      const mockTask = createMockTask();
      const writeStream = { write: vi.fn(), end: vi.fn() };

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
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

  describe('abort signal handling', () => {
    test('should throw AbortError when aborted after docling task completes', async () => {
      const mockTask = createMockTask();
      const abortController = new AbortController();

      // Abort after task waitForCompletion
      mockTask.waitForCompletion = vi.fn(async () => {
        abortController.abort();
        return {
          task_id: 'task-123',
          task_status: 'success' as const,
        };
      });

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });

      await expect(
        converter.convert(
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
      const writeStream = { write: vi.fn(), end: vi.fn() };

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);

      // Abort after processConvertedFiles (ImageExtractor) completes
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockImplementation(async () => {
        abortController.abort();
      });
      vi.mocked(existsSync).mockReturnValue(true);

      await expect(
        converter.convert(
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

    test('should not attempt fallback when aborted during initial conversion', async () => {
      const mockTask = createMockTask();
      const abortController = new AbortController();
      abortController.abort();

      mockTask.waitForCompletion = vi
        .fn()
        .mockRejectedValue(new Error('Conversion failed'));

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

      const converterWithFallback = new PDFConverter(logger, client, true);

      await expect(
        converterWithFallback.convert(
          'http://test.com/doc.pdf',
          'report-abort-fallback',
          vi.fn(),
          false,
          {},
          abortController.signal,
        ),
      ).rejects.toThrow('Conversion failed');

      // Should NOT attempt fallback when aborted
      expect(ImagePdfConverter).not.toHaveBeenCalled();
    });
  });

  describe('image PDF fallback', () => {
    test('should not attempt fallback when enableImagePdfFallback is false', async () => {
      const mockTask = createMockTask();
      mockTask.waitForCompletion = vi
        .fn()
        .mockRejectedValue(new Error('Conversion failed'));

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

      const converterWithoutFallback = new PDFConverter(logger, client, false);

      await expect(
        converterWithoutFallback.convert(
          'http://test.com/doc.pdf',
          'report-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Conversion failed');

      expect(ImagePdfConverter).not.toHaveBeenCalled();
    });

    test('should attempt fallback when enableImagePdfFallback is true and original fails', async () => {
      const successTask = createMockTask();
      let callCount = 0;

      vi.mocked(client.convertSourceAsync).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          const failTask = createMockTask();
          failTask.waitForCompletion = vi
            .fn()
            .mockRejectedValue(new Error('Original conversion failed'));
          return Promise.resolve(failTask);
        }
        return Promise.resolve(successTask);
      });

      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });

      const mockImagePdfConverter = {
        convert: vi.fn().mockResolvedValue('/tmp/test-image.pdf'),
        cleanup: vi.fn(),
      };
      vi.mocked(ImagePdfConverter).mockImplementation(
        () => mockImagePdfConverter as any,
      );

      const writeStream = { write: vi.fn(), end: vi.fn() };
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(false);

      const converterWithFallback = new PDFConverter(logger, client, true);

      await converterWithFallback.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(mockImagePdfConverter.convert).toHaveBeenCalledWith(
        'http://test.com/doc.pdf',
        'report123',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Attempting image PDF fallback...',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Retrying with image PDF:',
        'file:///tmp/test-image.pdf',
      );
      expect(mockImagePdfConverter.cleanup).toHaveBeenCalledWith(
        '/tmp/test-image.pdf',
      );
    });

    test('should throw ImagePdfFallbackError when both original and fallback fail', async () => {
      const mockTask = createMockTask();
      mockTask.waitForCompletion = vi
        .fn()
        .mockRejectedValue(new Error('Original conversion failed'));

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

      const mockImagePdfConverter = {
        convert: vi
          .fn()
          .mockRejectedValue(new Error('ImageMagick conversion failed')),
        cleanup: vi.fn(),
      };
      vi.mocked(ImagePdfConverter).mockImplementation(
        () => mockImagePdfConverter as any,
      );

      const converterWithFallback = new PDFConverter(logger, client, true);

      await expect(
        converterWithFallback.convert(
          'http://test.com/doc.pdf',
          'report-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow(ImagePdfFallbackError);

      expect(logger.error).toHaveBeenCalledWith(
        '[PDFConverter] Fallback conversion also failed:',
        expect.any(Error),
      );
    });

    test('should cleanup image PDF even when fallback conversion fails', async () => {
      const fallbackTask = createMockTask();
      let callCount = 0;

      vi.mocked(client.convertSourceAsync).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          const failTask = createMockTask();
          failTask.waitForCompletion = vi
            .fn()
            .mockRejectedValue(new Error('Original failed'));
          return Promise.resolve(failTask);
        }
        fallbackTask.waitForCompletion = vi
          .fn()
          .mockRejectedValue(new Error('Fallback failed'));
        return Promise.resolve(fallbackTask);
      });

      const mockImagePdfConverter = {
        convert: vi.fn().mockResolvedValue('/tmp/test-image.pdf'),
        cleanup: vi.fn(),
      };
      vi.mocked(ImagePdfConverter).mockImplementation(
        () => mockImagePdfConverter as any,
      );

      const converterWithFallback = new PDFConverter(logger, client, true);

      await expect(
        converterWithFallback.convert(
          'http://test.com/doc.pdf',
          'report-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow(ImagePdfFallbackError);

      // Cleanup should still be called
      expect(mockImagePdfConverter.cleanup).toHaveBeenCalledWith(
        '/tmp/test-image.pdf',
      );
    });

    test('should log success message when fallback succeeds', async () => {
      const successTask = createMockTask();
      let callCount = 0;

      vi.mocked(client.convertSourceAsync).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          const failTask = createMockTask();
          failTask.waitForCompletion = vi
            .fn()
            .mockRejectedValue(new Error('Original failed'));
          return Promise.resolve(failTask);
        }
        return Promise.resolve(successTask);
      });

      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });

      const mockImagePdfConverter = {
        convert: vi.fn().mockResolvedValue('/tmp/test-image.pdf'),
        cleanup: vi.fn(),
      };
      vi.mocked(ImagePdfConverter).mockImplementation(
        () => mockImagePdfConverter as any,
      );

      const writeStream = { write: vi.fn(), end: vi.fn() };
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(false);

      const converterWithFallback = new PDFConverter(logger, client, true);

      await converterWithFallback.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Fallback conversion succeeded',
      );
    });
  });
});

function createMockTask(): AsyncConversionTask {
  const task = {
    taskId: 'task-123',
    on: vi.fn().mockReturnThis(),
    waitForCompletion: vi.fn().mockResolvedValue({
      task_id: 'task-123',
      task_status: 'success' as const,
    }),
  };
  return task as unknown as AsyncConversionTask;
}
