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
  /** Custom error prefix for timeout/failure messages (e.g. '[ChunkedPDFConverter] Chunk ') */
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
  const errPrefix = options?.errorPrefix ?? '';
  let lastProgressLine = '';

  while (true) {
    if (Date.now() - startTime > timeout) {
      throw new Error(`${errPrefix}Task timeout`);
    }

    const status = await task.poll();

    // Detailed progress logging (used by single-pass conversion)
    if (options?.showDetailedProgress) {
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
        lastProgressLine = progressLine;
        process.stdout.write(progressLine);
      }
    }

    if (status.task_status === 'success') {
      if (options?.showDetailedProgress) {
        logger.info(`\n${logPrefix} Conversion completed!`);
      }
      return;
    }

    if (status.task_status === 'failure') {
      const errorDetails = await getTaskFailureDetails(task, logger, logPrefix);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      logger.error(
        `\n${logPrefix} Task failed after ${elapsed}s: ${errorDetails}`,
      );
      throw new Error(`${errPrefix}Task failed: ${errorDetails}`);
    }

    await new Promise((resolve) =>
      setTimeout(resolve, PDF_CONVERTER.POLL_INTERVAL_MS),
    );
  }
}
