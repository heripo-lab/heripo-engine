import type { EventEmitter } from 'events';

import type { QueuedTask } from './task-queue-manager';

import { runLedgerTaskWorker } from './ledger-task-worker';
import { runRawDataTaskWorker } from './task-worker';

/**
 * Single worker factory for the task queue.
 *
 * The queue manager keeps exactly one worker factory, so every API route
 * registers this dispatcher and the per-kind branching happens here based
 * on the persisted task kind. Never swap the factory per request.
 */
export async function runTaskWorker(
  task: QueuedTask,
  emitter: EventEmitter,
  abortSignal?: AbortSignal,
): Promise<void> {
  switch (task.kind) {
    case 'raw-data':
      return runRawDataTaskWorker(task, emitter, abortSignal);

    case 'ledger':
      return runLedgerTaskWorker(task, emitter, abortSignal);
  }
}
