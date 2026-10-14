import type { NextRequest } from 'next/server';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { publicModeConfig } from '~/lib/config/public-mode';
import { getTaskByIdForSession } from '~/lib/db/repositories/task-repository';
import {
  getContentAttachmentAudit,
  getContentAttachmentRun,
  prepareContentAttachmentRun,
  startFirstContentAttachment,
} from '~/lib/ledger/content-attachment-run';
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
export async function GET(request: NextRequest, context: Context) {
  const task = await resolveTask(context);
  if (task.error) return task.error;
  const run = getContentAttachmentRun(task.taskId!);
  return NextResponse.json(
    run && request.nextUrl.searchParams.get('audit') === 'true'
      ? getContentAttachmentAudit(task.taskId!, run)
      : { run },
  );
}
const schema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('prepare'),
      maxUnitChars: z.number().int().min(1000).max(40000),
    })
    .strict(),
  z.object({ action: z.literal('run-first') }).strict(),
]);
export async function POST(request: NextRequest, context: Context) {
  const task = await resolveTask(context);
  if (task.error) return task.error;
  if (publicModeConfig.isPublicMode)
    return NextResponse.json(
      { error: 'Content attachment is available in local demo mode' },
      { status: 403 },
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid attachment settings' },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      {
        run:
          parsed.data.action === 'prepare'
            ? await prepareContentAttachmentRun(task.taskId!, parsed.data)
            : startFirstContentAttachment(task.taskId!),
      },
      { status: 202 },
    );
  } catch (error) {
    console.error('Cannot prepare or execute first attachment unit:', error);
    return NextResponse.json(
      {
        error:
          'Cannot prepare or execute first unit. Check the candidate snapshot and saved plan.',
      },
      { status: 400 },
    );
  }
}
