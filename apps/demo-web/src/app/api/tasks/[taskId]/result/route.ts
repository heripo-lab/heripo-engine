import type { NextRequest } from 'next/server';

import { existsSync, readFileSync } from 'fs';
import { NextResponse } from 'next/server';

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

    const resultJson = readFileSync(task.processedResultPath, 'utf8');
    const result = JSON.parse(resultJson);

    return NextResponse.json({
      task: {
        id: task.id,
        originalFilename: task.originalFilename,
        status: task.status,
        isSample: task.isSample,
        totalPages: task.totalPages,
        chaptersCount: task.chaptersCount,
        imagesCount: task.imagesCount,
        tablesCount: task.tablesCount,
        tokenUsage: task.tokenUsage,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
      },
      result,
    });
  } catch (error) {
    console.error('Error getting result:', error);
    return NextResponse.json(
      { error: 'Failed to get result' },
      { status: 500 },
    );
  }
}
