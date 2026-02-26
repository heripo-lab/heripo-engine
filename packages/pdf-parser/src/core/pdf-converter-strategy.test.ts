import type { LoggerMethods } from '@heripo/logger';
import type { DoclingAPIClient } from 'docling-sdk';

import { LLMTokenUsageAggregator } from '@heripo/shared';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { type Mock, beforeEach, describe, expect, test, vi } from 'vitest';

import { PageRenderer } from '../processors/page-renderer';
import { PdfTextExtractor } from '../processors/pdf-text-extractor';
import { VlmTextCorrector } from '../processors/vlm-text-corrector';
import { OcrStrategySampler } from '../samplers/ocr-strategy-sampler';
import { PDFConverter } from './pdf-converter';

vi.mock('node:fs', () => ({
  copyFileSync: vi.fn(),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  createWriteStream: vi.fn(),
}));

vi.mock('node:path', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
}));

vi.mock('../samplers/ocr-strategy-sampler', () => ({
  OcrStrategySampler: vi.fn(),
}));

vi.mock('../processors/page-renderer', () => ({
  PageRenderer: vi.fn(),
}));

vi.mock('../processors/pdf-text-extractor', () => ({
  PdfTextExtractor: vi.fn(),
}));

vi.mock('../processors/vlm-text-corrector', () => ({
  VlmTextCorrector: vi.fn(),
}));

const mockModel = { modelId: 'test-model' } as any;
const mockFallbackModel = { modelId: 'fallback' } as any;

