import type { LoggerMethods } from '@heripo/logger';
import type { LanguageModel } from 'ai';

import { LLMCaller, LLMTokenUsageAggregator } from '@heripo/shared';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  VisionTocExtractionSchema,
  VisionTocExtractor,
} from './vision-toc-extractor';

vi.mock('@heripo/shared', () => ({
  LLMCaller: {
    callVision: vi.fn(),
  },
  LLMTokenUsageAggregator: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('node:path', () => ({
  resolve: vi.fn((...args: string[]) => args.join('/')),
}));

const mockLLMCaller = vi.mocked(LLMCaller);
const mockLLMTokenUsageAggregator = vi.mocked(LLMTokenUsageAggregator);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockPathResolve = vi.mocked(path.resolve);

describe('VisionTocExtractor', () => {
  let mockModel: LanguageModel;
  let mockLogger: LoggerMethods;
  let extractor: VisionTocExtractor;
  let mockAggregator: {
    reset: ReturnType<typeof vi.fn>;
    track: ReturnType<typeof vi.fn>;
    logSummary: ReturnType<typeof vi.fn>;
  };

  const sampleTocMarkdown = `- 제1장 서론 ..... 1
  - 1. 연구 배경 ..... 3
  - 2. 연구 목적 ..... 5
- 제2장 연구 방법 ..... 10`;

  beforeEach(() => {
    mockLLMCaller.callVision.mockClear();
    mockLLMTokenUsageAggregator.mockClear();
    mockReadFileSync.mockClear();
    mockPathResolve.mockClear();

    mockAggregator = {
      reset: vi.fn(),
      track: vi.fn(),
      logSummary: vi.fn(),
    };
    mockLLMTokenUsageAggregator.mockReturnValue(
      mockAggregator as unknown as LLMTokenUsageAggregator,
    );

    mockModel = { modelId: 'test-model' } as LanguageModel;
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // Default path.resolve behavior
    mockPathResolve.mockImplementation((...args: string[]) => args.join('/'));

    // Default file read behavior - return fake image buffer
    mockReadFileSync.mockReturnValue(Buffer.from('fake-image-data'));

    extractor = new VisionTocExtractor(mockLogger, mockModel, '/output/path');
  });

  describe('VisionTocExtractionSchema', () => {
    test('validates valid response with TOC', () => {
      const response = {
        hasToc: true,
        tocMarkdown: sampleTocMarkdown,
        continuesOnNextPage: false,
      };
      const result = VisionTocExtractionSchema.parse(response);

      expect(result).toEqual(response);
    });

    test('validates response without TOC', () => {
      const response = {
        hasToc: false,
        tocMarkdown: null,
        continuesOnNextPage: false,
      };
      const result = VisionTocExtractionSchema.parse(response);

      expect(result).toEqual(response);
    });

    test('validates response with continuation', () => {
      const response = {
        hasToc: true,
        tocMarkdown: sampleTocMarkdown,
        continuesOnNextPage: true,
      };
      const result = VisionTocExtractionSchema.parse(response);

      expect(result.continuesOnNextPage).toBe(true);
    });
  });

  describe('extract', () => {
    test('returns null for zero pages', async () => {
      const result = await extractor.extract(0);

      expect(result).toBeNull();
      expect(mockLLMCaller.callVision).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VisionTocExtractor] No pages to search',
      );
    });

    test('finds TOC in first batch', async () => {
      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: true,
          tocMarkdown: sampleTocMarkdown,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 1000,
          outputTokens: 100,
          totalTokens: 1100,
        },
        usedFallback: false,
      });

      const result = await extractor.extract(20);

      expect(result).toBe(sampleTocMarkdown);
      expect(mockLLMCaller.callVision).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('TOC found in first batch'),
      );
    });

    test('finds TOC in second batch when not in first', async () => {
      // First batch: no TOC
      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: false,
          tocMarkdown: null,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 1000,
          outputTokens: 50,
          totalTokens: 1050,
        },
        usedFallback: false,
      });

      // Second batch: TOC found
      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: true,
          tocMarkdown: sampleTocMarkdown,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 1000,
          outputTokens: 100,
          totalTokens: 1100,
        },
        usedFallback: false,
      });

      const result = await extractor.extract(20);

      expect(result).toBe(sampleTocMarkdown);
      expect(mockLLMCaller.callVision).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('TOC found in second batch'),
      );
    });

    test('returns null when TOC not found in any batch', async () => {
      mockLLMCaller.callVision.mockResolvedValue({
        output: {
          hasToc: false,
          tocMarkdown: null,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 1000,
          outputTokens: 50,
          totalTokens: 1050,
        },
        usedFallback: false,
      });

      const result = await extractor.extract(20);

      expect(result).toBeNull();
      expect(mockLLMCaller.callVision).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VisionTocExtractor] TOC not found in any batch',
      );
    });

    test('handles multi-page TOC with continuation', async () => {
      const firstPart = `- 제1장 서론 ..... 1
  - 1. 연구 배경 ..... 3`;
      const secondPart = `- 2. 연구 목적 ..... 5
- 제2장 연구 방법 ..... 10`;

      // First batch: TOC found, continues
      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: true,
          tocMarkdown: firstPart,
          continuesOnNextPage: true,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 1000,
          outputTokens: 80,
          totalTokens: 1080,
        },
        usedFallback: false,
      });

      // Continuation batch
      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: true,
          tocMarkdown: secondPart,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 1000,
          outputTokens: 60,
          totalTokens: 1060,
        },
        usedFallback: false,
      });

      const result = await extractor.extract(20);

      // mergeMarkdown trims both parts and joins with newline
      expect(result).toBe(`${firstPart.trim()}\n${secondPart.trim()}`);
      expect(mockLLMCaller.callVision).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VisionTocExtractor] TOC continues on next pages, extracting more',
      );
    });

    test('handles continuation with no additional TOC content', async () => {
      // First batch: TOC found, indicates continuation
      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: true,
          tocMarkdown: sampleTocMarkdown,
          continuesOnNextPage: true,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 1000,
          outputTokens: 100,
          totalTokens: 1100,
        },
        usedFallback: false,
      });

      // Continuation batch: no TOC content
      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: false,
          tocMarkdown: null,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 1000,
          outputTokens: 50,
          totalTokens: 1050,
        },
        usedFallback: false,
      });

      const result = await extractor.extract(20);

      // Should still return first batch result
      expect(result).toBe(sampleTocMarkdown);
    });

    test('handles document with fewer pages than first batch size', async () => {
      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: true,
          tocMarkdown: sampleTocMarkdown,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 500,
          outputTokens: 100,
          totalTokens: 600,
        },
        usedFallback: false,
      });

      const result = await extractor.extract(5);

      expect(result).toBe(sampleTocMarkdown);
      // Should only search first 5 pages
      expect(mockReadFileSync).toHaveBeenCalledTimes(5);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VisionTocExtractor] Searching first batch: pages 1-5',
      );
    });

    test('does not search second batch when document has only first batch pages', async () => {
      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: false,
          tocMarkdown: null,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 1000,
          outputTokens: 50,
          totalTokens: 1050,
        },
        usedFallback: false,
      });

      const result = await extractor.extract(10);

      expect(result).toBeNull();
      expect(mockLLMCaller.callVision).toHaveBeenCalledTimes(1);
    });

    test('loads correct page images', async () => {
      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: true,
          tocMarkdown: sampleTocMarkdown,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 300,
          outputTokens: 100,
          totalTokens: 400,
        },
        usedFallback: false,
      });

      await extractor.extract(3);

      // Pages are 0-indexed in file names
      expect(mockPathResolve).toHaveBeenCalledWith(
        '/output/path',
        'pages/page_0.png',
      );
      expect(mockPathResolve).toHaveBeenCalledWith(
        '/output/path',
        'pages/page_1.png',
      );
      expect(mockPathResolve).toHaveBeenCalledWith(
        '/output/path',
        'pages/page_2.png',
      );
    });

    test('passes correct options to LLMCaller', async () => {
      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: true,
          tocMarkdown: sampleTocMarkdown,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 300,
          outputTokens: 100,
          totalTokens: 400,
        },
        usedFallback: false,
      });

      const customExtractor = new VisionTocExtractor(
        mockLogger,
        mockModel,
        '/output/path',
        { maxRetries: 5 },
      );

      await customExtractor.extract(3);

      expect(mockLLMCaller.callVision).toHaveBeenCalledWith(
        expect.objectContaining({
          primaryModel: mockModel,
          temperature: 0,
          maxRetries: 5,
          component: 'VisionTocExtractor',
          phase: 'extraction',
        }),
      );
    });

    test('uses default options', async () => {
      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: true,
          tocMarkdown: sampleTocMarkdown,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 300,
          outputTokens: 100,
          totalTokens: 400,
        },
        usedFallback: false,
      });

      await extractor.extract(3);

      expect(mockLLMCaller.callVision).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0,
          maxRetries: 3,
        }),
      );
    });

    test('passes images in correct format', async () => {
      const fakeImageBuffer = Buffer.from('test-image-content');
      mockReadFileSync.mockReturnValue(fakeImageBuffer);

      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: true,
          tocMarkdown: sampleTocMarkdown,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
        },
        usedFallback: false,
      });

      await extractor.extract(2);

      const expectedBase64 = fakeImageBuffer.toString('base64');
      const callArgs = mockLLMCaller.callVision.mock.calls[0][0];
      const messages = callArgs.messages as Array<{
        role: string;
        content: Array<{ type: string; image?: string; text?: string }>;
      }>;
      const content = messages[0].content;

      // First content should be text prompt
      expect(content[0].type).toBe('text');

      // Following contents should be images
      expect(content[1].type).toBe('image');
      expect(content[1].image).toBe(`data:image/png;base64,${expectedBase64}`);

      expect(content[2].type).toBe('image');
      expect(content[2].image).toBe(`data:image/png;base64,${expectedBase64}`);
    });

    test('tracks token usage', async () => {
      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: true,
          tocMarkdown: sampleTocMarkdown,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 1000,
          outputTokens: 100,
          totalTokens: 1100,
        },
        usedFallback: false,
      });

      await extractor.extract(5);

      expect(mockAggregator.track).toHaveBeenCalledWith({
        component: 'VisionTocExtractor',
        phase: 'extraction',
        model: 'primary',
        modelName: 'test-model',
        inputTokens: 1000,
        outputTokens: 100,
        totalTokens: 1100,
      });
      expect(mockAggregator.logSummary).toHaveBeenCalledTimes(1);
    });

    test('logs extraction progress', async () => {
      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: true,
          tocMarkdown: sampleTocMarkdown,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 1000,
          outputTokens: 100,
          totalTokens: 1100,
        },
        usedFallback: false,
      });

      await extractor.extract(15);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VisionTocExtractor] Starting TOC extraction from 15 pages',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VisionTocExtractor] Searching first batch: pages 1-10',
      );
    });

    test('propagates LLM errors', async () => {
      mockLLMCaller.callVision.mockRejectedValueOnce(
        new Error('API rate limit'),
      );

      await expect(extractor.extract(5)).rejects.toThrow('API rate limit');
    });

    test('propagates file read errors', async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      await expect(extractor.extract(5)).rejects.toThrow('File not found');
    });
  });

  describe('custom batch sizes', () => {
    test('uses custom first batch size', async () => {
      const customExtractor = new VisionTocExtractor(
        mockLogger,
        mockModel,
        '/output/path',
        { firstBatchSize: 5 },
      );

      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: false,
          tocMarkdown: null,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 500,
          outputTokens: 50,
          totalTokens: 550,
        },
        usedFallback: false,
      });

      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: true,
          tocMarkdown: sampleTocMarkdown,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 1000,
          outputTokens: 100,
          totalTokens: 1100,
        },
        usedFallback: false,
      });

      await customExtractor.extract(20);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VisionTocExtractor] Searching first batch: pages 1-5',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VisionTocExtractor] Searching second batch: pages 6-15',
      );
    });

    test('uses custom second batch size', async () => {
      const customExtractor = new VisionTocExtractor(
        mockLogger,
        mockModel,
        '/output/path',
        { firstBatchSize: 5, secondBatchSize: 3 },
      );

      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: false,
          tocMarkdown: null,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 500,
          outputTokens: 50,
          totalTokens: 550,
        },
        usedFallback: false,
      });

      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: true,
          tocMarkdown: sampleTocMarkdown,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 300,
          outputTokens: 100,
          totalTokens: 400,
        },
        usedFallback: false,
      });

      await customExtractor.extract(20);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VisionTocExtractor] Searching second batch: pages 6-8',
      );
    });
  });

  describe('edge cases', () => {
    test('handles hasToc true but tocMarkdown null', async () => {
      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: true,
          tocMarkdown: null,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 1000,
          outputTokens: 50,
          totalTokens: 1050,
        },
        usedFallback: false,
      });

      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: false,
          tocMarkdown: null,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 1000,
          outputTokens: 50,
          totalTokens: 1050,
        },
        usedFallback: false,
      });

      const result = await extractor.extract(20);

      // Should treat as not found and continue to second batch
      expect(result).toBeNull();
      expect(mockLLMCaller.callVision).toHaveBeenCalledTimes(2);
    });

    test('handles hasToc true but empty tocMarkdown', async () => {
      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: true,
          tocMarkdown: '',
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 1000,
          outputTokens: 50,
          totalTokens: 1050,
        },
        usedFallback: false,
      });

      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: false,
          tocMarkdown: null,
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 1000,
          outputTokens: 50,
          totalTokens: 1050,
        },
        usedFallback: false,
      });

      const result = await extractor.extract(15);

      // Empty string is falsy, so it's treated as not found
      expect(result).toBeNull();
    });

    test('handles continuation when document ends before second batch', async () => {
      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: true,
          tocMarkdown: sampleTocMarkdown,
          continuesOnNextPage: true,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 1000,
          outputTokens: 100,
          totalTokens: 1100,
        },
        usedFallback: false,
      });

      // Document only has 10 pages, so continuation search cannot happen
      const result = await extractor.extract(10);

      // Should return first batch result without continuation
      expect(result).toBe(sampleTocMarkdown);
      expect(mockLLMCaller.callVision).toHaveBeenCalledTimes(1);
    });

    test('handles single page document', async () => {
      mockLLMCaller.callVision.mockResolvedValueOnce({
        output: {
          hasToc: true,
          tocMarkdown: '- Single Chapter ..... 1',
          continuesOnNextPage: false,
        },
        usage: {
          component: 'VisionTocExtractor',
          phase: 'extraction',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
        usedFallback: false,
      });

      const result = await extractor.extract(1);

      expect(result).toBe('- Single Chapter ..... 1');
      expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('abstract method implementations', () => {
    test('buildSystemPrompt returns empty string', () => {
      // Access the protected method via type casting for testing
      const extractor = new VisionTocExtractor(
        mockLogger,
        mockModel,
        '/output/path',
      );
      const result = (
        extractor as unknown as { buildSystemPrompt: () => string }
      ).buildSystemPrompt();
      expect(result).toBe('');
    });

    test('buildUserPrompt returns correct prompt', () => {
      // Access the protected method via type casting for testing
      const extractor = new VisionTocExtractor(
        mockLogger,
        mockModel,
        '/output/path',
      );
      const result = (
        extractor as unknown as {
          buildUserPrompt: (startPage: number, endPage: number) => string;
        }
      ).buildUserPrompt(1, 10);

      expect(result).toContain('10 document page images');
      expect(result).toContain('pages 1-10');
      expect(result).toContain('Table of Contents');
    });
  });
});
