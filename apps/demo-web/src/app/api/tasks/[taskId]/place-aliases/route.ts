import type { NextRequest } from 'next/server';

import { NextResponse } from 'next/server';

import { publicModeConfig } from '~/lib/config/public-mode';
import { getTaskByIdForSession } from '~/lib/db/repositories/task-repository';
import {
  deletePlaceAliases,
  readPlaceAliases,
  savePlaceAliases,
} from '~/lib/ledger/place-aliases';
import { getOrCreateSessionId } from '~/lib/session';
import {
  createValidationErrorResponse,
  parseRouteParams,
  taskRouteParamsSchema,
} from '~/lib/validations';

type Context = { params: Promise<{ taskId: string }> };

async function resolveTask({ params }: Context) {
  const sessionId = await getOrCreateSessionId();
  const parsed = parseRouteParams(await params, taskRouteParamsSchema);
  if (!parsed.success)
    return { error: createValidationErrorResponse(parsed.error) };
  const task = getTaskByIdForSession(parsed.data.taskId, sessionId);
  if (!task || task.kind !== 'ledger' || task.status !== 'completed')
    return {
      error: NextResponse.json(
        { error: 'Completed ledger task not found' },
        { status: 404 },
      ),
    };
  if (publicModeConfig.isPublicMode)
    return {
      error: NextResponse.json(
        { error: 'Place aliases are available in local demo mode' },
        { status: 403 },
      ),
    };
  return { taskId: task.id };
}

export async function GET(_request: NextRequest, context: Context) {
  const task = await resolveTask(context);
  if (task.error) return task.error;
  return NextResponse.json({ table: readPlaceAliases(task.taskId!) });
}

/** Save a person-decided place alias table; it is validated against the task's plan and ledger first. */
export async function PUT(request: NextRequest, context: Context) {
  const task = await resolveTask(context);
  if (task.error) return task.error;
  const table = await request.json().catch(() => null);
  if (!table || typeof table !== 'object')
    return NextResponse.json(
      { error: 'Invalid place aliases' },
      { status: 400 },
    );
  try {
    return NextResponse.json(savePlaceAliases(task.taskId!, table));
  } catch (error) {
    return NextResponse.json(
      {
        error: (error as Error).message,
        issues: (error as { issues?: string[] }).issues ?? [],
      },
      { status: 400 },
    );
  }
}

/** Remove the saved table. */
export async function DELETE(_request: NextRequest, context: Context) {
  const task = await resolveTask(context);
  if (task.error) return task.error;
  deletePlaceAliases(task.taskId!);
  return NextResponse.json({ table: null });
}
