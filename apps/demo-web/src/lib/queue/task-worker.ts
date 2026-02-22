import type { DoclingDocument, TokenUsageReport } from '@heripo/model';
import type { PDFConvertOptions, PDFParser } from '@heripo/pdf-parser';
import type { EventEmitter } from 'events';

import type { QueuedTask, SSEEvent } from './task-queue-manager';

import { DocumentProcessor } from '@heripo/document-processor';
import { readFileSync, writeFileSync } from 'fs';

import { calculateCost } from '../cost/model-pricing';
import { createLog } from '../db/repositories/log-repository';
import {
  getTaskById,
  updateTaskProgress,
  updateTaskResult,
  updateTaskStatus,
} from '../db/repositories/task-repository';
import { createProcessorOptions } from '../processing/model-factory';
import {
  createTaskCompletedPayload,
  createTaskFailedPayload,
  sendWebhookAsync,
} from '../webhook';
import { PDFParserManager } from './pdf-parser-manager';

/**
 * Parse a PDF using the given parser and return the DoclingDocument with output path.
 */
function parsePdf(
  pdfParser: PDFParser,
  pdfUrl: string,
  taskId: string,
  options: PDFConvertOptions,
  abortSignal?: AbortSignal,
): Promise<{ doclingDocument: DoclingDocument; outputPath: string }> {
  return new Promise((resolve, reject) => {
    pdfParser
      .parse(
        pdfUrl,
        taskId,
        (outPath) => {
          try {
            const resultPath = `${outPath}/result.json`;
            const json = readFileSync(resultPath, 'utf8');
            resolve({
              doclingDocument: JSON.parse(json) as DoclingDocument,
              outputPath: outPath,
            });
          } catch (err) {
            reject(err);
          }
        },
        false,
        options,
        abortSignal,
      )
      .catch(reject);
  });
}

