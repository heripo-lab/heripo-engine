import type { NextRequest } from 'next/server';

import { existsSync, readFileSync } from 'fs';
import { NextResponse } from 'next/server';

import { enforcePublicDemoGuards } from '~/lib/api/public-demo-guard';
import { getTaskByIdForSession } from '~/lib/db/repositories/task-repository';
import {
  LedgerInputError,
  parseLedgerInputText,
} from '~/lib/ledger/ledger-input';
import { createLedgerTask } from '~/lib/ledger/ledger-task';
import {
  LEDGER_RUN_BUDGET,
  findLedgerTaskForSource,
  resolveLedgerStageModels,
} from '~/lib/ledger/ledger-task-options';
import { getOrCreateSessionId } from '~/lib/session';
import { extractClientInfo } from '~/lib/utils/request-info';
import {
  createValidationErrorResponse,
  parseRouteParams,
  taskRouteParamsSchema,
} from '~/lib/validations';

async function sourceTask(params: Promise<{ taskId: string }>) {
  const sessionId = await getOrCreateSessionId();
  const validation = parseRouteParams(await params, taskRouteParamsSchema);
  if (!validation.success)
    return { error: createValidationErrorResponse(validation.error) };
  const task = getTaskByIdForSession(validation.data.taskId, sessionId);
  if (!task || task.kind !== 'raw-data')
    return {
      error: NextResponse.json({ error: 'Task not found' }, { status: 404 }),
    };
  return { task, sessionId };
}

/** The ledger task this session made from a completed PDF processing task, if any. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const found = await sourceTask(params);
  if ('error' in found) return found.error;
  return NextResponse.json({
    ledgerTask: findLedgerTaskForSource(found.task.id, found.sessionId),
  });
}

/**
 * Make a ledger task from a completed PDF processing task's processed document, in the caller's session, and
 * run every ledger step with its chosen model (`models`, or `modelId` for every step; default Claude Haiku 5.5). A session that already made one from
 * the same result gets that task back instead of a second run, unless that run failed or was cancelled.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const found = await sourceTask(params);
    if ('error' in found) return found.error;
    const { task, sessionId } = found;
    const body = (await request.json().catch(() => ({}))) as {
      models?: unknown;
      modelId?: string;
      batch?: boolean;
      bypassCode?: string;
      turnstileToken?: string;
    };
    const resolved = resolveLedgerStageModels(body);
    if ('error' in resolved)
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    // one run per result: a failed or cancelled run can be made again
    const existing = findLedgerTaskForSource(task.id, sessionId);
    if (existing && !['failed', 'cancelled'].includes(existing.status))
      return NextResponse.json({ taskId: existing.id, existing: true });
    if (
      task.status !== 'completed' ||
      !task.processedResultPath ||
      !existsSync(task.processedResultPath)
    )
      return NextResponse.json(
        { error: 'The processed document of this task is not available' },
        { status: 409 },
      );

    const clientInfo = extractClientInfo(request);
    const filename = `${task.originalFilename.replace(/\.pdf$/i, '')}.processed-document.json`;
    const guard = await enforcePublicDemoGuards({
      sessionId,
      clientInfo,
      filename,
      bypassCode: body.bypassCode ?? null,
      turnstileToken: body.turnstileToken ?? null,
    });
    if (!guard.ok) return guard.response;

    const rawText = readFileSync(task.processedResultPath, 'utf8');
    parseLedgerInputText(rawText);
    const created = await createLedgerTask({
      rawText,
      filename,
      sessionId,
      clientInfo,
      isOtpBypass: guard.isOtpBypass,
      options: {
        models: resolved.models,
        budget: LEDGER_RUN_BUDGET,
        sourceTaskId: task.id,
        ...(body.batch === false ? { batch: false } : {}),
      },
    });
    return NextResponse.json({ taskId: created.id, existing: false });
  } catch (error) {
    if (error instanceof LedgerInputError)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 422 },
      );
    console.error('Error creating ledger task from result:', error);
    return NextResponse.json(
      { error: 'Failed to create ledger task' },
      { status: 500 },
    );
  }
}
