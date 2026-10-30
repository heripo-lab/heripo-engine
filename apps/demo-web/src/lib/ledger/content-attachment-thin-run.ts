import type {
  ContentAttachmentPlan,
  ContentAttachmentThinCall,
  ContentAttachmentThinResult,
  ContentAttachmentThinUnitResult,
  SpendGuard,
} from '@heripo/ledger-extractor';

import {
  CONTENT_ATTACHMENT_THIN_DEFAULT_RUNS,
  CONTENT_ATTACHMENT_THIN_PROVIDER_OPTIONS,
  assembleContentAttachmentThin,
  attachContentThinUnit,
  contentAttachmentThinNextRun,
  createContentAttachmentThinUnitRequest,
  createSpendGuard,
  recordContentAttachmentThinCall,
  routeContentAttachmentThinTwoRuns,
} from '@heripo/ledger-extractor';
import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

import { paths } from '../paths';
import { createModel } from '../processing/model-factory';
import {
  anthropicBatchResults,
  anthropicMessageParams,
  cancelAnthropicBatch,
  createAnthropicBatch,
  isAnthropicModelId,
  readAnthropicBatchItem,
  retrieveAnthropicBatch,
} from './anthropic-batch';
import { getCandidateDiscoveryRun } from './candidate-discovery-run';
import { getContentAttachmentRun } from './content-attachment-run';

/** Units processed at the same time; each unit sends r1 and then r2. */
const UNIT_CONCURRENCY = 3;
/** Calls one unit can need: r1 and r2 (the package default), then r3 and r4 to replace or break a tie. */
const MAX_CALLS_PER_UNIT = CONTENT_ATTACHMENT_THIN_DEFAULT_RUNS + 2;
const MAX_CONSECUTIVE_FAILURES = 5;
/**
 * Output limit of a batch item and of a direct call. The budget reserves this much output per call in flight; the
 * largest saved thin answer was about 18,300 tokens. A longer answer fails the call.
 */
const BATCH_MAX_OUTPUT_TOKENS = 32_000;
/** Input tokens reserved per prompt character; saved thin calls used at most 0.64. */
const BATCH_INPUT_TOKENS_PER_CHAR = 1;
const BATCH_POLL_MS = 60_000;
const MAX_TOTAL_FAILURES = 10;

export interface ContentAttachmentThinBudget {
  maxCalls: number;
  maxTotalTokens: number;
}
export interface ContentAttachmentThinState {
  attachmentRunId: string;
  status: 'running' | 'completed' | 'stopped' | 'interrupted';
  startedAt: string;
  completedAt: string | null;
  modelId: string;
  /** direct: calls sent one unit at a time; batch: one Anthropic Message Batch for the units of a start. */
  mode?: 'direct' | 'batch';
  /** The batch of the latest batch start; `processed` once its results are saved. */
  batch?: {
    id: string;
    submittedAt: string;
    unitIds: string[];
    reservedTokens: number;
    status: 'in_progress' | 'canceling' | 'ended' | 'processed';
    /** pair: r1 and r2 of open units (also when absent); tiebreak: the next run (r3 or r4) of units that need one. */
    phase?: 'pair' | 'tiebreak';
  } | null;
  budget: ContentAttachmentThinBudget;
  usage: {
    calls: number;
    totalTokens: number;
    failures: number;
    consecutiveFailures: number;
  };
  stopRequested: boolean;
  stoppedBy: string | null;
  totalUnits: number;
  /** Per unit: completed (result saved), failed, or interrupted (calls saved without a result). */
  units: Record<string, 'completed' | 'failed' | 'interrupted'>;
  summary: {
    autoSegments: number;
    reviewSegments: number;
    attachedCandidates: number;
    excerpts: number;
    wholeUnitReviewUnits: number;
  } | null;
}

