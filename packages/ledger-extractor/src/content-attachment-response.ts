import type { ContentAttachmentSelectionResponse } from './content-attachment';

import { z } from 'zod';

export function contentAttachmentDecisionSchema(candidate: z.ZodType<string>) {
  const reason = z.string().min(1);
  const uncertainty = z.strictObject({
    candidateRefs: z.array(candidate),
    reason,
  });
  return z.union([
    z.strictObject({
      status: z.literal('assigned'),
      candidateRefs: z.array(candidate).min(1),
      reason,
      unresolved: uncertainty.nullable(),
    }),
    z.strictObject({ status: z.literal('unresolved'), ...uncertainty.shape }),
    z.strictObject({ status: z.literal('ignored'), reason }),
  ]);
}

export interface ContentAttachmentRequiredResponse {
  decisions: Record<
    string,
    z.infer<ReturnType<typeof contentAttachmentDecisionSchema>>
  >;
}

/** Every original E is a required key; shared definitions avoid repeating the registry enum. */
export function createContentAttachmentResponseSchema(
  excerptRefs: string[],
  candidateRefs: string[],
): z.ZodType<ContentAttachmentRequiredResponse> {
  const candidate = z
    .enum(candidateRefs as [string, ...string[]])
    .meta({ id: 'ContentAttachmentCandidate' });
  const decision = contentAttachmentDecisionSchema(candidate).meta({
    id: 'ContentAttachmentDecision',
  });
  return z.strictObject({
    decisions: z.strictObject(
      Object.fromEntries(excerptRefs.map((ref) => [ref, decision])),
    ),
  });
}

/** Lossless format projection only: never select, remove or repair semantic targets. */
export function flattenContentAttachmentResponse(
  response: ContentAttachmentRequiredResponse,
): ContentAttachmentSelectionResponse {
  const result: ContentAttachmentSelectionResponse = {
    assignments: [],
    unresolved: [],
    ignored: [],
  };
  for (const [excerptRef, decision] of Object.entries(response.decisions)) {
    if (decision.status === 'ignored') {
      result.ignored.push({ excerptRef, reason: decision.reason });
    } else if (decision.status === 'unresolved') {
      result.unresolved.push({
        excerptRef,
        candidateRefs: [...decision.candidateRefs],
        reason: decision.reason,
      });
    } else {
      result.assignments.push({
        excerptRef,
        candidateRefs: [...decision.candidateRefs],
        reason: decision.reason,
      });
      if (decision.unresolved !== null)
        result.unresolved.push({
          excerptRef,
          candidateRefs: [...decision.unresolved.candidateRefs],
          reason: decision.unresolved.reason,
        });
    }
  }
  return result;
}
