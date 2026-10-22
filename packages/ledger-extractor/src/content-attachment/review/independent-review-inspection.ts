import type { ContentAttachmentWordRangeEvidence } from '../recipients/word-evidence';
import type { ContentAttachmentRequiredResponse } from '../response';
import type {
  ContentAttachmentIndependentReviewAudit,
  ContentAttachmentReviewFinding,
  Input,
} from './independent-review-types';
import type { ContentAttachmentSegmentFinding } from './segment-review';

import { resolveContentAttachmentWordRange } from '../recipients/word-evidence';
import { createContentAttachmentIndependentReviewRequest } from './independent-review-request';
import {
  inspectContentAttachmentSegmentDecisions,
  inspectContentAttachmentSegments,
} from './segment-review';

/** Resolve exact evidence and retain differences without replacing either model response. */
export function inspectContentAttachmentIndependentReview(
  input: Input,
  selection: ContentAttachmentRequiredResponse,
  audit?: ContentAttachmentIndependentReviewAudit,
  options: {
    segmentReview?: boolean;
    wordEvidence?: boolean;
    sourceGroundedCoverage?: boolean;
    includeBodyContext?: boolean;
    qualifyBeforeIdentity?: boolean;
    reconcileRecipientRefs?: boolean;
    crossChapterAreas?: boolean;
    preserveAreaWork?: boolean;
    preserveAreaResults?: boolean;
    boundAreaResultRecipients?: boolean;
    reviewTableWork?: boolean;
    traceAreaRecording?: boolean;
    boundAreaRecording?: boolean;
    checkClauseGrounds?: boolean;
    gateQualifierStage?: boolean;
    preserveTentativeMembership?: boolean;
  } = {},
): {
  issues: string[];
  findings: ContentAttachmentReviewFinding[];
  disagreements: ContentAttachmentReviewFinding[];
} {
  const request = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    {
      ...options,
      segmentReview:
        options.segmentReview ||
        audit?.segmentReview?.version === 'segment-review.v1',
      wordEvidence:
        options.wordEvidence ||
        audit?.wordEvidence?.version === 'word-ranges.v1',
      sourceGroundedCoverage:
        options.sourceGroundedCoverage ||
        audit?.coverage?.version === 'source-grounded.v1',
    },
  );
  if (!audit && !request.required.length)
    return { issues: [], findings: [], disagreements: [] };
  const parsed = request.schema.safeParse(audit?.rawResponse);
  if (
    !parsed.success ||
    JSON.stringify(audit?.segmentReview) !==
      JSON.stringify(request.segmentReview) ||
    JSON.stringify(audit?.wordEvidence) !==
      JSON.stringify(request.wordEvidence) ||
    audit!.systemPrompt !== request.systemPrompt ||
    audit!.userPrompt !== request.userPrompt
  )
    return {
      issues: [
        'Invalid or missing independent inventory review response or request',
      ],
      findings: [],
      disagreements: [],
    };
  const issues: string[] = [],
    findings: ContentAttachmentReviewFinding[] = [];
  const segmentPlans = new Map<
    string,
    ReturnType<typeof inspectContentAttachmentSegments>
  >();
  if (request.segmentReview) {
    for (const [ref, segments] of Object.entries(parsed.data.segments!)) {
      try {
        segmentPlans.set(
          ref,
          inspectContentAttachmentSegments(
            request.wordEvidence!,
            ref,
            segments,
          ),
        );
      } catch {
        issues.push(`Invalid independent segments: ${ref}`);
      }
    }
  }
  const originalTargets = Object.fromEntries(
    Object.entries(selection.decisions).map(([ref, decision]) => [
      ref,
      {
        assigned: decision.status === 'assigned' ? decision.candidateRefs : [],
        unresolved:
          decision.status === 'unresolved'
            ? decision.candidateRefs
            : decision.status === 'assigned'
              ? (decision.unresolved?.candidateRefs ?? [])
              : [],
      },
    ]),
  );
  for (const r of request.required) {
    const { assigned, unresolved } = originalTargets[r.excerptRef];
    if (request.segmentReview && !segmentPlans.has(r.excerptRef)) continue;
    for (const ref of r.candidateRefs) {
      const review = parsed.data.reviews[r.key][ref];
      if (
        review.contextRef !== r.excerptRef ||
        new Set(review.candidateEvidenceRefs).size !==
          review.candidateEvidenceRefs.length
      ) {
        issues.push(`Invalid independent review provenance: ${r.key}:${ref}`);
        continue;
      }
      let wordEvidence: ContentAttachmentWordRangeEvidence[] | undefined;
      if (request.wordEvidence) {
        try {
          wordEvidence = review.wordRanges!.map((range) =>
            resolveContentAttachmentWordRange(
              request.wordEvidence!,
              range,
              r.excerptRef,
            ),
          );
          if (new Set(review.wordRanges).size !== review.wordRanges!.length)
            throw new Error('Repeated word range');
          if (
            (review.attachment !== 'excluded' ||
              review.relationshipSubject === 'alternative') &&
            !wordEvidence.some((range) => range.basis === 'direct')
          )
            throw new Error('Missing current-excerpt word evidence');
        } catch {
          issues.push(`Invalid independent word evidence: ${r.key}:${ref}`);
          continue;
        }
      }
      let segmentEvidence: ContentAttachmentSegmentFinding[] | undefined;
      if (request.segmentReview) {
        try {
          segmentEvidence = inspectContentAttachmentSegmentDecisions(
            segmentPlans.get(r.excerptRef)!,
            review,
            wordEvidence!,
          );
        } catch {
          issues.push(`Invalid independent segment decisions: ${r.key}:${ref}`);
          continue;
        }
      }
      const original = {
        assigned: assigned.includes(ref),
        unresolved: unresolved.includes(ref),
      };
      const changedFields: ContentAttachmentReviewFinding['changedFields'] = [];
      if (original.assigned !== (review.attachment === 'included'))
        changedFields.push('attachment');
      if (
        original.unresolved !==
        (review.attachment === 'unresolved' ||
          review.relationshipSubject === 'alternative')
      )
        changedFields.push('unresolved');
      findings.push({
        ...(segmentEvidence ? { segmentEvidence } : {}),
        ...(wordEvidence ? { wordEvidence } : {}),
        excerptRef: r.excerptRef,
        inventoryRef: r.inventoryRef,
        candidateRef: ref,
        original,
        review,
        contextEvidence: input.codeMap.excerpts.find(
          (e) => e.ref === r.excerptRef,
        )!.evidence,
        candidateEvidence: review.candidateEvidenceRefs.map(
          (k) => input.citations.find((c) => c.ref === k)!.evidence,
        ),
        changedFields,
        ...(options.includeBodyContext
          ? {
              reviewBasis: r.inventoryRef.startsWith('B')
                ? ('body_context' as const)
                : ('inventory' as const),
            }
          : {}),
      });
    }
  }
  return {
    issues,
    findings,
    disagreements: findings.filter((f) => f.changedFields.length),
  };
}
