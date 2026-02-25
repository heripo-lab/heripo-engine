import { BatchProcessor, LLMCaller } from '@heripo/shared';
import { readFileSync } from 'node:fs';
import { type Mock, beforeEach, describe, expect, test, vi } from 'vitest';

import { VlmPageProcessor } from './vlm-page-processor';

vi.mock('@heripo/shared', () => ({
  LLMCaller: {
    callVision: vi.fn(),
  },
  BatchProcessor: {
    createBatches: <T>(items: T[], batchSize: number): T[][] => {
      const batches: T[][] = [];
      for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize));
      }
      return batches;
    },
  },
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockCallVision = LLMCaller.callVision as Mock;
const mockReadFileSync = readFileSync as Mock;

/** Minimal mock LanguageModel for testing */
const mockModel = { modelId: 'test-vision-model' } as any;
const mockFallbackModel = { modelId: 'test-fallback-model' } as any;

/** Helper to create a mock VLM call result */
function createMockVlmResult(
  elements: Array<{
    t: string;
    c: string;
    o: number;
    l?: number;
    m?: string;
    b?: { l: number; t: number; r: number; b: number };
  }>,
) {
  return {
    output: { e: elements },
    usage: {
      component: 'VlmPageProcessor',
      phase: 'page-analysis',
      model: 'primary' as const,
      modelName: 'test-vision-model',
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
    },
    usedFallback: false,
  };
}

