import type { NextRequest } from 'next/server';

import { NextResponse } from 'next/server';

import { getTaskByIdForSession } from '~/lib/db/repositories/task-repository';
import { getArchaeologyLedger } from '~/lib/ledger/archaeology-ledger';
import { getOrCreateSessionId } from '~/lib/session';
import {
  createValidationErrorResponse,
  parseRouteParams,
  taskRouteParamsSchema,
} from '~/lib/validations';

type Context = { params: Promise<{ taskId: string }> };

/** The archaeology ledger assembled from the latest thin attachment run; null until one has a result. */
export async function GET(_request: NextRequest, { params }: Context) {
  const sessionId = await getOrCreateSessionId();
  const parsed = parseRouteParams(await params, taskRouteParamsSchema);
  if (!parsed.success) return createValidationErrorResponse(parsed.error);
  const task = getTaskByIdForSession(parsed.data.taskId, sessionId);
  if (!task || task.kind !== 'ledger' || task.status !== 'completed')
    return NextResponse.json(
      { error: 'Completed ledger task not found' },
      { status: 404 },
    );
  return NextResponse.json({ ledger: await getArchaeologyLedger(task.id) });
}
