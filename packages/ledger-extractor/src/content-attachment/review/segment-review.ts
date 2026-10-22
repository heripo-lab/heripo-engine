import type {
  ContentAttachmentWordEvidenceSnapshot,
  ContentAttachmentWordRangeEvidence,
} from '../recipients/word-evidence';
import type { ContentAttachmentIndependentMember } from './independent-review-types';

import { resolveContentAttachmentSegmentRanges } from '../recipients/segment-ranges';

export interface ContentAttachmentReviewSegment {
  kind: 'substantive' | 'non_substantive';
  wordRanges: string[];
}
export interface ContentAttachmentSegmentDecision {
  segment: number;
  attachment: ContentAttachmentIndependentMember['attachment'];
  relationshipSubject: ContentAttachmentIndependentMember['relationshipSubject'];
  reason: string;
}
export interface ContentAttachmentSegmentFinding {
  segment: number;
  kind: ContentAttachmentReviewSegment['kind'];
  evidence: ContentAttachmentWordRangeEvidence[];
  decision: ContentAttachmentSegmentDecision;
}

export const CONTENT_ATTACHMENT_SEGMENT_REVIEW_POLICY =
  'SEGMENT-FIRST INDEPENDENT REVIEW: Before candidate judgments, return segments for every required E. Identify each independently meaningful action, assertion, relationship clause or individual-object title using original word ranges. Separate different action subjects even within one unchanged cell or sentence. Mark purely navigational/header/connective material non_substantive and explicitly cover it too. Registered individual-object titles remain substantive under existing title rules. Segment arrays are shared once per E, numbered by their one-based array position. Every original word must belong to at least one segment; do not hide an unexamined action in an unreturned span or label a substantive action non_substantive. Disjoint ranges and overlapping shared predicates are allowed. Never rewrite text or split or normalize the stored E. A single segment is appropriate only when the original E has a single independent claim/action or is wholly non-substantive.\nFor EVERY required candidate return segmentDecisions for EVERY segment, including exclusions and non-substantive segments. Explain each decision against that segment actual subject and the candidate own K definition, using relevant supplied context to resolve omitted subjects. Non-substantive material has excluded attachment and not_alternative role. Do not classify all earlier actions from the last local action, propagate to an ancestor, or infer recipients from registration membership alone. Preserve collective sharing, current qualifiers, tentative membership and both independent uncertainty dimensions for each segment. Segment evidence is selected before final attachment. Aggregate attachment is included when any segment includes the candidate, otherwise unresolved when any segment has unresolved recipient identity, otherwise excluded. Aggregate relationshipSubject is alternative exactly when any segment retains that relationship-subject alternative. For each positive segment select supporting current-E wordRanges overlapping that segment, retaining other E/X ranges only as context. Keep the whole original E as content; segmentation supplies review evidence only. Code checks word coverage, complete segment decisions, provenance and aggregation, not the semantic correctness of segmentation or recipients. Never repair a saved answer or adopt review judgments into first selection.';

/** Preserve review-specific labels while reusing the source-only boundary validation. */
export function inspectContentAttachmentSegments(
  snapshot: ContentAttachmentWordEvidenceSnapshot,
  excerptRef: string,
  segments: ContentAttachmentReviewSegment[],
) {
  return resolveContentAttachmentSegmentRanges(
    snapshot,
    excerptRef,
    segments,
  ).map((evidence, i) => ({ kind: segments[i].kind, evidence }));
}

/** Require an explicit verdict for each segment and reject contradictory aggregate claims. */
export function inspectContentAttachmentSegmentDecisions(
  segments: ReturnType<typeof inspectContentAttachmentSegments>,
  member: ContentAttachmentIndependentMember,
  wordEvidence: ContentAttachmentWordRangeEvidence[],
): ContentAttachmentSegmentFinding[] {
  const decisions = member.segmentDecisions!;
  const indexes = new Set(decisions.map((d) => d.segment));
  if (
    decisions.length !== segments.length ||
    indexes.size !== segments.length ||
    decisions.some((d) => d.segment < 1 || d.segment > segments.length)
  )
    throw new Error('Incomplete segment decisions');
  const result = segments.map((segment, i) => {
    const decision = decisions.find((d) => d.segment === i + 1)!;
    const positive =
      decision.attachment !== 'excluded' ||
      decision.relationshipSubject === 'alternative';
    if (segment.kind === 'non_substantive' && positive)
      throw new Error('Non-substantive segment has recipients');
    if (
      positive &&
      !segment.evidence.some((range) =>
        wordEvidence.some(
          (word) =>
            word.basis === 'direct' &&
            word.charStart < range.charEnd &&
            word.charEnd > range.charStart,
        ),
      )
    )
      throw new Error('Missing segment evidence');
    return { ...segment, segment: i + 1, decision };
  });
  const attachment = decisions.some((d) => d.attachment === 'included')
    ? 'included'
    : decisions.some((d) => d.attachment === 'unresolved')
      ? 'unresolved'
      : 'excluded';
  const role = decisions.some((d) => d.relationshipSubject === 'alternative')
    ? 'alternative'
    : 'not_alternative';
  if (member.attachment !== attachment || member.relationshipSubject !== role)
    throw new Error('Segment and aggregate judgments disagree');
  return result;
}
