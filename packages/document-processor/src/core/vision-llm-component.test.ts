import type { LoggerMethods } from '@heripo/logger';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import { LLMCaller } from '@heripo/shared';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';

import { VisionLLMComponent } from './vision-llm-component';

vi.mock('@heripo/shared', () => ({
  LLMCaller: {
    callVision: vi.fn(),
  },
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

/**
 * Concrete implementation for testing abstract class
 */
class TestVisionComponent extends VisionLLMComponent {
  protected buildSystemPrompt(): string {
    return 'Test system prompt';
  }

  protected buildUserPrompt(input: string): string {
    return `Test user prompt: ${input}`;
  }

  // Expose protected methods for testing
  public async testCallVisionLLM<TSchema extends z.ZodType>(
    schema: TSchema,
    messages: Array<{
      role: 'user' | 'assistant';
      content: unknown[] | string;
    }>,
    phase: string,
  ) {
    return this.callVisionLLM(schema, messages, phase);
  }

  public testBuildImageContent(imagePath: string, mimeType?: string) {
    return this.buildImageContent(imagePath, mimeType);
  }

  public getArtifactDir(): string {
    return this.artifactDir;
  }
}

describe('VisionLLMComponent', () => {
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

  describe('constructor', () => {
    test('should set artifactDir correctly', () => {
      const component = new TestVisionComponent(
        mockLogger,
        mockModel,
        'TestComponent',
        '/test/output/path',
      );

      expect(component.getArtifactDir()).toBe('/test/output/path');
    });

    test('should pass options to base class', () => {
      const component = new TestVisionComponent(
        mockLogger,
        mockModel,
        'TestComponent',
        '/output',
        { maxRetries: 5, temperature: 0.5 },
        mockFallbackModel,
        mockAggregator,
      );

      expect(component.getArtifactDir()).toBe('/output');
    });
  });

  describe('callVisionLLM()', () => {
    test('should call LLMCaller.callVision() with correct configuration', async () => {
      const component = new TestVisionComponent(
        mockLogger,
        mockModel,
        'TestComponent',
        '/output',
        { maxRetries: 5, temperature: 0.5 },
        mockFallbackModel,
        mockAggregator,
      );

      const testSchema = z.object({ result: z.string() });
      const testMessages = [
        {
          role: 'user' as const,
          content: [{ type: 'text', text: 'Test' }],
        },
      ];
      const mockUsage = {
        component: 'TestComponent',
        phase: 'test-phase',
        model: 'primary' as const,
        modelName: 'test-model',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };

      vi.mocked(LLMCaller.callVision).mockResolvedValue({
        output: { result: 'test-result' },
        usage: mockUsage,
        usedFallback: false,
      });

      await component.testCallVisionLLM(testSchema, testMessages, 'test-phase');

      expect(LLMCaller.callVision).toHaveBeenCalledWith({
        schema: testSchema,
        messages: testMessages,
        primaryModel: mockModel,
        fallbackModel: mockFallbackModel,
        maxRetries: 5,
        temperature: 0.5,
        component: 'TestComponent',
        phase: 'test-phase',
      });
    });

    test('should return object and usage from LLMCaller result', async () => {
      const component = new TestVisionComponent(
        mockLogger,
        mockModel,
        'TestComponent',
        '/output',
      );

      const testSchema = z.object({ pages: z.array(z.number()) });
      const mockUsage = {
        component: 'TestComponent',
        phase: 'sampling',
        model: 'primary' as const,
        modelName: 'test-model',
        inputTokens: 500,
        outputTokens: 100,
        totalTokens: 600,
      };

      vi.mocked(LLMCaller.callVision).mockResolvedValue({
        output: { pages: [1, 2, 3] },
        usage: mockUsage,
        usedFallback: false,
      });

      const result = await component.testCallVisionLLM(
        testSchema,
        [{ role: 'user', content: 'test' }],
        'sampling',
      );

      expect(result.output).toEqual({ pages: [1, 2, 3] });
      expect(result.usage).toEqual(mockUsage);
    });

    test('should track usage when aggregator is provided', async () => {
      const component = new TestVisionComponent(
        mockLogger,
        mockModel,
        'TestComponent',
        '/output',
        undefined,
        undefined,
        mockAggregator,
      );

      const testSchema = z.object({ data: z.string() });
      const mockUsage = {
        component: 'TestComponent',
        phase: 'extraction',
        model: 'primary' as const,
        modelName: 'test-model',
        inputTokens: 200,
        outputTokens: 50,
        totalTokens: 250,
      };

      vi.mocked(LLMCaller.callVision).mockResolvedValue({
        output: { data: 'test' },
        usage: mockUsage,
        usedFallback: false,
      });

      await component.testCallVisionLLM(
        testSchema,
        [{ role: 'user', content: 'test' }],
        'extraction',
      );

      expect(mockAggregator.track).toHaveBeenCalledWith(mockUsage);
    });

    test('should propagate errors from LLMCaller', async () => {
      const component = new TestVisionComponent(
        mockLogger,
        mockModel,
        'TestComponent',
        '/output',
      );

      const testSchema = z.object({ result: z.string() });
      const error = new Error('Vision LLM call failed');

      vi.mocked(LLMCaller.callVision).mockRejectedValue(error);

      await expect(
        component.testCallVisionLLM(
          testSchema,
          [{ role: 'user', content: 'test' }],
          'test',
        ),
      ).rejects.toThrow('Vision LLM call failed');
    });
  });

  describe('buildImageContent()', () => {
    test('should build image content with default mime type', () => {
      const component = new TestVisionComponent(
        mockLogger,
        mockModel,
        'TestComponent',
        '/output',
      );

      const testBuffer = Buffer.from('image data');
      vi.mocked(fs.readFileSync).mockReturnValue(testBuffer);

      const result = component.testBuildImageContent('images/test.png');

      expect(fs.readFileSync).toHaveBeenCalledWith(
        path.resolve('/output', 'images/test.png'),
      );
      expect(result).toEqual({
        type: 'image',
        image: new Uint8Array(testBuffer),
        mediaType: 'image/png',
      });
    });

    test('should build image content with custom mime type', () => {
      const component = new TestVisionComponent(
        mockLogger,
        mockModel,
        'TestComponent',
        '/output',
      );

      const testBuffer = Buffer.from('jpeg data');
      vi.mocked(fs.readFileSync).mockReturnValue(testBuffer);

      const result = component.testBuildImageContent('photo.jpg', 'image/jpeg');

      expect(result).toEqual({
        type: 'image',
        image: new Uint8Array(testBuffer),
        mediaType: 'image/jpeg',
      });
    });

    test('should handle absolute paths correctly', () => {
      const component = new TestVisionComponent(
        mockLogger,
        mockModel,
        'TestComponent',
        '/output',
      );

      const testBuffer = Buffer.from('absolute path image');
      vi.mocked(fs.readFileSync).mockReturnValue(testBuffer);

      component.testBuildImageContent('/absolute/path/image.png');

      expect(fs.readFileSync).toHaveBeenCalledWith('/absolute/path/image.png');
    });

    test('should resolve relative paths against artifactDir', () => {
      const component = new TestVisionComponent(
        mockLogger,
        mockModel,
        'TestComponent',
        '/base/output',
      );

      const testBuffer = Buffer.from('relative path image');
      vi.mocked(fs.readFileSync).mockReturnValue(testBuffer);

      component.testBuildImageContent('pages/page_0.png');

      expect(fs.readFileSync).toHaveBeenCalledWith(
        path.resolve('/base/output', 'pages/page_0.png'),
      );
    });
  });
});
