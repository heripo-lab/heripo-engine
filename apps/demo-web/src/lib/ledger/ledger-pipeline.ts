import type { RelationParentJudgment } from '@heripo/ledger-extractor';

import type { LedgerTaskOptions } from './ledger-task-options';

import {
  buildDocumentResourceIndex,
  collectReportSignals,
  completeReportScope,
  judgeRelationParentBatch,
  prepareCandidateDiscovery,
  proposePlaceAliases,
} from '@heripo/ledger-extractor';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { discoveryMaxTextChars } from '~/features/ledger/constants/ledger-run';

import { paths } from '../paths';
import { createModel } from '../processing/model-factory';
import {
  getArchaeologyLedger,
  getParentJudgmentRequests,
  getPlaceAliasProposalRequest,
  saveParentJudgments,
} from './archaeology-ledger';
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
import { usesBatch } from './ledger-task-options';
import { readPlaceAliases, savePlaceAliases } from './place-aliases';
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
  // output reserved per parent judgment call; its answers are a record ID, evidence IDs and a short reason
  parentOutputTokens: 16_000,
  // output reserved per place alias proposal call; its answers are a few rules with statement IDs
  aliasOutputTokens: 16_000,
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
  // a split review saves one audit per model block
  const deduplication = !deduplicationAudit
    ? []
    : 'blocks' in deduplicationAudit
      ? deduplicationAudit.blocks
      : [deduplicationAudit];
  const all = [...audits, ...deduplication];
  return {
    calls: all.reduce((n, a) => n + (a.structuredAttempts ?? 1), 0),
    totalTokens: all.reduce((n, a) => n + (a.usage?.totalTokens ?? 0), 0),
  };
}

