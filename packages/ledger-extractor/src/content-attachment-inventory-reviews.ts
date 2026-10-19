import type { createContentAttachmentGroundedInput } from './content-attachment-grounding';

import { z } from 'zod';

import { CONTENT_ATTACHMENT_WORD_RANGE_PATTERN } from './content-attachment-word-evidence';

type Input = ReturnType<typeof createContentAttachmentGroundedInput>;
type Inventories = Array<[string, string[]]>;
export interface ContentAttachmentInventoryReview {
  decision: 'accepted' | 'rejected' | 'uncertain';
  currentWordRanges: string[];
  contextWordRanges: string[];
  inventoryContextRefs: string[];
  candidateEvidenceRefs: string[];
  originRowRefs: string[];
  reason: string;
}

export const CONTENT_ATTACHMENT_INVENTORY_REVIEW_POLICY =
  'INVENTORY CONSIDERATION BEFORE COLLECTIVE CONCLUSION: In this SAME response return inventoryReviews, collectiveAssessment, qualifierAssessment and inventoryMembershipLinks for EVERY fixed segment. inventoryReviews requires every supplied original inventory key, including rejected tables, irrespective of the eventual collective state. First examine the current segment in its whole E and investigation/body continuity, including an earlier findings account and a subsequent statement based on those findings when supplied. For each original inventory record accepted, rejected or uncertain, current word evidence, supporting context words, table-owned inventoryContextRefs, optional candidate-owned K grounds and original rows, and a concise source-grounded reason. The inventory key itself identifies its original caption, headers and context without rewriting them. Explain the specific failed link when rejecting: investigation scope, current period/type restriction, source continuity, or why the CURRENT statement is not a collective account. Missing individual numbers alone cannot reject a source-established inventory set. If the source bridge is unclear, record uncertain rather than silently dropping the table. Do not infer identity across investigation stages from period/type alone. These are judgments of the table connection for THIS segment, not removal of registry candidates.\nThen return the actual period/type/scope qualifier words and the final collectiveAssessment after considering those reviews. An accepted inventory establishes a collective connection and requires state collective. A not_collective verdict preserves all table reviews as rejected and has no inventoryMembershipLinks. An uncertain table connection requires state uncertain unless another accepted inventory establishes the collective. A collective may have no accepted inventory when its source basis is genuinely body-only; explain that basis and retain all table reviews.\nFor EVERY accepted inventory, return one inventoryMembershipLinks entry with EVERY original registered member key listed by the schema, including containing row owners and incompatible members. Rejected or uncertain inventories have no adopted membership entry. Each member selects its own K grounds and original rows and records period/type compatibility, tentative-label preservation, membership, disposition and a source-grounded reason. Original row membership does not automatically attach containing units. Apply current restrictions to each member; do not expand a bounded set to unrelated candidates or infer a precise individual date from a broad compatible period. A tentative classification alone is not a membership exclusion. Collective source sharing does not identify the individual subject of a separate relationship claim.\nKeep directly described areas and other independent recipients on their own original grounds outside inventory membership. Included members must remain attachments; unresolved members must remain recipient-identity alternatives; excluded members must not attach by that collective. For overlapping inventories included takes precedence, then unresolved, then excluded. Keep relationship-subject alternatives independent and preserve the alternatives of one unknown referent as one group. Code reports missing reviews, foreign evidence and inconsistent decisions; it never adds/removes recipients or repairs source text or raw output. Do not add another model call or return sample-specific expectations.';

/** Require consideration of every supplied table, not just model-adopted memberships. */
export function createContentAttachmentInventoryReviewsSchema(input: Input) {
  const review = z
    .strictObject({
      decision: z.enum(['accepted', 'rejected', 'uncertain']),
      currentWordRanges: z
        .array(z.string().regex(CONTENT_ATTACHMENT_WORD_RANGE_PATTERN))
        .min(1),
      contextWordRanges: z.array(
        z.string().regex(CONTENT_ATTACHMENT_WORD_RANGE_PATTERN),
      ),
      inventoryContextRefs: z.array(z.string()),
      candidateEvidenceRefs: z.array(z.string()),
      originRowRefs: z.array(z.string()),
      reason: z.string().min(1),
    })
    .meta({ id: 'InventoryReview' });
  return z
    .strictObject(
      Object.fromEntries(
        (input.payload.inventoryMembers as Inventories).map(([ref]) => [
          ref,
          review,
        ]),
      ),
    )
    .meta({ id: 'InventoryReviews' });
}

/** Validate review provenance and adopted links without deciding semantic table relevance. */
export function inspectContentAttachmentInventoryReviews(
  input: Input,
  reviews: Record<string, ContentAttachmentInventoryReview>,
  state: 'collective' | 'not_collective' | 'uncertain',
  selected: string[],
  grounds: Array<{ ref: string; candidateRef: string }>,
  resolve: (ranges: string[], direct?: boolean) => void,
) {
  const accepted: string[] = [];
  let uncertain = false;
  for (const [inventoryRef, review] of Object.entries(reviews)) {
    resolve(review.currentWordRanges, true);
    resolve(review.contextWordRanges);
    const table = input.payload.originTables.find(
      (t) => t.ref === inventoryRef,
    )!;
    const refs = (input.payload.inventoryMembers as Inventories).find(
      ([ref]) => ref === inventoryRef,
    )![1];
    for (const values of [
      review.inventoryContextRefs,
      review.candidateEvidenceRefs,
      review.originRowRefs,
    ])
      if (new Set(values).size !== values.length)
        throw new Error('Duplicate inventory review support');
    if (review.inventoryContextRefs.some((c) => !table.contexts.includes(c)))
      throw new Error('Foreign inventory review context');
    if (
      review.candidateEvidenceRefs.some(
        (k) =>
          !grounds.some((g) => g.ref === k && refs.includes(g.candidateRef)),
      )
    )
      throw new Error('Foreign inventory review candidate grounds');
    if (
      review.originRowRefs.some(
        (r) =>
          !input.payload.originRows.some(
            (row) => row[0] === r && row[1] === inventoryRef,
          ),
      )
    )
      throw new Error('Foreign inventory review row');
    if (review.decision === 'accepted') accepted.push(inventoryRef);
    if (review.decision === 'uncertain') uncertain = true;
  }
  if (accepted.length && state !== 'collective')
    throw new Error('Accepted inventory lacks collective conclusion');
  if (state === 'not_collective' && uncertain)
    throw new Error(
      'Uncertain inventory has definitive non-collective conclusion',
    );
  if (
    accepted.length !== selected.length ||
    accepted.some((ref) => !selected.includes(ref))
  )
    throw new Error('Inventory reviews and adopted memberships disagree');
}
