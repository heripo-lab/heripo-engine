import type { NextRequest } from 'next/server';

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { NextResponse } from 'next/server';

import { enforcePublicDemoGuards } from '~/lib/api/public-demo-guard';
import { toTaskApiResponse } from '~/lib/api/task-response';
import { createTask, listTasks } from '~/lib/db/repositories/task-repository';
import { paths } from '~/lib/paths';
import { runTaskWorker } from '~/lib/queue/task-dispatcher';
import { TaskQueueManager } from '~/lib/queue/task-queue-manager';
import { getOrCreateSessionId } from '~/lib/session';
import { extractClientInfo } from '~/lib/utils/request-info';
import {
  createValidationErrorResponse,
  parseQueryParams,
  processingOptionsSchema,
  taskListQuerySchema,
} from '~/lib/validations';
import { createTaskStartedPayload, sendWebhookAsync } from '~/lib/webhook';

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

    // Reject large files (>= 5MB) - they should use chunked upload
    const CHUNKED_UPLOAD_THRESHOLD = 5 * 1024 * 1024; // 5MB
    if (file.size >= CHUNKED_UPLOAD_THRESHOLD) {
      return NextResponse.json(
        {
          error:
            'Files 5MB or larger must use chunked upload. Please use /api/upload/session to initiate a chunked upload.',
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

    // OTP bypass: use user-provided options instead of defaults
    if (isPublicMode && guardResult.isOtpBypass) {
      options = optionsValidation.data;
    }

    // Track if OTP bypass was used (for backwards compatibility)
    const otpMode = guardResult.isOtpBypass;

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
      kind: 'raw-data',
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
      kind: 'raw-data',
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
      tasks: result.tasks.map(toTaskApiResponse),
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
