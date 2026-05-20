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

import type { PageReviewContext } from './page-review-context-builder';

import { ConcurrentPool, LLMCaller } from '@heripo/shared';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  REVIEW_ASSISTANCE_TASKS,
  type ReviewAssistanceTaskDefinition,
  type ReviewAssistanceMergeCandidateForPrompt,
  buildReviewAssistanceMergePrompt,
  buildReviewAssistancePrompt,
} from '../../prompts/review-assistance-prompt';
import {
  type ReviewAssistanceMergeChoice,
  type ReviewAssistancePageOutput,
  buildReviewAssistancePageSchemaForOps,
  reviewAssistanceMergeChoiceSchema,
} from '../../types/review-assistance-schema';
import { PdfTextExtractor } from '../pdf-text-extractor';
import { PageReviewContextBuilder } from './page-review-context-builder';
import { PictureSplitCandidateDetector } from './picture-split-candidate-detector';
import {
  type ReviewAssistanceCallTrace,
  type ReviewAssistanceCallTraceValidation,
  ReviewAssistanceCheckpointStore,
} from './review-assistance-checkpoint-store';
import { ReviewAssistanceContextPacker } from './review-assistance-context-packer';
import {
  REVIEW_ASSISTANCE_PAGE_IMAGE_NOT_AVAILABLE_REASON,
  ReviewAssistancePageGate,
  createReviewAssistancePageGateFailOpenEligibility,
  isReviewAssistancePageGatePending,
  readReviewAssistancePageGateReport,
  writeReviewAssistancePageGateReport,
} from './review-assistance-page-gate';
import { ReviewAssistancePatcher } from './review-assistance-patcher';
import { ReviewAssistanceValidator } from './review-assistance-validator';
import {
  type ReviewAssistanceWorkItem,
  ReviewAssistanceWorkScheduler,
} from './review-assistance-work-scheduler';
import { TableCorrectionRunner } from './table-correction-runner';

export type ReviewAssistanceModelResolver = (
  task: ReviewAssistanceTaskDefinition,
) => LanguageModel;

export interface ReviewAssistanceRunnerOptions {
  pageGateModel: LanguageModel;
  pageGateMaxRetries: number;
  pageGateTemperature: number;
  pageConcurrency: number;
  taskConcurrency: number;
  localModelConcurrency: number;
  workItemTimeoutMs: number;
  autoApplyThreshold: number;
  proposalThreshold: number;
  /**
   * Total work-item attempts (including the initial call) for the re-ask
   * loop. The same value is also forwarded to `LLMCaller.callVision` as the
   * SDK-level transient retry budget; the two budgets are independent and
   * compose multiplicatively, so keep this conservative (default: 3).
   *
   * Always clamped to at least 1 by `getWorkItemMaxAttempts` so a first
   * attempt is guaranteed even when callers pass 0.
   */
  maxRetries: number;
  /** Same semantics as `maxRetries`, but applied to the `tables` task. */
  tableMaxRetries: number;
  temperature: number;
  outputLanguage: string;
  pdfPath?: string;
  abortSignal?: AbortSignal;
  aggregator?: LLMTokenUsageAggregator;
  onTokenUsage?: (report: TokenUsageReport) => void;
  onProgress?: (event: ReviewAssistanceProgressEvent) => void;
  pageTexts?: Map<number, string>;
}

interface ReviewAssistanceWorkItemResult {
  workItem: ReviewAssistanceWorkItem;
  status: 'succeeded' | 'empty' | 'failed';
  decisions: ReviewAssistanceDecision[];
  issue?: ReviewAssistanceIssue;
  errorMessage?: string;
  callTrace: ReviewAssistanceCallTrace;
}

/**
 * Cap on the number of candidates sent to the merge arbiter LLM. Anything
 * beyond the top-5 by confidence is dropped before the call so the prompt
 * stays compact and the model isn't asked to compare a long tail of
 * near-zero-confidence proposals.
 */
const REVIEW_ASSISTANCE_MERGE_GROUP_CAP = 5;

/**
 * Confidence delta above which we skip the LLM merge call entirely and
 * accept the highest-confidence candidate deterministically. Keeps token
 * cost down on obviously-unbalanced groups; advisor-recommended 0.3.
 */
const REVIEW_ASSISTANCE_MERGE_DETERMINISTIC_GAP = 0.3;

/**
 * Per-merge attempt budget forwarded to `LLMCaller.callVision`. Lower than
 * the work-item retries because the merge schema is tiny (one pick/drop)
 * and a transient SDK retry is enough; we want to fall back to the
 * deterministic top-1 quickly rather than burn budget on a flaky arbiter.
 */
const REVIEW_ASSISTANCE_MERGE_MAX_RETRIES = 1;

type MergeOutcomeMethod = 'llm' | 'deterministic_gap' | 'llm_fallback';

interface MergePickOutcome {
  kind: 'pick';
  winner: ReviewAssistanceDecision;
  method: MergeOutcomeMethod;
  mergeRationale: string;
  mergeConfidence: number;
}

interface MergeDropAllOutcome {
  kind: 'drop_all';
  method: 'llm';
  mergeRationale: string;
}

type MergeOutcome = MergePickOutcome | MergeDropAllOutcome;

export class ReviewAssistanceRunner {
  constructor(private readonly logger: LoggerMethods) {}

