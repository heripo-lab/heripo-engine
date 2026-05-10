import type { LoggerMethods } from '@heripo/logger';
import type { DoclingAPIClient } from 'docling-sdk';

import { LLMTokenUsageAggregator } from '@heripo/shared';
import { type Mock, beforeEach, describe, expect, test, vi } from 'vitest';

import { PDFConverter } from './pdf-converter';
import { StrategyResolver } from './strategy-resolver';
import { VlmConversionPipeline } from './vlm-conversion-pipeline';

const { mockAnalyzeAndSave } = vi.hoisted(() => ({
  mockAnalyzeAndSave: vi.fn(),
}));

vi.mock('./strategy-resolver', () => ({
  StrategyResolver: vi.fn(),
}));

vi.mock('./vlm-conversion-pipeline', () => ({
  VlmConversionPipeline: vi.fn(),
}));

vi.mock('./docling-conversion-executor', () => ({
  DoclingConversionExecutor: vi.fn(),
}));

vi.mock('./chunked-pdf-converter', () => ({
  ChunkedPDFConverter: vi.fn(),
}));

vi.mock('./image-pdf-converter', () => ({
  ImagePdfConverter: vi.fn(),
}));

vi.mock('../validators/document-type-validator', () => ({
  DocumentTypeValidator: vi.fn(),
}));

vi.mock('../processors/pdf-text-extractor', () => ({
  PdfTextExtractor: vi.fn(),
}));

vi.mock('../processors/review-assistance/review-assistance-runner', () => ({
  ReviewAssistanceRunner: class {
    analyzeAndSave = mockAnalyzeAndSave;
  },
}));

const mockModel = { modelId: 'test-model' } as any;
const mockFallbackModel = { modelId: 'fallback' } as any;

