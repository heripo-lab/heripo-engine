import type { LoggerMethods } from '@heripo/logger';
import type { DoclingDocument } from '@heripo/model';
import type { LanguageModel } from 'ai';

import { BatchProcessor } from '@heripo/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { DocumentProcessor } from './document-processor';
import { TocNotFoundError } from './extractors/toc-extract-error';
import { CaptionParser } from './parsers/caption-parser';

// Mock CaptionParser for fallback reparse tests
vi.mock('./parsers/caption-parser.js', () => ({
  CaptionParser: vi.fn(),
}));

// Mock HanjaQualitySampler
const mockAssess = vi.fn();
vi.mock('./samplers/index.js', () => ({
  HanjaQualitySampler: vi.fn(function () {
    return { assess: mockAssess };
  }),
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

  describe('processResourceCaptions - Length mismatch recovery', () => {
    test('should recover from length mismatch by filtering validCaptionData', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      // Mock captionParser to return only 2 captions for 3 inputs
      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([
          { fullText: 'Caption A', num: 'A' },
          { fullText: 'Caption C', num: 'C' },
        ]),
      };

      // Mock captionValidator to return validation for recovered captions
      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([true, true]),
      };

      (processor as any).captionParser = mockCaptionParser;
      (processor as any).captionValidator = mockCaptionValidator;

      // Input: array of caption strings (not resources)
      const captionTexts: Array<string | undefined> = [
        'Caption A',
        'Caption B',
        'Caption C',
      ];

      const result = await (processor as any).processResourceCaptions(
        captionTexts,
        'image',
      );

      // Should recover and skip 'Caption B'
      expect(result.size).toBe(2);
      expect(result.get(0)).toEqual({ fullText: 'Caption A', num: 'A' });
      expect(result.get(2)).toEqual({ fullText: 'Caption C', num: 'C' });
      expect(result.has(1)).toBe(false); // Caption B was skipped

      // Verify warning was logged about length mismatch
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Caption parsing length mismatch'),
      );

      // Verify info log about successful recovery
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Successfully recovered'),
      );

      // Verify individual skip warning for Caption B
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Skipping'),
      );
    });

    test('should handle length match case without recovery', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      // Mock captionParser to return correct number of captions
      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([
          { fullText: 'Caption A', num: 'A' },
          { fullText: 'Caption B', num: 'B' },
        ]),
      };

      // Mock captionValidator to return all valid
      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([true, true]),
      };

      (processor as any).captionParser = mockCaptionParser;
      (processor as any).captionValidator = mockCaptionValidator;

      const captionTexts: Array<string | undefined> = [
        'Caption A',
        'Caption B',
      ];

      const result = await (processor as any).processResourceCaptions(
        captionTexts,
        'image',
      );

      // Should have both captions
      expect(result.size).toBe(2);
      expect(result.get(0)).toEqual({ fullText: 'Caption A', num: 'A' });
      expect(result.get(1)).toEqual({ fullText: 'Caption B', num: 'B' });

      // Should NOT log length mismatch warning
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('Caption parsing length mismatch'),
      );
    });

    test('should handle empty caption texts', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([]),
      };

      const mockCaptionValidator = {
        validateBatch: vi.fn(),
      };

      (processor as any).captionParser = mockCaptionParser;
      (processor as any).captionValidator = mockCaptionValidator;

      const result = await (processor as any).processResourceCaptions(
        [],
        'image',
      );

      expect(result.size).toBe(0);
      expect(mockCaptionParser.parseBatch).not.toHaveBeenCalled();
    });

    test('should handle caption with failed validations (fallback retry disabled)', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
        enableFallbackRetry: false,
      });

      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([
          { fullText: 'Caption A', num: 'A' },
          { fullText: 'Caption B', num: 'B' },
        ]),
      };

      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([true, false]),
      };

      (processor as any).captionParser = mockCaptionParser;
      (processor as any).captionValidator = mockCaptionValidator;

      const captionTexts: Array<string | undefined> = [
        'Caption A',
        'Caption B',
      ];

      const result = await (processor as any).processResourceCaptions(
        captionTexts,
        'image',
      );

      expect(result.size).toBe(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('failed validation'),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('fallback retry disabled'),
      );
      // Should NOT call parseBatch again for reparsing
      expect(mockCaptionParser.parseBatch).toHaveBeenCalledTimes(1);
    });

    test('should reparse failed captions with fallback model when enableFallbackRetry is true', async () => {
      const fallbackModel = { modelId: 'fallback-model' } as LanguageModel;
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: fallbackModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
        enableFallbackRetry: true,
      });

      // Mock for initial parsing
      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([
          { fullText: 'Caption A', num: 'A' },
          { fullText: 'Caption B', num: 'wrong-B' },
        ]),
      };

      // Mock for fallback reparsing (new CaptionParser instance)
      const mockFallbackParseBatch = vi.fn().mockResolvedValue([
        { fullText: 'Caption B', num: 'B' }, // Reparsed result
      ]);
      vi.mocked(CaptionParser).mockImplementation(function () {
        return {
          parseBatch: mockFallbackParseBatch,
        } as any;
      });

      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([true, false]), // B fails validation
      };

      (processor as any).captionParser = mockCaptionParser;
      (processor as any).captionValidator = mockCaptionValidator;

      const captionTexts: Array<string | undefined> = [
        'Caption A',
        'Caption B',
      ];

      const result = await (processor as any).processResourceCaptions(
        captionTexts,
        'image',
      );

      expect(result.size).toBe(2);
      // Initial parsing
      expect(mockCaptionParser.parseBatch).toHaveBeenCalledTimes(1);
      // Fallback reparsing with new CaptionParser instance
      expect(CaptionParser).toHaveBeenCalledWith(
        mockLogger,
        fallbackModel,
        { maxRetries: 3, componentName: 'CaptionParser-fallback' },
        undefined,
        expect.anything(),
      );
      expect(mockFallbackParseBatch).toHaveBeenCalledWith(['Caption B'], 0);
      // Result should have reparsed caption
      expect(result.get(1)).toEqual({ fullText: 'Caption B', num: 'B' });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Reparsing'),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Reparsed 1 image captions'),
      );
    });

    test('should not reparse when all validations pass', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
        enableFallbackRetry: true,
      });

      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([
          { fullText: 'Caption A', num: 'A' },
          { fullText: 'Caption B', num: 'B' },
        ]),
      };

      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([true, true]), // All pass
      };

      (processor as any).captionParser = mockCaptionParser;
      (processor as any).captionValidator = mockCaptionValidator;

      const captionTexts: Array<string | undefined> = [
        'Caption A',
        'Caption B',
      ];

      await (processor as any).processResourceCaptions(captionTexts, 'image');

      // Should only call parseBatch once (no reparsing needed)
      expect(mockCaptionParser.parseBatch).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Reparsing'),
      );
    });

    test('should reparse multiple failed captions', async () => {
      const fallbackModel = { modelId: 'fallback-model' } as LanguageModel;
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: fallbackModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
        enableFallbackRetry: true,
      });

      // Mock for initial parsing
      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([
          { fullText: 'Caption A', num: 'wrong-A' },
          { fullText: 'Caption B', num: 'B' },
          { fullText: 'Caption C', num: 'wrong-C' },
        ]),
      };

      // Mock for fallback reparsing (new CaptionParser instance)
      const mockFallbackParseBatch = vi.fn().mockResolvedValue([
        { fullText: 'Caption A', num: 'A' },
        { fullText: 'Caption C', num: 'C' },
      ]);
      vi.mocked(CaptionParser).mockImplementation(function () {
        return {
          parseBatch: mockFallbackParseBatch,
        } as any;
      });

      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([false, true, false]), // A and C fail
      };

      (processor as any).captionParser = mockCaptionParser;
      (processor as any).captionValidator = mockCaptionValidator;

      const captionTexts: Array<string | undefined> = [
        'Caption A',
        'Caption B',
        'Caption C',
      ];

      const result = await (processor as any).processResourceCaptions(
        captionTexts,
        'table',
      );

      expect(result.size).toBe(3);
      expect(mockCaptionParser.parseBatch).toHaveBeenCalledTimes(1);
      expect(mockFallbackParseBatch).toHaveBeenCalledWith(
        ['Caption A', 'Caption C'],
        0,
      );
      // Reparsed results should be updated
      expect(result.get(0)).toEqual({ fullText: 'Caption A', num: 'A' });
      expect(result.get(1)).toEqual({ fullText: 'Caption B', num: 'B' });
      expect(result.get(2)).toEqual({ fullText: 'Caption C', num: 'C' });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Reparsed 2 table captions'),
      );
    });
  });

  describe('extractCaptionText', () => {
    test('returns undefined when captions undefined', () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const result = (processor as any).extractCaptionText(undefined);
      expect(result).toBeUndefined();
    });

    test('returns undefined when captions empty array', () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const result = (processor as any).extractCaptionText([]);
      expect(result).toBeUndefined();
    });

    test('returns string caption when first element is string', () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const result = (processor as any).extractCaptionText(['Test Caption']);
      expect(result).toBe('Test Caption');
    });

    test('returns undefined when first element is ref and resolver not available', () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const result = (processor as any).extractCaptionText([
        { $ref: '#/texts/0' },
      ]);
      expect(result).toBeUndefined();
    });

    test('returns resolved text when resolver is available', () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockResolver = {
        resolveText: vi.fn().mockReturnValue({ text: 'Resolved Caption' }),
      };

      (processor as any).refResolver = mockResolver;

      const result = (processor as any).extractCaptionText([
        { $ref: '#/texts/0' },
      ]);
      expect(result).toBe('Resolved Caption');
      expect(mockResolver.resolveText).toHaveBeenCalledWith('#/texts/0');
    });

    test('returns undefined when ref resolution returns undefined', () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockResolver = {
        resolveText: vi.fn().mockReturnValue(undefined),
      };

      (processor as any).refResolver = mockResolver;

      const result = (processor as any).extractCaptionText([
        { $ref: '#/texts/0' },
      ]);
      expect(result).toBeUndefined();
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

  describe('convertImages edge cases', () => {
    test('handles image without prov property', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([]),
      };

      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([]),
      };

      (processor as any).captionParser = mockCaptionParser;
      (processor as any).captionValidator = mockCaptionValidator;
      (processor as any).idGenerator = {
        generateImageId: vi.fn(() => 'img-001'),
      };

      const mockDoc = {
        pictures: [
          {
            self_ref: '#/pictures/0',
            label: 'picture',
            // No prov property - should default to page 0
            children: [],
            captions: [],
          },
        ],
      } as unknown as DoclingDocument;

      const result = await (processor as any).convertImages(mockDoc, '/path');

      expect(result).toHaveLength(1);
      expect(result[0].pdfPageNo).toBe(0);
    });

    test('handles image with empty prov array', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([]),
      };

      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([]),
      };

      (processor as any).captionParser = mockCaptionParser;
      (processor as any).captionValidator = mockCaptionValidator;
      (processor as any).idGenerator = {
        generateImageId: vi.fn(() => 'img-001'),
      };

      const mockDoc = {
        pictures: [
          {
            self_ref: '#/pictures/0',
            label: 'picture',
            prov: [], // Empty prov array
            children: [],
            captions: [],
          },
        ],
      } as unknown as DoclingDocument;

      const result = await (processor as any).convertImages(mockDoc, '/path');

      expect(result).toHaveLength(1);
      expect(result[0].pdfPageNo).toBe(0);
    });

    test('handles image when idGenerator is undefined', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([]),
      };

      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([]),
      };

      (processor as any).captionParser = mockCaptionParser;
      (processor as any).captionValidator = mockCaptionValidator;
      // Explicitly set idGenerator to undefined
      (processor as any).idGenerator = undefined;

      const mockDoc = {
        pictures: [
          {
            self_ref: '#/pictures/0',
            label: 'picture',
            prov: [{ page_no: 1 }],
            children: [],
            captions: [],
          },
        ],
      } as unknown as DoclingDocument;

      const result = await (processor as any).convertImages(mockDoc, '/path');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('img-1'); // Falls back to `img-${images.length + 1}`
    });
  });

  describe('convertImages with real image data', () => {
    test('processes images with captions', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockCaptionParser = {
        parseBatch: vi
          .fn()
          .mockResolvedValue([
            { fullText: 'Figure 1: Test image', num: 'Figure 1' },
          ]),
      };

      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([true]),
      };

      (processor as any).captionParser = mockCaptionParser;
      (processor as any).captionValidator = mockCaptionValidator;
      (processor as any).idGenerator = {
        generateImageId: vi.fn(() => 'img-001'),
      };

      const mockDoc = {
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
        pictures: [
          {
            self_ref: '#/pictures/0',
            label: 'picture',
            prov: [
              {
                page_no: 1,
                bbox: { l: 0, t: 0, r: 100, b: 100, coord_origin: 'TOPLEFT' },
                charspan: [0, 0],
              },
            ],
            children: [],
            content_layer: 'body',
            captions: ['Figure 1: Test image'],
            references: [],
            footnotes: [],
            annotations: [],
          },
        ],
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
      } as unknown as DoclingDocument;

      const result = await (processor as any).convertImages(mockDoc, '/path');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('img-001');
      expect(result[0].caption?.fullText).toBe('Figure 1: Test image');
    });
  });

  describe('convertTables edge cases', () => {
    test('handles table without prov property', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([]),
      };

      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([]),
      };

      (processor as any).captionParser = mockCaptionParser;
      (processor as any).captionValidator = mockCaptionValidator;
      (processor as any).idGenerator = {
        generateTableId: vi.fn(() => 'tbl-001'),
      };

      const mockDoc = {
        tables: [
          {
            self_ref: '#/tables/0',
            label: 'table',
            // No prov property - should default to page 0
            data: {
              num_rows: 1,
              num_cols: 1,
              grid: [[{ text: 'Cell' }]],
            },
          },
        ],
      } as unknown as DoclingDocument;

      const result = await (processor as any).convertTables(mockDoc);

      expect(result).toHaveLength(1);
      expect(result[0].pdfPageNo).toBe(0);
    });

    test('handles table with empty prov array', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([]),
      };

      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([]),
      };

      (processor as any).captionParser = mockCaptionParser;
      (processor as any).captionValidator = mockCaptionValidator;
      (processor as any).idGenerator = {
        generateTableId: vi.fn(() => 'tbl-001'),
      };

      const mockDoc = {
        tables: [
          {
            self_ref: '#/tables/0',
            label: 'table',
            prov: [], // Empty prov array
            data: {
              num_rows: 1,
              num_cols: 1,
              grid: [[{ text: 'Cell' }]],
            },
          },
        ],
      } as unknown as DoclingDocument;

      const result = await (processor as any).convertTables(mockDoc);

      expect(result).toHaveLength(1);
      expect(result[0].pdfPageNo).toBe(0);
    });

    test('handles table when idGenerator is undefined', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([]),
      };

      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([]),
      };

      (processor as any).captionParser = mockCaptionParser;
      (processor as any).captionValidator = mockCaptionValidator;
      // Explicitly set idGenerator to undefined
      (processor as any).idGenerator = undefined;

      const mockDoc = {
        tables: [
          {
            self_ref: '#/tables/0',
            label: 'table',
            prov: [{ page_no: 1 }],
            data: {
              num_rows: 1,
              num_cols: 1,
              grid: [[{ text: 'Cell' }]],
            },
          },
        ],
      } as unknown as DoclingDocument;

      const result = await (processor as any).convertTables(mockDoc);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('tbl-1'); // Falls back to `tbl-${tables.length + 1}`
    });

    test('handles table with empty grid', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([]),
      };

      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([]),
      };

      (processor as any).captionParser = mockCaptionParser;
      (processor as any).captionValidator = mockCaptionValidator;
      (processor as any).idGenerator = {
        generateTableId: vi.fn(() => 'tbl-001'),
      };

      const mockDoc = {
        tables: [
          {
            self_ref: '#/tables/0',
            label: 'table',
            prov: [{ page_no: 1 }],
            data: {
              num_rows: 0,
              num_cols: 0,
              grid: [], // Empty grid
            },
          },
        ],
      } as unknown as DoclingDocument;

      const result = await (processor as any).convertTables(mockDoc);

      expect(result).toHaveLength(1);
      expect(result[0].numRows).toBe(0);
      expect(result[0].numCols).toBe(0); // grid[0]?.length ?? 0 => 0
    });
  });

  describe('convertTables with real table data', () => {
    test('processes tables with captions and grid', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockCaptionParser = {
        parseBatch: vi
          .fn()
          .mockResolvedValue([
            { fullText: 'Table 1: Data summary', num: 'Table 1' },
          ]),
      };

      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([true]),
      };

      (processor as any).captionParser = mockCaptionParser;
      (processor as any).captionValidator = mockCaptionValidator;
      (processor as any).idGenerator = {
        generateTableId: vi.fn(() => 'tbl-001'),
      };

      const mockDoc = {
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
        tables: [
          {
            self_ref: '#/tables/0',
            label: 'table',
            prov: [
              {
                page_no: 2,
                bbox: { l: 0, t: 0, r: 500, b: 200, coord_origin: 'TOPLEFT' },
                charspan: [0, 0],
              },
            ],
            children: [],
            content_layer: 'body',
            captions: ['Table 1: Data summary'],
            references: [],
            footnotes: [],
            data: {
              table_cells: [],
              num_rows: 2,
              num_cols: 2,
              grid: [
                [
                  { text: 'Header 1', column_header: true },
                  { text: 'Header 2', column_header: true },
                ],
                [{ text: 'Row 1 Col 1' }, { text: 'Row 1 Col 2' }],
              ],
            },
          },
        ],
        groups: [],
        body: {
          name: '_root_',
          label: 'unspecified',
          self_ref: '#/body',
          children: [],
          content_layer: 'body',
        },
        pages: {},
      } as unknown as DoclingDocument;

      const result = await (processor as any).convertTables(mockDoc);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('tbl-001');
      expect(result[0].numRows).toBe(2);
      expect(result[0].numCols).toBe(2);
      expect(result[0].caption?.fullText).toBe('Table 1: Data summary');
      expect(result[0].grid).toHaveLength(2);
    });
  });

  describe('processResourceCaptions - Recovery error handling', () => {
    test('should handle length mismatch with successful recovery', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      // Mock parseBatch to return captions with only some matched
      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([
          { fullText: 'Caption A', num: 'A' },
          { fullText: 'Caption B', num: 'B' },
        ]),
      };

      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([true, true]),
      };

      (processor as any).captionParser = mockCaptionParser;
      (processor as any).captionValidator = mockCaptionValidator;

      const captionTexts = ['Caption A', 'Caption B'];

      // This should succeed through recovery path
      const result = await (processor as any).processResourceCaptions(
        captionTexts,
        'image',
      );

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
    });
  });

  describe('extractTableOfContents - TOC validation', () => {
    test('should continue with rule-based extraction when TOC content validation passes', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockTocFinder = {
        find: vi.fn().mockReturnValue({
          startPage: 1,
          endPage: 2,
          itemRefs: ['#/texts/0'],
        }),
      };

      const mockTocContentValidator = {
        validate: vi.fn().mockResolvedValue({
          isValid: true,
          confidence: 0.9,
          contentType: 'pure_toc',
          validTocMarkdown: '- Chapter 1 ..... 1',
          reason: 'Content appears to be a table of contents',
        }),
        isValid: vi.fn().mockReturnValue(true),
        getValidMarkdown: vi.fn().mockReturnValue('- Chapter 1 ..... 1'),
      };

      const mockTocExtractor = {
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

      const mockVisionTocExtractor = {
        extract: vi.fn().mockResolvedValue(null),
      };

      const mockRefResolver = {
        resolve: vi.fn().mockImplementation((ref: string) => {
          if (ref === '#/groups/0') {
            return {
              name: 'list',
              label: 'list',
              self_ref: '#/groups/0',
              children: [{ $ref: '#/texts/0' }],
            };
          }
          // Return text item for child refs - must have 'text' and 'orig' properties
          return {
            text: 'Chapter 1 ..... 1',
            orig: 'Chapter 1 ..... 1',
            label: 'text',
            self_ref: '#/texts/0',
          };
        }),
        resolveText: vi.fn().mockReturnValue({
          text: 'Chapter 1 ..... 1',
          orig: 'Chapter 1 ..... 1',
          label: 'text',
        }),
      };

      (processor as any).tocFinder = mockTocFinder;
      (processor as any).tocContentValidator = mockTocContentValidator;
      (processor as any).tocExtractor = mockTocExtractor;
      (processor as any).visionTocExtractor = mockVisionTocExtractor;
      (processor as any).refResolver = mockRefResolver;
      (processor as any).usageAggregator = {
        track: vi.fn(),
        reset: vi.fn(),
        logSummary: vi.fn(),
      };

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
        pages: { '1': {} as any, '2': {} as any },
      } as DoclingDocument;

      const result = await (processor as any).extractTableOfContents(
        mockDoc,
        [],
      );

      expect(mockTocContentValidator.validate).toHaveBeenCalled();
      expect(mockTocContentValidator.isValid).toHaveBeenCalled();
      expect(mockTocExtractor.extract).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Chapter 1');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('TOC validation passed'),
      );
    });

    test('should use vision fallback when TOC content validation fails', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockTocFinder = {
        find: vi.fn().mockReturnValue({
          startPage: 1,
          endPage: 2,
          itemRefs: [{ $ref: '#/texts/0' }],
        }),
      };

      const mockTocContentValidator = {
        validate: vi.fn().mockResolvedValue({
          isValid: false,
          confidence: 0.3,
          contentType: 'resource_only',
          validTocMarkdown: null,
          reason: 'Content does not appear to be a table of contents',
        }),
        isValid: vi.fn().mockReturnValue(false),
        getValidMarkdown: vi.fn().mockReturnValue(null),
      };

      const mockTocExtractor = {
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

      const mockVisionTocExtractor = {
        extract: vi.fn().mockResolvedValue('- Chapter 1 ..... 1'),
      };

      const mockRefResolver = {
        resolve: vi.fn().mockReturnValue({
          label: 'text',
          text: '목차 - Chapter 1 ..... 1',
        }),
        resolveText: vi.fn().mockReturnValue({ text: 'test content' }),
      };

      (processor as any).tocFinder = mockTocFinder;
      (processor as any).tocContentValidator = mockTocContentValidator;
      (processor as any).tocExtractor = mockTocExtractor;
      (processor as any).visionTocExtractor = mockVisionTocExtractor;
      (processor as any).refResolver = mockRefResolver;
      (processor as any).usageAggregator = {
        track: vi.fn(),
        reset: vi.fn(),
        logSummary: vi.fn(),
      };

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
        pages: { '1': {} as any, '2': {} as any },
      } as DoclingDocument;

      const result = await (processor as any).extractTableOfContents(
        mockDoc,
        [],
      );

      expect(mockTocContentValidator.validate).toHaveBeenCalled();
      expect(mockTocContentValidator.isValid).toHaveBeenCalled();
      expect(mockVisionTocExtractor.extract).toHaveBeenCalledWith(2);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Chapter 1');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('TOC validation failed'),
      );
    });

    test('should log mixed TOC message when contentType is mixed', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockTocFinder = {
        find: vi.fn().mockReturnValue({
          startPage: 1,
          endPage: 2,
          itemRefs: ['#/texts/0'],
        }),
      };

      const extractedToc = '제1장 서론 ..... 1\n제2장 조사개요 ..... 5';
      const mockTocContentValidator = {
        validate: vi.fn().mockResolvedValue({
          isValid: true,
          confidence: 0.85,
          contentType: 'mixed',
          validTocMarkdown: extractedToc,
          reason: 'Contains both main TOC and photo index',
        }),
        isValid: vi.fn().mockReturnValue(true),
        getValidMarkdown: vi.fn().mockReturnValue(extractedToc),
      };

      const mockTocExtractor = {
        extract: vi.fn().mockResolvedValue({
          entries: [
            { title: '제1장 서론', level: 1, pageNo: 1 },
            { title: '제2장 조사개요', level: 1, pageNo: 5 },
          ],
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

      const mockVisionTocExtractor = {
        extract: vi.fn().mockResolvedValue(null),
      };

      const mockRefResolver = {
        resolve: vi.fn().mockImplementation((ref: string) => {
          if (ref === '#/groups/0') {
            return {
              name: 'list',
              label: 'list',
              self_ref: '#/groups/0',
              children: [{ $ref: '#/texts/0' }],
            };
          }
          return {
            text: '제1장 서론 ..... 1',
            orig: '제1장 서론 ..... 1',
            label: 'text',
            self_ref: '#/texts/0',
          };
        }),
        resolveText: vi.fn().mockReturnValue({
          text: '제1장 서론 ..... 1',
          orig: '제1장 서론 ..... 1',
          label: 'text',
        }),
      };

      (processor as any).tocFinder = mockTocFinder;
      (processor as any).tocContentValidator = mockTocContentValidator;
      (processor as any).tocExtractor = mockTocExtractor;
      (processor as any).visionTocExtractor = mockVisionTocExtractor;
      (processor as any).refResolver = mockRefResolver;
      (processor as any).usageAggregator = {
        track: vi.fn(),
        reset: vi.fn(),
        logSummary: vi.fn(),
      };

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
        pages: { '1': {} as any, '2': {} as any },
      } as DoclingDocument;

      const result = await (processor as any).extractTableOfContents(
        mockDoc,
        [],
      );

      expect(mockTocContentValidator.validate).toHaveBeenCalled();
      expect(mockTocContentValidator.getValidMarkdown).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Mixed TOC detected'),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('TOC validation passed'),
      );
    });

    test('should use vision fallback when isValid is true but getValidMarkdown returns null', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockTocFinder = {
        find: vi.fn().mockReturnValue({
          startPage: 1,
          endPage: 2,
          itemRefs: ['#/texts/0'],
        }),
      };

      const mockTocContentValidator = {
        validate: vi.fn().mockResolvedValue({
          isValid: true,
          confidence: 0.5,
          contentType: 'pure_toc',
          validTocMarkdown: null,
          reason: 'Low confidence TOC',
        }),
        isValid: vi.fn().mockReturnValue(true),
        getValidMarkdown: vi.fn().mockReturnValue(null),
      };

      const mockTocExtractor = {
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

      const mockVisionTocExtractor = {
        extract: vi.fn().mockResolvedValue('- Chapter 1 ..... 1'),
      };

      const mockRefResolver = {
        resolve: vi.fn().mockReturnValue({
          label: 'text',
          text: '목차 - Chapter 1 ..... 1',
        }),
        resolveText: vi.fn().mockReturnValue({ text: 'test content' }),
      };

      (processor as any).tocFinder = mockTocFinder;
      (processor as any).tocContentValidator = mockTocContentValidator;
      (processor as any).tocExtractor = mockTocExtractor;
      (processor as any).visionTocExtractor = mockVisionTocExtractor;
      (processor as any).refResolver = mockRefResolver;
      (processor as any).usageAggregator = {
        track: vi.fn(),
        reset: vi.fn(),
        logSummary: vi.fn(),
      };

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
        pages: { '1': {} as any, '2': {} as any },
      } as DoclingDocument;

      const result = await (processor as any).extractTableOfContents(
        mockDoc,
        [],
      );

      expect(mockTocContentValidator.validate).toHaveBeenCalled();
      expect(mockTocContentValidator.isValid).toHaveBeenCalled();
      expect(mockTocContentValidator.getValidMarkdown).toHaveBeenCalled();
      expect(mockVisionTocExtractor.extract).toHaveBeenCalledWith(2);
      expect(result).toHaveLength(1);
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

  describe('extractTableOfContents - Vision fallback', () => {
    test('should throw error when non-TocNotFoundError is thrown from tocFinder', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const testError = new Error('Unexpected error');
      const mockTocFinder = {
        find: vi.fn().mockImplementation(() => {
          throw testError;
        }),
      };

      (processor as any).tocFinder = mockTocFinder;
      (processor as any).usageAggregator = {
        track: vi.fn(),
        reset: vi.fn(),
        logSummary: vi.fn(),
      };

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
        pages: { '1': {} as any },
      } as DoclingDocument;

      await expect(
        (processor as any).extractTableOfContents(mockDoc, []),
      ).rejects.toThrow(testError);
    });

    test('should use vision fallback when rule-based extraction fails', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockTocFinder = {
        find: vi.fn().mockImplementation(() => {
          throw new TocNotFoundError('TOC not found');
        }),
      };

      const mockTocExtractor = {
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

      const mockVisionTocExtractor = {
        extract: vi.fn().mockResolvedValue('- Chapter 1 ..... 1'),
      };

      (processor as any).tocFinder = mockTocFinder;
      (processor as any).tocExtractor = mockTocExtractor;
      (processor as any).visionTocExtractor = mockVisionTocExtractor;
      (processor as any).usageAggregator = {
        track: vi.fn(),
        reset: vi.fn(),
        logSummary: vi.fn(),
      };

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
        pages: { '1': {} as any },
      } as DoclingDocument;

      const result = await (processor as any).extractTableOfContents(
        mockDoc,
        [],
      );

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Chapter 1');
      expect(mockVisionTocExtractor.extract).toHaveBeenCalledWith(1);
    });

    test('should throw TocNotFoundError when vision fallback also fails', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockTocFinder = {
        find: vi.fn().mockImplementation(() => {
          throw new TocNotFoundError('TOC not found');
        }),
      };

      const mockVisionTocExtractor = {
        extract: vi.fn().mockResolvedValue(null),
      };

      (processor as any).tocFinder = mockTocFinder;
      (processor as any).visionTocExtractor = mockVisionTocExtractor;
      (processor as any).usageAggregator = {
        track: vi.fn(),
        reset: vi.fn(),
        logSummary: vi.fn(),
      };

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
        pages: { '1': {} as any },
      } as DoclingDocument;

      await expect(
        (processor as any).extractTableOfContents(mockDoc, []),
      ).rejects.toThrow(TocNotFoundError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Both rule-based search and vision fallback failed to locate TOC',
        ),
      );
    });

    test('should throw TocNotFoundError when LLM extracts 0 entries', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockTocFinder = {
        find: vi.fn().mockImplementation(() => {
          throw new TocNotFoundError('TOC not found');
        }),
      };

      const mockTocExtractor = {
        extract: vi.fn().mockResolvedValue({
          entries: [],
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

      const mockVisionTocExtractor = {
        extract: vi.fn().mockResolvedValue('- Some markdown content'),
      };

      (processor as any).tocFinder = mockTocFinder;
      (processor as any).tocExtractor = mockTocExtractor;
      (processor as any).visionTocExtractor = mockVisionTocExtractor;
      (processor as any).usageAggregator = {
        track: vi.fn(),
        reset: vi.fn(),
        logSummary: vi.fn(),
      };

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
        pages: { '1': {} as any },
      } as DoclingDocument;

      await expect(
        (processor as any).extractTableOfContents(mockDoc, []),
      ).rejects.toThrow(TocNotFoundError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'TOC area was detected but LLM could not extract any structured entries',
        ),
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

  describe('convertFootnotes', () => {
    test('should convert valid footnotes', async () => {
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
            text: 'This is a footnote',
            label: 'footnote',
            prov: [{ page_no: 3 }],
          },
          {
            text: 'Another footnote',
            label: 'footnote',
            prov: [{ page_no: 5 }],
          },
          {
            text: 'Regular text',
            label: 'text',
            prov: [{ page_no: 1 }],
          },
        ],
      } as unknown as DoclingDocument;

      const result = (processor as any).convertFootnotes(mockDoc);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('ftn-001');
      expect(result[0].text).toBe('This is a footnote');
      expect(result[0].pdfPageNo).toBe(3);
      expect(result[1].pdfPageNo).toBe(5);
    });

    test('should skip invalid footnotes', async () => {
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
            text: 'Valid footnote',
            label: 'footnote',
            prov: [{ page_no: 1 }],
          },
          {
            text: '123', // Invalid: numbers only
            label: 'footnote',
            prov: [{ page_no: 2 }],
          },
          {
            text: '', // Invalid: empty
            label: 'footnote',
            prov: [{ page_no: 3 }],
          },
        ],
      } as unknown as DoclingDocument;

      const result = (processor as any).convertFootnotes(mockDoc);

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Valid footnote');
    });

    test('should default to page 1 when prov is missing', async () => {
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
            text: 'Footnote without prov',
            label: 'footnote',
            // No prov property
          },
          {
            text: 'Footnote with empty prov',
            label: 'footnote',
            prov: [], // Empty prov array
          },
        ],
      } as unknown as DoclingDocument;

      const result = (processor as any).convertFootnotes(mockDoc);

      expect(result).toHaveLength(2);
      expect(result[0].pdfPageNo).toBe(1);
      expect(result[1].pdfPageNo).toBe(1);
    });

    test('should return empty array when no footnotes exist', async () => {
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
            text: 'Regular text',
            label: 'text',
            prov: [{ page_no: 1 }],
          },
        ],
      } as unknown as DoclingDocument;

      const result = (processor as any).convertFootnotes(mockDoc);

      expect(result).toHaveLength(0);
    });
  });

  describe('assessHanjaQuality', () => {
    test('should create HanjaQualitySampler and return assessment result', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockAssessment = {
        needsVlmReparse: false,
        hanjaRole: 'none' as const,
        hanjaPageCount: 0,
        sampledPageCount: 0,
        reason: 'No Hanja characters found in sampled pages',
      };

      mockAssess.mockResolvedValueOnce(mockAssessment);

      const mockDoc = {
        texts: [],
        pages: {},
        pictures: [],
        tables: [],
      } as unknown as DoclingDocument;

      const result = await processor.assessHanjaQuality(
        mockDoc,
        '/output/path',
      );

      expect(result).toEqual(mockAssessment);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[DocumentProcessor] Starting Hanja quality assessment...',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Hanja assessment: hanjaRole=none'),
      );
    });

    test('should pass fallbackModel when enableFallbackRetry is true', async () => {
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
        enableFallbackRetry: true,
      });

      mockAssess.mockResolvedValueOnce({
        needsVlmReparse: false,
        hanjaRole: 'none' as const,
        hanjaPageCount: 0,
        sampledPageCount: 0,
        reason: 'No Hanja characters found in sampled pages',
      });

      const mockDoc = {
        texts: [],
        pages: {},
        pictures: [],
        tables: [],
      } as unknown as DoclingDocument;

      await processor.assessHanjaQuality(mockDoc, '/output/path');

      expect(mockAssess).toHaveBeenCalled();
    });

    test('should pass hanjaQualitySamplerModel to sampler', async () => {
      const hanjaModel = { modelId: 'hanja-model' } as LanguageModel;
      const processor = new DocumentProcessor({
        logger: mockLogger,
        fallbackModel: mockModel,
        hanjaQualitySamplerModel: hanjaModel,
        textCleanerBatchSize: 10,
        captionParserBatchSize: 5,
        captionValidatorBatchSize: 5,
      });

      const mockAssessment = {
        needsVlmReparse: true,
        hanjaRole: 'essential' as const,
        hanjaPageCount: 5,
        sampledPageCount: 3,
        reason:
          '1/1 sampled pages contain essential Hanja (mixed Korean-Hanja text)',
      };

      mockAssess.mockResolvedValueOnce(mockAssessment);

      const mockDoc = {
        texts: [],
        pages: {},
        pictures: [],
        tables: [],
      } as unknown as DoclingDocument;

      const result = await processor.assessHanjaQuality(
        mockDoc,
        '/output/path',
      );

      expect(result.needsVlmReparse).toBe(true);
      expect(result.hanjaRole).toBe('essential');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('needsVlmReparse=true'),
      );
    });
  });
});
