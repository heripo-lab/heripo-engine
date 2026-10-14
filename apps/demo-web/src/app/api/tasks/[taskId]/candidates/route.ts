import type { NextRequest } from 'next/server';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { publicModeConfig } from '~/lib/config/public-mode';
import { getTaskByIdForSession } from '~/lib/db/repositories/task-repository';
import {
  cancelCandidateDiscovery,
  getCandidateDiscoveryAudit,
  getCandidateDiscoveryRun,
  startCandidateDiscovery,
} from '~/lib/ledger/candidate-discovery-run';
import { getOrCreateSessionId } from '~/lib/session';
import {
  createValidationErrorResponse,
  parseRouteParams,
  taskRouteParamsSchema,
} from '~/lib/validations';

const settingsSchema = z.object({
  scopeChapterId: z.string().min(1),
  modelId: z
    .string()
    .regex(/^(openai|anthropic|google|together|ollama|lmstudio)\/.+/),
  maxTextChars: z.number().int().min(1000).max(40000),
  tableRowsPerUnit: z.number().int().min(1).max(30),
  maxRetries: z.number().int().min(0).max(3),
  deduplicationOnly: z.boolean().optional(),
  retryFailedUnits: z.boolean().optional(),
});
type Context = { params: Promise<{ taskId: string }> };

async function resolveTask({ params }: Context) {
  const sessionId = await getOrCreateSessionId();
  const validation = parseRouteParams(await params, taskRouteParamsSchema);
  if (!validation.success)
    return { error: createValidationErrorResponse(validation.error) };
  const { taskId } = validation.data;
  const task = getTaskByIdForSession(taskId, sessionId);
  if (!task)
    return {
      error: NextResponse.json({ error: 'Task not found' }, { status: 404 }),
    };
  if (task.kind !== 'ledger' || task.status !== 'completed')
    return {
      error: NextResponse.json(
        { error: 'A completed ledger task is required' },
        { status: 400 },
      ),
    };
  return { taskId };
}

export async function GET(request: NextRequest, context: Context) {
  const task = await resolveTask(context);
  if (task.error) return task.error;
  const run = getCandidateDiscoveryRun(task.taskId!);
  if (run && request.nextUrl.searchParams.get('audit') === 'true')
    return NextResponse.json(getCandidateDiscoveryAudit(task.taskId!, run));
  return NextResponse.json({ run });
}

export async function POST(request: NextRequest, context: Context) {
  const task = await resolveTask(context);
  if (task.error) return task.error;
  if (publicModeConfig.isPublicMode)
    return NextResponse.json(
      { error: 'Candidate discovery is available in local demo mode' },
      { status: 403 },
    );
  const parsed = settingsSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid discovery settings' },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      { run: await startCandidateDiscovery(task.taskId!, parsed.data) },
      { status: 202 },
    );
  } catch (error) {
    console.error('Cannot start candidate discovery:', error);
    return NextResponse.json(
      {
        error:
          'Cannot start discovery. Check the selected chapter and model configuration.',
      },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: Context) {
  const task = await resolveTask(context);
  if (task.error) return task.error;
  cancelCandidateDiscovery(task.taskId!);
  return NextResponse.json({ success: true });
}
