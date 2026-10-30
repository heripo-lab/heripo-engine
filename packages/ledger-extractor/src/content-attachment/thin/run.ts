import type { LLMCallAttempt } from '@heripo/shared';
import type { LanguageModel, LanguageModelUsage } from 'ai';

import type { AttachmentUnit, ContentAttachmentPlan } from '../types';
import type { ContentAttachmentThinInspection } from './inspection';
import type { ContentAttachmentThinRequest } from './prompt';
import type {
  ContentAttachmentThinOutlierCheck,
  ContentAttachmentThinRoutedSegment,
} from './routing';

import { createAuditedModel } from '@heripo/shared';
import { NoObjectGeneratedError, Output, generateText, jsonSchema } from 'ai';

import { createContentAttachmentThinInput } from './compile';
import { inspectContentAttachmentThinResponse } from './inspection';
import {
  CONTENT_ATTACHMENT_THIN_AGGREGATE_CATALOG_VERSION,
  createContentAttachmentThinRequest,
} from './prompt';
import {
  checkContentAttachmentThinOutliers,
  isContentAttachmentThinTiebreakable,
  routeContentAttachmentThinSegments,
  routeContentAttachmentThinTiebreak,
} from './routing';

export type ContentAttachmentThinRunName = 'r1' | 'r2' | 'r3' | 'r4';
/** Provider options of a thin call, as the AI SDK takes them. */
export type ContentAttachmentThinProviderOptions = NonNullable<
  Parameters<typeof generateText>[0]['providerOptions']
>;
/**
 * Provider options a thin call sends by default: Anthropic reasoning effort `low`. On 24 saved units of three
 * reports, Haiku 5.5 at `low` differed from the saved default-effort runs about as much as those runs differed
 * from each other (5.2% against 6.0% of segments) with 38% fewer output tokens. Other providers ignore it.
 */
export const CONTENT_ATTACHMENT_THIN_PROVIDER_OPTIONS: ContentAttachmentThinProviderOptions =
  { anthropic: { effort: 'low' } };
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
  /** Provider options the call was sent with; absent on calls saved before they were recorded. */
  providerOptions?: ContentAttachmentThinProviderOptions;
  inspection?: ContentAttachmentThinInspection;
}
export interface ContentAttachmentThinUnitResult {
  unitId: string;
  /** routed: segments were routed; failed: a required call failed; no_llm_segments: code only. */
  status: 'routed' | 'failed' | 'no_llm_segments';
  calls: ContentAttachmentThinCall[];
  outliers?: {
    /** The outlier check of r1-r3; absent with two runs, which have no outlier check. */
    first?: ContentAttachmentThinOutlierCheck;
    replacement?: ContentAttachmentThinOutlierCheck;
    finalRuns: ContentAttachmentThinRunName[];
    wholeUnitReview: boolean;
  };
  segments: ContentAttachmentThinRoutedSegment[];
  /** [segment, row owner, ...cell-registered candidates] attached by code. */
  codeAssigned: Array<[string, ...string[]]>;
}
/** Calls per unit by default: r1 and r2, with segments auto-confirmed only where both agree. */
export const CONTENT_ATTACHMENT_THIN_DEFAULT_RUNS = 2;
export interface ContentAttachmentThinRunOptions {
  model: LanguageModel;
  /**
   * 2 (default): r1 then r2, every segment routed with both runs. 3: r1, then r2 and r3, with at most one
   * replacement r4 for a single outlier.
   */
  runs?: 2 | 3;
  /**
   * With two runs: send r3, then r4 if needed, to replace a degenerate run or to break a tie when the two usable runs
   * leave segments in review only because they disagree (`contentAttachmentThinNextRun`). On by default.
   */
  tiebreak?: boolean;
  /** Provider options of every call; `CONTENT_ATTACHMENT_THIN_PROVIDER_OPTIONS` by default, `{}` for none. */
  providerOptions?: ContentAttachmentThinProviderOptions;
  /** Transient-error retries per call; the default 0 sends each call once. */
  maxRetries?: number;
  abortSignal?: AbortSignal;
  onAttempt?: (attempt: LLMCallAttempt) => void | Promise<void>;
  /** Called after every call, completed or failed, so the caller can persist it. */
  onCall?: (call: ContentAttachmentThinCall) => void | Promise<void>;
}

/**
 * The frozen request the thin path sends for a unit: prompt v14 when the plan's `thinPolicy.catalog` is
 * `'fields'`, v13 otherwise. Null when the unit has no model-judged segment. Deterministic and offline, so a
 * caller can send it through any channel, such as a provider batch API.
 */
