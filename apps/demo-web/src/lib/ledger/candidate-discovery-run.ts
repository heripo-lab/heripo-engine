import type {
  CandidateDiscoveryAudit,
  CandidateDiscoveryResult,
} from '@heripo/ledger-extractor';

import {
  assembleCandidateDiscovery,
  buildDocumentResourceIndex,
  discoverCandidateUnit,
  prepareCandidateDiscovery,
} from '@heripo/ledger-extractor';
import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { paths } from '../paths';
import { createModel } from '../processing/model-factory';
import { parseLedgerInputText } from './ledger-input';

export interface CandidateDiscoveryRunSettings {
  scopeChapterId: string;
  modelId: string;
  maxTextChars: number;
  tableRowsPerUnit: number;
  maxRetries: number;
}
export interface CandidateDiscoveryRun {
  runId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
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
  return { run, plan, audits };
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
  const plan = prepareCandidateDiscovery(index, {
    ...settings,
    inputSha256: createHash('sha256').update(raw).digest('hex'),
  });
  const model = createModel(settings.modelId);
  const runId = randomUUID();
  const directory = join(rootFor(taskId), runId);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'plan.json'), JSON.stringify(plan, null, 2));
  const run: CandidateDiscoveryRun = {
    runId,
    status: 'running',
    createdAt: new Date().toISOString(),
    completedAt: null,
    settings,
    completedUnits: 0,
    totalUnits: plan.units.length,
    error: null,
    result: await assembleCandidateDiscovery(plan, []),
  };
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
    const audits: CandidateDiscoveryAudit[] = [];
    try {
      for (const [i, unit] of plan.units.entries()) {
        controller.signal.throwIfAborted();
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
      run.status = 'completed';
    } catch (error) {
      run.status = controller.signal.aborted ? 'cancelled' : 'failed';
      run.error = controller.signal.aborted
        ? 'Cancelled; saved results are retained.'
        : 'Model execution failed; saved results are retained.';
      console.error('Ledger candidate discovery stopped:', error);
    } finally {
      run.completedAt = new Date().toISOString();
      save();
      controllers.delete(runId);
    }
  })();
  return run;
}
