import type { LoggerMethods } from '@heripo/logger';
import type { AsyncConversionTask, DoclingAPIClient } from 'docling-sdk';

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ImagePdfFallbackError } from '../errors/image-pdf-fallback-error';
import { ImageExtractor } from '../processors/image-extractor';
import { PdfTextExtractor } from '../processors/pdf-text-extractor';
import { downloadTaskResult } from '../utils/docling-result-downloader';
import { LocalFileServer } from '../utils/local-file-server';
import { renderAndUpdatePageImages } from '../utils/page-image-updater';
import { trackTaskProgress } from '../utils/task-progress-tracker';
import { DocumentTypeValidator } from '../validators/document-type-validator';
import { ChunkedPDFConverter } from './chunked-pdf-converter';
import { buildConversionOptions } from './conversion-options-builder';
import { ImagePdfConverter } from './image-pdf-converter';
import { PDFConverter } from './pdf-converter';

vi.mock('./conversion-options-builder', () => ({
  buildConversionOptions: vi.fn(),
}));

vi.mock('./chunked-pdf-converter', () => ({
  ChunkedPDFConverter: vi.fn(),
}));

vi.mock('./image-pdf-converter', () => ({
  ImagePdfConverter: vi.fn(),
}));

vi.mock('../utils/local-file-server', () => ({
  LocalFileServer: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  copyFileSync: vi.fn(),
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

vi.mock('../processors/pdf-text-extractor', () => ({
  PdfTextExtractor: vi.fn(),
}));

vi.mock('../validators/document-type-validator', () => ({
  DocumentTypeValidator: vi.fn(),
}));

vi.mock('../utils/jq', () => ({
  runJqFileJson: vi.fn(),
}));

vi.mock('../utils/page-image-updater', () => ({
  renderAndUpdatePageImages: vi.fn(),
}));

vi.mock('../utils/task-progress-tracker', () => ({
  trackTaskProgress: vi.fn(),
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
      getConfig: vi.fn().mockReturnValue({ baseUrl: 'http://localhost:5001' }),
    } as unknown as DoclingAPIClient;

    converter = new PDFConverter(logger, client);

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

    // Mock LocalFileServer
    vi.mocked(LocalFileServer).mockImplementation(function () {
      return {
        start: vi.fn().mockResolvedValue('http://127.0.0.1:12345/test.pdf'),
        stop: vi.fn().mockResolvedValue(undefined),
      } as unknown as LocalFileServer;
    });

    // Mock ImagePdfConverter (used by forceImagePdf and image PDF fallback)
    vi.mocked(ImagePdfConverter).mockImplementation(function () {
      return {
        convert: vi.fn().mockResolvedValue('/tmp/image.pdf'),
        cleanup: vi.fn(),
      } as any;
    });
  });

  describe('constructor', () => {
    test('should create an instance with logger and client', () => {
      expect(converter).toBeInstanceOf(PDFConverter);
    });

    test('should accept custom timeout parameter', () => {
      const customConverter = new PDFConverter(
        logger,
        client,
        false,
        5_000_000,
      );
      expect(customConverter).toBeInstanceOf(PDFConverter);
    });

    describe('chunked conversion', () => {
      let mockConvertChunked: ReturnType<typeof vi.fn>;

      beforeEach(() => {
        mockConvertChunked = vi.fn().mockResolvedValue(null);
        vi.mocked(ChunkedPDFConverter).mockImplementation(function () {
          return { convertChunked: mockConvertChunked } as any;
        });
      });

      test('delegates to ChunkedPDFConverter when chunkedConversion is true and url is file://', async () => {
        await converter.convert(
          'file:///test/input.pdf',
          'report-1',
          vi.fn(),
          false,
          { chunkedConversion: true },
        );

        expect(ChunkedPDFConverter).toHaveBeenCalledWith(
          logger,
          client,
          expect.objectContaining({ chunkSize: 10, maxRetries: 2 }),
          expect.any(Number),
        );
        expect(mockConvertChunked).toHaveBeenCalledWith(
          'file:///test/input.pdf',
          'report-1',
          expect.any(Function),
          false,
          expect.objectContaining({ chunkedConversion: true }),
          undefined,
        );
      });

      test('uses custom chunkSize and chunkMaxRetries', async () => {
        await converter.convert(
          'file:///test/input.pdf',
          'report-1',
          vi.fn(),
          false,
          { chunkedConversion: true, chunkSize: 20, chunkMaxRetries: 5 },
        );

        expect(ChunkedPDFConverter).toHaveBeenCalledWith(
          logger,
          client,
          { chunkSize: 20, maxRetries: 5 },
          expect.any(Number),
        );
      });

      test('does not use chunked conversion for non-file:// URLs', async () => {
        const mockTask = createMockTask();
        vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

        await converter.convert(
          'http://example.com/test.pdf',
          'report-1',
          vi.fn(),
          true,
          { chunkedConversion: true },
        );

        expect(ChunkedPDFConverter).not.toHaveBeenCalled();
      });
    });
  });

  describe('validateDocumentType', () => {
    let mockValidate: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockValidate = vi.fn().mockResolvedValue(undefined);
      vi.mocked(PdfTextExtractor).mockImplementation(function () {
        return {} as any;
      });
      vi.mocked(DocumentTypeValidator).mockImplementation(function () {
        return { validate: mockValidate } as any;
      });
    });

    test('should validate document type for file:// URL with documentValidationModel', async () => {
      const mockTask = createMockTask();
      const onComplete = vi.fn().mockResolvedValue(undefined);
      const mockModel = {} as any;

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      await converter.convert(
        'file:///test/doc.pdf',
        'report123',
        onComplete,
        false,
        { documentValidationModel: mockModel },
      );

      expect(PdfTextExtractor).toHaveBeenCalledWith(logger);
      expect(DocumentTypeValidator).toHaveBeenCalled();
      expect(mockValidate).toHaveBeenCalledWith('/test/doc.pdf', mockModel, {
        abortSignal: undefined,
      });
    });

    test('should skip validation for non-file:// URLs', async () => {
      const mockTask = createMockTask();
      const onComplete = vi.fn().mockResolvedValue(undefined);
      const mockModel = {} as any;

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
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
        { documentValidationModel: mockModel },
      );

      expect(PdfTextExtractor).not.toHaveBeenCalled();
      expect(DocumentTypeValidator).not.toHaveBeenCalled();
    });

    test('should only validate once per converter instance', async () => {
      const mockTask = createMockTask();
      const onComplete = vi.fn().mockResolvedValue(undefined);
      const mockModel = {} as any;

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(false);

      // First call triggers validation
      await converter.convert(
        'file:///test/doc.pdf',
        'report123',
        onComplete,
        false,
        { documentValidationModel: mockModel },
      );

      expect(mockValidate).toHaveBeenCalledTimes(1);

      vi.mocked(client.convertSourceAsync).mockResolvedValue(createMockTask());

      // Second call skips validation (already validated)
      await converter.convert(
        'file:///test/doc2.pdf',
        'report456',
        onComplete,
        false,
        { documentValidationModel: mockModel },
      );

      expect(mockValidate).toHaveBeenCalledTimes(1);
    });

    test('should skip validation when documentValidationModel is not set', async () => {
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

      await converter.convert(
        'file:///test/doc.pdf',
        'report123',
        onComplete,
        false,
        {},
      );

      expect(PdfTextExtractor).not.toHaveBeenCalled();
      expect(DocumentTypeValidator).not.toHaveBeenCalled();
    });
  });

  describe('convert', () => {
    test('should successfully convert PDF with cleanupAfterCallback=false', async () => {
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

    test('should successfully convert PDF with cleanupAfterCallback=true', async () => {
      const mockTask = createMockTask();
      const onComplete = vi.fn().mockResolvedValue(undefined);

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
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

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
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

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(trackTaskProgress).mockRejectedValue(
        new Error('Task failed: Processing failed'),
      );

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Task failed: Processing failed');

      expect(logger.error).toHaveBeenCalledWith(
        '[PDFConverter] Conversion failed:',
        expect.any(Error),
      );
    });

    test('should handle download failure', async () => {
      const mockTask = createMockTask();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(downloadTaskResult).mockRejectedValue(
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

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
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

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
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

  describe('trackTaskProgress delegation', () => {
    test('should call trackTaskProgress with showDetailedProgress', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(trackTaskProgress).toHaveBeenCalledWith(
        mockTask,
        expect.any(Number),
        logger,
        '[PDFConverter]',
        { showDetailedProgress: true },
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
      const abortController = new AbortController();
      const mockTask = createMockTask();

      // Simulate trackTaskProgress completing but abort being triggered during it
      vi.mocked(trackTaskProgress).mockImplementation(async () => {
        abortController.abort();
      });
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

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

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

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
      const abortController = new AbortController();
      abortController.abort();

      const mockTask = createMockTask();

      // trackTaskProgress rejects (simulating task failure)
      vi.mocked(trackTaskProgress).mockRejectedValue(
        new Error('Task failed: Processing failed'),
      );
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
      ).rejects.toThrow('Task failed: Processing failed');

      // Should NOT attempt fallback when aborted
      expect(ImagePdfConverter).not.toHaveBeenCalled();
    });
  });

  describe('image PDF fallback', () => {
    test('should not attempt fallback when enableImagePdfFallback is false', async () => {
      const mockTask = createMockTask();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(trackTaskProgress).mockRejectedValue(
        new Error('Task failed: Processing failed'),
      );

      const converterWithoutFallback = new PDFConverter(logger, client, false);

      await expect(
        converterWithoutFallback.convert(
          'http://test.com/doc.pdf',
          'report-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Task failed: Processing failed');

      expect(ImagePdfConverter).not.toHaveBeenCalled();
    });

    test('should attempt fallback when enableImagePdfFallback is true and original fails', async () => {
      const mockTask = createMockTask();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      // First call fails, second succeeds
      vi.mocked(trackTaskProgress)
        .mockRejectedValueOnce(new Error('Task failed: Processing failed'))
        .mockResolvedValueOnce(undefined);

      const mockImagePdfConverter = {
        convert: vi.fn().mockResolvedValue('/tmp/test-image.pdf'),
        cleanup: vi.fn(),
      };
      vi.mocked(ImagePdfConverter).mockImplementation(function () {
        return mockImagePdfConverter as any;
      });

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

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(trackTaskProgress).mockRejectedValue(
        new Error('Task failed: Processing failed'),
      );

      const mockImagePdfConverter = {
        convert: vi
          .fn()
          .mockRejectedValue(new Error('ImageMagick conversion failed')),
        cleanup: vi.fn(),
      };
      vi.mocked(ImagePdfConverter).mockImplementation(function () {
        return mockImagePdfConverter as any;
      });

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
      const mockTask = createMockTask();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(trackTaskProgress).mockRejectedValue(
        new Error('Task failed: Processing failed'),
      );

      const mockImagePdfConverter = {
        convert: vi.fn().mockResolvedValue('/tmp/test-image.pdf'),
        cleanup: vi.fn(),
      };
      vi.mocked(ImagePdfConverter).mockImplementation(function () {
        return mockImagePdfConverter as any;
      });

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
      const mockTask = createMockTask();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      // First call fails, second succeeds
      vi.mocked(trackTaskProgress)
        .mockRejectedValueOnce(new Error('Task failed: Processing failed'))
        .mockResolvedValueOnce(undefined);

      const mockImagePdfConverter = {
        convert: vi.fn().mockResolvedValue('/tmp/test-image.pdf'),
        cleanup: vi.fn(),
      };
      vi.mocked(ImagePdfConverter).mockImplementation(function () {
        return mockImagePdfConverter as any;
      });

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

  describe('renderPageImages', () => {
    test('should call renderAndUpdatePageImages for file:// URLs', async () => {
      const mockTask = createMockTask();
      const onComplete = vi.fn().mockResolvedValue(undefined);

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
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

      await converter.convert(
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

  describe('forceImagePdf', () => {
    test('should convert via image PDF when forceImagePdf is true', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report-force-img',
        vi.fn(),
        false,
        { forceImagePdf: true },
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Force image PDF mode: converting to image PDF first...',
      );
      expect(ImagePdfConverter).toHaveBeenCalled();
    });

    test('should not convert via image PDF when forceImagePdf is false', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(existsSync).mockReturnValue(false);

      vi.mocked(ImagePdfConverter).mockClear();

      await converter.convert(
        'http://test.com/doc.pdf',
        'report-std-no-force',
        vi.fn(),
        false,
        { forceImagePdf: false },
      );

      expect(ImagePdfConverter).not.toHaveBeenCalled();
    });

    test('should skip cleanup when imagePdfConverter.convert throws before producing a path', async () => {
      vi.mocked(ImagePdfConverter).mockImplementation(function () {
        return {
          convert: vi.fn().mockRejectedValue(new Error('convert failed')),
          cleanup: vi.fn(),
        } as any;
      });

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-force-err',
          vi.fn(),
          false,
          { forceImagePdf: true },
        ),
      ).rejects.toThrow('convert failed');
    });
  });
});

/**
 * Create a mock task that returns success on first poll.
 */
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
