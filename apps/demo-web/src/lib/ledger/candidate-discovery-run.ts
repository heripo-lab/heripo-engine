import type {
  CandidateDeduplicationResult,
  CandidateDiscoveryAudit,
  CandidateDiscoveryResult,
} from '@heripo/ledger-extractor';

import {
  assembleCandidateDeduplication,
  assembleCandidateDiscovery,
  buildDocumentResourceIndex,
  createCandidateDeduplicationRequest,
  deduplicateCandidates,
  discoverCandidateUnit,
  isSameCandidateDiscoveryScope,
  prepareCandidateDiscovery,
  prepareCandidateDiscoveryRetry,
} from '@heripo/ledger-extractor';
import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { paths } from '../paths';
import { createModel } from '../processing/model-factory';
import { parseLedgerInputText } from './ledger-input';

export interface CandidateDiscoveryRunSettings {
  /** One chapter subtree, or several distinct, non-nested chapter subtrees. */
  scopeChapterId: string | string[];
  modelId: string;
  maxTextChars: number;
  tableRowsPerUnit: number;
  maxRetries: number;
  deduplicationOnly?: boolean;
  retryFailedUnits?: boolean;
  retryUnitIds?: string[];
}
export interface CandidateDiscoveryRun {
  runId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  stage?: 'discovery' | 'deduplication';
  discoverySourceRunId?: string;
  reusedFromRunId?: string;
  rerunUnitIds?: string[];
  deduplication?: CandidateDeduplicationResult;
  createdAt: string;
  completedAt: string | null;
  settings: CandidateDiscoveryRunSettings;
  completedUnits: number;
  totalUnits: number;
  error: string | null;
  result: CandidateDiscoveryResult;
}

const runtime = globalThis as typeof globalThis & {
  ledgerCandidateControllers?: Map<string, AbortController>;
};
const controllers = (runtime.ledgerCandidateControllers ??= new Map());
const rootFor = (taskId: string) =>
  join(paths.task(taskId).outputRoot, 'candidate-discovery');
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

export function getCandidateDiscoveryRun(
  taskId: string,
): CandidateDiscoveryRun | null {
  const root = rootFor(taskId);
  const latestPath = join(root, 'latest.json');
  if (!existsSync(latestPath)) return null;
  const { runId } = readJson(latestPath);
  const manifestPath = join(root, runId, 'run.json');
  const run: CandidateDiscoveryRun = readJson(manifestPath);
  if (run.status === 'running' && !controllers.has(run.runId)) {
    run.status = 'interrupted';
    run.error =
      'Server restarted. Saved unit responses and partial candidates are retained.';
    writeFileSync(manifestPath, JSON.stringify(run, null, 2));
  }
  return run;
}

export function getCandidateDiscoveryAudit(
  taskId: string,
  run: CandidateDiscoveryRun,
) {
  const root = join(rootFor(taskId), run.runId);
  const plan = readJson(join(root, 'plan.json'));
  const audits = plan.units
    .map((_: unknown, i: number) =>
      join(root, `unit-${String(i).padStart(4, '0')}.json`),
    )
    .filter(existsSync)
    .map(readJson);
  const deduplicationPath = join(root, 'deduplication-audit.json');
  return {
    run,
    plan,
    audits,
    deduplicationAudit: existsSync(deduplicationPath)
      ? readJson(deduplicationPath)
      : null,
  };
}

export function cancelCandidateDiscovery(taskId: string): void {
  const run = getCandidateDiscoveryRun(taskId);
  if (run) controllers.get(run.runId)?.abort();
}

