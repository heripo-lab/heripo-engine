import type { LoggerMethods } from '@heripo/logger';
import type { DoclingDocument } from '@heripo/model';
import type { DoclingAPIClient } from 'docling-sdk';

import { LLMTokenUsageAggregator } from '@heripo/shared';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { type Mock, beforeEach, describe, expect, test, vi } from 'vitest';

import { PageRenderer } from '../processors/page-renderer';
import { OcrStrategySampler } from '../samplers/ocr-strategy-sampler';
import { PDFConverter } from './pdf-converter';
import { VlmPdfProcessor } from './vlm-pdf-processor';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  rmSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  createWriteStream: vi.fn(),
}));

vi.mock('node:path', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
  basename: vi.fn((p: string) => p.split('/').pop() ?? ''),
}));

vi.mock('../samplers/ocr-strategy-sampler', () => ({
  OcrStrategySampler: vi.fn(),
}));

vi.mock('../processors/page-renderer', () => ({
  PageRenderer: vi.fn(),
}));

vi.mock('./vlm-pdf-processor', () => ({
  VlmPdfProcessor: {
    create: vi.fn(),
  },
}));

const mockModel = { modelId: 'test-model' } as any;
const mockFallbackModel = { modelId: 'fallback' } as any;

describe('PDFConverter.convertWithStrategy', () => {
  let logger: LoggerMethods;
  let client: DoclingAPIClient;
  let converter: PDFConverter;
  let mockOnComplete: Mock;
  let mockSamplerInstance: { sample: Mock };
  let mockProcessorInstance: { process: Mock };

  const testDoc: DoclingDocument = {
    schema_name: 'DoclingDocument',
    version: '1.0.0',
    name: 'test',
    origin: {
      mimetype: 'application/pdf',
      binary_hash: 0,
      filename: 'test.pdf',
    },
    furniture: {
      self_ref: '#/furniture',
      name: '_root_',
      label: 'unspecified',
      children: [],
      content_layer: 'furniture',
    },
    body: {
      self_ref: '#/body',
      name: '_root_',
      label: 'unspecified',
      children: [],
      content_layer: 'body',
    },
    groups: [],
    texts: [],
    pictures: [],
    tables: [],
    pages: {},
  };

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

    // Mock VlmPdfProcessor.create
    mockProcessorInstance = {
      process: vi.fn().mockResolvedValue({ document: testDoc }),
    };
    vi.mocked(VlmPdfProcessor.create).mockReturnValue(
      mockProcessorInstance as any,
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
    test('uses VlmPdfProcessor when strategy is VLM', async () => {
      mockSamplerInstance.sample.mockResolvedValue({
        method: 'vlm',
        reason: 'Korean-Hanja mix detected on page 3',
        sampledPages: 2,
        totalPages: 10,
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

      expect(VlmPdfProcessor.create).toHaveBeenCalledWith(logger);
      expect(mockProcessorInstance.process).toHaveBeenCalledWith(
        '/tmp/report.pdf',
        '/test/cwd/output/report-1',
        'report.pdf',
        mockFallbackModel,
        expect.objectContaining({
          aggregator: expect.any(LLMTokenUsageAggregator),
          abortSignal: undefined,
        }),
      );
    });

    test('passes aggregator and abortSignal to VlmPdfProcessor', async () => {
      const aggregator = new LLMTokenUsageAggregator();
      const abortController = new AbortController();

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

      expect(mockProcessorInstance.process).toHaveBeenCalledWith(
        '/tmp/test.pdf',
        '/test/cwd/output/report-1',
        'test.pdf',
        mockModel,
        expect.objectContaining({
          aggregator,
          abortSignal: abortController.signal,
        }),
      );
    });

    test('forwards onTokenUsage callback to VlmPdfProcessor', async () => {
      const onTokenUsage = vi.fn();

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

      expect(mockProcessorInstance.process).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        mockModel,
        expect.objectContaining({ onTokenUsage }),
      );
    });

    test('writes result.json to output directory', async () => {
      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
      );

      expect(mkdirSync).toHaveBeenCalledWith('/test/cwd/output/report-1', {
        recursive: true,
      });
      expect(writeFileSync).toHaveBeenCalledWith(
        '/test/cwd/output/report-1/result.json',
        JSON.stringify(testDoc, null, 2),
      );
    });

    test('calls onComplete with output directory', async () => {
      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
      );

      expect(mockOnComplete).toHaveBeenCalledWith('/test/cwd/output/report-1');
    });

    test('returns null tokenUsageReport for VLM path', async () => {
      const result = await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
      );

      expect(result.strategy.method).toBe('vlm');
      expect(result.tokenUsageReport).toBeNull();
    });

    test('cleans up output directory when cleanupAfterCallback is true', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        true,
        { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
      );

      expect(rmSync).toHaveBeenCalledWith('/test/cwd/output/report-1', {
        recursive: true,
        force: true,
      });
    });

    test('does not clean up output when cleanupAfterCallback is false', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
      );

      // rmSync should NOT be called for output dir (only sampling dir may be called)
      const rmSyncCalls = vi.mocked(rmSync).mock.calls;
      const outputDirCleanup = rmSyncCalls.find(
        (call) => call[0] === '/test/cwd/output/report-1',
      );
      expect(outputDirCleanup).toBeUndefined();
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

    test('throws AbortError when aborted before callback', async () => {
      const abortController = new AbortController();
      abortController.abort();

      await expect(
        converter.convertWithStrategy(
          'file:///tmp/test.pdf',
          'report-1',
          mockOnComplete,
          false,
          { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
          abortController.signal,
        ),
      ).rejects.toThrow('PDF conversion was aborted');

      expect(mockOnComplete).not.toHaveBeenCalled();
    });

    test('cleans up on VLM processor error', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      mockProcessorInstance.process.mockRejectedValue(
        new Error('VLM processing failed'),
      );

      await expect(
        converter.convertWithStrategy(
          'file:///tmp/test.pdf',
          'report-1',
          mockOnComplete,
          true,
          { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
        ),
      ).rejects.toThrow('VLM processing failed');

      // Should still clean up
      expect(rmSync).toHaveBeenCalledWith('/test/cwd/output/report-1', {
        recursive: true,
        force: true,
      });
    });
  });

  describe('token usage tracking', () => {
    test('creates internal aggregator and returns report when VLM tracks usage', async () => {
      // Simulate VlmPdfProcessor calling aggregator.track() during processing
      mockProcessorInstance.process.mockImplementation(
        async (
          _pdfPath: string,
          _outputDir: string,
          _filename: string,
          _model: unknown,
          opts: { aggregator?: LLMTokenUsageAggregator },
        ) => {
          opts.aggregator?.track({
            component: 'VlmPageProcessor',
            phase: 'page-analysis',
            model: 'primary',
            modelName: 'test-model',
            inputTokens: 500,
            outputTokens: 200,
            totalTokens: 700,
          });
          return { document: testDoc };
        },
      );

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
        'VlmPageProcessor',
      );
      expect(result.tokenUsageReport!.total.inputTokens).toBe(500);
      expect(result.tokenUsageReport!.total.outputTokens).toBe(200);
      expect(result.tokenUsageReport!.total.totalTokens).toBe(700);
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

      // Simulate VLM processing tracking
      mockProcessorInstance.process.mockImplementation(
        async (
          _pdfPath: string,
          _outputDir: string,
          _filename: string,
          _model: unknown,
          opts: { aggregator?: LLMTokenUsageAggregator },
        ) => {
          opts.aggregator?.track({
            component: 'VlmPageProcessor',
            phase: 'page-analysis',
            model: 'primary',
            modelName: 'vlm-model',
            inputTokens: 5000,
            outputTokens: 1500,
            totalTokens: 6500,
          });
          return { document: testDoc };
        },
      );

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

      mockProcessorInstance.process.mockImplementation(
        async (
          _pdfPath: string,
          _outputDir: string,
          _filename: string,
          _model: unknown,
          opts: { aggregator?: LLMTokenUsageAggregator },
        ) => {
          opts.aggregator?.track({
            component: 'VlmPageProcessor',
            phase: 'page-analysis',
            model: 'primary',
            modelName: 'test-model',
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
          });
          return { document: testDoc };
        },
      );

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
    });

    test('creates internal aggregator when none provided and passes to VLM processor', async () => {
      await converter.convertWithStrategy(
        'file:///tmp/test.pdf',
        'report-1',
        mockOnComplete,
        false,
        { forcedMethod: 'vlm', vlmProcessorModel: mockModel },
      );

      // VlmPdfProcessor should receive an LLMTokenUsageAggregator instance
      expect(mockProcessorInstance.process).toHaveBeenCalledWith(
        '/tmp/test.pdf',
        '/test/cwd/output/report-1',
        'test.pdf',
        mockModel,
        expect.objectContaining({
          aggregator: expect.any(LLMTokenUsageAggregator),
        }),
      );
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
    });
  });
});
