import type { createContentAttachmentGroundedInput } from './content-attachment-grounding';

import { z } from 'zod';

import { CONTENT_ATTACHMENT_WORD_RANGE_PATTERN } from './content-attachment-word-evidence';

type Input = ReturnType<typeof createContentAttachmentGroundedInput>;
type Inventories = Array<[string, string[]]>;
export interface ContentAttachmentInventoryReview {
  decision: 'accepted' | 'rejected' | 'uncertain';
  currentWordRanges: string[];
  contextWordRanges: string[];
  /** Present only in historical v3 model responses. */
  inventoryContextRefs?: string[];
  candidateEvidenceRefs: string[];
  originRowRefs: string[];
  reason: string;
}

export const CONTENT_ATTACHMENT_INVENTORY_REVIEW_POLICY =
  'INVENTORY CONSIDERATION BEFORE COLLECTIVE CONCLUSION: In this SAME response return inventoryReviews, collectiveAssessment, qualifierAssessment and inventoryMembershipLinks for EVERY fixed segment. inventoryReviews requires every supplied original inventory key, including rejected tables, irrespective of the eventual collective state. First examine the current segment in its whole E and investigation/body continuity, including an earlier findings account and a subsequent statement based on those findings when supplied. For each original inventory record accepted, rejected or uncertain, current word evidence, supporting context words, table-owned inventoryContextRefs, optional candidate-owned K grounds and original rows, and a concise source-grounded reason. The inventory key itself identifies its original caption, headers and context without rewriting them. Explain the specific failed link when rejecting: investigation scope, current period/type restriction, source continuity, or why the CURRENT statement is not a collective account. Missing individual numbers alone cannot reject a source-established inventory set. If the source bridge is unclear, record uncertain rather than silently dropping the table. Do not infer identity across investigation stages from period/type alone. These are judgments of the table connection for THIS segment, not removal of registry candidates.\nThen return the actual period/type/scope qualifier words and the final collectiveAssessment after considering those reviews. An accepted inventory establishes a collective connection and requires state collective. A not_collective verdict preserves all table reviews as rejected and has no inventoryMembershipLinks. An uncertain table connection requires state uncertain unless another accepted inventory establishes the collective. A collective may have no accepted inventory when its source basis is genuinely body-only; explain that basis and retain all table reviews.\nFor EVERY accepted inventory, return one inventoryMembershipLinks entry with EVERY original registered member key listed by the schema, including containing row owners and incompatible members. Rejected or uncertain inventories have no adopted membership entry. Each member selects its own K grounds and original rows and records period/type compatibility, tentative-label preservation, membership, disposition and a source-grounded reason. Original row membership does not automatically attach containing units. Apply current restrictions to each member; do not expand a bounded set to unrelated candidates or infer a precise individual date from a broad compatible period. A tentative classification alone is not a membership exclusion. Collective source sharing does not identify the individual subject of a separate relationship claim.\nKeep directly described areas and other independent recipients on their own original grounds outside inventory membership. Included members must remain attachments; unresolved members must remain recipient-identity alternatives; excluded members must not attach by that collective. For overlapping inventories included takes precedence, then unresolved, then excluded. Keep relationship-subject alternatives independent and preserve the alternatives of one unknown referent as one group. Code reports missing reviews, foreign evidence and inconsistent decisions; it never adds/removes recipients or repairs source text or raw output. Do not add another model call or return sample-specific expectations.';

export const CONTENT_ATTACHMENT_MAPPED_INVENTORY_REVIEW_POLICY =
  CONTENT_ATTACHMENT_INVENTORY_REVIEW_POLICY.replace(
    'table-owned inventoryContextRefs, ',
    '',
  );

export const CONTENT_ATTACHMENT_COLLECTIVE_SOURCE_SHARING_POLICY =
  'COLLECTIVE SOURCE PRESERVATION IS NOT INDIVIDUAL DATING: The current task attaches unchanged source descriptions; it does not assign normalized chronology or prove each member has every property expressed about a collective. Establish recipient membership from original investigation scope, body continuity and inventory rows. Apply actual current period/type/scope boundaries and check whether the source continues that established set or explicitly introduces a different or narrower subset. Do not enlarge the set or include a source-incompatible period/type. A finer period expression in a continuation of the same source-established set does not, by itself, require independent proof of that precise date for every member before preserving the collective source on those members. Preserve the different original period expressions and qualifiers without rewriting candidate evidence or inferring an individual date.\nAn unresolved periodStatus about precise individual dating is separate from source-established recipient membership. When original continuity and rows identify the members and no source-based exclusion or genuinely unidentified subset applies, keep membership linked and disposition included even if precise dating remains unresolved. Explain those independent judgments in the existing reason. Do not convert chronology precision alone into recipientIdentityAlternatives. Retain recipient uncertainty when the source actually leaves which members receive the description unclear, and exclude members with explicit incompatible grounds. A collective attachment does not identify the individual subject of another relationship claim; keep that uncertainty separate. Never use this preservation rule to propagate to containing units or unrelated inventory members.';

