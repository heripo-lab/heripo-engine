import {
  BatchProcessor,
  LLMCaller,
  LLMTokenUsageAggregator,
} from '@heripo/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { CaptionParseError, CaptionParser } from './caption-parser';

// Mock LLM dependencies
vi.mock('@heripo/shared', () => ({
  BatchProcessor: {
    processBatch: vi.fn(),
  },
  LLMCaller: {
    call: vi.fn(),
  },
  LLMTokenUsageAggregator: vi.fn(() => ({
    reset: vi.fn(),
    track: vi.fn(),
    logSummary: vi.fn(),
    getByComponent: vi.fn(() => []),
    getTotalUsage: vi.fn(() => ({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    })),
  })),
}));

describe('CaptionParser', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  const mockModel = { id: 'test-model' } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    test('should initialize with required parameters', () => {
      const parser = new CaptionParser(mockLogger, mockModel);
      expect(parser).toBeDefined();
      expect(LLMTokenUsageAggregator).toHaveBeenCalled();
    });

    test('should use default options when not provided', () => {
      new CaptionParser(mockLogger, mockModel);
      expect(LLMTokenUsageAggregator).toHaveBeenCalled();
    });

    test('should accept custom options', () => {
      const parser = new CaptionParser(mockLogger, mockModel, {
        maxRetries: 5,
        temperature: 0.5,
      });
      expect(parser).toBeDefined();
    });

    test('should use custom componentName when provided', async () => {
      const parser = new CaptionParser(mockLogger, mockModel, {
        componentName: 'CaptionParser-fallback',
      });

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: { num: '도판 1' },
        usage: {
          component: 'CaptionParser-fallback',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      await parser.parseBatch(['도판 1 유적'], 0);

      expect(LLMCaller.call).toHaveBeenCalledWith(
        expect.objectContaining({
          component: 'CaptionParser-fallback',
        }),
      );
    });

    test('should default to CaptionParser componentName when not provided', async () => {
      const parser = new CaptionParser(mockLogger, mockModel);

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: { num: '도판 1' },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      await parser.parseBatch(['도판 1 유적'], 0);

      expect(LLMCaller.call).toHaveBeenCalledWith(
        expect.objectContaining({
          component: 'CaptionParser',
        }),
      );
    });
  });

  describe('parseBatch', () => {
    test('should return empty array for empty input', async () => {
      const parser = new CaptionParser(mockLogger, mockModel);
      const result = await parser.parseBatch([], 5);

      expect(result).toEqual([]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[CaptionParser] No captions to parse',
      );
    });

    test('should process captions in batches', async () => {
      const captions = ['도판 1 유적 전경', '도판 2 출토 유물', '도판 3 층위'];
      const parser = new CaptionParser(mockLogger, mockModel);

      // Mock BatchProcessor.processBatch
      vi.mocked(BatchProcessor.processBatch).mockResolvedValue([
        { index: 0, caption: { fullText: '도판 1 유적 전경', num: '도판 1' } },
        { index: 1, caption: { fullText: '도판 2 출토 유물', num: '도판 2' } },
        { index: 2, caption: { fullText: '도판 3 층위', num: '도판 3' } },
      ]);

      const result = await parser.parseBatch(captions, 2);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        fullText: '도판 1 유적 전경',
        num: '도판 1',
      });
      expect(result[1]).toEqual({
        fullText: '도판 2 출토 유물',
        num: '도판 2',
      });
      expect(result[2]).toEqual({ fullText: '도판 3 층위', num: '도판 3' });
    });

    test('should preserve original order when results are out of order', async () => {
      const captions = ['Caption A', 'Caption B', 'Caption C'];
      const parser = new CaptionParser(mockLogger, mockModel);

      // Return results out of order
      vi.mocked(BatchProcessor.processBatch).mockResolvedValue([
        { index: 2, caption: { fullText: 'Caption C', num: 'C' } },
        { index: 0, caption: { fullText: 'Caption A', num: 'A' } },
        { index: 1, caption: { fullText: 'Caption B', num: 'B' } },
      ]);

      const result = await parser.parseBatch(captions, 2);

      expect(result[0].fullText).toBe('Caption A');
      expect(result[1].fullText).toBe('Caption B');
      expect(result[2].fullText).toBe('Caption C');
    });

    test('should log token usage summary on success', async () => {
      const captions = ['도판 1'];
      const _parser = new CaptionParser(mockLogger, mockModel);
      const mockAggregator = {
        reset: vi.fn(),
        track: vi.fn(),
        logSummary: vi.fn(),
        getByComponent: vi.fn(() => []),
        getTotalUsage: vi.fn(() => ({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        })),
      };
      vi.mocked(LLMTokenUsageAggregator).mockReturnValue(mockAggregator as any);

      vi.mocked(BatchProcessor.processBatch).mockResolvedValue([
        { index: 0, caption: { fullText: '도판 1', num: '도판 1' } },
      ]);

      const parserWithMockedAggregator = new CaptionParser(
        mockLogger,
        mockModel,
      );
      await parserWithMockedAggregator.parseBatch(captions, 5);

      expect(mockAggregator.logSummary).toHaveBeenCalledWith(mockLogger);
    });

    test('should handle parsing error with Error object and throw CaptionParseError', async () => {
      const captions = ['도판 1'];
      const parser = new CaptionParser(mockLogger, mockModel);
      const testError = new Error('LLM API failed');

      vi.mocked(BatchProcessor.processBatch).mockRejectedValue(testError);

      await expect(parser.parseBatch(captions, 5)).rejects.toThrow(
        CaptionParseError,
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[CaptionParser] Parsing failed: LLM API failed',
      );
    });

    test('should handle parsing error with non-Error object and throw CaptionParseError', async () => {
      const captions = ['도판 1'];
      const parser = new CaptionParser(mockLogger, mockModel);
      const testError = 'String error message';

      vi.mocked(BatchProcessor.processBatch).mockRejectedValue(testError);

      await expect(parser.parseBatch(captions, 5)).rejects.toThrow(
        CaptionParseError,
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[CaptionParser] Parsing failed: String error message',
      );
    });

    test('should log completion summary with parsed count', async () => {
      const captions = ['도판 1', '설명 없음', '도판 2'];
      const parser = new CaptionParser(mockLogger, mockModel);

      vi.mocked(BatchProcessor.processBatch).mockResolvedValue([
        { index: 0, caption: { fullText: '도판 1', num: '도판 1' } },
        { index: 1, caption: { fullText: '설명 없음', num: undefined } },
        { index: 2, caption: { fullText: '도판 2', num: '도판 2' } },
      ]);

      await parser.parseBatch(captions, 3);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[CaptionParser] Completed: 3 captions parsed, 2 with extracted numbers',
      );
    });

    test('should process sequentially with batchSize = 0', async () => {
      const captions = ['도판 1 유적', '도판 2 유물'];
      const parser = new CaptionParser(mockLogger, mockModel);

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: { num: '도판 1' },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      const result = await parser.parseBatch(captions, 0);

      expect(result).toHaveLength(2);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[CaptionParser] Using sequential processing (batchSize=0)',
      );
      // BatchProcessor should NOT be called for sequential processing
      expect(BatchProcessor.processBatch).not.toHaveBeenCalled();
      // LLMCaller.call should be called once per caption
      expect(LLMCaller.call).toHaveBeenCalledTimes(2);
    });

    test('batchSize = 0 with single caption', async () => {
      const captions = ['도판 1 유적 전경'];
      const parser = new CaptionParser(mockLogger, mockModel);

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: { num: '도판 1' },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      const result = await parser.parseBatch(captions, 0);

      expect(result).toHaveLength(1);
      expect(result[0].fullText).toBe('도판 1 유적 전경');
      expect(result[0].num).toBe('도판 1');
      expect(LLMCaller.call).toHaveBeenCalledTimes(1);
    });

    test('batchSize = 0 with no caption number', async () => {
      const captions = ['설명 없는 이미지'];
      const parser = new CaptionParser(mockLogger, mockModel);

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: { num: null },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      const result = await parser.parseBatch(captions, 0);

      expect(result).toHaveLength(1);
      expect(result[0].num).toBeUndefined();
    });

    test('batchSize = 0 with case-insensitive caption matching', async () => {
      const captions = ['Figure 1: Test Image'];
      const parser = new CaptionParser(mockLogger, mockModel);

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: { num: 'FIGURE 1' },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      const result = await parser.parseBatch(captions, 0);

      expect(result).toHaveLength(1);
      expect(result[0].num).toBe('Figure 1');
    });

    test('should use overrideModel when provided with batchSize > 0', async () => {
      const captions = ['도판 1 유적'];
      const parser = new CaptionParser(mockLogger, mockModel);
      const overrideModel = { id: 'override-model' } as any;

      vi.mocked(BatchProcessor.processBatch).mockResolvedValue([
        { index: 0, caption: { fullText: '도판 1 유적', num: '도판 1' } },
      ]);

      await parser.parseBatch(captions, 5, overrideModel);

      // Verify BatchProcessor was called with a function that uses overrideModel
      expect(BatchProcessor.processBatch).toHaveBeenCalled();
      const batchCall = vi.mocked(BatchProcessor.processBatch).mock.calls[0];
      expect(batchCall[0]).toEqual([{ index: 0, text: '도판 1 유적' }]);
    });

    test('should use overrideModel when provided with batchSize = 0', async () => {
      const captions = ['도판 1 유적'];
      const parser = new CaptionParser(mockLogger, mockModel);
      const overrideModel = { id: 'override-model' } as any;

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: { num: '도판 1' },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'override-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      await parser.parseBatch(captions, 0, overrideModel);

      expect(LLMCaller.call).toHaveBeenCalledWith(
        expect.objectContaining({
          primaryModel: overrideModel,
        }),
      );
    });

    test('should use default model when overrideModel is not provided', async () => {
      const captions = ['도판 1 유적'];
      const parser = new CaptionParser(mockLogger, mockModel);

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: { num: '도판 1' },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      await parser.parseBatch(captions, 0);

      expect(LLMCaller.call).toHaveBeenCalledWith(
        expect.objectContaining({
          primaryModel: mockModel,
        }),
      );
    });

    test('should use "unknown" as modelName when model has neither id nor modelId', async () => {
      const modelWithoutId = {} as any;
      const parser = new CaptionParser(mockLogger, modelWithoutId);

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: { num: '도판 1' },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'unknown',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      await parser.parseBatch(['도판 1 유적'], 0);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[CaptionParser] Starting caption parsing for 1 captions with model: unknown',
      );
    });

    test('batchSize = 0 produces same result as batchSize > 0', async () => {
      const captions = ['도판 1', '도판 2'];
      const parser = new CaptionParser(mockLogger, mockModel);

      // Setup mocks for sequential path (batchSize = 0)
      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: { num: '도판 1' },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      const resultSequential = await parser.parseBatch(captions, 0);

      // Reset mocks for batch path (batchSize > 0)
      vi.clearAllMocks();
      vi.mocked(BatchProcessor.processBatch).mockResolvedValue([
        { index: 0, caption: { fullText: '도판 1', num: '도판 1' } },
        { index: 1, caption: { fullText: '도판 2', num: '도판 1' } },
      ]);

      const resultBatch = await parser.parseBatch(captions, 2);

      // Both should have same length and structure
      expect(resultSequential).toHaveLength(resultBatch.length);
    });
  });

  describe('parseBatchInternal', () => {
    test('should extract caption with Korean prefix and number', async () => {
      const parser = new CaptionParser(mockLogger, mockModel);

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: {
          results: [{ index: 0, num: '도판 1' }],
        },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      // Access private method through type casting
      const result = await (parser as any).parseBatchInternal(
        [{ index: 0, text: '도판 1 유적 전경' }],
        mockModel,
      );

      expect(result).toHaveLength(1);
      expect(result[0].caption.fullText).toBe('도판 1 유적 전경');
      expect(result[0].caption.num).toBe('도판 1');
    });

    test('should extract caption with English prefix and number', async () => {
      const parser = new CaptionParser(mockLogger, mockModel);

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: {
          results: [{ index: 0, num: 'Figure 2' }],
        },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      const result = await (parser as any).parseBatchInternal(
        [{ index: 0, text: 'Figure 2: Site plan' }],
        mockModel,
      );

      expect(result[0].caption.num).toBe('Figure 2');
    });

    test('should return null when no caption number is found', async () => {
      const parser = new CaptionParser(mockLogger, mockModel);

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: {
          results: [{ index: 0, num: null }],
        },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      const result = await (parser as any).parseBatchInternal(
        [{ index: 0, text: '설명 없는 이미지' }],
        mockModel,
      );

      expect(result[0].caption.num).toBeUndefined();
    });

    test('should preserve original spacing in caption extraction', async () => {
      const parser = new CaptionParser(mockLogger, mockModel);

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: {
          results: [{ index: 0, num: '도판  1' }],
        },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      const result = await (parser as any).parseBatchInternal(
        [{ index: 0, text: '도판  1  유적' }],
        mockModel,
      );

      expect(result[0].caption.num).toBe('도판  1');
    });

    test('should handle complex caption numbers like "5-2"', async () => {
      const parser = new CaptionParser(mockLogger, mockModel);

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: {
          results: [{ index: 0, num: '도판 5-2' }],
        },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      const result = await (parser as any).parseBatchInternal(
        [{ index: 0, text: '도판 5-2 층위 단면' }],
        mockModel,
      );

      expect(result[0].caption.num).toBe('도판 5-2');
    });

    test('should handle case-insensitive matching when prefix not found directly', async () => {
      const parser = new CaptionParser(mockLogger, mockModel);

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: {
          results: [{ index: 0, num: 'FIGURE 3' }],
        },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      const result = await (parser as any).parseBatchInternal(
        [{ index: 0, text: 'Figure 3: Site plan' }],
        mockModel,
      );

      expect(result[0].caption.num).toBe('Figure 3');
    });

    test('should track token usage when provided', async () => {
      const _parser = new CaptionParser(mockLogger, mockModel);
      const mockAggregator = {
        reset: vi.fn(),
        track: vi.fn(),
        logSummary: vi.fn(),
        getByComponent: vi.fn(() => []),
        getTotalUsage: vi.fn(() => ({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        })),
      };
      vi.mocked(LLMTokenUsageAggregator).mockReturnValue(mockAggregator as any);

      const extendedUsage = {
        component: 'CaptionParser',
        phase: 'caption-extraction',
        model: 'primary' as const,
        modelName: 'test-model',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };
      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: { results: [{ index: 0, num: '도판 1' }] },
        usage: extendedUsage,
        usedFallback: false,
      } as any);

      const parserWithMockedAggregator = new CaptionParser(
        mockLogger,
        mockModel,
      );
      await (parserWithMockedAggregator as any).parseBatchInternal(
        [{ index: 0, text: '도판 1' }],
        mockModel,
      );

      expect(mockAggregator.track).toHaveBeenCalledWith(extendedUsage);
    });

    test('should maintain original indices for out-of-order batch results', async () => {
      const parser = new CaptionParser(mockLogger, mockModel);

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: {
          results: [
            { index: 0, num: 'A' },
            { index: 1, num: 'B' },
          ],
        },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      const result = await (parser as any).parseBatchInternal(
        [
          { index: 10, text: 'Caption A' },
          { index: 20, text: 'Caption B' },
        ],
        mockModel,
      );

      expect(result[0].index).toBe(10);
      expect(result[1].index).toBe(20);
    });

    test('should call LLMCaller.call with correct parameters', async () => {
      const parser = new CaptionParser(mockLogger, mockModel, {
        temperature: 0.3,
        maxRetries: 5,
      });

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: { results: [{ index: 0, num: '도판 1' }] },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      await (parser as any).parseBatchInternal(
        [{ index: 0, text: '도판 1' }],
        mockModel,
      );

      expect(LLMCaller.call).toHaveBeenCalledWith(
        expect.objectContaining({
          primaryModel: mockModel,
          temperature: 0.3,
          maxRetries: 5,
          systemPrompt: expect.stringContaining(
            'archaeological excavation reports',
          ),
          userPrompt: expect.stringContaining('[0] 도판 1'),
          component: 'CaptionParser',
          phase: 'caption-extraction',
        }),
      );
    });

    test('should use result.index as fallback when originalCaption is undefined', async () => {
      const parser = new CaptionParser(mockLogger, mockModel);

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: {
          results: [{ index: 0, num: null }],
        },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      // Pass batch with explicit index that differs from position
      const result = await (parser as any).parseBatchInternal(
        [{ index: 99, text: '도판 1 유적 전경' }],
        mockModel,
      );

      // When accessing captions[0], it returns the caption with index 99
      // So originalIndex should be 99, not result.index (0)
      expect(result[0].index).toBe(99);
      expect(result[0].caption.fullText).toBe('도판 1 유적 전경');
    });

    test('should use empty string as fullText fallback when not found in map', async () => {
      const parser = new CaptionParser(mockLogger, mockModel);

      // Create a mock that simulates Map.get returning undefined
      const originalMapGet = Map.prototype.get;
      Map.prototype.get = vi.fn(() => undefined);

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: {
          results: [{ index: 0, num: null }],
        },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      const result = await (parser as any).parseBatchInternal(
        [{ index: 99, text: '도판 1' }],
        mockModel,
      );

      // fullText should default to empty string when not found in map
      expect(result[0].caption.fullText).toBe('');

      // Restore original Map.get
      Map.prototype.get = originalMapGet;
    });

    test('should use result.index when originalCaption.index is undefined', async () => {
      const parser = new CaptionParser(mockLogger, mockModel);

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: {
          results: [{ index: 0, num: '도판 1' }],
        },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      // Create a caption object without the index property
      const captionWithoutIndex = { text: '도판 1 유적' };
      const result = await (parser as any).parseBatchInternal(
        [captionWithoutIndex as any],
        mockModel,
      );

      // When originalCaption.index is undefined, result.index (0) should be used as originalIndex
      expect(result[0].index).toBe(0);
      expect(result[0].caption.fullText).toBe('');
    });

    test('should log warning when LLM returns incomplete results', async () => {
      const parser = new CaptionParser(mockLogger, mockModel);

      // Mock LLM to return only 1 result for 2 inputs
      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: {
          results: [{ index: 0, num: 'A' }], // Missing index 1
        },
        usage: {
          component: 'CaptionParser',
          phase: 'caption-extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      await (parser as any).parseBatchInternal(
        [
          { index: 0, text: 'Text A' },
          { index: 1, text: 'Text B' },
        ],
        mockModel,
      );

      // Verify warning was logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('LLM returned 1 results for 2 captions'),
      );
    });
  });

  describe('CaptionParseError', () => {
    test('should create error with message', () => {
      const error = new CaptionParseError('Test error message');

      expect(error.message).toBe('Test error message');
      expect(error.name).toBe('CaptionParseError');
      expect(error instanceof Error).toBe(true);
    });

    test('should create error with cause', () => {
      const cause = new Error('Original error');
      const error = new CaptionParseError('Wrapper error', { cause });

      expect(error.message).toBe('Wrapper error');
      expect(error.cause).toBe(cause);
    });
  });
});
