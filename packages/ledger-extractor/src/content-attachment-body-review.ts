import type { createContentAttachmentGroundedInput } from './content-attachment-grounding';
import type { createContentAttachmentInventoryReviewRequest } from './content-attachment-inventory-review';
import type { ContentAttachmentRequiredResponse } from './content-attachment-response';

type Input = ReturnType<typeof createContentAttachmentGroundedInput>;
type Required = ReturnType<
  typeof createContentAttachmentInventoryReviewRequest
>['required'][number];
export type ContextReviewSlot = Required & {
  basis?: 'inventory' | 'body_context';
};

export const CONTENT_ATTACHMENT_CONTEXT_REVIEW_POLICY =
  'BODY-GROUNDED REFERENTS, TENTATIVE MEMBERS AND WORK PURPOSE: Consider candidates established by original body evidence as well as table registrations. Body-context pools expand review coverage only; a shared chapter does not prove that a passage describes every candidate. Resolve an area or other context object through its original investigation definition and the current discourse, including unnumbered phrases such as this area or this investigation scope. When the passage substantively describes that identified area and its verified feature inventory, preserve both independently; restoring the feature recipients does not remove the area. Do not propagate a mere location reference or an ancestor without direct-description evidence. Once original inventory membership within the current investigation is established, a tentative, estimated or possible classification alone does not exclude that observation from a described collective. Keep its unchanged hedge. Distinguish classification uncertainty from membership uncertainty; exclusion needs an actual source-supported scope/membership contradiction or absence, not relabeling a tentative observation as outside the confirmed inventory. A later relationship may still have unresolved participant alternatives independently of collective evidence. For work accounts, distinguish the action subject from an intended purpose or beneficiary. A generic conservation, protection or safety purpose does not by itself directly describe treatment of every feature in a known inventory. Preserve the excerpt on the identified work subjects; add a beneficiary only if original evidence independently describes that object or establishes it as a subject of this specific action. Do not treat general conservation purpose, containment, investigation membership or the mere existence of the inventory as that action link. A pure table/navigation pointer without substantive object description is excluded. Keep all source words, qualifiers and boundaries unchanged; code never inserts semantic targets or rewrites a model response.';

export const CONTENT_ATTACHMENT_QUALIFIED_COLLECTIVE_POLICY =
  'ORDERED CLAUSE JUDGMENT: Apply this sequence separately to every substantive clause before returning either selection or independent review. (1) Establish the original bounded investigation inventory using body continuity, original rows and candidate evidence. Then FIRST narrow that inventory by the CURRENT clause period, investigation stage, location and type. A broader preceding inventory does not override the current period. A source-established incompatible period is an exclusion, not an unresolved same-object possibility; keep that excluded member in any required review with its own K grounds. Use supplied discourse and original investigation links to interpret period wording; do not demand identical period labels when those links establish the relevant set, or invent chronology absent from the sources. (2) Decide unchanged collective evidence recipients within that qualified set. Original membership plus a clause describing that set supports attachment without proof that an individually unnamed physical object is identical to the later relationship subject. Do not convert supported collective attachment into unresolved attachment merely because a later singular relationship participant is unidentified. An original tentative classification remains qualified inventory evidence unless a separate source-supported scope contradiction excludes it; preserve its hedge and do not silently drop it from both recipients and applicable role alternatives. (3) Independently resolve each relationship subject within the same qualified, source-supported set. If the clause leaves which member participates unresolved, retain the genuine alternatives while keeping the collective recipients. Selection uses assigned candidateRefs plus nested unresolved candidateRefs; independent review uses attachment=included plus relationshipSubject=alternative on the same member where both grounds hold. Attachment uncertainty concerns recipient membership or identity, not merely the identity of a later relationship subject. Excluded-period candidates are not alternatives simply because their object type matches. A resolved subject needs no alternatives. (4) Recheck every relevant original member against these independent dimensions and current qualifiers, including tentative members and excluded periods. Never justify missing collective recipients solely by lack of individual identification, or treat the review pool itself as evidence of description. Keep body-grounded area recipients and local work subjects independently supported; general conservation purpose still does not propagate work to beneficiary features. No new fields, invented source text, repaired responses or code-selected semantic answers.';