  async analyzeAndSave(
    outputDir: string,
    reportId: string,
    modelResolver: ReviewAssistanceModelResolver,
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
      (await PdfTextExtractor.tryExtract(
        this.logger,
        options.pdfPath,
        Object.keys(doc.pages).length,
      ));

    const contextBuilder = new PageReviewContextBuilder();
    let contexts = contextBuilder.build(doc, outputDir, {
      pageTexts,
      reviewAssistanceEligibilityByPage:
        this.readPageGateEligibility(outputDir),
    });
    contexts = await this.ensurePageEligibility(contexts, options, outputDir);
    contexts = await this.addPictureSplitCandidates(
      contexts,
      options.pageConcurrency,
    );
    const pagesSkippedByGate = contexts.filter(
      (context) => !context.reviewAssistanceEligibility.eligible,
    ).length;
    const pagesSkippedByUnavailableImage = contexts.filter(
      (context) =>
        context.reviewAssistanceEligibility.eligible &&
        this.hasUnavailablePageImageGateReason(context),
    ).length;
    const pagesEligibleForStructuralReview = contexts.filter(
      (context) =>
        context.reviewAssistanceEligibility.eligible &&
        !this.hasUnavailablePageImageGateReason(context),
    ).length;

    this.emitProgress(options, {
      substage: 'review-assistance:prepare',
      status: 'completed',
      reportId,
      pageCount: contexts.length,
    });

    this.logger.info(
      `[ReviewAssistanceRunner] Processing ${contexts.length} pages (page concurrency: ${options.pageConcurrency}, task concurrency: ${options.taskConcurrency})...`,
    );
    this.logger.info(
      `[ReviewAssistanceRunner] Local work item scheduler: concurrency ${options.localModelConcurrency}, timeout ${options.workItemTimeoutMs}ms`,
    );
    this.logger.info(
      `[ReviewAssistanceRunner] Gate summary: ${pagesEligibleForStructuralReview} eligible, ${pagesSkippedByGate} skipped by gate, ${pagesSkippedByUnavailableImage} skipped for unavailable page image`,
    );

    const checkpointStore = ReviewAssistanceCheckpointStore.open(
      outputDir,
      reportId,
    );
    const callTraces = [...checkpointStore.getCallTraces()];
    let completedPages = 0;
    let failedPages = 0;
    const pageResults = await ConcurrentPool.run(
      contexts,
      options.pageConcurrency,
      (context) =>
        this.reviewPage(
          context,
          reportId,
          modelResolver,
          options,
          contexts.length,
          checkpointStore,
          callTraces,
        ),
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

    const report = this.buildReport(
      reportId,
      options,
      patched.pages,
      callTraces,
    );
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

  private readPageGateEligibility(
    outputDir: string,
  ): Map<number, PageReviewContext['reviewAssistanceEligibility']> | undefined {
    try {
      return readReviewAssistancePageGateReport(outputDir);
    } catch (error) {
      this.logger.warn(
        '[ReviewAssistanceRunner] Failed to read page gate report, re-evaluating pages',
        error,
      );
      return undefined;
    }
  }

  private async ensurePageEligibility(
    contexts: PageReviewContext[],
    options: ReviewAssistanceRunnerOptions,
    outputDir: string,
  ): Promise<PageReviewContext[]> {
    const pendingCount = contexts.filter((context) =>
      isReviewAssistancePageGatePending(context.reviewAssistanceEligibility),
    ).length;
    if (pendingCount === 0) return contexts;

    this.logger.info(
      `[ReviewAssistanceRunner] Evaluating ${pendingCount} pages with VLM page gate`,
    );

    const gate = new ReviewAssistancePageGate();
    const updatedContexts = await ConcurrentPool.run(
      contexts,
      options.pageConcurrency,
      async (context) => {
        if (
          !isReviewAssistancePageGatePending(
            context.reviewAssistanceEligibility,
          )
        ) {
          return context;
        }

        try {
          let image: Uint8Array;
          try {
            image = new Uint8Array(await readFile(context.pageImagePath));
          } catch (error) {
            if (options.abortSignal?.aborted) {
              throw error;
            }
            this.logger.warn(
              `[ReviewAssistanceRunner] Page ${context.pageNo}: page image unavailable for page gate`,
              this.errorLogBinding(error),
            );
            return {
              ...context,
              reviewAssistanceEligibility:
                createReviewAssistancePageGateFailOpenEligibility(
                  context.pageNo,
                  REVIEW_ASSISTANCE_PAGE_IMAGE_NOT_AVAILABLE_REASON,
                ),
            };
          }

          const reviewAssistanceEligibility = await gate.evaluate(
            context,
            image,
            options.pageGateModel,
            {
              maxRetries: options.pageGateMaxRetries,
              temperature: options.pageGateTemperature,
              abortSignal: options.abortSignal,
              aggregator: options.aggregator,
              outputLanguage: options.outputLanguage,
            },
          );
          return { ...context, reviewAssistanceEligibility };
        } catch (error) {
          if (options.abortSignal?.aborted) {
            throw error;
          }
          const message = this.safeErrorMessage(error);
          this.logger.warn(
            `[ReviewAssistanceRunner] Page ${context.pageNo}: page gate failed open`,
            this.errorLogBinding(error),
          );
          return {
            ...context,
            reviewAssistanceEligibility:
              createReviewAssistancePageGateFailOpenEligibility(
                context.pageNo,
                message,
              ),
          };
        }
      },
      () => {
        if (options.onTokenUsage && options.aggregator) {
          options.onTokenUsage(
            options.aggregator.getReport() as TokenUsageReport,
          );
        }
      },
    );

    writeReviewAssistancePageGateReport(
      outputDir,
      updatedContexts.map((context) => context.reviewAssistanceEligibility),
    );
    return updatedContexts;
  }

  private async addPictureSplitCandidates(
    contexts: PageReviewContext[],
    concurrency: number,
  ): Promise<PageReviewContext[]> {
    const detector = new PictureSplitCandidateDetector(this.logger);
    // Bounded concurrency: detector.detect() spawns ImageMagick subprocesses.
    // Use the page-level limit so a large report does not fan out into
    // hundreds of concurrent magick processes.
    return ConcurrentPool.run(contexts, concurrency, (context) =>
      this.attachSplitCandidatesToPage(context, detector),
    );
  }

  private async attachSplitCandidatesToPage(
    context: PageReviewContext,
    detector: PictureSplitCandidateDetector,
  ): Promise<PageReviewContext> {
    if (
      !context.reviewAssistanceEligibility.eligible ||
      this.hasUnavailablePageImageGateReason(context) ||
      context.pictures.length === 0
    ) {
      return context;
    }

    const pictures: PageReviewContext['pictures'] = [];
    for (const picture of context.pictures) {
      if (!picture.bbox) {
        pictures.push(picture);
        continue;
      }
      const splitCandidate = await detector.detect({
        pageImagePath: context.pageImagePath,
        pageSize: context.pageSize,
        pictureBbox: picture.bbox,
      });
      if (!splitCandidate) {
        pictures.push(picture);
        continue;
      }
      pictures.push({
        ...picture,
        splitCandidate,
        suspectReasons: [
          ...new Set([
            ...picture.suspectReasons,
            'picture_split_boundary_candidate',
          ]),
        ],
      });
    }
    return { ...context, pictures };
  }

  private async reviewPage(
    context: PageReviewContext,
    reportId: string,
    modelResolver: ReviewAssistanceModelResolver,
    options: ReviewAssistanceRunnerOptions,
    pageCount: number,
    checkpointStore?: ReviewAssistanceCheckpointStore,
    callTraces: ReviewAssistanceCallTrace[] = [],
  ): Promise<ReviewAssistancePageResult> {
    this.emitProgress(options, {
      substage: 'review-assistance:page',
      status: 'started',
      reportId,
      pageNo: context.pageNo,
      pageCount,
    });

    try {
      if (!context.reviewAssistanceEligibility.eligible) {
        this.logger.info(
          `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: structural review skipped by gate (${context.reviewAssistanceEligibility.exclusionReasons.join(', ')})`,
        );
        const result: ReviewAssistancePageResult = {
          pageNo: context.pageNo,
          status: 'succeeded',
          decisions: [],
          issues: [this.buildSkippedByGateIssue(context)],
        };
        checkpointStore?.recordPage(result);
        return result;
      }

      if (this.hasUnavailablePageImageGateReason(context)) {
        this.logger.warn(
          `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: structural review skipped because page image is not available`,
        );
        const result: ReviewAssistancePageResult = {
          pageNo: context.pageNo,
          status: 'succeeded',
          decisions: [],
          issues: [
            ...this.buildIssues(context),
            this.buildUnavailablePageImageIssue(context),
          ],
        };
        checkpointStore?.recordPage(result);
        return result;
      }

      this.logger.info(
        `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: review started`,
      );

      const image = new Uint8Array(await readFile(context.pageImagePath));
      const scheduler = new ReviewAssistanceWorkScheduler();
      const workItems = scheduler.build(context);

      if (workItems.length === 0) {
        const result: ReviewAssistancePageResult = {
          pageNo: context.pageNo,
          status: 'succeeded',
          decisions: [],
          issues: this.buildIssues(context),
        };
        checkpointStore?.recordPage(result);
        return result;
      }

      const checkpointPage = checkpointStore?.getPartialPage(context.pageNo);
      const completedCheckpointWorkItemIds = new Set(
        workItems
          .filter((workItem) =>
            checkpointStore?.hasCompletedWorkItem(workItem.id),
          )
          .map((workItem) => workItem.id),
      );
      const failedCheckpointWorkItemIds = new Set(
        workItems
          .filter((workItem) => checkpointStore?.hasFailedWorkItem(workItem.id))
          .map((workItem) => workItem.id),
      );
      const pendingWorkItems = workItems.filter(
        (workItem) =>
          !completedCheckpointWorkItemIds.has(workItem.id) &&
          !failedCheckpointWorkItemIds.has(workItem.id),
      );

      if (pendingWorkItems.length === 0 && checkpointPage) {
        this.logger.info(
          `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: review resumed from checkpoint (${workItems.length} work items)`,
        );
        return checkpointPage;
      }

      const workItemResults: ReviewAssistanceWorkItemResult[] = [];
      await ConcurrentPool.run(
        pendingWorkItems,
        options.localModelConcurrency,
        (workItem) =>
          this.reviewWorkItem(
            context,
            workItem,
            image,
            pageCount,
            modelResolver,
            options,
          ),
        (result) => {
          workItemResults.push(result);
          this.upsertCallTrace(callTraces, result.callTrace);
          const partialPage = this.buildPageResultFromWorkItems(
            context,
            checkpointPage,
            workItemResults,
          );
          checkpointStore?.recordWorkItem({
            workItemId: result.workItem.id,
            page: partialPage,
            trace: result.callTrace,
            failed:
              result.status === 'failed'
                ? {
                    reason: result.errorMessage ?? 'failed',
                    attempts: result.callTrace.attempts,
                  }
                : undefined,
          });
        },
      );

      const succeededLiveWorkItemResults = workItemResults.filter(
        (result) => result.status !== 'failed',
      );
      const succeededWorkItemCount =
        completedCheckpointWorkItemIds.size +
        succeededLiveWorkItemResults.length;
      const failedTaskResults = workItemResults.filter(
        (result) => result.status === 'failed',
      );
      const failedWorkItemCount =
        failedCheckpointWorkItemIds.size + failedTaskResults.length;

      if (succeededWorkItemCount === 0 && failedWorkItemCount > 0) {
        this.logger.warn(
          `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: all review work items failed`,
          {
            err: {
              type: 'ReviewAssistanceTaskFailure',
              message: failedTaskResults
                .map(
                  (result) =>
                    `${result.workItem.id}: ${result.errorMessage ?? 'failed'}`,
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
            ...workItemResults.flatMap((result) =>
              result.issue ? [result.issue] : [],
            ),
          ],
          error: {
            message: failedTaskResults
              .map(
                (result) =>
                  `${result.workItem.id}: ${result.errorMessage ?? 'failed'}`,
              )
              .join('; '),
          },
        };
      }

      const pageResultBeforeMerge = this.buildPageResultFromWorkItems(
        context,
        checkpointPage,
        workItemResults,
      );

      const resolvedDecisions = await this.resolveCrossOpConflictsWithLlm(
        pageResultBeforeMerge.decisions,
        context,
        image,
        modelResolver,
        options,
      );
      const pageResult: ReviewAssistancePageResult = {
        ...pageResultBeforeMerge,
        decisions: resolvedDecisions,
      };

      this.logger.info(
        `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: review completed (${pageResult.decisions.length} decisions from ${succeededWorkItemCount}/${workItems.length} work items)`,
      );

      checkpointStore?.recordPage(pageResult);
      return pageResult;
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

  private async reviewWorkItem(
    context: PageReviewContext,
    workItem: ReviewAssistanceWorkItem,
    image: Uint8Array,
    pageCount: number,
    modelResolver: ReviewAssistanceModelResolver,
    options: ReviewAssistanceRunnerOptions,
  ): Promise<ReviewAssistanceWorkItemResult> {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const model = modelResolver(workItem.task);
    const modelId = this.getModelId(model);
    let attempts = 0;
    let validationFeedback: string[] = [];

    try {
      this.logger.info(
        `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: ${workItem.id} work item started`,
      );

      const tableCorrection =
        workItem.kind === 'table'
          ? this.createTableCorrectionWorkContext(context, workItem)
          : undefined;
      const packer = new ReviewAssistanceContextPacker();
      const packedContext =
        tableCorrection?.context.scopedPageContext ??
        packer.pack(context, workItem);
      const maxAttempts = this.getWorkItemMaxAttempts(workItem, options);

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        attempts = attempt;
        const prompt = tableCorrection
          ? tableCorrection.runner.buildPrompt(tableCorrection.context, {
              outputLanguage: options.outputLanguage,
              validationFeedback,
              attempt,
            })
          : buildReviewAssistancePrompt(packedContext, workItem.task, {
              outputLanguage: options.outputLanguage,
              validationFeedback,
              attempt,
            });
        // Both paths use the task-scoped flat schema. The table-correction
        // runner validates through the same ReviewAssistanceValidator, so the
        // flat→typed transform output is consumed identically — and the table
        // task's multi-op union was itself a source of `No object generated`
        // failures, so it benefits from flattening too.
        const pageSchema = buildReviewAssistancePageSchemaForOps(
          workItem.task.allowedOps,
        );
        const result = await this.withWorkItemTimeout(
          LLMCaller.callVision({
            schema: pageSchema as any,
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
            maxRetries: this.getTaskMaxRetries(workItem.task, options),
            temperature: options.temperature,
            abortSignal: options.abortSignal,
            component: 'ReviewAssistance',
            phase: 'work-item-review',
            metadata: {
              pageNo: context.pageNo,
              pageCount,
              task: workItem.task.id,
              workItemId: workItem.id,
              workItemKind: workItem.kind,
              targetRefs: workItem.targetRefs.join(','),
              attempt,
            },
          }),
          options.workItemTimeoutMs,
          workItem,
        );

        options.aggregator?.track(result.usage);

        const output = result.output as ReviewAssistancePageOutput;
        const decisions = tableCorrection
          ? this.decorateWorkItemDecisions(
              tableCorrection.runner.validateOutput(
                tableCorrection.context,
                output,
                {
                  autoApplyThreshold: options.autoApplyThreshold,
                  proposalThreshold: options.proposalThreshold,
                  allowAutoApply: true,
                },
              ),
              workItem,
            )
          : this.validateWorkItemOutput(
              packedContext,
              output,
              workItem,
              options,
            );
        const failureReasons = this.getValidationFailureReasons(decisions);
        if (failureReasons.length === 0) {
          const validation: ReviewAssistanceCallTraceValidation =
            attempt > 1 ? 'reasked' : 'passed';
          const callTrace = this.buildCallTrace(workItem, {
            modelId,
            attempts,
            startedAt,
            startedAtMs,
            validation,
            failureReasons: validation === 'reasked' ? validationFeedback : [],
          });

          this.logger.info(
            `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: ${workItem.id} work item completed (${decisions.length} decisions, attempts: ${attempt})`,
          );

          return {
            workItem,
            status: 'succeeded',
            decisions,
            callTrace,
          };
        }

        validationFeedback = failureReasons;
      }

      const callTrace = this.buildCallTrace(workItem, {
        modelId,
        attempts,
        startedAt,
        startedAtMs,
        validation: 'failed',
        failureReasons: validationFeedback,
      });

      this.logger.warn(
        `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: ${workItem.id} work item failed validation after ${attempts} attempts`,
        {
          err: {
            type: 'ReviewAssistanceValidationFailure',
            message: validationFeedback.join('; '),
          },
        },
      );

      return {
        workItem,
        status: 'failed',
        decisions: [],
        issue: this.buildWorkItemValidationIssue(
          context,
          workItem,
          validationFeedback,
        ),
        errorMessage: validationFeedback.join('; '),
        callTrace,
      };
    } catch (error) {
      if (options.abortSignal?.aborted) {
        throw error;
      }

      const callTrace = this.buildCallTrace(workItem, {
        modelId,
        attempts: Math.max(attempts, 1),
        startedAt,
        startedAtMs,
        validation: 'failed',
        failureReasons: [this.safeErrorMessage(error)],
      });

      if (this.isNoOutputGeneratedError(error)) {
        this.logger.warn(
          `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: ${workItem.id} work item produced no structured output; recording no-op result`,
          this.errorLogBinding(error),
        );
        return {
          workItem,
          status: 'empty',
          decisions: [],
          issue: this.buildNoOutputIssue(context, workItem.task, 'info'),
          errorMessage: this.safeErrorMessage(error),
          callTrace,
        };
      }

      this.logger.warn(
        `[ReviewAssistanceRunner] Page ${context.pageNo}/${pageCount}: ${workItem.id} work item failed`,
        this.errorLogBinding(error),
      );
      return {
        workItem,
        status: 'failed',
        decisions: [],
        issue: this.buildWorkItemFailureIssue(context, workItem, error),
        errorMessage: this.safeErrorMessage(error),
        callTrace,
      };
    }
  }

  private createTableCorrectionWorkContext(
    context: PageReviewContext,
    workItem: ReviewAssistanceWorkItem,
  ): {
    runner: TableCorrectionRunner;
    context: ReturnType<TableCorrectionRunner['buildContext']>;
  } {
    const runner = new TableCorrectionRunner();
    return {
      runner,
      context: runner.buildContext(context, workItem),
    };
  }

  private validateWorkItemOutput(
    context: PageReviewContext,
    output: ReviewAssistancePageOutput,
    workItem: ReviewAssistanceWorkItem,
    options: ReviewAssistanceRunnerOptions,
  ): ReviewAssistanceDecision[] {
    const validator = new ReviewAssistanceValidator();
    return this.decorateWorkItemDecisions(
      validator.validatePageOutput(
        context,
        this.bindSingleTargetRefs(output, workItem),
        {
          autoApplyThreshold: options.autoApplyThreshold,
          proposalThreshold: options.proposalThreshold,
          allowAutoApply: true,
        },
      ),
      workItem,
    );
  }

  /**
   * Deterministic counterpart to the prompt's "ref fields are mandatory" rule.
   * The flat LLM schema makes every ref optional, so the model often drops the
   * op's primary ref (→ `''` after the flat→typed transform), which the
   * validator then rejects as `target_ref_not_found`. When a work item targets
   * exactly one node, that ref is known, so fill an omitted primary ref with it
   * — mirroring the table-correction path, but for picture/text/bbox work
   * items. Multi-target work items are left untouched (the right ref is
   * ambiguous), as are non-empty refs (a genuine mismatch is still surfaced)
   * and the node-type must match so a picture ref never lands on a text op.
   */
  private bindSingleTargetRefs(
    output: ReviewAssistancePageOutput,
    workItem: ReviewAssistanceWorkItem,
  ): ReviewAssistancePageOutput {
    if (workItem.targetRefs.length !== 1) return output;
    const target = workItem.targetRefs[0];
    const isText = target.startsWith('#/texts/');
    const isPicture = target.startsWith('#/pictures/');
    const isTable = target.startsWith('#/tables/');
    return {
      ...output,
      commands: output.commands.map((command) => {
        switch (command.op) {
          case 'replaceText':
          case 'updateTextRole':
          case 'removeText':
          case 'splitText':
            return isText && !command.textRef
              ? { ...command, textRef: target }
              : command;
          case 'updatePictureCaption':
          case 'splitPicture':
          case 'hidePicture':
            return isPicture && !command.pictureRef
              ? { ...command, pictureRef: target }
              : command;
          case 'updateTableCell':
          case 'replaceTable':
            return isTable && !command.tableRef
              ? { ...command, tableRef: target }
              : command;
          case 'updateBbox':
            return !command.targetRef
              ? { ...command, targetRef: target }
              : command;
          default:
            return command;
        }
      }),
    };
  }

  private decorateWorkItemDecisions(
    decisions: ReviewAssistanceDecision[],
    workItem: ReviewAssistanceWorkItem,
  ): ReviewAssistanceDecision[] {
    return decisions
      .map((decision) => this.withTaskMetadata(decision, workItem.task))
      .map((decision) => this.withWorkItemMetadata(decision, workItem))
      .map((decision) => this.enforceTaskAllowedOps(decision, workItem.task));
  }

  private withWorkItemMetadata(
    decision: ReviewAssistanceDecision,
    workItem: ReviewAssistanceWorkItem,
  ): ReviewAssistanceDecision {
    return {
      ...decision,
      reasons: [
        `review_work_item:${workItem.id}`,
        `review_work_item_kind:${workItem.kind}`,
        ...decision.reasons,
      ],
      metadata: {
        ...decision.metadata,
        reviewWorkItem: {
          id: workItem.id,
          kind: workItem.kind,
          targetRefs: workItem.targetRefs,
          priority: workItem.priority,
          contextBudget: workItem.contextBudget,
        },
      },
    };
  }

  private getValidationFailureReasons(
    decisions: ReviewAssistanceDecision[],
  ): string[] {
    const failureReasons = decisions.flatMap((decision) =>
      decision.reasons.filter((reason) =>
        this.isDeterministicValidationFailureReason(reason),
      ),
    );
    return [...new Set(failureReasons)];
  }

  private isDeterministicValidationFailureReason(reason: string): boolean {
    return (
      reason.startsWith('invalid_') ||
      reason.endsWith('_not_found') ||
      reason.includes('_ref_not_found') ||
      reason.includes('page_number_mismatch') ||
      reason.includes('target_already_modified') ||
      reason.includes('not_in_text_refs') ||
      reason.includes('negative_index') ||
      reason.includes('out_of_preview_range') ||
      reason.includes('not_rectangular') ||
      reason.includes('requires_') ||
      reason.includes('without_boundary_candidate') ||
      reason.includes('outside_source') ||
      reason.includes('region_count_mismatch') ||
      reason.includes('boundary_not_supported') ||
      reason.startsWith('table_correction_') ||
      reason.startsWith('task_op_not_allowed:')
    );
  }

  private async withWorkItemTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    workItem: ReviewAssistanceWorkItem,
  ): Promise<T> {
    return this.withTimeout(
      promise,
      timeoutMs,
      `Review assistance work item timeout after ${timeoutMs}ms: ${workItem.id}`,
    );
  }

  /**
   * Generic timeout helper for non-work-item LLM calls (e.g. the merge
   * arbiter). Mirrors `withWorkItemTimeout` but takes a free-form label
   * instead of a work item so it can fail loudly with context-specific
   * messages.
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(timeoutMessage));
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildCallTrace(
    workItem: ReviewAssistanceWorkItem,
    options: {
      modelId?: string;
      attempts: number;
      startedAt: string;
      startedAtMs: number;
      validation: ReviewAssistanceCallTraceValidation;
      failureReasons?: string[];
    },
  ): ReviewAssistanceCallTrace {
    return {
      workItemId: workItem.id,
      kind: workItem.kind,
      pageNo: workItem.pageNo,
      targetRefs: workItem.targetRefs,
      modelId: options.modelId,
      attempts: options.attempts,
      startedAt: options.startedAt,
      durationMs: Math.max(0, Date.now() - options.startedAtMs),
      validation: options.validation,
      failureReasons:
        options.failureReasons && options.failureReasons.length > 0
          ? [...new Set(options.failureReasons)]
          : undefined,
    };
  }

  /**
   * Resolve the configured attempt budget for a task. The same value is used
   * for the work-item re-ask loop and the SDK-level transient retry count
   * forwarded to `LLMCaller.callVision`. See `ReviewAssistanceRunnerOptions.maxRetries`.
   */
  private getTaskMaxRetries(
    task: ReviewAssistanceTaskDefinition,
    options: ReviewAssistanceRunnerOptions,
  ): number {
    return task.id === 'tables' ? options.tableMaxRetries : options.maxRetries;
  }

  /**
   * Total attempts for the work-item re-ask loop, including the initial
   * call. Floors at 1 so a first attempt is always made even when callers
   * pass 0. The configured value is treated as the full attempt budget, not
   * as "additional retries on top of one initial call", to avoid composing
   * multiplicatively with the SDK retry budget on the same call.
   */
  private getWorkItemMaxAttempts(
    workItem: ReviewAssistanceWorkItem,
    options: ReviewAssistanceRunnerOptions,
  ): number {
    return Math.max(1, this.getTaskMaxRetries(workItem.task, options));
  }

  private getModelId(model: LanguageModel): string | undefined {
    const modelId =
      (model as { modelId?: unknown }).modelId ??
      (model as { id?: unknown }).id;
    return typeof modelId === 'string' ? modelId : undefined;
  }

  private buildPageResultFromWorkItems(
    context: PageReviewContext,
    checkpointPage: ReviewAssistancePageResult | undefined,
    workItemResults: ReviewAssistanceWorkItemResult[],
  ): ReviewAssistancePageResult {
    const decisions = this.mergeTaskDecisions([
      ...(checkpointPage?.decisions ?? []),
      ...workItemResults.flatMap((result) => result.decisions),
    ]);
    const issues = this.dedupeIssues([
      ...(checkpointPage?.issues ?? this.buildIssues(context)),
      ...workItemResults.flatMap((result) =>
        result.issue ? [result.issue] : [],
      ),
    ]);
    return {
      pageNo: context.pageNo,
      status: 'succeeded',
      decisions,
      issues,
    };
  }

  private dedupeIssues(
    issues: ReviewAssistanceIssue[],
  ): ReviewAssistanceIssue[] {
    const seen = new Set<string>();
    return issues.filter((issue) => {
      const key = issue.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private upsertCallTrace(
    callTraces: ReviewAssistanceCallTrace[],
    trace: ReviewAssistanceCallTrace,
  ): void {
    const index = callTraces.findIndex(
      (entry) => entry.workItemId === trace.workItemId,
    );
    if (index === -1) {
      callTraces.push(trace);
      return;
    }
    callTraces[index] = trace;
  }

  /**
   * Detect the AI SDK's empty-structured-output errors. `generateObject`
   * throws `AI_NoObjectGeneratedError` ("No object generated: ...") while the
   * older text path threw "No output generated"; we match both spellings so
   * the Phase-1 structured-output migration doesn't reclassify these as hard
   * work-item failures.
   */
  private isNoOutputGeneratedError(error: unknown): boolean {
    const message = this.safeErrorMessage(error);
    const name =
      typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name?: unknown }).name ?? '')
        : '';
    return (
      /No (object|output) generated/i.test(message) ||
      /No(Object|Output)Generated/i.test(name)
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

  /**
   * Build the empty-structured-output issue. Defaults to `warning` for the
   * page-level path (the whole page review produced nothing — worth a
   * required check). The work-item path passes `info`: a single task failing
   * to return parseable JSON is not actionable for a human reviewer, so the
   * web side keeps it out of the 필수확인 bucket. This is not a "nothing to
   * correct" signal — a clean no-op returns `{commands: []}` and parses
   * fine — but the reviewer can't act on a malformed response, so it is
   * surfaced as an informational note rather than a required check.
   */
  private buildNoOutputIssue(
    context: PageReviewContext,
    task?: ReviewAssistanceTaskDefinition,
    severity: ReviewAssistanceIssue['severity'] = 'warning',
  ): ReviewAssistanceIssue {
    return {
      id: `review-execution-${context.pageNo}${task ? `-${task.id}` : ''}-empty-output`,
      pageNo: context.pageNo,
      category: 'review_execution',
      type: 'empty_model_output',
      severity,
      description:
        task === undefined
          ? 'AI가 빈 구조화 응답을 반환해 자동 제안이 없습니다. 페이지를 직접 확인하세요.'
          : `AI가 ${task.label} 작업에서 구조화 응답을 생성하지 못했습니다(스키마 불일치). 자동 제안은 없으며 별도 조치는 필요하지 않습니다.`,
      reasons: [
        'no_output_generated',
        ...(task ? [`review_task:${task.id}`] : []),
      ],
    };
  }

  private buildWorkItemFailureIssue(
    context: PageReviewContext,
    workItem: ReviewAssistanceWorkItem,
    error: unknown,
  ): ReviewAssistanceIssue {
    return {
      id: `review-execution-${context.pageNo}-${workItem.id}-failed`,
      pageNo: context.pageNo,
      category: 'review_execution',
      type: 'work_item_model_error',
      severity: 'warning',
      description: `${workItem.task.label} work item failed. Review the target refs manually.`,
      refs: workItem.targetRefs,
      reasons: [
        `review_task:${workItem.task.id}`,
        `review_work_item:${workItem.id}`,
        `review_work_item_kind:${workItem.kind}`,
        this.safeErrorMessage(error),
      ],
    };
  }

  private buildWorkItemValidationIssue(
    context: PageReviewContext,
    workItem: ReviewAssistanceWorkItem,
    reasons: string[],
  ): ReviewAssistanceIssue {
    // A work item that failed deterministic validation is only worth a
    // reviewer's attention when the model produced a *valid* command we refuse
    // to auto-apply (structural edits need human judgement). Every other
    // failure — a missing/mismatched ref, dropped table metadata, a picture
    // split without a boundary candidate — means the model produced incomplete
    // or unusable output; there is nothing actionable for a human, so surface
    // it as advisory `info` to keep it out of the 필수 확인 queue.
    const requiresManualReview = reasons.some((reason) =>
      reason.includes('requires_manual_review'),
    );
    return {
      id: `review-execution-${context.pageNo}-${workItem.id}-validation-failed`,
      pageNo: context.pageNo,
      category: 'review_execution',
      type: 'work_item_validation_failed',
      severity: requiresManualReview ? 'warning' : 'info',
      description:
        'Work item output failed deterministic validation after re-asking.',
      refs: workItem.targetRefs,
      reasons: [
        `review_task:${workItem.task.id}`,
        `review_work_item:${workItem.id}`,
        `review_work_item_kind:${workItem.kind}`,
        ...reasons,
      ],
    };
  }

  private buildSkippedByGateIssue(
    context: PageReviewContext,
  ): ReviewAssistanceIssue {
    return {
      id: `review-skip-${context.pageNo}`,
      pageNo: context.pageNo,
      category: 'review_execution',
      type: 'page_skipped_by_correction_gate',
      severity: 'info',
      description:
        'Page skipped for structural review because it would add review noise without improving TOC or archaeological data extraction.',
      reasons: context.reviewAssistanceEligibility.exclusionReasons,
    };
  }

  private buildUnavailablePageImageIssue(
    context: PageReviewContext,
  ): ReviewAssistanceIssue {
    return {
      id: `review-execution-${context.pageNo}-page-image-not-available`,
      pageNo: context.pageNo,
      category: 'review_execution',
      type: 'page_image_not_available',
      severity: 'warning',
      description:
        'Structural review was skipped because the page image is not available.',
      reasons: [
        ...new Set([
          REVIEW_ASSISTANCE_PAGE_IMAGE_NOT_AVAILABLE_REASON,
          ...context.reviewAssistanceEligibility.reasons,
        ]),
      ],
    };
  }

  private hasUnavailablePageImageGateReason(
    context: PageReviewContext,
  ): boolean {
    return context.reviewAssistanceEligibility.reasons.includes(
      REVIEW_ASSISTANCE_PAGE_IMAGE_NOT_AVAILABLE_REASON,
    );
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
    const priorConflict = decision.metadata?.taskConflict as
      | { conflictDecisionIds?: string[]; autoAppliedBeforeConflict?: boolean }
      | undefined;
    // markTaskConflict can run more than once on the same decision (it is
    // applied to both sides of every conflicting pair). The disposition is
    // already 'proposal' after the first downgrade, so OR with the prior flag
    // to remember that the merge winner was auto-apply-eligible before the
    // conflict — `applyMergeWinnerMetadata` restores it once the conflict is
    // resolved.
    const autoAppliedBeforeConflict =
      decision.disposition === 'auto_applied' ||
      priorConflict?.autoAppliedBeforeConflict === true;
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
              ...(priorConflict?.conflictDecisionIds ?? []),
              ...conflictIds,
            ]),
          ],
          ...(autoAppliedBeforeConflict
            ? { autoAppliedBeforeConflict: true }
            : {}),
        },
      },
    };
  }

