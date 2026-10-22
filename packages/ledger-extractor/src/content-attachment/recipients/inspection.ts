import type { ContentAttachmentSegmentationAudit } from './segmentation';
import type {
  ContentAttachmentAreaRecipientResponse,
  ContentAttachmentDerivedRecipientResponse,
  ContentAttachmentRecipientAudit,
  ContentAttachmentRecipientFinding,
  ContentAttachmentRecipientResponse,
  Input,
} from './types';

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
      audit.version === 'segment-recipients.v1' ||
        audit.version === 'segment-recipients.v2' ||
        audit.version === 'segment-recipients.v3' ||
        audit.version === 'segment-recipients.v4' ||
        audit.version === 'segment-recipients.v5' ||
        audit.version === 'segment-recipients.v6' ||
        audit.version === 'segment-recipients.v7' ||
        audit.version === 'segment-recipients.v8' ||
        audit.version === 'segment-recipients.v9' ||
        audit.version === 'segment-recipients.v10' ||
        audit.version === 'segment-recipients.v11' ||
        audit.version === 'segment-recipients.v12' ||
        audit.version === 'segment-recipients.v13' ||
        audit.version === 'segment-recipients.v14' ||
        audit.version === 'segment-recipients.v15' ||
        audit.version === 'segment-recipients.v16' ||
        audit.version === 'segment-recipients.v17' ||
        audit.version === 'segment-recipients.v18' ||
        audit.version === 'segment-recipients.v19' ||
        audit.version === 'segment-recipients.v20' ||
        audit.version === 'segment-recipients.v21' ||
        audit.version === 'segment-recipients.v22' ||
        audit.version === 'segment-recipients.v23' ||
        audit.version === 'segment-recipients.v24' ||
        audit.version === 'segment-recipients.v25'
        ? audit.version
        : CONTENT_ATTACHMENT_RECIPIENT_VERSION,
    );
  } catch {
    return { issues: ['Invalid recipient source input'], findings: [] };
  }
  const parsed = request.schema.safeParse(audit.rawResponse);
  if (
    !parsed.success &&
    (audit.version === 'segment-recipients.v14' ||
      audit.version === 'segment-recipients.v15' ||
      audit.version === 'segment-recipients.v16' ||
      audit.version === 'segment-recipients.v17' ||
      audit.version === 'segment-recipients.v18' ||
      audit.version === 'segment-recipients.v19' ||
      audit.version === 'segment-recipients.v20' ||
      audit.version === 'segment-recipients.v21' ||
      audit.version === 'segment-recipients.v22' ||
      audit.version === 'segment-recipients.v23' ||
      audit.version === 'segment-recipients.v24' ||
      audit.version === 'segment-recipients.v25' ||
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
