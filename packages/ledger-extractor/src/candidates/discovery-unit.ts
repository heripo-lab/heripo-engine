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

/** A single bounded model call, with complete prompts and response available for replay. */
export async function discoverCandidateUnit(
  unit: CandidateDiscoveryUnit,
  options: {
    model: LanguageModel;
    maxRetries: number;
    abortSignal?: AbortSignal;
  },
): Promise<CandidateDiscoveryAudit> {
  const { userPrompt } = createCandidateDiscoveryRequest(unit);
  const { output, usage, finishReason, structuredAttempts } =
    await LLMCaller.call({
      schema: createCandidateDiscoverySchema(unit),
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
      },
    });
  return {
    unitId: unit.unitId,
    promptVersion: CANDIDATE_DISCOVERY_PROMPT_VERSION,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    response: output,
    usage,
    ...(finishReason !== undefined && { finishReason }),
    ...(structuredAttempts !== undefined && { structuredAttempts }),
  };
}
