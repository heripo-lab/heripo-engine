import type { LLMCallAttempt } from '@heripo/shared';
import type { LanguageModel, LanguageModelUsage } from 'ai';

import type {
  AttachmentUnit,
  ContentAttachmentPlan,
} from './content-attachment';
import type { ContentAttachmentThinInspection } from './content-attachment-thin-inspection';
import type { ContentAttachmentThinRequest } from './content-attachment-thin-prompt';
import type {
  ContentAttachmentThinOutlierCheck,
  ContentAttachmentThinRoutedSegment,
} from './content-attachment-thin-routing';

import { createAuditedModel } from '@heripo/shared';
import { Output, generateText, jsonSchema } from 'ai';

import { createContentAttachmentThinInput } from './content-attachment-thin-compile';
import { inspectContentAttachmentThinResponse } from './content-attachment-thin-inspection';
import { createContentAttachmentThinRequest } from './content-attachment-thin-prompt';
import {
  checkContentAttachmentThinOutliers,
  routeContentAttachmentThinSegments,
} from './content-attachment-thin-routing';

export type ContentAttachmentThinRunName = 'r1' | 'r2' | 'r3' | 'r4';
export interface ContentAttachmentThinCall {
  run: ContentAttachmentThinRunName;
  status: 'completed' | 'failed';
  request: ContentAttachmentThinRequest;
  /** Parsed structured output exactly as returned; never repaired. */
  rawResponse?: unknown;
  usage?: LanguageModelUsage;
  finishReason?: string;
  error?: string;
  callAttempts: LLMCallAttempt[];
  inspection?: ContentAttachmentThinInspection;
}
export interface ContentAttachmentThinUnitResult {
  unitId: string;
  /** routed: segments were routed; failed: a required call failed; no_llm_segments: code only. */
  status: 'routed' | 'failed' | 'no_llm_segments';
  calls: ContentAttachmentThinCall[];
  outliers?: {
    first: ContentAttachmentThinOutlierCheck;
    replacement?: ContentAttachmentThinOutlierCheck;
    finalRuns: ContentAttachmentThinRunName[];
    wholeUnitReview: boolean;
  };
  segments: ContentAttachmentThinRoutedSegment[];
  /** [segment, row owner, ...cell-registered candidates] attached by code. */
  codeAssigned: Array<[string, ...string[]]>;
}
export interface ContentAttachmentThinRunOptions {
  model: LanguageModel;
  /** Transient-error retries per call; the default 0 sends each call once. */
  maxRetries?: number;
  abortSignal?: AbortSignal;
  onAttempt?: (attempt: LLMCallAttempt) => void | Promise<void>;
  /** Called after every call, completed or failed, so the caller can persist it. */
  onCall?: (call: ContentAttachmentThinCall) => void | Promise<void>;
}

/**
 * Attach one unit with the thin method: r1, then r2 and r3 together so they can reuse the provider's
 * prompt cache, then at most one replacement r4 for a single outlier. Calls are never retried beyond
 * maxRetries and a failed call is never re-sent. Persistence, budgets and stopping stay with the caller.
 */
export async function attachContentThinUnit(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
  options: ContentAttachmentThinRunOptions,
): Promise<ContentAttachmentThinUnitResult> {
  const compilation = createContentAttachmentThinInput(plan, unit);
  const request = createContentAttachmentThinRequest(compilation);
  const base = {
    unitId: unit.unitId,
    codeAssigned: compilation.codeMap.codeAssigned,
  };
  if (!compilation.codeMap.segments.length)
    return { ...base, status: 'no_llm_segments', calls: [], segments: [] };

  const calls: ContentAttachmentThinCall[] = [];
  const call = async (
    run: ContentAttachmentThinRunName,
  ): Promise<ContentAttachmentThinCall> => {
    const audited = createAuditedModel(options.model, options.onAttempt);
    let result: ContentAttachmentThinCall;
    try {
      const response = await generateText({
        model: audited.model,
        output: Output.object({
          schema: jsonSchema(
            request.providerOutputSchema as Parameters<typeof jsonSchema>[0],
          ),
        }),
        system: request.systemPrompt,
        prompt: request.userPrompt,
        maxRetries: options.maxRetries ?? 0,
        abortSignal: options.abortSignal,
      });
      result = {
        run,
        status: 'completed',
        request,
        rawResponse: response.output,
        usage: response.usage,
        finishReason: response.finishReason,
        callAttempts: audited.attempts,
        inspection: inspectContentAttachmentThinResponse(plan, unit, {
          request,
          rawResponse: response.output,
        }),
      };
    } catch (error) {
      result = {
        run,
        status: 'failed',
        request,
        error: error instanceof Error ? error.message : String(error),
        callAttempts: audited.attempts,
      };
    }
    calls.push(result);
    await options.onCall?.(result);
    return result;
  };
  const failed = () => ({
    ...base,
    status: 'failed' as const,
    calls,
    segments: [],
  });

  if ((await call('r1')).status === 'failed') return failed();
  await Promise.all([call('r2'), call('r3')]);
  const first = (['r1', 'r2', 'r3'] as const).map((r) =>
    calls.find((c) => c.run === r)!,
  );
  if (first.some((c) => c.status === 'failed')) return failed();

  const segments = compilation.codeMap.segments;
  const firstCheck = checkContentAttachmentThinOutliers(
    segments,
    first.map((c) => c.inspection!),
  );
  let finalCalls = first;
  let replacement: ContentAttachmentThinOutlierCheck | undefined;
  let wholeUnitReview = false;
  if (firstCheck.flagged.length === 1) {
    const r4 = await call('r4');
    if (r4.status === 'completed') {
      finalCalls = [...first.filter((_, i) => i !== firstCheck.flagged[0]), r4];
      replacement = checkContentAttachmentThinOutliers(
        segments,
        finalCalls.map((c) => c.inspection!),
      );
      wholeUnitReview = replacement.flagged.includes(2);
    } else wholeUnitReview = true;
  }
  return {
    ...base,
    status: 'routed',
    calls,
    outliers: {
      first: firstCheck,
      ...(replacement ? { replacement } : {}),
      finalRuns: finalCalls.map((c) => c.run),
      wholeUnitReview,
    },
    segments: routeContentAttachmentThinSegments(
      plan,
      unit,
      compilation,
      finalCalls.map((c) => c.inspection!),
      { wholeUnitReview },
    ),
  };
}
