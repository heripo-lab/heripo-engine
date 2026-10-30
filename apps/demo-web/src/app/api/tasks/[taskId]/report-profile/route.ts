import type { ReportProfile } from '@heripo/ledger-extractor';
import type { NextRequest } from 'next/server';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { publicModeConfig } from '~/lib/config/public-mode';
import { getTaskByIdForSession } from '~/lib/db/repositories/task-repository';
import {
  getLatestReportRouterRun,
  getReportProfile,
  runReportRouter,
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
  return NextResponse.json({
    stored: await getReportProfile(task.taskId!),
    router: getLatestReportRouterRun(task.taskId!),
  });
}

const routeSchema = z
  .object({
    action: z.literal('route'),
    modelId: z
      .string()
      .regex(/^(openai|anthropic|google|together|ollama|lmstudio)\/.+/),
  })
  .strict();

/** Classify the report with one router call; the profile is saved only when it passes validation. */
export async function POST(request: NextRequest, context: Context) {
  const task = await resolveTask(context);
  if (task.error) return task.error;
  if (publicModeConfig.isPublicMode)
    return NextResponse.json(
      { error: 'Report profiles are available in local demo mode' },
      { status: 403 },
    );
  const parsed = routeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return createValidationErrorResponse(parsed.error);
  const router = await runReportRouter(task.taskId!, parsed.data.modelId);
  return NextResponse.json({
    stored: await getReportProfile(task.taskId!),
    router,
  });
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
