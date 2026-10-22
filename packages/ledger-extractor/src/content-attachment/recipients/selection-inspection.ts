import type { ContentAttachmentCollectiveTrace } from './collective-trace';
import type { inspectContentAttachmentRecipients } from './inspection';
import type { createContentAttachmentRecipientRequest } from './request';
import type { ContentAttachmentSegmentationAudit } from './segmentation';
import type {
  CandidateRow,
  ContentAttachmentAreaRecipientDecision,
  ContentAttachmentAreaRecipientResponse,
  ContentAttachmentDerivedRecipientResponse,
  ContentAttachmentRecipientAudit,
  ContentAttachmentRecipientDecision,
  ContentAttachmentRecipientFinding,
  ContentAttachmentRecipientResponse,
  ContentAttachmentRecipientSupport,
  Input,
} from './types';
import type { ContentAttachmentWordEvidenceSnapshot } from './word-evidence';

import { inspectContentAttachmentAreaAssessments } from './area-assessments';
import { assembleContentAttachmentAreaRecipientDecision } from './area-recipient-assembly';
import { inspectContentAttachmentCollectiveTrace } from './collective-trace';
import { resolveContentAttachmentInventoryContexts } from './inventory-reviews';
import { CONTENT_ATTACHMENT_RECIPIENT_VERSION } from './prompt';
import { resolveContentAttachmentWordRange } from './word-evidence';
import { inspectContentAttachmentWorkGroupReviews } from './work-group-reviews';
import { inspectContentAttachmentWorkScope } from './work-scope';