/** Local single-process runner; each completed call is checkpointed before applying it. */
export async function startCandidateDiscovery(
  taskId: string,
  settings: CandidateDiscoveryRunSettings,
): Promise<CandidateDiscoveryRun> {
  const existing = getCandidateDiscoveryRun(taskId);
  if (existing?.status === 'running') return existing;
  const raw = readFileSync(paths.task(taskId).inputJson);
  const index = buildDocumentResourceIndex(
    parseLedgerInputText(raw.toString('utf8')),
  );
  const freshPlan = prepareCandidateDiscovery(index, {
    ...settings,
    inputSha256: createHash('sha256').update(raw).digest('hex'),
  });
  if (settings.deduplicationOnly && settings.retryFailedUnits) {
    throw new Error('Choose either duplicate review or failed-unit retry');
  }
  const reuse =
    settings.deduplicationOnly === true || settings.retryFailedUnits === true;
  if (
    reuse &&
    (!existing ||
      existing.completedUnits !== existing.totalUnits ||
      existing.result.inputSha256 !== freshPlan.inputSha256 ||
      !isSameCandidateDiscoveryScope(existing.result, freshPlan))
  ) {
    throw new Error(
      'A complete discovery snapshot for the same input and scope is required',
    );
  }
  const sourceDirectory = reuse ? join(rootFor(taskId), existing!.runId) : null;
  let plan = sourceDirectory
    ? (readJson(join(sourceDirectory, 'plan.json')) as typeof freshPlan)
    : freshPlan;
  const savedAudits: CandidateDiscoveryAudit[] = sourceDirectory
    ? plan.units.map((_, i) =>
        readJson(
          join(sourceDirectory, `unit-${String(i).padStart(4, '0')}.json`),
        ),
      )
    : [];
  let initialResult = await assembleCandidateDiscovery(plan, savedAudits);
  if (
    reuse &&
    JSON.stringify(initialResult) !== JSON.stringify(existing!.result)
  ) {
    throw new Error(
      'Saved discovery audit no longer reproduces the original snapshot',
    );
  }
  const retry = settings.retryFailedUnits
    ? await prepareCandidateDiscoveryRetry(plan, savedAudits, {
        unitIds: settings.retryUnitIds,
        updatedPlan: freshPlan,
      })
    : null;
  const retainedAudits = retry?.retainedAudits ?? savedAudits;
  if (retry) {
    plan = retry.plan;
    initialResult = retry.result;
  }
  const model = createModel(settings.modelId);
  const runId = randomUUID();
  const directory = join(rootFor(taskId), runId);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'plan.json'), JSON.stringify(plan, null, 2));
  const run: CandidateDiscoveryRun = {
    runId,
    status: 'running',
    stage: reuse && !retry ? 'deduplication' : 'discovery',
    ...(retry ? { rerunUnitIds: retry.retryUnitIds } : {}),
    ...(reuse
      ? {
          reusedFromRunId: existing!.runId,
          discoverySourceRunId:
            existing!.discoverySourceRunId ?? existing!.runId,
        }
      : {}),
    createdAt: new Date().toISOString(),
    completedAt: null,
    settings,
    completedUnits: initialResult.completedUnitIds.length,
    totalUnits: plan.units.length,
    error: null,
    result: initialResult,
  };
  if (sourceDirectory) {
    for (const [i] of plan.units.entries()) {
      if (!retainedAudits.some((a) => a.unitId === plan.units[i].unitId))
        continue;
      const name = `unit-${String(i).padStart(4, '0')}.json`;
      writeFileSync(
        join(directory, name),
        readFileSync(join(sourceDirectory, name)),
      );
    }
  }
  const controller = new AbortController();
  controllers.set(runId, controller);
  const save = () =>
    writeFileSync(join(directory, 'run.json'), JSON.stringify(run, null, 2));
  save();
  writeFileSync(
    join(rootFor(taskId), 'latest.json'),
    JSON.stringify({ runId }),
  );
  void (async () => {
    const audits: CandidateDiscoveryAudit[] = [...retainedAudits];
    try {
      for (const [i, unit] of plan.units.entries()) {
        controller.signal.throwIfAborted();
        if (audits.some((a) => a.unitId === unit.unitId)) continue;
        const audit = await discoverCandidateUnit(unit, {
          model,
          maxRetries: settings.maxRetries,
          abortSignal: controller.signal,
        });
        writeFileSync(
          join(directory, `unit-${String(i).padStart(4, '0')}.json`),
          JSON.stringify(audit, null, 2),
        );
        audits.push(audit);
        run.result = await assembleCandidateDiscovery(plan, audits);
        run.completedUnits = run.result.completedUnitIds.length;
        save();
      }
      run.stage = 'deduplication';
      save();
      controller.signal.throwIfAborted();
      if (run.result.candidates.length) {
        const request = createCandidateDeduplicationRequest(plan, run.result);
        writeFileSync(
          join(directory, 'deduplication-request.json'),
          JSON.stringify(request, null, 2),
        );
        const audit = await deduplicateCandidates(plan, run.result, {
          model,
          maxRetries: settings.maxRetries,
          abortSignal: controller.signal,
        });
        writeFileSync(
          join(directory, 'deduplication-audit.json'),
          JSON.stringify(audit, null, 2),
        );
        run.deduplication = assembleCandidateDeduplication(
          plan,
          run.result,
          audit,
        );
        if (run.deduplication.issues.length)
          throw new Error('Deduplication partition failed validation');
      } else {
        run.deduplication = {
          version: 'ledger-candidate-groups.v1',
          groups: [],
          issues: [],
          uncertainMatches: [],
        };
      }
      run.status = 'completed';
    } catch (error) {
      run.status = controller.signal.aborted ? 'cancelled' : 'failed';
      run.error = controller.signal.aborted
        ? 'Cancelled; saved results are retained.'
        : 'Model execution or validation failed; saved results are retained.';
      console.error('Ledger candidate discovery stopped:', error);
    } finally {
      run.completedAt = new Date().toISOString();
      save();
      controllers.delete(runId);
    }
  })();
  return run;
}
