import type { LoggerMethods } from '@heripo/logger';

import { LLMTokenUsageAggregator } from '@heripo/shared';
import { existsSync, rmSync } from 'node:fs';
import { type Mock, beforeEach, describe, expect, test, vi } from 'vitest';

import { PageRenderer } from '../processors/page-renderer';
import { OcrStrategySampler } from '../samplers/ocr-strategy-sampler';
import { StrategyResolver } from './strategy-resolver';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  rmSync: vi.fn(),
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

const mockModel = { modelId: 'test-model' } as any;

describe('StrategyResolver', () => {
  let logger: LoggerMethods;
  let resolver: StrategyResolver;
  let mockSamplerInstance: { sample: Mock };

  beforeEach(() => {
    vi.clearAllMocks();

    logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    resolver = new StrategyResolver(logger);

    vi.spyOn(process, 'cwd').mockReturnValue('/test/cwd');

    // Default: existsSync returns false (no cleanup needed)
    vi.mocked(existsSync).mockReturnValue(false);

    // Mock OcrStrategySampler constructor
    mockSamplerInstance = {
      sample: vi.fn().mockResolvedValue({
        method: 'ocrmac',
        reason: 'No Korean language detected',
        sampledPages: 3,
        totalPages: 10,
      }),
    };
    vi.mocked(OcrStrategySampler).mockImplementation(function () {
      return mockSamplerInstance as any;
    });
  });

  describe('skip sampling paths', () => {
    test('uses forced method when forcedMethod is specified without sampler model', async () => {
      const result = await resolver.resolve('/tmp/test.pdf', 'report-1', {
        forcedMethod: 'vlm',
      });

      expect(result.method).toBe('vlm');
      expect(result.reason).toBe('Forced: vlm');
      expect(result.sampledPages).toBe(0);
      expect(result.totalPages).toBe(0);
      expect(mockSamplerInstance.sample).not.toHaveBeenCalled();
    });

    test('uses forced ocrmac method', async () => {
      const result = await resolver.resolve('/tmp/test.pdf', 'report-1', {
        forcedMethod: 'ocrmac',
      });

      expect(result.method).toBe('ocrmac');
      expect(result.reason).toBe('Forced: ocrmac');
      expect(mockSamplerInstance.sample).not.toHaveBeenCalled();
    });

    test('defaults to ocrmac when skipSampling is true', async () => {
      const result = await resolver.resolve('/tmp/test.pdf', 'report-1', {
        skipSampling: true,
        strategySamplerModel: mockModel,
      });

      expect(result.method).toBe('ocrmac');
      expect(result.reason).toBe('Sampling skipped');
      expect(mockSamplerInstance.sample).not.toHaveBeenCalled();
    });

    test('defaults to ocrmac when no strategySamplerModel', async () => {
      const result = await resolver.resolve('/tmp/test.pdf', 'report-1', {});

      expect(result.method).toBe('ocrmac');
      expect(result.reason).toBe('Sampling skipped');
    });

    test('defaults to ocrmac for non-local URL (null pdfPath)', async () => {
      const result = await resolver.resolve(null, 'report-1', {
        strategySamplerModel: mockModel,
      });

      expect(result.method).toBe('ocrmac');
      expect(result.reason).toBe('Non-local URL, sampling skipped');
      expect(mockSamplerInstance.sample).not.toHaveBeenCalled();
    });

    test('uses forcedMethod for non-local URL when specified', async () => {
      const result = await resolver.resolve(null, 'report-1', {
        forcedMethod: 'vlm',
      });

      expect(result.method).toBe('vlm');
      expect(result.reason).toBe('Forced: vlm');
    });
  });

  describe('sampling path', () => {
    test('calls OcrStrategySampler with correct arguments', async () => {
      const aggregator = new LLMTokenUsageAggregator();
      const abortController = new AbortController();

      await resolver.resolve(
        '/tmp/test.pdf',
        'report-1',
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
    });

    test('returns sampler result directly when no forcedMethod', async () => {
      mockSamplerInstance.sample.mockResolvedValue({
        method: 'vlm',
        reason: 'Korean document detected',
        sampledPages: 2,
        totalPages: 10,
        detectedLanguages: ['ko-KR'],
      });

      const result = await resolver.resolve('/tmp/test.pdf', 'report-1', {
        strategySamplerModel: mockModel,
      });

      expect(result.method).toBe('vlm');
      expect(result.reason).toBe('Korean document detected');
      expect(result.detectedLanguages).toEqual(['ko-KR']);
    });

    test('overrides method when forcedMethod is specified with sampling', async () => {
      mockSamplerInstance.sample.mockResolvedValue({
        method: 'ocrmac',
        reason: 'No Korean language detected',
        sampledPages: 3,
        totalPages: 10,
        detectedLanguages: ['ko-KR'],
      });

      const result = await resolver.resolve('/tmp/report.pdf', 'report-1', {
        strategySamplerModel: mockModel,
        forcedMethod: 'vlm',
      });

      // Sampler should be called even with forcedMethod
      expect(mockSamplerInstance.sample).toHaveBeenCalled();
      // Method should be overridden to forced value
      expect(result.method).toBe('vlm');
      // Reason should combine forced label with original sampling reason
      expect(result.reason).toBe('Forced: vlm (No Korean language detected)');
      // Detected languages from sampling should be preserved
      expect(result.detectedLanguages).toEqual(['ko-KR']);
      // Sampling metadata should be preserved
      expect(result.sampledPages).toBe(3);
      expect(result.totalPages).toBe(10);
    });
  });

  describe('sampling directory cleanup', () => {
    test('cleans up sampling directory after successful sampling', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      await resolver.resolve('/tmp/test.pdf', 'report-1', {
        strategySamplerModel: mockModel,
      });

      expect(rmSync).toHaveBeenCalledWith(
        '/test/cwd/output/report-1/_sampling',
        { recursive: true, force: true },
      );
    });

    test('cleans up sampling directory even when sampling fails', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      mockSamplerInstance.sample.mockRejectedValue(
        new Error('Sampling failed'),
      );

      await expect(
        resolver.resolve('/tmp/test.pdf', 'report-1', {
          strategySamplerModel: mockModel,
        }),
      ).rejects.toThrow('Sampling failed');

      expect(rmSync).toHaveBeenCalledWith(
        '/test/cwd/output/report-1/_sampling',
        { recursive: true, force: true },
      );
    });

    test('skips cleanup when sampling directory does not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      await resolver.resolve('/tmp/test.pdf', 'report-1', {
        strategySamplerModel: mockModel,
      });

      expect(rmSync).not.toHaveBeenCalled();
    });
  });
});
