import type { ExtendedTokenUsage } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type {
  CandidateDiscoveryAudit,
  CandidateDiscoveryUnit,
} from './discovery-types';

import { LLMCaller } from '@heripo/shared';

import {
  CANDIDATE_DISCOVERY_PROMPT_VERSION,
  SYSTEM_PROMPT,
  createCandidateDiscoveryRequest,
  createCandidateDiscoverySchema,
} from './discovery-request';
import { planCandidateDiscoveryFollowUp } from './discovery-validation';

const addUsage = (
  a: ExtendedTokenUsage,
  b: ExtendedTokenUsage,
): ExtendedTokenUsage => ({
  ...a,
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  totalTokens: a.totalTokens + b.totalTokens,
  ...((a.reasoningTokens ?? b.reasoningTokens) !== undefined && {
    reasoningTokens: (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0),
  }),
});

/** The structured output and usage of one discovery call, however it was sent. */
export interface CandidateDiscoveryCallResult {
  output: CandidateDiscoveryAudit['response'];
  usage: ExtendedTokenUsage;
  finishReason?: string;
  structuredAttempts?: number;
}

/** The first call of a unit: the fixed system prompt, the unit's user prompt and its response schema. */
export function createCandidateDiscoveryUnitCall(unit: CandidateDiscoveryUnit) {
  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: createCandidateDiscoveryRequest(unit).userPrompt,
    schema: createCandidateDiscoverySchema(unit),
  };
}

/**
 * The follow-up call a first response asks for (unanswered rows or row blocks, invalid candidates, excluded
 * headings, unanswered numbered blocks), or null when it needs none.
 */
export function createCandidateDiscoveryFollowUpCall(
  unit: CandidateDiscoveryUnit,
  first: CandidateDiscoveryAudit['response'],
) {
  const plan = planCandidateDiscoveryFollowUp(
    unit,
    first,
    CANDIDATE_DISCOVERY_PROMPT_VERSION,
  );
  return plan
    ? {
        plan,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: plan.userPrompt,
        schema: createCandidateDiscoverySchema(plan.unit),
      }
    : null;
}

/**
 * The audit of a unit from its first call and, when the first response asks for one, its follow-up. Throws when a
 * follow-up is needed but missing, or given but not needed, so a saved audit always replays.
 */
export function recordCandidateDiscoveryUnit(
  unit: CandidateDiscoveryUnit,
  first: CandidateDiscoveryCallResult,
  second?: CandidateDiscoveryCallResult,
): CandidateDiscoveryAudit {
  const { userPrompt } = createCandidateDiscoveryUnitCall(unit);
  const { output, usage, finishReason, structuredAttempts } = first;
  const audit: CandidateDiscoveryAudit = {
    unitId: unit.unitId,
    promptVersion: CANDIDATE_DISCOVERY_PROMPT_VERSION,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    response: output,
    usage,
    ...(finishReason !== undefined && { finishReason }),
    ...(structuredAttempts !== undefined && { structuredAttempts }),
  };
  const followUp = createCandidateDiscoveryFollowUpCall(unit, output);
  if (!followUp !== !second)
    throw new Error(
      followUp
        ? `Unit ${unit.unitId} needs its follow-up call`
        : `Unit ${unit.unitId} needs no follow-up call`,
    );
  if (!followUp || !second) return audit;
  const { plan } = followUp;
  return {
    ...audit,
    usage: addUsage(usage, second.usage),
    structuredAttempts:
      (structuredAttempts ?? 1) + (second.structuredAttempts ?? 1),
    followUp: {
      rowIndexes: plan.rowIndexes,
      ...(plan.rowBlocks.length > 0 && { rowBlocks: plan.rowBlocks }),
      ...(plan.corrections.length > 0 && { corrections: plan.corrections }),
      ...(plan.reconsiderations.length > 0 && {
        reconsiderations: plan.reconsiderations,
      }),
      ...(plan.numberedBlocks.length > 0 && {
        numberedBlocks: plan.numberedBlocks,
      }),
      userPrompt: plan.userPrompt,
      response: second.output,
      usage: second.usage,
      ...(second.finishReason !== undefined && {
        finishReason: second.finishReason,
      }),
      ...(second.structuredAttempts !== undefined && {
        structuredAttempts: second.structuredAttempts,
      }),
    },
  };
}

/**
 * A bounded model call, with complete prompts and responses available for replay. When the response leaves rows (or
 * row blocks) of an item table unanswered, proposes invalid candidates or excludes headings of numbered objects, one
 * follow-up call asks those rows, corrections and headings; both calls stay in the audit. Every unit shares the
 * system prompt, which is marked for the provider's prompt cache.
 */
export async function discoverCandidateUnit(
  unit: CandidateDiscoveryUnit,
  options: {
    model: LanguageModel;
    maxRetries: number;
    abortSignal?: AbortSignal;
  },
): Promise<CandidateDiscoveryAudit> {
  const call = (
    request: ReturnType<typeof createCandidateDiscoveryUnitCall>,
    followUp: boolean,
  ) =>
    LLMCaller.call({
      schema: request.schema,
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      cacheSystemPrompt: true,
      primaryModel: options.model,
      maxRetries: options.maxRetries,
      abortSignal: options.abortSignal,
      component: 'LedgerCandidateDiscovery',
      phase: 'candidate-discovery',
      metadata: {
        unitId: unit.unitId,
        promptVersion: CANDIDATE_DISCOVERY_PROMPT_VERSION,
        ...(followUp && { followUp: true }),
      },
    });
  const first = await call(createCandidateDiscoveryUnitCall(unit), false);
  const followUp = createCandidateDiscoveryFollowUpCall(unit, first.output);
  return recordCandidateDiscoveryUnit(
    unit,
    first,
    followUp ? await call(followUp, true) : undefined,
  );
}
