import type { LoggerMethods } from '@heripo/logger';
import type { LanguageModel } from 'ai';

import { LLMCaller } from '@heripo/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  TocContentValidationSchema,
  TocContentValidator,
} from './toc-content-validator';

vi.mock('@heripo/shared', () => ({
  LLMCaller: {
    call: vi.fn(),
  },
}));

const mockLLMCallerCall = vi.mocked(LLMCaller.call);

describe('TocContentValidator', () => {
  let mockModel: LanguageModel;
  let mockLogger: LoggerMethods;
  let validator: TocContentValidator;

  beforeEach(() => {
    mockLLMCallerCall.mockClear();
    mockModel = { modelId: 'test-model' } as LanguageModel;
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    validator = new TocContentValidator(mockLogger, mockModel);
  });

  describe('TocContentValidationSchema', () => {
    test('validates valid response', () => {
      const response = {
        isToc: true,
        confidence: 0.95,
        reason: 'Contains structured chapters with page numbers',
      };
      const result = TocContentValidationSchema.parse(response);

      expect(result).toEqual(response);
    });

    test('rejects confidence below 0', () => {
      const response = {
        isToc: true,
        confidence: -0.1,
        reason: 'Test',
      };

      expect(() => TocContentValidationSchema.parse(response)).toThrow();
    });

    test('rejects confidence above 1', () => {
      const response = {
        isToc: true,
        confidence: 1.5,
        reason: 'Test',
      };

      expect(() => TocContentValidationSchema.parse(response)).toThrow();
    });

    test('accepts confidence at boundaries', () => {
      const minResponse = { isToc: false, confidence: 0, reason: 'Empty' };
      const maxResponse = { isToc: true, confidence: 1, reason: 'Perfect' };

      expect(TocContentValidationSchema.parse(minResponse).confidence).toBe(0);
      expect(TocContentValidationSchema.parse(maxResponse).confidence).toBe(1);
    });
  });

  describe('validate', () => {
    test('returns invalid result for empty markdown', async () => {
      const result = await validator.validate('');

      expect(result.isToc).toBe(false);
      expect(result.confidence).toBe(1.0);
      expect(result.reason).toBe('Empty content');
      expect(mockLLMCallerCall).not.toHaveBeenCalled();
    });

    test('returns invalid result for whitespace-only markdown', async () => {
      const result = await validator.validate('   \n  \t  ');

      expect(result.isToc).toBe(false);
      expect(result.confidence).toBe(1.0);
      expect(mockLLMCallerCall).not.toHaveBeenCalled();
    });

    test('returns valid result for TOC content', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isToc: true,
          confidence: 0.95,
          reason: 'Contains structured chapters with page numbers',
        },
        usage: {
          component: 'TocContentValidator',
          phase: 'validation',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
        usedFallback: false,
      });

      const markdown = `- Chapter 1 Introduction ..... 1
- Chapter 2 Methods ..... 10
- Chapter 3 Results ..... 25`;

      const result = await validator.validate(markdown);

      expect(result.isToc).toBe(true);
      expect(result.confidence).toBe(0.95);
      expect(mockLLMCallerCall).toHaveBeenCalledTimes(1);
    });

    test('returns invalid result for photo index', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isToc: false,
          confidence: 0.9,
          reason: 'This is a photo index, not a main document TOC',
        },
        usage: {
          component: 'TocContentValidator',
          phase: 'validation',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
        usedFallback: false,
      });

      const markdown = `- Photo 1 Aerial view ..... 5
- Photo 2 Site overview ..... 8
- Photo 3 Artifacts ..... 12`;

      const result = await validator.validate(markdown);

      expect(result.isToc).toBe(false);
      expect(result.confidence).toBe(0.9);
    });

    test('returns invalid result for table index', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isToc: false,
          confidence: 0.85,
          reason: 'This is a table index listing tables, not main TOC',
        },
        usage: {
          component: 'TocContentValidator',
          phase: 'validation',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
        usedFallback: false,
      });

      const markdown = `| Table | Description | Page |
| --- | --- | --- |
| Table 1 | Statistics | 15 |
| Table 2 | Measurements | 22 |`;

      const result = await validator.validate(markdown);

      expect(result.isToc).toBe(false);
    });

    test('passes correct options to LLMCaller', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: { isToc: true, confidence: 0.9, reason: 'Valid TOC' },
        usage: {
          component: 'TocContentValidator',
          phase: 'validation',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
        usedFallback: false,
      });

      const customValidator = new TocContentValidator(mockLogger, mockModel, {
        maxRetries: 5,
        temperature: 0.2,
      });

      await customValidator.validate('- Chapter 1 ..... 1');

      expect(mockLLMCallerCall).toHaveBeenCalledWith(
        expect.objectContaining({
          primaryModel: mockModel,
          temperature: 0.2,
          maxRetries: 5,
          component: 'TocContentValidator',
          phase: 'validation',
        }),
      );
    });

    test('uses default options', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: { isToc: true, confidence: 0.9, reason: 'Valid TOC' },
        usage: {
          component: 'TocContentValidator',
          phase: 'validation',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
        usedFallback: false,
      });

      await validator.validate('- Chapter 1 ..... 1');

      expect(mockLLMCallerCall).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0,
          maxRetries: 3,
        }),
      );
    });

    test('logs validation progress', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: { isToc: true, confidence: 0.85, reason: 'Valid TOC' },
        usage: {
          component: 'TocContentValidator',
          phase: 'validation',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
        usedFallback: false,
      });

      const markdown = '- Chapter 1 ..... 1\n- Chapter 2 ..... 10';
      await validator.validate(markdown);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('[TocContentValidator] Validating content'),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[TocContentValidator] Result: isToc=true, confidence=0.85',
      );
    });

    test('logs empty markdown detection', async () => {
      await validator.validate('');

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[TocContentValidator] Empty markdown, returning invalid',
      );
    });

    test('propagates LLM errors', async () => {
      mockLLMCallerCall.mockRejectedValueOnce(new Error('API rate limit'));

      await expect(validator.validate('- Chapter 1 ..... 1')).rejects.toThrow(
        'API rate limit',
      );
    });
  });

  describe('isValid', () => {
    test('returns true when isToc is true and confidence exceeds threshold', () => {
      const result = { isToc: true, confidence: 0.8, reason: 'Valid TOC' };

      expect(validator.isValid(result)).toBe(true);
    });

    test('returns false when isToc is false', () => {
      const result = { isToc: false, confidence: 0.9, reason: 'Not a TOC' };

      expect(validator.isValid(result)).toBe(false);
    });

    test('returns false when confidence is below threshold', () => {
      const result = {
        isToc: true,
        confidence: 0.5,
        reason: 'Maybe a TOC',
      };

      expect(validator.isValid(result)).toBe(false);
    });

    test('returns true when confidence equals threshold', () => {
      const result = { isToc: true, confidence: 0.7, reason: 'Valid TOC' };

      expect(validator.isValid(result)).toBe(true);
    });

    test('uses custom confidence threshold', () => {
      const customValidator = new TocContentValidator(mockLogger, mockModel, {
        confidenceThreshold: 0.9,
      });

      const highConfidence = {
        isToc: true,
        confidence: 0.95,
        reason: 'High confidence',
      };
      const lowConfidence = {
        isToc: true,
        confidence: 0.85,
        reason: 'Lower confidence',
      };

      expect(customValidator.isValid(highConfidence)).toBe(true);
      expect(customValidator.isValid(lowConfidence)).toBe(false);
    });

    test('returns false when both isToc is false and confidence is low', () => {
      const result = {
        isToc: false,
        confidence: 0.3,
        reason: 'Definitely not a TOC',
      };

      expect(validator.isValid(result)).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('handles Korean TOC content', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isToc: true,
          confidence: 0.92,
          reason: 'Korean document TOC with chapters and page numbers',
        },
        usage: {
          component: 'TocContentValidator',
          phase: 'validation',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
        usedFallback: false,
      });

      const markdown = `- 제1장 서론 ..... 1
- 제2장 연구 방법 ..... 10
- 제3장 결과 ..... 25`;

      const result = await validator.validate(markdown);

      expect(result.isToc).toBe(true);
      expect(result.confidence).toBe(0.92);
    });

    test('handles mixed content detection', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isToc: false,
          confidence: 0.75,
          reason: 'Contains both TOC and photo index mixed together',
        },
        usage: {
          component: 'TocContentValidator',
          phase: 'validation',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
        usedFallback: false,
      });

      const markdown = `- Chapter 1 Introduction ..... 1
- 사진 목차
- Photo 1 Overview ..... 5`;

      const result = await validator.validate(markdown);

      expect(result.isToc).toBe(false);
    });

    test('handles single entry content', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isToc: false,
          confidence: 0.88,
          reason: 'Only single entry, not a complete TOC',
        },
        usage: {
          component: 'TocContentValidator',
          phase: 'validation',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
        usedFallback: false,
      });

      const markdown = '- Chapter 1 ..... 1';

      const result = await validator.validate(markdown);

      expect(result.isToc).toBe(false);
    });

    test('handles content without page numbers', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isToc: false,
          confidence: 0.82,
          reason: 'No page number references found',
        },
        usage: {
          component: 'TocContentValidator',
          phase: 'validation',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
        usedFallback: false,
      });

      const markdown = `- Chapter 1 Introduction
- Chapter 2 Methods
- Chapter 3 Results`;

      const result = await validator.validate(markdown);

      expect(result.isToc).toBe(false);
    });
  });
});
