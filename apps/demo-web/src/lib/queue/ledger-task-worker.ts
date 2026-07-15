import type { EventEmitter } from 'events';

import type { LedgerQueuedTask, SSEEvent } from './task-queue-manager';

import { LedgerExtractor } from '@heripo/ledger-extractor';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

import {
  getTaskById,
  updateLedgerTaskResult,
  updateTaskProgress,
  updateTaskStatus,
} from '../db/repositories/task-repository';
import {
  LEDGER_ERROR_CODES,
  LedgerInputError,
  parseLedgerInputText,
} from '../ledger/ledger-input';
import { paths } from '../paths';
import {
  createTaskCompletedPayload,
  createTaskFailedPayload,
  sendWebhookAsync,
} from '../webhook';
import { createTaskLogger } from './task-logger';

const LEDGER_STEPS = [
  { id: 'upload', name: 'Uploading JSON', weight: 0 },
  { id: 'json-parse', name: 'JSON Parsing', weight: 20 },
  { id: 'document-validate', name: 'Document Validation', weight: 25 },
  { id: 'ledger-extract', name: 'Ledger Extraction', weight: 50 },
  { id: 'complete', name: 'Complete', weight: 5 },
] as const;

function calculateLedgerProgress(
  stepIndex: number,
  stepProgress = 100,
): number {
  let totalWeight = 0;
  for (let i = 0; i < stepIndex; i++) {
    totalWeight += LEDGER_STEPS[i].weight;
  }
  const currentStepWeight = LEDGER_STEPS[stepIndex]?.weight || 0;
  return Math.round(totalWeight + (currentStepWeight * stepProgress) / 100);
}

function getLedgerStepIndex(stepId: string): number {
  return LEDGER_STEPS.findIndex((s) => s.id === stepId);
}

function throwIfAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) {
    throw new Error('Ledger task was aborted');
  }
}

/**
 * Worker for 'ledger' tasks: reads the uploaded processed-document.json,
 * validates it, runs the LedgerExtractor preview, and stores the result as
 * ledger-preview.json. No PDF parser or DocumentProcessor is involved.
 */
export async function runLedgerTaskWorker(
  task: LedgerQueuedTask,
  emitter: EventEmitter,
  abortSignal?: AbortSignal,
): Promise<void> {
  const { taskId, filePath } = task;

  const emitProgress = (step: string, percent: number) => {
    updateTaskProgress(taskId, step, percent);
    const event: SSEEvent = {
      type: 'progress',
      data: { step, percent },
    };
    emitter.emit(`task:${taskId}`, event);
  };

  const emitStep = (stepId: string, stepProgress = 0) => {
    emitProgress(
      stepId,
      calculateLedgerProgress(getLedgerStepIndex(stepId), stepProgress),
    );
  };

  const { logger } = createTaskLogger(taskId, emitter);

  try {
    // Step 1: read the uploaded JSON file
    throwIfAborted(abortSignal);
    logger.info('Starting ledger extraction preview...');
    emitStep('json-parse');

    if (!existsSync(filePath)) {
      throw new LedgerInputError(
        LEDGER_ERROR_CODES.LEDGER_EXTRACTION_ERROR,
        'Uploaded JSON file not found',
      );
    }
    const rawText = readFileSync(filePath, 'utf8');

    // Step 2-3: JSON parse + ProcessedDocument runtime validation
    throwIfAborted(abortSignal);
    const document = parseLedgerInputText(rawText, {
      onJsonParsed: () => emitStep('document-validate'),
    });
    logger.info('ProcessedDocument validated successfully');

    // Step 4: ledger extraction preview
    throwIfAborted(abortSignal);
    emitStep('ledger-extract');

    const extractor = new LedgerExtractor({ logger });
    const preview = await extractor.extract(document);

    // Step 5: persist preview result
    throwIfAborted(abortSignal);
    emitStep('complete');

    const taskPaths = paths.task(taskId);
    if (!existsSync(taskPaths.outputRoot)) {
      mkdirSync(taskPaths.outputRoot, { recursive: true });
    }
    writeFileSync(
      taskPaths.ledgerPreviewJson,
      JSON.stringify(preview, null, 2),
    );

    updateLedgerTaskResult(taskId, {
      outputResultPath: taskPaths.ledgerPreviewJson,
      chaptersCount: preview.counts.chapters,
      imagesCount: preview.counts.images,
      tablesCount: preview.counts.tables,
    });

    logger.info('Ledger extraction preview completed successfully', {
      chapters: preview.counts.chapters,
      images: preview.counts.images,
      tables: preview.counts.tables,
    });

    const completeEvent: SSEEvent = {
      type: 'complete',
      data: { resultUrl: `/api/tasks/${taskId}/result` },
    };
    emitter.emit(`task:${taskId}`, completeEvent);

    // Send webhook for completed task (ledger preview has no pages/LLM cost)
    const completedTaskRecord = getTaskById(taskId);
    sendWebhookAsync(
      createTaskCompletedPayload({
        ip: task.clientIP,
        userAgent: task.userAgent,
        taskId,
        sessionId: task.sessionId,
        filename: task.filename,
        startedAt: completedTaskRecord?.startedAt ?? null,
        totalPages: 0,
        chaptersCount: preview.counts.chapters,
        imagesCount: preview.counts.images,
        tablesCount: preview.counts.tables,
        tokenCostUSD: 0,
      }),
    );
  } catch (error) {
    // If aborted, don't update status to 'failed' - it's already 'cancelled'
    if (abortSignal?.aborted) {
      logger.info('Task was cancelled');
      throw error;
    }

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    const errorCode =
      error instanceof LedgerInputError
        ? error.code
        : LEDGER_ERROR_CODES.LEDGER_EXTRACTION_ERROR;

    logger.error('Ledger task failed:', errorMessage);

    updateTaskStatus(taskId, 'failed', {
      errorCode,
      errorMessage,
      completedAt: new Date().toISOString(),
    });

    const errorEvent: SSEEvent = {
      type: 'error',
      data: { code: errorCode, message: errorMessage },
    };
    emitter.emit(`task:${taskId}`, errorEvent);

    const failedTaskRecord = getTaskById(taskId);
    sendWebhookAsync(
      createTaskFailedPayload({
        ip: task.clientIP,
        userAgent: task.userAgent,
        taskId,
        sessionId: task.sessionId,
        filename: task.filename,
        startedAt: failedTaskRecord?.startedAt ?? null,
        errorCode,
        errorMessage,
      }),
    );

    throw error;
  }
}
