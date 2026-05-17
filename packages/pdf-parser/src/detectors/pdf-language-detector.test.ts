import type { LoggerMethods } from '@heripo/logger';

import { LLMCaller } from '@heripo/shared';
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

  test('selects all pages when the document fits within the sample limit', () => {
    expect(detector.selectSamplePages(3, 15)).toEqual([0, 1, 2]);
  });

  test('trims edges and distributes samples for large documents', () => {
    expect(detector.selectSamplePages(100, 5)).toEqual([10, 26, 42, 58, 74]);
  });
});
