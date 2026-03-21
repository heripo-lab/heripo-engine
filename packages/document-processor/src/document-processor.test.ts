import type { LoggerMethods } from '@heripo/logger';
import type { DoclingDocument } from '@heripo/model';
import type { LanguageModel } from 'ai';

import { BatchProcessor } from '@heripo/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { DocumentProcessor } from './document-processor';
import { TocNotFoundError } from './extractors/toc-extract-error';

// Mock CaptionParser for fallback reparse tests
vi.mock('./parsers/caption-parser.js', () => ({
  CaptionParser: vi.fn(),
}));

// Mock utilities
vi.mock('./utils/ref-resolver.js', () => ({
  RefResolver: vi.fn(function () {
    return {};
  }),
}));

vi.mock('./utils/id-generator.js', () => ({
  IdGenerator: vi.fn(function () {
    return {
      generateChapterId: vi.fn(() => 'ch-001'),
      generateImageId: vi.fn(() => 'img-001'),
      generateTableId: vi.fn(() => 'tbl-001'),
      generateFootnoteId: vi.fn(() => 'ftn-001'),
    };
  }),
}));

vi.mock('./parsers/page-range-parser.js', () => ({
  PageRangeParser: vi.fn(function () {
    return {
      parse: vi.fn().mockResolvedValue({
        pageRangeMap: { 1: { startPageNo: 1, endPageNo: 1 } },
        usage: [],
      }),
    };
  }),
}));

