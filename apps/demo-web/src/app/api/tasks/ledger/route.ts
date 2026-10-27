import type { NextRequest } from 'next/server';

import { NextResponse } from 'next/server';

import { enforcePublicDemoGuards } from '~/lib/api/public-demo-guard';
import {
  LEDGER_ERROR_CODES,
  LEDGER_INPUT_MAX_SIZE_BYTES,
  LedgerInputError,
  isAllowedLedgerInputFile,
  parseLedgerInputText,
} from '~/lib/ledger/ledger-input';
import { createLedgerTask } from '~/lib/ledger/ledger-task';
import {
  DEFAULT_LEDGER_MODEL,
  LEDGER_RUN_BUDGET,
  isLedgerModel,
} from '~/lib/ledger/ledger-task-options';
import { getOrCreateSessionId } from '~/lib/session';
import { extractClientInfo } from '~/lib/utils/request-info';

/**
 * Creates a ledger extraction task from a single processed-document.json
 * upload. Unlike PDF tasks, ledger tasks take only the model for their
 * automatic run (`modelId`, default Claude Haiku 5.5); the same public-demo
 * protections (Turnstile, OTP bypass, weekly lockout, rate limit, session
 * isolation) apply.
 */
export async function POST(request: NextRequest) {
  try {
    const sessionId = await getOrCreateSessionId();
    const clientInfo = extractClientInfo(request);
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const bypassCode = formData.get('bypassCode') as string | null;
    const turnstileToken = formData.get('turnstileToken') as string | null;
    const modelId =
      (formData.get('modelId') as string | null) ?? DEFAULT_LEDGER_MODEL;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!isLedgerModel(modelId)) {
      return NextResponse.json(
        { error: `Unknown model: ${modelId}` },
        { status: 400 },
      );
    }

    // Step 1: file extension and MIME type (single JSON file only, no ZIP)
    if (!isAllowedLedgerInputFile(file)) {
      return NextResponse.json(
        {
          error:
            'Only a single processed-document.json file is supported for ledger extraction',
          code: LEDGER_ERROR_CODES.INVALID_LEDGER_INPUT_TYPE,
        },
        { status: 415 },
      );
    }

    // Step 2: file size limit (applied before any JSON parsing)
    if (file.size > LEDGER_INPUT_MAX_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: `File size exceeds ${LEDGER_INPUT_MAX_SIZE_BYTES / (1024 * 1024)}MB limit`,
          code: LEDGER_ERROR_CODES.LEDGER_INPUT_TOO_LARGE,
          fileSize: file.size,
          maxSize: LEDGER_INPUT_MAX_SIZE_BYTES,
        },
        { status: 413 },
      );
    }

    // Public demo protections shared with the PDF task API
    const guardResult = await enforcePublicDemoGuards({
      sessionId,
      clientInfo,
      filename: file.name,
      bypassCode,
      turnstileToken,
    });
    if (!guardResult.ok) {
      return guardResult.response;
    }
    const isOtpBypass = guardResult.isOtpBypass;

    // Step 3-5: UTF-8 read, JSON parse, ProcessedDocument runtime validation
    const rawText = await file.text();
    try {
      parseLedgerInputText(rawText);
    } catch (error) {
      if (error instanceof LedgerInputError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          {
            status: error.code === LEDGER_ERROR_CODES.INVALID_JSON ? 400 : 422,
          },
        );
      }
      throw error;
    }

    // Step 6-7: create and enqueue the ledger task; it runs every ledger step with the chosen model
    const task = await createLedgerTask({
      rawText,
      filename: file.name,
      sessionId,
      clientInfo,
      isOtpBypass,
      options: { modelId, budget: LEDGER_RUN_BUDGET },
    });

    return NextResponse.json({
      taskId: task.id,
      status: task.status,
      createdAt: task.createdAt,
      streamUrl: `/api/tasks/${task.id}/stream`,
    });
  } catch (error) {
    console.error('Error creating ledger task:', error);
    return NextResponse.json(
      { error: 'Failed to create ledger task' },
      { status: 500 },
    );
  }
}