  /**
   * Resolve cross-op conflicts the deterministic `mergeTaskDecisions` left
   * marked with `task_conflict_same_target_ref`. For each connected group of
   * conflicting decisions we either:
   *   1) pick a single winner deterministically when the top-1 confidence
   *      beats top-2 by more than `MERGE_DETERMINISTIC_GAP`, or
   *   2) ask the page model to pick exactly one candidate by index, or to
   *      drop all of them, with the page image attached for grounding.
   * Losers are removed from the decisions array — the audit trail lives on
   * the winner under `metadata.mergeChosen`. When the model returns
   * `drop`, every candidate in the group is removed; the page-level call
   * trace still captures the merge call.
   *
   * Errors on the LLM call fall back to the top-1 deterministic pick so a
   * page never fails review because the merge phase failed.
   */
  private async resolveCrossOpConflictsWithLlm(
    decisions: ReviewAssistanceDecision[],
    context: PageReviewContext,
    image: Uint8Array,
    modelResolver: ReviewAssistanceModelResolver,
    options: ReviewAssistanceRunnerOptions,
  ): Promise<ReviewAssistanceDecision[]> {
    const groups = this.groupConflictingDecisions(decisions);
    if (groups.length === 0) return decisions;

    const droppedIds = new Set<string>();
    const decisionPatches = new Map<string, ReviewAssistanceDecision>();

    await ConcurrentPool.run(
      groups,
      Math.max(1, options.taskConcurrency),
      async (group) => {
        const capped = [...group]
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, REVIEW_ASSISTANCE_MERGE_GROUP_CAP);
        const outcome = await this.decideMergeOutcome(
          capped,
          context,
          image,
          modelResolver,
          options,
        );

        if (outcome.kind === 'drop_all') {
          const representative = capped[0];
          /* v8 ignore next 3 -- guarded upstream; groupConflictingDecisions
           * only emits groups of >=2, so capped has at least one entry. */
          if (!representative) return;
          for (const candidate of group) {
            if (candidate.id !== representative.id) droppedIds.add(candidate.id);
          }
          decisionPatches.set(
            representative.id,
            this.applyMergeDropAllMetadata(representative, group, outcome),
          );
          this.logger.info(
            `[ReviewAssistanceRunner] Page ${context.pageNo}: merge resolved by ${outcome.method} — drop all (group size ${group.length}, audit-kept ${representative.id})`,
          );
          return;
        }

        const winner = outcome.winner;
        for (const candidate of group) {
          if (candidate.id !== winner.id) droppedIds.add(candidate.id);
        }
        decisionPatches.set(
          winner.id,
          this.applyMergeWinnerMetadata(winner, group, outcome),
        );
        this.logger.info(
          `[ReviewAssistanceRunner] Page ${context.pageNo}: merge resolved by ${outcome.method} — pick ${winner.id} (group size ${group.length}, dropped ${group.length - 1})`,
        );
      },
      () => {
        /* no per-completion side effects */
      },
    );

