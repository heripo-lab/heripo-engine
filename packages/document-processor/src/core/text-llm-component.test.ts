import type { LoggerMethods } from '@heripo/logger';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import { LLMCaller } from '@heripo/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';

import { TextLLMComponent } from './text-llm-component';

vi.mock('@heripo/shared', () => ({
  LLMCaller: {
    call: vi.fn(),
  },
}));

/**
 * Concrete implementation for testing abstract class
 */
class TestTextComponent extends TextLLMComponent {
  protected buildSystemPrompt(): string {
    return 'Test system prompt';
  }

  protected buildUserPrompt(input: string): string {
    return `Test user prompt: ${input}`;
  }

  // Expose protected method for testing
  public async testCallTextLLM<TSchema extends z.ZodType>(
    schema: TSchema,
    systemPrompt: string,
    userPrompt: string,
    phase: string,
  ) {
    return this.callTextLLM(schema, systemPrompt, userPrompt, phase);
  }
}

describe('TextLLMComponent', () => {
  let mockLogger: LoggerMethods;
  let mockModel: LanguageModel;
  let mockFallbackModel: LanguageModel;
  let mockAggregator: LLMTokenUsageAggregator;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as LoggerMethods;

    mockModel = { modelId: 'test-primary-model' } as unknown as LanguageModel;
    mockFallbackModel = {
      modelId: 'test-fallback-model',
    } as unknown as LanguageModel;
    mockAggregator = {
      track: vi.fn(),
      logSummary: vi.fn(),
      getReport: vi.fn(),
    } as unknown as LLMTokenUsageAggregator;
  });

  describe('callTextLLM()', () => {
    test('should call LLMCaller.call() with correct configuration', async () => {
      const component = new TestTextComponent(
        mockLogger,
        mockModel,
        'TestComponent',
        { maxRetries: 5, temperature: 0.5 },
        mockFallbackModel,
        mockAggregator,
      );

      const testSchema = z.object({ result: z.string() });
      const mockUsage = {
        component: 'TestComponent',
        phase: 'test-phase',
        model: 'primary' as const,
        modelName: 'test-model',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: { result: 'test-result' },
        usage: mockUsage,
        usedFallback: false,
      });

      await component.testCallTextLLM(
        testSchema,
        'System prompt',
        'User prompt',
        'test-phase',
      );

      expect(LLMCaller.call).toHaveBeenCalledWith({
        schema: testSchema,
        systemPrompt: 'System prompt',
        userPrompt: 'User prompt',
        primaryModel: mockModel,
        fallbackModel: mockFallbackModel,
        maxRetries: 5,
        temperature: 0.5,
        component: 'TestComponent',
        phase: 'test-phase',
      });
    });

    test('should return output and usage from LLMCaller result', async () => {
      const component = new TestTextComponent(
        mockLogger,
        mockModel,
        'TestComponent',
      );

      const testSchema = z.object({ value: z.number() });
      const mockUsage = {
        component: 'TestComponent',
        phase: 'extraction',
        model: 'primary' as const,
        modelName: 'test-model',
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
      };

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: { value: 42 },
        usage: mockUsage,
        usedFallback: false,
      });

      const result = await component.testCallTextLLM(
        testSchema,
        'System',
        'User',
        'extraction',
      );

      expect(result.output).toEqual({ value: 42 });
      expect(result.usage).toEqual(mockUsage);
    });

    test('should track usage when aggregator is provided', async () => {
      const component = new TestTextComponent(
        mockLogger,
        mockModel,
        'TestComponent',
        undefined,
        undefined,
        mockAggregator,
      );

      const testSchema = z.object({ data: z.string() });
      const mockUsage = {
        component: 'TestComponent',
        phase: 'validation',
        model: 'primary' as const,
        modelName: 'test-model',
        inputTokens: 50,
        outputTokens: 25,
        totalTokens: 75,
      };

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: { data: 'test' },
        usage: mockUsage,
        usedFallback: false,
      });

      await component.testCallTextLLM(
        testSchema,
        'System',
        'User',
        'validation',
      );

      expect(mockAggregator.track).toHaveBeenCalledWith(mockUsage);
    });

    test('should not throw when no aggregator is provided', async () => {
      const component = new TestTextComponent(
        mockLogger,
        mockModel,
        'TestComponent',
      );

      const testSchema = z.object({ result: z.boolean() });
      const mockUsage = {
        component: 'TestComponent',
        phase: 'test',
        model: 'primary' as const,
        modelName: 'test-model',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      };

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: { result: true },
        usage: mockUsage,
        usedFallback: false,
      });

      await expect(
        component.testCallTextLLM(testSchema, 'System', 'User', 'test'),
      ).resolves.not.toThrow();
    });

    test('should use default options when not provided', async () => {
      const component = new TestTextComponent(
        mockLogger,
        mockModel,
        'TestComponent',
      );

      const testSchema = z.object({ ok: z.boolean() });
      const mockUsage = {
        component: 'TestComponent',
        phase: 'default',
        model: 'primary' as const,
        modelName: 'test-model',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: { ok: true },
        usage: mockUsage,
        usedFallback: false,
      });

      await component.testCallTextLLM(testSchema, 'System', 'User', 'default');

      expect(LLMCaller.call).toHaveBeenCalledWith(
        expect.objectContaining({
          maxRetries: 3,
          temperature: 0,
          fallbackModel: undefined,
        }),
      );
    });

    test('should propagate errors from LLMCaller', async () => {
      const component = new TestTextComponent(
        mockLogger,
        mockModel,
        'TestComponent',
      );

      const testSchema = z.object({ result: z.string() });
      const error = new Error('LLM call failed');

      vi.mocked(LLMCaller.call).mockRejectedValue(error);

      await expect(
        component.testCallTextLLM(testSchema, 'System', 'User', 'test'),
      ).rejects.toThrow('LLM call failed');
    });

    test('should handle fallback model usage correctly', async () => {
      const component = new TestTextComponent(
        mockLogger,
        mockModel,
        'TestComponent',
        undefined,
        mockFallbackModel,
        mockAggregator,
      );

      const testSchema = z.object({ result: z.string() });
      const mockUsage = {
        component: 'TestComponent',
        phase: 'test',
        model: 'fallback' as const,
        modelName: 'fallback-model',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };

      vi.mocked(LLMCaller.call).mockResolvedValue({
        output: { result: 'fallback-result' },
        usage: mockUsage,
        usedFallback: true,
      });

      const result = await component.testCallTextLLM(
        testSchema,
        'System',
        'User',
        'test',
      );

      expect(result.usage.model).toBe('fallback');
      expect(mockAggregator.track).toHaveBeenCalledWith(mockUsage);
    });
  });
});