export const CONTENT_ATTACHMENT_CURRENT_TYPE_BOUNDARY_POLICY =
  'CURRENT TYPE BOUNDARIES SURVIVE COLLECTIVE SHARING: Judge the connection to an original source set separately from whether the CURRENT segment describes each member type. Named current types and source-supported synonyms or abbreviations define the type boundary. Shared investigation scope, inventory rows or compatible period do not add other types. Open-ended listing markers such as etc. or 등 do not by themselves import every type from an earlier inventory into the current segment. An earlier enumeration establishes which types exist in that source set; same-set continuity alone does not establish that a later description covers all those types. Other types require positive original evidence connecting the current expression to them. A source-defined umbrella term or explicit all-types reference may establish that coverage; an ordinary generic noun or listing marker alone cannot. Select the actual connecting source word ranges and explain the type coverage in the existing reason. Without that connection, exclude other-type members instead of attaching them merely to preserve context. Do not manufacture recipient alternatives for every type in the registry. Keep known same-set members of the described types attached under the collective-source/individual-dating distinction; missing precise dating does not itself undo their source membership. Explicit incompatible period/type grounds and genuine unidentified subsets retain their exclusions or uncertainty. Area own-result recipients and individual relationship-subject alternatives remain independently judged.';

export const CONTENT_ATTACHMENT_WORK_SCOPE_POLICY =
  'INVESTIGATION MEMBERSHIP IS NOT WORK-EVENT COVERAGE: Distinguish the objects belonging to an investigation from the recipients of a particular recorded operation. A methods paragraph or original inventory can establish the investigation-wide set without establishing that every member underwent the current task. For a dated work-log row or other local operation, determine task coverage from its own wording, row/cell boundaries and source-linked continuation. A shared type name, available member list or absence of an explicit restriction is not positive evidence of whole-set performance. Do not distribute a local operation to every registered member merely because an earlier paragraph defines the full set.\nWhole-set work attachment requires a positive source bridge for THIS operation, such as explicit common performance, an all-members scope statement or a clearly continued common task whose members are established by the original source. Select those actual source ranges and explain the work coverage in existing reason fields. Repeated individual numbers are not required when that common-operation bridge exists. Do not invent recipient uncertainty across the entire registry just because the current task does not establish whole-set coverage.\nAssess an independently described investigation area boundary, layout or recording operation on its own defining grounds, separately from work on individual contained units. A later numbered local task does not supply the preceding operation scope, and a general method definition does not turn an area-level boundary operation into work on every contained unit. Preserve genuine original common work and local numbered operations without automatic propagation to parents or all members. This work-event coverage check does not narrow a source-established collective FINDINGS description merely because individual identifiers or precise dates are absent. Keep current type/period boundaries, collective-source preservation and individual relationship-subject identity independent.';

export interface ContentAttachmentInventoryContext {
  contextRefs: string[];
  chapterPaths: string[][];
}

/** Resolve fixed original table context separately from model-selected review evidence. */
export function resolveContentAttachmentInventoryContexts(
  input: Input,
): Record<string, ContentAttachmentInventoryContext> {
  return Object.fromEntries(
    input.payload.originTables.map((table) => [
      table.ref,
      {
        contextRefs: [...table.contexts],
        chapterPaths: table.contexts.map((ref) => [
          ...input.payload.contexts[ref],
        ]),
      },
    ]),
  );
}

/** Require consideration of every supplied table, not just model-adopted memberships. */
export function createContentAttachmentInventoryReviewsSchema(
  input: Input,
  includeContextRefs = true,
) {
  const review = z
    .strictObject({
      decision: z.enum(['accepted', 'rejected', 'uncertain']),
      currentWordRanges: z
        .array(z.string().regex(CONTENT_ATTACHMENT_WORD_RANGE_PATTERN))
        .min(1),
      contextWordRanges: z.array(
        z.string().regex(CONTENT_ATTACHMENT_WORD_RANGE_PATTERN),
      ),
      ...(includeContextRefs
        ? { inventoryContextRefs: z.array(z.string()) }
        : {}),
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
      review.inventoryContextRefs ?? [],
      review.candidateEvidenceRefs,
      review.originRowRefs,
    ])
      if (new Set(values).size !== values.length)
        throw new Error('Duplicate inventory review support');
    if (review.inventoryContextRefs?.some((c) => !table.contexts.includes(c)))
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
