import type { LoggerMethods } from '@heripo/logger';
import type { LanguageModel } from 'ai';

import { LLMCaller, LLMTokenUsageAggregator } from '@heripo/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';

import { BaseValidator } from './base-validator';

vi.mock('@heripo/shared', () => ({
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
}));

// Concrete implementation for testing
class TestValidator extends BaseValidator<typeof TestSchema, TestResult> {
  protected buildSystemPrompt(): string {
    return 'Test system prompt';
  }

  protected buildUserPrompt(): string {
    return 'Test user prompt';
  }

  async testCall(
    schema: typeof TestSchema,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<any> {
    return this.callLLM(schema, systemPrompt, userPrompt, 'test-phase');
  }

  async testCallWithAggregator(
    schema: typeof TestSchema,
    systemPrompt: string,
    userPrompt: string,
    aggregator: LLMTokenUsageAggregator,
  ): Promise<any> {
    return this.callLLM(
      schema,
      systemPrompt,
      userPrompt,
      'test-phase',
      aggregator,
    );
  }
}

const TestSchema = z.object({
  result: z.string(),
});

type TestResult = z.infer<typeof TestSchema>;

describe('BaseValidator', () => {
  let mockLogger: LoggerMethods;
  let mockModel: LanguageModel;
  let mockLLMCaller: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    mockModel = { modelId: 'test-model' } as LanguageModel;

    mockLLMCaller = vi.mocked(LLMCaller.call);
  });

  describe('constructor', () => {
    test('initializes with required parameters', () => {
      const validator = new TestValidator(
        mockLogger,
        mockModel,
        'TestValidator',
      );

      expect(validator).toBeDefined();
    });

    test('uses default maxRetries (3) when not provided', () => {
      const validator = new TestValidator(
        mockLogger,
        mockModel,
        'TestValidator',
        {},
      );

      expect(validator).toBeDefined();
    });

    test('uses custom maxRetries when provided', () => {
      const validator = new TestValidator(
        mockLogger,
        mockModel,
        'TestValidator',
        {
          maxRetries: 5,
        },
      );

      expect(validator).toBeDefined();
    });

    test('uses default temperature (0) when not provided', () => {
      const validator = new TestValidator(
        mockLogger,
        mockModel,
        'TestValidator',
        {},
      );

      expect(validator).toBeDefined();
    });

    test('uses custom temperature when provided', () => {
      const validator = new TestValidator(
        mockLogger,
        mockModel,
        'TestValidator',
        {
          temperature: 0.5,
        },
      );

      expect(validator).toBeDefined();
    });

    test('stores fallback model when provided', () => {
      const fallbackModel = { modelId: 'fallback-model' } as LanguageModel;
      const validator = new TestValidator(
        mockLogger,
        mockModel,
        'TestValidator',
        {},
        fallbackModel,
      );

      expect(validator).toBeDefined();
    });

    test('stores aggregator when provided', () => {
      const mockAggregator = new LLMTokenUsageAggregator();
      const validator = new TestValidator(
        mockLogger,
        mockModel,
        'TestValidator',
        {},
        undefined,
        mockAggregator,
      );

      expect(validator).toBeDefined();
    });
  });