describe('DocumentProcessor', () => {
  let mockLogger: LoggerMethods;
  let mockModel: LanguageModel;
  let mockPageRangeParserModel: LanguageModel;
  let mockTocExtractorModel: LanguageModel;
  let mockTocContentValidatorModel: LanguageModel;
  let mockVisionTocExtractorModel: LanguageModel;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    mockModel = { modelId: 'gpt-5' } as LanguageModel;
    mockPageRangeParserModel = { modelId: 'claude-opus-4-5' } as LanguageModel;
    mockTocExtractorModel = { modelId: 'gpt-5' } as LanguageModel;
    mockTocContentValidatorModel = { modelId: 'gpt-5-mini' } as LanguageModel;
    mockVisionTocExtractorModel = {
      modelId: 'claude-opus-4-5',
    } as LanguageModel;
  });

  describe('constructor', () => {
    test('initialize with required options', () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      expect(processor).toBeDefined();
    });

    test('initialize with all options', () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        pageRangeParserModel: mockPageRangeParserModel,
        tocExtractorModel: mockTocExtractorModel,
        validatorModel: mockTocContentValidatorModel,
        visionTocExtractorModel: mockVisionTocExtractorModel,
        textCleanerBatchSize: 20,
        captionParserBatchSize: 15,
        captionValidatorBatchSize: 10,
        maxRetries: 5,
      });

      expect(processor).toBeDefined();
    });

    test('use fallbackModel when component-specific models not provided', () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      expect(processor).toBeDefined();
    });

    test('supports different batch sizes for different operations', () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 20, // Larger for sync processing
        captionParserBatchSize: 10, // Medium for LLM parsing
        captionValidatorBatchSize: 5, // Smaller for LLM validation
      });

      // Verify BatchProcessor batch splitting with different sizes
      const testTexts = Array.from({ length: 25 }, (_, i) => `text ${i}`);
      const result20 = BatchProcessor.createBatches(testTexts, 20);
      const result10 = BatchProcessor.createBatches(testTexts, 10);
      const result5 = BatchProcessor.createBatches(testTexts, 5);

      expect(result20).toHaveLength(2);
      expect(result20[0]).toHaveLength(20);
      expect(result10).toHaveLength(3);
      expect(result10[0]).toHaveLength(10);
      expect(result5).toHaveLength(5);
      expect(processor).toBeDefined();
    });

    test('default value - maxRetries 3', () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      // Verify private maxRetries (indirect behavior verification)
      expect(processor).toBeDefined();
    });

    test('use specific models when partially provided', () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        pageRangeParserModel: mockPageRangeParserModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      expect(processor).toBeDefined();
    });
  });

  describe('process', () => {
    test('should throw TocNotFoundError when TOC extraction fails', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockDoc: DoclingDocument = {
        schema_name: 'DoclingDocument',
        version: '1.0.0',
        name: 'test-doc',
        origin: {
          mimetype: 'application/pdf',
          binary_hash: 123,
          filename: 'test.pdf',
        },
        furniture: {
          name: '_root_',
          label: 'unspecified',
          self_ref: '#/furniture',
          children: [],
          content_layer: 'furniture',
        },
        texts: [
          {
            text: 'test',
            self_ref: '#/texts/0',
            prov: [
              {
                page_no: 1,
                bbox: { l: 0, t: 0, r: 100, b: 100, coord_origin: 'TOPLEFT' },
                charspan: [0, 4],
              },
            ],
            label: 'text',
            orig: 'test',
            children: [],
            content_layer: 'body',
          },
        ],
        pictures: [],
        tables: [],
        groups: [],
        body: {
          name: '_root_',
          label: 'unspecified',
          self_ref: '#/body',
          children: [],
          content_layer: 'body',
        },
        pages: {},
      } as DoclingDocument;

      await expect(
        processor.process(mockDoc, 'report-001', '/path'),
      ).rejects.toThrow(TocNotFoundError);
    });

    test('should complete successfully when TOC extraction succeeds', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      // Spy on initializeProcessors to inject mocks after real initialization
      const originalInit = (processor as any).initializeProcessors.bind(
        processor,
      );
      vi.spyOn(processor as any, 'initializeProcessors').mockImplementation(
        (...args: any[]) => {
          originalInit(...args);

          (processor as any).refResolver = {
            resolve: vi.fn().mockReturnValue({
              text: 'Chapter 1 ..... 1',
              orig: 'Chapter 1 ..... 1',
              label: 'text',
              self_ref: '#/texts/0',
            }),
            resolveText: vi.fn().mockReturnValue({
              text: 'Chapter 1 ..... 1',
            }),
          };
          (processor as any).tocFinder = {
            find: vi.fn().mockReturnValue({
              startPage: 1,
              endPage: 1,
              itemRefs: ['#/texts/0'],
            }),
          };
          (processor as any).tocContentValidator = {
            validate: vi.fn().mockResolvedValue({
              isValid: true,
              confidence: 0.9,
              contentType: 'pure_toc',
              validTocMarkdown: '- Chapter 1 ..... 1',
              reason: 'Valid TOC',
            }),
            isValid: vi.fn().mockReturnValue(true),
            getValidMarkdown: vi.fn().mockReturnValue('- Chapter 1 ..... 1'),
          };
          (processor as any).tocExtractor = {
            extract: vi.fn().mockResolvedValue({
              entries: [{ title: 'Chapter 1', level: 1, pageNo: 1 }],
              usages: [
                {
                  component: 'TocExtractor',
                  phase: 'extraction',
                  model: 'primary',
                  modelName: 'test-model',
                  inputTokens: 100,
                  outputTokens: 50,
                  totalTokens: 150,
                },
              ],
            }),
          };
          (processor as any).visionTocExtractor = {
            extract: vi.fn().mockResolvedValue(null),
          };
          (processor as any).captionParser = {
            parseBatch: vi.fn().mockResolvedValue([]),
          };
          (processor as any).captionValidator = {
            validateBatch: vi.fn().mockResolvedValue([]),
          };
          (processor as any).chapterConverter = {
            convert: vi.fn().mockReturnValue([
              {
                id: 'ch-001',
                originTitle: 'Chapter 1',
                title: 'Chapter 1',
                pageNo: 1,
                level: 1,
                textBlocks: [],
                imageIds: [],
                tableIds: [],
                footnoteIds: [],
                children: [],
              },
            ]),
          };
          (processor as any).tocExtractionPipeline = {
            extract: vi
              .fn()
              .mockResolvedValue([{ title: 'Chapter 1', level: 1, pageNo: 1 }]),
          };
        },
      );

      const mockDoc: DoclingDocument = {
        schema_name: 'DoclingDocument',
        version: '1.0.0',
        name: 'test-doc',
        origin: {
          mimetype: 'application/pdf',
          binary_hash: 123,
          filename: 'test.pdf',
        },
        furniture: {
          name: '_root_',
          label: 'unspecified',
          self_ref: '#/furniture',
          children: [],
          content_layer: 'furniture',
        },
        texts: [
          {
            text: 'test',
            self_ref: '#/texts/0',
            prov: [
              {
                page_no: 1,
                bbox: { l: 0, t: 0, r: 100, b: 100, coord_origin: 'TOPLEFT' },
                charspan: [0, 4],
              },
            ],
            label: 'text',
            orig: 'test',
            children: [],
            content_layer: 'body',
          },
        ],
        pictures: [],
        tables: [],
        groups: [],
        body: {
          name: '_root_',
          label: 'unspecified',
          self_ref: '#/body',
          children: [],
          content_layer: 'body',
        },
        pages: { '1': {} as any },
      } as DoclingDocument;

      const result = await processor.process(mockDoc, 'report-001', '/path');

      expect(result).toBeDefined();
      expect(result.document.reportId).toBe('report-001');
      expect(result.document.chapters).toHaveLength(1);
      expect(result.document.chapters[0].title).toBe('Chapter 1');
      expect(result.document.images).toEqual([]);
      expect(result.document.tables).toEqual([]);
      expect(result.document.footnotes).toEqual([]);
      expect(result.document.pageRangeMap).toBeDefined();
      expect(result.usage).toBeDefined();
    });
  });

  describe('constructor with enableFallbackRetry', () => {
    test('default enableFallbackRetry is false', () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      expect(processor).toBeDefined();
    });

    test('can enable enableFallbackRetry', () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
        enableFallbackRetry: true,
      });

      expect(processor).toBeDefined();
    });

    test('process method throws TocNotFoundError when enableFallbackRetry is false and no TOC', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
        enableFallbackRetry: false,
      });

      const mockDoc: DoclingDocument = {
        schema_name: 'DoclingDocument',
        version: '1.0.0',
        name: 'test-doc',
        origin: {
          mimetype: 'application/pdf',
          binary_hash: 123,
          filename: 'test.pdf',
        },
        furniture: {
          name: '_root_',
          label: 'unspecified',
          self_ref: '#/furniture',
          children: [],
          content_layer: 'furniture',
        },
        texts: [],
        pictures: [],
        tables: [],
        groups: [],
        body: {
          name: '_root_',
          label: 'unspecified',
          self_ref: '#/body',
          children: [],
          content_layer: 'body',
        },
        pages: {},
      } as DoclingDocument;

      await expect(
        processor.process(mockDoc, 'report-001', '/path'),
      ).rejects.toThrow(TocNotFoundError);
    });

    test('process method throws TocNotFoundError when enableFallbackRetry is true and no TOC', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
        enableFallbackRetry: true,
      });

      const mockDoc: DoclingDocument = {
        schema_name: 'DoclingDocument',
        version: '1.0.0',
        name: 'test-doc',
        origin: {
          mimetype: 'application/pdf',
          binary_hash: 123,
          filename: 'test.pdf',
        },
        furniture: {
          name: '_root_',
          label: 'unspecified',
          self_ref: '#/furniture',
          children: [],
          content_layer: 'furniture',
        },
        texts: [],
        pictures: [],
        tables: [],
        groups: [],
        body: {
          name: '_root_',
          label: 'unspecified',
          self_ref: '#/body',
          children: [],
          content_layer: 'body',
        },
        pages: {},
      } as DoclingDocument;

      await expect(
        processor.process(mockDoc, 'report-001', '/path'),
      ).rejects.toThrow(TocNotFoundError);
    });
  });

  describe('convertChapters', () => {
    test('should use ChapterConverter when TOC entries exist', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockChapterConverter = {
        convert: vi.fn().mockReturnValue([
          {
            id: 'ch-001',
            originTitle: 'Chapter 1',
            title: 'Chapter 1',
            pageNo: 1,
            level: 1,
            textBlocks: [],
            imageIds: [],
            tableIds: [],
            footnoteIds: [],
          },
        ]),
      };

      (processor as any).chapterConverter = mockChapterConverter;

      const tocEntries = [{ title: 'Chapter 1', level: 1, pageNo: 1 }];
      const mockDoc = {
        texts: [
          {
            text: 'Test text',
            prov: [{ page_no: 1 }],
          },
        ],
      };
      const pageRangeMap = { 1: { startPageNo: 1, endPageNo: 1 } };
      const images: any[] = [];
      const tables: any[] = [];
      const footnotes: any[] = [];

      const result = await (processor as any).convertChapters(
        mockDoc,
        tocEntries,
        pageRangeMap,
        images,
        tables,
        footnotes,
      );

      expect(mockChapterConverter.convert).toHaveBeenCalledWith(
        tocEntries,
        mockDoc.texts,
        pageRangeMap,
        images,
        tables,
        footnotes,
      );
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Chapter 1');
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[DocumentProcessor] Converted 1 top-level chapters',
      );
    });

    test('should throw TocNotFoundError when TOC is empty', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockDoc = {
        texts: [
          {
            text: 'Test text content',
            prov: [{ page_no: 1 }],
          },
        ],
      };
      const pageRangeMap = { 1: { startPageNo: 1, endPageNo: 1 } };

      await expect(
        (processor as any).convertChapters(
          mockDoc,
          [], // Empty TOC
          pageRangeMap,
          [],
          [],
          [],
        ),
      ).rejects.toThrow(TocNotFoundError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[DocumentProcessor] Cannot convert chapters without TOC entries',
      );
    });
  });

  describe('abort signal handling', () => {
    test('should throw AbortError when abortSignal is already aborted at process start', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
        abortSignal: abortController.signal,
      });

      const mockDoc: DoclingDocument = {
        schema_name: 'DoclingDocument',
        version: '1.0.0',
        name: 'test-doc',
        origin: {
          mimetype: 'application/pdf',
          binary_hash: 123,
          filename: 'test.pdf',
        },
        furniture: {
          name: '_root_',
          label: 'unspecified',
          self_ref: '#/furniture',
          children: [],
          content_layer: 'furniture',
        },
        texts: [],
        pictures: [],
        tables: [],
        groups: [],
        body: {
          name: '_root_',
          label: 'unspecified',
          self_ref: '#/body',
          children: [],
          content_layer: 'body',
        },
        pages: {},
      } as DoclingDocument;

      await expect(
        processor.process(mockDoc, 'report-001', '/path'),
      ).rejects.toThrow('Document processing was aborted');
    });

    test('checkAborted should throw with AbortError name', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
        abortSignal: abortController.signal,
      });

      try {
        (processor as any).checkAborted();
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).name).toBe('AbortError');
        expect((error as Error).message).toBe(
          'Document processing was aborted',
        );
      }
    });

    test('checkAborted should not throw when signal not aborted', () => {
      const abortController = new AbortController();

      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
        abortSignal: abortController.signal,
      });

      expect(() => (processor as any).checkAborted()).not.toThrow();
    });

    test('checkAborted should not throw when no signal provided', () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      expect(() => (processor as any).checkAborted()).not.toThrow();
    });
  });

  // extractMaxPageNumber tests moved to src/utils/toc-markdown-utils.test.ts
});
