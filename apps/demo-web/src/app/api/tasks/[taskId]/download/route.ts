import type { NextRequest } from 'next/server';

import archiver from 'archiver';
import { existsSync, statSync } from 'fs';
import { NextResponse } from 'next/server';
import { dirname, join } from 'path';
import { Readable } from 'stream';

import { getTaskByIdForSession } from '~/lib/db/repositories/task-repository';
import { getOrCreateSessionId } from '~/lib/session';
import {
  createValidationErrorResponse,
  parseRouteParams,
  taskRouteParamsSchema,
} from '~/lib/validations';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const sessionId = await getOrCreateSessionId();
    const rawParams = await params;

    const validation = parseRouteParams(rawParams, taskRouteParamsSchema);
    if (!validation.success) {
      return createValidationErrorResponse(validation.error);
    }

    const { taskId } = validation.data;
    const task = getTaskByIdForSession(taskId, sessionId);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (task.status !== 'completed') {
      return NextResponse.json(
        { error: 'Task is not completed yet', status: task.status },
        { status: 400 },
      );
    }

    if (!task.processedResultPath || !existsSync(task.processedResultPath)) {
      return NextResponse.json(
        { error: 'Result file not found' },
        { status: 404 },
      );
    }

    const taskDir = dirname(task.processedResultPath);
    const imagesDir = join(taskDir, 'images');
    const pagesDir = join(taskDir, 'pages');

    const archive = archiver('zip', {
      zlib: { level: 6 },
    });

    archive.file(task.processedResultPath, { name: 'result-processed.json' });

    if (existsSync(imagesDir) && statSync(imagesDir).isDirectory()) {
      archive.directory(imagesDir, 'images');
    }

    if (existsSync(pagesDir) && statSync(pagesDir).isDirectory()) {
      archive.directory(pagesDir, 'pages');
    }

    archive.finalize();

    const webStream = Readable.toWeb(archive) as ReadableStream<Uint8Array>;

    const sanitizedFilename = task.originalFilename
      .replace('.pdf', '')
      .replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
    const zipFilename = `${sanitizedFilename}-all.zip`;

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(zipFilename)}"`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Error creating download:', error);
    return NextResponse.json(
      { error: 'Failed to create download' },
      { status: 500 },
    );
  }
}
