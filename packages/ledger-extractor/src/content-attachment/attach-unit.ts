import type { LLMCallAttempt } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { ContentAttachmentIndependentReviewAudit } from './review/independent-review-types';
import type {
  AttachmentUnit,
  ContentAttachmentPlan,
  ContentAttachmentSelectionAudit,
} from './types';

import {
  LLMCaller,
  LLMTokenUsageAggregator,
  createAuditedModel,
} from '@heripo/shared';

import { createContentAttachmentGroundedInput } from './grounding';
import { CONTENT_ATTACHMENT_PROMPT_VERSION } from './prompts';
import { createContentAttachmentRequest } from './request';
import {
  createContentAttachmentResponseSchema,
  flattenContentAttachmentResponse,
} from './response';
import { createContentAttachmentIndependentReviewRequest } from './review/independent-review-request';

export async function attachContentUnit(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
  options: {
    model: LanguageModel;
    maxRetries: number;
    abortSignal?: AbortSignal;
    onAttempt?: (attempt: LLMCallAttempt) => void | Promise<void>;
  },
): Promise<ContentAttachmentSelectionAudit> {
  if (!unit.sources.length) throw new Error('No selectable attachment sources');
  const input = createContentAttachmentGroundedInput(plan, unit);
  const ids = input.codeMap.excerpts.map((e) => e.ref);
  if (!ids.length) throw new Error('No selectable attachment sources');
  const request = createContentAttachmentRequest(plan, unit);
  const audited = createAuditedModel(options.model, options.onAttempt);
  const { output, usage } = await LLMCaller.call({
    ...request,
    schema: createContentAttachmentResponseSchema(
      ids,
      plan.registry.map((r) => r.ref),
    ),
    primaryModel: audited.model,
    maxRetries: options.maxRetries,
    abortSignal: options.abortSignal,
    component: 'LedgerContentAttachment',
    phase: 'content-attachment',
    metadata: {
      unitId: unit.unitId,
      promptVersion: CONTENT_ATTACHMENT_PROMPT_VERSION,
    },
  });
  const reviewRequest = createContentAttachmentIndependentReviewRequest(
    input,
    output,
    {
      segmentReview: true,
      wordEvidence: true,
      sourceGroundedCoverage: true,
      includeBodyContext: true,
      qualifyBeforeIdentity: true,
      reconcileRecipientRefs: true,
      crossChapterAreas: true,
      preserveAreaWork: true,
      preserveAreaResults: true,
      boundAreaResultRecipients: true,
      reviewTableWork: true,
      traceAreaRecording: true,
      boundAreaRecording: true,
      checkClauseGrounds: true,
      gateQualifierStage: true,
      preserveTentativeMembership: true,
    },
  );
  let independentReview: ContentAttachmentIndependentReviewAudit | undefined;
  if (reviewRequest.required.length) {
    const offset = audited.attempts.length;
    const reviewModel = createAuditedModel(options.model, (attempt) =>
      options.onAttempt?.({ ...attempt, sequence: offset + attempt.sequence }),
    );
    const review = await LLMCaller.call({
      systemPrompt: reviewRequest.systemPrompt,
      userPrompt: reviewRequest.userPrompt,
      schema: reviewRequest.schema,
      primaryModel: reviewModel.model,
      maxRetries: options.maxRetries,
      abortSignal: options.abortSignal,
      component: 'LedgerContentAttachment',
      phase: 'content-attachment-independent-review',
      metadata: {
        unitId: unit.unitId,
        promptVersion: CONTENT_ATTACHMENT_PROMPT_VERSION,
      },
    });
    independentReview = {
      segmentReview: reviewRequest.segmentReview,
      wordEvidence: reviewRequest.wordEvidence,
      coverage: reviewRequest.coverage,
      systemPrompt: reviewRequest.systemPrompt,
      userPrompt: reviewRequest.userPrompt,
      rawResponse: review.output,
      usage: review.usage,
      callAttempts: reviewModel.attempts.map((attempt) => ({
        ...attempt,
        sequence: offset + attempt.sequence,
      })),
    };
  }
  const totals = new LLMTokenUsageAggregator();
  totals.track(usage);
  if (independentReview) totals.track(independentReview.usage);
  return {
    unitId: unit.unitId,
    ...request,
    ...(independentReview ? { independentReview, selectionUsage: usage } : {}),
    response: flattenContentAttachmentResponse(output),
    rawResponse: output,
    usage: { ...usage, ...totals.getTotalUsage() },
    callAttempts: audited.attempts,
    codeMap: input.codeMap,
  };
}
