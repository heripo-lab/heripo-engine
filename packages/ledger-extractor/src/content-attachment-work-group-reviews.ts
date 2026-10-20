import type { createContentAttachmentGroundedInput } from './content-attachment-grounding';
import type {
  ContentAttachmentWorkScopeAssessment,
  ContentAttachmentWorkTarget,
} from './content-attachment-work-scope';

import { z } from 'zod';

export interface ContentAttachmentWorkGroup {
  ref: string;
  inventoryRef: string;
  recordKind: string;
  candidateRefs: string[];
}

export interface ContentAttachmentWorkGroupReview {
  relevance: 'relevant' | 'not_relevant';
  targetGroupIndexes?: number[];
  fullGroupAssessment?: ContentAttachmentWorkTarget;
  reason: string;
}

/** Partition every original inventory by registered kind, without model or chapter filtering. */
export function createContentAttachmentWorkGroups(
  input: ReturnType<typeof createContentAttachmentGroundedInput>,
): ContentAttachmentWorkGroup[] {
  const kinds = new Map<string, string>();
  for (const row of input.payload.candidates) {
    const [ref, kind] = row as string[];
    if (kinds.has(ref) && kinds.get(ref) !== kind)
      throw new Error('Inconsistent registered work-group kind: ' + ref);
    kinds.set(ref, kind);
  }
  const groups: ContentAttachmentWorkGroup[] = [];
  for (const [inventoryRef, members] of input.payload.inventoryMembers as Array<
    [string, string[]]
  >) {
    const partitions = new Map<string, Set<string>>();
    for (const ref of members) {
      const kind = kinds.get(ref);
      if (!kind) throw new Error('Unknown work-group member: ' + ref);
      if (!partitions.has(kind)) partitions.set(kind, new Set());
      partitions.get(kind)!.add(ref);
    }
    for (const [recordKind, refs] of partitions)
      groups.push({
        ref: `G${groups.length + 1}`,
        inventoryRef,
        recordKind,
        candidateRefs: [...refs],
      });
  }
  return groups;
}

/** Require a verdict for each supplied group; absence is never a negative verdict. */
export function createContentAttachmentWorkGroupReviewsSchema(
  refs: string[],
  legacyExclusive = false,
  fullGroupSchema?: z.ZodType<ContentAttachmentWorkTarget>,
  shareDefinitions = false,
) {
  if (fullGroupSchema) {
    const review = z.union([
      z.strictObject({
        relevance: z.literal('relevant'),
        reason: z.string().min(1),
        fullGroupAssessment: fullGroupSchema,
      }),
      z.strictObject({
        relevance: z.literal('not_relevant'),
        reason: z.string().min(1),
      }),
    ]);
    const sharedReview = shareDefinitions
      ? review.meta({ id: 'WorkGroupReview' })
      : review;
    return z.strictObject(
      Object.fromEntries(refs.map((ref) => [ref, sharedReview])),
    );
  }
  const options = [
    z.strictObject({
      relevance: z.literal('relevant'),
      targetGroupIndexes: z.array(z.int().nonnegative()).min(1),
      reason: z.string().min(1),
    }),
    z.strictObject({
      relevance: z.literal('not_relevant'),
      targetGroupIndexes: z.array(z.int().nonnegative()).max(0),
      reason: z.string().min(1),
    }),
  ] as const;
  // Distinct literal verdicts keep these branches disjoint under inclusive anyOf.
  const review = legacyExclusive
    ? z.discriminatedUnion('relevance', options)
    : z.union(options);
  return z.strictObject(Object.fromEntries(refs.map((ref) => [ref, review])));
}

/** Inspect inline full groups or legacy zero-based references without repairing model output. */
export function inspectContentAttachmentWorkGroupReviews(
  groups: ContentAttachmentWorkGroup[],
  assessment: ContentAttachmentWorkScopeAssessment,
  attachments: string[],
  inlineFullGroups = false,
) {
  // The versioned schema has already checked exact keys and verdict/object shapes.
  if (assessment.state === 'not_applicable') return;
  for (const group of groups) {
    const review = assessment.groupReviews![group.ref];
    if (review.relevance === 'not_relevant') {
      if (group.candidateRefs.every((ref) => attachments.includes(ref)))
        throw new Error(
          `${group.ref}: Irrelevant work group attaches all members`,
        );
      continue;
    }
    if (inlineFullGroups) {
      const refs =
        review.fullGroupAssessment!.targetIdentification.candidateRefs;
      const members = new Set(refs);
      if (
        members.size !== refs.length ||
        members.size !== group.candidateRefs.length ||
        group.candidateRefs.some((ref) => !members.has(ref))
      )
        throw new Error(`${group.ref}: Full work group member mismatch`);
      continue;
    }
    const seen = new Set<number>();
    let full = false;
    for (const index of review.targetGroupIndexes!) {
      if (seen.has(index))
        throw new Error(`${group.ref}[${index}]: Duplicate work target index`);
      seen.add(index);
      const target = assessment.targetGroups[index];
      if (!target)
        throw new Error(
          `${group.ref}[${index}]: Work target index out of range`,
        );
      const refs = new Set(target.targetIdentification.candidateRefs);
      if ([...refs].some((ref) => !group.candidateRefs.includes(ref)))
        throw new Error(`${group.ref}[${index}]: Work group member mismatch`);
      if (refs.size === group.candidateRefs.length) full = true;
    }
    if (!full)
      throw new Error(`${group.ref}: Missing full work group assessment`);
  }
}