export function createContentAttachmentThinUnitRequest(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
): ContentAttachmentThinRequest | null {
  const compilation = createContentAttachmentThinInput(plan, unit);
  if (!compilation.codeMap.segments.length) return null;
  return createContentAttachmentThinRequest(
    compilation,
    plan.thinPolicy?.catalog === 'fields'
      ? { version: CONTENT_ATTACHMENT_THIN_AGGREGATE_CATALOG_VERSION }
      : {},
  );
}

/** One response obtained by the caller for a unit request; `error` marks a failed call. */
export interface ContentAttachmentThinCallInput {
  run: ContentAttachmentThinRunName;
  request: ContentAttachmentThinRequest;
  rawResponse?: unknown;
  usage?: LanguageModelUsage;
  finishReason?: string;
  error?: string;
  callAttempts?: LLMCallAttempt[];
  providerOptions?: ContentAttachmentThinProviderOptions;
}

/**
 * Record a call made outside `attachContentThinUnit`: a completed call is inspected against its unit, a call
 * with `error` is recorded as failed. The response is kept exactly as given and never repaired.
 */
export function recordContentAttachmentThinCall(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
  input: ContentAttachmentThinCallInput,
): ContentAttachmentThinCall {
  const callAttempts = input.callAttempts ?? [];
  const sent = input.providerOptions
    ? { providerOptions: input.providerOptions }
    : {};
  // a failed call can still have been charged, such as an answer cut off by its output limit
  const charged = {
    ...(input.usage ? { usage: input.usage } : {}),
    ...(input.finishReason !== undefined
      ? { finishReason: input.finishReason }
      : {}),
  };
  if (input.error !== undefined)
    return {
      run: input.run,
      status: 'failed',
      request: input.request,
      error: input.error,
      ...charged,
      callAttempts,
      ...sent,
    };
  return {
    run: input.run,
    status: 'completed',
    request: input.request,
    rawResponse: input.rawResponse,
    ...sent,
    ...charged,
    callAttempts,
    inspection: inspectContentAttachmentThinResponse(plan, unit, {
      request: input.request,
      rawResponse: input.rawResponse,
    }),
  };
}

/**
 * Whether a completed run left at least half of the unit's segments without a decision. Such a run (an almost empty
 * answer) gives too little to vote with, so routing replaces it with a later run.
 */
export function isContentAttachmentThinDegenerate(
  call: ContentAttachmentThinCall,
  segmentCount: number,
) {
  const missing = (call.inspection?.issues ?? []).filter((i) =>
    i.endsWith(': missing decision'),
  ).length;
  return call.status === 'completed' && missing * 2 >= segmentCount;
}

/** Completed runs in run order that are not degenerate. */
const usableRuns = (calls: ContentAttachmentThinCall[], segmentCount: number) =>
  (['r1', 'r2', 'r3', 'r4'] as const).flatMap((run) => {
    const call = calls.find((c) => c.run === run && c.status === 'completed');
    return call && !isContentAttachmentThinDegenerate(call, segmentCount)
      ? [call]
      : [];
  });

/**
 * The next run a two-run unit needs, or null: r3 (then r4) replaces a degenerate run until two usable runs exist,
 * and breaks the tie when the two usable runs leave segments in review only because they disagree. At most r4, and
 * none after a failed call.
 */
export function contentAttachmentThinNextRun(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
  calls: ContentAttachmentThinCall[],
): 'r3' | 'r4' | null {
  const result = routeContentAttachmentThinTwoRuns(plan, unit, calls);
  // a failed call is never followed by another run
  if (result.status !== 'routed' || calls.some((c) => c.status === 'failed'))
    return null;
  const next = (['r3', 'r4'] as const).find(
    (run) => !calls.some((c) => c.run === run),
  );
  if (!next) return null;
  const segmentCount = createContentAttachmentThinInput(plan, unit).codeMap
    .segments.length;
  if (usableRuns(calls, segmentCount).length < 2) return next;
  return result.outliers!.finalRuns.length === 2 &&
    result.segments.some(isContentAttachmentThinTiebreakable)
    ? next
    : null;
}

/**
 * Route a unit from its two-run calls, the default path: segments are confirmed only where r1 and r2 agree.
 * A degenerate run (`isContentAttachmentThinDegenerate`) is replaced by the next completed run, r3 then r4; with a
 * third usable run, segments in review only because the first two disagree are decided by majority
 * (`routeContentAttachmentThinTiebreak`). A failed later run leaves the earlier routing. The unit fails when r1 or r2 is
 * missing or failed. A call whose request differs from the unit's current request throws, since its response
 * answers another input. A unit without model-judged segments needs no calls.
 */