function calculateTotalCost(usage: TokenUsageReport): number {
  let total = 0;
  for (const component of usage.components) {
    for (const phase of component.phases) {
      if (phase.primary) {
        total += calculateCost(
          phase.primary.modelName,
          phase.primary.inputTokens,
          phase.primary.outputTokens,
        );
      }
      if (phase.fallback) {
        total += calculateCost(
          phase.fallback.modelName,
          phase.fallback.inputTokens,
          phase.fallback.outputTokens,
        );
      }
    }
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}

const PROCESSING_STEPS = [
  { id: 'upload', name: 'Uploading PDF', weight: 0 },
  { id: 'pdf-parse', name: 'PDF Parsing', weight: 30 },
  { id: 'page-range', name: 'Page Range Mapping', weight: 15 },
  { id: 'toc-extract', name: 'TOC Extraction', weight: 20 },
  { id: 'resource-process', name: 'Resource Processing', weight: 20 },
  { id: 'chapter-convert', name: 'Chapter Conversion', weight: 15 },
] as const;

// Step detection prefixes - first occurrence triggers step change
const STEP_PREFIXES: Record<string, string> = {
  '[PageRangeParser]': 'page-range',
  '[TocFinder]': 'toc-extract',
  '[CaptionParser]': 'resource-process',
};

function getStepIndex(stepId: string): number {
  return PROCESSING_STEPS.findIndex((s) => s.id === stepId);
}

function maskFilePaths(message: string): string {
  return (
    message
      // file:// URL
      .replace(/file:\/\/[^\s]+/g, (match) => match.split('/').pop() || match)
      // 절대 경로 (/Users, /var, /tmp, /home 등)
      .replace(
        /\/(?:Users|var|tmp|home)[^\s]*/g,
        (match) => match.split('/').pop() || match,
      )
  );
}

function calculateProgress(stepIndex: number, stepProgress = 100): number {
  let totalWeight = 0;
  for (let i = 0; i < stepIndex; i++) {
    totalWeight += PROCESSING_STEPS[i].weight;
  }
  const currentStepWeight = PROCESSING_STEPS[stepIndex]?.weight || 0;
  return Math.round(totalWeight + (currentStepWeight * stepProgress) / 100);
}

interface TaskLoggerMethods {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

interface TaskLoggerContext {
  logger: TaskLoggerMethods;
  detectedSteps: Set<string>;
}

function createTaskLogger(
  taskId: string,
  emitter: EventEmitter,
  emitProgress: (step: string, percent: number) => void,
): TaskLoggerContext {
  const detectedSteps = new Set<string>();

  const emit = (
    level: 'debug' | 'info' | 'warn' | 'error',
    ...args: unknown[]
  ) => {
    const message = maskFilePaths(
      args
        .map((arg) =>
          typeof arg === 'object' && arg !== null
            ? JSON.stringify(arg)
            : String(arg),
        )
        .join(' '),
    );
    const timestamp = new Date().toISOString();

    // Detect step change from log prefix
    for (const [prefix, stepId] of Object.entries(STEP_PREFIXES)) {
      if (message.startsWith(prefix) && !detectedSteps.has(stepId)) {
        detectedSteps.add(stepId);
        const stepIndex = getStepIndex(stepId);
        if (stepIndex !== -1) {
          emitProgress(stepId, calculateProgress(stepIndex, 0));
        }
        break;
      }
    }

    const log = createLog(taskId, level, message);

    const event: SSEEvent = {
      type: 'log',
      data: { id: log.id, level, message, timestamp },
    };
    emitter.emit(`task:${taskId}`, event);
  };

  return {
    logger: {
      debug: (...args: unknown[]) => emit('debug', ...args),
      info: (...args: unknown[]) => emit('info', ...args),
      warn: (...args: unknown[]) => emit('warn', ...args),
      error: (...args: unknown[]) => emit('error', ...args),
    },
    detectedSteps,
  };
}

export async function runTaskWorker(
  task: QueuedTask,
  emitter: EventEmitter,
  abortSignal?: AbortSignal,
): Promise<void> {
  const { taskId, filePath, options } = task;

  const emitProgress = (step: string, percent: number) => {
    updateTaskProgress(taskId, step, percent);
    const event: SSEEvent = {
      type: 'progress',
      data: { step, percent },
    };
    emitter.emit(`task:${taskId}`, event);
  };

  const { logger } = createTaskLogger(taskId, emitter, emitProgress);

  const pdfParserManager = PDFParserManager.getInstance();

  try {
    // Step 1: PDF Parsing
    const pipelineType = options.pipeline ?? 'standard';
    logger.info(`Starting PDF parsing (pipeline: ${pipelineType})...`);
    emitProgress('pdf-parse', calculateProgress(1, 0));

    // Register task logger to receive PDF parser logs
    pdfParserManager.setTaskLogger(taskId, logger);

    const pdfParser = await pdfParserManager.getParser();
    const pdfUrl = `file://${filePath}`;

    let doclingDocument: DoclingDocument;
    let outputPath: string;

    try {
      const parseResult = await parsePdf(
        pdfParser,
        pdfUrl,
        taskId,
        {
          ocr_lang: options.ocrLanguages,
          num_threads: options.threadCount,
          pipeline: pipelineType,
          vlm_model: options.vlmModel,
        },
        abortSignal,
      );

      doclingDocument = parseResult.doclingDocument;
      outputPath = parseResult.outputPath;
    } finally {
      // Clear task logger after PDF parsing
      pdfParserManager.clearTaskLogger(taskId);
    }

    logger.info('PDF parsing completed');
    emitProgress('pdf-parse', calculateProgress(1, 100));

    // Create DocumentProcessor (used for both hanja assessment and document processing)
    const processor = new DocumentProcessor(
      createProcessorOptions(options, logger, abortSignal),
    );

    // Hanja quality assessment: auto-fallback to VLM if KCJ corruption detected
    if (pipelineType === 'standard') {
      const assessment = await processor.assessHanjaQuality(
        doclingDocument,
        outputPath,
      );

      if (assessment.needsVlmReparse) {
        logger.info(
          `Hanja quality insufficient (severity: ${assessment.severity}, ratio: ${assessment.corruptedRatio}), re-parsing with VLM pipeline...`,
        );

        pdfParserManager.setTaskLogger(taskId, logger);
        try {
          const vlmResult = await parsePdf(
            pdfParser,
            pdfUrl,
            taskId,
            {
              ocr_lang: options.ocrLanguages,
              num_threads: options.threadCount,
              pipeline: 'vlm',
              vlm_model: options.vlmModel,
            },
            abortSignal,
          );

          doclingDocument = vlmResult.doclingDocument;
          outputPath = vlmResult.outputPath;
          logger.info('VLM re-parsing completed');
        } finally {
          pdfParserManager.clearTaskLogger(taskId);
        }
      } else {
        logger.info(
          `Hanja quality acceptable (severity: ${assessment.severity}), continuing with OCR result`,
        );
      }
    }

    // Step 2-5: Document Processing
    logger.info('Starting document processing...');

    const result = await processor.process(doclingDocument, taskId, outputPath);

    logger.info('Document processing completed');

    // Save processed result
    const processedResultPath = `${outputPath}/result-processed.json`;
    writeFileSync(
      processedResultPath,
      JSON.stringify(result.document, null, 2),
    );

    // Update task with results
    updateTaskResult(taskId, {
      outputPath,
      resultPath: `${outputPath}/result.json`,
      processedResultPath,
      totalPages: Object.keys(result.document.pageRangeMap).length,
      chaptersCount: result.document.chapters.length,
      imagesCount: result.document.images.length,
      tablesCount: result.document.tables.length,
      tokenUsage: result.usage,
    });

    logger.info('Task completed successfully', {
      chapters: result.document.chapters.length,
      images: result.document.images.length,
      tables: result.document.tables.length,
    });

    const completeEvent: SSEEvent = {
      type: 'complete',
      data: { resultUrl: `/api/tasks/${taskId}/result` },
    };
    emitter.emit(`task:${taskId}`, completeEvent);

    // Send webhook for completed task
    const completedTaskRecord = getTaskById(taskId);
    sendWebhookAsync(
      createTaskCompletedPayload({
        ip: task.clientIP,
        userAgent: task.userAgent,
        taskId,
        sessionId: task.sessionId,
        filename: task.filename,
        startedAt: completedTaskRecord?.startedAt ?? null,
        totalPages: Object.keys(result.document.pageRangeMap).length,
        chaptersCount: result.document.chapters.length,
        imagesCount: result.document.images.length,
        tablesCount: result.document.tables.length,
        tokenCostUSD: calculateTotalCost(result.usage),
      }),
    );
  } catch (error) {
    // Ensure task logger is cleared on error
    pdfParserManager.clearTaskLogger(taskId);

    // If aborted, don't update status to 'failed' - it's already 'cancelled'
    if (abortSignal?.aborted) {
      logger.info('Task was cancelled');
      throw error;
    }

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    logger.error('Task failed:', errorMessage);

    updateTaskStatus(taskId, 'failed', {
      errorCode: 'PROCESSING_ERROR',
      errorMessage,
      completedAt: new Date().toISOString(),
    });

    const errorEvent: SSEEvent = {
      type: 'error',
      data: { code: 'PROCESSING_ERROR', message: errorMessage },
    };
    emitter.emit(`task:${taskId}`, errorEvent);

    // Send webhook for failed task
    const failedTaskRecord = getTaskById(taskId);
    sendWebhookAsync(
      createTaskFailedPayload({
        ip: task.clientIP,
        userAgent: task.userAgent,
        taskId,
        sessionId: task.sessionId,
        filename: task.filename,
        startedAt: failedTaskRecord?.startedAt ?? null,
        errorCode: 'PROCESSING_ERROR',
        errorMessage,
      }),
    );

    throw error;
  }
}
