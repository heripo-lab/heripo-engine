import type { ScheduledTask } from 'node-cron';

import cron from 'node-cron';

import { cleanupConfig } from '~/lib/config/cleanup';
import {
  createCleanupCompletedPayload,
  createCleanupFailedPayload,
  sendWebhookAsync,
} from '~/lib/webhook';

import { cleanupExpiredTasks } from './task-cleanup';

let scheduledTask: ScheduledTask | null = null;

/**
 * Runs the cleanup job and sends webhook notification.
 */
function runCleanup(): void {
  const startTime = Date.now();
  console.log('[Cleanup] Starting scheduled cleanup...');

  try {
    const result = cleanupExpiredTasks();
    const durationMs = Date.now() - startTime;

    if (result.errors.length > 0) {
      // Partial failure - some tasks deleted, some failed
      console.error(
        `[Cleanup] Completed with errors: ${result.deletedCount} deleted, ${result.errors.length} errors`,
      );
      for (const error of result.errors) {
        console.error(
          `[Cleanup] Error for task ${error.taskId}: ${error.error}`,
        );
      }

      sendWebhookAsync(
        createCleanupFailedPayload({
          retentionDays: cleanupConfig.retentionDays,
          errorMessage: `Partial failure: ${result.errors.length} tasks failed to delete`,
          partialDeletedCount: result.deletedCount,
        }),
      );
    } else {
      console.log(
        `[Cleanup] Completed successfully: ${result.deletedCount} tasks deleted in ${durationMs}ms`,
      );

      sendWebhookAsync(
        createCleanupCompletedPayload({
          deletedCount: result.deletedCount,
          retentionDays: cleanupConfig.retentionDays,
          durationMs,
        }),
      );
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Cleanup] Failed with error: ${errorMessage}`);

    sendWebhookAsync(
      createCleanupFailedPayload({
        retentionDays: cleanupConfig.retentionDays,
        errorMessage,
        partialDeletedCount: 0,
      }),
    );
  }
}

/**
 * Initializes the scheduled cleanup job.
 * Only runs when cleanup is enabled (official demo mode).
 */
export function initScheduledCleanup(): void {
  if (!cleanupConfig.enabled) {
    console.log(
      '[Cleanup] Scheduled cleanup disabled (not in official demo mode)',
    );
    return;
  }

  if (scheduledTask) {
    console.log('[Cleanup] Scheduled cleanup already initialized');
    return;
  }

  scheduledTask = cron.schedule(cleanupConfig.cronSchedule, runCleanup, {
    timezone: 'UTC',
  });

  console.log(
    `[Cleanup] Scheduled cleanup initialized (retention: ${cleanupConfig.retentionDays} days, schedule: ${cleanupConfig.cronSchedule} UTC)`,
  );
}

/**
 * Stops the scheduled cleanup job.
 */
export function stopScheduledCleanup(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[Cleanup] Scheduled cleanup stopped');
  }
}
