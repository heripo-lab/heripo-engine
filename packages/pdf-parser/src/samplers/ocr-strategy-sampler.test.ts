import { LLMCaller } from '@heripo/shared';
import { readFileSync } from 'node:fs';
import { type Mock, beforeEach, describe, expect, test, vi } from 'vitest';

import { PdfTextExtractor } from '../processors/pdf-text-extractor';
import { OcrStrategySampler } from './ocr-strategy-sampler';

vi.mock('@heripo/shared', () => ({
  LLMCaller: {
    callVision: vi.fn(),
  },
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('../processors/pdf-text-extractor');

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

/** Create a mock PdfTextExtractor */
function createMockTextExtractor(options?: {
  pageCount?: number;
  pageTexts?: Map<number, string>;
  getPageCountError?: boolean;
  extractPageTextError?: boolean;
}) {
  const {
    pageCount = 0,
    pageTexts = new Map<number, string>(),
    getPageCountError = false,
    extractPageTextError = false,
  } = options ?? {};

  return {
    getPageCount: getPageCountError
      ? vi.fn().mockRejectedValue(new Error('pdfinfo failed'))
      : vi.fn().mockResolvedValue(pageCount),
    extractPageText: extractPageTextError
      ? vi.fn().mockRejectedValue(new Error('pdftotext failed'))
      : vi.fn().mockImplementation((_path: string, page: number) => {
          return Promise.resolve(pageTexts.get(page) ?? '');
        }),
    extractText: vi.fn(),
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
  let mockTextExtractor: ReturnType<typeof createMockTextExtractor>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue(Buffer.from('fake-image'));
    mockPageRenderer = createMockPageRenderer();
    // Default: text extractor returns 0 pages → falls through to VLM
    mockTextExtractor = createMockTextExtractor();
    sampler = new OcrStrategySampler(
      mockLogger,
      mockPageRenderer as any,
      mockTextExtractor as any,
    );
  });

  describe('preCheckCjkFromTextLayer', () => {
    test('returns vlm when CJK and Hangul detected in text layer', async () => {
      mockTextExtractor = createMockTextExtractor({
        pageCount: 10,
        pageTexts: new Map([
          [1, '한글 텍스트'],
          [2, '일반 텍스트'],
          [3, '한글과 漢字가 혼합된 텍스트'],
        ]),
      });
      sampler = new OcrStrategySampler(
        mockLogger,
        mockPageRenderer as any,
        mockTextExtractor as any,
      );

      const result = await sampler.sample(
        '/tmp/test.pdf',
        '/tmp/output',
        mockModel,
      );

      expect(result.method).toBe('vlm');
      expect(result.reason).toContain('CJK characters found in PDF text layer');
      expect(result.detectedLanguages).toEqual(['ko-KR']);
      // PageRenderer and LLMCaller should NOT be called
      expect(mockPageRenderer.renderPages).not.toHaveBeenCalled();
      expect(mockCallVision).not.toHaveBeenCalled();
    });

    test('returns ocrmac when text layer has Hangul but no CJK', async () => {
      mockTextExtractor = createMockTextExtractor({
        pageCount: 5,
        pageTexts: new Map([
          [1, '한글만 있는 텍스트'],
          [2, '더 많은 한글 텍스트'],
          [3, '세번째 페이지'],
          [4, '네번째 페이지'],
          [5, '다섯번째 페이지'],
        ]),
      });
      sampler = new OcrStrategySampler(
        mockLogger,
        mockPageRenderer as any,
        mockTextExtractor as any,
      );

      const result = await sampler.sample(
        '/tmp/test.pdf',
        '/tmp/output',
        mockModel,
      );

      expect(result.method).toBe('ocrmac');
      expect(result.reason).toContain('No CJK characters in PDF text layer');
      expect(result.detectedLanguages).toEqual(['ko-KR']);
      expect(mockPageRenderer.renderPages).not.toHaveBeenCalled();
      expect(mockCallVision).not.toHaveBeenCalled();
    });

    test('falls back to VLM when text layer is empty (image PDF)', async () => {
      mockTextExtractor = createMockTextExtractor({
        pageCount: 10,
        pageTexts: new Map([
          [1, '   \n  '],
          [2, ''],
          [3, '  '],
        ]),
      });
      mockPageRenderer = createMockPageRenderer(10);
      sampler = new OcrStrategySampler(
        mockLogger,
        mockPageRenderer as any,
        mockTextExtractor as any,
      );
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));

      const result = await sampler.sample(
        '/tmp/test.pdf',
        '/tmp/output',
        mockModel,
      );

      // Falls through to VLM sampling
      expect(mockPageRenderer.renderPages).toHaveBeenCalled();
      expect(result.method).toBe('ocrmac');
    });

    test('falls back to VLM when pdfinfo fails (pageCount = 0)', async () => {
      mockTextExtractor = createMockTextExtractor({ pageCount: 0 });
      mockPageRenderer = createMockPageRenderer(3);
      sampler = new OcrStrategySampler(
        mockLogger,
        mockPageRenderer as any,
        mockTextExtractor as any,
      );
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));

      const result = await sampler.sample(
        '/tmp/test.pdf',
        '/tmp/output',
        mockModel,
      );

      expect(mockPageRenderer.renderPages).toHaveBeenCalled();
      expect(result.method).toBe('ocrmac');
    });

    test('falls back to VLM when text extraction throws', async () => {
      mockTextExtractor = createMockTextExtractor({
        getPageCountError: true,
      });
      mockPageRenderer = createMockPageRenderer(3);
      sampler = new OcrStrategySampler(
        mockLogger,
        mockPageRenderer as any,
        mockTextExtractor as any,
      );
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));

      await sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel);

      expect(mockPageRenderer.renderPages).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[OcrStrategySampler] Text layer pre-check failed, falling back to VLM sampling',
      );
    });

    test('detects CJK on first matching page and returns immediately', async () => {
      // 20 pages: selectSamplePages(20, 15) trims 2 from edges → indices 2..17 (1-based: 3..18)
      mockTextExtractor = createMockTextExtractor({
        pageCount: 20,
        pageTexts: new Map([
          [3, '한글 텍스트'],
          [4, '한글과 發掘 보고서'],
        ]),
      });
      sampler = new OcrStrategySampler(
        mockLogger,
        mockPageRenderer as any,
        mockTextExtractor as any,
      );

      const result = await sampler.sample(
        '/tmp/test.pdf',
        '/tmp/output',
        mockModel,
      );

      expect(result.method).toBe('vlm');
      expect(result.reason).toContain('page 4');
      expect(result.totalPages).toBe(20);
    });

    test('returns ocrmac when only CJK without Hangul', async () => {
      mockTextExtractor = createMockTextExtractor({
        pageCount: 3,
        pageTexts: new Map([
          [1, 'English text with 漢字'],
          [2, 'More English text'],
          [3, 'Another page'],
        ]),
      });
      sampler = new OcrStrategySampler(
        mockLogger,
        mockPageRenderer as any,
        mockTextExtractor as any,
      );

      const result = await sampler.sample(
        '/tmp/test.pdf',
        '/tmp/output',
        mockModel,
      );

      // CJK without Hangul does not trigger VLM
      expect(result.method).toBe('ocrmac');
      expect(result.reason).toContain('No CJK characters in PDF text layer');
    });

    test('includes sampledPages count in result', async () => {
      mockTextExtractor = createMockTextExtractor({
        pageCount: 5,
        pageTexts: new Map([
          [1, '한글 텍스트'],
          [2, '한글과 遺蹟 문서'],
        ]),
      });
      sampler = new OcrStrategySampler(
        mockLogger,
        mockPageRenderer as any,
        mockTextExtractor as any,
      );

      const result = await sampler.sample(
        '/tmp/test.pdf',
        '/tmp/output',
        mockModel,
      );

      expect(result.method).toBe('vlm');
      expect(result.sampledPages).toBe(5); // all 5 pages sampled (totalPages <= maxSamples)
      expect(result.totalPages).toBe(5);
    });
  });

  describe('sample (VLM fallback)', () => {
    test('returns ocrmac when no pages found in PDF', async () => {
      mockPageRenderer = createMockPageRenderer(0);
      sampler = new OcrStrategySampler(
        mockLogger,
        mockPageRenderer as any,
        mockTextExtractor as any,
      );

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
      sampler = new OcrStrategySampler(
        mockLogger,
        mockPageRenderer as any,
        mockTextExtractor as any,
      );

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

    test('renders pages at 150 DPI for sampling', async () => {
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));

      await sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel);

      expect(mockPageRenderer.renderPages).toHaveBeenCalledWith(
        '/tmp/test.pdf',
        '/tmp/output',
        { dpi: 150 },
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
      sampler = new OcrStrategySampler(
        mockLogger,
        mockPageRenderer as any,
        mockTextExtractor as any,
      );
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));

      await sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel, {
        maxSamplePages: 3,
      });

      expect(mockCallVision).toHaveBeenCalledTimes(3);
    });

    test('reads page image files as base64', async () => {
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));
      mockPageRenderer = createMockPageRenderer(1);
      sampler = new OcrStrategySampler(
        mockLogger,
        mockPageRenderer as any,
        mockTextExtractor as any,
      );

      await sampler.sample('/tmp/test.pdf', '/tmp/output', mockModel);

      expect(mockReadFileSync).toHaveBeenCalledWith('/tmp/pages/page_0.png');
    });

    test('sends correct image format in messages', async () => {
      const imageBuffer = Buffer.from('test-image');
      const expectedBase64 = imageBuffer.toString('base64');
      mockReadFileSync.mockReturnValue(imageBuffer);
      mockCallVision.mockResolvedValue(createMockKoreanHanjaMixResult(false));
      mockPageRenderer = createMockPageRenderer(1);
      sampler = new OcrStrategySampler(
        mockLogger,
        mockPageRenderer as any,
        mockTextExtractor as any,
      );

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
      sampler = new OcrStrategySampler(
        mockLogger,
        mockPageRenderer as any,
        mockTextExtractor as any,
      );

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
      sampler = new OcrStrategySampler(
        mockLogger,
        mockPageRenderer as any,
        mockTextExtractor as any,
      );

      mockCallVision
        .mockResolvedValueOnce(createMockKoreanHanjaMixResult(false, ['ko-KR']))
        .mockResolvedValueOnce(createMockKoreanHanjaMixResult(false, ['ko-KR']))
        .mockResolvedValueOnce(createMockKoreanHanjaMixResult(false, ['ko-KR']))
        .mockResolvedValueOnce(createMockKoreanHanjaMixResult(false, ['ko-KR']))
        .mockResolvedValueOnce(createMockKoreanHanjaMixResult(false, ['ko-KR']))
        .mockResolvedValueOnce(createMockKoreanHanjaMixResult(false, ['ko-KR']))
        .mockResolvedValueOnce(createMockKoreanHanjaMixResult(false, ['ko-KR']))
        .mockResolvedValueOnce(createMockKoreanHanjaMixResult(false, ['ko-KR']))
        .mockResolvedValueOnce(createMockKoreanHanjaMixResult(false, ['ko-KR']))
        .mockResolvedValueOnce(createMockKoreanHanjaMixResult(false, ['ko-KR']))
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
      sampler = new OcrStrategySampler(
        mockLogger,
        mockPageRenderer as any,
        mockTextExtractor as any,
      );

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
      expect(sampler.selectSamplePages(0, 15)).toEqual([]);
    });

    test('returns all pages when total <= maxSamples', () => {
      expect(sampler.selectSamplePages(3, 15)).toEqual([0, 1, 2]);
    });

    test('returns all pages when total equals maxSamples', () => {
      expect(sampler.selectSamplePages(15, 15)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
      ]);
    });

    test('trims front/back 10% for large documents', () => {
      // 20 pages: trim 2 from each end, eligible: 2-17 (indices)
      const result = sampler.selectSamplePages(20, 15);

      // All indices should be in eligible range [2, 18)
      for (const idx of result) {
        expect(idx).toBeGreaterThanOrEqual(2);
        expect(idx).toBeLessThan(18);
      }
      expect(result).toHaveLength(15);
    });

    test('distributes samples evenly across eligible range', () => {
      // 200 pages: trim 20 from each end, eligible: 20-179 (indices)
      const result = sampler.selectSamplePages(200, 15);

      expect(result).toHaveLength(15);
      expect(result[0]).toBe(20); // start of eligible range

      // Check samples are spaced roughly evenly
      for (let i = 1; i < result.length; i++) {
        const gap = result[i] - result[i - 1];
        expect(gap).toBeGreaterThan(0);
      }
    });

    test('returns middle page when trimming leaves no eligible pages', () => {
      // totalPages=2, maxSamples=1 → totalPages > maxSamples
      // trimCount = max(1, ceil(0.2)) = 1, start=1, end=1, eligible=0
      // Falls into eligibleCount <= 0 branch → middle page
      const result = sampler.selectSamplePages(2, 1);
      expect(result).toEqual([1]); // Math.floor(2/2) = 1
    });

    test('handles case where eligible count is less than maxSamples', () => {
      // 18 pages: trim=2, eligible: [2, 16) = 14 pages, maxSamples=15
      // 14 <= 15 → returns all eligible
      const result = sampler.selectSamplePages(18, 15);
      // totalPages=18 > maxSamples=15, so trim applies
      // trimCount = ceil(1.8) = 2, eligible: [2, 16) = 14
      // 14 <= 15, so returns all eligible
      expect(result).toHaveLength(14);
      for (const idx of result) {
        expect(idx).toBeGreaterThanOrEqual(2);
        expect(idx).toBeLessThan(16);
      }
    });

    test('returns all eligible pages when eligible count <= maxSamples', () => {
      // 20 pages: trim=2, eligible: [2, 18) = 16 pages, maxSamples=16
      const result = sampler.selectSamplePages(20, 16);
      expect(result).toHaveLength(16);
      for (const idx of result) {
        expect(idx).toBeGreaterThanOrEqual(2);
        expect(idx).toBeLessThan(18);
      }
    });

    test('returns unique indices (no duplicates)', () => {
      const result = sampler.selectSamplePages(50, 15);
      const unique = new Set(result);
      expect(unique.size).toBe(result.length);
    });

    test('returns sorted indices', () => {
      const result = sampler.selectSamplePages(50, 15);
      for (let i = 1; i < result.length; i++) {
        expect(result[i]).toBeGreaterThan(result[i - 1]);
      }
    });
  });

  describe('constructor', () => {
    test('creates default PdfTextExtractor when none provided', () => {
      const s = new OcrStrategySampler(mockLogger, mockPageRenderer as any);
      // PdfTextExtractor constructor was called via the mock
      expect(PdfTextExtractor).toHaveBeenCalledWith(mockLogger);
      expect(s).toBeInstanceOf(OcrStrategySampler);
    });
  });
});