/** Apply unchanged selection checks only after the caller verifies its request and source snapshot. */
export function inspectContentAttachmentRecipientSelections(
  input: Input,
  segmentation: ContentAttachmentSegmentationAudit,
  audit: ContentAttachmentRecipientAudit<
    ContentAttachmentRecipientResponse | ContentAttachmentAreaRecipientResponse
  >,
  request: ReturnType<typeof createContentAttachmentRecipientRequest>,
  response:
    ContentAttachmentRecipientResponse | ContentAttachmentAreaRecipientResponse,
  wordEvidence: ContentAttachmentWordEvidenceSnapshot = segmentation.wordEvidence,
): ReturnType<typeof inspectContentAttachmentRecipients> {
  const findings: ContentAttachmentRecipientFinding[] = [],
    issues: string[] = [];
  const derivedResponse: ContentAttachmentDerivedRecipientResponse = {
    decisions: {},
    attachmentOrigins: {},
  };
  const kinds = new Map(
    (input.payload.candidates as CandidateRow[]).map((row) => [row[0], row[1]]),
  );
  for (const segment of request.segmentSnapshot) {
    try {
      const rawDecision = response.decisions[segment.ref];
      const assembled =
        audit.version === 'segment-recipients.v18' ||
        audit.version === 'segment-recipients.v19' ||
        audit.version === 'segment-recipients.v20' ||
        audit.version === 'segment-recipients.v21' ||
        audit.version === 'segment-recipients.v22' ||
        audit.version === 'segment-recipients.v23' ||
        audit.version === 'segment-recipients.v24' ||
        audit.version === 'segment-recipients.v25' ||
        audit.version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
          ? assembleContentAttachmentAreaRecipientDecision(
              kinds,
              rawDecision as ContentAttachmentAreaRecipientDecision,
            )
          : undefined;
      const decision = assembled
        ? assembled.decision
        : (rawDecision as ContentAttachmentRecipientDecision);
      const attachmentRefs = decision.attachments.map((a) => a.candidateRef);
      if (
        new Set(attachmentRefs).size !== attachmentRefs.length ||
        decision.recipientIdentityAlternatives.some((a) =>
          a.candidateRefs.some((r) => attachmentRefs.includes(r)),
        )
      )
        throw new Error('Conflicting or duplicate recipients');
      const resolve = (
        support: ContentAttachmentRecipientSupport,
        refs: string[],
      ) => {
        if (
          new Set(refs).size !== refs.length ||
          new Set(support.candidateEvidenceRefs).size !==
            support.candidateEvidenceRefs.length ||
          new Set(support.currentWordRanges).size !==
            support.currentWordRanges.length ||
          new Set(support.contextWordRanges).size !==
            support.contextWordRanges.length ||
          new Set(support.originRowRefs).size !== support.originRowRefs.length
        )
          throw new Error('Duplicate support');
        const currentEvidence = support.currentWordRanges.map((r) => {
          const evidence = resolveContentAttachmentWordRange(
            wordEvidence,
            r,
            segment.excerptRef,
          );
          const source = wordEvidence.sources.find(
            (s) => s.ref === segment.excerptRef,
          )!;
          if (
            evidence.basis !== 'direct' ||
            source.words
              .filter(
                (w) =>
                  w.charStart >= evidence.charStart &&
                  w.charEnd <= evidence.charEnd,
              )
              .some(
                (w) =>
                  !segment.evidence.some(
                    (e) => w.charStart >= e.charStart && w.charEnd <= e.charEnd,
                  ),
              )
          )
            throw new Error('Evidence outside segment');
          return evidence;
        });
        const contextEvidence = support.contextWordRanges.map((r) =>
          resolveContentAttachmentWordRange(
            wordEvidence,
            r,
            segment.excerptRef,
          ),
        );
        const grounds = support.candidateEvidenceRefs.map((r) => {
          const binding = request.candidateEvidence.find((b) => b.ref === r);
          if (!binding || !refs.includes(binding.candidateRef))
            throw new Error('Foreign candidate grounds');
          return binding;
        });
        if (refs.some((ref) => !grounds.some((g) => g.candidateRef === ref)))
          throw new Error('Missing candidate grounds');
        if (
          support.originRowRefs.some(
            (r) =>
              !input.payload.originRows.some((row) => row[0] === r) ||
              !input.payload.originAnchors.some(
                (a) => a[1] === r && refs.includes(a[0]),
              ),
          )
        )
          throw new Error('Foreign origin row');
        return {
          candidateRefs: refs,
          currentEvidence,
          contextEvidence,
          candidateEvidence: grounds,
          originRowRefs: support.originRowRefs,
        };
      };
      if (
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
        audit.version === 'segment-recipients.v25' ||
        audit.version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
      ) {
        try {
          inspectContentAttachmentAreaAssessments(
            decision.areaAssessments!,
            decision,
            resolve,
          );
        } catch (error) {
          issues.push(
            `Invalid recipient area assessment: ${segment.ref}: ${(error as Error).message}`,
          );
          continue;
        }
      }
      if (
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
        audit.version === 'segment-recipients.v25' ||
        audit.version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
      ) {
        try {
          if (
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
            audit.version === 'segment-recipients.v25' ||
            audit.version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
          )
            inspectContentAttachmentWorkGroupReviews(
              request.workGroups!,
              decision.workScopeAssessment!,
              attachmentRefs,
              audit.version === 'segment-recipients.v17' ||
                audit.version === 'segment-recipients.v18' ||
                audit.version === 'segment-recipients.v19' ||
                audit.version === 'segment-recipients.v20' ||
                audit.version === 'segment-recipients.v21' ||
                audit.version === 'segment-recipients.v22' ||
                audit.version === 'segment-recipients.v23' ||
                audit.version === 'segment-recipients.v24' ||
                audit.version === 'segment-recipients.v25' ||
                audit.version === CONTENT_ATTACHMENT_RECIPIENT_VERSION,
            );
          inspectContentAttachmentWorkScope(
            decision.workScopeAssessment!,
            attachmentRefs,
            resolve,
            audit.version === 'segment-recipients.v17' ||
              audit.version === 'segment-recipients.v18' ||
              audit.version === 'segment-recipients.v19' ||
              audit.version === 'segment-recipients.v20' ||
              audit.version === 'segment-recipients.v21' ||
              audit.version === 'segment-recipients.v22' ||
              audit.version === 'segment-recipients.v23' ||
              audit.version === 'segment-recipients.v24' ||
              audit.version === 'segment-recipients.v25' ||
              audit.version === CONTENT_ATTACHMENT_RECIPIENT_VERSION,
          );
        } catch (error) {
          issues.push(
            `Invalid recipient work scope: ${segment.ref}: ${(error as Error).message}`,
          );
          continue;
        }
      }
      if (audit.version !== 'segment-recipients.v1')
        inspectContentAttachmentCollectiveTrace(
          input,
          segmentation,
          segment,
          decision as ContentAttachmentCollectiveTrace,
          request.candidateEvidence,
          decision,
          wordEvidence,
        );
      findings.push({
        segmentRef: segment.ref,
        ...(audit.version === 'segment-recipients.v9' ||
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
        audit.version === 'segment-recipients.v25' ||
        audit.version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
          ? { areaAssessments: decision.areaAssessments }
          : {}),
        ...(audit.version === 'segment-recipients.v8' ||
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
        audit.version === 'segment-recipients.v25' ||
        audit.version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
          ? { workScopeAssessment: decision.workScopeAssessment }
          : {}),
        ...(audit.version === 'segment-recipients.v4' ||
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
        audit.version === 'segment-recipients.v25' ||
        audit.version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
          ? {
              inventoryContexts:
                resolveContentAttachmentInventoryContexts(input),
            }
          : {}),
        ...(audit.version !== 'segment-recipients.v1'
          ? {
              collectiveTrace: {
                ...(decision.inventoryReviews
                  ? { inventoryReviews: decision.inventoryReviews }
                  : {}),
                collectiveAssessment: decision.collectiveAssessment!,
                qualifierAssessment: decision.qualifierAssessment!,
                inventoryMembershipLinks: decision.inventoryMembershipLinks!,
              },
            }
          : {}),
        excerptRef: segment.excerptRef,
        attachments: decision.attachments.map((a) =>
          resolve(a, [a.candidateRef]),
        ),
        recipientIdentityAlternatives:
          decision.recipientIdentityAlternatives.map((a) =>
            resolve(a, a.candidateRefs),
          ),
        relationshipSubjectAlternatives:
          decision.relationshipSubjectAlternatives.map((a) =>
            resolve(a, a.candidateRefs),
          ),
      });
      if (assembled) {
        derivedResponse.decisions[segment.ref] = assembled.decision;
        derivedResponse.attachmentOrigins[segment.ref] =
          assembled.attachmentOrigins;
      }
    } catch {
      issues.push(`Invalid recipient evidence or dispositions: ${segment.ref}`);
    }
  }
  return {
    issues,
    findings,
    ...(audit.version === 'segment-recipients.v18' ||
    audit.version === 'segment-recipients.v19' ||
    audit.version === 'segment-recipients.v20' ||
    audit.version === 'segment-recipients.v21' ||
    audit.version === 'segment-recipients.v22' ||
    audit.version === 'segment-recipients.v23' ||
    audit.version === 'segment-recipients.v24' ||
    audit.version === 'segment-recipients.v25' ||
    audit.version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
      ? { derivedResponse }
      : {}),
  };
}