/**
 * Run every ledger step of a task with its chosen model, in order, without a person in between: the report router
 * (a proposed scope is completed with the code's investigation chapters and saved for the ledger header),
 * candidate discovery with duplicate review, the content attachment plan, thin attachment of every unit, a
 * two-run place alias proposal when no person's table is saved, a three-run judgment of the parent questions code leaves open (with the attachment model), and the ledger build
 * with validation. Each step runs through the same functions as the manual panels, so its
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
  const { models, budget } = options;
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
  log(`Classifying the report with ${models.router}...`);
  const router = await runReportRouter(taskId, models.router);
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
    maxTextChars: discoveryMaxTextChars(models.discovery),
    inputSha256: 'count',
  }).units.length;
  require('Candidate discovery', units * RESERVE.callsPerDiscoveryUnit +
    1, units * RESERVE.tokensPerDiscoveryUnit + RESERVE.deduplicationTokens);
  log(
    completion
      ? `Discovering candidates in ${units} units of ${scope.join(', ')} (router proposal ${completion.proposedChapterIds.join(', ') || 'none'}; added from investigation chapters: ${completion.addedChapterIds.join(', ') || 'none'})...`
      : `Discovering candidates in ${units} units of ${scope.join(', ')} (profile scope)...`,
  );
  log(
    `Discovery model ${models.discovery}, duplicate review model ${models.deduplication}`,
  );
  await startCandidateDiscovery(taskId, {
    scopeChapterId,
    modelId: models.discovery,
    deduplicationModelId: models.deduplication,
    deduplicationBatch: usesBatch(options, models.deduplication),
    discoveryBatch: usesBatch(options, models.discovery),
    ...DISCOVERY,
    maxTextChars: discoveryMaxTextChars(models.discovery),
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
  // a proposal that failed discovery checks is already left out of the candidates; the run goes on and the
  // ledger lists it as a warning instead of the whole run stopping on it
  const dropped = discovery.result.issues;
  if (dropped.length)
    log(
      `Left out ${dropped.length} discovery proposals that failed their checks: ${dropped.map((d) => d.reason).join('; ')}`,
    );
  const plan = await prepareContentAttachmentRun(taskId, {
    maxUnitChars: MAX_UNIT_CHARS,
    acceptDroppedProposals: true,
  });
  // a batch reserves the worst case of every call it holds before it is sent, so nothing is kept in flight
  const batch = usesBatch(options, models.attachment);
  const inFlight = batch ? 0 : RESERVE.thinTokensInFlight;
  const thinBudget = {
    maxCalls: left().calls,
    maxTotalTokens: left().totalTokens - inFlight,
  };
  require('Content attachment', 4, inFlight + 1);
  log(
    `Attaching source text to ${plan.registryCount} records in ${plan.totalUnits} units with ${models.attachment}${batch ? ' through the Message Batches API' : ''} (budget ${thinBudget.maxCalls} calls, ${thinBudget.maxTotalTokens} tokens)...`,
  );
  startContentAttachmentThin(taskId, thinBudget, models.attachment, { batch });
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

  // 4. place aliases: without a person's table, two runs propose how the report writes its places in short
  // form; rules both runs give alike and code accepts are saved as the task's table (source `model`)
  onStep('ledger-build');
  if (!readPlaceAliases(taskId)) {
    const proposal = await getPlaceAliasProposalRequest(taskId);
    if (proposal) {
      const { plan, ledger, request } = proposal;
      require('Place alias proposal', 2, 2 *
        (request.systemPrompt.length +
          request.userPrompt.length +
          RESERVE.aliasOutputTokens));
      log(
        `Proposing place aliases for ${request.places.length} written places with ${models.attachment}...`,
      );
      abortSignal?.throwIfAborted();
      const result = await proposePlaceAliases(plan, ledger, request, {
        model: createModel(models.attachment),
        maxRetries: 0,
        abortSignal,
      });
      const aliasUsed = result.calls.reduce(
        (n, c) => n + (c.usage?.totalTokens ?? 0),
        0,
      );
      used.calls += result.calls.length;
      used.totalTokens += aliasUsed;
      writeFileSync(
        join(paths.task(taskId).outputRoot, 'place-alias-proposal.json'),
        JSON.stringify(result, null, 2),
      );
      if (result.table) savePlaceAliases(taskId, result.table);
      log(
        result.status === 'failed'
          ? `Place alias proposal failed (${aliasUsed} tokens): ${result.calls
              .map((c) => c.error)
              .filter(Boolean)
              .join('; ')}`
          : `Kept ${result.table?.rules.length ?? 0} place alias rules, dropped ${result.dropped.length} (${result.calls.length} calls, ${aliasUsed} tokens)`,
      );
    }
  }

  // 5. parent judgment: the parent questions code leaves open, three runs per batch, saved beside the plan
  const parentRequests = await getParentJudgmentRequests(taskId);
  if (parentRequests.length) {
    const questions = parentRequests.reduce(
      (n, r) => n + r.questions.length,
      0,
    );
    require('Parent judgment', parentRequests.length * 3, parentRequests.reduce(
      (n, r) =>
        n +
        3 *
          (r.systemPrompt.length +
            r.userPrompt.length +
            RESERVE.parentOutputTokens),
      0,
    ));
    log(
      `Judging ${questions} parent questions in ${parentRequests.length} batches with ${models.attachment}...`,
    );
    const model = createModel(models.attachment);
    const judgments: RelationParentJudgment[] = [];
    const parentUsed: Usage = { calls: 0, totalTokens: 0 };
    for (const request of parentRequests) {
      abortSignal?.throwIfAborted();
      const result = await judgeRelationParentBatch(request, {
        model,
        maxRetries: 0,
        abortSignal,
      });
      for (const call of result.calls) {
        parentUsed.calls++;
        parentUsed.totalTokens += call.usage?.totalTokens ?? 0;
      }
      judgments.push(...result.judgments);
    }
    saveParentJudgments(taskId, judgments);
    used.calls += parentUsed.calls;
    used.totalTokens += parentUsed.totalTokens;
    log(
      `Judged ${judgments.filter((j) => j.status !== 'review').length} of ${questions} parent questions (${parentUsed.calls} calls, ${parentUsed.totalTokens} tokens)`,
    );
  }

  // 6. ledger build and validation (no calls)
  const view = await getArchaeologyLedger(taskId);
  if (!view) throw new Error('The ledger could not be assembled');
  const { ledger } = view;
  log(
    `Ledger: ${ledger.records.length} records, ${ledger.attributes.length} attributes, ${ledger.mediaReferences.length} media links, ${ledger.mediaCandidates.length} same-page image candidates, ${ledger.links.length} links, ${ledger.reviewItems.length} review items; validation ${ledger.ledger.validationStatus}`,
  );
  log(
    `Model usage: ${used.calls} calls, ${used.totalTokens} tokens of ${budget.maxCalls} calls and ${budget.maxTotalTokens} tokens`,
  );
  return { used };
}
