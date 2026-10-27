import type { LedgerTaskOptions } from './ledger-task-options';

import { existsSync, mkdirSync, writeFileSync } from 'fs';

import { createTask } from '../db/repositories/task-repository';
import { paths } from '../paths';
import { runTaskWorker } from '../queue/task-dispatcher';
import { TaskQueueManager } from '../queue/task-queue-manager';
import { createTaskStartedPayload, sendWebhookAsync } from '../webhook';
import { ledgerOptionsFile } from './ledger-task-options';

/**
 * Create and enqueue a ledger task from a validated processed-document JSON text, in the caller's session.
 * The worker validates the input, writes the preview and then runs every ledger step with `options.modelId`.
 */
export async function createLedgerTask(input: {
  rawText: string;
  filename: string;
  sessionId: string;
  clientInfo: { ip: string; userAgent: string };
  isOtpBypass: boolean;
  options: LedgerTaskOptions;
}) {
  const taskId = `task_${crypto.randomUUID()}`;
  const taskPaths = paths.task(taskId);
  if (!existsSync(taskPaths.root))
    mkdirSync(taskPaths.root, { recursive: true });
  writeFileSync(taskPaths.inputJson, input.rawText, 'utf8');
  writeFileSync(
    ledgerOptionsFile(taskId),
    JSON.stringify(input.options, null, 2),
  );

  const task = createTask({
    id: taskId,
    kind: 'ledger',
    sessionId: input.sessionId,
    originalFilename: input.filename,
    filePath: taskPaths.inputJson,
    options: null,
    clientIp: input.clientInfo.ip,
    userAgent: input.clientInfo.userAgent,
    isOtpBypass: input.isOtpBypass,
  });

  // the dispatcher runs the ledger worker by task kind
  const queueManager = TaskQueueManager.getInstance();
  queueManager.setWorkerFactory(runTaskWorker);
  await queueManager.enqueue({
    kind: 'ledger',
    taskId,
    filePath: taskPaths.inputJson,
    addedAt: new Date(),
    sessionId: input.sessionId,
    clientIP: input.clientInfo.ip,
    userAgent: input.clientInfo.userAgent,
    filename: input.filename,
    isOtpBypass: input.isOtpBypass,
  });

  sendWebhookAsync(
    createTaskStartedPayload({
      ...input.clientInfo,
      taskId,
      sessionId: input.sessionId,
      filename: input.filename,
      otpMode: input.isOtpBypass,
    }),
  );
  return task;
}
