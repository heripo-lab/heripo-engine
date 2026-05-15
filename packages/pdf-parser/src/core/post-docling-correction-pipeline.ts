import type { LoggerMethods } from '@heripo/logger';

import type { ReviewAssistanceTaskDefinition } from '../prompts/review-assistance-prompt';
import type {
  ConversionCompleteCallback,
  PDFConvertOptions,
} from './pdf-converter';

import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

import { PdfTextExtractor } from '../processors/pdf-text-extractor';
import { PostDoclingPageProcessor } from '../processors/post-docling-page-processor';
import {
  type ReviewAssistanceModelResolver,
  ReviewAssistanceRunner,
} from '../processors/review-assistance/review-assistance-runner';
import { runJqFileJson } from '../utils/jq';
import {
  type NormalizedPDFCorrectionOptions,
  normalizePDFCorrectionOptions,
} from './correction-options';

export class PostDoclingCorrectionPipeline {
  constructor(private readonly logger: LoggerMethods) {}

  wrapCallback(
    pdfPath: string | undefined,
    reportId: string,
    options: PDFConvertOptions,
    originalCallback: ConversionCompleteCallback,
    abortSignal?: AbortSignal,
  ): ConversionCompleteCallback {
    const correction = normalizePDFCorrectionOptions(options.correction);

    return async (outputDir: string) => {
      const pageTexts = await this.extractPageTexts(pdfPath, outputDir);
      const resultPath = join(outputDir, 'result.json');
      const ocrOriginPath = join(outputDir, 'result_ocr_origin.json');
      copyFileSync(resultPath, ocrOriginPath);

      const pageProcessor = new PostDoclingPageProcessor(this.logger);
      await pageProcessor.correctAndSave(
        outputDir,
        correction.models.textCorrection,
        {
          concurrency: correction.concurrency.pages,
          maxRetries: correction.maxRetries.textCorrection,
          temperature: correction.temperature,
          aggregator: options.aggregator,
          abortSignal,
          onTokenUsage: options.onTokenUsage,
          documentLanguages: options.ocr_lang,
          pageTexts,
          reviewAssistanceGate: {
            model: correction.models.pageGate,
            maxRetries: correction.maxRetries.pageGate,
            temperature: correction.temperature,
            outputLanguage: correction.outputLanguage,
          },
        },
      );

      const runner = new ReviewAssistanceRunner(this.logger);
      await runner.analyzeAndSave(
        outputDir,
        reportId,
        this.buildReviewAssistanceModelResolver(correction),
        {
          pdfPath,
          pageTexts,
          pageGateModel: correction.models.pageGate,
          pageGateMaxRetries: correction.maxRetries.pageGate,
          pageGateTemperature: correction.temperature,
          pageConcurrency: correction.concurrency.pages,
          taskConcurrency: correction.concurrency.reviewTasks,
          localModelConcurrency: correction.localModelConcurrency,
          workItemTimeoutMs: correction.workItemTimeoutMs,
          autoApplyThreshold: correction.autoApplyThreshold,
          proposalThreshold: correction.proposalThreshold,
          maxRetries: correction.maxRetries.reviewAssistance,
          tableMaxRetries: correction.maxRetries.tableCorrection,
          temperature: correction.temperature,
          outputLanguage: correction.outputLanguage,
          aggregator: options.aggregator,
          abortSignal,
          onTokenUsage: options.onTokenUsage,
          onProgress: options.onReviewAssistanceProgress,
        },
      );

      await originalCallback(outputDir);
    };
  }

  private buildReviewAssistanceModelResolver(
    correction: NormalizedPDFCorrectionOptions,
  ): ReviewAssistanceModelResolver {
    return (task: ReviewAssistanceTaskDefinition) => {
      if (task.id === 'tables') {
        return (
          correction.models.tableCorrection ??
          correction.models.reviewAssistanceTasks?.tables ??
          correction.models.reviewAssistance
        );
      }

      return (
        correction.models.reviewAssistanceTasks?.[task.id] ??
        correction.models.reviewAssistance
      );
    };
  }

  private async extractPageTexts(
    pdfPath: string | undefined,
    outputDir: string,
  ): Promise<Map<number, string> | undefined> {
    if (!pdfPath) return undefined;

    let totalPages: number;
    try {
      const resultPath = join(outputDir, 'result.json');
      totalPages = await runJqFileJson<number>('.pages | length', resultPath);
    } catch (error) {
      this.logger.warn(
        '[PostDoclingCorrectionPipeline] Failed to read page count from result.json, skipping text reference extraction',
        error,
      );
      return undefined;
    }

    return PdfTextExtractor.tryExtract(this.logger, pdfPath, totalPages);
  }
}