describe('PDFConverter.convertWithStrategy', () => {
  let logger: LoggerMethods;
  let client: DoclingAPIClient;
  let converter: PDFConverter;
  let mockOnComplete: Mock;
  let mockResolve: Mock;
  let mockWrapCallback: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    client = {
      convertSourceAsync: vi.fn(),
      getTaskResultFile: vi.fn(),
      getConfig: vi.fn().mockReturnValue({ baseUrl: 'http://localhost:5001' }),
    } as unknown as DoclingAPIClient;

    converter = new PDFConverter(logger, client);

    mockOnComplete = vi.fn();
    mockAnalyzeAndSave.mockResolvedValue({ summary: {} });

    // Mock StrategyResolver
    mockResolve = vi.fn().mockResolvedValue({
      method: 'ocrmac',
      reason: 'Forced: ocrmac',
      sampledPages: 0,
      totalPages: 0,
    });
    vi.mocked(StrategyResolver).mockImplementation(function () {
      return { resolve: mockResolve } as any;
    });

    // Mock VlmConversionPipeline
    mockWrapCallback = vi.fn().mockReturnValue(vi.fn());
    vi.mocked(VlmConversionPipeline).mockImplementation(function () {
      return { wrapCallback: mockWrapCallback } as any;
    });
  });

  describe('strategy resolver integration', () => {
    test('creates StrategyResolver with logger and calls resolve', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);
      const abortController = new AbortController();

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'ocrmac' },
        abortController.signal,
      );

      expect(StrategyResolver).toHaveBeenCalledWith(logger);
      expect(mockResolve).toHaveBeenCalledWith(
        '/tmp/test.pdf',
        'report-1',
        expect.objectContaining({ forcedMethod: 'ocrmac' }),
        abortController.signal,
      );

      convertSpy.mockRestore();
    });

    test('passes null pdfPath for non-file:// URLs', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      await converter.convertWithStrategy(
        'http://example.com/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'ocrmac' },
      );

      expect(mockResolve).toHaveBeenCalledWith(
        null,
        'report-1',
        expect.any(Object),
        undefined,
      );

      convertSpy.mockRestore();
    });
  });

  describe('ocrmac path', () => {
    test('delegates to convert() when strategy is ocrmac', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      const result = await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        true,
        { forcedMethod: 'ocrmac' },
      );

      expect(convertSpy).toHaveBeenCalledWith(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        true,
        expect.objectContaining({ forcedMethod: 'ocrmac' }),
        undefined,
      );
      expect(result.strategy.method).toBe('ocrmac');
      expect(result.tokenUsageReport).toBeNull();

      convertSpy.mockRestore();
    });

    test('returns null tokenUsageReport when ocrmac path has no LLM usage', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      const result = await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'ocrmac' },
      );

      expect(result.tokenUsageReport).toBeNull();

      convertSpy.mockRestore();
    });
  });

  describe('VLM path', () => {
    beforeEach(() => {
      mockResolve.mockResolvedValue({
        method: 'vlm',
        reason: 'Forced: vlm',
        sampledPages: 0,
        totalPages: 0,
      });
    });

    test('creates VlmConversionPipeline and calls wrapCallback with correct args', async () => {
      mockResolve.mockResolvedValue({
        method: 'vlm',
        reason: 'Korean-Hanja mix detected',
        sampledPages: 2,
        totalPages: 10,
        detectedLanguages: ['ko-KR'],
        koreanHanjaMixPages: [1, 3],
      });

      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);
      const abortController = new AbortController();

      await converter.convertWithStrategy(
        'file:///tmp/report.pdf',
        'report-1',
        mockOnComplete,
        false,
        {
          strategySamplerModel: mockModel,
          vlmProcessorModel: mockFallbackModel,
        },
        abortController.signal,
      );

      expect(VlmConversionPipeline).toHaveBeenCalledWith(logger);
      expect(mockWrapCallback).toHaveBeenCalledWith(
        '/tmp/report.pdf',
        expect.objectContaining({ vlmProcessorModel: mockFallbackModel }),
        mockOnComplete,
        abortController.signal,
        ['ko-KR'],
        [1, 3],
      );

      convertSpy.mockRestore();
    });

    test('delegates to convert() with wrapped callback', async () => {
      const wrappedFn = vi.fn();
      mockWrapCallback.mockReturnValue(wrappedFn);

      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      await converter.convertWithStrategy(
        'file:///tmp/report.pdf',
        'report-1',
        mockOnComplete,
        false,
        {
          forcedMethod: 'vlm',
          vlmProcessorModel: mockFallbackModel,
        },
      );

      expect(convertSpy).toHaveBeenCalledWith(
        'file:///tmp/report.pdf',
        'report-1',
        wrappedFn,
        false,
        expect.objectContaining({
          vlmProcessorModel: mockFallbackModel,
        }),
        undefined,
      );

      convertSpy.mockRestore();
    });

    test('runs VLM text correction before Review Assistance when enabled', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      await converter.convertWithStrategy(
        'file:///tmp/report.pdf',
        'report-1',
        mockOnComplete,
        false,
        {
          forcedMethod: 'vlm',
          reviewAssistance: true,
          vlmProcessorModel: mockModel,
        },
      );

      expect(VlmConversionPipeline).toHaveBeenCalledWith(logger);
      expect(mockWrapCallback).toHaveBeenCalledWith(
        '/tmp/report.pdf',
        expect.objectContaining({
          forcedMethod: 'vlm',
          reviewAssistance: true,
          vlmProcessorModel: mockModel,
        }),
        expect.any(Function),
        undefined,
        undefined,
        undefined,
      );
      expect(convertSpy).toHaveBeenCalledWith(
        'file:///tmp/report.pdf',
        'report-1',
        expect.any(Function),
        false,
        expect.objectContaining({
          forcedMethod: 'vlm',
          reviewAssistance: true,
        }),
        undefined,
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Review Assistance enabled; running VLM text correction before Review Assistance',
      );

      convertSpy.mockRestore();
    });

    test('runs Review Assistance callback before original callback', async () => {
      mockWrapCallback.mockImplementation(
        (
          _pdfPath: string,
          _options: unknown,
          postCorrectionCallback: (outputDir: string) => Promise<void> | void,
        ) =>
          async (outputDir: string) => {
            await postCorrectionCallback(outputDir);
          },
      );
      const convertSpy = vi
        .spyOn(converter, 'convert')
        .mockImplementation(
          async (
            _url,
            _reportId,
            onComplete,
            _cleanupAfterCallback,
            _options,
            _abortSignal,
          ) => {
            await onComplete('/tmp/output');
            return null;
          },
        );

      await converter.convertWithStrategy(
        'file:///tmp/report.pdf',
        'report-1',
        mockOnComplete,
        false,
        {
          forcedMethod: 'vlm',
          reviewAssistance: true,
          vlmProcessorModel: mockModel,
        },
      );

      expect(mockAnalyzeAndSave).toHaveBeenCalledWith(
        '/tmp/output',
        'report-1',
        mockModel,
        expect.objectContaining({
          enabled: true,
          pdfPath: '/tmp/report.pdf',
        }),
      );
      expect(mockOnComplete).toHaveBeenCalledWith('/tmp/output');

      convertSpy.mockRestore();
    });

    test('requires a model when Review Assistance is enabled', async () => {
      await expect(
        converter.convertWithStrategy(
          'file:///tmp/report.pdf',
          'report-1',
          mockOnComplete,
          false,
          {
            forcedMethod: 'vlm',
            reviewAssistance: true,
          },
        ),
      ).rejects.toThrow(
        'vlmProcessorModel or strategySamplerModel is required when Review Assistance is enabled',
      );
    });

    test('throws error when URL is not a local file', async () => {
      mockResolve.mockResolvedValue({
        method: 'vlm',
        reason: 'Forced: vlm',
        sampledPages: 0,
        totalPages: 0,
      });

      await expect(
        converter.convertWithStrategy(
          'http://example.com/test.pdf',
          'report-1',
          mockOnComplete,
          false,
          { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
        ),
      ).rejects.toThrow('VLM conversion requires a local file (file:// URL)');
    });

    test('propagates errors from convert()', async () => {
      const convertSpy = vi
        .spyOn(converter, 'convert')
        .mockRejectedValue(new Error('Docling conversion failed'));

      await expect(
        converter.convertWithStrategy(
          'file:///tmp/test.pdf',
          'report-1',
          mockOnComplete,
          false,
          { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
        ),
      ).rejects.toThrow('Docling conversion failed');

      convertSpy.mockRestore();
    });

    test('returns null tokenUsageReport for VLM path when no LLM calls tracked', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      const result = await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
      );

      expect(result.strategy.method).toBe('vlm');
      expect(result.tokenUsageReport).toBeNull();

      convertSpy.mockRestore();
    });
  });

  describe('token usage tracking', () => {
    test('creates internal aggregator and returns report when VLM tracks usage', async () => {
      mockResolve.mockResolvedValue({
        method: 'vlm',
        reason: 'Forced: vlm',
        sampledPages: 0,
        totalPages: 0,
      });

      mockWrapCallback.mockImplementation(
        (
          _pdfPath: string,
          options: { aggregator?: LLMTokenUsageAggregator },
        ) => {
          options.aggregator?.track({
            component: 'VlmTextCorrector',
            phase: 'text-correction',
            model: 'primary',
            modelName: 'test-model',
            inputTokens: 500,
            outputTokens: 200,
            totalTokens: 700,
          });
          return vi.fn();
        },
      );

      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      const result = await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
      );

      expect(result.tokenUsageReport).not.toBeNull();
      expect(result.tokenUsageReport!.components).toHaveLength(1);
      expect(result.tokenUsageReport!.components[0].component).toBe(
        'VlmTextCorrector',
      );
      expect(result.tokenUsageReport!.total.inputTokens).toBe(500);
      expect(result.tokenUsageReport!.total.outputTokens).toBe(200);
      expect(result.tokenUsageReport!.total.totalTokens).toBe(700);

      convertSpy.mockRestore();
    });

    test('returns null tokenUsageReport when no LLM calls are tracked', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      const result = await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'ocrmac' },
      );

      expect(result.tokenUsageReport).toBeNull();

      convertSpy.mockRestore();
    });

    test('calls onTokenUsage after strategy resolution when LLM calls were tracked', async () => {
      // Simulate StrategyResolver populating aggregator during resolve
      mockResolve.mockImplementation(
        async (
          _pdfPath: string | null,
          _reportId: string,
          options: { aggregator?: LLMTokenUsageAggregator },
        ) => {
          options.aggregator?.track({
            component: 'OcrStrategySampler',
            phase: 'korean-hanja-mix-detection',
            model: 'primary',
            modelName: 'sampler-model',
            inputTokens: 800,
            outputTokens: 30,
            totalTokens: 830,
          });
          return {
            method: 'ocrmac' as const,
            reason: 'No Korean-Hanja mix detected',
            sampledPages: 3,
            totalPages: 10,
          };
        },
      );

      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);
      const onTokenUsage = vi.fn();

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { strategySamplerModel: mockModel, onTokenUsage },
      );

      expect(onTokenUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          components: expect.arrayContaining([
            expect.objectContaining({ component: 'OcrStrategySampler' }),
          ]),
          total: expect.objectContaining({ inputTokens: 800 }),
        }),
      );

      convertSpy.mockRestore();
    });

    test('does not call onTokenUsage when no LLM calls were tracked', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);
      const onTokenUsage = vi.fn();

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'ocrmac', onTokenUsage },
      );

      expect(onTokenUsage).not.toHaveBeenCalled();

      convertSpy.mockRestore();
    });

    test('uses externally provided aggregator instead of creating a new one', async () => {
      mockResolve.mockResolvedValue({
        method: 'vlm',
        reason: 'Forced: vlm',
        sampledPages: 0,
        totalPages: 0,
      });

      const externalAggregator = new LLMTokenUsageAggregator();

      mockWrapCallback.mockImplementation(
        (
          _pdfPath: string,
          options: { aggregator?: LLMTokenUsageAggregator },
        ) => {
          options.aggregator?.track({
            component: 'VlmTextCorrector',
            phase: 'text-correction',
            model: 'primary',
            modelName: 'test-model',
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
          });
          return vi.fn();
        },
      );

      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        {
          forcedMethod: 'vlm',
          vlmProcessorModel: mockModel,
          aggregator: externalAggregator,
        },
      );

      const report = externalAggregator.getReport();
      expect(report.components).toHaveLength(1);
      expect(report.total.totalTokens).toBe(150);

      convertSpy.mockRestore();
    });
  });

  describe('logging', () => {
    test('logs strategy-based conversion start', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'ocrmac' },
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Starting strategy-based conversion:',
        'file:///tmp/test.pdf',
      );

      convertSpy.mockRestore();
    });

    test('logs determined strategy', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'ocrmac' },
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] OCR strategy: ocrmac (Forced: ocrmac)',
      );

      convertSpy.mockRestore();
    });

    test('logs VLM conversion completion', async () => {
      mockResolve.mockResolvedValue({
        method: 'vlm',
        reason: 'Forced: vlm',
        sampledPages: 0,
        totalPages: 0,
      });

      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] VLM conversion completed successfully',
      );

      convertSpy.mockRestore();
    });

    test('logs Review Assistance for ocrmac strategy', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        {
          forcedMethod: 'ocrmac',
          reviewAssistance: true,
          vlmProcessorModel: mockModel,
        },
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Review Assistance enabled for ocrmac strategy',
      );

      convertSpy.mockRestore();
    });

    test('requires local file for Review Assistance on ocrmac strategy', async () => {
      await expect(
        converter.convertWithStrategy(
          'http://example.com/test.pdf',
          'report-1',
          mockOnComplete,
          false,
          {
            forcedMethod: 'ocrmac',
            reviewAssistance: true,
            vlmProcessorModel: mockModel,
          },
        ),
      ).rejects.toThrow('Review Assistance requires a local file');
    });
  });

  describe('detectedLanguages → ocr_lang passthrough', () => {
    test('VLM path passes detectedLanguages as ocr_lang to convert()', async () => {
      mockResolve.mockResolvedValue({
        method: 'vlm',
        reason: 'Korean-Hanja mix detected',
        sampledPages: 2,
        totalPages: 10,
        detectedLanguages: ['ko-KR', 'zh-Hans'],
      });

      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      await converter.convertWithStrategy(
        'file:///tmp/report.pdf',
        'report-1',
        mockOnComplete,
        false,
        {
          strategySamplerModel: mockModel,
          vlmProcessorModel: mockFallbackModel,
        },
      );

      expect(convertSpy).toHaveBeenCalledWith(
        'file:///tmp/report.pdf',
        'report-1',
        expect.any(Function),
        false,
        expect.objectContaining({ ocr_lang: ['ko-KR', 'zh-Hans'] }),
        undefined,
      );

      convertSpy.mockRestore();
    });

    test('VLM path preserves existing options when detectedLanguages is undefined', async () => {
      mockResolve.mockResolvedValue({
        method: 'vlm',
        reason: 'Forced: vlm',
        sampledPages: 0,
        totalPages: 0,
      });

      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        {
          forcedMethod: 'vlm',
          vlmProcessorModel: mockModel,
          ocr_lang: ['en-US'],
        },
      );

      expect(convertSpy).toHaveBeenCalledWith(
        'file:///tmp/test.pdf',
        'report-1',
        expect.any(Function),
        false,
        expect.objectContaining({ ocr_lang: ['en-US'] }),
        undefined,
      );

      convertSpy.mockRestore();
    });

    test('ocrmac path passes detectedLanguages as ocr_lang to convert()', async () => {
      mockResolve.mockResolvedValue({
        method: 'ocrmac',
        reason: 'No Korean-Hanja mix detected',
        sampledPages: 3,
        totalPages: 10,
        detectedLanguages: ['ko-KR'],
      });

      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      await converter.convertWithStrategy(
        'file:///tmp/report.pdf',
        'report-1',
        mockOnComplete,
        false,
        { strategySamplerModel: mockModel },
      );

      expect(convertSpy).toHaveBeenCalledWith(
        'file:///tmp/report.pdf',
        'report-1',
        mockOnComplete,
        false,
        expect.objectContaining({ ocr_lang: ['ko-KR'] }),
        undefined,
      );

      convertSpy.mockRestore();
    });

    test('ocrmac path preserves existing options when detectedLanguages is undefined', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'ocrmac', ocr_lang: ['ja-JP'] },
      );

      expect(convertSpy).toHaveBeenCalledWith(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        expect.objectContaining({ ocr_lang: ['ja-JP'] }),
        undefined,
      );

      convertSpy.mockRestore();
    });

    test('VLM path passes sampled detectedLanguages as ocr_lang when forcedMethod + strategySamplerModel', async () => {
      mockResolve.mockResolvedValue({
        method: 'vlm',
        reason: 'Forced: vlm (No Korean-Hanja mix detected)',
        sampledPages: 3,
        totalPages: 10,
        detectedLanguages: ['ko-KR'],
      });

      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      await converter.convertWithStrategy(
        'file:///tmp/report.pdf',
        'report-1',
        mockOnComplete,
        false,
        {
          strategySamplerModel: mockModel,
          vlmProcessorModel: mockFallbackModel,
          forcedMethod: 'vlm',
        },
      );

      expect(convertSpy).toHaveBeenCalledWith(
        'file:///tmp/report.pdf',
        'report-1',
        expect.any(Function),
        false,
        expect.objectContaining({ ocr_lang: ['ko-KR'] }),
        undefined,
      );

      convertSpy.mockRestore();
    });
  });
});
