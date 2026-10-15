import type { NextRequest } from 'next/server';

import { buildDocumentResourceIndex } from '@heripo/ledger-extractor';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { NextResponse } from 'next/server';

import { getTaskByIdForSession } from '~/lib/db/repositories/task-repository';
import { parseLedgerInputText } from '~/lib/ledger/ledger-input';
import { paths } from '~/lib/paths';
import { getOrCreateSessionId } from '~/lib/session';
import {
  createValidationErrorResponse,
  parseRouteParams,
  taskRouteParamsSchema,
} from '~/lib/validations';

/** Rebuild S0 from the retained input, including tasks created before S0 existed. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const sessionId = await getOrCreateSessionId();
    const validation = parseRouteParams(await params, taskRouteParamsSchema);
    if (!validation.success)
      return createValidationErrorResponse(validation.error);
    const { taskId } = validation.data;
    const task = getTaskByIdForSession(taskId, sessionId);
    if (!task)
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (task.kind !== 'ledger' || task.status !== 'completed') {
      return NextResponse.json(
        { error: 'A completed ledger task is required' },
        { status: 400 },
      );
    }
    const inputPath = paths.task(taskId).inputJson;
    if (!existsSync(inputPath)) {
      return NextResponse.json(
        { error: 'Original processed-document input not found' },
        { status: 404 },
      );
    }
    const raw = readFileSync(inputPath);
    const index = buildDocumentResourceIndex(
      parseLedgerInputText(raw.toString('utf8')),
    );
    return NextResponse.json({
      inputSha256: createHash('sha256').update(raw).digest('hex'),
      index,
    });
  } catch (error) {
    console.error('Error building document resource index:', error);
    return NextResponse.json(
      { error: 'Failed to build resource index' },
      { status: 500 },
    );
  }
}