const runtime = globalThis as typeof globalThis & {
  ledgerThinAttachmentRuns?: Set<string>;
};
const running = (runtime.ledgerThinAttachmentRuns ??= new Set());
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const write = (path: string, value: unknown) =>
  writeFileSync(path, JSON.stringify(value, null, 2));
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const thinRoot = (taskId: string, attachmentRunId: string) =>
  join(
    paths.task(taskId).outputRoot,
    'content-attachment',
    attachmentRunId,
    'thin',
  );
const unitDir = (root: string, unitId: string) =>
  join(root, 'units', unitId.replace(/[^A-Za-z0-9_-]/g, '_'));

function summarize(
  view: ContentAttachmentThinResult,
  results: ContentAttachmentThinUnitResult[],
) {
  return {
    autoSegments: results
      .flatMap((r) => r.segments)
      .filter((s) => s.status === 'auto').length,
    reviewSegments: view.reviewItems.length,
    attachedCandidates: view.contents.length,
    excerpts: view.contents.reduce((a, c) => a + c.excerpts.length, 0),
    wholeUnitReviewUnits: view.units.filter((u) => u.wholeUnitReview).length,
  };
}

/** Latest thin run state for the task's current attachment plan, if any. */
export function getContentAttachmentThinState(
  taskId: string,
): ContentAttachmentThinState | null {
  const run = getContentAttachmentRun(taskId);
  if (!run) return null;
  const file = join(thinRoot(taskId, run.runId), 'state.json');
  if (!existsSync(file)) return null;
  const state: ContentAttachmentThinState = read(file);
  if (
    state.status === 'running' &&
    !running.has(run.runId) &&
    state.batch &&
    state.batch.status !== 'processed'
  ) {
    try {
      resumeBatch(taskId, state);
      return state;
    } catch (error) {
      console.error('Cannot resume the thin attachment batch:', error);
    }
  }
  if (state.status === 'running' && !running.has(run.runId)) {
    state.status = 'interrupted';
    state.stoppedBy = 'server restarted';
    write(file, state);
  }
  return state;
}

/** Assembled ledger attachment view of the latest thin run, if one was written. */
export function getContentAttachmentThinResult(
  taskId: string,
): ContentAttachmentThinResult | null {
  const run = getContentAttachmentRun(taskId);
  if (!run) return null;
  const file = join(
    thinRoot(taskId, run.runId),
    'ledger-content-attachments.v2.json',
  );
  return existsSync(file) ? read(file) : null;
}

/** Ask a running thin run to stop; in-flight calls finish and no new unit starts. */
export function stopContentAttachmentThin(taskId: string) {
  const run = getContentAttachmentRun(taskId);
  const state = getContentAttachmentThinState(taskId);
  if (!run || !state || state.status !== 'running')
    throw new Error('No running thin attachment');
  state.stopRequested = true;
  write(join(thinRoot(taskId, run.runId), 'state.json'), state);
  return state;
}

interface ThinContext {
  taskId: string;
  runId: string;
  plan: ContentAttachmentPlan;
  root: string;
  state: ContentAttachmentThinState;
  stateFile: string;
  budget: ContentAttachmentThinBudget;
  atStart: ContentAttachmentThinState['usage'];
}

/** Load the prepared plan of the task's current attachment run, refusing a stale or changed snapshot. */
function loadPlan(taskId: string) {
  const run = getContentAttachmentRun(taskId);
  if (!run || run.status === 'running')
    throw new Error('Prepare a content attachment plan first');
  // a plan prepared before a newer candidate discovery run would attach to an outdated registry
  if (getCandidateDiscoveryRun(taskId)?.runId !== run.candidateSnapshotId)
    throw new Error('Candidate snapshot changed; prepare a new plan');
  const dir = join(
    paths.task(taskId).outputRoot,
    'content-attachment',
    run.runId,
  );
  const rawPlan = readFileSync(join(dir, 'plan.json'));
  if (
    sha(rawPlan) !== run.planSha256 ||
    sha(readFileSync(paths.task(taskId).inputJson)) !== run.inputSha256
  )
    throw new Error('Prepared snapshot changed; prepare a new plan');
  const plan: ContentAttachmentPlan = JSON.parse(rawPlan.toString('utf8'));
  return { run, plan, root: thinRoot(taskId, run.runId) };
}

