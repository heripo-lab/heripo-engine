import type { NextRequest } from 'next/server';

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { NextResponse } from 'next/server';

import { verifyTOTP } from '~/lib/auth/totp';
import { isTurnstileTokenValid } from '~/lib/auth/turnstile';
import {
  canAttemptOTP,
  recordOTPAttempt,
} from '~/lib/db/repositories/otp-lockout-repository';
import { createTask, listTasks } from '~/lib/db/repositories/task-repository';
import { getUsageStatus } from '~/lib/db/repositories/usage-repository';
import { paths } from '~/lib/paths';
import { TaskQueueManager } from '~/lib/queue/task-queue-manager';
import { runTaskWorker } from '~/lib/queue/task-worker';
import { getOrCreateSessionId } from '~/lib/session';
import { extractClientInfo } from '~/lib/utils/request-info';
import {
  createValidationErrorResponse,
  parseQueryParams,
  processingOptionsSchema,
  taskListQuerySchema,
} from '~/lib/validations';
import {
  createOTPFailedPayload,
  createOTPLockedPayload,
  createRateLimitExceededPayload,
  createTaskStartedPayload,
  sendWebhookAsync,
} from '~/lib/webhook';

import { DEFAULT_FORM_VALUES } from '~/features/upload/types/form-values';
import type { ProcessingOptions } from '~/features/upload/types/form-values';

function generateTaskId(): string {
  return `task_${crypto.randomUUID()}`;
}

