import type { NextRequest } from 'next/server';

import { getLogsByTaskId } from '~/lib/db/repositories/log-repository';
import {
  getTaskById,
  getTaskByIdForSession,
} from '~/lib/db/repositories/task-repository';
import { TaskQueueManager } from '~/lib/queue/task-queue-manager';
import type { SSEEvent } from '~/lib/queue/task-queue-manager';
import { getOrCreateSessionId } from '~/lib/session';
import {
  createValidationErrorResponse,
  parseRouteParams,
  taskRouteParamsSchema,
} from '~/lib/validations';

const POLL_INTERVAL_MS = 100;
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

function createSSEMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const sessionId = await getOrCreateSessionId();
  const rawParams = await params;

  const validation = parseRouteParams(rawParams, taskRouteParamsSchema);
  if (!validation.success) {
    return createValidationErrorResponse(validation.error);
  }

  const { taskId } = validation.data;
  const task = getTaskByIdForSession(taskId, sessionId);
  if (!task) {
    return new Response('Task not found', { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let lastLogId = 0;
      let lastStatus = '';
      let lastProgress = -1;
      let lastStep = '';
      let isTerminal = false;
      let pollInterval: NodeJS.Timeout | null = null;

      const sendEvent = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(createSSEMessage(event, data)));
        } catch {
          // Stream may be closed
        }
      };

      const cleanup = () => {
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      };

      // Send initial state from DB
      const initialTask = getTaskById(taskId);
      if (initialTask) {
        sendEvent('status', {
          status: initialTask.status,
          currentStep: initialTask.currentStep || '',
          progress: initialTask.progressPercent ?? 0,
        });
        lastStatus = initialTask.status;
        lastProgress = initialTask.progressPercent ?? 0;
        lastStep = initialTask.currentStep || '';

        // Send existing logs
        const logs = getLogsByTaskId(taskId);
        for (const log of logs) {
          sendEvent('log', {
            id: log.id,
            level: log.level,
            message: log.message,
            timestamp: log.timestamp,
          });
          lastLogId = Math.max(lastLogId, log.id);
        }

        // Check if already terminal
        if (TERMINAL_STATUSES.includes(initialTask.status)) {
          if (initialTask.status === 'completed') {
            sendEvent('complete', { resultUrl: `/api/tasks/${taskId}/result` });
          } else if (initialTask.status === 'failed') {
            sendEvent('error', {
              code: initialTask.errorCode || 'UNKNOWN_ERROR',
              message: initialTask.errorMessage || 'Unknown error',
            });
          }
          controller.close();
          return;
        }
      }

      // Subscribe to real-time events from worker
      const queueManager = TaskQueueManager.getInstance();
      const unsubscribe = queueManager.subscribe(taskId, (event: SSEEvent) => {
        sendEvent(event.type, event.data);

        // Track for deduplication
        if (event.type === 'status') {
          const data = event.data as {
            status: string;
            currentStep?: string;
            progress?: number;
          };
          lastStatus = data.status;
          if (data.currentStep) lastStep = data.currentStep;
          if (data.progress !== undefined) lastProgress = data.progress;
        } else if (event.type === 'progress') {
          const data = event.data as { step: string; percent: number };
          lastStep = data.step;
          lastProgress = data.percent;
        }
        // Note: 'log' events don't need tracking - deduplication happens via lastLogId in polling

        // Handle terminal events
        if (event.type === 'complete' || event.type === 'error') {
          isTerminal = true;
          cleanup();
          unsubscribe();
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      });

      // Polling backup for missed events (e.g., if subscription misses something)
      pollInterval = setInterval(() => {
        if (isTerminal) {
          cleanup();
          return;
        }

        // Check for new logs from DB
        const newLogs = getLogsByTaskId(taskId, { afterId: lastLogId });
        for (const log of newLogs) {
          sendEvent('log', {
            id: log.id,
            level: log.level,
            message: log.message,
            timestamp: log.timestamp,
          });
          lastLogId = Math.max(lastLogId, log.id);
        }

        // Check for status/progress changes from DB
        const currentTask = getTaskById(taskId);
        if (currentTask) {
          const statusChanged = currentTask.status !== lastStatus;
          const progressChanged =
            (currentTask.progressPercent ?? 0) !== lastProgress;
          const stepChanged = (currentTask.currentStep || '') !== lastStep;

          if (statusChanged || progressChanged || stepChanged) {
            sendEvent('status', {
              status: currentTask.status,
              currentStep: currentTask.currentStep || '',
              progress: currentTask.progressPercent ?? 0,
            });
            lastStatus = currentTask.status;
            lastProgress = currentTask.progressPercent ?? 0;
            lastStep = currentTask.currentStep || '';
          }

          // Handle terminal status
          if (TERMINAL_STATUSES.includes(currentTask.status)) {
            isTerminal = true;
            if (currentTask.status === 'completed') {
              sendEvent('complete', {
                resultUrl: `/api/tasks/${taskId}/result`,
              });
            } else if (currentTask.status === 'failed') {
              sendEvent('error', {
                code: currentTask.errorCode || 'UNKNOWN_ERROR',
                message: currentTask.errorMessage || 'Unknown error',
              });
            }
            cleanup();
            unsubscribe();
            try {
              controller.close();
            } catch {
              // Already closed
            }
          }
        }
      }, POLL_INTERVAL_MS);

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        cleanup();
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