const persistState = (ctx: ThinContext) => {
  const onDisk = existsSync(ctx.stateFile) ? read(ctx.stateFile) : null;
  if (onDisk?.stopRequested) ctx.state.stopRequested = true;
  write(ctx.stateFile, ctx.state);
};

const recordUsage = (
  state: ContentAttachmentThinState,
  call: ContentAttachmentThinCall,
) => {
  state.usage.calls++;
  state.usage.totalTokens += call.usage?.totalTokens ?? 0;
  if (call.status === 'failed') {
    state.usage.failures++;
    state.usage.consecutiveFailures++;
  } else state.usage.consecutiveFailures = 0;
};

/** Assemble the saved unit results into the ledger attachment view and its summary. */
function assembleSaved(ctx: ThinContext) {
  const results = ctx.plan.units
    .map((u) => join(unitDir(ctx.root, u.unitId), 'result.json'))
    .filter(existsSync)
    .map((f) => read(f) as ContentAttachmentThinUnitResult);
  const view = assembleContentAttachmentThin(ctx.plan, results);
  write(join(ctx.root, 'ledger-content-attachments.v2.json'), view);
  ctx.state.summary = summarize(view, results);
}

/**
 * Submit the open units that fit the budget as one Message Batch: r1 and r2 of each unit, built exactly as the
 * direct call would send them except for a fixed output limit. Units without model-judged segments are
 * routed without calls. Every item is in flight at once, so each call reserves its prompt length in tokens and
 * the full output limit before the batch is sent; units beyond the budget stay open for a later start.
 */
async function submitBatch(ctx: ThinContext, modelId: string) {
  const { plan, state } = ctx;
  const open = plan.units.filter((u) => !state.units[u.unitId]);
  const items: Array<{
    custom_id: string;
    params: Awaited<ReturnType<typeof anthropicMessageParams>>;
  }> = [];
  const unitIds: string[] = [];
  let calls = state.usage.calls - ctx.atStart.calls;
  let tokens = state.usage.totalTokens - ctx.atStart.totalTokens;
  let reservedTokens = 0;
  let limitedBy: string | null = null;
  for (const unit of open) {
    const request = createContentAttachmentThinUnitRequest(plan, unit);
    if (!request) {
      const u = unitDir(ctx.root, unit.unitId);
      mkdirSync(u, { recursive: true });
      write(
        join(u, 'result.json'),
        routeContentAttachmentThinTwoRuns(plan, unit, []),
      );
      state.units[unit.unitId] = 'completed';
      continue;
    }
    const reserve =
      Math.ceil(
        (request.systemPrompt.length + request.userPrompt.length) *
          BATCH_INPUT_TOKENS_PER_CHAR,
      ) + BATCH_MAX_OUTPUT_TOKENS;
    if (calls + 2 > ctx.budget.maxCalls) limitedBy ??= 'call budget';
    else if (tokens + 2 * reserve > ctx.budget.maxTotalTokens)
      limitedBy ??= 'token budget';
    if (limitedBy) continue;
    const params = {
      ...(await anthropicMessageParams(
        modelId,
        request,
        CONTENT_ATTACHMENT_THIN_PROVIDER_OPTIONS,
      )),
      max_tokens: BATCH_MAX_OUTPUT_TOKENS,
    };
    const index = plan.units.indexOf(unit);
    for (const r of ['r1', 'r2'])
      items.push({ custom_id: `u${index}-${r}`, params });
    unitIds.push(unit.unitId);
    calls += 2;
    tokens += 2 * reserve;
    reservedTokens += 2 * reserve;
  }
  persistState(ctx);
  if (!items.length) return limitedBy;
  const batch = await createAnthropicBatch(items);
  state.batch = {
    id: batch.id,
    submittedAt: new Date().toISOString(),
    unitIds,
    reservedTokens,
    status: batch.processing_status,
    phase: 'pair',
  };
  persistState(ctx);
  return limitedBy;
}

