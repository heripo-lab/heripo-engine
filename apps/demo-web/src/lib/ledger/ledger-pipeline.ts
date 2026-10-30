import type {
  RelationParentJudgment,
  SpendAmount,
} from '@heripo/ledger-extractor';

import type { LedgerTaskOptions } from './ledger-task-options';

import {
  buildDocumentResourceIndex,
  collectReportSignals,
  completeReportScope,
  createSpendGuard,
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
/** Output limit of a place alias proposal or parent judgment call; their answers are a few rules or IDs. */
const SHORT_OUTPUT_TOKENS = 16_000;
const POLL_MS = 2000;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Ledger task was aborted'));
    });
  });

/**
 * Run every ledger step of a task with its chosen model, in order, without a person in between: the report router
 * (a proposed scope is completed with the code's investigation chapters and saved for the ledger header),
 * candidate discovery with duplicate review, the content attachment plan, thin attachment of every unit, a
 * two-run place alias proposal when no person's table is saved, a three-run judgment of the parent questions code leaves open (with the attachment model), and the ledger build
 * with validation. Each step runs through the same functions as the manual panels, so its
 * artifacts appear there. With `options.budget`, one spend guard holds the caps for the whole run: every direct
 * provider attempt (schema retries and concurrent units included) and every Message Batch reserves its worst
 * case before it is sent and is settled with the usage it reports, so the run fails rather than pass a cap;
 * without it the run has no caps. The run also stops when a step fails.
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
  const { models } = options;
  // a task without caps behaves as one whose caps are never reached
  const budget = options.budget ?? {
    maxCalls: Number.MAX_SAFE_INTEGER,
    maxTotalTokens: Number.MAX_SAFE_INTEGER,
  };
  const { onStep, log, abortSignal } = hooks;
  const guard = createSpendGuard(budget);
  // what the guard settled since `from`, for the step logs
  const since = (from: SpendAmount) => {
    const now = guard.used();
    return {
      calls: now.calls - from.calls,
      totalTokens: now.totalTokens - from.totalTokens,
    };
  };
  // steps turn a failed call into a result (a review item, an unsaved profile), so a call the guard refused
  // would leave a smaller ledger behind; the run stops at the first step that met a cap instead
  const stopAtCap = () => {
    const refusal = guard.refused();
    if (refusal)
      throw new Error(`The run stopped at its cap: ${refusal.message}`);
  };

  // 1. report profile: one router call
  onStep('report-profile');
  log(`Classifying the report with ${models.router}...`);
  const router = await runReportRouter(taskId, models.router, { guard });
  stopAtCap();
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
  const beforeDiscovery = guard.used();
  log(
    completion
      ? `Discovering candidates in ${units} units of ${scope.join(', ')} (router proposal ${completion.proposedChapterIds.join(', ') || 'none'}; added from investigation chapters: ${completion.addedChapterIds.join(', ') || 'none'})...`
      : `Discovering candidates in ${units} units of ${scope.join(', ')} (profile scope)...`,
  );
  log(
    `Discovery model ${models.discovery}, duplicate review model ${models.deduplication}`,
  );
  await startCandidateDiscovery(
    taskId,
    {
      scopeChapterId,
      modelId: models.discovery,
      deduplicationModelId: models.deduplication,
      deduplicationBatch: usesBatch(options, models.deduplication),
      discoveryBatch: usesBatch(options, models.discovery),
      ...DISCOVERY,
      maxTextChars: discoveryMaxTextChars(models.discovery),
      ...(decided ? { useProfileScope: true } : {}),
    },
    { guard },
  );
  try {
    while (getCandidateDiscoveryRun(taskId)?.status === 'running')
      await sleep(POLL_MS, abortSignal);
  } catch (error) {
    cancelCandidateDiscovery(taskId);
    throw error;
  }
  const discovery = getCandidateDiscoveryRun(taskId)!;
  const discoveryUsed = since(beforeDiscovery);
  stopAtCap();
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
  // direct calls go through the guard one attempt at a time; batches are sized by the thin run against what is
  // left, so the rest of the run is held for them and settled with what they used
  const batch = usesBatch(options, models.attachment);
  const leftForThin = guard.left();
  const thinBudget = {
    maxCalls: leftForThin.calls,
    maxTotalTokens: leftForThin.totalTokens,
  };
  const thinBefore = getContentAttachmentThinState(taskId)?.usage ?? {
    calls: 0,
    totalTokens: 0,
  };
  const beforeThin = guard.used();
  const thinHold = batch
    ? guard.reserve('Content attachment batches', leftForThin)
    : null;
  log(
    `Attaching source text to ${plan.registryCount} records in ${plan.totalUnits} units with ${models.attachment}${batch ? ' through the Message Batches API' : ''}${options.budget ? ` (budget ${thinBudget.maxCalls} calls, ${thinBudget.maxTotalTokens} tokens)` : ''}...`,
  );
  try {
    startContentAttachmentThin(taskId, thinBudget, models.attachment, {
      batch,
      guard,
    });
    while (getContentAttachmentThinState(taskId)?.status === 'running')
      await sleep(POLL_MS, abortSignal);
  } catch (error) {
    stopContentAttachmentThin(taskId);
    // a batch may still be charged; it keeps the whole hold
    thinHold?.settle(leftForThin);
    throw error;
  }
  const thin = getContentAttachmentThinState(taskId)!;
  thinHold?.settle({
    calls: thin.usage.calls - thinBefore.calls,
    totalTokens: thin.usage.totalTokens - thinBefore.totalTokens,
  });
  const thinUsed = since(beforeThin);
  stopAtCap();
  if (thin.status !== 'completed')
    throw new Error(
      `Content attachment ${thin.status}: ${thin.stoppedBy ?? 'unknown'}`,
    );
  log(
    `Attached ${thin.summary?.excerpts ?? 0} excerpts (${thinUsed.calls} calls, ${thinUsed.totalTokens} tokens)`,
  );

  // 4. place aliases: without a person's table, two runs propose how the report writes its places in short
  // form; rules both runs give alike and code accepts are saved as the task's table (source `model`)
  onStep('ledger-build');
  if (!readPlaceAliases(taskId)) {
    const proposal = await getPlaceAliasProposalRequest(taskId);
    if (proposal) {
      const { plan, ledger, request } = proposal;
      const beforeAlias = guard.used();
      log(
        `Proposing place aliases for ${request.places.length} written places with ${models.attachment}...`,
      );
      abortSignal?.throwIfAborted();
      const result = await proposePlaceAliases(plan, ledger, request, {
        model: guard.wrap(createModel(models.attachment), {
          defaultMaxOutputTokens: SHORT_OUTPUT_TOKENS,
        }),
        maxRetries: 0,
        abortSignal,
      });
      const aliasUsed = since(beforeAlias);
      stopAtCap();
      writeFileSync(
        join(paths.task(taskId).outputRoot, 'place-alias-proposal.json'),
        JSON.stringify(result, null, 2),
      );
      if (result.table) savePlaceAliases(taskId, result.table);
      log(
        result.status === 'failed'
          ? `Place alias proposal failed (${aliasUsed.totalTokens} tokens): ${result.calls
              .map((c) => c.error)
              .filter(Boolean)
              .join('; ')}`
          : `Kept ${result.table?.rules.length ?? 0} place alias rules, dropped ${result.dropped.length} (${aliasUsed.calls} calls, ${aliasUsed.totalTokens} tokens)`,
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
    const beforeParents = guard.used();
    log(
      `Judging ${questions} parent questions in ${parentRequests.length} batches with ${models.attachment}...`,
    );
    const model = guard.wrap(createModel(models.attachment), {
      defaultMaxOutputTokens: SHORT_OUTPUT_TOKENS,
    });
    const judgments: RelationParentJudgment[] = [];
    for (const request of parentRequests) {
      abortSignal?.throwIfAborted();
      const result = await judgeRelationParentBatch(request, {
        model,
        maxRetries: 0,
        abortSignal,
      });
      judgments.push(...result.judgments);
    }
    const parentUsed = since(beforeParents);
    stopAtCap();
    saveParentJudgments(taskId, judgments);
    log(
      `Judged ${judgments.filter((j) => j.status !== 'review').length} of ${questions} parent questions (${parentUsed.calls} calls, ${parentUsed.totalTokens} tokens)`,
    );
  }

  // 6. ledger build and validation (no calls)
  const view = await getArchaeologyLedger(taskId);
  if (!view) throw new Error('The ledger could not be assembled');
  const { ledger } = view;
  log(
    `Ledger: ${ledger.records.length} records, ${ledger.attributes.length} attributes, ${ledger.mediaReferences.length} media links, ${ledger.mediaCandidates.length} same-page image candidates, ${ledger.layerMentions.length} layer mentions, ${ledger.links.length} links, ${ledger.reviewItems.length} review items; validation ${ledger.ledger.validationStatus}`,
  );
  const used = guard.used();
  log(
    `Model usage: ${used.calls} calls, ${used.totalTokens} tokens${options.budget ? ` of ${budget.maxCalls} calls and ${budget.maxTotalTokens} tokens` : ''}`,
  );
  return { used };
}
