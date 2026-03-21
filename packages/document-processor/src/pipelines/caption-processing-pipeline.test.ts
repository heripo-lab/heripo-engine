import type { LoggerMethods } from '@heripo/logger';
import type { LanguageModel } from 'ai';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { CaptionParser } from '../parsers/caption-parser';
import {
  CaptionProcessingPipeline,
  type CaptionProcessingPipelineDeps,
} from './caption-processing-pipeline';

// Mock CaptionParser for fallback reparse tests
vi.mock('../parsers/caption-parser.js', () => ({
  CaptionParser: vi.fn(),
}));

describe('CaptionProcessingPipeline', () => {
  let mockLogger: LoggerMethods;
  let mockModel: LanguageModel;

  function createPipeline(
    overrides: Partial<CaptionProcessingPipelineDeps> = {},
  ): CaptionProcessingPipeline {
    return new CaptionProcessingPipeline({
      logger: mockLogger,
      captionParser: { parseBatch: vi.fn().mockResolvedValue([]) } as any,
      captionValidator: {
        validateBatch: vi.fn().mockResolvedValue([]),
      } as any,
      fallbackModel: mockModel,
      enableFallbackRetry: false,
      maxRetries: 3,
      captionParserBatchSize: 5,
      captionValidatorBatchSize: 5,
      usageAggregator: { track: vi.fn() } as any,
      ...overrides,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    mockModel = { modelId: 'test-model' } as LanguageModel;
  });

  describe('processResourceCaptions', () => {
    test('should return empty map for empty caption texts', async () => {
      const pipeline = createPipeline();

      const result = await pipeline.processResourceCaptions([], 'image');

      expect(result.size).toBe(0);
    });

    test('should skip undefined caption texts', async () => {
      const mockCaptionParser = {
        parseBatch: vi
          .fn()
          .mockResolvedValue([{ fullText: 'Caption A', num: 'A' }]),
      };
      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([true]),
      };

      const pipeline = createPipeline({
        captionParser: mockCaptionParser as any,
        captionValidator: mockCaptionValidator as any,
      });

      const result = await pipeline.processResourceCaptions(
        [undefined, 'Caption A', undefined],
        'image',
      );

      expect(result.size).toBe(1);
      expect(result.get(1)).toEqual({ fullText: 'Caption A', num: 'A' });
      expect(mockCaptionParser.parseBatch).toHaveBeenCalledWith(
        ['Caption A'],
        5,
      );
    });

    test('should parse and validate captions successfully', async () => {
      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([
          { fullText: 'Caption A', num: '1' },
          { fullText: 'Caption B', num: '2' },
        ]),
      };
      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([true, true]),
      };

      const pipeline = createPipeline({
        captionParser: mockCaptionParser as any,
        captionValidator: mockCaptionValidator as any,
      });

      const result = await pipeline.processResourceCaptions(
        ['Caption A', 'Caption B'],
        'table',
      );

      expect(result.size).toBe(2);
      expect(result.get(0)).toEqual({ fullText: 'Caption A', num: '1' });
      expect(result.get(1)).toEqual({ fullText: 'Caption B', num: '2' });
    });

    test('should recover from length mismatch by matching fullText', async () => {
      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([
          { fullText: 'Caption A', num: 'A' },
          { fullText: 'Caption C', num: 'C' },
        ]),
      };
      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([true, true]),
      };

      const pipeline = createPipeline({
        captionParser: mockCaptionParser as any,
        captionValidator: mockCaptionValidator as any,
      });

      const result = await pipeline.processResourceCaptions(
        ['Caption A', 'Caption B', 'Caption C'],
        'image',
      );

      expect(result.size).toBe(2);
      expect(result.get(0)).toEqual({ fullText: 'Caption A', num: 'A' });
      expect(result.get(2)).toEqual({ fullText: 'Caption C', num: 'C' });
      expect(result.has(1)).toBe(false);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Caption parsing length mismatch'),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Skipping image caption at index 1'),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Successfully recovered 2 image captions'),
      );
    });

    test('should warn about failed validations when fallback retry disabled', async () => {
      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([
          { fullText: 'Caption A', num: 'A' },
          { fullText: 'Caption B', num: 'wrong' },
        ]),
      };
      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([true, false]),
      };

      const pipeline = createPipeline({
        captionParser: mockCaptionParser as any,
        captionValidator: mockCaptionValidator as any,
        enableFallbackRetry: false,
      });

      const result = await pipeline.processResourceCaptions(
        ['Caption A', 'Caption B'],
        'image',
      );

      expect(result.size).toBe(2);
      // Original (invalid) caption kept as-is
      expect(result.get(1)).toEqual({
        fullText: 'Caption B',
        num: 'wrong',
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid image caption [1]'),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('fallback retry disabled'),
      );
    });

    test('should reparse failed captions with fallback model when enabled', async () => {
      const fallbackModel = { modelId: 'fallback' } as LanguageModel;

      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([
          { fullText: 'Caption A', num: 'A' },
          { fullText: 'Caption B', num: 'wrong-B' },
        ]),
      };
      const mockFallbackParseBatch = vi
        .fn()
        .mockResolvedValue([{ fullText: 'Caption B', num: 'B' }]);
      vi.mocked(CaptionParser).mockImplementation(function () {
        return { parseBatch: mockFallbackParseBatch } as any;
      });
      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([true, false]),
      };

      const pipeline = createPipeline({
        captionParser: mockCaptionParser as any,
        captionValidator: mockCaptionValidator as any,
        fallbackModel,
        enableFallbackRetry: true,
      });

      const result = await pipeline.processResourceCaptions(
        ['Caption A', 'Caption B'],
        'image',
      );

      expect(result.size).toBe(2);
      expect(result.get(1)).toEqual({ fullText: 'Caption B', num: 'B' });
      expect(CaptionParser).toHaveBeenCalledWith(
        mockLogger,
        fallbackModel,
        { maxRetries: 3, componentName: 'CaptionParser-fallback' },
        undefined,
        expect.anything(),
      );
      expect(mockFallbackParseBatch).toHaveBeenCalledWith(['Caption B'], 0);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Reparsed 1 image captions'),
      );
    });

    test('should reparse multiple failed captions', async () => {
      const fallbackModel = { modelId: 'fallback' } as LanguageModel;

      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([
          { fullText: 'Caption A', num: 'wrong-A' },
          { fullText: 'Caption B', num: 'B' },
          { fullText: 'Caption C', num: 'wrong-C' },
        ]),
      };
      const mockFallbackParseBatch = vi.fn().mockResolvedValue([
        { fullText: 'Caption A', num: 'A' },
        { fullText: 'Caption C', num: 'C' },
      ]);
      vi.mocked(CaptionParser).mockImplementation(function () {
        return { parseBatch: mockFallbackParseBatch } as any;
      });
      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([false, true, false]),
      };

      const pipeline = createPipeline({
        captionParser: mockCaptionParser as any,
        captionValidator: mockCaptionValidator as any,
        fallbackModel,
        enableFallbackRetry: true,
      });

      const result = await pipeline.processResourceCaptions(
        ['Caption A', 'Caption B', 'Caption C'],
        'table',
      );

      expect(result.size).toBe(3);
      expect(result.get(0)).toEqual({ fullText: 'Caption A', num: 'A' });
      expect(result.get(1)).toEqual({ fullText: 'Caption B', num: 'B' });
      expect(result.get(2)).toEqual({ fullText: 'Caption C', num: 'C' });
      expect(mockFallbackParseBatch).toHaveBeenCalledWith(
        ['Caption A', 'Caption C'],
        0,
      );
    });

    test('should not reparse when all validations pass', async () => {
      const mockCaptionParser = {
        parseBatch: vi
          .fn()
          .mockResolvedValue([{ fullText: 'Caption A', num: 'A' }]),
      };
      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([true]),
      };

      const pipeline = createPipeline({
        captionParser: mockCaptionParser as any,
        captionValidator: mockCaptionValidator as any,
        enableFallbackRetry: true,
      });

      await pipeline.processResourceCaptions(['Caption A'], 'image');

      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Reparsing'),
      );
    });

    test('should pass abortSignal to fallback CaptionParser', async () => {
      const abortSignal = new AbortController().signal;
      const fallbackModel = { modelId: 'fallback' } as LanguageModel;

      const mockCaptionParser = {
        parseBatch: vi
          .fn()
          .mockResolvedValue([{ fullText: 'Caption A', num: 'wrong' }]),
      };
      vi.mocked(CaptionParser).mockImplementation(function () {
        return {
          parseBatch: vi
            .fn()
            .mockResolvedValue([{ fullText: 'Caption A', num: 'A' }]),
        } as any;
      });
      const mockCaptionValidator = {
        validateBatch: vi.fn().mockResolvedValue([false]),
      };

      const pipeline = createPipeline({
        captionParser: mockCaptionParser as any,
        captionValidator: mockCaptionValidator as any,
        fallbackModel,
        enableFallbackRetry: true,
        abortSignal,
      });

      await pipeline.processResourceCaptions(['Caption A'], 'image');

      expect(CaptionParser).toHaveBeenCalledWith(
        mockLogger,
        fallbackModel,
        {
          maxRetries: 3,
          componentName: 'CaptionParser-fallback',
          abortSignal,
        },
        undefined,
        expect.anything(),
      );
    });

    test('should not call parseBatch when all captions are undefined', async () => {
      const mockCaptionParser = {
        parseBatch: vi.fn(),
      };

      const pipeline = createPipeline({
        captionParser: mockCaptionParser as any,
      });

      const result = await pipeline.processResourceCaptions(
        [undefined, undefined],
        'image',
      );

      expect(result.size).toBe(0);
      expect(mockCaptionParser.parseBatch).not.toHaveBeenCalled();
    });

    test('should not call validateBatch when no captions parsed', async () => {
      const mockCaptionParser = {
        parseBatch: vi.fn().mockResolvedValue([]),
      };
      const mockCaptionValidator = {
        validateBatch: vi.fn(),
      };

      const pipeline = createPipeline({
        captionParser: mockCaptionParser as any,
        captionValidator: mockCaptionValidator as any,
      });

      await pipeline.processResourceCaptions([], 'image');

      expect(mockCaptionValidator.validateBatch).not.toHaveBeenCalled();
    });
  });

  describe('extractCaptionText', () => {
    test('should return undefined for undefined captions', () => {
      const pipeline = createPipeline();
      expect(pipeline.extractCaptionText(undefined)).toBeUndefined();
    });

    test('should return undefined for empty array', () => {
      const pipeline = createPipeline();
      expect(pipeline.extractCaptionText([])).toBeUndefined();
    });

    test('should return string caption directly', () => {
      const pipeline = createPipeline();
      expect(pipeline.extractCaptionText(['Test Caption'])).toBe(
        'Test Caption',
      );
    });

    test('should return undefined for $ref when resolver not available', () => {
      const pipeline = createPipeline();
      expect(
        pipeline.extractCaptionText([{ $ref: '#/texts/0' }]),
      ).toBeUndefined();
    });

    test('should resolve $ref when resolver is available', () => {
      const mockResolver = {
        resolveText: vi.fn().mockReturnValue({ text: 'Resolved Caption' }),
      };

      const pipeline = createPipeline({
        refResolver: mockResolver as any,
      });

      expect(pipeline.extractCaptionText([{ $ref: '#/texts/0' }])).toBe(
        'Resolved Caption',
      );
      expect(mockResolver.resolveText).toHaveBeenCalledWith('#/texts/0');
    });

    test('should return undefined when ref resolution returns undefined', () => {
      const mockResolver = {
        resolveText: vi.fn().mockReturnValue(undefined),
      };

      const pipeline = createPipeline({
        refResolver: mockResolver as any,
      });

      expect(
        pipeline.extractCaptionText([{ $ref: '#/texts/0' }]),
      ).toBeUndefined();
    });
  });
});
