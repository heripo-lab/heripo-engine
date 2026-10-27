import type { LedgerTaskOptions } from './ledger-task-options';

import {
  buildDocumentResourceIndex,
  collectReportSignals,
  completeReportScope,
  prepareCandidateDiscovery,
} from '@heripo/ledger-extractor';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

import { discoveryMaxTextChars } from '~/features/ledger/constants/ledger-run';

import { paths } from '../paths';
import { getArchaeologyLedger } from './archaeology-ledger';
import {
  cancelCandidateDiscovery,
  getCandidateDiscoveryAudit,
  getCandidateDiscoveryRun,
  startCandidateDiscovery,
} from './candidate-discovery-run';
import { prepareContentAttachmentRun } from './content-attachment-run';
import {
  getContentAttachmentThinState,
  startContentAttachmentThin,
  stopContentAttachmentThin,
} from './content-attachment-thin-run';
import { saveDiscoveryScope } from './discovery-scope';
import { parseLedgerInputText } from './ledger-input';
import { getReportProfile, runReportRouter } from './report-profile';

/** Steps of the automatic run, in order; the worker reports each as a progress step. */
export const LEDGER_PIPELINE_STEPS = [
  'report-profile',
  'candidate-discovery',
  'content-attachment',
  'ledger-build',
] as const;
export type LedgerPipelineStep = (typeof LEDGER_PIPELINE_STEPS)[number];

/** Discovery settings the manual panel uses by default. */
const DISCOVERY = { tableRowsPerUnit: 12, maxRetries: 0 };
const MAX_UNIT_CHARS = 8000;
/**
 * Reserved before a step starts, so the hard caps hold even at the step's worst case: structured output may
 * retry a schema mismatch once, and thin attachment can have units in flight when the token cap is reached.
 */
const RESERVE = {
  // a unit may send one follow-up for unanswered table rows, each call retrying a schema mismatch once
  callsPerDiscoveryUnit: 4,
  tokensPerDiscoveryUnit: 120_000,
  deduplicationTokens: 250_000,
  thinTokensInFlight: 400_000,
};
const POLL_MS = 2000;

interface Usage {
  calls: number;
  totalTokens: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Ledger task was aborted'));
    });
  });

/** Calls and tokens the saved candidate discovery run of the task used. */
function discoveryUsage(taskId: string): Usage {
  const run = getCandidateDiscoveryRun(taskId);
  if (!run) return { calls: 0, totalTokens: 0 };
  const { audits, deduplicationAudit } = getCandidateDiscoveryAudit(
    taskId,
    run,
  );
  const all = [...audits, ...(deduplicationAudit ? [deduplicationAudit] : [])];
  return {
    calls: all.reduce((n, a) => n + (a.structuredAttempts ?? 1), 0),
    totalTokens: all.reduce((n, a) => n + (a.usage?.totalTokens ?? 0), 0),
  };
}

/**
 * Run every ledger step of a task with one model, in order, without a person in between: the report router
 * (a proposed scope is completed with the code's investigation chapters and saved for the ledger header),
 * candidate discovery with duplicate review, the content attachment plan, thin attachment of every unit, and
 * the ledger build with validation. Each step runs through the same functions as the manual panels, so its
 * artifacts appear there. A step starts only when the calls and tokens left in `options.budget` cover its
 * reserved worst case; the run stops with an error otherwise or when a step fails.
 */
