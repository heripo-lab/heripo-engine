import type { NextRequest } from 'next/server';

import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'fs';
import { NextResponse } from 'next/server';
import { pipeline } from 'stream/promises';

import {
  extractBearerToken,
  verifyUploadSessionToken,
} from '~/lib/auth/upload-session';
import { createTask } from '~/lib/db/repositories/task-repository';
import {
  getUploadSessionById,
  isAllChunksReceived,
  updateUploadSessionStatus,
} from '~/lib/db/repositories/upload-session-repository';
import { paths } from '~/lib/paths';
import { TaskQueueManager } from '~/lib/queue/task-queue-manager';
import { runTaskWorker } from '~/lib/queue/task-worker';
import { extractClientInfo } from '~/lib/utils/request-info';
import { createTaskStartedPayload, sendWebhookAsync } from '~/lib/webhook';

function generateTaskId(): string {
  return `task_${crypto.randomUUID()}`;
}

async function mergeChunks(
  uploadId: string,
  totalChunks: number,
  outputPath: string,
): Promise<void> {
  const uploadPaths = paths.upload(uploadId);
  const writeStream = createWriteStream(outputPath);

  try {
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = uploadPaths.chunk(i);
      const readStream = createReadStream(chunkPath);
      await pipeline(readStream, writeStream, { end: false });
    }
    writeStream.end();
  } catch (error) {
    writeStream.destroy();
    throw error;
  }
}

function verifyPdfHeader(filePath: string): boolean {
  const buffer = readFileSync(filePath, { flag: 'r' });
  // PDF files start with "%PDF-"
  const header = buffer.slice(0, 5).toString('ascii');
  return header === '%PDF-';
}

export async function POST(request: NextRequest) {
  try {
    const clientInfo = extractClientInfo(request);

    // Extract and verify JWT token
    const authHeader = request.headers.get('authorization');
    const token = extractBearerToken(authHeader);

    if (!token) {
      return NextResponse.json(
        {
          error: 'Authorization header with Bearer token required',
          code: 'UNAUTHORIZED',
        },
        { status: 401 },
      );
    }

    const verifyResult = await verifyUploadSessionToken(token, clientInfo.ip);

    if (!verifyResult.valid) {
      return NextResponse.json(
        {
          error: verifyResult.message,
          code: verifyResult.error,
        },
        { status: verifyResult.error === 'EXPIRED' ? 401 : 403 },
      );
    }

    const { payload } = verifyResult;

    // Check upload session exists
    const uploadSession = getUploadSessionById(payload.uploadId);

    if (!uploadSession) {
      return NextResponse.json(
        {
          error: 'Upload session not found',
          code: 'SESSION_NOT_FOUND',
        },
        { status: 404 },
      );
    }

    if (uploadSession.status !== 'uploading') {
      return NextResponse.json(
        {
          error: `Upload session is ${uploadSession.status}`,
          code: 'SESSION_INVALID_STATUS',
        },
        { status: 400 },
      );
    }

    // Check session expiration
    if (new Date(uploadSession.expiresAt) < new Date()) {
      return NextResponse.json(
        {
          error: 'Upload session has expired',
          code: 'SESSION_EXPIRED',
        },
        { status: 401 },
      );
    }

    // Check all chunks are received
    if (!isAllChunksReceived(payload.uploadId)) {
      const receivedCount = uploadSession.receivedChunks.length;
      return NextResponse.json(
        {
          error: `Not all chunks received. Got ${receivedCount}/${payload.totalChunks}`,
          code: 'INCOMPLETE_UPLOAD',
          receivedChunks: receivedCount,
          totalChunks: payload.totalChunks,
        },
        { status: 400 },
      );
    }

    // Create task directory
    const taskId = generateTaskId();
    const taskPaths = paths.task(taskId);

    if (!existsSync(taskPaths.root)) {
      mkdirSync(taskPaths.root, { recursive: true });
    }

    // Merge chunks into final PDF
    await mergeChunks(
      payload.uploadId,
      payload.totalChunks,
      taskPaths.inputPdf,
    );

    // Verify PDF header
    if (!verifyPdfHeader(taskPaths.inputPdf)) {
      // Clean up task directory
      rmSync(taskPaths.root, { recursive: true, force: true });

      return NextResponse.json(
        {
          error: 'Merged file is not a valid PDF',
          code: 'INVALID_PDF',
        },
        { status: 400 },
      );
    }

    // Mark upload session as completed
    updateUploadSessionStatus(payload.uploadId, 'completed');

    // Clean up chunk directory
    const uploadPaths = paths.upload(payload.uploadId);
    rmSync(uploadPaths.root, { recursive: true, force: true });

    // Create task record in database
    const task = createTask({
      id: taskId,
      sessionId: uploadSession.sessionId,
      originalFilename: uploadSession.filename,
      filePath: taskPaths.inputPdf,
      options: uploadSession.options,
      clientIp: clientInfo.ip,
      userAgent: request.headers.get('user-agent') || 'unknown',
      isOtpBypass: uploadSession.isOtpBypass,
    });

    // Set up worker factory if not already set
    const queueManager = TaskQueueManager.getInstance();
    queueManager.setWorkerFactory(runTaskWorker);

    // Enqueue task
    await queueManager.enqueue({
      taskId,
      options: uploadSession.options,
      filePath: taskPaths.inputPdf,
      addedAt: new Date(),
      sessionId: uploadSession.sessionId,
      clientIP: clientInfo.ip,
      userAgent: request.headers.get('user-agent') || 'unknown',
      filename: uploadSession.filename,
    });

    // Send webhook for task started
    sendWebhookAsync(
      createTaskStartedPayload({
        ...clientInfo,
        taskId,
        sessionId: uploadSession.sessionId,
        filename: uploadSession.filename,
        otpMode: uploadSession.isOtpBypass,
      }),
    );

    return NextResponse.json({
      taskId: task.id,
      status: task.status,
      createdAt: task.createdAt,
      streamUrl: `/api/tasks/${task.id}/stream`,
    });
  } catch (error) {
    console.error('Error completing upload:', error);
    return NextResponse.json(
      { error: 'Failed to complete upload' },
      { status: 500 },
    );
  }
}
