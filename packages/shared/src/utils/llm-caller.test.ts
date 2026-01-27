import type { LanguageModel } from 'ai';

import { Output, generateText } from 'ai';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { LLMCaller } from './llm-caller';

vi.mock('ai', () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn((config: { schema: unknown }) => config),
  },
}));

// Helper to create a mock generateText result
function createMockGenerateTextResult<T>(
  output: T,
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  },
) {
  return {
    output,
    usage: usage ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
  } as any;
}

describe('LLMCaller', () => {
  const mockPrimaryModel = { modelId: 'gpt-5' } as LanguageModel;
  const mockFallbackModel = { modelId: 'claude-opus-4-5' } as LanguageModel;
  const mockSchema = { schema: 'mock' } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractModelName (via model name extraction)', () => {
    test('should extract modelId when available', async () => {
      const mockResponse = createMockGenerateTextResult(
        { result: 'success' },
        { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      );

      vi.mocked(generateText).mockResolvedValueOnce(mockResponse);

      const result = await LLMCaller.call({
        schema: mockSchema,
        systemPrompt: 'test',
        userPrompt: 'test',
        primaryModel: { modelId: 'gpt-5' } as LanguageModel,
        maxRetries: 3,
        component: 'Test',
        phase: 'test',
      });

      expect(result.usage.modelName).toBe('gpt-5');
    });

    test('should extract id field when modelId not available', async () => {
      const mockResponse = createMockGenerateTextResult(
        { result: 'success' },
        { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      );

      vi.mocked(generateText).mockResolvedValueOnce(mockResponse);

      const result = await LLMCaller.call({
        schema: mockSchema,
        systemPrompt: 'test',
        userPrompt: 'test',
        primaryModel: { id: 'model-id-123' } as unknown as LanguageModel,
        maxRetries: 3,
        component: 'Test',
        phase: 'test',
      });

      expect(result.usage.modelName).toBe('model-id-123');
    });

    test('should extract model field when id not available', async () => {
      const mockResponse = createMockGenerateTextResult(
        { result: 'success' },
        { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      );

      vi.mocked(generateText).mockResolvedValueOnce(mockResponse);

      const result = await LLMCaller.call({
        schema: mockSchema,
        systemPrompt: 'test',
        userPrompt: 'test',
        primaryModel: { model: 'claude-3-sonnet' } as unknown as LanguageModel,
        maxRetries: 3,
        component: 'Test',
        phase: 'test',
      });

      expect(result.usage.modelName).toBe('claude-3-sonnet');
    });

    test('should extract name field when model not available', async () => {
      const mockResponse = createMockGenerateTextResult(
        { result: 'success' },
        { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      );

      vi.mocked(generateText).mockResolvedValueOnce(mockResponse);

      const result = await LLMCaller.call({
        schema: mockSchema,
        systemPrompt: 'test',
        userPrompt: 'test',
        primaryModel: { name: 'my-model' } as unknown as LanguageModel,
        maxRetries: 3,
        component: 'Test',
        phase: 'test',
      });

      expect(result.usage.modelName).toBe('my-model');
    });

    test('should fallback to String representation when no known fields', async () => {
      const mockResponse = createMockGenerateTextResult(
        { result: 'success' },
        { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      );

      vi.mocked(generateText).mockResolvedValueOnce(mockResponse);

      const unknownModel = {} as LanguageModel;
      const result = await LLMCaller.call({
        schema: mockSchema,
        systemPrompt: 'test',
        userPrompt: 'test',
        primaryModel: unknownModel,
        maxRetries: 3,
        component: 'Test',
        phase: 'test',
      });

      // Result should be String representation of the object
      expect(typeof result.usage.modelName).toBe('string');
      expect(result.usage.modelName.length).toBeGreaterThan(0);
    });
  });

  describe('call', () => {
    test('should successfully call primary model and return result', async () => {
      const mockResponse = createMockGenerateTextResult(
        { result: 'success' },
        {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
      );

      vi.mocked(generateText).mockResolvedValueOnce(mockResponse);

      const result = await LLMCaller.call({
        schema: mockSchema,
        systemPrompt: 'You are helpful',
        userPrompt: 'Do something',
        primaryModel: mockPrimaryModel,
        maxRetries: 3,
        component: 'TestExtractor',
        phase: 'testing',
      });

      expect(result.output).toEqual({ result: 'success' });
      expect(result.usage.model).toBe('primary');
      expect(result.usage.modelName).toBe('gpt-5');
      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
      expect(result.usage.totalTokens).toBe(150);
      expect(result.usedFallback).toBe(false);
      expect(result.usage.component).toBe('TestExtractor');
      expect(result.usage.phase).toBe('testing');
    });

    test('should throw if primary model fails and no fallback provided', async () => {
      const error = new Error('Primary model failed');
      vi.mocked(generateText).mockRejectedValueOnce(error);

      await expect(
        LLMCaller.call({
          schema: mockSchema,
          systemPrompt: 'You are helpful',
          userPrompt: 'Do something',
          primaryModel: mockPrimaryModel,
          maxRetries: 3,
          component: 'TestExtractor',
          phase: 'testing',
        }),
      ).rejects.toThrow('Primary model failed');

      expect(generateText).toHaveBeenCalledOnce();
    });

    test('should fallback to fallback model when primary fails', async () => {
      const primaryError = new Error('Primary failed');
      const mockFallbackResponse = createMockGenerateTextResult(
        { result: 'fallback success' },
        {
          inputTokens: 200,
          outputTokens: 75,
          totalTokens: 275,
        },
      );

      vi.mocked(generateText).mockRejectedValueOnce(primaryError);
      vi.mocked(generateText).mockResolvedValueOnce(mockFallbackResponse);

      const result = await LLMCaller.call({
        schema: mockSchema,
        systemPrompt: 'You are helpful',
        userPrompt: 'Do something',
        primaryModel: mockPrimaryModel,
        fallbackModel: mockFallbackModel,
        maxRetries: 3,
        component: 'TestExtractor',
        phase: 'testing',
      });

      expect(result.output).toEqual({ result: 'fallback success' });
      expect(result.usage.model).toBe('fallback');
      expect(result.usage.modelName).toBe('claude-opus-4-5');
      expect(result.usage.inputTokens).toBe(200);
      expect(result.usedFallback).toBe(true);
      expect(generateText).toHaveBeenCalledTimes(2);
    });

    test('should throw fallback error when both models fail', async () => {
      const primaryError = new Error('Primary failed');
      const fallbackError = new Error('Fallback failed');

      vi.mocked(generateText).mockRejectedValueOnce(primaryError);
      vi.mocked(generateText).mockRejectedValueOnce(fallbackError);

      const error = await LLMCaller.call({
        schema: mockSchema,
        systemPrompt: 'You are helpful',
        userPrompt: 'Do something',
        primaryModel: mockPrimaryModel,
        fallbackModel: mockFallbackModel,
        maxRetries: 3,
        component: 'TestExtractor',
        phase: 'testing',
      }).catch((e) => e);

      expect(error.message).toBe('Fallback failed');
      expect(generateText).toHaveBeenCalledTimes(2);
    });

    test('should throw immediately when primary fails and abortSignal is aborted', async () => {
      const primaryError = new Error('Primary aborted');
      const abortController = new AbortController();
      abortController.abort();

      vi.mocked(generateText).mockRejectedValueOnce(primaryError);

      await expect(
        LLMCaller.call({
          schema: mockSchema,
          systemPrompt: 'You are helpful',
          userPrompt: 'Do something',
          primaryModel: mockPrimaryModel,
          fallbackModel: mockFallbackModel,
          maxRetries: 3,
          abortSignal: abortController.signal,
          component: 'TestExtractor',
          phase: 'testing',
        }),
      ).rejects.toThrow('Primary aborted');

      // Should NOT try fallback when aborted
      expect(generateText).toHaveBeenCalledOnce();
    });

    test('should pass correct parameters to generateObject', async () => {
      const mockResponse = createMockGenerateTextResult(
        { result: 'success' },
        { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      );

      vi.mocked(generateText).mockResolvedValueOnce(mockResponse);

      await LLMCaller.call({
        schema: mockSchema,
        systemPrompt: 'System prompt text',
        userPrompt: 'User prompt text',
        primaryModel: mockPrimaryModel,
        maxRetries: 5,
        temperature: 0.7,
        component: 'TestExtractor',
        phase: 'testing',
      });

      expect(generateText).toHaveBeenCalledWith({
        model: mockPrimaryModel,
        output: Output.object({ schema: mockSchema }),
        system: 'System prompt text',
        prompt: 'User prompt text',
        temperature: 0.7,
        maxRetries: 5,
      });
    });

    test('should handle missing usage information', async () => {
      const mockResponse = createMockGenerateTextResult(
        { result: 'success' },
        undefined,
      );

      vi.mocked(generateText).mockResolvedValueOnce(mockResponse);

      const result = await LLMCaller.call({
        schema: mockSchema,
        systemPrompt: 'You are helpful',
        userPrompt: 'Do something',
        primaryModel: mockPrimaryModel,
        maxRetries: 3,
        component: 'TestExtractor',
        phase: 'testing',
      });

      expect(result.usage.inputTokens).toBe(0);
      expect(result.usage.outputTokens).toBe(0);
      expect(result.usage.totalTokens).toBe(0);
    });

    test('should handle missing usage information in fallback call', async () => {
      const primaryError = new Error('Primary failed');
      const fallbackResponse = createMockGenerateTextResult(
        { result: 'fallback success' },
        undefined,
      );

      vi.mocked(generateText).mockRejectedValueOnce(primaryError);
      vi.mocked(generateText).mockResolvedValueOnce(fallbackResponse);

      const result = await LLMCaller.call({
        schema: mockSchema,
        systemPrompt: 'You are helpful',
        userPrompt: 'Do something',
        primaryModel: mockPrimaryModel,
        fallbackModel: mockFallbackModel,
        maxRetries: 3,
        component: 'TestExtractor',
        phase: 'testing',
      });

      expect(result.usage.inputTokens).toBe(0);
      expect(result.usage.outputTokens).toBe(0);
      expect(result.usage.totalTokens).toBe(0);
      expect(result.usedFallback).toBe(true);
    });

    test('should handle partial usage information in primary call', async () => {
      const mockResponse = createMockGenerateTextResult(
        { result: 'success' },
        {
          inputTokens: null as any,
          outputTokens: null as any,
          totalTokens: null as any,
        },
      );

      vi.mocked(generateText).mockResolvedValueOnce(mockResponse);

      const result = await LLMCaller.call({
        schema: mockSchema,
        systemPrompt: 'You are helpful',
        userPrompt: 'Do something',
        primaryModel: mockPrimaryModel,
        maxRetries: 3,
        component: 'TestExtractor',
        phase: 'testing',
      });

      expect(result.usage.inputTokens).toBe(0);
      expect(result.usage.outputTokens).toBe(0);
      expect(result.usage.totalTokens).toBe(0);
    });

    test('should handle partial usage information in fallback call', async () => {
      const primaryError = new Error('Primary failed');
      const fallbackResponse = createMockGenerateTextResult(
        { result: 'fallback success' },
        { inputTokens: 200, outputTokens: 75, totalTokens: null as any },
      );

      vi.mocked(generateText).mockRejectedValueOnce(primaryError);
      vi.mocked(generateText).mockResolvedValueOnce(fallbackResponse);

      const result = await LLMCaller.call({
        schema: mockSchema,
        systemPrompt: 'You are helpful',
        userPrompt: 'Do something',
        primaryModel: mockPrimaryModel,
        fallbackModel: mockFallbackModel,
        maxRetries: 3,
        component: 'TestExtractor',
        phase: 'testing',
      });

      expect(result.usage.inputTokens).toBe(200);
      expect(result.usage.outputTokens).toBe(75);
      expect(result.usage.totalTokens).toBe(0);
      expect(result.usedFallback).toBe(true);
    });
  });

  describe('callVision', () => {
    test('should successfully call vision model with messages', async () => {
      const mockResponse = createMockGenerateTextResult(
        { result: 'vision success' },
        {
          inputTokens: 500,
          outputTokens: 100,
          totalTokens: 600,
        },
      );

      vi.mocked(generateText).mockResolvedValueOnce(mockResponse);

      const messages = [
        {
          role: 'user' as const,
          content: [{ type: 'text', text: 'Analyze this image' }],
        },
      ];

      const result = await LLMCaller.callVision({
        schema: mockSchema,
        messages,
        primaryModel: mockPrimaryModel,
        maxRetries: 3,
        component: 'PageRangeParser',
        phase: 'sampling',
      });

      expect(result.output).toEqual({ result: 'vision success' });
      expect(result.usage.model).toBe('primary');
      expect(result.usage.inputTokens).toBe(500);
      expect(generateText).toHaveBeenCalledWith({
        model: mockPrimaryModel,
        output: Output.object({ schema: mockSchema }),
        messages,
        maxRetries: 3,
      });
    });

    test('should fallback with messages when vision primary fails', async () => {
      const primaryError = new Error('Vision call failed');
      const mockFallbackResponse = createMockGenerateTextResult(
        { result: 'vision fallback success' },
        {
          inputTokens: 600,
          outputTokens: 120,
          totalTokens: 720,
        },
      );

      vi.mocked(generateText).mockRejectedValueOnce(primaryError);
      vi.mocked(generateText).mockResolvedValueOnce(mockFallbackResponse);

      const messages = [
        {
          role: 'user' as const,
          content: [{ type: 'text', text: 'Analyze this' }],
        },
      ];

      const result = await LLMCaller.callVision({
        schema: mockSchema,
        messages,
        primaryModel: mockPrimaryModel,
        fallbackModel: mockFallbackModel,
        maxRetries: 3,
        component: 'PageRangeParser',
        phase: 'sampling',
      });

      expect(result.usedFallback).toBe(true);
      expect(result.usage.model).toBe('fallback');
      expect(generateText).toHaveBeenCalledTimes(2);
    });

    test('should throw if vision primary fails and no fallback provided', async () => {
      const error = new Error('Vision call failed');
      vi.mocked(generateText).mockRejectedValueOnce(error);

      const messages = [
        {
          role: 'user' as const,
          content: [{ type: 'text', text: 'Analyze this' }],
        },
      ];

      await expect(
        LLMCaller.callVision({
          schema: mockSchema,
          messages,
          primaryModel: mockPrimaryModel,
          maxRetries: 3,
          component: 'PageRangeParser',
          phase: 'sampling',
        }),
      ).rejects.toThrow('Vision call failed');

      expect(generateText).toHaveBeenCalledOnce();
    });

    test('should throw vision fallback error when both models fail', async () => {
      const primaryError = new Error('Vision primary failed');
      const fallbackError = new Error('Vision fallback failed');

      vi.mocked(generateText).mockRejectedValueOnce(primaryError);
      vi.mocked(generateText).mockRejectedValueOnce(fallbackError);

      const messages = [
        {
          role: 'user' as const,
          content: [{ type: 'text', text: 'Analyze this' }],
        },
      ];

      const error = await LLMCaller.callVision({
        schema: mockSchema,
        messages,
        primaryModel: mockPrimaryModel,
        fallbackModel: mockFallbackModel,
        maxRetries: 3,
        component: 'PageRangeParser',
        phase: 'sampling',
      }).catch((e) => e);

      expect(error.message).toBe('Vision fallback failed');
      expect(generateText).toHaveBeenCalledTimes(2);
    });

    test('should pass correct parameters to generateObject with temperature', async () => {
      const mockResponse = createMockGenerateTextResult(
        { result: 'success' },
        { inputTokens: 500, outputTokens: 100, totalTokens: 600 },
      );

      vi.mocked(generateText).mockResolvedValueOnce(mockResponse);

      const messages = [
        {
          role: 'user' as const,
          content: [{ type: 'text', text: 'Analyze this image' }],
        },
      ];

      await LLMCaller.callVision({
        schema: mockSchema,
        messages,
        primaryModel: mockPrimaryModel,
        maxRetries: 4,
        temperature: 0.5,
        component: 'VisionTest',
        phase: 'analysis',
      });

      expect(generateText).toHaveBeenCalledWith({
        model: mockPrimaryModel,
        output: Output.object({ schema: mockSchema }),
        messages,
        temperature: 0.5,
        maxRetries: 4,
      });
    });

    test('should handle missing usage information in vision call', async () => {
      const mockResponse = createMockGenerateTextResult(
        { result: 'success' },
        undefined,
      );

      vi.mocked(generateText).mockResolvedValueOnce(mockResponse);

      const messages = [
        {
          role: 'user' as const,
          content: [{ type: 'text', text: 'Analyze this' }],
        },
      ];

      const result = await LLMCaller.callVision({
        schema: mockSchema,
        messages,
        primaryModel: mockPrimaryModel,
        maxRetries: 3,
        component: 'PageRangeParser',
        phase: 'sampling',
      });

      expect(result.usage.inputTokens).toBe(0);
      expect(result.usage.outputTokens).toBe(0);
      expect(result.usage.totalTokens).toBe(0);
    });

    test('should handle missing usage information in vision fallback call', async () => {
      const primaryError = new Error('Vision primary failed');
      const fallbackResponse = createMockGenerateTextResult(
        { result: 'vision fallback success' },
        undefined,
      );

      vi.mocked(generateText).mockRejectedValueOnce(primaryError);
      vi.mocked(generateText).mockResolvedValueOnce(fallbackResponse);

      const messages = [
        {
          role: 'user' as const,
          content: [{ type: 'text', text: 'Analyze this' }],
        },
      ];

      const result = await LLMCaller.callVision({
        schema: mockSchema,
        messages,
        primaryModel: mockPrimaryModel,
        fallbackModel: mockFallbackModel,
        maxRetries: 3,
        component: 'PageRangeParser',
        phase: 'sampling',
      });

      expect(result.usage.inputTokens).toBe(0);
      expect(result.usage.outputTokens).toBe(0);
      expect(result.usage.totalTokens).toBe(0);
      expect(result.usedFallback).toBe(true);
    });

    test('should handle partial usage information in vision primary call', async () => {
      const mockResponse = createMockGenerateTextResult(
        { result: 'success' },
        { inputTokens: 500, outputTokens: 100, totalTokens: null as any },
      );

      vi.mocked(generateText).mockResolvedValueOnce(mockResponse);

      const messages = [
        {
          role: 'user' as const,
          content: [{ type: 'text', text: 'Analyze this' }],
        },
      ];

      const result = await LLMCaller.callVision({
        schema: mockSchema,
        messages,
        primaryModel: mockPrimaryModel,
        maxRetries: 3,
        component: 'PageRangeParser',
        phase: 'sampling',
      });

      expect(result.usage.inputTokens).toBe(500);
      expect(result.usage.outputTokens).toBe(100);
      expect(result.usage.totalTokens).toBe(0);
    });

    test('should handle partial usage information in vision fallback call', async () => {
      const primaryError = new Error('Vision primary failed');
      const fallbackResponse = createMockGenerateTextResult(
        { result: 'vision fallback success' },
        { inputTokens: 600, outputTokens: 120, totalTokens: null as any },
      );

      vi.mocked(generateText).mockRejectedValueOnce(primaryError);
      vi.mocked(generateText).mockResolvedValueOnce(fallbackResponse);

      const messages = [
        {
          role: 'user' as const,
          content: [{ type: 'text', text: 'Analyze this' }],
        },
      ];

      const result = await LLMCaller.callVision({
        schema: mockSchema,
        messages,
        primaryModel: mockPrimaryModel,
        fallbackModel: mockFallbackModel,
        maxRetries: 3,
        component: 'PageRangeParser',
        phase: 'sampling',
      });

      expect(result.usage.inputTokens).toBe(600);
      expect(result.usage.outputTokens).toBe(120);
      expect(result.usage.totalTokens).toBe(0);
      expect(result.usedFallback).toBe(true);
    });
  });
});