export const CONTENT_ATTACHMENT_RECIPIENT_REF_CHECK_POLICY =
  'FINAL RECIPIENT AND ORIGINAL-NUMBER RECONCILIATION: Before returning each E, check independently described context objects as well as its feature inventory. If original body evidence and current discourse identify an investigation area and the clause directly describes that area, including which archaeological features exist there, preserve the area alongside the qualified feature set. Restoring collective feature recipients must not absorb or silently replace that independently described area. Current-period narrowing of feature members does not by itself exclude an area that has no period label. Resolve names such as this area through the original investigation definition; a mere location reference, containment, shared chapter or generic conservation purpose still does not justify an additional recipient. Missing a number is not grounds to omit an identified body-grounded area.\nFor explicit object numbers, ranges and lists, inspect the candidateRefs array you will ACTUALLY return, not the numbers mentioned in your reason. Resolve each selected opaque ref back to its supplied original kind/name, number and investigation context. Independently enumerate every explicitly stated object number, expanding both range endpoints and every intervening member plus separately listed numbers. Compare that source-derived set to the decoded returned refs one member at a time. A required uniquely resolved number is not selected merely because another ref has a similar suffix or because the reason repeats it. Reconcile your proposed refs before returning while preserving any other independently described recipients and genuine partial identity uncertainty. This comparison applies to body and table work cells; numbering checks do not narrow unnumbered collective recipients or body-grounded areas. Do not convert dimensions, dates or object quantities into identifiers, invent missing candidates, spread local work or select a first match from an ambiguous scope. Keep original source strings and all required E keys unchanged. Independent review applies the same recipient criteria only within its supplied coverage; it sees no prior decision. Code retains each actual response, performs deterministic checks and never inserts a semantic target or repairs a saved response.';

export const CONTENT_ATTACHMENT_AREA_SCOPE_POLICY =
  'WHOLE PROJECT AND PARTIAL INVESTIGATION AREAS: Identify each area from its original definition, extent, included/excluded portions and investigation stage, then resolve the current clause through the body and adjacent read-only context. A whole project site and a bounded survey or excavation portion are distinct recipients even when both are called the site, project area or investigation scope. Generic name overlap, containment or the chapter in which a statement occurs does not make their extents identical. A survey-methods account can later recommend excavation across the entire project; preserve that substantive whole-area statement on the area established by the whole-project definition, without inheriting the earlier partial survey recipient. Conversely, a partial-scope statement does not automatically describe the whole project. Compare every plausible supplied area definition before selecting recipients. Add multiple areas only when the unchanged clauses independently describe each, not merely because one contains another. Retain genuine identity uncertainty if the original definitions and discourse do not resolve the extent; do not guess or rewrite source wording. Independent review includes all body-grounded area definitions across chapters and body-grounded candidates proposed by the first selection, without seeing its decisions or reasons. These are review alternatives, not predetermined attachments. Reconcile every inclusion or exclusion with the candidate own definition and the current scope; shared labels and valid citation IDs alone do not establish scope identity. Preserve independently supported feature recipients and relationship-subject alternatives separately.';

/** Expand review coverage without deciding semantic recipients or copying earlier judgments. */
export function createContentAttachmentBodyReviewCoverage(
  input: Input,
  inventoryRequired: Required[],
  selection?: ContentAttachmentRequiredResponse,
) {
  const body = input.payload.current.excerpts.filter((e) => e[1] === 'text');
  const contexts = new Set(body.flatMap((e) => e[2]));
  for (const r of inventoryRequired)
    for (const context of input.payload.originTables.find(
      (t) => t.ref === r.inventoryRef,
    )!.contexts)
      contexts.add(context);
  const inventoryMembers = new Set(
    inventoryRequired.flatMap((r) => r.candidateRefs),
  );
  const crossChapterRefs = new Set(
    selection
      ? [
          ...input.payload.candidates
            .filter((r) => r[1] === 'area')
            .map((r) => r[0]),
          ...body.flatMap((e) => {
            const decision = selection.decisions[e[0]];
            return decision.status === 'assigned'
              ? [
                  ...decision.candidateRefs,
                  ...(decision.unresolved?.candidateRefs ?? []),
                ]
              : decision.status === 'unresolved'
                ? decision.candidateRefs
                : [];
          }),
        ]
      : [],
  );
  const grouped = new Map<string, Set<string>>();
  for (const [ref, context] of input.bodyCandidateContexts) {
    if (
      inventoryMembers.has(ref) ||
      (!contexts.has(context) && !crossChapterRefs.has(ref))
    )
      continue;
    if (!grouped.has(context)) grouped.set(context, new Set());
    grouped.get(context)!.add(ref);
  }
  const pools = [...grouped].map(([context, refs], index) => ({
    ref: `B${index + 1}`,
    context,
    candidateRefs: [...refs],
  }));
  const required: ContextReviewSlot[] = [
    ...inventoryRequired.map((r) => ({ ...r, basis: 'inventory' as const })),
    ...body.flatMap((e) =>
      pools.map((pool) => ({
        key: `${e[0]}:${pool.ref}`,
        excerptRef: e[0],
        inventoryRef: pool.ref,
        candidateRefs: pool.candidateRefs,
        selected: [],
        basis: 'body_context' as const,
      })),
    ),
  ];
  return { required, pools };
}
