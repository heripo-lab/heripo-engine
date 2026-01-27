import type { NextRequest } from 'next/server';

import { rmSync } from 'fs';
import { NextResponse } from 'next/server';

import { sampleTaskConfig } from '~/lib/config/public-mode';
import { deleteLogsByTaskId } from '~/lib/db/repositories/log-repository';
import {
  deleteTask,
  getTaskByIdForSession,
} from '~/lib/db/repositories/task-repository';
import { paths } from '~/lib/paths';
import { TaskQueueManager } from '~/lib/queue/task-queue-manager';
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

    const queueManager = TaskQueueManager.getInstance();
    const position = queueManager.getQueuePosition(taskId);

    return NextResponse.json({
      ...task,
      queuePosition: position > 0 ? position : undefined,
    });
  } catch (error) {
    console.error('Error getting task:', error);
    return NextResponse.json({ error: 'Failed to get task' }, { status: 500 });
  }
}

export async function DELETE(
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

    // Prevent sample task deletion unless explicitly allowed
    if (task.isSample && !sampleTaskConfig.allowDeletion) {
      return NextResponse.json(
        { error: 'Sample tasks cannot be deleted' },
        { status: 403 },
      );
    }

    // Cancel if still in queue or running
    if (task.status === 'queued' || task.status === 'running') {
      const queueManager = TaskQueueManager.getInstance();
      queueManager.cancelTask(taskId);
    }

    // Delete task files (both data/tasks and output directories)
    const taskPaths = paths.task(taskId);
    try {
      rmSync(taskPaths.root, { recursive: true, force: true });
    } catch {
      // Ignore file deletion errors
    }
    try {
      rmSync(taskPaths.outputRoot, { recursive: true, force: true });
    } catch {
      // Ignore file deletion errors
    }

    // Delete logs
    deleteLogsByTaskId(taskId);

    // Delete task record
    const result = deleteTask(taskId);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting task:', error);
    return NextResponse.json(
      { error: 'Failed to delete task' },
      { status: 500 },
    );
  }
}
