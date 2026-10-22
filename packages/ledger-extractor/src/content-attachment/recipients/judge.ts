import type { LLMCallAttempt } from '@heripo/shared';
import type { LanguageModel } from 'ai';
import type { z } from 'zod';

import type { ContentAttachmentSegmentationAudit } from './segmentation';
import type {
  ContentAttachmentAreaRecipientResponse,
  ContentAttachmentRecipientAudit,
  Input,
} from './types';

import { LLMCaller, createAuditedModel } from '@heripo/shared';

import { createContentAttachmentRecipientRequest } from './request';

/** Call only the recipient stage; do not rerun segmentation, earlier selection or ledger assembly. */
export async function judgeContentAttachmentRecipients(
  input: Input,
  segmentation: ContentAttachmentSegmentationAudit,
  options: {
    model: LanguageModel;
    maxRetries: number;
    abortSignal?: AbortSignal;
    onAttempt?: (attempt: LLMCallAttempt) => void | Promise<void>;
  },
): Promise<
  ContentAttachmentRecipientAudit<ContentAttachmentAreaRecipientResponse>
> {
  const request = createContentAttachmentRecipientRequest(input, segmentation);
  const model = createAuditedModel(options.model, options.onAttempt);
  const result = await LLMCaller.call({
    schema: request.schema as z.ZodType<ContentAttachmentAreaRecipientResponse>,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    primaryModel: model.model,
    maxRetries: options.maxRetries,
    abortSignal: options.abortSignal,
    component: 'LedgerContentAttachment',
    phase: 'segment-recipients',
    metadata: {
      version: request.version,
      excerptRefs: segmentation.excerptRefs.join(','),
    },
  });
  return {
    version: request.version,
    segmentSnapshot: request.segmentSnapshot,
    candidateEvidence: request.candidateEvidence,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    rawResponse: result.output,
    usage: result.usage,
    callAttempts: model.attempts,
  };
}
