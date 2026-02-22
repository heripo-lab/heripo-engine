import { EventEmitter } from 'events';

import type { ProcessingOptions } from '~/features/upload';

import {
  getQueuedTasks,
  getRunningTasksCount,
  getTaskById,
  updateTaskStatus,
} from '../db/repositories/task-repository';
import { createTaskCancelledPayload, sendWebhookAsync } from '../webhook';

export interface QueuedTask {
  taskId: string;
  options: ProcessingOptions;
  filePath: string;
  addedAt: Date;
  // Fields for webhook
  sessionId: string;
  clientIP: string;
  userAgent: string;
  filename: string;
}

export type SSEEventType =
  | 'status'
  | 'progress'
  | 'log'
  | 'complete'
  | 'error'
  | 'vlm-fallback';

export interface SSEStatusEvent {
  type: 'status';
  data: { status: string; position?: number };
}

export interface SSEProgressEvent {
  type: 'progress';
  data: { step: string; percent: number; duration?: number };
}

export interface SSELogEvent {
  type: 'log';
  data: { id: number; level: string; message: string; timestamp: string };
}

export interface SSECompleteEvent {
  type: 'complete';
  data: { resultUrl: string };
}

export interface SSEErrorEvent {
  type: 'error';
  data: { code: string; message: string };
}

export interface SSEVlmFallbackEvent {
  type: 'vlm-fallback';
  data: { reason: string };
}

export type SSEEvent =
  | SSEStatusEvent
  | SSEProgressEvent
  | SSELogEvent
  | SSECompleteEvent
  | SSEErrorEvent
  | SSEVlmFallbackEvent;

type WorkerFactory = (
  task: QueuedTask,
  emitter: EventEmitter,
  abortSignal?: AbortSignal,
) => Promise<void>;

class TaskQueueManager {
  private static instance: TaskQueueManager | null = null;
  private queue: QueuedTask[] = [];
  private activeWorkers: Map<string, Promise<void>> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private readonly maxConcurrency: number;
  private readonly emitter = new EventEmitter();
  private workerFactory: WorkerFactory | null = null;

  private constructor(maxConcurrency = 3) {
    this.maxConcurrency = maxConcurrency;
    this.emitter.setMaxListeners(100);
    this.restoreQueueFromDatabase();
  }

  static getInstance(): TaskQueueManager {
    if (!TaskQueueManager.instance) {
      TaskQueueManager.instance = new TaskQueueManager(3);
    }
    return TaskQueueManager.instance;
  }

  setWorkerFactory(factory: WorkerFactory): void {
    this.workerFactory = factory;
  }

  private restoreQueueFromDatabase(): void {
    const queuedTasks = getQueuedTasks();
    for (const task of queuedTasks) {
      this.queue.push({
        taskId: task.id,
        options: task.options,
        filePath: task.filePath,
        addedAt: new Date(task.createdAt),
        sessionId: task.sessionId,
        clientIP: task.clientIp ?? 'unknown',
        userAgent: task.userAgent ?? 'unknown',
        filename: task.originalFilename,
      });
    }

    if (this.queue.length > 0) {
      console.log(
        `[TaskQueueManager] Restored ${this.queue.length} queued tasks from database`,
      );
    }
  }

  async enqueue(task: QueuedTask): Promise<void> {
    this.queue.push(task);

    const position = this.queue.length;
    this.emit(task.taskId, {
      type: 'status',
      data: { status: 'queued', position },
    });

    this.processQueue();
  }

  private processQueue(): void {
    if (!this.workerFactory) {
      console.warn('[TaskQueueManager] Worker factory not set');
      return;
    }

    // Use DB as source of truth for concurrency check
    const runningCount = getRunningTasksCount();
    if (runningCount >= this.maxConcurrency) {
      return;
    }

    const task = this.queue.shift();
    if (!task) {
      return;
    }

    // Edge case protection: skip if already being processed in-memory
    if (this.activeWorkers.has(task.taskId)) {
      console.warn(
        `[TaskQueueManager] Task ${task.taskId} already being processed`,
      );
      return;
    }

    const workerPromise = this.runWorker(task);
    this.activeWorkers.set(task.taskId, workerPromise);

    workerPromise.finally(() => {
      this.activeWorkers.delete(task.taskId);
      this.processQueue();
    });

    // Fill remaining slots
    if (
      this.activeWorkers.size < this.maxConcurrency &&
      this.queue.length > 0
    ) {
      this.processQueue();
    }
  }

