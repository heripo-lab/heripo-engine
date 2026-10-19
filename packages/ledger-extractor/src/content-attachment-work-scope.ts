import type { ContentAttachmentRecipientSupport } from './content-attachment-recipients';

import { z } from 'zod';

import { CONTENT_ATTACHMENT_WORD_RANGE_PATTERN } from './content-attachment-word-evidence';

export interface ContentAttachmentWorkScopeAssessment {
  state: 'operation' | 'not_applicable';
  currentWordRanges: string[];
  targetGroups: Array<{
    targetIdentification: ContentAttachmentRecipientSupport & {
      candidateRefs: string[];
    };
    operationCoverage: {
      state: 'established' | 'not_established';
      supportingWordRanges: string[];
      consideredWordRanges: string[];
      reason: string;
    };
  }>;
  reason: string;
}

export const CONTENT_ATTACHMENT_WORK_SCOPE_ASSESSMENT_POLICY =
  'INDEPENDENT WORK-SCOPE ASSESSMENT: Return workScopeAssessment for EVERY segment independently of collectiveAssessment. Use state operation for a recorded action and not_applicable for non-work descriptions such as findings or relationships. Cite current words and explain the classification; not_applicable has no targetGroups. For an operation, cite nonempty current words and review each relevant target group, including a known investigation set whose coverage by this task is unestablished. targetIdentification selects candidateRefs, current/context words, every candidate own K grounds and optional original rows to identify the targets, NOT to assert that all received the task. An independently described single target can have its own group. Do not transmit every registry candidate as a task group merely because it exists.\nFor each group separately return operationCoverage: established or not_established. supportingWordRanges select only original words that positively connect THIS operation to ALL identified targets; consideredWordRanges retain inspected but insufficient context, such as a general member definition. Established coverage requires nonempty supportingWordRanges, which may be current or read-only source words. Not_established has no supportingWordRanges and does not mean that the task did not occur. Explain the actual source bridge or gap. Original row membership and group identity alone do not establish task coverage.\nEvery confirmed work recipient must belong to a group with established coverage. Do not attach an entire group while judging its coverage not_established, even under not_collective. For a source-supported subset, identify and support that narrower operation group separately. Independent area recipients remain separately assessed; a failed all-members expansion neither removes them nor manufactures recipient or relationship uncertainty. Do not narrow collective findings with this work-event test. Code validates reference provenance and the consistency of your declared coverage with final attachments, not the semantic truth of a source bridge; it never repairs responses or adds another model call.';

export const CONTENT_ATTACHMENT_WORK_SCOPE_EVIDENCE_BOUNDARY_POLICY =
  "For every workScopeAssessment, including not_applicable, select currentWordRanges wholly within the segment being judged. Do not include neighboring segments to explain its classification. Neighboring text may provide context but must not expand the current segment's evidence boundary.\n\nFor operations, distinguish target-set identification from evidence that THIS operation covers ALL identified targets. A methods paragraph, inventory or set definition does not by itself establish whole-set operation coverage. Keep identification grounds in targetIdentification. In operationCoverage, record examined but insufficient coverage grounds under consideredWordRanges; supportingWordRanges require a source-grounded link between this operation and all identified targets. Without that link, return not_established with empty supportingWordRanges and do not infer whole-set attachment from identification alone. Retain separately supported targets or subsets.\n\nThese work-assessment rules do not narrow source-established collective findings or independently supported area attachments. Preserve their separate inventory, member-selection and area judgments.";

/** Require a visible work classification and separate identity/coverage judgments for each operation group. */
export function createContentAttachmentWorkScopeSchema(
  candidateRefs: string[],
) {
  const ranges = z
    .array(z.string().regex(CONTENT_ATTACHMENT_WORD_RANGE_PATTERN))
    .meta({ id: 'WorkScopeRanges' });
  return z
    .strictObject({
      state: z.enum(['operation', 'not_applicable']),
      currentWordRanges: ranges,
      targetGroups: z.array(
        z.strictObject({
          targetIdentification: z.strictObject({
            candidateRefs: z
              .array(z.enum(candidateRefs as [string, ...string[]]))
              .min(1),
            currentWordRanges: z
              .array(z.string().regex(CONTENT_ATTACHMENT_WORD_RANGE_PATTERN))
              .min(1),
            contextWordRanges: ranges,
            candidateEvidenceRefs: z.array(z.string()).min(1),
            originRowRefs: z.array(z.string()),
          }),
          operationCoverage: z.strictObject({
            state: z.enum(['established', 'not_established']),
            supportingWordRanges: ranges,
            consideredWordRanges: ranges,
            reason: z.string().min(1),
          }),
        }),
      ),
      reason: z.string().min(1),
    })
    .meta({ id: 'WorkScopeAssessment' });
}

/** Validate declared task coverage without interpreting source meaning or modifying final recipients. */
export function inspectContentAttachmentWorkScope(
  assessment: ContentAttachmentWorkScopeAssessment,
  attachments: string[],
  resolve: (
    support: ContentAttachmentRecipientSupport,
    refs: string[],
  ) => unknown,
) {
  const checkRanges = (ranges: string[], direct = false) =>
    resolve(
      {
        currentWordRanges: direct ? ranges : [],
        contextWordRanges: direct ? [] : ranges,
        candidateEvidenceRefs: [],
        originRowRefs: [],
      },
      [],
    );
  checkRanges(assessment.currentWordRanges, true);
  if (assessment.state === 'not_applicable') {
    if (assessment.targetGroups.length)
      throw new Error('Non-operation has task target groups');
    return;
  }
  if (!assessment.currentWordRanges.length)
    throw new Error('Operation lacks current evidence');
  const established = new Set<string>();
  for (const {
    targetIdentification: target,
    operationCoverage: coverage,
  } of assessment.targetGroups) {
    resolve(target, target.candidateRefs);
    checkRanges(coverage.supportingWordRanges);
    checkRanges(coverage.consideredWordRanges);
    if (coverage.state === 'established') {
      if (!coverage.supportingWordRanges.length)
        throw new Error('Established operation lacks coverage evidence');
      target.candidateRefs.forEach((ref) => established.add(ref));
    } else {
      if (coverage.supportingWordRanges.length)
        throw new Error('Unestablished operation asserts supporting evidence');
      if (target.candidateRefs.every((ref) => attachments.includes(ref)))
        throw new Error('Unestablished operation attaches entire target group');
    }
  }
  if (attachments.some((ref) => !established.has(ref)))
    throw new Error('Confirmed work recipient lacks established scope');
}