    if (droppedIds.size === 0 && decisionPatches.size === 0) {
      return decisions;
    }

    return decisions
      .filter((decision) => !droppedIds.has(decision.id))
      .map((decision) => decisionPatches.get(decision.id) ?? decision);
  }

  /**
   * Build connected components of decisions that share a Docling target ref.
   * Uses the `task_conflict_same_target_ref` marker plus the
   * `metadata.taskConflict.conflictDecisionIds` adjacency that
   * `markTaskConflict` already maintains. Returns only groups with ≥2
   * members.
   */
  private groupConflictingDecisions(
    decisions: ReviewAssistanceDecision[],
  ): ReviewAssistanceDecision[][] {
    const conflicted = decisions.filter(
      (decision) =>
        decision.reasons.includes('task_conflict_same_target_ref') &&
        Boolean(decision.command),
    );
    if (conflicted.length === 0) return [];

    const byId = new Map(conflicted.map((decision) => [decision.id, decision]));
    const parent = new Map<string, string>();
    const find = (id: string): string => {
      let p = parent.get(id) ?? id;
      while (p !== (parent.get(p) ?? p)) {
        p = parent.get(p) ?? p;
      }
      parent.set(id, p);
      return p;
    };
    const union = (a: string, b: string): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    for (const decision of conflicted) parent.set(decision.id, decision.id);
    for (const decision of conflicted) {
      const adjacency = (
        decision.metadata?.taskConflict as
          | { conflictDecisionIds?: string[] }
          | undefined
      )?.conflictDecisionIds;
      if (!adjacency) continue;
      for (const other of adjacency) {
        if (byId.has(other)) union(decision.id, other);
      }
    }

    const groups = new Map<string, ReviewAssistanceDecision[]>();
    for (const decision of conflicted) {
      const root = find(decision.id);
      const bucket = groups.get(root) ?? [];
      bucket.push(decision);
      groups.set(root, bucket);
    }
    return [...groups.values()].filter((group) => group.length >= 2);
  }

  /**
   * Pick a winner (or drop the whole group) for a single conflict group.
   * Applies the deterministic confidence-gap heuristic first, only falling
   * back to the LLM call when the gap is narrow. On any LLM error or
   * out-of-range `chosenIndex`, returns the top-1 candidate so the page
   * always converges to a deterministic outcome.
   */
  private async decideMergeOutcome(
    capped: ReviewAssistanceDecision[],
    context: PageReviewContext,
    image: Uint8Array,
    modelResolver: ReviewAssistanceModelResolver,
    options: ReviewAssistanceRunnerOptions,
  ): Promise<MergeOutcome> {
    const top = capped[0];
    /* v8 ignore next 3 -- guarded upstream; groupConflictingDecisions only
     * emits groups of >=2, so capped has at least one entry. */
    if (!top) {
      throw new Error('decideMergeOutcome called with empty group');
    }
    if (capped.length === 1) {
      return {
        kind: 'pick',
        winner: top,
        method: 'deterministic_gap',
        mergeRationale: 'group_size_1',
        mergeConfidence: top.confidence,
      };
    }
    const runnerUp = capped[1];
    if (
      runnerUp !== undefined &&
      top.confidence - runnerUp.confidence > REVIEW_ASSISTANCE_MERGE_DETERMINISTIC_GAP
    ) {
      return {
        kind: 'pick',
        winner: top,
        method: 'deterministic_gap',
        mergeRationale: `confidence_gap ${top.confidence.toFixed(3)}>${runnerUp.confidence.toFixed(3)}`,
        mergeConfidence: top.confidence,
      };
    }

    try {
      const choice = await this.callMergeArbiter(
        capped,
        context,
        image,
        modelResolver,
        options,
      );
      if (choice.decision === 'drop') {
        return {
          kind: 'drop_all',
          method: 'llm',
          mergeRationale: choice.rationale,
        };
      }
      // Flat schema: chosenIndex is nullish and only meaningful for a pick. A
      // missing index on a pick is treated as out-of-range → top-1 fallback.
      const chosenIndex = choice.chosenIndex ?? -1;
      const winner = capped[chosenIndex];
      if (!winner) {
        this.logger.warn(
          `[ReviewAssistanceRunner] Page ${context.pageNo}: merge arbiter returned out-of-range chosenIndex=${choice.chosenIndex} (group size ${capped.length}); falling back to top-1`,
        );
        return {
          kind: 'pick',
          winner: top,
          method: 'llm_fallback',
          mergeRationale: `llm_chosen_index_out_of_range:${choice.chosenIndex}`,
          mergeConfidence: top.confidence,
        };
      }
      return {
        kind: 'pick',
        winner,
        method: 'llm',
        mergeRationale: choice.rationale,
        mergeConfidence: choice.confidence ?? winner.confidence,
      };
    } catch (error) {
      if (options.abortSignal?.aborted) {
        throw error;
      }
      this.logger.warn(
        `[ReviewAssistanceRunner] Page ${context.pageNo}: merge arbiter failed; falling back to top-1`,
        this.errorLogBinding(error),
      );
      return {
        kind: 'pick',
        winner: top,
        method: 'llm_fallback',
        mergeRationale: `llm_error:${this.safeErrorMessage(error)}`,
        mergeConfidence: top.confidence,
      };
    }
  }

  /**
   * Single LLM call for a conflict group. Schema-locked to pick-by-index or
   * drop; the arbiter cannot invent a new command. Aggregates token usage
   * into the same per-job aggregator as work-item calls, tagged with
   * phase=`merge-conflicts` so reports can isolate merge cost.
   */
  private async callMergeArbiter(
    candidates: ReviewAssistanceDecision[],
    context: PageReviewContext,
    image: Uint8Array,
    modelResolver: ReviewAssistanceModelResolver,
    options: ReviewAssistanceRunnerOptions,
  ): Promise<ReviewAssistanceMergeChoice> {
    const arbiterTask = this.resolveMergeTaskDefinition(candidates);
    const model = modelResolver(arbiterTask);
    const conflictRefs = [
      ...new Set(
        candidates.flatMap((decision) =>
          decision.command ? this.getTouchedRefs(decision.command) : [],
        ),
      ),
    ];
    const promptCandidates: ReviewAssistanceMergeCandidateForPrompt[] =
      candidates.map((decision, index) => ({
        index,
        taskId: String(decision.metadata?.reviewTask ?? 'unknown'),
        confidence: decision.confidence,
        rationale: this.extractCommandRationale(decision),
        evidence: this.summarizeDecisionEvidence(decision.evidence),
        command: decision.command,
      }));
    const prompt = buildReviewAssistanceMergePrompt({
      pageNo: context.pageNo,
      conflictRefs,
      candidates: promptCandidates,
      outputLanguage: options.outputLanguage,
    });

    const result = await this.withTimeout(
      LLMCaller.callVision({
        schema: reviewAssistanceMergeChoiceSchema as any,
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
        maxRetries: REVIEW_ASSISTANCE_MERGE_MAX_RETRIES,
        temperature: options.temperature,
        abortSignal: options.abortSignal,
        component: 'ReviewAssistance',
        phase: 'merge-conflicts',
        metadata: {
          pageNo: context.pageNo,
          groupSize: candidates.length,
          conflictRefs: conflictRefs.join(','),
          arbiterTask: arbiterTask.id,
        },
      }),
      options.workItemTimeoutMs,
      `merge arbiter timeout after ${options.workItemTimeoutMs}ms (page ${context.pageNo}, group size ${candidates.length})`,
    );
    options.aggregator?.track(result.usage);
    return result.output as ReviewAssistanceMergeChoice;
  }

  /**
   * Pick the model used for the merge call. Defaults to the task that
   * produced the highest-confidence candidate so the arbiter runs on the
   * same model family already chosen for that review domain. Falls back to
   * the first task definition (text_ocr_hanja) when the metadata is
   * missing, which keeps the call resolvable for unit-test fixtures.
   */
  private resolveMergeTaskDefinition(
    candidates: ReviewAssistanceDecision[],
  ): ReviewAssistanceTaskDefinition {
    const sorted = [...candidates].sort(
      (a, b) => b.confidence - a.confidence,
    );
    for (const decision of sorted) {
      const taskId = decision.metadata?.reviewTask;
      const match = REVIEW_ASSISTANCE_TASKS.find(
        (task) => task.id === taskId,
      );
      if (match) return match;
    }
    /* v8 ignore next 3 -- every decision is tagged with reviewTask via
     * withTaskMetadata before reaching the merge phase. */
    return REVIEW_ASSISTANCE_TASKS[0];
  }

  /**
   * Apply the merge winner metadata: drop the conflict marker so the
   * winner is no longer classified as `task_conflict_same_target_ref`, and
   * stash the dropped candidates' ids + commands under
   * `metadata.mergeChosen` for the persisted audit trail.
   */
  private applyMergeWinnerMetadata(
    winner: ReviewAssistanceDecision,
    group: readonly ReviewAssistanceDecision[],
    outcome: MergePickOutcome,
  ): ReviewAssistanceDecision {
    const droppedSummaries = group
      .filter((candidate) => candidate.id !== winner.id)
      .map((candidate) => ({
        decisionId: candidate.id,
        task:
          typeof candidate.metadata?.reviewTask === 'string'
            ? (candidate.metadata.reviewTask as string)
            : undefined,
        confidence: candidate.confidence,
        command: candidate.command,
      }));
    const cleanedReasons = winner.reasons.filter(
      (reason) =>
        reason !== 'task_conflict_same_target_ref' &&
        !reason.startsWith('conflicts_with_decision:'),
    );
    const priorConflict = winner.metadata?.taskConflict as
      | { autoAppliedBeforeConflict?: boolean }
      | undefined;
    // The conflict that demoted this winner from auto_applied to proposal is
    // now resolved in its favour. Restore auto-apply when the arbiter actively
    // picked it (method 'llm'); fallback picks stay a proposal for safety.
    const restoredDisposition =
      priorConflict?.autoAppliedBeforeConflict === true &&
      outcome.method === 'llm'
        ? 'auto_applied'
        : winner.disposition;
    const { taskConflict: _taskConflict, ...restMetadata } =
      winner.metadata ?? {};
    return {
      ...winner,
      disposition: restoredDisposition,
      reasons: [
        ...new Set([...cleanedReasons, `merge_chosen_by:${outcome.method}`]),
      ],
      metadata: {
        ...restMetadata,
        mergeChosen: {
          method: outcome.method,
          mergeRationale: outcome.mergeRationale,
          mergeConfidence: outcome.mergeConfidence,
          groupSize: group.length,
          droppedDecisionIds: droppedSummaries.map(
            (summary) => summary.decisionId,
          ),
          dropped: droppedSummaries,
        },
      },
    };
  }

  /**
   * Mark the representative decision of a drop-all group as `skipped` with
   * a dedicated `merge_dropped_all` reason. The full group payload is
   * stashed under `metadata.mergeDropped` so the persisted
   * `review_assistance.json` keeps a reproducible audit trail of the
   * arbiter's decision even though every command was dropped.
   *
   * We keep only one representative (top-1 by confidence) instead of
   * leaving every candidate as `skipped`; that prevents the drop-all path
   * from re-introducing the 확인 noise the merge phase was designed to
   * remove.
   */
  private applyMergeDropAllMetadata(
    representative: ReviewAssistanceDecision,
    group: readonly ReviewAssistanceDecision[],
    outcome: MergeDropAllOutcome,
  ): ReviewAssistanceDecision {
    const droppedSummaries = group.map((candidate) => ({
      decisionId: candidate.id,
      task:
        typeof candidate.metadata?.reviewTask === 'string'
          ? (candidate.metadata.reviewTask as string)
          : undefined,
      confidence: candidate.confidence,
      command: candidate.command,
    }));
    const cleanedReasons = representative.reasons.filter(
      (reason) =>
        reason !== 'task_conflict_same_target_ref' &&
        !reason.startsWith('conflicts_with_decision:'),
    );
    const { taskConflict: _taskConflict, ...restMetadata } =
      representative.metadata ?? {};
    return {
      ...representative,
      disposition: 'skipped',
      reasons: [...new Set([...cleanedReasons, 'merge_dropped_all'])],
      metadata: {
        ...restMetadata,
        mergeDropped: {
          method: outcome.method,
          mergeRationale: outcome.mergeRationale,
          groupSize: group.length,
          dropped: droppedSummaries,
        },
      },
    };
  }

  /**
   * Pull the per-command rationale produced by the work-item LLM call. Every
   * structured-output command carries its own `rationale` via the shared
   * `baseFields` block in the schema, so it lives on `decision.command`
   * rather than on the decision itself.
   */
  private extractCommandRationale(
    decision: ReviewAssistanceDecision,
  ): string | undefined {
    const rationale = (
      decision.command as { rationale?: unknown } | undefined
    )?.rationale;
    return typeof rationale === 'string' && rationale.length > 0
      ? rationale
      : undefined;
  }

  /**
   * Collapse a decision's structured evidence object into a short string the
   * arbiter prompt can render inline. We keep the image/text snippets and
   * suspect reasons because those describe what the page actually shows;
   * geometry-only fields (`previousBbox`/`snappedBbox`/`generatedRefs`)
   * carry no extra signal for the pick-vs-drop choice.
   */
  private summarizeDecisionEvidence(
    evidence: ReviewAssistanceDecision['evidence'],
  ): string | undefined {
    if (!evidence) return undefined;
    const parts: string[] = [];
    if (evidence.imageEvidence) parts.push(`image: ${evidence.imageEvidence}`);
    if (evidence.textLayerEvidence)
      parts.push(`text: ${evidence.textLayerEvidence}`);
    if (evidence.suspectReasons && evidence.suspectReasons.length > 0) {
      parts.push(`suspects: ${evidence.suspectReasons.join(',')}`);
    }
    return parts.length > 0 ? parts.join(' | ') : undefined;
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
    callTraces: ReviewAssistanceCallTrace[] = [],
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
    const report = {
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
        concurrency: options.pageConcurrency,
        autoApplyThreshold: options.autoApplyThreshold,
        proposalThreshold: options.proposalThreshold,
        maxRetries: options.maxRetries,
        tableMaxRetries: options.tableMaxRetries,
        localModelConcurrency: options.localModelConcurrency,
        workItemTimeoutMs: options.workItemTimeoutMs,
        temperature: options.temperature,
        outputLanguage: options.outputLanguage,
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
      callTraces,
    };
    return report as ReviewAssistanceReport;
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
      if (this.isTrustedVlmTextHint(block.suspectReasons)) {
        continue;
      }
      for (const reason of block.suspectReasons) {
        if (this.isTrustedVlmTextIssueReason(reason)) {
          continue;
        }
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
      if (this.isTrustedVlmDomainPattern(pattern.pattern)) {
        continue;
      }
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

  private isTrustedVlmTextHint(reasons: string[]): boolean {
    return reasons.includes('picture_internal_text');
  }

  private isTrustedVlmTextIssueReason(reason: string): boolean {
    return reason === 'hanja_ocr_candidate';
  }

  private isTrustedVlmDomainPattern(
    pattern: PageReviewContext['domainPatterns'][number]['pattern'],
  ): boolean {
    return pattern === 'hanja_term';
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
      case 'picture_split_boundary_candidate':
        return `이미지 내부에 분할 경계 후보가 있습니다${preview}`;
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
