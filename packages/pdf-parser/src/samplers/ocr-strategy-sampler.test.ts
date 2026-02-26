import { LLMCaller } from '@heripo/shared';
import { readFileSync } from 'node:fs';
import { type Mock, beforeEach, describe, expect, test, vi } from 'vitest';

import { OcrStrategySampler } from './ocr-strategy-sampler';

vi.mock('@heripo/shared', () => ({
  LLMCaller: {
    callVision: vi.fn(),
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

const mockModel = { modelId: 'test-vision-model' } as any;
const mockFallbackModel = { modelId: 'test-fallback-model' } as any;

/** Create a mock PageRenderer */
function createMockPageRenderer(pageCount: number = 3) {
  const pageFiles = Array.from(
    { length: pageCount },
    (_, i) => `/tmp/pages/page_${i}.png`,
  );
  return {
    renderPages: vi.fn().mockResolvedValue({
      pageCount,
      pagesDir: '/tmp/pages',
      pageFiles,
    }),
  };
}

/** Helper to create a mock VLM Korean-Hanja mix detection result */
function createMockKoreanHanjaMixResult(
  hasKoreanHanjaMix: boolean,
  detectedLanguages: string[] = ['ko-KR'],
) {
  return {
    output: { hasKoreanHanjaMix, detectedLanguages },
    usage: {
      component: 'OcrStrategySampler',
      phase: 'korean-hanja-mix-detection',
      model: 'primary' as const,
      modelName: 'test-vision-model',
      inputTokens: 500,
      outputTokens: 10,
      totalTokens: 510,
    },
    usedFallback: false,
  };
}

describe('OcrStrategySampler', () => {
  let sampler: OcrStrategySampler;
  let mockPageRenderer: ReturnType<typeof createMockPageRenderer>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue(Buffer.from('fake-image'));
    mockPageRenderer = createMockPageRenderer();
    sampler = new OcrStrategySampler(mockLogger, mockPageRenderer as any);
  });

  describe('sample', () => {
    test('returns ocrmac when no pages found in PDF', async () => {
      mockPageRenderer = createMockPageRenderer(0);
      sampler = new OcrStrategySampler(mockLogger, mockPageRenderer as any);

      const result = await sampler.sample(
        '/tmp/test.pdf',
        '/tmp/output',
        mockModel,
      );

      expect(result.method).toBe('ocrmac');
      expect(result.reason).toBe('No pages found in PDF');
      expect(result.sampledPages).toBe(0);
      expect(result.totalPages).toBe(0);
    });

    test('returns vlm when Korean-Hanja mix is detected', async () => {
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(true));

      const result = await sampler.sample(
        '/tmp/test.pdf',
        '/tmp/output',
        mockModel,
      );

      expect(result.method).toBe('vlm');
      expect(result.reason).toContain('Korean-Hanja mix detected');
      expect(result.totalPages).toBe(3);
    });

    test('returns ocrmac when no Korean-Hanja mix is detected', async () => {
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));

      const result = await sampler.sample(
        '/tmp/test.pdf',
        '/tmp/output',
        mockModel,
      );

      expect(result.method).toBe('ocrmac');
      expect(result.reason).toContain('No Korean-Hanja mix detected');
      expect(result.totalPages).toBe(3);
    });

    test('early exits on first Korean-Hanja mix detection', async () => {
      mockPageRenderer = createMockPageRenderer(20);
      sampler = new OcrStrategySampler(mockLogger, mockPageRenderer as any);

      mockCallVision
        .mockResolvedValueOnce(createMockKoreanHanjaMixResult(false))
        .mockResolvedValueOnce(createMockKoreanHanjaMixResult(true));

      const result = await sampler.sample(
        '/tmp/test.pdf',
        '/tmp/output',
        mockModel,
      );

      expect(result.method).toBe('vlm');
      expect(result.sampledPages).toBe(2);
      // Should not check remaining pages
      expect(mockCallVision).toHaveBeenCalledTimes(2);
    });

    test('renders pages at 72 DPI for sampling', async () => {
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));

      await sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel);

      expect(mockPageRenderer.renderPages).toHaveBeenCalledWith(
        '/tmp/test.pdf',
        '/tmp/output',
        { dpi: 72 },
      );
    });

    test('passes correct arguments to LLMCaller.callVision', async () => {
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));

      await sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel);

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          primaryModel: mockModel,
          component: 'OcrStrategySampler',
          phase: 'korean-hanja-mix-detection',
          maxRetries: 3,
          temperature: 0,
        }),
      );
    });

    test('passes fallback model when provided', async () => {
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));

      await sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel, {
        fallbackModel: mockFallbackModel,
      });

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          fallbackModel: mockFallbackModel,
        }),
      );
    });

    test('passes custom maxRetries', async () => {
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));

      await sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel, {
        maxRetries: 5,
      });

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          maxRetries: 5,
        }),
      );
    });

    test('passes abort signal', async () => {
      const abortController = new AbortController();
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));

      await sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel, {
        abortSignal: abortController.signal,
      });

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          abortSignal: abortController.signal,
        }),
      );
    });

    test('tracks token usage with aggregator', async () => {
      const mockAggregator = { track: vi.fn() };
      const mockResult = createMockKoreanHanjaMixResult(false);
      mockCallVision.mockResolvedValue(mockResult);

      await sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel, {
        aggregator: mockAggregator as any,
      });

      expect(mockAggregator.track).toHaveBeenCalledWith(mockResult.usage);
    });

    test('does not track usage when no aggregator provided', async () => {
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));

      // Should not throw
      await sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel);

      expect(mockCallVision).toHaveBeenCalled();
    });

    test('uses custom maxSamplePages', async () => {
      mockPageRenderer = createMockPageRenderer(50);
      sampler = new OcrStrategySampler(mockLogger, mockPageRenderer as any);
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));

      await sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel, {
        maxSamplePages: 3,
      });

      expect(mockCallVision).toHaveBeenCalledTimes(3);
    });

    test('reads page image files as base64', async () => {
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));
      mockPageRenderer = createMockPageRenderer(1);
      sampler = new OcrStrategySampler(mockLogger, mockPageRenderer as any);

      await sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel);

      expect(mockReadFileSync).toHaveBeenCalledWith('/tmp/pages/page_0.png');
    });

    test('sends correct image format in messages', async () => {
      const imageBuffer = Buffer.from('test-image');
      const expectedBase64 = imageBuffer.toString('base64');
      mockReadFileSync.mockReturnValue(imageBuffer);
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));
      mockPageRenderer = createMockPageRenderer(1);
      sampler = new OcrStrategySampler(mockLogger, mockPageRenderer as any);

      await sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel);

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: expect.stringContaining('Hanja'),
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

    test('logs sampling start', async () => {
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));

      await sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[OcrStrategySampler] Starting OCR strategy sampling...',
      );
    });

    test('logs sampled page numbers', async () => {
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));

      await sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Sampling'),
      );
    });

    test('logs debug for each page analysis', async () => {
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));
      mockPageRenderer = createMockPageRenderer(1);
      sampler = new OcrStrategySampler(mockLogger, mockPageRenderer as any);

      await sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[OcrStrategySampler] Analyzing page 1 for Korean-Hanja mix and language...',
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[OcrStrategySampler] Page 1: hasKoreanHanjaMix=false, detectedLanguages=ko-KR',
      );
    });

    test('propagates VLM call errors', async () => {
      mockCallVision.mockRejectedValue(new Error('VLM API error'));

      await expect(
        sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel),
      ).rejects.toThrow('VLM API error');
    });

    test('propagates PageRenderer errors', async () => {
      mockPageRenderer.renderPages.mockRejectedValue(
        new Error('Render failed'),
      );

      await expect(
        sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel),
      ).rejects.toThrow('Render failed');
    });

    test('includes detectedLanguages in result on early exit', async () => {
      mockCallVision.mockResolvedValue(
        createMockKoreanHanjaMixResult(true, ['ko-KR']),
      );

      const result = await sampler.sample(
        '/tmp/test.pdf',
        '/tmp/output',
        mockModel,
      );

      expect(result.method).toBe('vlm');
      expect(result.detectedLanguages).toEqual(['ko-KR']);
    });

    test('includes detectedLanguages in result when no Korean-Hanja mix', async () => {
      mockCallVision.mockResolvedValue(
        createMockKoreanHanjaMixResult(false, ['en-US']),
      );

      const result = await sampler.sample(
        '/tmp/test.pdf',
        '/tmp/output',
        mockModel,
      );

      expect(result.method).toBe('ocrmac');
      expect(result.detectedLanguages).toEqual(['en-US']);
    });

    test('uses last sampled page languages when no Korean-Hanja mix', async () => {
      mockPageRenderer = createMockPageRenderer(20);
      sampler = new OcrStrategySampler(mockLogger, mockPageRenderer as any);

      mockCallVision
        .mockResolvedValueOnce(createMockKoreanHanjaMixResult(false, ['ko-KR']))
        .mockResolvedValueOnce(createMockKoreanHanjaMixResult(false, ['ko-KR']))
        .mockResolvedValueOnce(createMockKoreanHanjaMixResult(false, ['ko-KR']))
        .mockResolvedValueOnce(createMockKoreanHanjaMixResult(false, ['ko-KR']))
        .mockResolvedValueOnce(
          createMockKoreanHanjaMixResult(false, ['en-US']),
        );

      const result = await sampler.sample(
        '/tmp/test.pdf',
        '/tmp/output',
        mockModel,
      );

      expect(result.detectedLanguages).toEqual(['en-US']);
    });

    test('detectedLanguages is undefined when no pages found', async () => {
      mockPageRenderer = createMockPageRenderer(0);
      sampler = new OcrStrategySampler(mockLogger, mockPageRenderer as any);

      const result = await sampler.sample(
        '/tmp/test.pdf',
        '/tmp/output',
        mockModel,
      );

      expect(result.detectedLanguages).toBeUndefined();
    });
  });

  describe('selectSamplePages', () => {
    test('returns empty array for 0 pages', () => {
      expect(sampler.selectSamplePages(0, 5)).toEqual([]);
    });

    test('returns all pages when total <= maxSamples', () => {
      expect(sampler.selectSamplePages(3, 5)).toEqual([0, 1, 2]);
    });

    test('returns all pages when total equals maxSamples', () => {
      expect(sampler.selectSamplePages(5, 5)).toEqual([0, 1, 2, 3, 4]);
    });

    test('trims front/back 10% for large documents', () => {
      // 20 pages: trim 2 from each end, eligible: 2-17 (indices)
      const result = sampler.selectSamplePages(20, 5);

      // All indices should be in eligible range [2, 18)
      for (const idx of result) {
        expect(idx).toBeGreaterThanOrEqual(2);
        expect(idx).toBeLessThan(18);
      }
      expect(result).toHaveLength(5);
    });

    test('distributes samples evenly across eligible range', () => {
      // 100 pages: trim 10 from each end, eligible: 10-89 (indices)
      const result = sampler.selectSamplePages(100, 5);

      expect(result).toHaveLength(5);
      expect(result[0]).toBe(10); // start of eligible range

      // Check samples are spaced roughly evenly
      for (let i = 1; i < result.length; i++) {
        const gap = result[i] - result[i - 1];
        expect(gap).toBeGreaterThan(0);
      }
    });

    test('returns middle page when trimming leaves no eligible pages', () => {
      // 6 pages: trim ceil(0.6)=1 from each end, eligible: [1, 5)
      // With 6 pages and trim=1, start=1, end=5, eligible=4 > 0
      // But for very small case: 3 pages, trim=1, eligible: [1, 2) = 1 page
      // For trimming leaving 0: need totalPages where ceil(total*0.1) >= total/2
      // That's when ceil(total*0.1) * 2 >= total
      // For total=2: trim=1, start=1, end=1, eligible=0
      const result = sampler.selectSamplePages(2, 5);
      // totalPages=2 <= maxSamples=5, so returns all: [0, 1]
      expect(result).toEqual([0, 1]);
    });

    test('handles case where eligible count is less than maxSamples', () => {
      // 12 pages: trim ceil(1.2)=2, eligible range: [2, 10) = 8 pages
      // 8 <= maxSamples doesn't apply since maxSamples=5 and 8 > 5
      // Let's use: 8 pages, trim=1, eligible [1, 7) = 6 pages, maxSamples=10
      const result = sampler.selectSamplePages(8, 10);
      // totalPages=8 <= maxSamples=10, so returns all: [0,1,...,7]
      expect(result).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    test('returns all eligible pages when eligible count <= maxSamples', () => {
      // 10 pages: trim=1, eligible: [1, 9) = 8 pages, maxSamples=10
      // But totalPages=10 <= maxSamples=10, so returns all
      // Need totalPages > maxSamples but eligible <= maxSamples
      // 12 pages: trim=2, eligible: [2, 10) = 8 pages, maxSamples=8
      // But 12 > 8 so doesn't hit first branch
      const result = sampler.selectSamplePages(12, 8);
      expect(result).toHaveLength(8);
      // All should be in [2, 10)
      for (const idx of result) {
        expect(idx).toBeGreaterThanOrEqual(2);
        expect(idx).toBeLessThan(10);
      }
    });

    test('returns middle page when trimming leaves no eligible pages', () => {
      // totalPages=2, maxSamples=1 → totalPages > maxSamples
      // trimCount = max(1, ceil(0.2)) = 1, start=1, end=1, eligible=0
      // Falls into eligibleCount <= 0 branch → middle page
      const result = sampler.selectSamplePages(2, 1);
      expect(result).toEqual([1]); // Math.floor(2/2) = 1
    });

    test('returns unique indices (no duplicates)', () => {
      const result = sampler.selectSamplePages(50, 5);
      const unique = new Set(result);
      expect(unique.size).toBe(result.length);
    });

    test('returns sorted indices', () => {
      const result = sampler.selectSamplePages(50, 5);
      for (let i = 1; i < result.length; i++) {
        expect(result[i]).toBeGreaterThan(result[i - 1]);
      }
    });
  });
});
