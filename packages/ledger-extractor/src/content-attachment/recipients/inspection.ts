import type { ContentAttachmentSegmentationAudit } from './segmentation';
import type {
  ContentAttachmentAreaRecipientResponse,
  ContentAttachmentDerivedRecipientResponse,
  ContentAttachmentRecipientAudit,
  ContentAttachmentRecipientFinding,
  ContentAttachmentRecipientResponse,
  Input,
} from './types';

import { isContentAttachmentRecipientVersionBetween } from './prompt';
import { CONTENT_ATTACHMENT_RECIPIENT_VERSION } from './prompt';
import { createContentAttachmentRecipientRequest } from './request';
import { inspectContentAttachmentRecipientSelections } from './selection-inspection';

/** Validate references and preview recipients while preserving the raw response and original E text. */
export function inspectContentAttachmentRecipients(
  input: Input,
  segmentation: ContentAttachmentSegmentationAudit,
  audit: ContentAttachmentRecipientAudit<
    ContentAttachmentRecipientResponse | ContentAttachmentAreaRecipientResponse
  >,
): {
  issues: string[];
  findings: ContentAttachmentRecipientFinding[];
  derivedResponse?: ContentAttachmentDerivedRecipientResponse;
} {
  let request: ReturnType<typeof createContentAttachmentRecipientRequest>;
  try {
    request = createContentAttachmentRecipientRequest(
      input,
      segmentation,
      isContentAttachmentRecipientVersionBetween(audit.version, 1, 25)
        ? audit.version
        : CONTENT_ATTACHMENT_RECIPIENT_VERSION,
    );
  } catch {
    return { issues: ['Invalid recipient source input'], findings: [] };
  }
  const parsed = request.schema.safeParse(audit.rawResponse);
  if (
    !parsed.success &&
    (isContentAttachmentRecipientVersionBetween(audit.version, 14, 25) ||
      audit.version === CONTENT_ATTACHMENT_RECIPIENT_VERSION)
  )
    return {
      issues: parsed.error.issues.map(
        (issue) =>
          `Invalid recipient response: ${issue.path.join('.')}: ${issue.message}`,
      ),
      findings: [],
    };
  if (
    !parsed.success ||
    audit.version !== request.version ||
    audit.systemPrompt !== request.systemPrompt ||
    audit.userPrompt !== request.userPrompt ||
    JSON.stringify(audit.segmentSnapshot) !==
      JSON.stringify(request.segmentSnapshot) ||
    JSON.stringify(audit.candidateEvidence) !==
      JSON.stringify(request.candidateEvidence)
  )
    return {
      issues: ['Invalid recipient response, request or source snapshot'],
      findings: [],
    };
  return inspectContentAttachmentRecipientSelections(
    input,
    segmentation,
    audit,
    request,
    parsed.data,
  );
}