describe('PDFConverter.convertWithStrategy', () => {
  let logger: LoggerMethods;
  let client: DoclingAPIClient;
  let converter: PDFConverter;
  let mockOnComplete: Mock;
  let mockSamplerInstance: { sample: Mock };
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

    client = {
      convertSourceAsync: vi.fn(),
      getTaskResultFile: vi.fn(),
    } as unknown as DoclingAPIClient;

    converter = new PDFConverter(logger, client);

    mockOnComplete = vi.fn();

    vi.spyOn(process, 'cwd').mockReturnValue('/test/cwd');

    // Default: existsSync returns false (no cleanup needed)
    vi.mocked(existsSync).mockReturnValue(false);

    // Mock OcrStrategySampler constructor
    mockSamplerInstance = {
      sample: vi.fn().mockResolvedValue({
        method: 'ocrmac',
        reason: 'No Korean-Hanja mix detected',
        sampledPages: 3,
        totalPages: 10,
      }),
    };
    vi.mocked(OcrStrategySampler).mockImplementation(function () {
      return mockSamplerInstance as any;
    });

    // Mock VlmTextCorrector constructor
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

    // Mock PdfTextExtractor constructor
    mockTextExtractorInstance = {
      extractText: vi.fn().mockResolvedValue(new Map<number, string>()),
    };
    vi.mocked(PdfTextExtractor).mockImplementation(function () {
      return mockTextExtractorInstance as any;
    });

    // Default: readFileSync returns a doc with 1 page for wrappedCallback
    vi.mocked(readFileSync).mockReturnValue(
      Buffer.from(JSON.stringify({ pages: { '1': { page_no: 1 } } })),
    );
  });

  describe('strategy determination', () => {
    test('uses forced method when forcedMethod is specified', async () => {
      // Spy on convert to prevent actual Docling call
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      const result = await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
      );

      expect(result.strategy.method).toBe('vlm');
      expect(result.strategy.reason).toBe('Forced: vlm');
      expect(result.strategy.sampledPages).toBe(0);
      // Should not call sampler
      expect(mockSamplerInstance.sample).not.toHaveBeenCalled();

      convertSpy.mockRestore();
    });

    test('uses forced ocrmac method', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      const result = await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'ocrmac' },
      );

      expect(result.strategy.method).toBe('ocrmac');
      expect(result.strategy.reason).toBe('Forced: ocrmac');
      expect(mockSamplerInstance.sample).not.toHaveBeenCalled();

      convertSpy.mockRestore();
    });

    test('defaults to ocrmac when skipSampling is true', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      const result = await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { skipSampling: true, strategySamplerModel: mockModel },
      );

      expect(result.strategy.method).toBe('ocrmac');
      expect(result.strategy.reason).toBe('Sampling skipped');
      expect(mockSamplerInstance.sample).not.toHaveBeenCalled();

      convertSpy.mockRestore();
    });

    test('defaults to ocrmac when no strategySamplerModel', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      const result = await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        {},
      );

      expect(result.strategy.method).toBe('ocrmac');
      expect(result.strategy.reason).toBe('Sampling skipped');

      convertSpy.mockRestore();
    });

    test('defaults to ocrmac for non-local URL (http)', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      const result = await converter.convertWithStrategy(
        'http://example.com/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { strategySamplerModel: mockModel },
      );

      expect(result.strategy.method).toBe('ocrmac');
      expect(result.strategy.reason).toBe('Non-local URL, sampling skipped');

      convertSpy.mockRestore();
    });

    test('calls OcrStrategySampler when strategySamplerModel is provided', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      const aggregator = new LLMTokenUsageAggregator();
      const abortController = new AbortController();

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { strategySamplerModel: mockModel, aggregator },
        abortController.signal,
      );

      expect(OcrStrategySampler).toHaveBeenCalledWith(
        logger,
        expect.any(Object),
        expect.any(Object),
      );
      expect(PageRenderer).toHaveBeenCalledWith(logger);
      expect(mockSamplerInstance.sample).toHaveBeenCalledWith(
        '/tmp/test.pdf',
        '/test/cwd/output/report-1/_sampling',
        mockModel,
        { aggregator, abortSignal: abortController.signal },
      );

      convertSpy.mockRestore();
    });

    test('cleans up sampling directory after sampling', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      vi.mocked(existsSync).mockReturnValue(true);

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { strategySamplerModel: mockModel },
      );

      expect(rmSync).toHaveBeenCalledWith(
        '/test/cwd/output/report-1/_sampling',
        { recursive: true, force: true },
      );

      convertSpy.mockRestore();
    });

    test('cleans up sampling directory even when sampling fails', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      mockSamplerInstance.sample.mockRejectedValue(
        new Error('Sampling failed'),
      );

      await expect(
        converter.convertWithStrategy(
          'file:///tmp/test.pdf',
          'report-1',
          mockOnComplete,
          false,
          { strategySamplerModel: mockModel },
        ),
      ).rejects.toThrow('Sampling failed');

      expect(rmSync).toHaveBeenCalledWith(
        '/test/cwd/output/report-1/_sampling',
        { recursive: true, force: true },
      );
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

      // Forced ocrmac skips sampling, so aggregator has no data → null
      expect(result.tokenUsageReport).toBeNull();

      convertSpy.mockRestore();
    });
  });

  describe('VLM path', () => {
    test('delegates to convert() with file URL when strategy is VLM', async () => {
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

      // convertWithVlm delegates to convert() with the file URL
      expect(convertSpy).toHaveBeenCalledWith(
        'file:///tmp/report.pdf',
        'report-1',
        expect.any(Function), // wrapped callback
        false,
        expect.objectContaining({
          vlmProcessorModel: mockFallbackModel,
        }),
        undefined,
      );

      convertSpy.mockRestore();
    });

    test('wrapped callback calls VlmTextCorrector then onComplete', async () => {
      // Capture the wrapped callback passed to convert()
      const convertSpy = vi
        .spyOn(converter, 'convert')
        .mockImplementation(async (_url, _id, callback) => {
          // Invoke the wrapped callback to test its behavior
          await callback('/test/output');
          return null;
        });

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
      );

      // VlmTextCorrector should have been instantiated and called
      expect(VlmTextCorrector).toHaveBeenCalledWith(logger);
      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        '/test/output',
        mockModel,
        expect.objectContaining({
          aggregator: expect.any(LLMTokenUsageAggregator),
        }),
      );

      // Original onComplete should have been called after correction
      expect(mockOnComplete).toHaveBeenCalledWith('/test/output');

      convertSpy.mockRestore();
    });

    test('passes detectedLanguages to VlmTextCorrector as documentLanguages', async () => {
      mockSamplerInstance.sample.mockResolvedValue({
        method: 'vlm',
        reason: 'Korean-Hanja mix detected',
        sampledPages: 2,
        totalPages: 10,
        detectedLanguages: ['ko-KR'],
      });

      const convertSpy = vi
        .spyOn(converter, 'convert')
        .mockImplementation(async (_url, _id, callback) => {
          await callback('/test/output');
          return null;
        });

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

      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        '/test/output',
        mockFallbackModel,
        expect.objectContaining({ documentLanguages: ['ko-KR'] }),
      );

      convertSpy.mockRestore();
    });

    test('passes undefined documentLanguages when strategy has no detectedLanguages', async () => {
      const convertSpy = vi
        .spyOn(converter, 'convert')
        .mockImplementation(async (_url, _id, callback) => {
          await callback('/test/output');
          return null;
        });

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
      );

      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        expect.any(String),
        mockModel,
        expect.objectContaining({ documentLanguages: undefined }),
      );

      convertSpy.mockRestore();
    });

    test('passes aggregator and abortSignal to VlmTextCorrector', async () => {
      const aggregator = new LLMTokenUsageAggregator();
      const abortController = new AbortController();

      const convertSpy = vi
        .spyOn(converter, 'convert')
        .mockImplementation(async (_url, _id, callback) => {
          await callback('/test/output');
          return null;
        });

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        {
          forcedMethod: 'vlm',
          vlmProcessorModel: mockModel,
          aggregator,
        },
        abortController.signal,
      );

      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        '/test/output',
        mockModel,
        expect.objectContaining({
          aggregator,
          abortSignal: abortController.signal,
        }),
      );

      convertSpy.mockRestore();
    });

    test('forwards onTokenUsage callback to VlmTextCorrector', async () => {
      const onTokenUsage = vi.fn();

      const convertSpy = vi
        .spyOn(converter, 'convert')
        .mockImplementation(async (_url, _id, callback) => {
          await callback('/test/output');
          return null;
        });

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        {
          forcedMethod: 'vlm',
          vlmProcessorModel: mockModel,
          onTokenUsage,
        },
      );

      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        expect.any(String),
        mockModel,
        expect.objectContaining({ onTokenUsage }),
      );

      convertSpy.mockRestore();
    });

    test('forwards vlmConcurrency to VlmTextCorrector as concurrency', async () => {
      const convertSpy = vi
        .spyOn(converter, 'convert')
        .mockImplementation(async (_url, _id, callback) => {
          await callback('/test/output');
          return null;
        });

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        {
          forcedMethod: 'vlm',
          vlmProcessorModel: mockModel,
          vlmConcurrency: 4,
        },
      );

      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        expect.any(String),
        mockModel,
        expect.objectContaining({ concurrency: 4 }),
      );

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

    test('throws error when vlmProcessorModel is missing', async () => {
      await expect(
        converter.convertWithStrategy(
          'file:///tmp/test.pdf',
          'report-1',
          mockOnComplete,
          false,
          { forcedMethod: 'vlm' },
        ),
      ).rejects.toThrow(
        'vlmProcessorModel is required when OCR strategy is VLM',
      );
    });

    test('throws error when URL is not a local file', async () => {
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

    test('propagates errors from VlmTextCorrector', async () => {
      const convertSpy = vi
        .spyOn(converter, 'convert')
        .mockImplementation(async (_url, _id, callback) => {
          await callback('/test/output');
          return null;
        });

      mockCorrectorInstance.correctAndSave.mockRejectedValue(
        new Error('VLM correction failed'),
      );

      await expect(
        converter.convertWithStrategy(
          'file:///tmp/test.pdf',
          'report-1',
          mockOnComplete,
          false,
          { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
        ),
      ).rejects.toThrow('VLM correction failed');

      convertSpy.mockRestore();
    });
  });

  describe('token usage tracking', () => {
    test('creates internal aggregator and returns report when VLM tracks usage', async () => {
      // Simulate VlmTextCorrector calling aggregator.track() during processing
      mockCorrectorInstance.correctAndSave.mockImplementation(
        async (
          _outputDir: string,
          _model: unknown,
          opts: { aggregator?: LLMTokenUsageAggregator },
        ) => {
          opts.aggregator?.track({
            component: 'VlmTextCorrector',
            phase: 'text-correction',
            model: 'primary',
            modelName: 'test-model',
            inputTokens: 500,
            outputTokens: 200,
            totalTokens: 700,
          });
          return {
            textCorrections: 1,
            cellCorrections: 0,
            pagesProcessed: 1,
            pagesFailed: 0,
          };
        },
      );

      const convertSpy = vi
        .spyOn(converter, 'convert')
        .mockImplementation(async (_url, _id, callback) => {
          await callback('/test/output');
          return null;
        });

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

    test('returns token report with sampling usage on ocrmac path', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);

      // Simulate OcrStrategySampler calling aggregator.track() during sampling
      mockSamplerInstance.sample.mockImplementation(
        async (
          _pdfPath: string,
          _samplingDir: string,
          _model: unknown,
          opts: { aggregator?: LLMTokenUsageAggregator },
        ) => {
          opts.aggregator?.track({
            component: 'OcrStrategySampler',
            phase: 'korean-hanja-mix-detection',
            model: 'primary',
            modelName: 'sampler-model',
            inputTokens: 1000,
            outputTokens: 50,
            totalTokens: 1050,
          });
          return {
            method: 'ocrmac' as const,
            reason: 'No Korean-Hanja mix detected',
            sampledPages: 3,
            totalPages: 10,
          };
        },
      );

      const result = await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { strategySamplerModel: mockModel },
      );

      expect(result.strategy.method).toBe('ocrmac');
      expect(result.tokenUsageReport).not.toBeNull();
      expect(result.tokenUsageReport!.components).toHaveLength(1);
      expect(result.tokenUsageReport!.components[0].component).toBe(
        'OcrStrategySampler',
      );
      expect(result.tokenUsageReport!.total.inputTokens).toBe(1000);
      expect(result.tokenUsageReport!.total.outputTokens).toBe(50);

      convertSpy.mockRestore();
    });

    test('returns combined report with both sampling and VLM usage', async () => {
      // Simulate sampling tracking
      mockSamplerInstance.sample.mockImplementation(
        async (
          _pdfPath: string,
          _samplingDir: string,
          _model: unknown,
          opts: { aggregator?: LLMTokenUsageAggregator },
        ) => {
          opts.aggregator?.track({
            component: 'OcrStrategySampler',
            phase: 'korean-hanja-mix-detection',
            model: 'primary',
            modelName: 'sampler-model',
            inputTokens: 800,
            outputTokens: 30,
            totalTokens: 830,
          });
          return {
            method: 'vlm' as const,
            reason: 'Korean-Hanja mix detected',
            sampledPages: 3,
            totalPages: 10,
          };
        },
      );

      // Simulate VlmTextCorrector tracking
      mockCorrectorInstance.correctAndSave.mockImplementation(
        async (
          _outputDir: string,
          _model: unknown,
          opts: { aggregator?: LLMTokenUsageAggregator },
        ) => {
          opts.aggregator?.track({
            component: 'VlmTextCorrector',
            phase: 'text-correction',
            model: 'primary',
            modelName: 'vlm-model',
            inputTokens: 5000,
            outputTokens: 1500,
            totalTokens: 6500,
          });
          return {
            textCorrections: 3,
            cellCorrections: 1,
            pagesProcessed: 5,
            pagesFailed: 0,
          };
        },
      );

      const convertSpy = vi
        .spyOn(converter, 'convert')
        .mockImplementation(async (_url, _id, callback) => {
          await callback('/test/output');
          return null;
        });

      const result = await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        {
          strategySamplerModel: mockModel,
          vlmProcessorModel: mockFallbackModel,
        },
      );

      expect(result.strategy.method).toBe('vlm');
      expect(result.tokenUsageReport).not.toBeNull();
      expect(result.tokenUsageReport!.components).toHaveLength(2);
      expect(result.tokenUsageReport!.total.inputTokens).toBe(5800);
      expect(result.tokenUsageReport!.total.outputTokens).toBe(1530);
      expect(result.tokenUsageReport!.total.totalTokens).toBe(7330);

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

    test('calls onTokenUsage after sampling phase with sampling report', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);
      const onTokenUsage = vi.fn();

      // Simulate OcrStrategySampler calling aggregator.track() during sampling
      mockSamplerInstance.sample.mockImplementation(
        async (
          _pdfPath: string,
          _samplingDir: string,
          _model: unknown,
          opts: { aggregator?: LLMTokenUsageAggregator },
        ) => {
          opts.aggregator?.track({
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

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { strategySamplerModel: mockModel, onTokenUsage },
      );

      // onTokenUsage should be called after sampling completes
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

    test('does not call onTokenUsage after sampling when no LLM calls were tracked', async () => {
      const convertSpy = vi.spyOn(converter, 'convert').mockResolvedValue(null);
      const onTokenUsage = vi.fn();

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'ocrmac', onTokenUsage },
      );

      // Forced ocrmac skips sampling entirely → no LLM usage → onTokenUsage not called
      expect(onTokenUsage).not.toHaveBeenCalled();

      convertSpy.mockRestore();
    });

    test('uses externally provided aggregator instead of creating a new one', async () => {
      const externalAggregator = new LLMTokenUsageAggregator();

      mockCorrectorInstance.correctAndSave.mockImplementation(
        async (
          _outputDir: string,
          _model: unknown,
          opts: { aggregator?: LLMTokenUsageAggregator },
        ) => {
          opts.aggregator?.track({
            component: 'VlmTextCorrector',
            phase: 'text-correction',
            model: 'primary',
            modelName: 'test-model',
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
          });
          return {
            textCorrections: 0,
            cellCorrections: 0,
            pagesProcessed: 1,
            pagesFailed: 0,
          };
        },
      );

      const convertSpy = vi
        .spyOn(converter, 'convert')
        .mockImplementation(async (_url, _id, callback) => {
          await callback('/test/output');
          return null;
        });

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

      // External aggregator should have the tracked usage
      const report = externalAggregator.getReport();
      expect(report.components).toHaveLength(1);
      expect(report.total.totalTokens).toBe(150);

      convertSpy.mockRestore();
    });

    test('creates internal aggregator when none provided and passes to VlmTextCorrector', async () => {
      const convertSpy = vi
        .spyOn(converter, 'convert')
        .mockImplementation(async (_url, _id, callback) => {
          await callback('/test/output');
          return null;
        });

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
      );

      // VlmTextCorrector should receive an LLMTokenUsageAggregator instance
      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        '/test/output',
        mockModel,
        expect.objectContaining({
          aggregator: expect.any(LLMTokenUsageAggregator),
        }),
      );

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
  });

  describe('pdftotext extraction in VLM path', () => {
    test('extracts text with PdfTextExtractor and passes pageTexts to VlmTextCorrector', async () => {
      const pageTexts = new Map<number, string>();
      pageTexts.set(1, 'extracted text page 1');
      mockTextExtractorInstance.extractText.mockResolvedValue(pageTexts);

      vi.mocked(readFileSync).mockReturnValue(
        Buffer.from(
          JSON.stringify({
            pages: { '1': { page_no: 1 }, '2': { page_no: 2 } },
          }),
        ),
      );

      const convertSpy = vi
        .spyOn(converter, 'convert')
        .mockImplementation(async (_url, _id, callback) => {
          await callback('/test/output');
          return null;
        });

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
      );

      // PdfTextExtractor should have been called with pdfPath and totalPages
      expect(PdfTextExtractor).toHaveBeenCalledWith(logger);
      expect(mockTextExtractorInstance.extractText).toHaveBeenCalledWith(
        '/tmp/test.pdf',
        2,
      );

      // VlmTextCorrector should receive the pageTexts
      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        '/test/output',
        mockModel,
        expect.objectContaining({ pageTexts }),
      );

      convertSpy.mockRestore();
    });

    test('proceeds without pageTexts when PdfTextExtractor fails', async () => {
      mockTextExtractorInstance.extractText.mockRejectedValue(
        new Error('pdftotext not found'),
      );

      const convertSpy = vi
        .spyOn(converter, 'convert')
        .mockImplementation(async (_url, _id, callback) => {
          await callback('/test/output');
          return null;
        });

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
      );

      // Should warn but not throw
      expect(logger.warn).toHaveBeenCalledWith(
        '[PDFConverter] pdftotext extraction failed, proceeding without text reference',
      );

      // VlmTextCorrector should still be called with undefined pageTexts
      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        '/test/output',
        mockModel,
        expect.objectContaining({ pageTexts: undefined }),
      );

      convertSpy.mockRestore();
    });

    test('proceeds without pageTexts when result.json read fails', async () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const convertSpy = vi
        .spyOn(converter, 'convert')
        .mockImplementation(async (_url, _id, callback) => {
          await callback('/test/output');
          return null;
        });

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
      );

      expect(logger.warn).toHaveBeenCalledWith(
        '[PDFConverter] pdftotext extraction failed, proceeding without text reference',
      );

      expect(mockCorrectorInstance.correctAndSave).toHaveBeenCalledWith(
        '/test/output',
        mockModel,
        expect.objectContaining({ pageTexts: undefined }),
      );

      convertSpy.mockRestore();
    });
  });

  describe('detectedLanguages → ocr_lang passthrough', () => {
    test('VLM path passes detectedLanguages as ocr_lang to convert()', async () => {
      mockSamplerInstance.sample.mockResolvedValue({
        method: 'vlm',
        reason: 'Korean-Hanja mix detected',
        sampledPages: 2,
        totalPages: 10,
        detectedLanguages: ['ko-KR', 'zh-CN'],
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
        expect.objectContaining({ ocr_lang: ['ko-KR', 'zh-CN'] }),
        undefined,
      );

      convertSpy.mockRestore();
    });

    test('VLM path preserves existing options when detectedLanguages is undefined', async () => {
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

      // When detectedLanguages is undefined, original ocr_lang should be preserved
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
      mockSamplerInstance.sample.mockResolvedValue({
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
  });

  describe('OCR origin result saving', () => {
    test('copies result.json to result_ocr_origin.json before VLM correction', async () => {
      const convertSpy = vi
        .spyOn(converter, 'convert')
        .mockImplementation(async (_url, _id, callback) => {
          await callback('/test/output');
          return null;
        });

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
      );

      expect(copyFileSync).toHaveBeenCalledWith(
        '/test/output/result.json',
        '/test/output/result_ocr_origin.json',
      );

      // copyFileSync should be called before VlmTextCorrector.correctAndSave
      const copyOrder = vi.mocked(copyFileSync).mock.invocationCallOrder[0];
      const correctorOrder =
        mockCorrectorInstance.correctAndSave.mock.invocationCallOrder[0];
      expect(copyOrder).toBeLessThan(correctorOrder);

      convertSpy.mockRestore();
    });
  });
});
