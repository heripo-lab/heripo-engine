import type {
  CandidateDiscoveryAudit,
  CandidateDiscoveryCallResult,
  CandidateDiscoveryUnit,
  SpendGuard,
} from '@heripo/ledger-extractor';

import {
  CANDIDATE_DISCOVERY_PROMPT_VERSION,
  createCandidateDiscoveryFollowUpCall,
  createCandidateDiscoveryUnitCall,
  recordCandidateDiscoveryUnit,
} from '@heripo/ledger-extractor';
import { join } from 'path';

import { runStructuredBatch, toExtendedUsage } from './anthropic-batch';

/** Output limit of a discovery item; the largest saved discovery answer was about 14,500 tokens. */
const BATCH_MAX_OUTPUT_TOKENS = 32_000;

/**
 * Discover candidates in the given units through Anthropic Message Batches at half the price: one batch with the
 * first call of every unit, then one batch with the follow-ups those answers ask for, each item built as the
 * direct call would send it (system prompt marked for the prompt cache). Returns the audit of every unit whose
 * calls all succeeded, and the failures of the others; an errored, expired, truncated or invalid item fails its
 * unit and nothing is repaired.
 */
export async function discoverUnitsByBatch(input: {
  units: Array<{ index: number; unit: CandidateDiscoveryUnit }>;
  modelId: string;
  directory: string;
  abortSignal?: AbortSignal;
  log?: (message: string) => void;
  guard?: SpendGuard;
}): Promise<{
  audits: Array<{ index: number; audit: CandidateDiscoveryAudit }>;
  failures: string[];
}> {
  const { units, modelId } = input;
  const failures: string[] = [];
  const result = (
    answer: Awaited<ReturnType<typeof runStructuredBatch>> extends Map<
      string,
      infer A
    >
      ? A
      : never,
    unit: CandidateDiscoveryUnit,
    followUp: boolean,
  ): CandidateDiscoveryCallResult => ({
    output: answer.output as CandidateDiscoveryAudit['response'],
    usage: toExtendedUsage(answer.usage!, {
      component: 'LedgerCandidateDiscovery',
      phase: 'candidate-discovery',
      modelId,
      metadata: {
        unitId: unit.unitId,
        promptVersion: CANDIDATE_DISCOVERY_PROMPT_VERSION,
        ...(followUp && { followUp: true }),
      },
    }),
    ...(answer.finishReason !== undefined && {
      finishReason: answer.finishReason,
    }),
  });
  const firstCalls = units.map(({ index, unit }) => ({
    customId: `u${index}`,
    ...createCandidateDiscoveryUnitCall(unit),
  }));
  const first = await runStructuredBatch({
    modelId,
    calls: firstCalls,
    batchFile: join(input.directory, 'discovery-batch-first.json'),
    maxOutputTokens: BATCH_MAX_OUTPUT_TOKENS,
    abortSignal: input.abortSignal,
    log: input.log,
    guard: input.guard,
  });
  const answered = units.flatMap(({ index, unit }) => {
    const answer = first.get(`u${index}`)!;
    if (answer.error) {
      failures.push(`${unit.unitId}: ${answer.error}`);
      return [];
    }
    const call = result(answer, unit, false);
    return [
      {
        index,
        unit,
        first: call,
        followUp: createCandidateDiscoveryFollowUpCall(unit, call.output),
      },
    ];
  });
  const asking = answered.filter((a) => a.followUp);
  const second = asking.length
    ? await runStructuredBatch({
        modelId,
        calls: asking.map((a) => ({
          customId: `u${a.index}-f`,
          systemPrompt: a.followUp!.systemPrompt,
          userPrompt: a.followUp!.userPrompt,
          schema: a.followUp!.schema,
        })),
        batchFile: join(input.directory, 'discovery-batch-follow-up.json'),
        maxOutputTokens: BATCH_MAX_OUTPUT_TOKENS,
        abortSignal: input.abortSignal,
        log: input.log,
        guard: input.guard,
      })
    : new Map();
  const audits = answered.flatMap(({ index, unit, first: call, followUp }) => {
    if (!followUp)
      return [{ index, audit: recordCandidateDiscoveryUnit(unit, call) }];
    const answer = second.get(`u${index}-f`)!;
    if (answer.error) {
      failures.push(`${unit.unitId} follow-up: ${answer.error}`);
      return [];
    }
    return [
      {
        index,
        audit: recordCandidateDiscoveryUnit(
          unit,
          call,
          result(answer, unit, true),
        ),
      },
    ];
  });
  return { audits, failures };
}
