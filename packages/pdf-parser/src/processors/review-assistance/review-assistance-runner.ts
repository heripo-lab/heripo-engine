import type { LoggerMethods } from '@heripo/logger';
import type {
  DoclingDocument,
  ReviewAssistanceIssue,
  ReviewAssistanceIssueCategory,
  ReviewAssistancePageResult,
  ReviewAssistanceProgressEvent,
  ReviewAssistanceReport,
  TokenUsageReport,
} from '@heripo/model';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { NormalizedReviewAssistanceOptions } from '../../core/review-assistance-options';
import type { PageReviewContext } from './page-review-context-builder';

import { ConcurrentPool, LLMCaller } from '@heripo/shared';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildReviewAssistancePrompt } from '../../prompts/review-assistance-prompt';
import {
  type ReviewAssistancePageOutput,
  reviewAssistancePageSchema,
} from '../../types/review-assistance-schema';
import { PdfTextExtractor } from '../pdf-text-extractor';
import { PageReviewContextBuilder } from './page-review-context-builder';
import { ReviewAssistanceValidator } from './review-assistance-validator';

export interface ReviewAssistanceRunnerOptions extends NormalizedReviewAssistanceOptions {
  pdfPath?: string;
  abortSignal?: AbortSignal;
  aggregator?: LLMTokenUsageAggregator;
  onTokenUsage?: (report: TokenUsageReport) => void;
  onProgress?: (event: ReviewAssistanceProgressEvent) => void;
  pageTexts?: Map<number, string>;
}

export class ReviewAssistanceRunner {
  constructor(private readonly logger: LoggerMethods) {}

  async analyzeAndSave(
    outputDir: string,
    reportId: string,
    model: LanguageModel,
    options: ReviewAssistanceRunnerOptions,
  ): Promise<ReviewAssistanceReport> {
    this.emitProgress(options, {
      substage: 'review-assistance:prepare',
      status: 'started',
      reportId,
      message: 'Preparing page review contexts',
    });

    const resultPath = join(outputDir, 'result.json');
    const doc: DoclingDocument = JSON.parse(readFileSync(resultPath, 'utf-8'));
    copyFileSync(resultPath, join(outputDir, 'result_review_origin.json'));
    const pageTexts =
      options.pageTexts ??
      (await this.extractPageTexts(
        options.pdfPath,
        Object.keys(doc.pages).length,
      ));

    const contextBuilder = new PageReviewContextBuilder();
    const contexts = contextBuilder.build(doc, outputDir, { pageTexts });

    this.emitProgress(options, {
      substage: 'review-assistance:prepare',
      status: 'completed',
      reportId,
      pageCount: contexts.length,
    });

    this.logger.info(
      `[ReviewAssistanceRunner] Processing ${contexts.length} pages (concurrency: ${options.concurrency})...`,
    );

    let completedPages = 0;
    let failedPages = 0;
    const pageResults = await ConcurrentPool.run(
      contexts,
      options.concurrency,
      (context) => this.reviewPage(context, reportId, model, options),
      (result) => {
        completedPages += 1;
        if (result.status === 'failed') {
          failedPages += 1;
        }
        this.emitProgress(options, {
          substage: 'review-assistance:page',
          status: 'progress',
          reportId,
          pageNo: result.pageNo,
          pageCount: contexts.length,
          completedPages,
          failedPages,
          commandCount: result.decisions.length,
          autoAppliedCount: result.decisions.filter(
            (decision) => decision.disposition === 'auto_applied',
          ).length,
          proposalCount: result.decisions.filter(
            (decision) => decision.disposition === 'proposal',
          ).length,
        });

        if (options.onTokenUsage && options.aggregator) {
          options.onTokenUsage(
            options.aggregator.getReport() as TokenUsageReport,
          );
        }
      },
    );

    const report = this.buildReport(reportId, options, pageResults);
    this.emitProgress(options, {
      substage: 'review-assistance:write-report',
      status: 'started',
      reportId,
      pageCount: contexts.length,
    });
    writeFileSync(
      join(outputDir, 'review_assistance.json'),
      JSON.stringify(report, null, 2),
    );
    this.emitProgress(options, {
      substage: 'review-assistance:write-report',
      status: 'completed',
      reportId,
      pageCount: contexts.length,
      completedPages,
      failedPages,
      commandCount:
        report.summary.autoAppliedCount + report.summary.proposalCount,
      autoAppliedCount: report.summary.autoAppliedCount,
      proposalCount: report.summary.proposalCount,
    });

    this.logger.info(
      `[ReviewAssistanceRunner] Completed: ${report.summary.pagesSucceeded}/${report.summary.pageCount} pages succeeded, ${report.summary.proposalCount} proposals, ${report.summary.skippedCount} skipped`,
    );

    return report;
  }

