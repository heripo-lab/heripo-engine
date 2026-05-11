import type { LoggerMethods } from '@heripo/logger';

import { LLMTokenUsageAggregator } from '@heripo/shared';
import { copyFileSync } from 'node:fs';
import { type Mock, beforeEach, describe, expect, test, vi } from 'vitest';

import { PdfTextExtractor } from '../processors/pdf-text-extractor';
import { VlmTextCorrector } from '../processors/vlm-text-corrector';
import { runJqFileJson } from '../utils/jq';
import { VlmConversionPipeline } from './vlm-conversion-pipeline';

vi.mock('node:fs', () => ({
  copyFileSync: vi.fn(),
}));

vi.mock('node:path', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
}));

vi.mock('../utils/jq', () => ({
  runJqFileJson: vi.fn(),
}));

vi.mock('../processors/pdf-text-extractor', () => ({
  PdfTextExtractor: vi.fn(),
}));

vi.mock('../processors/vlm-text-corrector', () => ({
  VlmTextCorrector: vi.fn(),
}));

const mockModel = { modelId: 'test-model' } as any;

describe('VlmConversionPipeline', () => {
  let logger: LoggerMethods;
  let pipeline: VlmConversionPipeline;
  let mockCorrectorInstance: { correctAndSave: Mock };
  let mockTextExtractorInstance: { extractText: Mock };

  beforeEach(() => {
    vi.clearAllMocks();

    logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    pipeline = new VlmConversionPipeline(logger);

    mockCorrectorInstance = {
      correctAndSave: vi.fn().mockResolvedValue({
        textCorrections: 0,
        cellCorrections: 0,
        pagesProcessed: 5,
        pagesFailed: 0,
      }),
    };
    vi.mocked(VlmTextCorrector).mockImplementation(function () {
      return mockCorrectorInstance as any;
    });

    mockTextExtractorInstance = {
      extractText: vi.fn().mockResolvedValue(new Map<number, string>()),
    };
    vi.mocked(PdfTextExtractor).mockImplementation(function () {
      return mockTextExtractorInstance as any;
    });

    vi.mocked(runJqFileJson).mockResolvedValue(1);
  });

  describe('wrapCallback', () => {
    test('throws error when vlmProcessorModel is missing', () => {
      expect(() => pipeline.wrapCallback('/tmp/test.pdf', {}, vi.fn())).toThrow(
        'vlmProcessorModel is required when OCR strategy is VLM',
      );
    });

    test('still runs VLM correction when Review Assistance is enabled', async () => {
      const originalCallback = vi.fn();

      const wrapped = pipeline.wrapCallback(
        '/tmp/test.pdf',
        { reviewAssistance: true, vlmProcessorModel: mockModel },
        originalCallback,
      );

      await wrapped('/test/output');

      expect(wrapped).not.toBe(originalCallback);
      expect(VlmTextCorrector).toHaveBeenCalledWith(logger);
      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        '/test/output',
        mockModel,
        expect.objectContaining({ aggregator: undefined }),
      );
      expect(originalCallback).toHaveBeenCalledWith('/test/output');
    });

    test('returns a callback function', () => {
      const wrapped = pipeline.wrapCallback(
        '/tmp/test.pdf',
        { vlmProcessorModel: mockModel },
        vi.fn(),
      );
      expect(typeof wrapped).toBe('function');
    });

    test('wrapped callback calls VlmTextCorrector then original callback', async () => {
      const originalCallback = vi.fn();
      const wrapped = pipeline.wrapCallback(
        '/tmp/test.pdf',
        { vlmProcessorModel: mockModel },
        originalCallback,
      );

      await wrapped('/test/output');

      expect(VlmTextCorrector).toHaveBeenCalledWith(logger);
      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        '/test/output',
        mockModel,
        expect.objectContaining({
          aggregator: undefined,
          abortSignal: undefined,
        }),
      );
      expect(originalCallback).toHaveBeenCalledWith('/test/output');
    });

    test('wrapped callback extracts text with PdfTextExtractor and passes pageTexts', async () => {
      const pageTexts = new Map<number, string>();
      pageTexts.set(1, 'extracted text page 1');
      mockTextExtractorInstance.extractText.mockResolvedValue(pageTexts);
      vi.mocked(runJqFileJson).mockResolvedValue(2);

      const wrapped = pipeline.wrapCallback(
        '/tmp/test.pdf',
        { vlmProcessorModel: mockModel },
        vi.fn(),
      );

      await wrapped('/test/output');

      expect(PdfTextExtractor).toHaveBeenCalledWith(logger);
      expect(mockTextExtractorInstance.extractText).toHaveBeenCalledWith(
        '/tmp/test.pdf',
        2,
      );
      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        '/test/output',
        mockModel,
        expect.objectContaining({ pageTexts }),
      );
    });

    test('wrapped callback proceeds without pageTexts when extraction fails', async () => {
      mockTextExtractorInstance.extractText.mockRejectedValue(
        new Error('pdftotext not found'),
      );

      const wrapped = pipeline.wrapCallback(
        '/tmp/test.pdf',
        { vlmProcessorModel: mockModel },
        vi.fn(),
      );

      await wrapped('/test/output');

      expect(logger.warn).toHaveBeenCalledWith(
        '[PDFConverter] pdftotext extraction failed, proceeding without text reference',
      );
      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        '/test/output',
        mockModel,
        expect.objectContaining({ pageTexts: undefined }),
      );
    });

    test('wrapped callback proceeds without pageTexts when jq fails', async () => {
      vi.mocked(runJqFileJson).mockRejectedValue(new Error('ENOENT'));

      const wrapped = pipeline.wrapCallback(
        '/tmp/test.pdf',
        { vlmProcessorModel: mockModel },
        vi.fn(),
      );

      await wrapped('/test/output');

      expect(logger.warn).toHaveBeenCalledWith(
        '[PDFConverter] pdftotext extraction failed, proceeding without text reference',
      );
      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        '/test/output',
        mockModel,
        expect.objectContaining({ pageTexts: undefined }),
      );
    });

    test('copies result.json to result_ocr_origin.json before VLM correction', async () => {
      const wrapped = pipeline.wrapCallback(
        '/tmp/test.pdf',
        { vlmProcessorModel: mockModel },
        vi.fn(),
      );

      await wrapped('/test/output');

      expect(copyFileSync).toHaveBeenCalledWith(
        '/test/output/result.json',
        '/test/output/result_ocr_origin.json',
      );

      const copyOrder = vi.mocked(copyFileSync).mock.invocationCallOrder[0];
      const correctorOrder =
        mockCorrectorInstance.correctAndSave.mock.invocationCallOrder[0];
      expect(copyOrder).toBeLessThan(correctorOrder);
    });

    test('passes detectedLanguages to VlmTextCorrector as documentLanguages', async () => {
      const wrapped = pipeline.wrapCallback(
        '/tmp/test.pdf',
        { vlmProcessorModel: mockModel },
        vi.fn(),
        undefined,
        ['ko-KR'],
      );

      await wrapped('/test/output');

      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        '/test/output',
        mockModel,
        expect.objectContaining({ documentLanguages: ['ko-KR'] }),
      );
    });

    test('passes undefined documentLanguages when detectedLanguages is not provided', async () => {
      const wrapped = pipeline.wrapCallback(
        '/tmp/test.pdf',
        { vlmProcessorModel: mockModel },
        vi.fn(),
      );

      await wrapped('/test/output');

      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        '/test/output',
        mockModel,
        expect.objectContaining({ documentLanguages: undefined }),
      );
    });

    test('passes aggregator and abortSignal to VlmTextCorrector', async () => {
      const aggregator = new LLMTokenUsageAggregator();
      const abortController = new AbortController();

      const wrapped = pipeline.wrapCallback(
        '/tmp/test.pdf',
        { vlmProcessorModel: mockModel, aggregator },
        vi.fn(),
        abortController.signal,
      );

      await wrapped('/test/output');

      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        '/test/output',
        mockModel,
        expect.objectContaining({
          aggregator,
          abortSignal: abortController.signal,
        }),
      );
    });

    test('forwards onTokenUsage callback to VlmTextCorrector', async () => {
      const onTokenUsage = vi.fn();

      const wrapped = pipeline.wrapCallback(
        '/tmp/test.pdf',
        { vlmProcessorModel: mockModel, onTokenUsage },
        vi.fn(),
      );

      await wrapped('/test/output');

      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        '/test/output',
        mockModel,
        expect.objectContaining({ onTokenUsage }),
      );
    });

    test('forwards vlmConcurrency to VlmTextCorrector as concurrency', async () => {
      const wrapped = pipeline.wrapCallback(
        '/tmp/test.pdf',
        { vlmProcessorModel: mockModel, vlmConcurrency: 4 },
        vi.fn(),
      );

      await wrapped('/test/output');

      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        '/test/output',
        mockModel,
        expect.objectContaining({ concurrency: 4 }),
      );
    });

    test('propagates errors from VlmTextCorrector', async () => {
      mockCorrectorInstance.correctAndSave.mockRejectedValue(
        new Error('VLM correction failed'),
      );

      const wrapped = pipeline.wrapCallback(
        '/tmp/test.pdf',
        { vlmProcessorModel: mockModel },
        vi.fn(),
      );

      await expect(wrapped('/test/output')).rejects.toThrow(
        'VLM correction failed',
      );
    });
  });
});
