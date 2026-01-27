import type { NextRequest } from 'next/server';

import { existsSync, readFileSync } from 'fs';
import { NextResponse } from 'next/server';
import { dirname, join, resolve } from 'path';

import { getTaskByIdForSession } from '~/lib/db/repositories/task-repository';
import { getOrCreateSessionId } from '~/lib/session';
import {
  createValidationErrorResponse,
  pageRouteParamsSchema,
  parseRouteParams,
} from '~/lib/validations';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string; pageIndex: string }> },
) {
  try {
    const sessionId = await getOrCreateSessionId();
    const rawParams = await params;

    const validation = parseRouteParams(rawParams, pageRouteParamsSchema);
    if (!validation.success) {
      return createValidationErrorResponse(validation.error);
    }

    const { taskId, pageIndex } = validation.data;
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

    // Use the same directory as processedResultPath (output folder)
    const taskDir = dirname(task.processedResultPath);
    const pagePath = join(taskDir, 'pages', `page_${pageIndex}.png`);

    // Validate page path to prevent path traversal attacks
    const resolvedPath = resolve(pagePath);
    const expectedDir = resolve(taskDir, 'pages');
    if (!resolvedPath.startsWith(expectedDir + '/')) {
      return NextResponse.json({ error: 'Invalid page path' }, { status: 403 });
    }

    if (!existsSync(resolvedPath)) {
      return NextResponse.json(
        { error: 'Page image not found' },
        { status: 404 },
      );
    }

    const imageBuffer = readFileSync(resolvedPath);

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Error serving page image:', error);
    return NextResponse.json(
      { error: 'Failed to serve page image' },
      { status: 500 },
    );
  }
}