export async function POST(request: NextRequest) {
  try {
    const sessionId = await getOrCreateSessionId();
    const clientInfo = extractClientInfo(request);
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const optionsJson = formData.get('options') as string | null;
    const bypassCode = formData.get('bypassCode') as string | null;
    const turnstileToken = formData.get('turnstileToken') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type (PDF only)
    if (file.type !== 'application/pdf') {
      return NextResponse.json(
        { error: 'Only PDF files are supported' },
        { status: 415 },
      );
    }

    // Validate file size (max 2GB)
    const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File size exceeds 2GB limit' },
        { status: 413 },
      );
    }

    // Reject large files (>= 50MB) - they should use chunked upload
    const CHUNKED_UPLOAD_THRESHOLD = 50 * 1024 * 1024; // 50MB
    if (file.size >= CHUNKED_UPLOAD_THRESHOLD) {
      return NextResponse.json(
        {
          error:
            'Files 50MB or larger must use chunked upload. Please use /api/upload/session to initiate a chunked upload.',
          code: 'FILE_TOO_LARGE_FOR_DIRECT_UPLOAD',
          fileSize: file.size,
          threshold: CHUNKED_UPLOAD_THRESHOLD,
        },
        { status: 413 },
      );
    }

    // Public mode: enforce rate limiting and default options
    const isPublicMode = process.env.NEXT_PUBLIC_PUBLIC_MODE === 'true';

    // Parse and validate options (common for both modes)
    if (!optionsJson) {
      return NextResponse.json(
        { error: 'No options provided' },
        { status: 400 },
      );
    }

    let parsedOptions: unknown;
    try {
      parsedOptions = JSON.parse(optionsJson);
    } catch {
      return NextResponse.json(
        { error: 'Invalid options JSON' },
        { status: 400 },
      );
    }

    const optionsValidation = processingOptionsSchema.safeParse(parsedOptions);
    if (!optionsValidation.success) {
      return createValidationErrorResponse(optionsValidation.error);
    }

    let options: ProcessingOptions;
    if (isPublicMode) {
      const { file: _, ...defaultOptions } = DEFAULT_FORM_VALUES;
      options = defaultOptions;
    } else {
      options = optionsValidation.data;
    }

    // Public mode: OTP-first verification to avoid Turnstile timing issues
    let isOtpBypass = false;
    if (isPublicMode) {
      if (bypassCode) {
        // Step 1: bypassCode provided - verify OTP first (skip Turnstile)
        const identifier = 'global';
        const attemptCheck = canAttemptOTP(identifier);
        if (!attemptCheck.allowed) {
          sendWebhookAsync(
            createOTPLockedPayload({
              ...clientInfo,
              filename: file.name,
            }),
          );

          return NextResponse.json(
            {
              error: attemptCheck.reason,
              code: 'OTP_PERMANENTLY_LOCKED',
            },
            { status: 403 },
          );
        }

        const isValid = verifyTOTP(bypassCode);
        recordOTPAttempt(identifier, isValid);

        if (!isValid) {
          const updatedCheck = canAttemptOTP(identifier);
          const remainingAttempts = updatedCheck.remainingAttempts ?? 0;

          if (remainingAttempts > 0) {
            sendWebhookAsync(
              createOTPFailedPayload({
                ...clientInfo,
                filename: file.name,
                remainingAttempts,
              }),
            );
          } else {
            sendWebhookAsync(
              createOTPLockedPayload({
                ...clientInfo,
                filename: file.name,
              }),
            );
          }

          return NextResponse.json(
            {
              error:
                remainingAttempts > 0
                  ? `Invalid bypass code. ${remainingAttempts} ${remainingAttempts === 1 ? 'attempt' : 'attempts'} remaining.`
                  : 'Invalid bypass code. Your access has been permanently blocked.',
              code: remainingAttempts > 0 ? 'INVALID_OTP' : 'OTP_LOCKED',
              remainingAttempts,
            },
            { status: remainingAttempts > 0 ? 401 : 403 },
          );
        }

        // OTP passed - skip Turnstile
        isOtpBypass = true;

        // OTP bypass: use user-provided options instead of defaults
        options = optionsValidation.data;
      } else {
        // Step 2: No bypassCode - require Turnstile
        if (!turnstileToken) {
          return NextResponse.json(
            {
              error: 'Turnstile verification required',
              code: 'INVALID_TURNSTILE',
            },
            { status: 400 },
          );
        }

        const isValidTurnstile = await isTurnstileTokenValid(turnstileToken);
        if (!isValidTurnstile) {
          return NextResponse.json(
            {
              error: 'Turnstile verification failed',
              code: 'INVALID_TURNSTILE',
            },
            { status: 400 },
          );
        }

        // Step 3: Check rate limit (only for non-OTP users)
        const usageStatus = getUsageStatus();
        if (!usageStatus.canCreate) {
          sendWebhookAsync(
            createRateLimitExceededPayload({
              ...clientInfo,
              filename: file.name,
              dailyLimit: usageStatus.dailyLimit,
              todayCompleted: usageStatus.todayCompleted,
            }),
          );

          return NextResponse.json(
            {
              error: usageStatus.reason,
              code: 'RATE_LIMIT_EXCEEDED',
            },
            { status: 429 },
          );
        }
      }
    }

    // Track if OTP bypass was used (for backwards compatibility)
    const otpMode = isOtpBypass;

    const taskId = generateTaskId();
    const taskPaths = paths.task(taskId);

    // Create task directory
    if (!existsSync(taskPaths.root)) {
      mkdirSync(taskPaths.root, { recursive: true });
    }

    // Save uploaded file
    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(taskPaths.inputPdf, buffer);

    // Create task record in database
    const task = createTask({
      id: taskId,
      sessionId,
      originalFilename: file.name,
      filePath: taskPaths.inputPdf,
      options,
      clientIp: clientInfo.ip,
      userAgent: clientInfo.userAgent,
      isOtpBypass: otpMode,
    });

    // Set up worker factory if not already set
    const queueManager = TaskQueueManager.getInstance();
    queueManager.setWorkerFactory(runTaskWorker);

    // Enqueue task (processQueue is called internally by enqueue)
    await queueManager.enqueue({
      taskId,
      options,
      filePath: taskPaths.inputPdf,
      addedAt: new Date(),
      sessionId,
      clientIP: clientInfo.ip,
      userAgent: clientInfo.userAgent,
      filename: file.name,
      isOtpBypass: otpMode,
    });

    // Send webhook for task started
    sendWebhookAsync(
      createTaskStartedPayload({
        ...clientInfo,
        taskId,
        sessionId,
        filename: file.name,
        otpMode,
      }),
    );

    return NextResponse.json({
      taskId: task.id,
      status: task.status,
      createdAt: task.createdAt,
      streamUrl: `/api/tasks/${task.id}/stream`,
    });
  } catch (error) {
    console.error('Error creating task:', error);
    return NextResponse.json(
      { error: 'Failed to create task' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const sessionId = await getOrCreateSessionId();

    const validation = parseQueryParams(
      request.nextUrl.searchParams,
      taskListQuerySchema,
    );
    if (!validation.success) {
      return createValidationErrorResponse(validation.error);
    }

    const { limit, offset, status } = validation.data;

    const result = listTasks({
      limit,
      offset,
      status: status || undefined,
      sessionId,
    });

    return NextResponse.json({
      tasks: result.tasks,
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error listing tasks:', error);
    return NextResponse.json(
      { error: 'Failed to list tasks' },
      { status: 500 },
    );
  }
}
