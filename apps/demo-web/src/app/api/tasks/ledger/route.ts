import type { NextRequest } from 'next/server';

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { NextResponse } from 'next/server';

import { enforcePublicDemoGuards } from '~/lib/api/public-demo-guard';
import { createTask } from '~/lib/db/repositories/task-repository';
import {
  LEDGER_ERROR_CODES,
  LEDGER_INPUT_MAX_SIZE_BYTES,
  LedgerInputError,
  isAllowedLedgerInputFile,
  parseLedgerInputText,
} from '~/lib/ledger/ledger-input';
import { paths } from '~/lib/paths';
import { runTaskWorker } from '~/lib/queue/task-dispatcher';
import { TaskQueueManager } from '~/lib/queue/task-queue-manager';
import { getOrCreateSessionId } from '~/lib/session';
import { extractClientInfo } from '~/lib/utils/request-info';
import { createTaskStartedPayload, sendWebhookAsync } from '~/lib/webhook';

function generateTaskId(): string {
  return `task_${crypto.randomUUID()}`;
}

/**
 * Creates a ledger extraction task from a single processed-document.json
 * upload. Unlike PDF tasks, ledger tasks have no processing options; the
 * same public-demo protections (Turnstile, OTP bypass, weekly lockout,
 * rate limit, session isolation) apply.
 */
export async function POST(request: NextRequest) {
  try {
    const sessionId = await getOrCreateSessionId();
    const clientInfo = extractClientInfo(request);
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const bypassCode = formData.get('bypassCode') as string | null;
    const turnstileToken = formData.get('turnstileToken') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Step 1: file extension and MIME type (single JSON file only, no ZIP)
    if (!isAllowedLedgerInputFile(file)) {
      return NextResponse.json(
        {
          error:
            'Only a single processed-document.json file is supported for ledger extraction',
          code: LEDGER_ERROR_CODES.INVALID_LEDGER_INPUT_TYPE,
        },
        { status: 415 },
      );
    }

    // Step 2: file size limit (applied before any JSON parsing)
    if (file.size > LEDGER_INPUT_MAX_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: `File size exceeds ${LEDGER_INPUT_MAX_SIZE_BYTES / (1024 * 1024)}MB limit`,
          code: LEDGER_ERROR_CODES.LEDGER_INPUT_TOO_LARGE,
          fileSize: file.size,
          maxSize: LEDGER_INPUT_MAX_SIZE_BYTES,
        },
        { status: 413 },
      );
    }

    // Public demo protections shared with the PDF task API
    const guardResult = await enforcePublicDemoGuards({
      sessionId,
      clientInfo,
      filename: file.name,
      bypassCode,
      turnstileToken,
    });
    if (!guardResult.ok) {
      return guardResult.response;
    }
    const isOtpBypass = guardResult.isOtpBypass;

    // Step 3-5: UTF-8 read, JSON parse, ProcessedDocument runtime validation
    const rawText = await file.text();
    try {
      parseLedgerInputText(rawText);
    } catch (error) {
      if (error instanceof LedgerInputError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          {
            status: error.code === LEDGER_ERROR_CODES.INVALID_JSON ? 400 : 422,
          },
        );
      }
      throw error;
    }

    // Step 6: create the ledger task
    const taskId = generateTaskId();
    const taskPaths = paths.task(taskId);

    if (!existsSync(taskPaths.root)) {
      mkdirSync(taskPaths.root, { recursive: true });
    }
    writeFileSync(taskPaths.inputJson, rawText, 'utf8');

    const task = createTask({
      id: taskId,
      kind: 'ledger',
      sessionId,
      originalFilename: file.name,
      filePath: taskPaths.inputJson,
      options: null,
      clientIp: clientInfo.ip,
      userAgent: clientInfo.userAgent,
      isOtpBypass,
    });

    // Step 7: enqueue; the dispatcher runs the ledger worker by task kind
    const queueManager = TaskQueueManager.getInstance();
    queueManager.setWorkerFactory(runTaskWorker);

    await queueManager.enqueue({
      kind: 'ledger',
      taskId,
      filePath: taskPaths.inputJson,
      addedAt: new Date(),
      sessionId,
      clientIP: clientInfo.ip,
      userAgent: clientInfo.userAgent,
      filename: file.name,
      isOtpBypass,
    });

    sendWebhookAsync(
      createTaskStartedPayload({
        ...clientInfo,
        taskId,
        sessionId,
        filename: file.name,
        otpMode: isOtpBypass,
      }),
    );

    return NextResponse.json({
      taskId: task.id,
      status: task.status,
      createdAt: task.createdAt,
      streamUrl: `/api/tasks/${task.id}/stream`,
    });
  } catch (error) {
    console.error('Error creating ledger task:', error);
    return NextResponse.json(
      { error: 'Failed to create ledger task' },
      { status: 500 },
    );
  }
}
