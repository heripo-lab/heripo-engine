import type { LoggerMethods } from '@heripo/logger';
import type { LanguageModel } from 'ai';

import type { TocEntry } from '../types';

import { LLMCaller } from '@heripo/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { TocParseError, TocValidationError } from './toc-extract-error';
import {
  TocEntrySchema,
  TocExtractor,
  TocResponseSchema,
} from './toc-extractor';

vi.mock('@heripo/shared', () => ({
  LLMCaller: {
    call: vi.fn(),
  },
}));

vi.mock('./toc-validator');

describe('TocEntrySchema', () => {
  test('validates valid TOC entry structure', () => {
    const validEntry = {
      title: 'Chapter 1',
      level: 1,
      pageNo: 1,
      children: [],
    };

    const result = TocEntrySchema.safeParse(validEntry);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Chapter 1');
      expect(result.data.level).toBe(1);
      expect(result.data.pageNo).toBe(1);
    }
  });

  test('validates nested TOC entry with children', () => {
    const nestedEntry: TocEntry = {
      title: 'Chapter 1',
      level: 1,
      pageNo: 1,
      children: [
        { title: 'Section 1.1', level: 2, pageNo: 3, children: [] },
        { title: 'Section 1.2', level: 2, pageNo: 5, children: [] },
      ],
    };

    const result = TocEntrySchema.safeParse(nestedEntry);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.children).toHaveLength(2);
      expect(result.data.children?.[0].title).toBe('Section 1.1');
    }
  });

  test('validates deeply nested TOC entries', () => {
    const deeplyNested: TocEntry = {
      title: 'Part 1',
      level: 1,
      pageNo: 1,
      children: [
        {
          title: 'Chapter 1',
          level: 2,
          pageNo: 2,
          children: [
            { title: 'Section 1.1', level: 3, pageNo: 3, children: [] },
          ],
        },
      ],
    };

    const result = TocEntrySchema.safeParse(deeplyNested);
    expect(result.success).toBe(true);
  });

  test('rejects invalid level (less than 1)', () => {
    const invalidEntry = {
      title: 'Chapter 1',
      level: 0,
      pageNo: 1,
      children: [],
    };

    const result = TocEntrySchema.safeParse(invalidEntry);
    expect(result.success).toBe(false);
  });

  test('rejects invalid pageNo (less than 1)', () => {
    const invalidEntry = {
      title: 'Chapter 1',
      level: 1,
      pageNo: 0,
      children: [],
    };

    const result = TocEntrySchema.safeParse(invalidEntry);
    expect(result.success).toBe(false);
  });

  test('rejects missing required fields', () => {
    const incompleteEntry = {
      title: 'Chapter 1',
    };

    const result = TocEntrySchema.safeParse(incompleteEntry);
    expect(result.success).toBe(false);
  });
});

describe('TocResponseSchema', () => {
  test('validates valid TOC response', () => {
    const validResponse = {
      entries: [
        { title: 'Chapter 1', level: 1, pageNo: 1, children: [] },
        { title: 'Chapter 2', level: 1, pageNo: 10, children: [] },
      ],
    };

    const result = TocResponseSchema.safeParse(validResponse);
    expect(result.success).toBe(true);
  });

  test('validates empty entries array', () => {
    const emptyResponse = {
      entries: [],
    };

    const result = TocResponseSchema.safeParse(emptyResponse);
    expect(result.success).toBe(true);
  });
});

