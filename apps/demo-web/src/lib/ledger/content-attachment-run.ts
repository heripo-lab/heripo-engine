import type {
  ContentAttachmentAudit,
  ContentAttachmentPlan,
  ContentAttachmentResult,
} from '@heripo/ledger-extractor';

import {
  assembleCandidateDeduplication,
  assembleCandidateDiscovery,
  assembleContentAttachment,
  attachContentUnit,
  buildDocumentResourceIndex,
  createContentAttachmentRequest,
  prepareContentAttachment,
} from '@heripo/ledger-extractor';
import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { paths } from '../paths';
import { createModel } from '../processing/model-factory';
import {
  getCandidateDiscoveryAudit,
  getCandidateDiscoveryRun,
} from './candidate-discovery-run';
import { parseLedgerInputText } from './ledger-input';

export interface ContentAttachmentRun {
  runId: string;
  status:
    | 'prepared'
    | 'running'
    | 'first_unit_completed'
    | 'first_unit_issues'
    | 'failed'
    | 'interrupted';
  createdAt: string;
  completedAt: string | null;
  candidateSnapshotId: string;
  inputSha256: string;
  planSha256: string;
  registrySha256: string;
  registryCount: number;
  pages: ContentAttachmentPlan['pages'];
  totalUnits: number;
  firstUnit: ContentAttachmentPlan['units'][number] | null;
  firstRequest: ReturnType<typeof createContentAttachmentRequest> | null;
  settings: { modelId: string; maxRetries: number; maxUnitChars: number };
  result: ContentAttachmentResult;
  modelResponse?: ContentAttachmentAudit['response'];
  error: string | null;
  fullSweepExecuted: false;
}
const runtime = globalThis as typeof globalThis & {
  ledgerAttachmentRuns?: Set<string>;
};
const running = (runtime.ledgerAttachmentRuns ??= new Set());
const root = (taskId: string) =>
  join(paths.task(taskId).outputRoot, 'content-attachment');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const sha = (data: string | Buffer) =>
  createHash('sha256').update(data).digest('hex');
const save = (taskId: string, run: ContentAttachmentRun) =>
  writeFileSync(
    join(root(taskId), run.runId, 'run.json'),
    JSON.stringify(run, null, 2),
  );
