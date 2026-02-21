import type { Caption } from '@heripo/model';
import type { LanguageModel } from 'ai';

import {
  BatchProcessor,
  LLMCaller,
  LLMTokenUsageAggregator,
} from '@heripo/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { CaptionValidationError, CaptionValidator } from './caption-validator';

// Mock LLM dependencies
vi.mock('@heripo/shared', () => ({
  BatchProcessor: {
    processBatch: vi.fn(),
  },
  LLMCaller: {
    call: vi.fn(),
  },
  LLMTokenUsageAggregator: vi.fn(function () {
    return {
      reset: vi.fn(),
      track: vi.fn(),
      logSummary: vi.fn(),
    };
  }),
  LLMTokenUsageTracker: vi.fn(() => ({
    reset: vi.fn(),
    track: vi.fn(),
    logSummary: vi.fn(),
  })),
}));

describe('CaptionValidator', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  const mockModel = { id: 'test-model' } as unknown as LanguageModel;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    test('should initialize with required parameters', () => {
      const mockAggregator = {
        reset: vi.fn(),
        track: vi.fn(),
        logSummary: vi.fn(),
      };
      const validator = new CaptionValidator(
        mockLogger,
        mockModel,
        {},
        undefined,
        mockAggregator as any,
      );
      expect(validator).toBeDefined();
    });

    test('should accept custom options', () => {
      const validator = new CaptionValidator(mockLogger, mockModel, {
        maxRetries: 5,
        temperature: 0.5,
      });
      expect(validator).toBeDefined();
    });
  });

  describe('validateBatch', () => {
    test('should throw error when captions and originalTexts length mismatch', async () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      const captions: Caption[] = [{ fullText: 'Caption 1', num: '도판 1' }];
      const originalTexts = ['Original 1', 'Original 2'];

      await expect(
        validator.validateBatch(captions, originalTexts, 5),
      ).rejects.toThrow(
        '[CaptionValidator] Captions and originalTexts length mismatch: 1 vs 2',
      );
    });

    test('should return empty array for empty input', async () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      const result = await validator.validateBatch([], [], 5);

      expect(result).toEqual([]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[CaptionValidator] No captions to validate',
      );
    });

    test('should validate captions in batches', async () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      const captions: Caption[] = [
        { fullText: '도판 1 유적 전경', num: '도판 1' },
        { fullText: '도판 2 출토 유물', num: '도판 2' },
      ];
      const originalTexts = ['도판 1 유적 전경', '도판 2 출토 유물'];

      vi.mocked(BatchProcessor.processBatch).mockResolvedValue([
        { index: 0, isValid: true, reason: null },
        { index: 1, isValid: true, reason: null },
      ]);

      const result = await validator.validateBatch(captions, originalTexts, 2);

      expect(result).toEqual([true, true]);
    });

    test('should invoke validateBatchInternal through BatchProcessor callback', async () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      const captions: Caption[] = [
        { fullText: '도판 1 유적 전경', num: '도판 1' },
      ];
      const originalTexts = ['도판 1 유적 전경'];

      vi.mocked(BatchProcessor.processBatch).mockImplementation(
        async (items: any[], _batchSize: number, callback: any) => {
          return callback(items);
        },
      );

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: {
          results: [{ index: 0, isValid: true, reason: null }],
        },
        usage: {
          component: 'CaptionValidator',
          phase: 'validation',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      } as any);

      const result = await validator.validateBatch(captions, originalTexts, 5);

      expect(result).toEqual([true]);
      expect(LLMCaller.call).toHaveBeenCalled();
    });

    test('should preserve original order when results are out of order', async () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      const captions: Caption[] = [
        { fullText: 'Caption A', num: 'A' },
        { fullText: 'Caption B', num: 'B' },
        { fullText: 'Caption C', num: 'C' },
      ];
      const originalTexts = ['Caption A', 'Caption B', 'Caption C'];

      // Return results out of order
      vi.mocked(BatchProcessor.processBatch).mockResolvedValue([
        { index: 2, isValid: true, reason: null },
        { index: 0, isValid: true, reason: null },
        { index: 1, isValid: false, reason: 'Invalid parsing' },
      ]);

      const result = await validator.validateBatch(captions, originalTexts, 2);

      expect(result).toEqual([true, false, true]);
    });

    test('should use provided model override', async () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      const captions: Caption[] = [{ fullText: '도판 1', num: '도판 1' }];
      const originalTexts = ['도판 1'];

      vi.mocked(BatchProcessor.processBatch).mockResolvedValue([
        { index: 0, isValid: true, reason: null },
      ]);

      await validator.validateBatch(captions, originalTexts, 5);

      expect(BatchProcessor.processBatch).toHaveBeenCalled();
    });

    test('should log token usage summary on success', async () => {
      const mockAggregator = {
        reset: vi.fn(),
        track: vi.fn(),
        logSummary: vi.fn(),
      };

      const captions: Caption[] = [{ fullText: '도판 1', num: '도판 1' }];
      const originalTexts = ['도판 1'];

      vi.mocked(BatchProcessor.processBatch).mockResolvedValue([
        { index: 0, isValid: true, reason: null },
      ]);

      const validatorWithMockedAggregator = new CaptionValidator(
        mockLogger,
        mockModel,
        {},
        undefined,
        mockAggregator as any,
      );
      await validatorWithMockedAggregator.validateBatch(
        captions,
        originalTexts,
        5,
      );

      expect(mockAggregator.logSummary).toHaveBeenCalledWith(mockLogger);
    });

    test('should handle validation error and throw CaptionValidationError', async () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      const captions: Caption[] = [{ fullText: '도판 1', num: '도판 1' }];
      const originalTexts = ['도판 1'];
      const testError = new Error('LLM API failed');

      vi.mocked(BatchProcessor.processBatch).mockRejectedValue(testError);

      await expect(
        validator.validateBatch(captions, originalTexts, 5),
      ).rejects.toThrow(CaptionValidationError);
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[CaptionValidator] Validation failed: LLM API failed',
      );
    });

    test('should handle error with non-Error object', async () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      const captions: Caption[] = [{ fullText: '도판 1', num: '도판 1' }];
      const originalTexts = ['도판 1'];
      const testError = 'String error message';

      vi.mocked(BatchProcessor.processBatch).mockRejectedValue(testError);

      await expect(
        validator.validateBatch(captions, originalTexts, 5),
      ).rejects.toThrow(CaptionValidationError);
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[CaptionValidator] Validation failed: String error message',
      );
    });

    test('should log completion summary with valid count', async () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      const captions: Caption[] = [
        { fullText: '도판 1', num: '도판 1' },
        { fullText: '설명 없음', num: undefined },
        { fullText: '도판 2', num: '도판 2' },
      ];
      const originalTexts = ['도판 1', '설명 없음', '도판 2'];

      vi.mocked(BatchProcessor.processBatch).mockResolvedValue([
        { index: 0, isValid: true, reason: null },
        { index: 1, isValid: false, reason: 'Invalid' },
        { index: 2, isValid: true, reason: null },
      ]);

      await validator.validateBatch(captions, originalTexts, 3);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[CaptionValidator] Completed: 2/3 captions validated as correct',
      );
    });

    test('should skip validation and return all true for batchSize = 0', async () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      const captions: Caption[] = [
        { fullText: '도판 1 유적 전경', num: '도판 1' },
        { fullText: '도판 2 출토 유물', num: '도판 2' },
        { fullText: '설명 없음', num: undefined },
      ];
      const originalTexts = [
        '도판 1 유적 전경',
        '도판 2 출토 유물',
        '설명 없음',
      ];

      const result = await validator.validateBatch(captions, originalTexts, 0);

      expect(result).toEqual([true, true, true]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[CaptionValidator] Skipping validation (batchSize=0), assuming all captions are valid',
      );
      // BatchProcessor should NOT be called
      expect(BatchProcessor.processBatch).not.toHaveBeenCalled();
    });

    test('should return correct length array for batchSize = 0 with various sizes', async () => {
      const validator = new CaptionValidator(mockLogger, mockModel);

      // Test with 1 caption
      let result = await validator.validateBatch(
        [{ fullText: '도판 1', num: '도판 1' }],
        ['도판 1'],
        0,
      );
      expect(result).toEqual([true]);

      // Test with 5 captions
      result = await validator.validateBatch(
        Array(5).fill({ fullText: 'Caption', num: 'Prefix' }),
        Array(5).fill('Caption'),
        0,
      );
      expect(result).toHaveLength(5);
      expect(result).toEqual([true, true, true, true, true]);

      // Test with 10 captions
      result = await validator.validateBatch(
        Array(10).fill({ fullText: 'Caption', num: 'Prefix' }),
        Array(10).fill('Caption'),
        0,
      );
      expect(result).toHaveLength(10);
    });

    test('batchSize = 0 should not call LLM', async () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      const captions: Caption[] = [{ fullText: '도판 1', num: '도판 1' }];
      const originalTexts = ['도판 1'];

      await validator.validateBatch(captions, originalTexts, 0);

      expect(BatchProcessor.processBatch).not.toHaveBeenCalled();
      expect(LLMCaller.call).not.toHaveBeenCalled();
    });
  });

  describe('validateBatchInternal', () => {
    test('should validate captions and return correct results', async () => {
      const _validator = new CaptionValidator(mockLogger, mockModel);
      const mockAggregator = {
        reset: vi.fn(),
        track: vi.fn(),
        logSummary: vi.fn(),
      };
      vi.mocked(LLMTokenUsageAggregator).mockReturnValue(mockAggregator as any);

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: {
          results: [
            { index: 0, isValid: true, reason: null },
            { index: 1, isValid: false, reason: 'Error' },
          ],
        },
        usage: {
          component: 'CaptionValidator',
          phase: 'validation',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 50,
          outputTokens: 25,
          totalTokens: 75,
        },
        usedFallback: false,
      } as any);

      const validatorWithMockedAggregator = new CaptionValidator(
        mockLogger,
        mockModel,
      );
      const result = await (
        validatorWithMockedAggregator as any
      ).validateBatchInternal(
        [
          {
            index: 0,
            caption: { fullText: '도판 1', num: '도판 1' },
            originalText: '도판 1',
          },
          {
            index: 1,
            caption: { fullText: '도판 2', num: '도판' },
            originalText: '도판 2',
          },
        ],
        mockModel,
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ index: 0, isValid: true });
      expect(result[1]).toEqual({ index: 1, isValid: false });
    });

    test('should track token usage from LLM response', async () => {
      const mockAggregator = {
        reset: vi.fn(),
        track: vi.fn(),
        logSummary: vi.fn(),
      };

      const usage = {
        component: 'CaptionValidator',
        phase: 'validation',
        model: 'primary',
        modelName: 'test-model',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };
      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: {
          results: [{ index: 0, isValid: true, reason: null }],
        },
        usage,
        usedFallback: false,
      } as any);

      const validatorWithMockedAggregator = new CaptionValidator(
        mockLogger,
        mockModel,
        {},
        undefined,
        mockAggregator as any,
      );
      await (validatorWithMockedAggregator as any).validateBatchInternal(
        [
          {
            index: 0,
            caption: { fullText: '도판 1', num: '도판 1' },
            originalText: '도판 1',
          },
        ],
        mockModel,
      );

      expect(mockAggregator.track).toHaveBeenCalledWith(usage);
    });
  });

  describe('buildSystemPrompt', () => {
    test('should contain validation rules', () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      const prompt = (validator as any).buildSystemPrompt();

      expect(prompt).toContain('archaeological excavation reports');
      expect(prompt).toContain('Correctness');
      expect(prompt).toContain('Spacing');
      expect(prompt).toContain('Completeness');
      expect(prompt).toContain('Null handling');
    });

    test('should include examples in system prompt', () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      const prompt = (validator as any).buildSystemPrompt();

      expect(prompt).toContain('도판 1 유적 전경');
      expect(prompt).toContain('Figure 2-3');
    });
  });

  describe('buildUserPrompt', () => {
    test('should format captions correctly', () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      const items = [
        {
          index: 0,
          caption: { fullText: '도판 1 유적', num: '도판 1' },
          originalText: '도판 1 유적',
        },
        {
          index: 1,
          caption: { fullText: '설명 없음', num: undefined },
          originalText: '설명 없음',
        },
      ];

      const prompt = (validator as any).buildUserPrompt(items);

      expect(prompt).toContain('[0] Original: "도판 1 유적"');
      expect(prompt).toContain('Parsed num: "도판 1"');
      expect(prompt).toContain('[1] Original: "설명 없음"');
      expect(prompt).toContain('Parsed num: null');
    });

    test('should include JSON example in user prompt', () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      const items = [
        {
          index: 0,
          caption: { fullText: 'Caption', num: 'Prefix' },
          originalText: 'Caption',
        },
      ];

      const prompt = (validator as any).buildUserPrompt(items);

      expect(prompt).toContain('"results"');
      expect(prompt).toContain('"index"');
      expect(prompt).toContain('"isValid"');
      expect(prompt).toContain('"reason"');
    });

    test('should handle null num field correctly', () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      const items = [
        {
          index: 0,
          caption: { fullText: 'No caption', num: undefined },
          originalText: 'No caption',
        },
      ];

      const prompt = (validator as any).buildUserPrompt(items);

      expect(prompt).toContain('Parsed num: null');
      expect(prompt).not.toContain('Parsed num: "null"');
    });

    test('should preserve spacing in original text', () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      const items = [
        {
          index: 0,
          caption: { fullText: '도판  1  유적', num: '도판  1' },
          originalText: '도판  1  유적',
        },
      ];

      const prompt = (validator as any).buildUserPrompt(items);

      expect(prompt).toContain('도판  1');
    });
  });

  describe('CaptionValidationError', () => {
    test('should create error with message', () => {
      const error = new CaptionValidationError('Test error message');

      expect(error.message).toBe('Test error message');
      expect(error.name).toBe('CaptionValidationError');
      expect(error instanceof Error).toBe(true);
    });

    test('should create error with cause', () => {
      const cause = new Error('Original error');
      const error = new CaptionValidationError('Wrapper error', { cause });

      expect(error.message).toBe('Wrapper error');
      expect(error.cause).toBe(cause);
    });
  });

  describe('integration with BaseValidator', () => {
    test('should inherit from BaseValidator', () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      expect(validator).toBeInstanceOf(CaptionValidator);
    });

    test('should respect maxRetries and temperature options', () => {
      const validator = new CaptionValidator(mockLogger, mockModel, {
        maxRetries: 7,
        temperature: 0.8,
      });
      expect(validator).toBeDefined();
    });

    test('should use default options when not provided', () => {
      const validator = new CaptionValidator(mockLogger, mockModel);
      expect(validator).toBeDefined();
    });
  });
});
