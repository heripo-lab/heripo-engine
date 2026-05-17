import type { LoggerMethods } from '@heripo/logger';

import { LLMCaller, type LLMTokenUsageAggregator } from '@heripo/shared';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { PdfLanguageDetector } from './pdf-language-detector';

vi.mock('@heripo/shared', () => ({
  LLMCaller: {
    callVision: vi.fn(),
  },
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

describe('PdfLanguageDetector', () => {
  let logger: LoggerMethods;
  let pageRenderer: { renderPages: ReturnType<typeof vi.fn> };
  let textExtractor: {
    getPageCount: ReturnType<typeof vi.fn>;
    extractFullText: ReturnType<typeof vi.fn>;
  };
  let detector: PdfLanguageDetector;

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    pageRenderer = {
      renderPages: vi.fn(),
    };
    textExtractor = {
      getPageCount: vi.fn(),
      extractFullText: vi.fn(),
    };
    detector = new PdfLanguageDetector(
      logger,
      pageRenderer as any,
      textExtractor as any,
    );
    vi.mocked(readFileSync).mockReturnValue(Buffer.from([1, 2, 3]));
    vi.mocked(LLMCaller.callVision).mockReset();
  });

  test('creates a default text extractor when none is provided', () => {
    const detectorWithDefaultExtractor = new PdfLanguageDetector(
      logger,
      pageRenderer as any,
    );

    expect(detectorWithDefaultExtractor).toBeInstanceOf(PdfLanguageDetector);
  });

  test('detects Korean and English from the PDF text layer without rendering pages', async () => {
    textExtractor.getPageCount.mockResolvedValue(12);
    textExtractor.extractFullText.mockResolvedValue(
      '조사지역은 연동 한가운데 있다. S=1/25,000',
    );

    const result = await detector.detect('/tmp/report.pdf', '/tmp/sampling');

    expect(result).toMatchObject({
      detectedLanguages: ['ko-KR', 'en-US'],
      source: 'text-layer',
      sampledPages: 12,
      totalPages: 12,
    });
    expect(pageRenderer.renderPages).not.toHaveBeenCalled();
  });

  test('detects Japanese and English from the PDF text layer by prevalence', async () => {
    textExtractor.getPageCount.mockResolvedValue(2);
    textExtractor.extractFullText.mockResolvedValue(
      '調査地域 ABC かなカナ かなカナ',
    );

    const result = await detector.detect('/tmp/report.pdf', '/tmp/sampling');

    expect(result).toMatchObject({
      detectedLanguages: ['ja-JP', 'en-US'],
      source: 'text-layer',
      sampledPages: 2,
      totalPages: 2,
    });
    expect(pageRenderer.renderPages).not.toHaveBeenCalled();
  });

  test('uses default OCR languages when text layer is empty and no model is configured', async () => {
    textExtractor.getPageCount.mockResolvedValue(3);
    textExtractor.extractFullText.mockResolvedValue('');

    const result = await detector.detect('/tmp/report.pdf', '/tmp/sampling');

    expect(result).toMatchObject({
      detectedLanguages: ['ko-KR', 'en-US'],
      source: 'default',
      sampledPages: 0,
    });
    expect(pageRenderer.renderPages).not.toHaveBeenCalled();
  });

  test('uses default OCR languages when the text layer has zero pages', async () => {
    textExtractor.getPageCount.mockResolvedValue(0);

    const result = await detector.detect('/tmp/report.pdf', '/tmp/sampling');

    expect(result).toMatchObject({
      detectedLanguages: ['ko-KR', 'en-US'],
      source: 'default',
      sampledPages: 0,
      totalPages: 0,
    });
    expect(textExtractor.extractFullText).not.toHaveBeenCalled();
    expect(pageRenderer.renderPages).not.toHaveBeenCalled();
  });

  test('uses default OCR languages when text layer detection throws and no model is configured', async () => {
    textExtractor.getPageCount.mockRejectedValue(new Error('pdfinfo failed'));

    const result = await detector.detect('/tmp/report.pdf', '/tmp/sampling');

    expect(result).toMatchObject({
      detectedLanguages: ['ko-KR', 'en-US'],
      source: 'default',
    });
    expect(logger.debug).toHaveBeenCalledWith(
      '[PdfLanguageDetector] Text layer language detection failed; falling back to sampled language detection',
    );
    expect(pageRenderer.renderPages).not.toHaveBeenCalled();
  });

  test('samples rendered pages with a model when the text layer has no language signal', async () => {
    const model = { modelId: 'language-model' } as any;
    textExtractor.getPageCount.mockResolvedValue(3);
    textExtractor.extractFullText.mockResolvedValue('12345');
    pageRenderer.renderPages.mockResolvedValue({
      pageCount: 3,
      pagesDir: '/tmp/sampling/pages',
      pageFiles: ['/tmp/page-1.png', '/tmp/page-2.png', '/tmp/page-3.png'],
    });
    vi.mocked(LLMCaller.callVision)
      .mockResolvedValueOnce({
        output: { detectedLanguages: ['ko'] },
        usage: { component: 'PdfLanguageDetector' },
      } as any)
      .mockResolvedValueOnce({
        output: { detectedLanguages: ['en-US'] },
        usage: { component: 'PdfLanguageDetector' },
      } as any)
      .mockResolvedValueOnce({
        output: { detectedLanguages: ['ko-KR'] },
        usage: { component: 'PdfLanguageDetector' },
      } as any);

    const result = await detector.detect('/tmp/report.pdf', '/tmp/sampling', {
      model,
    });

    expect(pageRenderer.renderPages).toHaveBeenCalledWith(
      '/tmp/report.pdf',
      '/tmp/sampling',
      {
        dpi: 150,
      },
    );
    expect(LLMCaller.callVision).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      detectedLanguages: ['ko-KR', 'en-US'],
      source: 'vlm',
      sampledPages: 3,
      totalPages: 3,
    });
  });

  test('uses default OCR languages when sampled rendering returns no pages', async () => {
    const model = { modelId: 'language-model' } as any;
    textExtractor.getPageCount.mockResolvedValue(3);
    textExtractor.extractFullText.mockResolvedValue('12345');
    pageRenderer.renderPages.mockResolvedValue({
      pageCount: 0,
      pagesDir: '/tmp/sampling/pages',
      pageFiles: [],
    });

    const result = await detector.detect('/tmp/report.pdf', '/tmp/sampling', {
      model,
    });

    expect(result).toMatchObject({
      detectedLanguages: ['ko-KR', 'en-US'],
      reason: 'No pages found in PDF',
      source: 'default',
      sampledPages: 0,
      totalPages: 0,
    });
    expect(LLMCaller.callVision).not.toHaveBeenCalled();
  });

  test('uses default OCR languages when sampled pages are missing', async () => {
    const model = { modelId: 'language-model' } as any;
    textExtractor.getPageCount.mockResolvedValue(3);
    textExtractor.extractFullText.mockResolvedValue('12345');
    pageRenderer.renderPages.mockResolvedValue({
      pageCount: 2,
      pagesDir: '/tmp/sampling/pages',
      pageFiles: [],
    });

    const result = await detector.detect('/tmp/report.pdf', '/tmp/sampling', {
      model,
    });

    expect(result).toMatchObject({
      detectedLanguages: ['ko-KR', 'en-US'],
      source: 'default',
      sampledPages: 0,
      totalPages: 2,
    });
    expect(LLMCaller.callVision).not.toHaveBeenCalled();
  });

  test('uses default OCR languages when sampled pages return no valid languages', async () => {
    const model = { modelId: 'language-model' } as any;
    const abortController = new AbortController();
    const track = vi.fn();
    const aggregator = { track } as unknown as LLMTokenUsageAggregator;
    textExtractor.getPageCount.mockResolvedValue(3);
    textExtractor.extractFullText.mockResolvedValue('12345');
    pageRenderer.renderPages.mockResolvedValue({
      pageCount: 1,
      pagesDir: '/tmp/sampling/pages',
      pageFiles: ['/tmp/page-1.png'],
    });
    vi.mocked(LLMCaller.callVision).mockResolvedValueOnce({
      output: { detectedLanguages: ['xx', 'und'] },
      usage: {
        component: 'PdfLanguageDetector',
        phase: 'language-detection',
        model: 'primary',
        modelName: 'language-model',
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
      },
    } as any);

    const result = await detector.detect('/tmp/report.pdf', '/tmp/sampling', {
      model,
      maxRetries: 5,
      temperature: 0.2,
      abortSignal: abortController.signal,
      aggregator,
    });

    expect(result).toMatchObject({
      detectedLanguages: ['ko-KR', 'en-US'],
      source: 'default',
      sampledPages: 1,
      totalPages: 1,
    });
    expect(LLMCaller.callVision).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryModel: model,
        maxRetries: 5,
        temperature: 0.2,
        abortSignal: abortController.signal,
        component: 'PdfLanguageDetector',
        phase: 'language-detection',
      }),
    );
    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'PdfLanguageDetector',
        totalTokens: 3,
      }),
    );
  });

  test('selects no pages for an empty document', () => {
    expect(detector.selectSamplePages(0, 15)).toEqual([]);
  });

  test('selects all pages when the document fits within the sample limit', () => {
    expect(detector.selectSamplePages(3, 15)).toEqual([0, 1, 2]);
  });

  test('selects the middle page when edge trimming leaves no eligible pages', () => {
    expect(detector.selectSamplePages(2, 0)).toEqual([1]);
  });

  test('selects all eligible middle pages when trimmed range fits within the sample limit', () => {
    expect(detector.selectSamplePages(20, 18)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    ]);
  });

  test('trims edges and distributes samples for large documents', () => {
    expect(detector.selectSamplePages(100, 5)).toEqual([10, 26, 42, 58, 74]);
  });
});
