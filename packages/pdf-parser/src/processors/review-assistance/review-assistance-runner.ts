import type { LoggerMethods } from '@heripo/logger';
import type {
  DoclingDocument,
  ReviewAssistanceCommand,
  ReviewAssistanceDecision,
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
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  REVIEW_ASSISTANCE_TASKS,
  type ReviewAssistanceTaskDefinition,
  buildReviewAssistancePrompt,
} from '../../prompts/review-assistance-prompt';
import {
  type ReviewAssistancePageOutput,
  reviewAssistancePageSchema,
} from '../../types/review-assistance-schema';
import { PdfTextExtractor } from '../pdf-text-extractor';
import { PageReviewContextBuilder } from './page-review-context-builder';
import { ReviewAssistancePatcher } from './review-assistance-patcher';
import { ReviewAssistanceValidator } from './review-assistance-validator';

export interface ReviewAssistanceRunnerOptions extends NormalizedReviewAssistanceOptions {
  pdfPath?: string;
  abortSignal?: AbortSignal;
  aggregator?: LLMTokenUsageAggregator;
  onTokenUsage?: (report: TokenUsageReport) => void;
  onProgress?: (event: ReviewAssistanceProgressEvent) => void;
  pageTexts?: Map<number, string>;
}

const REVIEW_ASSISTANCE_PAGE_CONCURRENCY = 1;
const REVIEW_ASSISTANCE_TASK_CONCURRENCY = REVIEW_ASSISTANCE_TASKS.length;

