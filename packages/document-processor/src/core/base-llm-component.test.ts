import type { LoggerMethods } from '@heripo/logger';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { BaseLLMComponent } from './base-llm-component';

/**
 * Concrete implementation for testing abstract class
 */
class TestLLMComponent extends BaseLLMComponent {
  protected buildSystemPrompt(): string {
    return 'Test system prompt';
  }

  protected buildUserPrompt(input: string): string {
    return `Test user prompt: ${input}`;
  }

  // Expose protected methods for testing
  public testLog(
    level: 'info' | 'warn' | 'error',
    message: string,
    ...args: unknown[]
  ): void {
    this.log(level, message, ...args);
  }

  public testTrackUsage(usage: Parameters<BaseLLMComponent['trackUsage']>[0]) {
    this.trackUsage(usage);
  }

  public testCreateEmptyUsage(phase: string) {
    return this.createEmptyUsage(phase);
  }

  public getComponentName(): string {
    return this.componentName;
  }

  public getMaxRetries(): number {
    return this.maxRetries;
  }

  public getTemperature(): number {
    return this.temperature;
  }

  public getModel(): LanguageModel {
    return this.model;
  }

  public getFallbackModel(): LanguageModel | undefined {
    return this.fallbackModel;
  }

  public getAggregator(): LLMTokenUsageAggregator | undefined {
    return this.aggregator;
  }
}

describe('BaseLLMComponent', () => {
  let mockLogger: LoggerMethods;
  let mockModel: LanguageModel;
  let mockFallbackModel: LanguageModel;
  let mockAggregator: LLMTokenUsageAggregator;

  beforeEach(() => {
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
    test('should set default options when not provided', () => {
      const component = new TestLLMComponent(
        mockLogger,
        mockModel,
        'TestComponent',
      );

      expect(component.getMaxRetries()).toBe(3);
      expect(component.getTemperature()).toBe(0);
      expect(component.getComponentName()).toBe('TestComponent');
      expect(component.getModel()).toBe(mockModel);
      expect(component.getFallbackModel()).toBeUndefined();
      expect(component.getAggregator()).toBeUndefined();
    });

    test('should use provided options', () => {
      const component = new TestLLMComponent(
        mockLogger,
        mockModel,
        'TestComponent',
        { maxRetries: 5, temperature: 0.5 },
        mockFallbackModel,
        mockAggregator,
      );

      expect(component.getMaxRetries()).toBe(5);
      expect(component.getTemperature()).toBe(0.5);
      expect(component.getFallbackModel()).toBe(mockFallbackModel);
      expect(component.getAggregator()).toBe(mockAggregator);
    });

    test('should use partial options with defaults for missing values', () => {
      const component = new TestLLMComponent(
        mockLogger,
        mockModel,
        'TestComponent',
        { maxRetries: 10 },
      );

      expect(component.getMaxRetries()).toBe(10);
      expect(component.getTemperature()).toBe(0);
    });
  });

  describe('log()', () => {
    test('should format messages with component name prefix for info level', () => {
      const component = new TestLLMComponent(
        mockLogger,
        mockModel,
        'TestComponent',
      );

      component.testLog('info', 'Test message');

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[TestComponent] Test message',
      );
    });

    test('should format messages with component name prefix for warn level', () => {
      const component = new TestLLMComponent(
        mockLogger,
        mockModel,
        'TestComponent',
      );

      component.testLog('warn', 'Warning message');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[TestComponent] Warning message',
      );
    });

    test('should format messages with component name prefix for error level', () => {
      const component = new TestLLMComponent(
        mockLogger,
        mockModel,
        'TestComponent',
      );

      component.testLog('error', 'Error message');

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[TestComponent] Error message',
      );
    });

    test('should pass additional arguments to logger', () => {
      const component = new TestLLMComponent(
        mockLogger,
        mockModel,
        'TestComponent',
      );
      const errorObj = new Error('test error');

      component.testLog('error', 'Error occurred', errorObj);

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[TestComponent] Error occurred',
        errorObj,
      );
    });

    test('should pass multiple additional arguments to logger', () => {
      const component = new TestLLMComponent(
        mockLogger,
        mockModel,
        'TestComponent',
      );

      component.testLog('info', 'Processing', 'arg1', 123, { key: 'value' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[TestComponent] Processing',
        'arg1',
        123,
        { key: 'value' },
      );
    });
  });

  describe('trackUsage()', () => {
    test('should call aggregator.track() when aggregator is provided', () => {
      const component = new TestLLMComponent(
        mockLogger,
        mockModel,
        'TestComponent',
        undefined,
        undefined,
        mockAggregator,
      );

      const usage = {
        component: 'TestComponent',
        phase: 'test',
        model: 'primary' as const,
        modelName: 'test-model',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };

      component.testTrackUsage(usage);

      expect(mockAggregator.track).toHaveBeenCalledWith(usage);
    });

    test('should not throw when no aggregator is provided', () => {
      const component = new TestLLMComponent(
        mockLogger,
        mockModel,
        'TestComponent',
      );

      const usage = {
        component: 'TestComponent',
        phase: 'test',
        model: 'primary' as const,
        modelName: 'test-model',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };

      expect(() => component.testTrackUsage(usage)).not.toThrow();
    });
  });

  describe('createEmptyUsage()', () => {
    test('should return correct structure with component name', () => {
      const component = new TestLLMComponent(
        mockLogger,
        mockModel,
        'TestComponent',
      );

      const usage = component.testCreateEmptyUsage('extraction');

      expect(usage).toEqual({
        component: 'TestComponent',
        phase: 'extraction',
        model: 'primary',
        modelName: 'none',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
    });

    test('should use different phase names correctly', () => {
      const component = new TestLLMComponent(mockLogger, mockModel, 'MyParser');

      const usage = component.testCreateEmptyUsage('validation');

      expect(usage.component).toBe('MyParser');
      expect(usage.phase).toBe('validation');
    });
  });

  describe('abstract methods', () => {
    test('should allow subclass to implement buildSystemPrompt()', () => {
      const component = new TestLLMComponent(
        mockLogger,
        mockModel,
        'TestComponent',
      );

      // Access protected method via type assertion for testing
      const systemPrompt = (
        component as unknown as { buildSystemPrompt: () => string }
      ).buildSystemPrompt();

      expect(systemPrompt).toBe('Test system prompt');
    });

    test('should allow subclass to implement buildUserPrompt()', () => {
      const component = new TestLLMComponent(
        mockLogger,
        mockModel,
        'TestComponent',
      );

      // Access protected method via type assertion for testing
      const userPrompt = (
        component as unknown as { buildUserPrompt: (input: string) => string }
      ).buildUserPrompt('test input');

      expect(userPrompt).toBe('Test user prompt: test input');
    });
  });
});
