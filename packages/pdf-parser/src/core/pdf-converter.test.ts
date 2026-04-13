import type { LoggerMethods } from '@heripo/logger';
import type { DoclingAPIClient } from 'docling-sdk';

import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ImagePdfFallbackError } from '../errors/image-pdf-fallback-error';
import { PdfTextExtractor } from '../processors/pdf-text-extractor';
import { DocumentTypeValidator } from '../validators/document-type-validator';
import { ChunkedPDFConverter } from './chunked-pdf-converter';
import { DoclingConversionExecutor } from './docling-conversion-executor';
import { ImagePdfConverter } from './image-pdf-converter';
import { PDFConverter } from './pdf-converter';

vi.mock('./chunked-pdf-converter', () => ({
  ChunkedPDFConverter: vi.fn(),
}));

vi.mock('./image-pdf-converter', () => ({
  ImagePdfConverter: vi.fn(),
}));

vi.mock('./docling-conversion-executor', () => ({
  DoclingConversionExecutor: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock('node:path', () => ({
  join: vi.fn(),
}));

vi.mock('../processors/pdf-text-extractor', () => ({
  PdfTextExtractor: vi.fn(),
}));

vi.mock('../validators/document-type-validator', () => ({
  DocumentTypeValidator: vi.fn(),
}));

vi.mock('./vlm-conversion-pipeline', () => ({
  VlmConversionPipeline: vi.fn(),
}));

describe('PDFConverter', () => {
  let logger: LoggerMethods;
  let client: DoclingAPIClient;
  let converter: PDFConverter;
  let mockExecute: ReturnType<typeof vi.fn>;

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

    vi.mocked(join).mockImplementation((...args) => args.join('/'));

    // Mock DoclingConversionExecutor
    mockExecute = vi.fn().mockResolvedValue(null);
    vi.mocked(DoclingConversionExecutor).mockImplementation(function () {
      return { execute: mockExecute } as any;
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
        await converter.convert(
          'http://example.com/test.pdf',
          'report-1',
          vi.fn(),
          true,
          { chunkedConversion: true },
        );

        expect(ChunkedPDFConverter).not.toHaveBeenCalled();
      });

      test('falls back to image PDF when chunked conversion fails', async () => {
        mockConvertChunked.mockRejectedValue(
          new Error('Chunk task failed: unable to retrieve error details'),
        );

        const mockImagePdfConverter = {
          convert: vi.fn().mockResolvedValue('/tmp/image.pdf'),
          cleanup: vi.fn(),
        };
        vi.mocked(ImagePdfConverter).mockImplementation(function () {
          return mockImagePdfConverter as any;
        });

        await converter.convert(
          'file:///test/input.pdf',
          'report-fallback',
          vi.fn(),
          false,
          { chunkedConversion: true },
        );

        expect(logger.warn).toHaveBeenCalledWith(
          '[PDFConverter] Chunked conversion failed, retrying with image-based PDF...',
          'Chunk task failed: unable to retrieve error details',
        );
        expect(ImagePdfConverter).toHaveBeenCalled();
        expect(mockImagePdfConverter.convert).toHaveBeenCalled();
      });

      test('re-throws AbortError without falling back to image PDF', async () => {
        const abortError = new Error('Chunked PDF conversion was aborted');
        abortError.name = 'AbortError';
        mockConvertChunked.mockRejectedValue(abortError);

        await expect(
          converter.convert(
            'file:///test/input.pdf',
            'report-abort',
            vi.fn(),
            false,
            { chunkedConversion: true },
          ),
        ).rejects.toThrow('Chunked PDF conversion was aborted');

        expect(ImagePdfConverter).not.toHaveBeenCalled();
      });

      test('falls back with non-Error thrown value', async () => {
        mockConvertChunked.mockRejectedValue('string error');

        const mockImagePdfConverter = {
          convert: vi.fn().mockResolvedValue('/tmp/image.pdf'),
          cleanup: vi.fn(),
        };
        vi.mocked(ImagePdfConverter).mockImplementation(function () {
          return mockImagePdfConverter as any;
        });

        await converter.convert(
          'file:///test/input.pdf',
          'report-non-error',
          vi.fn(),
          false,
          { chunkedConversion: true },
        );

        expect(logger.warn).toHaveBeenCalledWith(
          '[PDFConverter] Chunked conversion failed, retrying with image-based PDF...',
          'string error',
        );
        expect(ImagePdfConverter).toHaveBeenCalled();
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
      const onComplete = vi.fn().mockResolvedValue(undefined);
      const mockModel = {} as any;

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
      const onComplete = vi.fn().mockResolvedValue(undefined);
      const mockModel = {} as any;

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
      const onComplete = vi.fn().mockResolvedValue(undefined);
      const mockModel = {} as any;

      // First call triggers validation
      await converter.convert(
        'file:///test/doc.pdf',
        'report123',
        onComplete,
        false,
        { documentValidationModel: mockModel },
      );

      expect(mockValidate).toHaveBeenCalledTimes(1);

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
      const onComplete = vi.fn().mockResolvedValue(undefined);

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
    test('should delegate to DoclingConversionExecutor for standard conversion', async () => {
      const onComplete = vi.fn();

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        onComplete,
        false,
        {},
      );

      expect(DoclingConversionExecutor).toHaveBeenCalledWith(
        logger,
        client,
        expect.any(Number),
      );
      expect(mockExecute).toHaveBeenCalledWith(
        'http://test.com/doc.pdf',
        'report123',
        onComplete,
        false,
        {},
        undefined,
      );
    });

    test('should pass abortSignal to executor', async () => {
      const abortController = new AbortController();

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
        abortController.signal,
      );

      expect(mockExecute).toHaveBeenCalledWith(
        'http://test.com/doc.pdf',
        'report123',
        expect.any(Function),
        false,
        {},
        abortController.signal,
      );
    });

    test('should log converting message', async () => {
      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Converting:',
        'http://test.com/doc.pdf',
      );
    });
  });

  describe('abort signal handling', () => {
    test('should not attempt fallback when aborted during initial conversion', async () => {
      const abortController = new AbortController();
      abortController.abort();

      mockExecute.mockRejectedValue(
        new Error('Task failed: Processing failed'),
      );

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
      mockExecute.mockRejectedValue(
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
      // First executor call fails, second succeeds
      mockExecute
        .mockRejectedValueOnce(new Error('Task failed: Processing failed'))
        .mockResolvedValueOnce(null);

      const mockImagePdfConverter = {
        convert: vi.fn().mockResolvedValue('/tmp/test-image.pdf'),
        cleanup: vi.fn(),
      };
      vi.mocked(ImagePdfConverter).mockImplementation(function () {
        return mockImagePdfConverter as any;
      });

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
      mockExecute.mockRejectedValue(
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
      mockExecute.mockRejectedValue(
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
      // First executor call fails, second succeeds
      mockExecute
        .mockRejectedValueOnce(new Error('Task failed: Processing failed'))
        .mockResolvedValueOnce(null);

      const mockImagePdfConverter = {
        convert: vi.fn().mockResolvedValue('/tmp/test-image.pdf'),
        cleanup: vi.fn(),
      };
      vi.mocked(ImagePdfConverter).mockImplementation(function () {
        return mockImagePdfConverter as any;
      });

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

  describe('forceImagePdf', () => {
    test('should convert via image PDF when forceImagePdf is true', async () => {
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

    test('should delegate to DoclingConversionExecutor with image PDF URL', async () => {
      const mockImagePdfConverter = {
        convert: vi.fn().mockResolvedValue('/tmp/image.pdf'),
        cleanup: vi.fn(),
      };
      vi.mocked(ImagePdfConverter).mockImplementation(function () {
        return mockImagePdfConverter as any;
      });

      await converter.convert(
        'http://test.com/doc.pdf',
        'report-force-img',
        vi.fn(),
        false,
        { forceImagePdf: true },
      );

      expect(mockExecute).toHaveBeenCalledWith(
        'file:///tmp/image.pdf',
        'report-force-img',
        expect.any(Function),
        false,
        expect.objectContaining({ forceImagePdf: true }),
        undefined,
      );
      expect(mockImagePdfConverter.cleanup).toHaveBeenCalledWith(
        '/tmp/image.pdf',
      );
    });
  });
});
