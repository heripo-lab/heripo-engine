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
import { TocValidator } from './toc-validator';

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

  const makeLLMResult = (
    entries: TocEntry[],
    phase = 'extraction',
    inputTokens = 100,
    outputTokens = 50,
  ) => ({
    output: { entries },
    usage: {
      component: 'TocExtractor',
      phase,
      model: 'primary',
      modelName: 'test-model',
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    usedFallback: false,
  });

  beforeEach(() => {
    mockLLMCaller = vi.mocked(LLMCaller.call);
    mockLLMCaller.mockClear();

    // Default: TocValidator.validate() returns valid result
    vi.mocked(TocValidator).mockImplementation(function () {
      return {
        validate: vi
          .fn()
          .mockReturnValue({ valid: true, errorCount: 0, issues: [] }),
      } as any;
    });

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
    test('returns entries and usages for simple flat TOC', async () => {
      mockLLMCaller.mockResolvedValueOnce(
        makeLLMResult([
          { title: 'Chapter 1', level: 1, pageNo: 1 },
          { title: 'Chapter 2', level: 1, pageNo: 10 },
          { title: 'Chapter 3', level: 1, pageNo: 20 },
        ]),
      );

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
      expect(result.usages).toHaveLength(1);
      expect(result.usages[0].component).toBe('TocExtractor');
      expect(result.usages[0].phase).toBe('extraction');
      expect(result.usages[0].model).toBe('primary');
      expect(result.usages[0].inputTokens).toBe(100);
      expect(mockLLMCaller).toHaveBeenCalledTimes(1);
    });

    test('returns entries and usages for nested TOC with children', async () => {
      mockLLMCaller.mockResolvedValueOnce(
        makeLLMResult([
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
        ]),
      );

      const markdown = `- Chapter 1 ..... 1
  - Section 1.1 ..... 3
  - Section 1.2 ..... 5
- Chapter 2 ..... 10`;

      const result = await extractor.extract(markdown);

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].children).toHaveLength(2);
      expect(result.entries[0].children?.[0].title).toBe('Section 1.1');
      expect(result.entries[0].children?.[1].title).toBe('Section 1.2');
      expect(result.usages[0].totalTokens).toBe(150);
    });

    test('normalizes inconsistent levels to start from 1', async () => {
      mockLLMCaller.mockResolvedValueOnce(
        makeLLMResult([
          {
            title: 'Chapter 1',
            level: 5,
            pageNo: 1,
            children: [{ title: 'Section 1.1', level: 10, pageNo: 3 }],
          },
        ]),
      );

      const markdown = '- Chapter 1 ..... 1\n  - Section 1.1 ..... 3';

      const result = await extractor.extract(markdown);

      expect(result.entries[0].level).toBe(1);
      expect(result.entries[0].children?.[0].level).toBe(2);
    });

    test('trims title whitespace', async () => {
      mockLLMCaller.mockResolvedValueOnce(
        makeLLMResult([{ title: '  Chapter 1  ', level: 1, pageNo: 1 }]),
      );

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
      mockLLMCaller.mockResolvedValueOnce(
        makeLLMResult([
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
        ]),
      );

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
      mockLLMCaller.mockResolvedValueOnce(makeLLMResult([]));

      const result = await extractor.extract('- Chapter 1 ..... 1');

      expect(result.usages[0].modelName).toBe('test-model');
      expect(result.usages[0].component).toBe('TocExtractor');
      expect(result.usages[0].phase).toBe('extraction');
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
    });
  });

  describe('with validation enabled', () => {
    test('validates extracted entries when skipValidation is false', async () => {
      const extractorWithValidation = new TocExtractor(mockLogger, mockModel, {
        skipValidation: false,
      });

      mockLLMCaller.mockResolvedValueOnce(
        makeLLMResult([{ title: 'Chapter 1', level: 1, pageNo: 1 }]),
      );

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
      mockLLMCaller.mockResolvedValueOnce(
        makeLLMResult([
          {
            title: 'Chapter 1',
            level: 10,
            pageNo: 1,
            children: [{ title: 'Section 1.1', level: 20, pageNo: 3 }],
          },
        ]),
      );

      const result = await extractor.extract(
        '- Chapter 1 ..... 1\n  - Section 1.1 ..... 3',
      );

      expect(result.entries[0].level).toBe(1);
      expect(result.entries[0].children?.[0].level).toBe(2);
    });

    test('handles entries without children', async () => {
      mockLLMCaller.mockResolvedValueOnce(
        makeLLMResult([
          { title: 'Chapter 1', level: 1, pageNo: 1 },
          { title: 'Chapter 2', level: 1, pageNo: 10 },
        ]),
      );

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

      mockLLMCaller.mockResolvedValueOnce(
        makeLLMResult([{ title: 'Chapter 1', level: 1, pageNo: 1 }]),
      );

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

      mockLLMCaller.mockResolvedValueOnce(
        makeLLMResult([{ title: 'Chapter 1', level: 1, pageNo: 1 }]),
      );

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

      mockLLMCaller.mockResolvedValueOnce(
        makeLLMResult([{ title: 'Chapter 1', level: 1, pageNo: 1 }]),
      );

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

      mockLLMCaller.mockResolvedValueOnce(
        makeLLMResult([{ title: 'Chapter 1', level: 1, pageNo: 1 }]),
      );

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

      mockLLMCaller.mockResolvedValueOnce(makeLLMResult([]));

      const result = await extractorWithValidation.extract(
        '- Invalid TOC format',
      );

      expect(result.entries).toHaveLength(0);
    });
  });

  describe('validation-feedback retry', () => {
    test('retries with correction feedback when validation fails then succeeds', async () => {
      const extractorWithValidation = new TocExtractor(mockLogger, mockModel, {
        skipValidation: false,
      });

      // First call: initial extraction (bad result)
      mockLLMCaller.mockResolvedValueOnce(
        makeLLMResult([
          { title: 'Chapter 1', level: 1, pageNo: 10 },
          { title: 'Chapter 2', level: 1, pageNo: 5 }, // V001: page decrease
        ]),
      );

      // Second call: correction (fixed result)
      mockLLMCaller.mockResolvedValueOnce(
        makeLLMResult(
          [
            { title: 'Chapter 1', level: 1, pageNo: 5 },
            { title: 'Chapter 2', level: 1, pageNo: 10 },
          ],
          'correction-1',
          120,
          60,
        ),
      );

      // Make validator fail on first call, succeed on second
      const mockValidate = vi.fn();
      mockValidate
        .mockReturnValueOnce({
          valid: false,
          errorCount: 1,
          issues: [
            {
              code: 'V001',
              message: 'Page number decreased from 10 to 5',
              path: '[1]',
              entry: { title: 'Chapter 2', level: 1, pageNo: 5 },
            },
          ],
        })
        .mockReturnValueOnce({ valid: true, errorCount: 0, issues: [] });

      vi.mocked(TocValidator).mockImplementation(function () {
        return { validate: mockValidate } as any;
      });

      const result = await extractorWithValidation.extract('- some markdown');

      expect(mockLLMCaller).toHaveBeenCalledTimes(2);
      expect(result.usages).toHaveLength(2);
      expect(result.usages[0].phase).toBe('extraction');
      expect(result.usages[1].phase).toBe('correction-1');
      expect(result.entries[0].pageNo).toBe(5);
      expect(result.entries[1].pageNo).toBe(10);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Validation failed (attempt 1/3)'),
      );
    });

    test('throws last TocValidationError after all retries fail', async () => {
      const extractorWithValidation = new TocExtractor(mockLogger, mockModel, {
        skipValidation: false,
      });

      const badEntries = [
        { title: 'Chapter 1', level: 1, pageNo: 10 },
        { title: 'Chapter 2', level: 1, pageNo: 5 },
      ];

      // Initial + 3 retries = 4 LLM calls
      mockLLMCaller
        .mockResolvedValueOnce(makeLLMResult(badEntries))
        .mockResolvedValueOnce(makeLLMResult(badEntries, 'correction-1'))
        .mockResolvedValueOnce(makeLLMResult(badEntries, 'correction-2'))
        .mockResolvedValueOnce(makeLLMResult(badEntries, 'correction-3'));

      // Validator always fails
      const mockValidate = vi.fn().mockReturnValue({
        valid: false,
        errorCount: 1,
        issues: [
          {
            code: 'V001',
            message: 'Page number decreased from 10 to 5',
            path: '[1]',
            entry: { title: 'Chapter 2', level: 1, pageNo: 5 },
          },
        ],
      });

      vi.mocked(TocValidator).mockImplementation(function () {
        return { validate: mockValidate } as any;
      });

      await expect(
        extractorWithValidation.extract('- some markdown'),
      ).rejects.toThrow(TocValidationError);

      expect(mockLLMCaller).toHaveBeenCalledTimes(4);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Validation failed after 3 retries'),
      );
    });

    test('does not retry when skipValidation is true', async () => {
      mockLLMCaller.mockResolvedValueOnce(
        makeLLMResult([{ title: 'Chapter 1', level: 1, pageNo: 1 }]),
      );

      const result = await extractor.extract('- some markdown');

      expect(mockLLMCaller).toHaveBeenCalledTimes(1);
      expect(result.usages).toHaveLength(1);
    });

    test('does not retry when entries are empty', async () => {
      const extractorWithValidation = new TocExtractor(mockLogger, mockModel, {
        skipValidation: false,
      });

      mockLLMCaller.mockResolvedValueOnce(makeLLMResult([]));

      const result = await extractorWithValidation.extract('- some markdown');

      expect(mockLLMCaller).toHaveBeenCalledTimes(1);
      expect(result.usages).toHaveLength(1);
      expect(result.entries).toHaveLength(0);
    });

    test('tracks usages from extraction and correction phases', async () => {
      const extractorWithValidation = new TocExtractor(mockLogger, mockModel, {
        skipValidation: false,
      });

      mockLLMCaller
        .mockResolvedValueOnce(
          makeLLMResult(
            [{ title: 'Chapter 1', level: 1, pageNo: 1 }],
            'extraction',
            100,
            50,
          ),
        )
        .mockResolvedValueOnce(
          makeLLMResult(
            [{ title: 'Chapter 1', level: 1, pageNo: 1 }],
            'correction-1',
            200,
            100,
          ),
        );

      const mockValidate = vi.fn();
      mockValidate
        .mockReturnValueOnce({
          valid: false,
          errorCount: 1,
          issues: [
            {
              code: 'V003',
              message: 'Title is empty',
              path: '[0]',
              entry: { title: '', level: 1, pageNo: 1 },
            },
          ],
        })
        .mockReturnValueOnce({ valid: true, errorCount: 0, issues: [] });

      vi.mocked(TocValidator).mockImplementation(function () {
        return { validate: mockValidate } as any;
      });

      const result = await extractorWithValidation.extract('- some markdown');

      expect(result.usages).toHaveLength(2);
      expect(result.usages[0].inputTokens).toBe(100);
      expect(result.usages[0].outputTokens).toBe(50);
      expect(result.usages[1].inputTokens).toBe(200);
      expect(result.usages[1].outputTokens).toBe(100);
    });

    test('throws TocParseError when LLM fails during correction retry', async () => {
      const extractorWithValidation = new TocExtractor(mockLogger, mockModel, {
        skipValidation: false,
      });

      // Initial extraction succeeds
      mockLLMCaller.mockResolvedValueOnce(
        makeLLMResult([{ title: 'Chapter 1', level: 1, pageNo: 1 }]),
      );
      // Correction call fails
      mockLLMCaller.mockRejectedValueOnce(new Error('LLM call failed'));

      const mockValidate = vi.fn().mockReturnValue({
        valid: false,
        errorCount: 1,
        issues: [
          {
            code: 'V001',
            message: 'Page order error',
            path: '[0]',
            entry: { title: 'Chapter 1', level: 1, pageNo: 1 },
          },
        ],
      });

      vi.mocked(TocValidator).mockImplementation(function () {
        return { validate: mockValidate } as any;
      });

      await expect(
        extractorWithValidation.extract('- some markdown'),
      ).rejects.toThrow(TocParseError);
    });
  });

  describe('buildCorrectionPrompt', () => {
    test('includes validation errors, original markdown, and previous entries', () => {
      const ext = new TocExtractor(mockLogger, mockModel);
      const markdown = '- Chapter 1 ..... 1';
      const entries: TocEntry[] = [{ title: 'Chapter 1', level: 1, pageNo: 1 }];
      const issues = [
        {
          code: 'V001',
          message: 'Page number decreased from 10 to 5',
          path: '[1]',
          entry: { title: 'Chapter 2', level: 1, pageNo: 5 },
        },
      ];

      const prompt = (ext as any).buildCorrectionPrompt(
        markdown,
        entries,
        issues,
      );

      expect(prompt).toContain('[V001]');
      expect(prompt).toContain('Page number decreased from 10 to 5');
      expect(prompt).toContain(markdown);
      expect(prompt).toContain(JSON.stringify(entries, null, 2));
      expect(prompt).toContain('Hierarchy confusion');
      expect(prompt).toContain('Page number misread');
      expect(prompt).toContain('non-decreasing order');
    });

    test('includes error code descriptions for each issue', () => {
      const ext = new TocExtractor(mockLogger, mockModel);
      const issues = [
        {
          code: 'V005',
          message: 'Child before parent',
          path: '[0].children[0]',
          entry: { title: 'Section 1', level: 2, pageNo: 1 },
        },
      ];

      const prompt = (ext as any).buildCorrectionPrompt(
        '- md',
        [{ title: 'Chapter', level: 1, pageNo: 5 }],
        issues,
      );

      expect(prompt).toContain(
        'Child page number is before parent page number',
      );
    });

    test('uses fallback description for unknown error codes', () => {
      const ext = new TocExtractor(mockLogger, mockModel);
      const issues = [
        {
          code: 'V999',
          message: 'Some unknown error',
          path: '[0]',
          entry: { title: 'Chapter 1', level: 1, pageNo: 1 },
        },
      ];

      const prompt = (ext as any).buildCorrectionPrompt(
        '- md',
        [{ title: 'Chapter 1', level: 1, pageNo: 1 }],
        issues,
      );

      expect(prompt).toContain('Unknown validation error.');
    });
  });

  describe('tryValidateEntries', () => {
    test('returns null for empty entries', () => {
      const ext = new TocExtractor(mockLogger, mockModel, {
        skipValidation: false,
      });

      const result = (ext as any).tryValidateEntries([], {});

      expect(result).toBeNull();
    });

    test('returns null when validation passes', () => {
      const ext = new TocExtractor(mockLogger, mockModel, {
        skipValidation: false,
      });

      const mockValidate = vi
        .fn()
        .mockReturnValue({ valid: true, errorCount: 0, issues: [] });
      vi.mocked(TocValidator).mockImplementation(function () {
        return { validate: mockValidate } as any;
      });

      const result = (ext as any).tryValidateEntries(
        [{ title: 'Chapter 1', level: 1, pageNo: 1 }],
        {},
      );

      expect(result).toBeNull();
    });

    test('returns TocValidationError when validation fails', () => {
      const ext = new TocExtractor(mockLogger, mockModel, {
        skipValidation: false,
      });

      const mockValidate = vi.fn().mockReturnValue({
        valid: false,
        errorCount: 1,
        issues: [
          {
            code: 'V001',
            message: 'Page order error',
            path: '[0]',
            entry: { title: 'Chapter 1', level: 1, pageNo: 1 },
          },
        ],
      });
      vi.mocked(TocValidator).mockImplementation(function () {
        return { validate: mockValidate } as any;
      });

      const result = (ext as any).tryValidateEntries(
        [{ title: 'Chapter 1', level: 1, pageNo: 1 }],
        {},
      );

      expect(result).toBeInstanceOf(TocValidationError);
      expect(result.validationResult.errorCount).toBe(1);
    });
  });
});