/** The saved calls of a unit, in run order. */
const savedCalls = (u: string) =>
  (['r1', 'r2', 'r3', 'r4'] as const).flatMap((run) =>
    existsSync(join(u, `${run}.json`))
      ? [read(join(u, `${run}.json`)) as ContentAttachmentThinCall]
      : [],
  );

/**
 * Submit the next run of every saved unit that needs one (`contentAttachmentThinNextRun`: r3, then r4, to replace a
 * degenerate run or to break a tie between disagreeing runs), within what is left of the budget, as one batch.
 */
async function submitTiebreak(ctx: ThinContext, modelId: string) {
  const { plan, state } = ctx;
  const items: Array<{
    custom_id: string;
    params: Awaited<ReturnType<typeof anthropicMessageParams>>;
  }> = [];
  const unitIds: string[] = [];
  let calls = state.usage.calls - ctx.atStart.calls;
  let tokens = state.usage.totalTokens - ctx.atStart.totalTokens;
  let reservedTokens = 0;
  let limitedBy: string | null = null;
  for (const unit of plan.units) {
    const u = unitDir(ctx.root, unit.unitId);
    if (state.units[unit.unitId] !== 'completed') continue;
    const next = contentAttachmentThinNextRun(plan, unit, savedCalls(u));
    if (!next) continue;
    const request = createContentAttachmentThinUnitRequest(plan, unit)!;
    const reserve =
      Math.ceil(
        (request.systemPrompt.length + request.userPrompt.length) *
          BATCH_INPUT_TOKENS_PER_CHAR,
      ) + BATCH_MAX_OUTPUT_TOKENS;
    if (calls + 1 > ctx.budget.maxCalls) limitedBy ??= 'call budget';
    else if (tokens + reserve > ctx.budget.maxTotalTokens)
      limitedBy ??= 'token budget';
    if (limitedBy) continue;
    items.push({
      custom_id: `u${plan.units.indexOf(unit)}-${next}`,
      params: {
        ...(await anthropicMessageParams(
          modelId,
          request,
          CONTENT_ATTACHMENT_THIN_PROVIDER_OPTIONS,
        )),
        max_tokens: BATCH_MAX_OUTPUT_TOKENS,
      },
    });
    unitIds.push(unit.unitId);
    calls++;
    tokens += reserve;
    reservedTokens += reserve;
  }
  if (!items.length) return limitedBy;
  const batch = await createAnthropicBatch(items);
  state.batch = {
    id: batch.id,
    submittedAt: new Date().toISOString(),
    unitIds,
    reservedTokens,
    status: batch.processing_status,
    phase: 'tiebreak',
  };
  persistState(ctx);
  return limitedBy;
}

/**
 * Wait for the batch to end, cancelling it on a stop request, then save every answered unit: its r1 and r2
 * calls, recorded without repair, and its two-run result. A unit whose two items were both cancelled or
 * expired made no call and stays open for a later start. A tie-break batch adds each answered r3 and routes the
 * unit again with all three runs; a cancelled or expired r3 leaves the two-run result.
 */
