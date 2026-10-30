import type {
  ContentAttachmentAudit,
  ContentAttachmentPlan,
  ContentAttachmentResult,
  ContentAttachmentSelectionAudit,
  ContentRegistrationDecision,
} from '@heripo/ledger-extractor';

import {
  assembleCandidateDeduplication,
  assembleCandidateDiscovery,
  assembleContentAttachment,
  attachContentUnit,
  buildDocumentResourceIndex,
  createContentAttachmentRequest,
  createContentAttachmentTableAnchorInput,
  prepareContentAttachment,
  resolveContentAttachmentThinPolicy,
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
import {
  getCandidateDiscoveryAudit,
  getCandidateDiscoveryRun,
} from './candidate-discovery-run';
import { parseLedgerInputText } from './ledger-input';
import { getReportProfile } from './report-profile';

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
  /** Thin rules fixed into the plan from the confirmed profile; absent on plans prepared without one. */
  thinPolicy?: ContentAttachmentPlan['thinPolicy'];
  /** How each branch of the thin rules was decided, with branches a profile left unclear marked. */
  thinPolicyDecisions?: ContentAttachmentPlan['thinPolicyDecisions'];
  profile?: ContentAttachmentPlan['profile'];
  result: ContentAttachmentResult;
  modelResponse?:
    | ContentAttachmentAudit['response']
    | ContentAttachmentSelectionAudit['response'];
  modelUsage?: ContentAttachmentAudit['usage'];
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
    callAttempts: readdirSync(dir)
      .filter((name) => /^first-unit-api-attempt-\d+\.json$/.test(name))
      .map((name) => read(join(dir, name)))
      .sort((a, b) => a.sequence - b.sequence),
    codeMap: existsSync(join(dir, 'first-unit-code-map.json'))
      ? read(join(dir, 'first-unit-code-map.json'))
      : null,
  };
}
/**
 * Prepare a separate immutable candidate snapshot; this function makes no model calls. Discovery must be
 * complete with its duplicate review valid. Proposals that failed discovery checks block the snapshot unless
 * `acceptDroppedProposals` is set (the automatic run): they are already left out of the candidates, and the
 * ledger lists them as warnings.
 */
export async function prepareContentAttachmentRun(
  taskId: string,
  options: {
    maxUnitChars: number;
    registrationDecisions?: ContentRegistrationDecision[];
    acceptDroppedProposals?: boolean;
  },
): Promise<ContentAttachmentRun> {
  const existing = getContentAttachmentRun(taskId);
  if (existing?.status === 'running')
    throw new Error('First-unit execution is already running');
  const source = getCandidateDiscoveryRun(taskId);
  if (
    !source ||
    source.status !== 'completed' ||
    !source.deduplication ||
    (source.result.issues.length && !options.acceptDroppedProposals) ||
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
  const stored = await getReportProfile(taskId);
  const resolved = stored
    ? resolveContentAttachmentThinPolicy(stored.profile)
    : null;
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
      registrationDecisions: options.registrationDecisions,
      ...(stored && resolved
        ? {
            thinPolicy: resolved.policy,
            thinPolicyDecisions: resolved.decisions,
            profile: {
              profileSha256: stored.profileSha256,
              source: stored.profile.source,
            },
          }
        : {}),
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
  if (firstUnit)
    writeFileSync(
      join(dir, 'first-unit-code-map.json'),
      JSON.stringify(
        createContentAttachmentTableAnchorInput(plan, firstUnit).codeMap,
        null,
        2,
      ),
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
    ...(plan.thinPolicy ? { thinPolicy: plan.thinPolicy } : {}),
    ...(plan.thinPolicyDecisions
      ? { thinPolicyDecisions: plan.thinPolicyDecisions }
      : {}),
    ...(plan.profile ? { profile: plan.profile } : {}),
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
  if (
    JSON.stringify(read(join(dir, 'first-unit-code-map.json'))) !==
    JSON.stringify(
      createContentAttachmentTableAnchorInput(plan, plan.units[0]).codeMap,
    )
  )
    throw new Error('First-unit code map changed');
  const model = createModel(run.settings.modelId);
  run.status = 'running';
  running.add(run.runId);
  save(taskId, run);
  void (async () => {
    try {
      const audit = await attachContentUnit(plan, plan.units[0], {
        model,
        maxRetries: run.settings.maxRetries,
        onAttempt: (attempt) => {
          writeFileSync(
            join(dir, `first-unit-api-attempt-${attempt.sequence}.json`),
            JSON.stringify(attempt, null, 2),
          );
        },
      });
      writeFileSync(
        join(dir, 'first-unit-audit.json'),
        JSON.stringify(audit, null, 2),
      );
      run.modelResponse = audit.response;
      run.modelUsage = audit.usage;
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