  private async extractPageTexts(
    pdfPath: string | undefined,
    totalPages: number,
  ): Promise<Map<number, string> | undefined> {
    if (!pdfPath) return undefined;
    try {
      const extractor = new PdfTextExtractor(this.logger);
      return await extractor.extractText(pdfPath, totalPages);
    } catch (error) {
      this.logger.warn(
        '[ReviewAssistanceRunner] pdftotext extraction failed, proceeding without text reference',
        error,
      );
      return undefined;
    }
  }

  private async reviewPage(
    context: PageReviewContext,
    reportId: string,
    model: LanguageModel,
    options: ReviewAssistanceRunnerOptions,
  ): Promise<ReviewAssistancePageResult> {
    this.emitProgress(options, {
      substage: 'review-assistance:page',
      status: 'started',
      reportId,
      pageNo: context.pageNo,
    });

    try {
      const image = new Uint8Array(readFileSync(context.pageImagePath));
      const prompt = buildReviewAssistancePrompt(context);
      const result = await LLMCaller.callVision({
        schema: reviewAssistancePageSchema as any,
        messages: [
          {
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: prompt },
              {
                type: 'image' as const,
                image,
                mediaType: 'image/png' as const,
              },
            ],
          },
        ],
        primaryModel: model,
        maxRetries: options.maxRetries,
        temperature: options.temperature,
        abortSignal: options.abortSignal,
        component: 'ReviewAssistance',
        phase: 'page-review',
        metadata: { pageNo: context.pageNo },
      });

      options.aggregator?.track(result.usage);

      const output = result.output as ReviewAssistancePageOutput;
      const validator = new ReviewAssistanceValidator();
      const decisions = validator.validatePageOutput(context, output, {
        autoApplyThreshold: options.autoApplyThreshold,
        proposalThreshold: options.proposalThreshold,
        allowAutoApply: false,
      });

