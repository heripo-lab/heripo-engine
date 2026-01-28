import { existsSync, rmSync } from 'fs';

import { cleanupConfig } from '~/lib/config/cleanup';
import { readDatabase, writeDatabase } from '~/lib/db';
import { paths } from '~/lib/paths';

export interface TaskCleanupResult {
  deletedCount: number;
  errors: Array<{ taskId: string; error: string }>;
}

/**
 * Gets the cutoff date for task deletion based on retention days.
 */
function getCutoffDate(): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - cleanupConfig.retentionDays);
  return cutoff;
}

/**
 * Cleans up expired non-sample tasks.
 * Deletes task input files, output files, and database records.
 */
export function cleanupExpiredTasks(): TaskCleanupResult {
  const result: TaskCleanupResult = {
    deletedCount: 0,
    errors: [],
  };

  const db = readDatabase();
  const cutoffDate = getCutoffDate();

  // Find expired non-sample tasks
  const expiredTasks = db.tasks.filter((task) => {
    if (task.is_sample) return false;
    const createdAt = new Date(task.created_at);
    return createdAt < cutoffDate;
  });

  if (expiredTasks.length === 0) {
    return result;
  }

  const expiredTaskIds = new Set(expiredTasks.map((t) => t.id));

  // Delete files for each expired task
  for (const task of expiredTasks) {
    try {
      const taskPaths = paths.task(task.id);

      // Delete task input directory (data/tasks/task_xxx)
      if (existsSync(taskPaths.root)) {
        rmSync(taskPaths.root, { recursive: true, force: true });
      }

      // Delete task output directory (output/task_xxx)
      if (existsSync(taskPaths.outputRoot)) {
        rmSync(taskPaths.outputRoot, { recursive: true, force: true });
      }

      result.deletedCount++;
    } catch (error) {
      result.errors.push({
        taskId: task.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Remove expired tasks and their logs from database (atomic write)
  db.tasks = db.tasks.filter((t) => !expiredTaskIds.has(t.id));
  db.logs = db.logs.filter((l) => !expiredTaskIds.has(l.task_id));
  writeDatabase(db);

  return result;
}
