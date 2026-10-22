import type {
  ContentAttachmentPlan,
  ContentAttachmentThinCall,
  ContentAttachmentThinResult,
  ContentAttachmentThinUnitResult,
} from '@heripo/ledger-extractor';

import {
  assembleContentAttachmentThin,
  attachContentThinUnit,
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
import { getCandidateDiscoveryRun } from './candidate-discovery-run';
import { getContentAttachmentRun } from './content-attachment-run';

/** Units processed at the same time; each unit already sends r2 and r3 together. */
const UNIT_CONCURRENCY = 3;
/** Calls one unit can need at most (r1-r3 plus one replacement). */
const MAX_CALLS_PER_UNIT = 4;
const MAX_CONSECUTIVE_FAILURES = 5;
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

/**
 * Attach every unit of the prepared plan with the thin method, in the background. Each call is saved as it
 * finishes; completed units are skipped when started again, and a unit with saved calls but no result is
 * left as interrupted for a manual decision rather than re-sent. A plan whose candidate snapshot is no longer
 * the latest candidate discovery run is refused. New units stop on request, on HTTP 429,
 * on repeated failures or when the call or token budget would be exceeded.
 */
export function startContentAttachmentThin(
  taskId: string,
  budget: ContentAttachmentThinBudget,
): ContentAttachmentThinState {
  const run = getContentAttachmentRun(taskId);
  if (!run || run.status === 'running')
    throw new Error('Prepare a content attachment plan first');
  if (running.has(run.runId))
    throw new Error('Thin attachment already running');
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
  const root = thinRoot(taskId, run.runId);
  mkdirSync(join(root, 'units'), { recursive: true });
  const previous = getContentAttachmentThinState(taskId);
  const state: ContentAttachmentThinState = {
    attachmentRunId: run.runId,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    modelId: run.settings.modelId,
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

  const model = createModel(run.settings.modelId);
  running.add(run.runId);
  const stopReason = () => {
    persist();
    if (state.stopRequested) return 'stop requested';
    if (state.stoppedBy) return state.stoppedBy;
    if (
      state.usage.calls - atStart.calls + MAX_CALLS_PER_UNIT >
      budget.maxCalls
    )
      return 'call budget';
    if (state.usage.totalTokens - atStart.totalTokens >= budget.maxTotalTokens)
      return 'token budget';
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
            const u = unitDir(root, unit.unitId);
            mkdirSync(u, { recursive: true });
            const result: ContentAttachmentThinUnitResult =
              await attachContentThinUnit(plan, unit, {
                model,
                maxRetries: 0,
                onAttempt: (attempt) => {
                  if (attempt.error?.statusCode === 429)
                    state.stoppedBy = 'HTTP 429';
                },
                onCall: (call: ContentAttachmentThinCall) => {
                  write(join(u, `${call.run}.json`), call);
                  state.usage.calls++;
                  state.usage.totalTokens += call.usage?.totalTokens ?? 0;
                  if (call.status === 'failed') {
                    state.usage.failures++;
                    state.usage.consecutiveFailures++;
                  } else state.usage.consecutiveFailures = 0;
                  persist();
                },
              });
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
