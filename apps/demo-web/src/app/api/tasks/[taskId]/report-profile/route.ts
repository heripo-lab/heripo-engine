import type { ReportProfile } from '@heripo/ledger-extractor';
import type { NextRequest } from 'next/server';

import { NextResponse } from 'next/server';

import { publicModeConfig } from '~/lib/config/public-mode';
import { getTaskByIdForSession } from '~/lib/db/repositories/task-repository';
import {
  getReportProfile,
  saveReportProfile,
} from '~/lib/ledger/report-profile';
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
  return { taskId: task.id };
}

export async function GET(_request: NextRequest, context: Context) {
  const task = await resolveTask(context);
  if (task.error) return task.error;
  return NextResponse.json({ stored: await getReportProfile(task.taskId!) });
}

/** Save a confirmed report profile; the profile is validated against the task input first. */
export async function PUT(request: NextRequest, context: Context) {
  const task = await resolveTask(context);
  if (task.error) return task.error;
  if (publicModeConfig.isPublicMode)
    return NextResponse.json(
      { error: 'Report profiles are available in local demo mode' },
      { status: 403 },
    );
  const profile = (await request.json().catch(() => null)) as ReportProfile;
  if (!profile || typeof profile !== 'object')
    return NextResponse.json({ error: 'Invalid profile' }, { status: 400 });
  try {
    return NextResponse.json({
      stored: await saveReportProfile(task.taskId!, profile),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Invalid report profile',
        issues: (error as { issues?: string[] }).issues ?? [],
      },
      { status: 400 },
    );
  }
}