      return {
        pageNo: context.pageNo,
        status: 'succeeded',
        decisions,
        issues: this.buildIssues(context),
      };
    } catch (error) {
      if (options.abortSignal?.aborted) {
        throw error;
      }
      this.logger.warn(
        `[ReviewAssistanceRunner] Page ${context.pageNo}: review failed`,
        error,
      );
      return {
        pageNo: context.pageNo,
        status: 'failed',
        decisions: [],
        issues: this.buildIssues(context),
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private buildReport(
    reportId: string,
    options: ReviewAssistanceRunnerOptions,
    pages: ReviewAssistancePageResult[],
  ): ReviewAssistanceReport {
    const autoAppliedCount = pages.reduce(
      (sum, page) =>
        sum +
        page.decisions.filter(
          (decision) => decision.disposition === 'auto_applied',
        ).length,
      0,
    );
    const proposalCount = pages.reduce(
      (sum, page) =>
        sum +
        page.decisions.filter((decision) => decision.disposition === 'proposal')
          .length,
      0,
    );
    const skippedCount = pages.reduce(
      (sum, page) =>
        sum +
        page.decisions.filter((decision) => decision.disposition === 'skipped')
          .length,
      0,
    );
    const issueCount = pages.reduce((sum, page) => sum + page.issues.length, 0);
    const layoutIssueCount = pages.reduce(
      (sum, page) =>
        sum +
        page.issues.filter((issue) => issue.category === 'reading_order')
          .length,
      0,
    );
    const textIntegrityIssueCount = pages.reduce(
      (sum, page) =>
        sum +
        page.issues.filter((issue) => issue.category === 'text_integrity')
          .length,
      0,
    );

    return {
      schemaName: 'HeripoReviewAssistanceReport',
      version: '1.0',
      reportId,
      source: {
        doclingResult: 'result.json',
        originSnapshot: 'result_review_origin.json',
      },
      options: {
        enabled: true,
        concurrency: options.concurrency,
        autoApplyThreshold: options.autoApplyThreshold,
        proposalThreshold: options.proposalThreshold,
        maxRetries: options.maxRetries,
        temperature: options.temperature,
        failurePolicy: 'partial_page',
      },
      summary: {
        pageCount: pages.length,
        pagesSucceeded: pages.filter((page) => page.status === 'succeeded')
          .length,
        pagesFailed: pages.filter((page) => page.status === 'failed').length,
        autoAppliedCount,
        proposalCount,
        skippedCount,
        issueCount,
        layoutIssueCount,
        textIntegrityIssueCount,
      },
      pages,
    };
  }

  private buildIssues(context: PageReviewContext): ReviewAssistanceIssue[] {
    const issues: ReviewAssistanceIssue[] = [];
    const push = (
      category: ReviewAssistanceIssueCategory,
      type: string,
      description: string,
      refs?: string[],
      bbox?: ReviewAssistanceIssue['bbox'],
      reasons?: string[],
    ): void => {
      issues.push({
        id: `issue-${context.pageNo}-${issues.length + 1}`,
        pageNo: context.pageNo,
        category,
        type,
        severity: 'warning',
        description,
        refs,
        bbox,
        reasons,
      });
    };

    for (const block of context.textBlocks) {
      for (const reason of block.suspectReasons) {
        push(
          this.issueCategoryForReason(reason),
          reason,
          `Text block has suspect reason: ${reason}`,
          [block.ref],
          block.bbox,
          [reason],
        );
      }
    }
    for (const table of context.tables) {
      for (const reason of table.suspectReasons) {
        push(
          reason === 'multi_page_table_candidate'
            ? 'multi_page_table'
            : 'table',
          reason,
          `Table has suspect reason: ${reason}`,
          [table.ref],
          table.bbox,
          [reason],
        );
      }
    }
    for (const picture of context.pictures) {
      for (const reason of picture.suspectReasons) {
        push(
          'picture',
          reason,
          `Picture has suspect reason: ${reason}`,
          [picture.ref],
          picture.bbox,
          [reason],
        );
      }
    }
    for (const warning of context.layout.bboxWarnings) {
      push(
        'bbox',
        warning.reason,
        `Bounding box warning: ${warning.reason}`,
        [warning.targetRef],
        undefined,
        [warning.reason],
      );
    }
    for (const pattern of context.domainPatterns) {
      push(
        'domain_pattern',
        pattern.pattern,
        `Domain OCR pattern detected: ${pattern.value}`,
        [pattern.targetRef],
        undefined,
        [pattern.pattern],
      );
    }
    return issues;
  }

  private issueCategoryForReason(
    reason: string,
  ): ReviewAssistanceIssueCategory {
    if (reason.includes('caption')) return 'caption';
    if (reason.includes('footnote')) return 'footnote';
    if (reason.includes('repeated')) return 'text_integrity';
    if (reason.includes('heading')) return 'role';
    return 'text';
  }

  private emitProgress(
    options: ReviewAssistanceRunnerOptions,
    event: ReviewAssistanceProgressEvent,
  ): void {
    options.onProgress?.(event);
  }
}
