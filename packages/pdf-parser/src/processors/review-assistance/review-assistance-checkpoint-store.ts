import type {
  ReviewAssistancePageResult,
  ReviewAssistanceReport,
} from '@heripo/model';

import type { ReviewAssistanceWorkItemKind } from './review-assistance-work-scheduler';

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type ReviewAssistanceCallTraceValidation =
  | 'passed'
  | 'reasked'
  | 'failed';

export interface ReviewAssistanceCallTrace {
  workItemId: string;
  kind: ReviewAssistanceWorkItemKind;
  pageNo: number;
  targetRefs: string[];
  modelId?: string;
  attempts: number;
  startedAt: string;
  durationMs: number;
  validation: ReviewAssistanceCallTraceValidation;
  failureReasons?: string[];
}

export interface ReviewAssistanceCheckpoint {
  schemaVersion: 1;
  runId: string;
  completedWorkItemIds: string[];
  failedWorkItems: Array<{ id: string; reason: string; attempts: number }>;
  partialPages: ReviewAssistanceReport['pages'];
  callTraces: ReviewAssistanceCallTrace[];
  updatedAt: string;
}

export interface ReviewAssistanceCheckpointWorkItemUpdate {
  workItemId: string;
  page: ReviewAssistancePageResult;
  trace: ReviewAssistanceCallTrace;
  failed?: { reason: string; attempts: number };
}

const CHECKPOINT_FILE = 'review_assistance_checkpoint.json';

export class ReviewAssistanceCheckpointStore {
  private constructor(
    private readonly path: string,
    private checkpoint: ReviewAssistanceCheckpoint,
    private readonly now: () => Date = () => new Date(),
  ) {}

  static open(
    outputDir: string,
    runId: string,
    now?: () => Date,
  ): ReviewAssistanceCheckpointStore {
    const path = join(outputDir, CHECKPOINT_FILE);
    const checkpoint = this.read(path, runId, now?.() ?? new Date());
    return new ReviewAssistanceCheckpointStore(path, checkpoint, now);
  }

  hasCompletedWorkItem(id: string): boolean {
    return this.checkpoint.completedWorkItemIds.includes(id);
  }

  hasFailedWorkItem(id: string): boolean {
    return this.checkpoint.failedWorkItems.some((item) => item.id === id);
  }

  getPartialPage(pageNo: number): ReviewAssistancePageResult | undefined {
    return this.checkpoint.partialPages.find((page) => page.pageNo === pageNo);
  }

  getCallTraces(): ReviewAssistanceCallTrace[] {
    return [...this.checkpoint.callTraces];
  }

  recordWorkItem(update: ReviewAssistanceCheckpointWorkItemUpdate): void {
    if (!update.failed) {
      this.checkpoint.completedWorkItemIds = [
        ...new Set([
          ...this.checkpoint.completedWorkItemIds,
          update.workItemId,
        ]),
      ];
      this.checkpoint.failedWorkItems = this.checkpoint.failedWorkItems.filter(
        (item) => item.id !== update.workItemId,
      );
    } else {
      const failedById = new Map(
        this.checkpoint.failedWorkItems.map((item) => [item.id, item]),
      );
      failedById.set(update.workItemId, {
        id: update.workItemId,
        reason: update.failed.reason,
        attempts: update.failed.attempts,
      });
      this.checkpoint.failedWorkItems = [...failedById.values()];
    }

    this.upsertPartialPage(update.page);
    this.upsertCallTrace(update.trace);
    this.write();
  }

  recordPage(page: ReviewAssistancePageResult): void {
    this.upsertPartialPage(page);
    this.write();
  }

  private upsertPartialPage(page: ReviewAssistancePageResult): void {
    this.checkpoint.partialPages = [
      ...this.checkpoint.partialPages.filter(
        (partial) => partial.pageNo !== page.pageNo,
      ),
      page,
    ].sort((a, b) => a.pageNo - b.pageNo);
  }

  private upsertCallTrace(trace: ReviewAssistanceCallTrace): void {
    this.checkpoint.callTraces = [
      ...this.checkpoint.callTraces.filter(
        (entry) => entry.workItemId !== trace.workItemId,
      ),
      trace,
    ];
  }

  private write(): void {
    this.checkpoint.updatedAt = this.now().toISOString();
    writeFileSync(this.path, JSON.stringify(this.checkpoint, null, 2));
  }

  private static read(
    path: string,
    runId: string,
    now: Date,
  ): ReviewAssistanceCheckpoint {
    if (!existsSync(path)) {
      return this.empty(runId, now);
    }

    try {
      const parsed = JSON.parse(
        readFileSync(path, 'utf-8'),
      ) as Partial<ReviewAssistanceCheckpoint>;
      if (parsed.schemaVersion !== 1 || parsed.runId !== runId) {
        return this.empty(runId, now);
      }
      return {
        schemaVersion: 1,
        runId,
        completedWorkItemIds: Array.isArray(parsed.completedWorkItemIds)
          ? parsed.completedWorkItemIds.filter(
              (id): id is string => typeof id === 'string',
            )
          : [],
        failedWorkItems: Array.isArray(parsed.failedWorkItems)
          ? parsed.failedWorkItems.filter(
              (
                item,
              ): item is {
                id: string;
                reason: string;
                attempts: number;
              } =>
                typeof item?.id === 'string' &&
                typeof item.reason === 'string' &&
                typeof item.attempts === 'number',
            )
          : [],
        partialPages: Array.isArray(parsed.partialPages)
          ? parsed.partialPages
          : [],
        callTraces: Array.isArray(parsed.callTraces) ? parsed.callTraces : [],
        updatedAt:
          typeof parsed.updatedAt === 'string'
            ? parsed.updatedAt
            : now.toISOString(),
      };
    } catch {
      return this.empty(runId, now);
    }
  }

  private static empty(runId: string, now: Date): ReviewAssistanceCheckpoint {
    return {
      schemaVersion: 1,
      runId,
      completedWorkItemIds: [],
      failedWorkItems: [],
      partialPages: [],
      callTraces: [],
      updatedAt: now.toISOString(),
    };
  }
}
