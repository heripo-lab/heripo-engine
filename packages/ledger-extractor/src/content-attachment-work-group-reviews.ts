import type { createContentAttachmentGroundedInput } from './content-attachment-grounding';
import type { ContentAttachmentWorkScopeAssessment } from './content-attachment-work-scope';

import { z } from 'zod';

export interface ContentAttachmentWorkGroup {
  ref: string;
  inventoryRef: string;
  recordKind: string;
  candidateRefs: string[];
}

export interface ContentAttachmentWorkGroupReview {
  relevance: 'relevant' | 'not_relevant';
  targetGroupIndexes: number[];
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
export function createContentAttachmentWorkGroupReviewsSchema(refs: string[]) {
  const review = z.discriminatedUnion('relevance', [
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
  ]);
  return z.strictObject(Object.fromEntries(refs.map((ref) => [ref, review])));
}

/** Resolve zero-based references without repairing, filling or reinterpreting model output. */
export function inspectContentAttachmentWorkGroupReviews(
  groups: ContentAttachmentWorkGroup[],
  assessment: ContentAttachmentWorkScopeAssessment,
  attachments: string[],
) {
  // The versioned schema has already checked exact keys and verdict/index shapes.
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
    const seen = new Set<number>();
    let full = false;
    for (const index of review.targetGroupIndexes) {
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
