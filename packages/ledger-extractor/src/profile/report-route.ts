import type { ProcessedDocument } from '@heripo/model';
import type { LLMCallAttempt } from '@heripo/shared';
import type { LanguageModel, LanguageModelUsage } from 'ai';

import type { DocumentResourceIndex } from '../resources/document-resource-index';
import type { ReportProfile } from './report-profile';
import type {
  ReportProfileProposal,
  ReportRouterRequest,
} from './report-router';
import type { ReportSignals } from './report-signals';

import { createAuditedModel } from '@heripo/shared';
import { Output, generateText, jsonSchema } from 'ai';

import {
  REPORT_PROFILE_VERSION,
  REPORT_TRAIT_IDS,
  validateReportProfile,
} from './report-profile';
import {
  createReportRouterRequest,
  inspectReportRouterResponse,
} from './report-router';
import { collectReportSignals } from './report-signals';

/** One router call with its exact request, the parsed output as returned, usage and the code inspection. */
export interface ReportRouterCall {
  status: 'completed' | 'failed';
  request: ReportRouterRequest;
  signals: ReportSignals;
  /** Parsed structured output exactly as returned; never repaired. */
  rawResponse?: unknown;
  usage?: LanguageModelUsage;
  finishReason?: string;
  error?: string;
  callAttempts: LLMCallAttempt[];
  inspection?: ReturnType<typeof inspectReportRouterResponse>;
}
export interface ReportRouterRunOptions {
  model: LanguageModel;
  /** Transient-error retries; the default 0 sends the call once. */
  maxRetries?: number;
  abortSignal?: AbortSignal;
  onAttempt?: (attempt: LLMCallAttempt) => void;
}

/**
 * Judge report traits and scope chapters with one router call. The call is sent once (no retries unless
 * `maxRetries` says so) and a failure is returned, not thrown. Persistence and budgets stay with the caller.
 */
export async function routeReport(
  index: DocumentResourceIndex,
  signals: ReportSignals,
  options: ReportRouterRunOptions,
): Promise<ReportRouterCall> {
  const request = createReportRouterRequest(index, signals);
  const audited = createAuditedModel(options.model, options.onAttempt);
  try {
    const response = await generateText({
      model: audited.model,
      output: Output.object({
        schema: jsonSchema(
          request.providerOutputSchema as Parameters<typeof jsonSchema>[0],
        ),
      }),
      system: request.systemPrompt,
      prompt: request.userPrompt,
      maxRetries: options.maxRetries ?? 0,
      abortSignal: options.abortSignal,
    });
    return {
      status: 'completed',
      request,
      signals,
      rawResponse: response.output,
      usage: response.usage,
      finishReason: response.finishReason,
      callAttempts: audited.attempts,
      inspection: inspectReportRouterResponse(request, response.output),
    };
  } catch (error) {
    return {
      status: 'failed',
      request,
      signals,
      error: error instanceof Error ? error.message : String(error),
      callAttempts: audited.attempts,
    };
  }
}

/**
 * Turn a router proposal into a report profile (`source: 'router'`). Only a trait the router judged once,
 * without problems and with high confidence keeps its value; any other trait becomes `unclear`, so the thin
 * policy marks the branches it drives as needing a decision. The proposed scope stays a proposal
 * (`scopeStatus: 'proposed'`) that candidate discovery should not start from; an injected scope replaces it and
 * counts as decided. The notes record which traits were set unclear and why, and whether the scope was injected.
 */
export function createReportProfileFromProposal(
  proposal: ReportProfileProposal,
  options: {
    inputSha256: string;
    confirmedAt: string;
    routerRunId?: string;
    scopeChapterIds?: string[];
  },
): ReportProfile {
  const problems: string[] = [];
  const lowConfidence: string[] = [];
  const traits = Object.fromEntries(
    REPORT_TRAIT_IDS.map((id) => {
      const judged = proposal.traits.filter((t) => t.id === id);
      if (judged.length !== 1 || judged[0].issues.length) {
        problems.push(id);
        return [id, 'unclear' as const];
      }
      if (judged[0].value !== 'unclear' && judged[0].confidence !== 'high') {
        lowConfidence.push(id);
        return [id, 'unclear' as const];
      }
      return [id, judged[0].value];
    }),
  );
  const notes = [
    ...(problems.length
      ? [`router traits set unclear for problems: ${problems.join(', ')}`]
      : []),
    ...(lowConfidence.length
      ? [
          `router traits set unclear below high confidence: ${lowConfidence.join(', ')}`,
        ]
      : []),
    options.scopeChapterIds
      ? 'scope injected by the caller'
      : 'scope proposed by the router',
  ];
  return {
    version: REPORT_PROFILE_VERSION,
    inputSha256: options.inputSha256,
    traits,
    scopeChapterIds: [...(options.scopeChapterIds ?? proposal.scopeChapterIds)],
    ...(options.scopeChapterIds ? {} : { scopeStatus: 'proposed' as const }),
    source: 'router',
    ...(options.routerRunId ? { routerRunId: options.routerRunId } : {}),
    confirmedAt: options.confirmedAt,
    notes: notes.join('; '),
  };
}

/**
 * Settle the report profile the way DocumentProcessor settles page ranges and TOC entries: an injected
 * profile skips the router; otherwise one router call proposes it. An injected scope replaces the profile's
 * scope either way. Problems from the router inspection and from profile validation are returned with the
 * profile; nothing is repaired. Without an injected profile a model is required.
 */
export async function prepareReportProfile(
  document: ProcessedDocument,
  index: DocumentResourceIndex,
  options: Partial<ReportRouterRunOptions> & {
    inputSha256: string;
    profile?: ReportProfile;
    scopeChapterIds?: string[];
    routerRunId?: string;
    /** Confirmation time of a router profile; defaults to now. */
    confirmedAt?: string;
  },
): Promise<{
  profile: ReportProfile | null;
  source: 'injected' | 'router';
  call?: ReportRouterCall;
  issues: string[];
}> {
  if (options.profile) {
    // an injected scope is a decided scope
    const { scopeStatus: _scopeStatus, ...decided } = options.profile;
    const profile = options.scopeChapterIds
      ? { ...decided, scopeChapterIds: [...options.scopeChapterIds] }
      : options.profile;
    return {
      profile,
      source: 'injected',
      issues: validateReportProfile(index, options.inputSha256, profile),
    };
  }
  if (!options.model)
    throw new Error('A model is required when no profile is injected');
  const call = await routeReport(
    index,
    collectReportSignals(document, index, {
      inputSha256: options.inputSha256,
    }),
    {
      model: options.model,
      maxRetries: options.maxRetries,
      abortSignal: options.abortSignal,
      onAttempt: options.onAttempt,
    },
  );
  const proposal = call.inspection?.proposal;
  if (!proposal)
    return {
      profile: null,
      source: 'router',
      call,
      issues: call.inspection?.issues ?? [`Router call failed: ${call.error}`],
    };
  const profile = createReportProfileFromProposal(proposal, {
    inputSha256: options.inputSha256,
    confirmedAt: options.confirmedAt ?? new Date().toISOString(),
    routerRunId: options.routerRunId,
    scopeChapterIds: options.scopeChapterIds,
  });
  return {
    profile,
    source: 'router',
    call,
    issues: [
      ...call.inspection!.issues,
      ...validateReportProfile(index, options.inputSha256, profile),
    ],
  };
}
