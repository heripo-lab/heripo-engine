import type {
  CandidateDeduplicationResult,
  CandidateDiscoveryAudit,
  CandidateDiscoveryResult,
} from '@heripo/ledger-extractor';

import {
  assembleCandidateDeduplication,
  assembleCandidateDiscovery,
  buildDocumentResourceIndex,
  deduplicateCandidateBlocks,
  discoverCandidateUnit,
  isSameCandidateDiscoveryScope,
  prepareCandidateDiscovery,
  prepareCandidateDiscoveryRetry,
} from '@heripo/ledger-extractor';
import { createHash, randomUUID } from 'crypto';
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
import { isAnthropicModelId } from './anthropic-batch';
import { answerDeduplicationBlocksByBatch } from './deduplication-batch';
import { discoverUnitsByBatch } from './discovery-batch';
import { parseLedgerInputText } from './ledger-input';
import { getReportProfile } from './report-profile';

export interface CandidateDiscoveryRunSettings {
  /** One chapter subtree, or several distinct, non-nested chapter subtrees. */
  scopeChapterId: string | string[];
  modelId: string;
  /** The model of the duplicate review; the discovery model when left out. */
  deduplicationModelId?: string;
  /** Answer the duplicate review blocks through the Anthropic Message Batches API (Anthropic models only). */
  deduplicationBatch?: boolean;
  /** Discover candidates through the Anthropic Message Batches API, first calls then follow-ups (Anthropic only). */
  discoveryBatch?: boolean;
  maxTextChars: number;
  tableRowsPerUnit: number;
  maxRetries: number;
  deduplicationOnly?: boolean;
  retryFailedUnits?: boolean;
  retryUnitIds?: string[];
  /** Use the scope of the task's confirmed report profile and record its hash in the plan. */
  useProfileScope?: boolean;
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
  requested: CandidateDiscoveryRunSettings,
): Promise<CandidateDiscoveryRun> {
  const existing = getCandidateDiscoveryRun(taskId);
  if (existing?.status === 'running') return existing;
  const stored = requested.useProfileScope
    ? await getReportProfile(taskId)
    : null;
  if (requested.useProfileScope && !stored)
    throw new Error('A valid confirmed report profile is required');
  if (stored?.profile.scopeStatus === 'proposed')
    throw new Error(
      'The profile scope is a router proposal; choose the scope chapters before discovery',
    );
  // the profile scope replaces any chapters sent with the request
  const settings: CandidateDiscoveryRunSettings = stored
    ? { ...requested, scopeChapterId: stored.profile.scopeChapterIds }
    : requested;
  const raw = readFileSync(paths.task(taskId).inputJson);
  const index = buildDocumentResourceIndex(
    parseLedgerInputText(raw.toString('utf8')),
  );
  const freshPlan = prepareCandidateDiscovery(index, {
    ...settings,
    inputSha256: createHash('sha256').update(raw).digest('hex'),
    ...(stored
      ? {
          scopeSource: {
            kind: 'profile' as const,
            profileSha256: stored.profileSha256,
          },
        }
      : {}),
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
  const deduplicationModelId =
    settings.deduplicationModelId ?? settings.modelId;
  if (settings.deduplicationBatch && !isAnthropicModelId(deduplicationModelId))
    throw new Error('Batch duplicate review needs an Anthropic model');
  if (settings.discoveryBatch && !isAnthropicModelId(settings.modelId))
    throw new Error('Batch discovery needs an Anthropic model');
  const deduplicationModel = settings.deduplicationModelId
    ? createModel(settings.deduplicationModelId)
    : model;
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
      if (settings.discoveryBatch) {
        const open = plan.units.flatMap((unit, index) =>
          audits.some((a) => a.unitId === unit.unitId) ? [] : [{ index, unit }],
        );
        if (open.length) {
          const batch = await discoverUnitsByBatch({
            units: open,
            modelId: settings.modelId,
            directory,
            abortSignal: controller.signal,
          });
          for (const { index, audit } of batch.audits) {
            writeFileSync(
              join(directory, `unit-${String(index).padStart(4, '0')}.json`),
              JSON.stringify(audit, null, 2),
            );
            audits.push(audit);
          }
          run.result = await assembleCandidateDiscovery(plan, audits);
          run.completedUnits = run.result.completedUnitIds.length;
          save();
          // the answered units stay saved; the failed ones can be asked again with a retry of failed units
          if (batch.failures.length)
            throw new Error(
              `Discovery batch failures: ${batch.failures.join('; ')}`,
            );
        }
      }
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
        // code merges same numbers and number correspondences; a model judges the remaining blocks one by one,
        // each saved as it finishes so a restarted run does not send it again
        const blockDir = join(directory, 'deduplication-blocks');
        mkdirSync(blockDir, { recursive: true });
        const completed = readdirSync(blockDir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => readJson(join(blockDir, f)));
        if (settings.deduplicationBatch)
          completed.push(
            ...(await answerDeduplicationBlocksByBatch({
              plan,
              discovery: run.result,
              modelId: deduplicationModelId,
              blockDir,
              batchFile: join(directory, 'deduplication-batch.json'),
              completed,
              abortSignal: controller.signal,
            })),
          );
        const audit = await deduplicateCandidateBlocks(plan, run.result, {
          model: deduplicationModel,
          maxRetries: settings.maxRetries,
          abortSignal: controller.signal,
          completed,
          onBlock: (block) =>
            writeFileSync(
              join(blockDir, `${block.blockId}.json`),
              JSON.stringify(block, null, 2),
            ),
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
