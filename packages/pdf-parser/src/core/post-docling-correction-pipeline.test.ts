import type { LoggerMethods } from '@heripo/logger';

import { LLMTokenUsageAggregator } from '@heripo/shared';
import { copyFileSync } from 'node:fs';
import { type Mock, beforeEach, describe, expect, test, vi } from 'vitest';

import { PdfTextExtractor } from '../processors/pdf-text-extractor';
import { PostDoclingPageProcessor } from '../processors/post-docling-page-processor';
import { ReviewAssistanceRunner } from '../processors/review-assistance/review-assistance-runner';
import { runJqFileJson } from '../utils/jq';
import { PostDoclingCorrectionPipeline } from './post-docling-correction-pipeline';

vi.mock('node:fs', () => ({
  copyFileSync: vi.fn(),
}));

vi.mock('node:path', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
}));

vi.mock('../utils/jq', () => ({
  runJqFileJson: vi.fn(),
}));

vi.mock('../processors/pdf-text-extractor', () => {
  const PdfTextExtractor: any = vi.fn();
  PdfTextExtractor.tryExtract = vi.fn();
  return { PdfTextExtractor };
});

vi.mock('../processors/post-docling-page-processor', () => ({
  PostDoclingPageProcessor: vi.fn(),
}));

vi.mock('../processors/review-assistance/review-assistance-runner', () => ({
  ReviewAssistanceRunner: vi.fn(),
}));

const textCorrectionModel = { modelId: 'text-correction' } as any;
const pageGateModel = { modelId: 'page-gate' } as any;
const reviewAssistanceModel = { modelId: 'review-assistance' } as any;
const tableCorrectionModel = { modelId: 'table-correction' } as any;
const taskModel = { modelId: 'task-model' } as any;

