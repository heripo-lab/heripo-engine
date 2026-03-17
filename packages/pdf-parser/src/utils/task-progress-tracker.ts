import type { LoggerMethods } from '@heripo/logger';

import { PDF_CONVERTER } from '../config/constants';
import { getTaskFailureDetails } from './task-failure-details';

interface PollableTask {
  taskId: string;
  poll: () => Promise<{
    task_status: string;
    task_position?: number;
    task_meta?: { total_documents?: number; processed_documents?: number };
  }>;
  getResult: () => Promise<{ errors?: { message: string }[]; status?: string }>;
}

export interface TrackProgressOptions {
  /** Show detailed progress with position and document counts (default: false) */
  showDetailedProgress?: boolean;
  /** Error message prefix prepended to 'timeout' / 'failed: <details>' (default: 'Task ') */
  errorPrefix?: string;
}

/**
 * Poll a Docling conversion task until completion.
 *
 * @param task - Pollable task object from Docling SDK
 * @param timeout - Maximum wait time in milliseconds
 * @param logger - Logger instance
 * @param logPrefix - Log prefix (e.g. '[PDFConverter]')
 * @param options - Optional configuration
 */
export async function trackTaskProgress(
  task: PollableTask,
  timeout: number,
  logger: LoggerMethods,
  logPrefix: string,
  options?: TrackProgressOptions,
): Promise<void> {
  const startTime = Date.now();
  const errPrefix = options?.errorPrefix ?? 'Task ';

  const pollOnce = async (lastProgressLine: string): Promise<void> => {
    if (Date.now() - startTime > timeout) {
      throw new Error(`${errPrefix}timeout`);
    }

    const status = await task.poll();

    // Detailed progress logging (used by single-pass conversion)
    const updatedProgressLine = options?.showDetailedProgress
      ? (() => {
          const parts: string[] = [`Status: ${status.task_status}`];
          if (status.task_position !== undefined) {
            parts.push(`position: ${status.task_position}`);
          }
          const meta = status.task_meta;
          if (
            meta?.processed_documents !== undefined &&
            meta?.total_documents !== undefined
          ) {
            parts.push(
              `progress: ${meta.processed_documents}/${meta.total_documents}`,
            );
          }
          const progressLine = `\r${logPrefix} ${parts.join(' | ')}`;
          if (progressLine !== lastProgressLine) {
            process.stdout.write(progressLine);
            return progressLine;
          }
          return lastProgressLine;
        })()
      : lastProgressLine;

    if (status.task_status === 'success') {
      if (options?.showDetailedProgress) {
        logger.info(`\n${logPrefix} Conversion completed!`);
      }
      return;
    }

    if (status.task_status === 'failure') {
      const errorDetails = await getTaskFailureDetails(task, logger, logPrefix);

      if (options?.showDetailedProgress) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        logger.error(
          `\n${logPrefix} Task failed after ${elapsed}s: ${errorDetails}`,
        );
      } else {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.error(
          `${logPrefix} Task ${task.taskId} failed after ${elapsed}s`,
        );
      }

      throw new Error(`${errPrefix}failed: ${errorDetails}`);
    }

    await new Promise((resolve) =>
      setTimeout(resolve, PDF_CONVERTER.POLL_INTERVAL_MS),
    );
    return pollOnce(updatedProgressLine);
  };

  return pollOnce('');
}