async function finishBatch(ctx: ThinContext) {
  const { plan, state } = ctx;
  const batch = state.batch!;
  for (;;) {
    const current = await retrieveAnthropicBatch(batch.id);
    batch.status = current.processing_status;
    if (batch.status === 'ended') break;
    if (state.stopRequested && batch.status === 'in_progress')
      batch.status = (await cancelAnthropicBatch(batch.id)).processing_status;
    persistState(ctx);
    await new Promise((resolve) => setTimeout(resolve, BATCH_POLL_MS));
    persistState(ctx);
  }
  const items = new Map(
    (await anthropicBatchResults(batch.id)).map((item) => [
      item.custom_id,
      item,
    ]),
  );
  for (const unitId of batch.phase === 'tiebreak' ? batch.unitIds : []) {
    const unit = plan.units.find((u) => u.unitId === unitId)!;
    const index = plan.units.indexOf(unit);
    const run = (['r3', 'r4'] as const).find((r) =>
      items.has(`u${index}-${r}`),
    );
    const item = run && items.get(`u${index}-${run}`);
    if (
      !run ||
      !item ||
      item.result.type === 'canceled' ||
      item.result.type === 'expired'
    )
      continue;
    const u = unitDir(ctx.root, unitId);
    const call = recordContentAttachmentThinCall(plan, unit, {
      run,
      request: createContentAttachmentThinUnitRequest(plan, unit)!,
      providerOptions: CONTENT_ATTACHMENT_THIN_PROVIDER_OPTIONS,
      ...readAnthropicBatchItem(item),
    });
    write(join(u, `${run}.json`), { ...call, batchId: batch.id });
    recordUsage(state, call);
    write(
      join(u, 'result.json'),
      routeContentAttachmentThinTwoRuns(plan, unit, savedCalls(u)),
    );
  }
  for (const unitId of batch.phase === 'tiebreak' ? [] : batch.unitIds) {
    const unit = plan.units.find((u) => u.unitId === unitId)!;
    const index = plan.units.indexOf(unit);
    const answered = (['r1', 'r2'] as const).flatMap((run) => {
      const item = items.get(`u${index}-${run}`);
      return item &&
        item.result.type !== 'canceled' &&
        item.result.type !== 'expired'
        ? [{ run, item }]
        : [];
    });
    if (!answered.length) continue;
    const request = createContentAttachmentThinUnitRequest(plan, unit)!;
    const u = unitDir(ctx.root, unitId);
    mkdirSync(u, { recursive: true });
    const calls = (['r1', 'r2'] as const).map((run) => {
      const item = items.get(`u${index}-${run}`);
      const call = recordContentAttachmentThinCall(plan, unit, {
        run,
        request,
        providerOptions: CONTENT_ATTACHMENT_THIN_PROVIDER_OPTIONS,
        ...(item
          ? readAnthropicBatchItem(item)
          : { error: 'batch item missing' }),
      });
      write(join(u, `${run}.json`), { ...call, batchId: batch.id });
      recordUsage(state, call);
      return call;
    });
    const result = routeContentAttachmentThinTwoRuns(plan, unit, calls);
    write(join(u, 'result.json'), result);
    state.units[unitId] = result.status === 'failed' ? 'failed' : 'completed';
  }
  batch.status = 'processed';
  persistState(ctx);
}

/**
 * Run a batch start in the background: collect a batch whose results were not saved, then submit and collect
 * batches until every open unit is done. A batch holds the units whose worst case fits what is left of the
 * budget; once its actual usage is known, the units it could not hold go out in the next batch. A start that
 * resumes after a restart only collects its batch. Units cancelled or expired stay open for a later start.
 */
function runBatch(ctx: ThinContext, modelId: string, resume: boolean) {
  running.add(ctx.runId);
  void (async () => {
    const { state } = ctx;
    try {
      if (state.batch && state.batch.status !== 'processed')
        await finishBatch(ctx);
      let limitedBy: string | null = null;
      while (!resume && !state.stopRequested) {
        const previous = state.batch?.id;
        limitedBy = await submitBatch(ctx, modelId);
        if (!state.batch || state.batch.id === previous) break;
        await finishBatch(ctx);
        if (!limitedBy) break;
      }
      // units with a degenerate run or disagreeing runs get their next run (r3, then r4), batch by batch
      while (!resume && !state.stopRequested) {
        const previous = state.batch?.id;
        // r4 may follow r3 in the next wave; a wave without items ends the loop
        await submitTiebreak(ctx, modelId);
        if (!state.batch || state.batch.id === previous) break;
        await finishBatch(ctx);
      }
      assembleSaved(ctx);
      const open = ctx.plan.units.some((u) => !state.units[u.unitId]);
      state.status = open ? 'stopped' : 'completed';
      state.stoppedBy = open
        ? state.stopRequested
          ? 'stop requested'
          : (limitedBy ?? 'batch items cancelled or expired')
        : null;
    } catch (error) {
      console.error('Thin content attachment batch failed:', error);
      state.status = 'stopped';
      state.stoppedBy = 'unexpected error';
    } finally {
      state.completedAt = new Date().toISOString();
      write(ctx.stateFile, state);
      running.delete(ctx.runId);
    }
  })();
}