describe('PostDoclingCorrectionPipeline', () => {
  let logger: LoggerMethods;
  let pipeline: PostDoclingCorrectionPipeline;
  let mockPageProcessorInstance: { correctAndSave: Mock };
  let mockRunnerInstance: { analyzeAndSave: Mock };
  let mockTextExtractorInstance: { extractText: Mock };

  beforeEach(() => {
    vi.clearAllMocks();

    logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    pipeline = new PostDoclingCorrectionPipeline(logger);

    mockPageProcessorInstance = {
      correctAndSave: vi.fn().mockResolvedValue({
        textCorrections: 0,
        cellCorrections: 0,
        pagesProcessed: 5,
        pagesFailed: 0,
      }),
    };
    vi.mocked(PostDoclingPageProcessor).mockImplementation(function () {
      return mockPageProcessorInstance as any;
    });

    mockRunnerInstance = {
      analyzeAndSave: vi.fn().mockResolvedValue({
        schemaName: 'HeripoReviewAssistanceReport',
        version: '1.0',
        reportId: 'report-1',
        source: { doclingResult: 'result.json' },
        options: {},
        summary: {},
        pages: [],
      }),
    };
    vi.mocked(ReviewAssistanceRunner).mockImplementation(function () {
      return mockRunnerInstance as any;
    });

    mockTextExtractorInstance = {
      extractText: vi.fn().mockResolvedValue(new Map<number, string>()),
    };
    vi.mocked(PdfTextExtractor).mockImplementation(function () {
      return mockTextExtractorInstance as any;
    });
    vi.mocked((PdfTextExtractor as any).tryExtract).mockImplementation(
      async (logger: any, pdfPath: any, totalPages: any) => {
        if (!pdfPath) return undefined;
        try {
          return await mockTextExtractorInstance.extractText(
            pdfPath,
            totalPages,
          );
        } catch (error) {
          logger.warn(
            '[PdfTextExtractor] pdftotext extraction failed, proceeding without text reference',
            error,
          );
          return undefined;
        }
      },
    );

    vi.mocked(runJqFileJson).mockResolvedValue(1);
  });

  function correctionOptions(overrides: Record<string, unknown> = {}) {
    const { models, ...rest } = overrides;
    return {
      correction: {
        models: {
          textCorrection: textCorrectionModel,
          pageGate: pageGateModel,
          reviewAssistance: reviewAssistanceModel,
          ...((models as object | undefined) ?? {}),
        },
        ...rest,
      },
    } as any;
  }

  test('throws when correction models are missing', () => {
    expect(() =>
      pipeline.wrapCallback('/tmp/test.pdf', 'report-1', {} as any, vi.fn()),
    ).toThrow('PDF correction.models is required');
  });

  test('runs text correction, review assistance, then original callback', async () => {
    const originalCallback = vi.fn();

    const wrapped = pipeline.wrapCallback(
      '/tmp/test.pdf',
      'report-1',
      correctionOptions(),
      originalCallback,
    );

    await wrapped('/test/output');

    expect(PostDoclingPageProcessor).toHaveBeenCalledWith(logger);
    expect(ReviewAssistanceRunner).toHaveBeenCalledWith(logger);
    expect(mockPageProcessorInstance.correctAndSave).toHaveBeenCalledWith(
      '/test/output',
      textCorrectionModel,
      expect.objectContaining({
        reviewAssistanceGate: expect.objectContaining({
          model: pageGateModel,
        }),
      }),
    );
    expect(mockRunnerInstance.analyzeAndSave).toHaveBeenCalledWith(
      '/test/output',
      'report-1',
      expect.any(Function),
      expect.objectContaining({
        pageGateModel,
        pageConcurrency: 1,
        taskConcurrency: 6,
      }),
    );
    expect(originalCallback).toHaveBeenCalledWith('/test/output');
  });

  test('extracts PDF text references and passes them to both correction stages', async () => {
    const pageTexts = new Map([[1, 'extracted text']]);
    mockTextExtractorInstance.extractText.mockResolvedValue(pageTexts);
    vi.mocked(runJqFileJson).mockResolvedValue(2);

    const wrapped = pipeline.wrapCallback(
      '/tmp/test.pdf',
      'report-1',
      correctionOptions(),
      vi.fn(),
    );

    await wrapped('/test/output');

    expect((PdfTextExtractor as any).tryExtract).toHaveBeenCalledWith(
      logger,
      '/tmp/test.pdf',
      2,
    );
    expect(mockTextExtractorInstance.extractText).toHaveBeenCalledWith(
      '/tmp/test.pdf',
      2,
    );
    expect(mockPageProcessorInstance.correctAndSave).toHaveBeenCalledWith(
      '/test/output',
      textCorrectionModel,
      expect.objectContaining({ pageTexts }),
    );
    expect(mockRunnerInstance.analyzeAndSave).toHaveBeenCalledWith(
      '/test/output',
      'report-1',
      expect.any(Function),
      expect.objectContaining({ pageTexts }),
    );
  });

  test('skips PDF text extraction when the source PDF path is unavailable', async () => {
    const wrapped = pipeline.wrapCallback(
      undefined,
      'report-1',
      correctionOptions(),
      vi.fn(),
    );

    await wrapped('/test/output');

    expect(runJqFileJson).not.toHaveBeenCalled();
    expect((PdfTextExtractor as any).tryExtract).not.toHaveBeenCalled();
    expect(mockPageProcessorInstance.correctAndSave).toHaveBeenCalledWith(
      '/test/output',
      textCorrectionModel,
      expect.objectContaining({ pageTexts: undefined }),
    );
    expect(mockRunnerInstance.analyzeAndSave).toHaveBeenCalledWith(
      '/test/output',
      'report-1',
      expect.any(Function),
      expect.objectContaining({ pageTexts: undefined }),
    );
  });

  test('continues without page text references when extraction fails', async () => {
    mockTextExtractorInstance.extractText.mockRejectedValue(
      new Error('pdftotext not found'),
    );

    const wrapped = pipeline.wrapCallback(
      '/tmp/test.pdf',
      'report-1',
      correctionOptions(),
      vi.fn(),
    );

    await wrapped('/test/output');

    expect(logger.warn).toHaveBeenCalledWith(
      '[PdfTextExtractor] pdftotext extraction failed, proceeding without text reference',
      expect.any(Error),
    );
    expect(mockPageProcessorInstance.correctAndSave).toHaveBeenCalledWith(
      '/test/output',
      textCorrectionModel,
      expect.objectContaining({ pageTexts: undefined }),
    );
  });

  test('continues without page text references when page count read fails', async () => {
    vi.mocked(runJqFileJson).mockRejectedValue(new Error('jq missing'));

    const wrapped = pipeline.wrapCallback(
      '/tmp/test.pdf',
      'report-1',
      correctionOptions(),
      vi.fn(),
    );

    await wrapped('/test/output');

    expect(logger.warn).toHaveBeenCalledWith(
      '[PostDoclingCorrectionPipeline] Failed to read page count from result.json, skipping text reference extraction',
      expect.any(Error),
    );
    expect((PdfTextExtractor as any).tryExtract).not.toHaveBeenCalled();
    expect(mockPageProcessorInstance.correctAndSave).toHaveBeenCalledWith(
      '/test/output',
      textCorrectionModel,
      expect.objectContaining({ pageTexts: undefined }),
    );
    expect(mockRunnerInstance.analyzeAndSave).toHaveBeenCalledWith(
      '/test/output',
      'report-1',
      expect.any(Function),
      expect.objectContaining({ pageTexts: undefined }),
    );
  });

  test('copies result.json to result_ocr_origin.json before text correction', async () => {
    const wrapped = pipeline.wrapCallback(
      '/tmp/test.pdf',
      'report-1',
      correctionOptions(),
      vi.fn(),
    );

    await wrapped('/test/output');

    expect(copyFileSync).toHaveBeenCalledWith(
      '/test/output/result.json',
      '/test/output/result_ocr_origin.json',
    );

    const copyOrder = vi.mocked(copyFileSync).mock.invocationCallOrder[0];
    const pageProcessorOrder =
      mockPageProcessorInstance.correctAndSave.mock.invocationCallOrder[0];
    expect(copyOrder).toBeLessThan(pageProcessorOrder);
  });

  test('forwards stage-specific options and token tracking hooks', async () => {
    const aggregator = new LLMTokenUsageAggregator();
    const onTokenUsage = vi.fn();
    const onProgress = vi.fn();
    const abortController = new AbortController();

    const wrapped = pipeline.wrapCallback(
      '/tmp/test.pdf',
      'report-1',
      {
        ...correctionOptions({
          concurrency: { pages: 3, reviewTasks: 2, tables: 1 },
          modelConcurrency: 2,
          workItemTimeoutMs: 600_000,
          maxRetries: {
            textCorrection: 4,
            pageGate: 2,
            reviewAssistance: 5,
            tableCorrection: 6,
          },
          outputLanguage: 'ko-KR',
          temperature: 0.2,
        }),
        aggregator,
        onTokenUsage,
        onReviewAssistanceProgress: onProgress,
        ocr_lang: ['ko-KR'],
      },
      vi.fn(),
      abortController.signal,
    );

    await wrapped('/test/output');

    expect(mockPageProcessorInstance.correctAndSave).toHaveBeenCalledWith(
      '/test/output',
      textCorrectionModel,
      expect.objectContaining({
        concurrency: 3,
        maxRetries: 4,
        temperature: 0.2,
        aggregator,
        abortSignal: abortController.signal,
        onTokenUsage,
        documentLanguages: ['ko-KR'],
        reviewAssistanceGate: expect.objectContaining({
          maxRetries: 2,
          outputLanguage: 'ko-KR',
        }),
      }),
    );
    expect(mockRunnerInstance.analyzeAndSave).toHaveBeenCalledWith(
      '/test/output',
      'report-1',
      expect.any(Function),
      expect.objectContaining({
        pageConcurrency: 3,
        taskConcurrency: 2,
        modelConcurrency: 2,
        workItemTimeoutMs: 600_000,
        maxRetries: 5,
        tableMaxRetries: 6,
        outputLanguage: 'ko-KR',
        aggregator,
        abortSignal: abortController.signal,
        onTokenUsage,
        onProgress,
      }),
    );
  });

  test('resolves review assistance task models with table override first', async () => {
    const wrapped = pipeline.wrapCallback(
      '/tmp/test.pdf',
      'report-1',
      correctionOptions({
        models: {
          tableCorrection: tableCorrectionModel,
          reviewAssistanceTasks: {
            text_ocr_hanja: taskModel,
            tables: taskModel,
          },
        },
      }),
      vi.fn(),
    );

    await wrapped('/test/output');

    const modelResolver = mockRunnerInstance.analyzeAndSave.mock.calls[0][2];
    expect(modelResolver({ id: 'text_ocr_hanja' })).toBe(taskModel);
    expect(modelResolver({ id: 'tables' })).toBe(tableCorrectionModel);
    expect(modelResolver({ id: 'layout_bbox_order' })).toBe(
      reviewAssistanceModel,
    );
  });

  test('resolves tables task model before falling back to the default review model', async () => {
    const wrappedWithTaskModel = pipeline.wrapCallback(
      '/tmp/test.pdf',
      'report-1',
      correctionOptions({
        models: {
          reviewAssistanceTasks: {
            tables: taskModel,
          },
        },
      }),
      vi.fn(),
    );

    await wrappedWithTaskModel('/test/output');

    const taskModelResolver =
      mockRunnerInstance.analyzeAndSave.mock.calls[0][2];
    expect(taskModelResolver({ id: 'tables' })).toBe(taskModel);

    vi.clearAllMocks();
    mockPageProcessorInstance.correctAndSave.mockResolvedValue({
      textCorrections: 0,
      cellCorrections: 0,
      pagesProcessed: 5,
      pagesFailed: 0,
    });
    mockRunnerInstance.analyzeAndSave.mockResolvedValue({
      schemaName: 'HeripoReviewAssistanceReport',
      version: '1.0',
      reportId: 'report-1',
      source: { doclingResult: 'result.json' },
      options: {},
      summary: {},
      pages: [],
    });
    vi.mocked(runJqFileJson).mockResolvedValue(1);

    const wrappedWithDefaultModel = pipeline.wrapCallback(
      '/tmp/test.pdf',
      'report-1',
      correctionOptions(),
      vi.fn(),
    );

    await wrappedWithDefaultModel('/test/output');

    const defaultModelResolver =
      mockRunnerInstance.analyzeAndSave.mock.calls[0][2];
    expect(defaultModelResolver({ id: 'tables' })).toBe(reviewAssistanceModel);
  });
});