interface ReviewAssistanceTaskResult {
  task: ReviewAssistanceTaskDefinition;
  status: 'succeeded' | 'empty' | 'failed';
  decisions: ReviewAssistanceDecision[];
  issue?: ReviewAssistanceIssue;
  errorMessage?: string;
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
    const ocrOriginPath = join(outputDir, 'result_ocr_origin.json');
    const reviewOriginPath = join(outputDir, 'result_review_origin.json');
    if (!existsSync(reviewOriginPath)) {
      copyFileSync(resultPath, reviewOriginPath);
    }
    if (!existsSync(ocrOriginPath)) {
      copyFileSync(reviewOriginPath, ocrOriginPath);
    }
    const doc: DoclingDocument = JSON.parse(
      readFileSync(reviewOriginPath, 'utf-8'),
    );
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
      `[ReviewAssistanceRunner] Processing ${contexts.length} pages (page concurrency: ${REVIEW_ASSISTANCE_PAGE_CONCURRENCY}, task concurrency: ${REVIEW_ASSISTANCE_TASK_CONCURRENCY})...`,
    );

    let completedPages = 0;
    let failedPages = 0;
    const pageResults = await ConcurrentPool.run(
      contexts,
      REVIEW_ASSISTANCE_PAGE_CONCURRENCY,
      (context) =>
        this.reviewPage(context, reportId, model, options, contexts.length),
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

    this.emitProgress(options, {
      substage: 'review-assistance:patch',
      status: 'started',
      reportId,
      pageCount: contexts.length,
    });
    const patcher = new ReviewAssistancePatcher(this.logger);
    const patched = await patcher.apply(doc, pageResults, {
      outputDir,
      contexts,
    });
    writeFileSync(resultPath, JSON.stringify(patched.doc, null, 2));
    this.emitProgress(options, {
      substage: 'review-assistance:patch',
      status: 'completed',
      reportId,
      pageCount: contexts.length,
      autoAppliedCount: patched.pages.reduce(
        (sum, page) =>
          sum +
          page.decisions.filter(
            (decision) => decision.disposition === 'auto_applied',
          ).length,
        0,
      ),
      proposalCount: patched.pages.reduce(
        (sum, page) =>
          sum +
          page.decisions.filter(
            (decision) => decision.disposition === 'proposal',
          ).length,
        0,
      ),
    });

    const report = this.buildReport(reportId, options, patched.pages);
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
    pageCount: number,
  ): Promise<ReviewAssistancePageResult> {
    this.emitProgress(options, {
      substage: 'review-assistance:page',
      status: 'started',
      reportId,
      pageNo: context.pageNo,
      pageCount,
    });

    try {
      this.logger.info(
        `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: review started`,
      );

      const image = new Uint8Array(await readFile(context.pageImagePath));
      const taskResults = await Promise.all(
        REVIEW_ASSISTANCE_TASKS.map((task) =>
          this.reviewPageTask(context, task, image, pageCount, model, options),
        ),
      );
      const succeededTaskCount = taskResults.filter(
        (result) => result.status !== 'failed',
      ).length;
      const failedTaskResults = taskResults.filter(
        (result) => result.status === 'failed',
      );

      if (succeededTaskCount === 0) {
        this.logger.warn(
          `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: all review tasks failed`,
          {
            err: {
              type: 'ReviewAssistanceTaskFailure',
              message: failedTaskResults
                .map(
                  (result) =>
                    `${result.task.id}: ${result.errorMessage ?? 'failed'}`,
                )
                .join('; '),
            },
          },
        );
        return {
          pageNo: context.pageNo,
          status: 'failed',
          decisions: [],
          issues: [
            ...this.buildIssues(context),
            ...taskResults.flatMap((result) =>
              result.issue ? [result.issue] : [],
            ),
          ],
          error: {
            message: failedTaskResults
              .map(
                (result) =>
                  `${result.task.id}: ${result.errorMessage ?? 'failed'}`,
              )
              .join('; '),
          },
        };
      }

      const decisions = this.mergeTaskDecisions(
        taskResults.flatMap((result) => result.decisions),
      );

      this.logger.info(
        `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: review completed (${decisions.length} decisions from ${succeededTaskCount}/${REVIEW_ASSISTANCE_TASKS.length} tasks)`,
      );

      return {
        pageNo: context.pageNo,
        status: 'succeeded',
        decisions,
        issues: [
          ...this.buildIssues(context),
          ...taskResults.flatMap((result) =>
            result.issue ? [result.issue] : [],
          ),
        ],
      };
    } catch (error) {
      if (options.abortSignal?.aborted) {
        throw error;
      }

      if (this.isNoOutputGeneratedError(error)) {
        this.logger.warn(
          `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: review produced no structured output; recording no-op result`,
          this.errorLogBinding(error),
        );
        return {
          pageNo: context.pageNo,
          status: 'succeeded',
          decisions: [],
          issues: [
            ...this.buildIssues(context),
            this.buildNoOutputIssue(context),
          ],
        };
      }

      this.logger.warn(
        `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: review failed`,
        this.errorLogBinding(error),
      );
      return {
        pageNo: context.pageNo,
        status: 'failed',
        decisions: [],
        issues: this.buildIssues(context),
        error: {
          message: this.safeErrorMessage(error),
        },
      };
    }
  }

  private async reviewPageTask(
    context: PageReviewContext,
    task: ReviewAssistanceTaskDefinition,
    image: Uint8Array,
    pageCount: number,
    model: LanguageModel,
    options: ReviewAssistanceRunnerOptions,
  ): Promise<ReviewAssistanceTaskResult> {
    try {
      this.logger.info(
        `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: ${task.id} task started`,
      );

      const prompt = buildReviewAssistancePrompt(context, task);
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
        metadata: { pageNo: context.pageNo, pageCount, task: task.id },
      });

      options.aggregator?.track(result.usage);

      const output = result.output as ReviewAssistancePageOutput;
      const validator = new ReviewAssistanceValidator();
      const decisions = validator
        .validatePageOutput(context, output, {
          autoApplyThreshold: options.autoApplyThreshold,
          proposalThreshold: options.proposalThreshold,
          allowAutoApply: true,
        })
        .map((decision) => this.withTaskMetadata(decision, task))
        .map((decision) => this.enforceTaskAllowedOps(decision, task));

      this.logger.info(
        `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: ${task.id} task completed (${decisions.length} decisions)`,
      );

      return {
        task,
        status: 'succeeded',
        decisions,
      };
    } catch (error) {
      if (options.abortSignal?.aborted) {
        throw error;
      }

      if (this.isNoOutputGeneratedError(error)) {
        this.logger.warn(
          `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: ${task.id} task produced no structured output; recording no-op result`,
          this.errorLogBinding(error),
        );
        return {
          task,
          status: 'empty',
          decisions: [],
          issue: this.buildNoOutputIssue(context, task),
        };
      }

      this.logger.warn(
        `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: ${task.id} task failed`,
        this.errorLogBinding(error),
      );
      return {
        task,
        status: 'failed',
        decisions: [],
        issue: this.buildTaskFailureIssue(context, task, error),
        errorMessage: this.safeErrorMessage(error),
      };
    }
  }

  private isNoOutputGeneratedError(error: unknown): boolean {
    const message = this.safeErrorMessage(error);
    const name =
      typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name?: unknown }).name ?? '')
        : '';
    return (
      /No output generated/i.test(message) || /NoOutputGenerated/i.test(name)
    );
  }

  private safeErrorMessage(error: unknown): string {
    return this.sanitizeLogText(
      error instanceof Error ? error.message : String(error),
    );
  }

  private errorLogBinding(error: unknown): {
    err: { type: string; message: string; stack?: string };
  } {
    const type =
      error instanceof Error
        ? error.name || error.constructor.name
        : typeof error;
    return {
      err: {
        type,
        message: this.safeErrorMessage(error),
        stack:
          error instanceof Error && error.stack
            ? error.stack
                .split('\n')
                .slice(0, 8)
                .map((line) => this.sanitizeLogText(line))
                .join('\n')
            : undefined,
      },
    };
  }

  private sanitizeLogText(value: string): string {
    return value.replace(/[A-Za-z0-9+/]{240,}={0,2}/g, '[redacted-large-data]');
  }

  private buildNoOutputIssue(
    context: PageReviewContext,
    task?: ReviewAssistanceTaskDefinition,
  ): ReviewAssistanceIssue {
    return {
      id: `review-execution-${context.pageNo}${task ? `-${task.id}` : ''}-empty-output`,
      pageNo: context.pageNo,
      category: 'review_execution',
      type: 'empty_model_output',
      severity: 'warning',
      description:
        task === undefined
          ? 'AI가 빈 구조화 응답을 반환해 자동 제안이 없습니다. 페이지를 직접 확인하세요.'
          : `AI가 ${task.label} 작업에서 빈 구조화 응답을 반환했습니다. 해당 영역을 직접 확인하세요.`,
      reasons: [
        'no_output_generated',
        ...(task ? [`review_task:${task.id}`] : []),
      ],
    };
  }

  private buildTaskFailureIssue(
    context: PageReviewContext,
    task: ReviewAssistanceTaskDefinition,
    error: unknown,
  ): ReviewAssistanceIssue {
    return {
      id: `review-execution-${context.pageNo}-${task.id}-failed`,
      pageNo: context.pageNo,
      category: 'review_execution',
      type: 'task_model_error',
      severity: 'warning',
      description: `${task.label} 작업이 실패했습니다. 해당 영역을 직접 확인하세요.`,
      reasons: [`review_task:${task.id}`, this.safeErrorMessage(error)],
    };
  }

  private withTaskMetadata(
    decision: ReviewAssistanceDecision,
    task: ReviewAssistanceTaskDefinition,
  ): ReviewAssistanceDecision {
    return {
      ...decision,
      reasons: [`review_task:${task.id}`, ...decision.reasons],
      metadata: {
        ...decision.metadata,
        reviewTask: task.id,
        reviewTaskLabel: task.label,
      },
    };
  }

  private enforceTaskAllowedOps(
    decision: ReviewAssistanceDecision,
    task: ReviewAssistanceTaskDefinition,
  ): ReviewAssistanceDecision {
    const op = decision.command?.op ?? decision.invalidOp;
    if (!op || task.allowedOps.includes(op as never)) {
      return decision;
    }
    return {
      ...decision,
      disposition: 'skipped',
      reasons: [...decision.reasons, `task_op_not_allowed:${task.id}:${op}`],
      metadata: {
        ...decision.metadata,
        taskOpNotAllowed: {
          task: task.id,
          op,
          allowedOps: [...task.allowedOps],
        },
      },
    };
  }

  private mergeTaskDecisions(
    decisions: ReviewAssistanceDecision[],
  ): ReviewAssistanceDecision[] {
    const merged: ReviewAssistanceDecision[] = [];
    const signatureToIndex = new Map<string, number>();
    const refToIndex = new Map<string, number>();

    for (const decision of decisions) {
      if (!decision.command) {
        merged.push(decision);
        continue;
      }

      const signature = this.commandSignature(decision.command);
      const duplicateIndex = signatureToIndex.get(signature);
      if (duplicateIndex !== undefined) {
        merged[duplicateIndex] = this.mergeDuplicateDecision(
          merged[duplicateIndex],
          decision,
        );
        continue;
      }

      const touchedRefs = this.getTouchedRefs(decision.command);
      const conflictIndexes = [
        ...new Set(
          touchedRefs
            .map((ref) => refToIndex.get(ref))
            .filter((index): index is number => index !== undefined),
        ),
      ];
      let nextDecision = decision;
      if (conflictIndexes.length > 0) {
        const conflictIds = conflictIndexes.map((index) => merged[index].id);
        nextDecision = this.markTaskConflict(nextDecision, conflictIds);
        for (const index of conflictIndexes) {
          merged[index] = this.markTaskConflict(merged[index], [
            nextDecision.id,
          ]);
        }
      }

      const nextIndex = merged.length;
      merged.push(nextDecision);
      signatureToIndex.set(signature, nextIndex);
      for (const ref of touchedRefs) {
        if (!refToIndex.has(ref)) {
          refToIndex.set(ref, nextIndex);
        }
      }
    }

    return merged;
  }

  private mergeDuplicateDecision(
    existing: ReviewAssistanceDecision,
    duplicate: ReviewAssistanceDecision,
  ): ReviewAssistanceDecision {
    const keeper =
      duplicate.confidence > existing.confidence ? duplicate : existing;
    const other = keeper === existing ? duplicate : existing;
    const taskIds = [
      ...new Set(
        [keeper.metadata?.reviewTask, other.metadata?.reviewTask].filter(
          (value): value is string => typeof value === 'string',
        ),
      ),
    ];
    return {
      ...keeper,
      confidence: Math.max(existing.confidence, duplicate.confidence),
      reasons: [
        ...new Set([
          ...keeper.reasons,
          ...other.reasons,
          `duplicate_review_task:${other.metadata?.reviewTask ?? 'unknown'}`,
        ]),
      ],
      metadata: {
        ...keeper.metadata,
        duplicateReviewTasks: taskIds,
      },
    };
  }

  private markTaskConflict(
    decision: ReviewAssistanceDecision,
    conflictIds: string[],
  ): ReviewAssistanceDecision {
    return {
      ...decision,
      disposition:
        decision.disposition === 'auto_applied'
          ? 'proposal'
          : decision.disposition,
      reasons: [
        ...new Set([
          ...decision.reasons,
          'task_conflict_same_target_ref',
          ...conflictIds.map((id) => `conflicts_with_decision:${id}`),
        ]),
      ],
      metadata: {
        ...decision.metadata,
        taskConflict: {
          sameTargetRef: true,
          conflictDecisionIds: [
            ...new Set([
              ...((
                decision.metadata?.taskConflict as
                  | { conflictDecisionIds?: string[] }
                  | undefined
              )?.conflictDecisionIds ?? []),
              ...conflictIds,
            ]),
          ],
        },
      },
    };
  }

  private commandSignature(command: ReviewAssistanceCommand): string {
    return this.stableStringify(command);
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.stableStringify(entry)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      return `{${Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(
          ([key, entry]) =>
            `${JSON.stringify(key)}:${this.stableStringify(entry)}`,
        )
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private getTouchedRefs(command: ReviewAssistanceCommand): string[] {
    switch (command.op) {
      case 'replaceText':
      case 'updateTextRole':
      case 'removeText':
      case 'splitText':
        return [command.textRef];
      case 'mergeTexts':
        return [...new Set([command.keepRef, ...command.textRefs])];
      case 'updateTableCell':
      case 'replaceTable':
        return [command.tableRef];
      case 'linkContinuedTable':
        return [command.sourceTableRef];
      case 'updatePictureCaption':
      case 'splitPicture':
      case 'hidePicture':
        return [command.pictureRef];
      case 'updateBbox':
        return [command.targetRef];
      case 'linkFootnote':
        return [command.markerTextRef, command.footnoteTextRef];
      case 'moveNode':
        return [command.sourceRef];
      case 'addText':
      case 'addPicture':
        return [];
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
        ocrOriginSnapshot: 'result_ocr_origin.json',
        originSnapshot: 'result_review_origin.json',
      },
      options: {
        enabled: true,
        concurrency: REVIEW_ASSISTANCE_PAGE_CONCURRENCY,
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
          this.issueDescriptionForReason(reason, block.text),
          [block.ref],
          block.bbox,
          [reason],
        );
      }
    }
    for (const candidate of context.missingTextCandidates) {
      push(
        'text_integrity',
        candidate.reason,
        `Text layer block is missing from Docling text: ${candidate.text}`,
        undefined,
        undefined,
        [candidate.reason],
      );
    }
    for (const table of context.tables) {
      for (const reason of table.suspectReasons) {
        push(
          reason === 'multi_page_table_candidate'
            ? 'multi_page_table'
            : 'table',
          reason,
          this.issueDescriptionForReason(reason, table.caption ?? table.ref),
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
          this.issueDescriptionForReason(
            reason,
            picture.caption ?? picture.ref,
          ),
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
        this.issueDescriptionForReason(pattern.pattern, pattern.value),
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
    if (reason.includes('picture_internal')) return 'picture';
    if (reason.includes('hanja')) return 'domain_pattern';
    if (reason.includes('heading')) return 'role';
    return 'text';
  }

  private issueDescriptionForReason(reason: string, value?: string): string {
    const preview = value?.trim() ? `: ${value.trim().slice(0, 120)}` : '';
    switch (reason) {
      case 'empty_text':
        return `본문이 비어있거나 너무 짧습니다${preview}`;
      case 'ocr_noise':
        return `한 글자 단위 공백 패턴이라 OCR 노이즈가 의심됩니다${preview}`;
      case 'hanja_ocr_candidate':
        return `한자 OCR 오류 후보입니다. 이미지 원문을 직접 확인해야 합니다${preview}`;
      case 'heading_too_long':
        return `헤딩이 비정상적으로 깁니다${preview}`;
      case 'repeated_across_pages':
        return `여러 페이지에 반복되는 header/footer 후보입니다${preview}`;
      case 'caption_like_body_text':
        return `본문으로 남은 캡션 후보입니다${preview}`;
      case 'picture_internal_text':
        return `이미지 내부 텍스트 후보입니다. 본문 텍스트가 아니라 이미지 일부로 취급해야 합니다${preview}`;
      case 'footnote_like_body_text':
        return `본문으로 남은 각주 후보입니다${preview}`;
      case 'orphan_caption':
        return `인접한 이미지/표 없이 캡션이 단독으로 남아 있습니다${preview}`;
      case 'table_missing_caption':
        return `캡션이 없는 표입니다${preview}`;
      case 'table_many_empty_cells':
        return `빈 셀이 절반 이상인 표입니다${preview}`;
      case 'multi_page_table_candidate':
        return `앞뒤 페이지 표와 이어질 가능성이 있습니다${preview}`;
      case 'image_missing_caption':
        return `캡션이 없는 이미지입니다${preview}`;
      case 'large_picture_split_candidate':
        return `큰 이미지 bbox라 복합 이미지 분할 후보입니다${preview}`;
      case 'hanja_term':
        return `한자 용어가 포함되어 이미지 대조가 필요합니다${preview}`;
      case 'institution_name':
        return `기관명 OCR 확인이 필요한 패턴입니다${preview}`;
      case 'roman_numeral':
      case 'layer_code':
      case 'unit':
      case 'feature_number':
        return `도메인 OCR 패턴 확인이 필요합니다${preview}`;
      default:
        return `${reason}${preview}`;
    }
  }

  private emitProgress(
    options: ReviewAssistanceRunnerOptions,
    event: ReviewAssistanceProgressEvent,
  ): void {
    options.onProgress?.(event);
  }
}
