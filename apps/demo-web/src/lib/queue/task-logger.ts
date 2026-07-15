import type { EventEmitter } from 'events';

import type { SSEEvent } from './task-queue-manager';

import { createLog } from '../db/repositories/log-repository';

export interface TaskLoggerMethods {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface TaskLoggerContext {
  logger: TaskLoggerMethods;
  detectedSteps: Set<string>;
}

/**
 * Step auto-detection from log line prefixes.
 * The first log message starting with a prefix triggers onStepDetected once.
 */
export interface TaskLoggerStepDetection {
  stepPrefixes: Record<string, string>;
  onStepDetected: (stepId: string) => void;
}

export function maskFilePaths(message: string): string {
  return (
    message
      // file:// URL
      .replace(/file:\/\/[^\s]+/g, (match) => match.split('/').pop() || match)
      // Absolute paths (/Users, /var, /tmp, /home, ...)
      .replace(
        /\/(?:Users|var|tmp|home)[^\s]*/g,
        (match) => match.split('/').pop() || match,
      )
  );
}

/**
 * Creates a task-scoped logger that persists log lines to the DB and
 * forwards them to SSE subscribers. Shared by all task-kind workers.
 */
export function createTaskLogger(
  taskId: string,
  emitter: EventEmitter,
  stepDetection?: TaskLoggerStepDetection,
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
    if (stepDetection) {
      for (const [prefix, stepId] of Object.entries(
        stepDetection.stepPrefixes,
      )) {
        if (message.startsWith(prefix) && !detectedSteps.has(stepId)) {
          detectedSteps.add(stepId);
          stepDetection.onStepDetected(stepId);
          break;
        }
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
