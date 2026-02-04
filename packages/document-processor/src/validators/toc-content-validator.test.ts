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
    test('validates valid pure_toc response', () => {
      const response = {
        isValid: true,
        confidence: 0.95,
        contentType: 'pure_toc',
        extractedTocMarkdown: null,
        reason: 'Contains structured chapters with page numbers',
      };
      const result = TocContentValidationSchema.parse(response);

      expect(result).toEqual(response);
    });

    test('validates valid mixed response with extracted markdown', () => {
      const response = {
        isValid: true,
        confidence: 0.85,
        contentType: 'mixed',
        extractedTocMarkdown: '제1장 서론 ..... 1\n제2장 조사개요 ..... 5',
        reason: 'Contains both main TOC and photo index',
      };
      const result = TocContentValidationSchema.parse(response);

      expect(result).toEqual(response);
    });

    test('validates valid resource_only response', () => {
      const response = {
        isValid: false,
        confidence: 0.9,
        contentType: 'resource_only',
        extractedTocMarkdown: null,
        reason: 'Contains only photo index entries',
      };
      const result = TocContentValidationSchema.parse(response);

      expect(result).toEqual(response);
    });

    test('validates valid invalid response', () => {
      const response = {
        isValid: false,
        confidence: 0.95,
        contentType: 'invalid',
        extractedTocMarkdown: null,
        reason: 'Random body text with no TOC structure',
      };
      const result = TocContentValidationSchema.parse(response);

      expect(result).toEqual(response);
    });

    test('rejects confidence below 0', () => {
      const response = {
        isValid: true,
        confidence: -0.1,
        contentType: 'pure_toc',
        extractedTocMarkdown: null,
        reason: 'Test',
      };

      expect(() => TocContentValidationSchema.parse(response)).toThrow();
    });

    test('rejects confidence above 1', () => {
      const response = {
        isValid: true,
        confidence: 1.5,
        contentType: 'pure_toc',
        extractedTocMarkdown: null,
        reason: 'Test',
      };

      expect(() => TocContentValidationSchema.parse(response)).toThrow();
    });

    test('accepts confidence at boundaries', () => {
      const minResponse = {
        isValid: false,
        confidence: 0,
        contentType: 'invalid',
        extractedTocMarkdown: null,
        reason: 'Empty',
      };
      const maxResponse = {
        isValid: true,
        confidence: 1,
        contentType: 'pure_toc',
        extractedTocMarkdown: null,
        reason: 'Perfect',
      };

      expect(TocContentValidationSchema.parse(minResponse).confidence).toBe(0);
      expect(TocContentValidationSchema.parse(maxResponse).confidence).toBe(1);
    });

    test('rejects invalid contentType', () => {
      const response = {
        isValid: true,
        confidence: 0.9,
        contentType: 'unknown_type',
        extractedTocMarkdown: null,
        reason: 'Test',
      };

      expect(() => TocContentValidationSchema.parse(response)).toThrow();
    });
  });

  describe('validate', () => {
    test('returns invalid result for empty markdown', async () => {
      const result = await validator.validate('');

      expect(result.isValid).toBe(false);
      expect(result.confidence).toBe(1.0);
      expect(result.contentType).toBe('invalid');
      expect(result.validTocMarkdown).toBeNull();
      expect(result.reason).toBe('Empty content');
      expect(mockLLMCallerCall).not.toHaveBeenCalled();
    });

    test('returns invalid result for whitespace-only markdown', async () => {
      const result = await validator.validate('   \n  \t  ');

      expect(result.isValid).toBe(false);
      expect(result.confidence).toBe(1.0);
      expect(result.contentType).toBe('invalid');
      expect(result.validTocMarkdown).toBeNull();
      expect(mockLLMCallerCall).not.toHaveBeenCalled();
    });

    test('returns valid result with original markdown for pure_toc content', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isValid: true,
          confidence: 0.95,
          contentType: 'pure_toc',
          extractedTocMarkdown: null,
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

      expect(result.isValid).toBe(true);
      expect(result.confidence).toBe(0.95);
      expect(result.contentType).toBe('pure_toc');
      expect(result.validTocMarkdown).toBe(markdown);
      expect(mockLLMCallerCall).toHaveBeenCalledTimes(1);
    });

    test('returns valid result with extracted markdown for mixed content', async () => {
      const extractedToc = '제1장 서론 ..... 1\n제2장 조사개요 ..... 5';
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isValid: true,
          confidence: 0.85,
          contentType: 'mixed',
          extractedTocMarkdown: extractedToc,
          reason: 'Contains both main TOC and photo index',
        },
        usage: {
          component: 'TocContentValidator',
          phase: 'validation',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
        usedFallback: false,
      });

      const markdown = `제1장 서론 ..... 1
제2장 조사개요 ..... 5

사진목차
사진 1 전경 ..... 50
사진 2 유물 ..... 51`;

      const result = await validator.validate(markdown);

      expect(result.isValid).toBe(true);
      expect(result.confidence).toBe(0.85);
      expect(result.contentType).toBe('mixed');
      expect(result.validTocMarkdown).toBe(extractedToc);
    });

    test('returns invalid result for resource_only content', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isValid: false,
          confidence: 0.9,
          contentType: 'resource_only',
          extractedTocMarkdown: null,
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

      expect(result.isValid).toBe(false);
      expect(result.confidence).toBe(0.9);
      expect(result.contentType).toBe('resource_only');
      expect(result.validTocMarkdown).toBeNull();
    });

    test('returns invalid result for table index', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isValid: false,
          confidence: 0.85,
          contentType: 'resource_only',
          extractedTocMarkdown: null,
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

      expect(result.isValid).toBe(false);
      expect(result.contentType).toBe('resource_only');
    });

    test('passes correct options to LLMCaller', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isValid: true,
          confidence: 0.9,
          contentType: 'pure_toc',
          extractedTocMarkdown: null,
          reason: 'Valid TOC',
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
        output: {
          isValid: true,
          confidence: 0.9,
          contentType: 'pure_toc',
          extractedTocMarkdown: null,
          reason: 'Valid TOC',
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

      await validator.validate('- Chapter 1 ..... 1');

      expect(mockLLMCallerCall).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0,
          maxRetries: 3,
        }),
      );
    });

    test('logs validation progress with new format', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isValid: true,
          confidence: 0.85,
          contentType: 'pure_toc',
          extractedTocMarkdown: null,
          reason: 'Valid TOC',
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

      const markdown = '- Chapter 1 ..... 1\n- Chapter 2 ..... 10';
      await validator.validate(markdown);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('[TocContentValidator] Validating content'),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[TocContentValidator] Result: isValid=true, contentType=pure_toc, confidence=0.85',
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

    test('returns null validTocMarkdown when confidence below threshold for pure_toc', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isValid: true,
          confidence: 0.5,
          contentType: 'pure_toc',
          extractedTocMarkdown: null,
          reason: 'Possible TOC but uncertain',
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

      const result = await validator.validate('- Chapter 1 ..... 1');

      expect(result.isValid).toBe(true);
      expect(result.confidence).toBe(0.5);
      expect(result.validTocMarkdown).toBeNull();
    });

    test('returns null validTocMarkdown when mixed but no extractedTocMarkdown', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isValid: true,
          confidence: 0.85,
          contentType: 'mixed',
          extractedTocMarkdown: null,
          reason: 'Mixed content but could not extract main TOC',
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

      const result = await validator.validate('- Chapter 1 ..... 1');

      expect(result.contentType).toBe('mixed');
      expect(result.validTocMarkdown).toBeNull();
    });
  });

  describe('isValid', () => {
    test('returns true when isValid is true and confidence exceeds threshold', () => {
      const result = {
        isValid: true,
        confidence: 0.8,
        contentType: 'pure_toc' as const,
        validTocMarkdown: '- Chapter 1 ..... 1',
        reason: 'Valid TOC',
      };

      expect(validator.isValid(result)).toBe(true);
    });

    test('returns false when isValid is false', () => {
      const result = {
        isValid: false,
        confidence: 0.9,
        contentType: 'resource_only' as const,
        validTocMarkdown: null,
        reason: 'Not a TOC',
      };

      expect(validator.isValid(result)).toBe(false);
    });

    test('returns false when confidence is below threshold', () => {
      const result = {
        isValid: true,
        confidence: 0.5,
        contentType: 'pure_toc' as const,
        validTocMarkdown: null,
        reason: 'Maybe a TOC',
      };

      expect(validator.isValid(result)).toBe(false);
    });

    test('returns true when confidence equals threshold', () => {
      const result = {
        isValid: true,
        confidence: 0.7,
        contentType: 'pure_toc' as const,
        validTocMarkdown: '- Chapter 1 ..... 1',
        reason: 'Valid TOC',
      };

      expect(validator.isValid(result)).toBe(true);
    });

    test('uses custom confidence threshold', () => {
      const customValidator = new TocContentValidator(mockLogger, mockModel, {
        confidenceThreshold: 0.9,
      });

      const highConfidence = {
        isValid: true,
        confidence: 0.95,
        contentType: 'pure_toc' as const,
        validTocMarkdown: '- Chapter 1 ..... 1',
        reason: 'High confidence',
      };
      const lowConfidence = {
        isValid: true,
        confidence: 0.85,
        contentType: 'pure_toc' as const,
        validTocMarkdown: null,
        reason: 'Lower confidence',
      };

      expect(customValidator.isValid(highConfidence)).toBe(true);
      expect(customValidator.isValid(lowConfidence)).toBe(false);
    });

    test('returns false when both isValid is false and confidence is low', () => {
      const result = {
        isValid: false,
        confidence: 0.3,
        contentType: 'invalid' as const,
        validTocMarkdown: null,
        reason: 'Definitely not a TOC',
      };

      expect(validator.isValid(result)).toBe(false);
    });
  });

  describe('getValidMarkdown', () => {
    test('returns validTocMarkdown from result', () => {
      const markdown = '- Chapter 1 ..... 1\n- Chapter 2 ..... 10';
      const result = {
        isValid: true,
        confidence: 0.9,
        contentType: 'pure_toc' as const,
        validTocMarkdown: markdown,
        reason: 'Valid TOC',
      };

      expect(validator.getValidMarkdown(result)).toBe(markdown);
    });

    test('returns null when validTocMarkdown is null', () => {
      const result = {
        isValid: false,
        confidence: 0.9,
        contentType: 'resource_only' as const,
        validTocMarkdown: null,
        reason: 'Resource only',
      };

      expect(validator.getValidMarkdown(result)).toBeNull();
    });
  });

  describe('edge cases', () => {
    test('handles Korean TOC content', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isValid: true,
          confidence: 0.92,
          contentType: 'pure_toc',
          extractedTocMarkdown: null,
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

      expect(result.isValid).toBe(true);
      expect(result.confidence).toBe(0.92);
      expect(result.contentType).toBe('pure_toc');
      expect(result.validTocMarkdown).toBe(markdown);
    });

    test('handles mixed content detection and extraction', async () => {
      const extractedToc = '- Chapter 1 Introduction ..... 1';
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isValid: true,
          confidence: 0.75,
          contentType: 'mixed',
          extractedTocMarkdown: extractedToc,
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

      expect(result.isValid).toBe(true);
      expect(result.contentType).toBe('mixed');
      expect(result.validTocMarkdown).toBe(extractedToc);
    });

    test('handles single entry content as invalid', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isValid: false,
          confidence: 0.88,
          contentType: 'invalid',
          extractedTocMarkdown: null,
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

      expect(result.isValid).toBe(false);
      expect(result.contentType).toBe('invalid');
      expect(result.validTocMarkdown).toBeNull();
    });

    test('handles content without page numbers as invalid', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isValid: false,
          confidence: 0.82,
          contentType: 'invalid',
          extractedTocMarkdown: null,
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

      expect(result.isValid).toBe(false);
      expect(result.contentType).toBe('invalid');
    });

    test('reason is expected to be in English', async () => {
      mockLLMCallerCall.mockResolvedValueOnce({
        output: {
          isValid: true,
          confidence: 0.9,
          contentType: 'pure_toc',
          extractedTocMarkdown: null,
          reason: 'Valid table of contents with chapters and page numbers',
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

      const result = await validator.validate('- Chapter 1 ..... 1');

      // Verify reason contains English text (basic check for Latin characters)
      expect(result.reason).toMatch(/[a-zA-Z]/);
    });
  });
});