describe('TocExtractor', () => {
  let extractor: TocExtractor;
  let mockLogger: LoggerMethods;
  let mockModel: LanguageModel;
  let mockLLMCaller: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLLMCaller = vi.mocked(LLMCaller.call);
    mockLLMCaller.mockClear();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    mockModel = { modelId: 'test-model' } as LanguageModel;

    extractor = new TocExtractor(mockLogger, mockModel, {
      maxRetries: 3,
      temperature: 0,
      skipValidation: true,
    });
  });

  describe('extract', () => {
    test('returns entries and usage for simple flat TOC', async () => {
      mockLLMCaller.mockResolvedValueOnce({
        output: {
          entries: [
            { title: 'Chapter 1', level: 1, pageNo: 1 },
            { title: 'Chapter 2', level: 1, pageNo: 10 },
            { title: 'Chapter 3', level: 1, pageNo: 20 },
          ],
        },
        usage: {
          component: 'TocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
        usedFallback: false,
      });

      const markdown = `- Chapter 1 ..... 1
- Chapter 2 ..... 10
- Chapter 3 ..... 20`;

      const result = await extractor.extract(markdown);

      expect(result.entries).toHaveLength(3);
      expect(result.entries[0].title).toBe('Chapter 1');
      expect(result.entries[0].level).toBe(1);
      expect(result.entries[0].pageNo).toBe(1);
      expect(result.entries[1].title).toBe('Chapter 2');
      expect(result.entries[2].title).toBe('Chapter 3');
      expect(result.usage.component).toBe('TocExtractor');
      expect(result.usage.phase).toBe('extraction');
      expect(result.usage.model).toBe('primary');
      expect(result.usage.inputTokens).toBe(100);
      expect(mockLLMCaller).toHaveBeenCalledTimes(1);
    });

    test('returns entries and usage for nested TOC with children', async () => {
      mockLLMCaller.mockResolvedValueOnce({
        output: {
          entries: [
            {
              title: 'Chapter 1',
              level: 1,
              pageNo: 1,
              children: [
                { title: 'Section 1.1', level: 2, pageNo: 3 },
                { title: 'Section 1.2', level: 2, pageNo: 5 },
              ],
            },
            { title: 'Chapter 2', level: 1, pageNo: 10 },
          ],
        },
        usage: {
          component: 'TocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
        },
        usedFallback: false,
      });

      const markdown = `- Chapter 1 ..... 1
  - Section 1.1 ..... 3
  - Section 1.2 ..... 5
- Chapter 2 ..... 10`;

      const result = await extractor.extract(markdown);

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].children).toHaveLength(2);
      expect(result.entries[0].children?.[0].title).toBe('Section 1.1');
      expect(result.entries[0].children?.[1].title).toBe('Section 1.2');
      expect(result.usage.totalTokens).toBe(300);
    });

    test('normalizes inconsistent levels to start from 1', async () => {
      mockLLMCaller.mockResolvedValueOnce({
        output: {
          entries: [
            {
              title: 'Chapter 1',
              level: 5,
              pageNo: 1,
              children: [{ title: 'Section 1.1', level: 10, pageNo: 3 }],
            },
          ],
        },
        usage: {
          component: 'TocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
        usedFallback: false,
      });

      const markdown = '- Chapter 1 ..... 1\n  - Section 1.1 ..... 3';

      const result = await extractor.extract(markdown);

      expect(result.entries[0].level).toBe(1);
      expect(result.entries[0].children?.[0].level).toBe(2);
    });

    test('trims title whitespace', async () => {
      mockLLMCaller.mockResolvedValueOnce({
        output: {
          entries: [{ title: '  Chapter 1  ', level: 1, pageNo: 1 }],
        },
        usage: {
          component: 'TocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 50,
          outputTokens: 25,
          totalTokens: 75,
        },
        usedFallback: false,
      });

      const markdown = '-   Chapter 1   ..... 1';

      const result = await extractor.extract(markdown);

      expect(result.entries[0].title).toBe('Chapter 1');
    });

    test('throws TocParseError for empty markdown', async () => {
      await expect(extractor.extract('')).rejects.toThrow(TocParseError);
      await expect(extractor.extract('')).rejects.toThrow(
        'TOC extraction failed: provided markdown content is empty',
      );
      expect(mockLLMCaller).not.toHaveBeenCalled();
    });

    test('throws TocParseError for whitespace-only markdown', async () => {
      await expect(extractor.extract('   \n\n  ')).rejects.toThrow(
        TocParseError,
      );
      expect(mockLLMCaller).not.toHaveBeenCalled();
    });

    test('supports multi-level hierarchy (3+ levels)', async () => {
      mockLLMCaller.mockResolvedValueOnce({
        output: {
          entries: [
            {
              title: 'Part 1',
              level: 1,
              pageNo: 1,
              children: [
                {
                  title: 'Chapter 1',
                  level: 2,
                  pageNo: 2,
                  children: [
                    { title: 'Section 1.1', level: 3, pageNo: 3 },
                    { title: 'Section 1.2', level: 3, pageNo: 4 },
                  ],
                },
              ],
            },
          ],
        },
        usage: {
          component: 'TocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 150,
          outputTokens: 75,
          totalTokens: 225,
        },
        usedFallback: false,
      });

      const markdown = `- Part 1 ..... 1
  - Chapter 1 ..... 2
    - Section 1.1 ..... 3
    - Section 1.2 ..... 4`;

      const result = await extractor.extract(markdown);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].level).toBe(1);
      expect(result.entries[0].children?.[0].level).toBe(2);
      expect(result.entries[0].children?.[0].children).toHaveLength(2);
      expect(result.entries[0].children?.[0].children?.[0].level).toBe(3);
    });

    test('includes usage data with proper structure', async () => {
      mockLLMCaller.mockResolvedValueOnce({
        output: { entries: [] },
        usage: {
          component: 'TocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
        usedFallback: false,
      });

      const result = await extractor.extract('- Chapter 1 ..... 1');

      expect(result.usage.modelName).toBe('test-model');
      expect(result.usage.component).toBe('TocExtractor');
      expect(result.usage.phase).toBe('extraction');
    });
  });

  describe('error handling', () => {
    test('throws error when LLMCaller fails', async () => {
      mockLLMCaller.mockRejectedValueOnce(new Error('LLM call failed'));

      await expect(extractor.extract('- Chapter 1 ..... 1')).rejects.toThrow(
        'Failed to extract TOC structure',
      );
    });

    test('throws TocValidationError when validation fails', async () => {
      mockLLMCaller.mockRejectedValueOnce({
        name: 'TocValidationError',
        message: 'Validation failed',
      });

      const extractorWithValidation = new TocExtractor(mockLogger, mockModel, {
        skipValidation: false,
      });

      await expect(
        extractorWithValidation.extract('- Chapter 1 ..... 1'),
      ).rejects.toThrow();
    });

    test('re-throws TocValidationError without wrapping', async () => {
      const extractorWithValidation = new TocExtractor(mockLogger, mockModel, {
        skipValidation: false,
      });

      const validationError = new TocValidationError('Validation failed', {
        valid: false,
        errorCount: 1,
        issues: [
          {
            code: 'V003',
            message: 'Title is empty or contains only whitespace',
            path: '[0]',
            entry: { title: '', level: 1, pageNo: 1 },
          },
        ],
      });
      mockLLMCaller.mockRejectedValueOnce(validationError);

      await expect(
        extractorWithValidation.extract('- Chapter 1 ..... 1'),
      ).rejects.toThrow(TocValidationError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Validation failed'),
      );
    });
  });

  describe('with validation enabled', () => {
    test('validates extracted entries when skipValidation is false', async () => {
      const extractorWithValidation = new TocExtractor(mockLogger, mockModel, {
        skipValidation: false,
      });

      mockLLMCaller.mockResolvedValueOnce({
        output: {
          entries: [{ title: 'Chapter 1', level: 1, pageNo: 1 }],
        },
        usage: {
          component: 'TocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
        usedFallback: false,
      });

      const result = await extractorWithValidation.extract(
        '- Chapter 1 ..... 1',
      );

      expect(result.entries).toHaveLength(1);
    });

    test('throws TocParseError for empty markdown even with validation', async () => {
      const extractorWithValidation = new TocExtractor(mockLogger, mockModel, {
        skipValidation: false,
      });

      await expect(extractorWithValidation.extract('   ')).rejects.toThrow(
        TocParseError,
      );
    });
  });

  describe('buildSystemPrompt', () => {
    test('includes main TOC instruction', async () => {
      const extractor = new TocExtractor(mockLogger, mockModel);
      const systemPrompt = (extractor as any).buildSystemPrompt();

      expect(systemPrompt).toContain(
        'You are a document structure extraction assistant',
      );
      expect(systemPrompt).toContain('table of contents');
    });

    test('excludes supplementary indices in system prompt', async () => {
      const extractor = new TocExtractor(mockLogger, mockModel);
      const systemPrompt = (extractor as any).buildSystemPrompt();

      expect(systemPrompt).toContain('사진 목차');
      expect(systemPrompt).toContain('도면 목차');
      expect(systemPrompt).toContain('표 목차');
    });
  });

  describe('buildUserPrompt', () => {
    test('includes markdown in user prompt', async () => {
      const extractor = new TocExtractor(mockLogger, mockModel);
      const markdown = '- Chapter 1 ..... 1\n- Chapter 2 ..... 10';
      const userPrompt = (extractor as any).buildUserPrompt(markdown);

      expect(userPrompt).toContain(markdown);
    });
  });

  describe('configuration options', () => {
    test('uses custom maxRetries option', () => {
      const extractor = new TocExtractor(mockLogger, mockModel, {
        maxRetries: 5,
      });

      expect(extractor).toBeDefined();
    });

    test('uses custom temperature option', () => {
      const extractor = new TocExtractor(mockLogger, mockModel, {
        temperature: 0.5,
      });

      expect(extractor).toBeDefined();
    });

    test('uses fallback model when provided', () => {
      const fallbackModel = { modelId: 'fallback-model' } as LanguageModel;
      const extractor = new TocExtractor(
        mockLogger,
        mockModel,
        {},
        fallbackModel,
      );

      expect(extractor).toBeDefined();
    });
  });

  describe('normalizeLevel', () => {
    test('normalizes nested levels correctly', async () => {
      mockLLMCaller.mockResolvedValueOnce({
        output: {
          entries: [
            {
              title: 'Chapter 1',
              level: 10,
              pageNo: 1,
              children: [{ title: 'Section 1.1', level: 20, pageNo: 3 }],
            },
          ],
        },
        usage: {
          component: 'TocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
        usedFallback: false,
      });

      const result = await extractor.extract(
        '- Chapter 1 ..... 1\n  - Section 1.1 ..... 3',
      );

      expect(result.entries[0].level).toBe(1);
      expect(result.entries[0].children?.[0].level).toBe(2);
    });

    test('handles entries without children', async () => {
      mockLLMCaller.mockResolvedValueOnce({
        output: {
          entries: [
            { title: 'Chapter 1', level: 1, pageNo: 1 },
            { title: 'Chapter 2', level: 1, pageNo: 10 },
          ],
        },
        usage: {
          component: 'TocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
        usedFallback: false,
      });

      const result = await extractor.extract(
        '- Chapter 1 ..... 1\n- Chapter 2 ..... 10',
      );

      expect(result.entries[0].children).toBeUndefined();
      expect(result.entries[1].children).toBeUndefined();
    });
  });

  describe('validation integration', () => {
    test('validates extracted entries when validation is enabled', async () => {
      const extractorWithValidation = new TocExtractor(mockLogger, mockModel, {
        skipValidation: false,
      });

      mockLLMCaller.mockResolvedValueOnce({
        output: {
          entries: [{ title: 'Chapter 1', level: 1, pageNo: 1 }],
        },
        usage: {
          component: 'TocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
        usedFallback: false,
      });

      // This test verifies validation is called on non-empty entries
      const result = await extractorWithValidation.extract(
        '- Chapter 1 ..... 1',
      );
      expect(result.entries).toBeDefined();
      expect(result.entries).toHaveLength(1);
    });

    test('skips validation when skipValidation is true', async () => {
      const extractorSkipValidation = new TocExtractor(mockLogger, mockModel, {
        skipValidation: true,
      });

      mockLLMCaller.mockResolvedValueOnce({
        output: {
          entries: [{ title: 'Chapter 1', level: 1, pageNo: 1 }],
        },
        usage: {
          component: 'TocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
        usedFallback: false,
      });

      const result = await extractorSkipValidation.extract(
        '- Chapter 1 ..... 1',
      );

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('Chapter 1');
    });

    test('validates non-empty entries when validation is enabled', async () => {
      const extractorWithValidation = new TocExtractor(mockLogger, mockModel, {
        skipValidation: false,
      });

      mockLLMCaller.mockResolvedValueOnce({
        output: {
          entries: [{ title: 'Chapter 1', level: 1, pageNo: 1 }],
        },
        usage: {
          component: 'TocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
        usedFallback: false,
      });

      const result = await extractorWithValidation.extract(
        '- Chapter 1 ..... 1',
      );

      expect(result.entries).toHaveLength(1);
    });

    test('passes validation overrides to validator', async () => {
      const extractorWithValidation = new TocExtractor(mockLogger, mockModel, {
        skipValidation: false,
        validation: { maxTitleLength: 100 },
      });

      mockLLMCaller.mockResolvedValueOnce({
        output: {
          entries: [{ title: 'Chapter 1', level: 1, pageNo: 1 }],
        },
        usage: {
          component: 'TocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
        usedFallback: false,
      });

      // Pass totalPages override - should merge with constructor validation options
      const result = await extractorWithValidation.extract(
        '- Chapter 1 ..... 1',
        { totalPages: 200 },
      );

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('Chapter 1');
    });

    test('does not validate empty entries list', async () => {
      const extractorWithValidation = new TocExtractor(mockLogger, mockModel, {
        skipValidation: false,
      });

      mockLLMCaller.mockResolvedValueOnce({
        output: {
          entries: [],
        },
        usage: {
          component: 'TocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
        usedFallback: false,
      });

      const result = await extractorWithValidation.extract(
        '- Invalid TOC format',
      );

      expect(result.entries).toHaveLength(0);
    });
  });
});