export async function runLedgerPipeline(
  taskId: string,
  options: LedgerTaskOptions,
  hooks: {
    onStep: (step: LedgerPipelineStep) => void;
    log: (message: string) => void;
    abortSignal?: AbortSignal;
  },
) {
  const { modelId, budget } = options;
  const { onStep, log, abortSignal } = hooks;
  const used: Usage = { calls: 0, totalTokens: 0 };
  const left = () => ({
    calls: budget.maxCalls - used.calls,
    totalTokens: budget.maxTotalTokens - used.totalTokens,
  });
  const require = (step: string, calls: number, totalTokens: number) => {
    const l = left();
    if (l.calls < calls || l.totalTokens < totalTokens)
      throw new Error(
        `${step} needs up to ${calls} calls and ${totalTokens} tokens, but the run has ${l.calls} calls and ${l.totalTokens} tokens left`,
      );
  };

  // 1. report profile: one router call
  onStep('report-profile');
  require('Report router', 1, 50_000);
  log(`Classifying the report with ${modelId}...`);
  const router = await runReportRouter(taskId, modelId);
  used.calls += 1;
  used.totalTokens += router.usage.totalTokens;
  const stored = await getReportProfile(taskId);
  log(
    `Report profile ${router.profileSaved ? 'saved' : 'not saved'} (${router.usage.totalTokens} tokens)`,
  );
  abortSignal?.throwIfAborted();

  // 2. candidate discovery and duplicate review
  onStep('candidate-discovery');
  const raw = readFileSync(paths.task(taskId).inputJson);
  const document = parseLedgerInputText(raw.toString('utf8'));
  const index = buildDocumentResourceIndex(document);
  // a person-decided profile scope is used as is; a router proposal is completed with the investigation
  // chapters the code finds by title, so a chapter the router left out does not drop its records
  const decided = !!stored && stored.profile.scopeStatus !== 'proposed';
  const completion = decided
    ? null
    : completeReportScope(
        index,
        collectReportSignals(document, index, {
          inputSha256: createHash('sha256').update(raw).digest('hex'),
        }),
        stored?.profile.scopeChapterIds ?? [],
      );
  const scope = completion?.scopeChapterIds ?? stored!.profile.scopeChapterIds;
  if (!scope.length)
    throw new Error(
      'No discovery scope: no profile scope and no investigation chapter',
    );
  if (completion) saveDiscoveryScope(taskId, completion);
  const scopeChapterId = scope.length === 1 ? scope[0] : scope;
  const units = prepareCandidateDiscovery(index, {
    scopeChapterId,
    ...DISCOVERY,
    maxTextChars: discoveryMaxTextChars(modelId),
    inputSha256: 'count',
  }).units.length;
  require('Candidate discovery', units * RESERVE.callsPerDiscoveryUnit +
    1, units * RESERVE.tokensPerDiscoveryUnit + RESERVE.deduplicationTokens);
  log(
    completion
      ? `Discovering candidates in ${units} units of ${scope.join(', ')} (router proposal ${completion.proposedChapterIds.join(', ') || 'none'}; added from investigation chapters: ${completion.addedChapterIds.join(', ') || 'none'})...`
      : `Discovering candidates in ${units} units of ${scope.join(', ')} (profile scope)...`,
  );
  await startCandidateDiscovery(taskId, {
    scopeChapterId,
    modelId,
    ...DISCOVERY,
    maxTextChars: discoveryMaxTextChars(modelId),
    ...(decided ? { useProfileScope: true } : {}),
  });
  try {
    while (getCandidateDiscoveryRun(taskId)?.status === 'running')
      await sleep(POLL_MS, abortSignal);
  } catch (error) {
    cancelCandidateDiscovery(taskId);
    throw error;
  }
  const discovery = getCandidateDiscoveryRun(taskId)!;
  const discoveryUsed = discoveryUsage(taskId);
  used.calls += discoveryUsed.calls;
  used.totalTokens += discoveryUsed.totalTokens;
  if (discovery.status !== 'completed')
    throw new Error(
      `Candidate discovery ${discovery.status}: ${discovery.error ?? ''}`,
    );
  log(
    `Found ${discovery.result.candidates.length} candidates in ${discovery.deduplication?.groups.length ?? 0} groups (${discoveryUsed.calls} calls, ${discoveryUsed.totalTokens} tokens)`,
  );

  // 3. content attachment plan (no calls) and thin attachment of every unit
  onStep('content-attachment');
  const plan = await prepareContentAttachmentRun(taskId, {
    maxUnitChars: MAX_UNIT_CHARS,
  });
  const thinBudget = {
    maxCalls: left().calls,
    maxTotalTokens: left().totalTokens - RESERVE.thinTokensInFlight,
  };
  require('Content attachment', 4, RESERVE.thinTokensInFlight + 1);
  log(
    `Attaching source text to ${plan.registryCount} records in ${plan.totalUnits} units (budget ${thinBudget.maxCalls} calls, ${thinBudget.maxTotalTokens} tokens)...`,
  );
  startContentAttachmentThin(taskId, thinBudget, modelId);
  try {
    while (getContentAttachmentThinState(taskId)?.status === 'running')
      await sleep(POLL_MS, abortSignal);
  } catch (error) {
    stopContentAttachmentThin(taskId);
    throw error;
  }
  const thin = getContentAttachmentThinState(taskId)!;
  used.calls += thin.usage.calls;
  used.totalTokens += thin.usage.totalTokens;
  if (thin.status !== 'completed')
    throw new Error(
      `Content attachment ${thin.status}: ${thin.stoppedBy ?? 'unknown'}`,
    );
  log(
    `Attached ${thin.summary?.excerpts ?? 0} excerpts (${thin.usage.calls} calls, ${thin.usage.totalTokens} tokens)`,
  );

  // 4. ledger build and validation (no calls)
  onStep('ledger-build');
  const view = await getArchaeologyLedger(taskId);
  if (!view) throw new Error('The ledger could not be assembled');
  const { ledger } = view;
  log(
    `Ledger: ${ledger.records.length} records, ${ledger.attributes.length} attributes, ${ledger.mediaReferences.length} media links, ${ledger.links.length} links, ${ledger.reviewItems.length} review items; validation ${ledger.ledger.validationStatus}`,
  );
  log(
    `Model usage: ${used.calls} calls, ${used.totalTokens} tokens of ${budget.maxCalls} calls and ${budget.maxTotalTokens} tokens`,
  );
  return { used };
}
