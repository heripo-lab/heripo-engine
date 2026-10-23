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
import {
  getContentAttachmentThinResult,
  getContentAttachmentThinState,
  startContentAttachmentThin,
  stopContentAttachmentThin,
} from '~/lib/ledger/content-attachment-thin-run';
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
  if (request.nextUrl.searchParams.get('thin') === 'result')
    return NextResponse.json({
      result: getContentAttachmentThinResult(task.taskId!),
    });
  return NextResponse.json(
    run && request.nextUrl.searchParams.get('audit') === 'true'
      ? getContentAttachmentAudit(task.taskId!, run)
      : { run, thin: getContentAttachmentThinState(task.taskId!) },
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
  z
    .object({
      action: z.literal('run-thin'),
      maxCalls: z.number().int().min(1).max(5000),
      maxTotalTokens: z.number().int().min(1000).max(100_000_000),
      modelId: z
        .string()
        .regex(/^(openai|anthropic|google|together|ollama|lmstudio)\/.+/),
    })
    .strict(),
  z.object({ action: z.literal('stop-thin') }).strict(),
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
  const { action } = parsed.data;
  try {
    if (action === 'run-thin' || action === 'stop-thin')
      return NextResponse.json(
        {
          run: getContentAttachmentRun(task.taskId!),
          thin:
            action === 'run-thin'
              ? startContentAttachmentThin(
                  task.taskId!,
                  {
                    maxCalls: parsed.data.maxCalls,
                    maxTotalTokens: parsed.data.maxTotalTokens,
                  },
                  parsed.data.modelId,
                )
              : stopContentAttachmentThin(task.taskId!),
        },
        { status: 202 },
      );
    return NextResponse.json(
      {
        run:
          action === 'prepare'
            ? await prepareContentAttachmentRun(task.taskId!, parsed.data)
            : startFirstContentAttachment(task.taskId!),
        thin: getContentAttachmentThinState(task.taskId!),
      },
      { status: 202 },
    );
  } catch (error) {
    console.error(`Content attachment action ${action} failed:`, error);
    return NextResponse.json(
      {
        error:
          action === 'run-thin' || action === 'stop-thin'
            ? `Cannot ${action === 'run-thin' ? 'start' : 'stop'} the thin attachment run: ${error instanceof Error ? error.message : 'unknown error'}`
            : 'Cannot prepare or execute first unit. Check the candidate snapshot and saved plan.',
      },
      { status: 400 },
    );
  }
}