/**
 * Pick up a submitted batch after a server restart: the batch keeps running at the provider, so its results
 * are fetched and saved instead of marking the run interrupted.
 */
function resumeBatch(taskId: string, state: ContentAttachmentThinState) {
  const { run, plan, root } = loadPlan(taskId);
  const ctx: ThinContext = {
    taskId,
    runId: run.runId,
    plan,
    root,
    state,
    stateFile: join(root, 'state.json'),
    budget: state.budget,
    atStart: { ...state.usage },
  };
  runBatch(ctx, state.modelId, true);
}

/**
 * Attach every unit of the prepared plan with the thin method, in the background. Each call is saved as it
 * finishes; completed units are skipped when started again, and a unit with saved calls but no result is
 * left as interrupted for a manual decision rather than re-sent. A plan whose candidate snapshot is no longer
 * the latest candidate discovery run is refused. New units stop on request, on HTTP 429,
 * on repeated failures or when the call or token budget would be exceeded. One run keeps one model: once calls
 * are saved, starting again with another model is refused so the votes of a unit never mix models.
 * With `batch` (Anthropic models only), the open units go out as Message Batches at half the price, each holding
 * the units whose worst case fits what is left of the budget; the run stays `running` until the last batch ends,
 * also across a server restart. A batch whose results were not saved, for example after a failed download, is
 * collected by the next start instead of being submitted again.
 */
