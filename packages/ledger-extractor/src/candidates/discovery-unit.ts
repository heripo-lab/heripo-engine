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

/**
 * A bounded model call, with complete prompts and responses available for replay. When the response leaves rows (or
 * row blocks) of an item table unanswered, proposes invalid candidates or excludes headings of numbered objects, one
 * follow-up call asks those rows, corrections and headings; both calls stay in the audit.
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
    target: CandidateDiscoveryUnit,
    userPrompt: string,
    followUp: boolean,
  ) =>
    LLMCaller.call({
      schema: createCandidateDiscoverySchema(target),
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
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
  const { userPrompt } = createCandidateDiscoveryRequest(unit);
  const { output, usage, finishReason, structuredAttempts } = await call(
    unit,
    userPrompt,
    false,
  );
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
  const plan = planCandidateDiscoveryFollowUp(
    unit,
    output,
    CANDIDATE_DISCOVERY_PROMPT_VERSION,
  );
  if (!plan) return audit;
  const second = await call(plan.unit, plan.userPrompt, true);
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