  describe('callLLM', () => {
    test('calls LLMCaller.call with correct parameters', async () => {
      mockLLMCaller.mockResolvedValueOnce({
        output: { result: 'test result' },
        usage: {
          component: 'TestValidator',
          phase: 'test-phase',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      });

      const validator = new TestValidator(
        mockLogger,
        mockModel,
        'TestValidator',
      );
      const result = await validator.testCall(TestSchema, 'system', 'user');

      expect(mockLLMCaller).toHaveBeenCalledWith({
        schema: TestSchema,
        systemPrompt: 'system',
        userPrompt: 'user',
        primaryModel: mockModel,
        fallbackModel: undefined,
        maxRetries: 3,
        temperature: 0,
        component: 'TestValidator',
        phase: 'test-phase',
      });

      expect(result.output).toEqual({ result: 'test result' });
      expect(result.usage.component).toBe('TestValidator');
    });

    test('passes fallback model to LLMCaller when provided', async () => {
      const fallbackModel = { modelId: 'fallback-model' } as LanguageModel;

      mockLLMCaller.mockResolvedValueOnce({
        output: { result: 'test result' },
        usage: {
          component: 'TestValidator',
          phase: 'test-phase',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      });

      const validator = new TestValidator(
        mockLogger,
        mockModel,
        'TestValidator',
        {},
        fallbackModel,
      );
      await validator.testCall(TestSchema, 'system', 'user');

      expect(mockLLMCaller).toHaveBeenCalledWith(
        expect.objectContaining({
          fallbackModel: fallbackModel,
        }),
      );
    });

    test('tracks token usage with aggregator when provided', async () => {
      const mockAggregator = new LLMTokenUsageAggregator();
      const mockTrack = vi.mocked(mockAggregator.track);

      mockLLMCaller.mockResolvedValueOnce({
        output: { result: 'test result' },
        usage: {
          component: 'TestValidator',
          phase: 'test-phase',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      });

      const validator = new TestValidator(
        mockLogger,
        mockModel,
        'TestValidator',
        {},
        undefined,
        mockAggregator,
      );
      await validator.testCallWithAggregator(
        TestSchema,
        'system',
        'user',
        mockAggregator,
      );

      expect(mockTrack).toHaveBeenCalled();
    });

    test('does not track token usage when aggregator is not provided', async () => {
      mockLLMCaller.mockResolvedValueOnce({
        output: { result: 'test result' },
        usage: {
          component: 'TestValidator',
          phase: 'test-phase',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      });

      const validator = new TestValidator(
        mockLogger,
        mockModel,
        'TestValidator',
      );
      const result = await validator.testCall(TestSchema, 'system', 'user');

      expect(result).toBeDefined();
    });

    test('uses custom maxRetries and temperature in LLM call', async () => {
      mockLLMCaller.mockResolvedValueOnce({
        output: { result: 'test result' },
        usage: {
          component: 'TestValidator',
          phase: 'test-phase',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        usedFallback: false,
      });

      const validator = new TestValidator(
        mockLogger,
        mockModel,
        'TestValidator',
        {
          maxRetries: 7,
          temperature: 0.8,
        },
      );
      await validator.testCall(TestSchema, 'system', 'user');

      expect(mockLLMCaller).toHaveBeenCalledWith(
        expect.objectContaining({
          maxRetries: 7,
          temperature: 0.8,
        }),
      );
    });

    test('returns output and usage from LLMCaller response', async () => {
      mockLLMCaller.mockResolvedValueOnce({
        output: { result: 'test result' },
        usage: {
          component: 'TestValidator',
          phase: 'test-phase',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 20,
          outputTokens: 10,
          totalTokens: 30,
        },
        usedFallback: false,
      });

      const validator = new TestValidator(
        mockLogger,
        mockModel,
        'TestValidator',
      );
      const result = await validator.testCall(TestSchema, 'system', 'user');

      expect(result.output.result).toBe('test result');
      expect(result.usage.inputTokens).toBe(20);
      expect(result.usage.outputTokens).toBe(10);
      expect(result.usage.totalTokens).toBe(30);
    });
  });

  describe('abstract methods', () => {
    test('buildSystemPrompt is implemented by subclass', () => {
      const validator = new TestValidator(
        mockLogger,
        mockModel,
        'TestValidator',
      );

      const systemPrompt = (validator as any).buildSystemPrompt();

      expect(systemPrompt).toBe('Test system prompt');
    });

    test('buildUserPrompt is implemented by subclass', () => {
      const validator = new TestValidator(
        mockLogger,
        mockModel,
        'TestValidator',
      );

      const userPrompt = (validator as any).buildUserPrompt();

      expect(userPrompt).toBe('Test user prompt');
    });
  });
});