export function getContentAttachmentRun(
  taskId: string,
): ContentAttachmentRun | null {
  const latest = join(root(taskId), 'latest.json');
  if (!existsSync(latest)) return null;
  const run: ContentAttachmentRun = read(
    join(root(taskId), read(latest).runId, 'run.json'),
  );
  if (run.status === 'running' && !running.has(run.runId)) {
    run.status = 'interrupted';
    run.error = 'Server restarted; saved first-unit artifacts are retained.';
    save(taskId, run);
  }
  return run;
}
export function getContentAttachmentAudit(
  taskId: string,
  run: ContentAttachmentRun,
) {
  const dir = join(root(taskId), run.runId);
  const audit = join(dir, 'first-unit-audit.json');
  return {
    run,
    plan: read(join(dir, 'plan.json')),
    candidateSnapshot: read(join(dir, 'candidate-snapshot.json')),
    audit: existsSync(audit) ? read(audit) : null,
  };
}
/** Prepare a separate immutable candidate snapshot; this function makes no model calls. */
export async function prepareContentAttachmentRun(
  taskId: string,
  options: { maxUnitChars: number },
): Promise<ContentAttachmentRun> {
  const existing = getContentAttachmentRun(taskId);
  if (existing?.status === 'running')
    throw new Error('First-unit execution is already running');
  const source = getCandidateDiscoveryRun(taskId);
  if (
    !source ||
    source.status !== 'completed' ||
    !source.deduplication ||
    source.result.issues.length ||
    source.deduplication.issues.length
  )
    throw new Error('Completed validated candidate snapshot required');
  const raw = readFileSync(paths.task(taskId).inputJson);
  const document = parseLedgerInputText(raw.toString('utf8'));
  const snapshot = getCandidateDiscoveryAudit(taskId, source);
  const discovery = await assembleCandidateDiscovery(
    snapshot.plan,
    snapshot.audits,
  );
  if (
    JSON.stringify(discovery) !== JSON.stringify(source.result) ||
    JSON.stringify(
      assembleCandidateDeduplication(
        snapshot.plan,
        discovery,
        snapshot.deduplicationAudit!,
      ),
    ) !== JSON.stringify(source.deduplication)
  )
    throw new Error('Candidate snapshot audit does not replay');
  const plan = await prepareContentAttachment(
    buildDocumentResourceIndex(document),
    snapshot.plan,
    source.result,
    source.deduplication,
    {
      inputSha256: sha(raw),
      candidateSnapshotId: source.runId,
      pdfPageNumbers: Object.keys(document.pageRangeMap).map(Number),
      maxUnitChars: options.maxUnitChars,
    },
  );
  const runId = randomUUID();
  const dir = join(root(taskId), runId);
  mkdirSync(dir, { recursive: true });
  const encoded = JSON.stringify(plan, null, 2);
  writeFileSync(join(dir, 'plan.json'), encoded);
  writeFileSync(
    join(dir, 'candidate-snapshot.json'),
    JSON.stringify(snapshot, null, 2),
  );
  const firstUnit = plan.units[0] ?? null;
  const firstRequest = firstUnit
    ? createContentAttachmentRequest(plan, firstUnit)
    : null;
  writeFileSync(
    join(dir, 'first-unit-request.json'),
    JSON.stringify(firstRequest, null, 2),
  );
  const run: ContentAttachmentRun = {
    runId,
    status: 'prepared',
    createdAt: new Date().toISOString(),
    completedAt: null,
    candidateSnapshotId: source.runId,
    inputSha256: plan.inputSha256,
    planSha256: sha(encoded),
    registrySha256: plan.registrySha256,
    registryCount: plan.registry.length,
    pages: plan.pages,
    totalUnits: plan.units.length,
    firstUnit,
    firstRequest,
    settings: {
      modelId: source.settings.modelId,
      maxRetries: 0,
      maxUnitChars: options.maxUnitChars,
    },
    result: assembleContentAttachment(plan, []),
    error: null,
    fullSweepExecuted: false,
  };
  save(taskId, run);
  writeFileSync(join(root(taskId), 'latest.json'), JSON.stringify({ runId }));
  return run;
}
/** Execute exactly plan.units[0]. No loop, advance, automatic skip or full-sweep endpoint exists. */
export function startFirstContentAttachment(
  taskId: string,
): ContentAttachmentRun {
  const run = getContentAttachmentRun(taskId);
  if (!run || run.status !== 'prepared' || !run.firstUnit)
    throw new Error('Prepare a first-unit plan before execution');
  const dir = join(root(taskId), run.runId);
  const rawPlan = readFileSync(join(dir, 'plan.json'));
  if (
    sha(rawPlan) !== run.planSha256 ||
    sha(readFileSync(paths.task(taskId).inputJson)) !== run.inputSha256 ||
    getCandidateDiscoveryRun(taskId)?.runId !== run.candidateSnapshotId
  )
    throw new Error('Prepared snapshot changed; prepare a new plan');
  const plan: ContentAttachmentPlan = JSON.parse(rawPlan.toString('utf8'));
  const request = createContentAttachmentRequest(plan, plan.units[0]);
  if (JSON.stringify(request) !== JSON.stringify(run.firstRequest))
    throw new Error('First-unit request changed');
  const model = createModel(run.settings.modelId);
  run.status = 'running';
  running.add(run.runId);
  save(taskId, run);
  void (async () => {
    try {
      const audit: ContentAttachmentAudit = await attachContentUnit(
        plan,
        plan.units[0],
        { model, maxRetries: run.settings.maxRetries },
      );
      writeFileSync(
        join(dir, 'first-unit-audit.json'),
        JSON.stringify(audit, null, 2),
      );
      run.modelResponse = audit.response;
      run.result = assembleContentAttachment(plan, [audit]);
      run.status = run.result.issues.length
        ? 'first_unit_issues'
        : 'first_unit_completed';
    } catch (error) {
      console.error('First content attachment failed:', error);
      run.status = 'failed';
      run.error =
        'First-unit model execution failed; input and saved artifacts are retained.';
    } finally {
      run.completedAt = new Date().toISOString();
      save(taskId, run);
      running.delete(run.runId);
    }
  })();
  return run;
}
