import type { LoggerMethods } from '@heripo/logger';
import type { DoclingDocument } from '@heripo/model';
import type {
  ExtendedTokenUsage,
  LLMTokenUsageAggregator,
} from '@heripo/shared';

import type {
  TocExtractor,
  TocFinder,
  VisionTocExtractor,
} from '../extractors';
import type { RefResolver } from '../utils';
import type { TocContentValidator } from '../validators';
import type { TocExtractionPipelineDeps } from './toc-extraction-pipeline';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { TocNotFoundError, TocValidationError } from '../extractors';
import { TocExtractionPipeline } from './toc-extraction-pipeline';

function createMockLogger(): LoggerMethods {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as LoggerMethods;
}

function createMockDoc(pageCount: number): DoclingDocument {
  const pages: Record<string, any> = {};
  for (let i = 1; i <= pageCount; i++) {
    pages[String(i)] = {} as any;
  }
  return {
    schema_name: 'DoclingDocument',
    version: '1.0.0',
    name: 'test-doc',
    origin: {
      mimetype: 'application/pdf',
      binary_hash: 123,
      filename: 'test.pdf',
    },
    furniture: {
      name: '_root_',
      label: 'unspecified',
      self_ref: '#/furniture',
      children: [],
      content_layer: 'furniture',
    },
    texts: [],
    pictures: [],
    tables: [],
    groups: [],
    body: {
      name: '_root_',
      label: 'unspecified',
      self_ref: '#/body',
      children: [],
      content_layer: 'body',
    },
    pages,
  } as DoclingDocument;
}

function createMockUsage(component = 'TocExtractor'): ExtendedTokenUsage {
  return {
    component,
    phase: 'extraction',
    model: 'primary',
    modelName: 'test-model',
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
  };
}