export function routeContentAttachmentThinTwoRuns(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
  calls: ContentAttachmentThinCall[],
): ContentAttachmentThinUnitResult {
  const compilation = createContentAttachmentThinInput(plan, unit);
  const base = {
    unitId: unit.unitId,
    codeAssigned: compilation.codeMap.codeAssigned,
  };
  const request = createContentAttachmentThinUnitRequest(plan, unit);
  if (!request)
    return { ...base, status: 'no_llm_segments', calls: [], segments: [] };
  for (const c of calls)
    if (
      c.request.version !== request.version ||
      c.request.systemPrompt !== request.systemPrompt ||
      c.request.userPrompt !== request.userPrompt
    )
      throw new Error(`Call ${c.run} does not answer this unit's request`);
  const pair = (['r1', 'r2'] as const).map((r) =>
    calls.find((c) => c.run === r),
  );
  if (pair.some((c) => c?.status !== 'completed'))
    return { ...base, status: 'failed', calls, segments: [] };
  // a degenerate run is replaced by the next usable one; with fewer than two usable runs, r1 and r2 stand
  const usable = usableRuns(calls, compilation.codeMap.segments.length);
  const runs =
    usable.length >= 2 ? usable : (pair as ContentAttachmentThinCall[]);
  if (runs.length >= 3)
    return {
      ...base,
      status: 'routed',
      calls,
      outliers: {
        finalRuns: runs.slice(0, 3).map((c) => c.run),
        wholeUnitReview: false,
      },
      segments: routeContentAttachmentThinTiebreak(plan, unit, compilation, [
        runs[0].inspection!,
        runs[1].inspection!,
        runs[2].inspection!,
      ]),
    };
  return {
    ...base,
    status: 'routed',
    calls,
    outliers: {
      finalRuns: runs.slice(0, 2).map((c) => c.run),
      wholeUnitReview: false,
    },
    segments: routeContentAttachmentThinSegments(
      plan,
      unit,
      compilation,
      runs.slice(0, 2).map((c) => c.inspection!),
    ),
  };
}

/**
 * Attach one unit with the thin method. With two runs (the default): r1, then r2 so it can reuse the provider's
 * prompt cache, and segments are routed with both (`routeContentAttachmentThinTwoRuns`). With three runs: r1,
 * then r2 and r3 together, then at most one replacement r4 for a single outlier. When r4 is again an outlier,
 * the runs hold two readings and segments are routed with all four runs; a failed r4 sends the unit to review.
 * Calls are never retried beyond maxRetries and a failed call is never re-sent. Persistence, budgets and
 * stopping stay with the caller.
 */
export async function attachContentThinUnit(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
  options: ContentAttachmentThinRunOptions,
): Promise<ContentAttachmentThinUnitResult> {
  const compilation = createContentAttachmentThinInput(plan, unit);
  const request = createContentAttachmentThinUnitRequest(plan, unit);
  const base = {
    unitId: unit.unitId,
    codeAssigned: compilation.codeMap.codeAssigned,
  };
  if (!request)
    return { ...base, status: 'no_llm_segments', calls: [], segments: [] };

  const providerOptions =
    options.providerOptions ?? CONTENT_ATTACHMENT_THIN_PROVIDER_OPTIONS;
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
        providerOptions,
      });
      result = recordContentAttachmentThinCall(plan, unit, {
        run,
        request,
        rawResponse: response.output,
        usage: response.usage,
        finishReason: response.finishReason,
        callAttempts: audited.attempts,
        providerOptions,
      });
    } catch (error) {
      // an answer that is not a valid object was still generated and charged
      const unparsed = NoObjectGeneratedError.isInstance(error)
        ? { usage: error.usage, finishReason: error.finishReason }
        : {};
      result = recordContentAttachmentThinCall(plan, unit, {
        run,
        request,
        error: error instanceof Error ? error.message : String(error),
        ...unparsed,
        callAttempts: audited.attempts,
        providerOptions,
      });
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
  if ((options.runs ?? CONTENT_ATTACHMENT_THIN_DEFAULT_RUNS) === 2) {
    if ((await call('r2')).status === 'failed') return failed();
    for (
      let next =
        options.tiebreak === false
          ? null
          : contentAttachmentThinNextRun(plan, unit, calls);
      next;
      next = contentAttachmentThinNextRun(plan, unit, calls)
    )
      await call(next);
    return routeContentAttachmentThinTwoRuns(plan, unit, calls);
  }
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
      const kept = [...first.filter((_, i) => i !== firstCheck.flagged[0]), r4];
      replacement = checkContentAttachmentThinOutliers(
        segments,
        kept.map((c) => c.inspection!),
      );
      // an outlying replacement means two readings; all four runs must then agree on each segment
      finalCalls = replacement.flagged.includes(2) ? [...first, r4] : kept;
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