  private async runWorker(task: QueuedTask): Promise<void> {
    if (!this.workerFactory) {
      throw new Error('Worker factory not set');
    }

    // Create abort controller for this task
    const abortController = new AbortController();
    this.abortControllers.set(task.taskId, abortController);

    try {
      updateTaskStatus(task.taskId, 'running', {
        startedAt: new Date().toISOString(),
      });

      this.emit(task.taskId, {
        type: 'status',
        data: { status: 'running' },
      });

      await this.workerFactory(task, this.emitter, abortController.signal);
    } catch (error) {
      // Check if it was an abort error - don't update to 'failed' if already cancelled
      if (abortController.signal.aborted) {
        console.log(`[TaskQueueManager] Task ${task.taskId} was aborted`);
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      updateTaskStatus(task.taskId, 'failed', {
        errorCode: 'WORKER_ERROR',
        errorMessage,
        completedAt: new Date().toISOString(),
      });

      this.emit(task.taskId, {
        type: 'error',
        data: { code: 'WORKER_ERROR', message: errorMessage },
      });
    } finally {
      // Cleanup abort controller
      this.abortControllers.delete(task.taskId);
    }
  }

  emit(taskId: string, event: SSEEvent): void {
    // Emit to current subscribers (no buffering - DB is source of truth)
    this.emitter.emit(`task:${taskId}`, event);
  }

  subscribe(taskId: string, callback: (event: SSEEvent) => void): () => void {
    // Subscribe to live events only (no replay - DB is source of truth)
    const handler = (event: SSEEvent) => callback(event);
    this.emitter.on(`task:${taskId}`, handler);
    return () => this.emitter.off(`task:${taskId}`, handler);
  }

  getQueuePosition(taskId: string): number {
    const index = this.queue.findIndex((t) => t.taskId === taskId);
    if (index === -1) {
      return this.activeWorkers.has(taskId) ? 0 : -1;
    }
    return index + 1;
  }

  getStatus(): {
    queueLength: number;
    activeCount: number;
    maxConcurrency: number;
  } {
    return {
      queueLength: this.queue.length,
      activeCount: this.activeWorkers.size,
      maxConcurrency: this.maxConcurrency,
    };
  }

  cancelTask(taskId: string): boolean {
    const index = this.queue.findIndex((t) => t.taskId === taskId);
    if (index !== -1) {
      const queuedTask = this.queue[index];
      this.queue.splice(index, 1);

      const taskRecord = getTaskById(taskId);
      updateTaskStatus(taskId, 'cancelled', {
        completedAt: new Date().toISOString(),
      });
      this.emit(taskId, {
        type: 'status',
        data: { status: 'cancelled' },
      });

      // Send webhook for cancelled task
      sendWebhookAsync(
        createTaskCancelledPayload({
          ip: queuedTask.clientIP,
          userAgent: queuedTask.userAgent,
          taskId,
          sessionId: queuedTask.sessionId,
          filename: queuedTask.filename,
          startedAt: taskRecord?.startedAt ?? null,
        }),
      );

      return true;
    }

    // Cancel running tasks by aborting the worker
    if (this.activeWorkers.has(taskId)) {
      const task = getTaskById(taskId);
      if (task) {
        // Abort the running worker
        const controller = this.abortControllers.get(taskId);
        if (controller) {
          console.log(`[TaskQueueManager] Aborting running task: ${taskId}`);
          controller.abort();
        }

        updateTaskStatus(taskId, 'cancelled', {
          completedAt: new Date().toISOString(),
        });
        this.emit(taskId, {
          type: 'status',
          data: { status: 'cancelled' },
        });

        // Send webhook for cancelled running task
        sendWebhookAsync(
          createTaskCancelledPayload({
            ip: task.clientIp ?? 'unknown',
            userAgent: task.userAgent ?? 'unknown',
            taskId,
            sessionId: task.sessionId,
            filename: task.originalFilename,
            startedAt: task.startedAt ?? null,
          }),
        );

        return true;
      }
    }

    return false;
  }

  startProcessing(): void {
    this.processQueue();
  }
}

export { TaskQueueManager };