describe('TocExtractionPipeline', () => {
  let mockLogger: LoggerMethods;
  let mockTocFinder: TocFinder;
  let mockTocExtractor: TocExtractor;
  let mockTocContentValidator: TocContentValidator;
  let mockVisionTocExtractor: VisionTocExtractor;
  let mockRefResolver: RefResolver;
  let mockUsageAggregator: LLMTokenUsageAggregator;
  let pipeline: TocExtractionPipeline;

  beforeEach(() => {
    mockLogger = createMockLogger();

    mockTocFinder = {
      find: vi.fn().mockReturnValue({
        startPage: 1,
        endPage: 2,
        itemRefs: ['#/texts/0'],
      }),
    } as unknown as TocFinder;

    mockTocContentValidator = {
      validate: vi.fn().mockResolvedValue({
        isValid: true,
        confidence: 0.9,
        contentType: 'pure_toc',
        validTocMarkdown: '- Chapter 1 ..... 1',
        reason: 'Valid TOC',
      }),
      isValid: vi.fn().mockReturnValue(true),
      getValidMarkdown: vi.fn().mockReturnValue('- Chapter 1 ..... 1'),
    } as unknown as TocContentValidator;

    mockTocExtractor = {
      extract: vi.fn().mockResolvedValue({
        entries: [{ title: 'Chapter 1', level: 1, pageNo: 1 }],
        usages: [createMockUsage()],
      }),
    } as unknown as TocExtractor;

    mockVisionTocExtractor = {
      extract: vi.fn().mockResolvedValue(null),
    } as unknown as VisionTocExtractor;

    mockRefResolver = {
      resolve: vi.fn().mockReturnValue({
        text: 'Chapter 1 ..... 1',
        orig: 'Chapter 1 ..... 1',
        label: 'text',
        self_ref: '#/texts/0',
      }),
      resolveText: vi.fn().mockReturnValue({
        text: 'Chapter 1 ..... 1',
      }),
    } as unknown as RefResolver;

    mockUsageAggregator = {
      track: vi.fn(),
      reset: vi.fn(),
      logSummary: vi.fn(),
    } as unknown as LLMTokenUsageAggregator;

    pipeline = createPipeline();
  });

  function createPipeline(overrides?: Partial<TocExtractionPipelineDeps>) {
    return new TocExtractionPipeline({
      logger: mockLogger,
      tocFinder: mockTocFinder,
      tocExtractor: mockTocExtractor,
      tocContentValidator: mockTocContentValidator,
      visionTocExtractor: mockVisionTocExtractor,
      refResolver: mockRefResolver,
      usageAggregator: mockUsageAggregator,
      ...overrides,
    });
  }

  describe('Rule-based TOC extraction (Stages 1-3)', () => {
    test('should extract TOC successfully with pure_toc content', async () => {
      const mockDoc = createMockDoc(2);

      const result = await pipeline.extract(mockDoc, []);

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Chapter 1');
      expect(mockTocFinder.find).toHaveBeenCalledWith(mockDoc);
      expect(mockTocContentValidator.validate).toHaveBeenCalled();
      expect(mockTocContentValidator.isValid).toHaveBeenCalled();
      expect(mockTocExtractor.extract).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('TOC validation passed'),
      );
    });

    test('should use extracted markdown when contentType is mixed', async () => {
      vi.mocked(mockTocContentValidator.validate).mockResolvedValue({
        isValid: true,
        confidence: 0.8,
        contentType: 'mixed',
        validTocMarkdown: '- Main Chapter ..... 10',
        reason: 'Mixed content',
      } as any);
      vi.mocked(mockTocContentValidator.getValidMarkdown).mockReturnValue(
        '- Main Chapter ..... 10',
      );

      const mockDoc = createMockDoc(2);
      const result = await pipeline.extract(mockDoc, []);

      expect(result).toHaveLength(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Mixed TOC detected'),
      );
    });

    test('should fall back to vision when validation fails', async () => {
      vi.mocked(mockTocContentValidator.isValid).mockReturnValue(false);
      vi.mocked(mockVisionTocExtractor.extract).mockResolvedValue(
        '- Vision Chapter ..... 5',
      );

      const mockDoc = createMockDoc(2);
      const result = await pipeline.extract(mockDoc, []);

      expect(result).toHaveLength(1);
      expect(mockVisionTocExtractor.extract).toHaveBeenCalledWith(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('TOC validation failed'),
      );
    });

    test('should fall back to vision when getValidMarkdown returns null', async () => {
      vi.mocked(mockTocContentValidator.getValidMarkdown).mockReturnValue(null);
      vi.mocked(mockVisionTocExtractor.extract).mockResolvedValue(
        '- Vision Chapter ..... 5',
      );

      const mockDoc = createMockDoc(2);
      const result = await pipeline.extract(mockDoc, []);

      expect(result).toHaveLength(1);
      expect(mockVisionTocExtractor.extract).toHaveBeenCalledWith(2);
    });
  });

  describe('Vision fallback (Stage 4)', () => {
    test('should use vision when rule-based extraction throws TocNotFoundError', async () => {
      vi.mocked(mockTocFinder.find).mockImplementation(() => {
        throw new TocNotFoundError('No TOC found');
      });
      vi.mocked(mockVisionTocExtractor.extract).mockResolvedValue(
        '- Vision Chapter ..... 5',
      );

      const mockDoc = createMockDoc(3);
      const result = await pipeline.extract(mockDoc, []);

      expect(result).toHaveLength(1);
      expect(mockVisionTocExtractor.extract).toHaveBeenCalledWith(3);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Rule-based TOC not found'),
      );
    });

    test('should throw TocNotFoundError when vision fallback also fails', async () => {
      vi.mocked(mockTocFinder.find).mockImplementation(() => {
        throw new TocNotFoundError('No TOC found');
      });
      vi.mocked(mockVisionTocExtractor.extract).mockResolvedValue(null);

      const mockDoc = createMockDoc(2);

      await expect(pipeline.extract(mockDoc, [])).rejects.toThrow(
        TocNotFoundError,
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Both rule-based search and vision fallback'),
      );
    });

    test('should re-throw non-TocNotFoundError from tocFinder', async () => {
      const genericError = new Error('Unexpected error');
      vi.mocked(mockTocFinder.find).mockImplementation(() => {
        throw genericError;
      });

      const mockDoc = createMockDoc(2);

      await expect(pipeline.extract(mockDoc, [])).rejects.toThrow(genericError);
    });
  });

  describe('LLM extraction (Stage 5)', () => {
    test('should handle TocValidationError by setting entries to empty', async () => {
      vi.mocked(mockTocExtractor.extract).mockRejectedValue(
        new TocValidationError('Validation failed', {
          valid: false,
          errorCount: 1,
          issues: [
            {
              code: 'V001',
              message: 'test',
              path: '[0]',
              entry: { title: 'Ch1', level: 1, pageNo: 1 },
            },
          ],
        }),
      );
      // Vision fallback to avoid 0-entries error path
      vi.mocked(mockVisionTocExtractor.extract).mockResolvedValue(null);

      const mockDoc = createMockDoc(2);

      await expect(pipeline.extract(mockDoc, [])).rejects.toThrow(
        TocNotFoundError,
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('TOC extraction validation failed'),
      );
    });

    test('should re-throw non-TocValidationError from tocExtractor', async () => {
      const genericError = new Error('Network error');
      vi.mocked(mockTocExtractor.extract).mockRejectedValue(genericError);

      const mockDoc = createMockDoc(2);

      await expect(pipeline.extract(mockDoc, [])).rejects.toThrow(genericError);
    });

    test('should track token usages', async () => {
      const usage1 = createMockUsage('TocExtractor');
      const usage2 = createMockUsage('TocExtractor-retry');
      vi.mocked(mockTocExtractor.extract).mockResolvedValue({
        entries: [{ title: 'Ch1', level: 1, pageNo: 1 }],
        usages: [usage1, usage2],
      });

      const mockDoc = createMockDoc(2);
      await pipeline.extract(mockDoc, []);

      expect(mockUsageAggregator.track).toHaveBeenCalledWith(usage1);
      expect(mockUsageAggregator.track).toHaveBeenCalledWith(usage2);
      expect(mockUsageAggregator.track).toHaveBeenCalledTimes(2);
    });
  });

  describe('Compiled volume detection', () => {
    test('should pass undefined totalPages when TOC page numbers exceed document pages', async () => {
      // TOC markdown has page number 200 but doc only has 5 pages
      vi.mocked(mockTocContentValidator.getValidMarkdown).mockReturnValue(
        '- Chapter 1 ..... 200',
      );

      const mockDoc = createMockDoc(5);
      await pipeline.extract(mockDoc, []);

      expect(mockTocExtractor.extract).toHaveBeenCalledWith(
        '- Chapter 1 ..... 200',
        { totalPages: undefined },
      );
    });

    test('should pass actual totalPages when TOC page numbers do not exceed document pages', async () => {
      vi.mocked(mockTocContentValidator.getValidMarkdown).mockReturnValue(
        '- Chapter 1 ..... 3',
      );

      const mockDoc = createMockDoc(5);
      await pipeline.extract(mockDoc, []);

      expect(mockTocExtractor.extract).toHaveBeenCalledWith(
        '- Chapter 1 ..... 3',
        { totalPages: 5 },
      );
    });
  });

  describe('Vision fallback after Stage 5 failure (Stage 5b)', () => {
    test('should retry with vision when text-based extraction yields 0 entries', async () => {
      vi.mocked(mockTocExtractor.extract)
        .mockResolvedValueOnce({ entries: [], usages: [createMockUsage()] })
        .mockResolvedValueOnce({
          entries: [{ title: 'Vision Ch', level: 1, pageNo: 1 }],
          usages: [createMockUsage()],
        });
      vi.mocked(mockVisionTocExtractor.extract).mockResolvedValue(
        '- Vision Ch ..... 1',
      );

      const mockDoc = createMockDoc(3);
      const result = await pipeline.extract(mockDoc, []);

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Vision Ch');
      expect(mockVisionTocExtractor.extract).toHaveBeenCalledWith(3);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Text-based TOC extraction yielded 0 entries'),
      );
    });

    test('should not retry with vision when markdown already came from vision', async () => {
      // Force vision path: rule-based throws TocNotFoundError
      vi.mocked(mockTocFinder.find).mockImplementation(() => {
        throw new TocNotFoundError('No TOC');
      });
      vi.mocked(mockVisionTocExtractor.extract).mockResolvedValue(
        '- Vision Ch ..... 1',
      );
      vi.mocked(mockTocExtractor.extract).mockResolvedValue({
        entries: [],
        usages: [],
      });

      const mockDoc = createMockDoc(2);

      await expect(pipeline.extract(mockDoc, [])).rejects.toThrow(
        TocNotFoundError,
      );
      // Vision was called once for Stage 4, NOT again for Stage 5b
      expect(mockVisionTocExtractor.extract).toHaveBeenCalledTimes(1);
    });

    test('should throw TocNotFoundError when vision retry returns null', async () => {
      vi.mocked(mockTocExtractor.extract).mockResolvedValue({
        entries: [],
        usages: [],
      });
      vi.mocked(mockVisionTocExtractor.extract).mockResolvedValue(null);

      const mockDoc = createMockDoc(2);

      await expect(pipeline.extract(mockDoc, [])).rejects.toThrow(
        TocNotFoundError,
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('LLM could not extract any structured entries'),
      );
    });

    test('should handle vision retry extraction throwing an error', async () => {
      vi.mocked(mockTocExtractor.extract)
        .mockResolvedValueOnce({ entries: [], usages: [] })
        .mockRejectedValueOnce(new Error('Vision retry failed'));
      vi.mocked(mockVisionTocExtractor.extract).mockResolvedValue(
        '- Vision markdown',
      );

      const mockDoc = createMockDoc(2);

      await expect(pipeline.extract(mockDoc, [])).rejects.toThrow(
        TocNotFoundError,
      );
    });

    test('should track token usage for vision retry', async () => {
      const usage1 = createMockUsage('initial');
      const usage2 = createMockUsage('vision-retry');
      vi.mocked(mockTocExtractor.extract)
        .mockResolvedValueOnce({ entries: [], usages: [usage1] })
        .mockResolvedValueOnce({
          entries: [{ title: 'Ch1', level: 1, pageNo: 1 }],
          usages: [usage2],
        });
      vi.mocked(mockVisionTocExtractor.extract).mockResolvedValue(
        '- Vision Ch ..... 1',
      );

      const mockDoc = createMockDoc(3);
      await pipeline.extract(mockDoc, []);

      expect(mockUsageAggregator.track).toHaveBeenCalledWith(usage1);
      expect(mockUsageAggregator.track).toHaveBeenCalledWith(usage2);
    });

    test('should pass totalPages to vision retry when visionMaxPageNo does not exceed totalPages', async () => {
      vi.mocked(mockTocExtractor.extract)
        .mockResolvedValueOnce({ entries: [], usages: [] })
        .mockResolvedValueOnce({
          entries: [{ title: 'Ch1', level: 1, pageNo: 1 }],
          usages: [],
        });
      vi.mocked(mockVisionTocExtractor.extract).mockResolvedValue(
        '- Chapter 1 ..... 3',
      );

      const mockDoc = createMockDoc(66);
      const result = await pipeline.extract(mockDoc, []);

      expect(result).toHaveLength(1);
      // Second call should use totalPages since 3 < 66
      expect(mockTocExtractor.extract).toHaveBeenNthCalledWith(
        2,
        '- Chapter 1 ..... 3',
        { totalPages: 66 },
      );
    });

    test('should pass undefined totalPages to vision retry when visionMaxPageNo exceeds totalPages', async () => {
      vi.mocked(mockTocExtractor.extract)
        .mockResolvedValueOnce({ entries: [], usages: [] })
        .mockResolvedValueOnce({
          entries: [{ title: 'Ch1', level: 1, pageNo: 1 }],
          usages: [],
        });
      vi.mocked(mockVisionTocExtractor.extract).mockResolvedValue(
        '- Chapter 1 ..... 500',
      );

      const mockDoc = createMockDoc(5);
      const result = await pipeline.extract(mockDoc, []);

      expect(result).toHaveLength(1);
      expect(mockTocExtractor.extract).toHaveBeenNthCalledWith(
        2,
        '- Chapter 1 ..... 500',
        { totalPages: undefined },
      );
    });

    test('should throw when both text-based and vision extraction return 0 entries', async () => {
      vi.mocked(mockTocExtractor.extract).mockResolvedValue({
        entries: [],
        usages: [],
      });
      vi.mocked(mockVisionTocExtractor.extract).mockResolvedValue(
        '- Some markdown',
      );

      const mockDoc = createMockDoc(2);

      await expect(pipeline.extract(mockDoc, [])).rejects.toThrow(
        TocNotFoundError,
      );
    });
  });
});