export function startContentAttachmentThin(
  taskId: string,
  budget: ContentAttachmentThinBudget,
  modelId: string,
  options: { batch?: boolean; guard?: SpendGuard } = {},
): ContentAttachmentThinState {
  if (options.batch && !isAnthropicModelId(modelId))
    throw new Error('Batch attachment needs an Anthropic model');
  const { run, plan } = loadPlan(taskId);
  const previous = getContentAttachmentThinState(taskId);
  if (running.has(run.runId))
    throw new Error('Thin attachment already running');
  if (previous && previous.usage.calls > 0 && previous.modelId !== modelId)
    throw new Error(
      `This plan was attached with ${previous.modelId}; prepare a new plan to use another model`,
    );
  const root = thinRoot(taskId, run.runId);
  mkdirSync(join(root, 'units'), { recursive: true });
  const state: ContentAttachmentThinState = {
    attachmentRunId: run.runId,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    modelId,
    mode: options.batch ? 'batch' : 'direct',
    batch: previous?.batch ?? null,
    budget,
    usage: previous?.usage ?? {
      calls: 0,
      totalTokens: 0,
      failures: 0,
      consecutiveFailures: 0,
    },
    stopRequested: false,
    stoppedBy: null,
    totalUnits: plan.units.length,
    units: {},
    summary: previous?.summary ?? null,
  };
  state.usage.consecutiveFailures = 0;
  // the budget applies to the calls of this start; usage stays cumulative across starts
  const atStart = { ...state.usage };
  const stateFile = join(root, 'state.json');
  const persist = () => {
    const onDisk = existsSync(stateFile) ? read(stateFile) : null;
    if (onDisk?.stopRequested) state.stopRequested = true;
    write(stateFile, state);
  };
  for (const unit of plan.units) {
    const u = unitDir(root, unit.unitId);
    if (existsSync(join(u, 'result.json')))
      state.units[unit.unitId] =
        read(join(u, 'result.json')).status === 'failed'
          ? 'failed'
          : 'completed';
    else if (existsSync(u) && readdirSync(u).length)
      state.units[unit.unitId] = 'interrupted';
  }
  // written directly so a stop request saved by the previous start is not carried over
  write(stateFile, state);
  // a batch whose results were not saved is collected first, never submitted again
  const pendingBatch = !!state.batch && state.batch.status !== 'processed';
  if (options.batch || pendingBatch) {
    state.mode = 'batch';
    runBatch(
      {
        taskId,
        runId: run.runId,
        plan,
        root,
        state,
        stateFile,
        budget,
        atStart,
      },
      modelId,
      !options.batch,
    );
    return state;
  }

  // every attempt reserves its worst case before it is sent, so units in flight together cannot pass the caps;
  // a caller's guard holds the caps of a whole run, otherwise this start gets its own from the budget
  const guard = options.guard ?? createSpendGuard(budget);
  const model = guard.wrap(createModel(modelId), {
    defaultMaxOutputTokens: BATCH_MAX_OUTPUT_TOKENS,
  });
  // units taken but not finished; each may still send all of its calls
  let inFlight = 0;
  running.add(run.runId);
  const stopReason = () => {
    persist();
    if (state.stopRequested) return 'stop requested';
    if (state.stoppedBy) return state.stoppedBy;
    const left = guard.left();
    if (left.calls - inFlight * MAX_CALLS_PER_UNIT < MAX_CALLS_PER_UNIT)
      return 'call budget';
    if (left.totalTokens <= 0) return 'token budget';
    if (state.usage.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES)
      return 'consecutive failures';
    if (state.usage.failures >= MAX_TOTAL_FAILURES) return 'total failures';
    return null;
  };
  const queue = plan.units.filter((u) => !state.units[u.unitId]);

  void (async () => {
    try {
      await Promise.all(
        Array.from({ length: UNIT_CONCURRENCY }, async () => {
          while (queue.length && !stopReason()) {
            const unit = queue.shift()!;
            inFlight++;
            const u = unitDir(root, unit.unitId);
            mkdirSync(u, { recursive: true });
            // a call the guard refused was never sent: it is not saved or counted, and the unit stays open
            let refused = false;
            const result: ContentAttachmentThinUnitResult =
              await attachContentThinUnit(plan, unit, {
                model,
                maxRetries: 0,
                onAttempt: (attempt) => {
                  if (attempt.error?.statusCode === 429)
                    state.stoppedBy = 'HTTP 429';
                  if (attempt.error?.name === 'SpendLimitError') {
                    refused = true;
                    state.stoppedBy = 'spend cap';
                  }
                },
                onCall: (call: ContentAttachmentThinCall) => {
                  if (refused) return;
                  write(join(u, `${call.run}.json`), call);
                  recordUsage(state, call);
                  persist();
                },
              });
            inFlight--;
            if (refused) {
              queue.unshift(unit);
              persist();
              continue;
            }
            write(join(u, 'result.json'), result);
            state.units[unit.unitId] =
              result.status === 'failed' ? 'failed' : 'completed';
            persist();
          }
        }),
      );
      const results = plan.units
        .map((u) => join(unitDir(root, u.unitId), 'result.json'))
        .filter(existsSync)
        .map((f) => read(f) as ContentAttachmentThinUnitResult);
      const view = assembleContentAttachmentThin(plan, results);
      write(join(root, 'ledger-content-attachments.v2.json'), view);
      state.summary = summarize(view, results);
      state.stoppedBy = queue.length ? stopReason() : null;
      state.status = queue.length ? 'stopped' : 'completed';
    } catch (error) {
      console.error('Thin content attachment failed:', error);
      state.status = 'stopped';
      state.stoppedBy = 'unexpected error';
    } finally {
      state.completedAt = new Date().toISOString();
      write(stateFile, state);
      running.delete(run.runId);
    }
  })();
  return state;
}