describe('VlmPageProcessor', () => {
  let processor: VlmPageProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new VlmPageProcessor(mockLogger);
    mockReadFileSync.mockReturnValue(Buffer.from('fake-image-data'));
  });

  describe('processPages', () => {
    test('returns empty array for empty page files', async () => {
      const results = await processor.processPages([], mockModel);

      expect(results).toEqual([]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VlmPageProcessor] No pages to process',
      );
      expect(mockCallVision).not.toHaveBeenCalled();
    });

    test('processes single page and returns VlmPageResult', async () => {
      mockCallVision.mockResolvedValue(
        createMockVlmResult([
          { t: 'tx', c: 'Hello world', o: 0 },
          { t: 'sh', c: 'Introduction', o: 1, l: 1 },
        ]),
      );

      const results = await processor.processPages(
        ['/tmp/pages/page_0.png'],
        mockModel,
      );

      expect(results).toHaveLength(1);
      expect(results[0].pageNo).toBe(1);
      expect(results[0].elements).toHaveLength(2);
      expect(results[0].elements[0]).toEqual({
        type: 'text',
        content: 'Hello world',
        order: 0,
      });
      expect(results[0].elements[1]).toEqual({
        type: 'section_header',
        content: 'Introduction',
        order: 1,
        level: 1,
      });
    });

    test('processes multiple pages with correct page numbers', async () => {
      mockCallVision
        .mockResolvedValueOnce(
          createMockVlmResult([{ t: 'tx', c: 'Page 1 content', o: 0 }]),
        )
        .mockResolvedValueOnce(
          createMockVlmResult([{ t: 'tx', c: 'Page 2 content', o: 0 }]),
        )
        .mockResolvedValueOnce(
          createMockVlmResult([{ t: 'tx', c: 'Page 3 content', o: 0 }]),
        );

      const results = await processor.processPages(
        [
          '/tmp/pages/page_0.png',
          '/tmp/pages/page_1.png',
          '/tmp/pages/page_2.png',
        ],
        mockModel,
      );

      expect(results).toHaveLength(3);
      expect(results[0].pageNo).toBe(1);
      expect(results[1].pageNo).toBe(2);
      expect(results[2].pageNo).toBe(3);
    });

    test('uses default concurrency of 1', async () => {
      const createBatchesSpy = vi.spyOn(BatchProcessor, 'createBatches');
      mockCallVision.mockResolvedValue(
        createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
      );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel);

      expect(createBatchesSpy).toHaveBeenCalledWith(expect.any(Array), 1);
    });

    test('uses custom concurrency when specified', async () => {
      const createBatchesSpy = vi.spyOn(BatchProcessor, 'createBatches');
      mockCallVision.mockResolvedValue(
        createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
      );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel, {
        concurrency: 2,
      });

      expect(createBatchesSpy).toHaveBeenCalledWith(expect.any(Array), 2);
    });

    test('processes batches sequentially for concurrency control', async () => {
      const callOrder: number[] = [];
      mockCallVision.mockImplementation(async () => {
        callOrder.push(callOrder.length);
        return createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]);
      });

      const results = await processor.processPages(
        ['/tmp/p0.png', '/tmp/p1.png', '/tmp/p2.png'],
        mockModel,
        { concurrency: 2 },
      );

      // 3 pages with concurrency 2: batch 1 (2 pages), batch 2 (1 page)
      expect(results).toHaveLength(3);
      expect(mockCallVision).toHaveBeenCalledTimes(3);
    });

    test('logs processing start and completion', async () => {
      mockCallVision.mockResolvedValue(
        createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
      );

      await processor.processPages(
        ['/tmp/pages/page_0.png', '/tmp/pages/page_1.png'],
        mockModel,
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VlmPageProcessor] Processing 2 pages (concurrency: 1)...',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VlmPageProcessor] Completed processing 2 pages',
      );
    });

    test('logs custom concurrency value', async () => {
      mockCallVision.mockResolvedValue(
        createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
      );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel, {
        concurrency: 3,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VlmPageProcessor] Processing 1 pages (concurrency: 3)...',
      );
    });

    test('propagates error when VLM call fails', async () => {
      mockCallVision.mockRejectedValue(new Error('VLM API error'));

      await expect(
        processor.processPages(['/tmp/pages/page_0.png'], mockModel),
      ).rejects.toThrow('VLM API error');
    });
  });

  describe('processPage (via processPages)', () => {
    test('reads image file and encodes as base64', async () => {
      const imageBuffer = Buffer.from('test-image-bytes');
      mockReadFileSync.mockReturnValue(imageBuffer);
      mockCallVision.mockResolvedValue(
        createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
      );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel);

      expect(mockReadFileSync).toHaveBeenCalledWith('/tmp/pages/page_0.png');
    });

    test('sends correct message format to LLMCaller.callVision', async () => {
      const imageBuffer = Buffer.from('test-image');
      const expectedBase64 = imageBuffer.toString('base64');
      mockReadFileSync.mockReturnValue(imageBuffer);
      mockCallVision.mockResolvedValue(
        createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
      );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel);

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: expect.stringContaining('Analyze the page image'),
                },
                {
                  type: 'image',
                  image: `data:image/png;base64,${expectedBase64}`,
                },
              ],
            },
          ],
        }),
      );
    });

    test('passes primary model to LLMCaller.callVision', async () => {
      mockCallVision.mockResolvedValue(
        createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
      );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel);

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          primaryModel: mockModel,
        }),
      );
    });

    test('passes fallback model when provided', async () => {
      mockCallVision.mockResolvedValue(
        createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
      );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel, {
        fallbackModel: mockFallbackModel,
      });

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          fallbackModel: mockFallbackModel,
        }),
      );
    });

    test('uses default maxRetries of 3 when not specified', async () => {
      mockCallVision.mockResolvedValue(
        createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
      );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel);

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          maxRetries: 3,
        }),
      );
    });

    test('uses custom maxRetries when specified', async () => {
      mockCallVision.mockResolvedValue(
        createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
      );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel, {
        maxRetries: 5,
      });

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          maxRetries: 5,
        }),
      );
    });

    test('uses default temperature of 0 when not specified', async () => {
      mockCallVision.mockResolvedValue(
        createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
      );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel);

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0,
        }),
      );
    });

    test('uses custom temperature when specified', async () => {
      mockCallVision.mockResolvedValue(
        createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
      );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel, {
        temperature: 0.5,
      });

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.5,
        }),
      );
    });

    test('passes abort signal when provided', async () => {
      const abortController = new AbortController();
      mockCallVision.mockResolvedValue(
        createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
      );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel, {
        abortSignal: abortController.signal,
      });

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          abortSignal: abortController.signal,
        }),
      );
    });

    test('passes undefined for fallback model when not provided', async () => {
      mockCallVision.mockResolvedValue(
        createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
      );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel);

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          fallbackModel: undefined,
        }),
      );
    });

    test('passes undefined for abort signal when not provided', async () => {
      mockCallVision.mockResolvedValue(
        createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
      );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel);

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          abortSignal: undefined,
        }),
      );
    });

    test('sets correct component and phase for tracking', async () => {
      mockCallVision.mockResolvedValue(
        createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
      );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel);

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          component: 'VlmPageProcessor',
          phase: 'page-analysis',
        }),
      );
    });

    test('tracks token usage with aggregator when provided', async () => {
      const mockAggregator = { track: vi.fn() };
      const mockResult = createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]);
      mockCallVision.mockResolvedValue(mockResult);

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel, {
        aggregator: mockAggregator as any,
      });

      expect(mockAggregator.track).toHaveBeenCalledWith(mockResult.usage);
    });

    test('tracks token usage for each page separately', async () => {
      const mockAggregator = { track: vi.fn() };
      mockCallVision
        .mockResolvedValueOnce(
          createMockVlmResult([{ t: 'tx', c: 'Page 1', o: 0 }]),
        )
        .mockResolvedValueOnce(
          createMockVlmResult([{ t: 'tx', c: 'Page 2', o: 0 }]),
        );

      await processor.processPages(['/tmp/p0.png', '/tmp/p1.png'], mockModel, {
        aggregator: mockAggregator as any,
      });

      expect(mockAggregator.track).toHaveBeenCalledTimes(2);
    });

    test('does not track usage when aggregator is not provided', async () => {
      mockCallVision.mockResolvedValue(
        createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
      );

      // Should not throw when no aggregator
      await processor.processPages(['/tmp/pages/page_0.png'], mockModel);

      // No aggregator to check, but verify it didn't error
      expect(mockCallVision).toHaveBeenCalledTimes(1);
    });

    test('converts short-field output to full VlmPageResult', async () => {
      mockCallVision.mockResolvedValue(
        createMockVlmResult([
          { t: 'li', c: 'Item 1', o: 0, m: '1.' },
          { t: 'pi', c: '', o: 1, b: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 } },
          { t: 'tb', c: 'Col1|Col2', o: 2 },
        ]),
      );

      const results = await processor.processPages(
        ['/tmp/pages/page_0.png'],
        mockModel,
      );

      expect(results[0].elements[0]).toEqual({
        type: 'list_item',
        content: 'Item 1',
        order: 0,
        marker: '1.',
      });
      expect(results[0].elements[1]).toEqual({
        type: 'picture',
        content: '',
        order: 1,
        bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 },
      });
      expect(results[0].elements[2]).toEqual({
        type: 'table',
        content: 'Col1|Col2',
        order: 2,
      });
    });

    test('logs debug message for each page processed', async () => {
      mockCallVision.mockResolvedValue(
        createMockVlmResult([
          { t: 'tx', c: 'text 1', o: 0 },
          { t: 'tx', c: 'text 2', o: 1 },
        ]),
      );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[VlmPageProcessor] Processing page 1...',
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[VlmPageProcessor] Page 1: 2 elements extracted',
      );
    });

    test('handles page with no elements after retry', async () => {
      mockCallVision
        .mockResolvedValueOnce(createMockVlmResult([]))
        .mockResolvedValueOnce(createMockVlmResult([]));

      const results = await processor.processPages(
        ['/tmp/pages/page_0.png'],
        mockModel,
      );

      expect(results[0].elements).toEqual([]);
      expect(mockCallVision).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('0 elements extracted, retrying'),
      );
    });
  });

  describe('empty page retry', () => {
    test('retries with higher temperature when first attempt returns 0 elements', async () => {
      mockCallVision
        .mockResolvedValueOnce(createMockVlmResult([]))
        .mockResolvedValueOnce(
          createMockVlmResult([{ t: 'tx', c: 'Recovered text', o: 0 }]),
        );

      const results = await processor.processPages(
        ['/tmp/pages/page_0.png'],
        mockModel,
      );

      expect(results[0].elements).toHaveLength(1);
      expect(results[0].elements[0].content).toBe('Recovered text');
      expect(mockCallVision).toHaveBeenCalledTimes(2);
    });

    test('uses higher temperature (0.3) on retry attempt', async () => {
      mockCallVision
        .mockResolvedValueOnce(createMockVlmResult([]))
        .mockResolvedValueOnce(
          createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
        );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel);

      expect(mockCallVision).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ temperature: 0 }),
      );
      expect(mockCallVision).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ temperature: 0.3 }),
      );
    });

    test('uses "page-analysis-retry" phase on retry attempt', async () => {
      mockCallVision
        .mockResolvedValueOnce(createMockVlmResult([]))
        .mockResolvedValueOnce(
          createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
        );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel);

      expect(mockCallVision).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ phase: 'page-analysis-retry' }),
      );
    });

    test('does not retry when elements are found on first attempt', async () => {
      mockCallVision.mockResolvedValue(
        createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
      );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel);

      expect(mockCallVision).toHaveBeenCalledTimes(1);
    });

    test('returns empty result if retry also returns 0 elements', async () => {
      mockCallVision
        .mockResolvedValueOnce(createMockVlmResult([]))
        .mockResolvedValueOnce(createMockVlmResult([]));

      const results = await processor.processPages(
        ['/tmp/pages/page_0.png'],
        mockModel,
      );

      expect(results[0].elements).toEqual([]);
      expect(mockCallVision).toHaveBeenCalledTimes(2);
    });

    test('logs warning when page returns 0 elements', async () => {
      mockCallVision
        .mockResolvedValueOnce(createMockVlmResult([]))
        .mockResolvedValueOnce(
          createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
        );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Page 1: 0 elements extracted, retrying'),
      );
    });

    test('logs warning when retry also returns 0 elements', async () => {
      mockCallVision
        .mockResolvedValueOnce(createMockVlmResult([]))
        .mockResolvedValueOnce(createMockVlmResult([]));

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('still 0 elements after retry'),
      );
    });

    test('tracks token usage for both original and retry attempts', async () => {
      const mockAggregator = { track: vi.fn() };
      mockCallVision
        .mockResolvedValueOnce(createMockVlmResult([]))
        .mockResolvedValueOnce(
          createMockVlmResult([{ t: 'tx', c: 'text', o: 0 }]),
        );

      await processor.processPages(['/tmp/pages/page_0.png'], mockModel, {
        aggregator: mockAggregator as any,
      });

      expect(mockAggregator.track).toHaveBeenCalledTimes(2);
    });
  });
});
