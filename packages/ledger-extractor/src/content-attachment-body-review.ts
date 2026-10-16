import type { createContentAttachmentGroundedInput } from './content-attachment-grounding';
import type { createContentAttachmentInventoryReviewRequest } from './content-attachment-inventory-review';

type Input = ReturnType<typeof createContentAttachmentGroundedInput>;
type Required = ReturnType<
  typeof createContentAttachmentInventoryReviewRequest
>['required'][number];
export type ContextReviewSlot = Required & {
  basis?: 'inventory' | 'body_context';
};

export const CONTENT_ATTACHMENT_CONTEXT_REVIEW_POLICY =
  'BODY-GROUNDED REFERENTS, TENTATIVE MEMBERS AND WORK PURPOSE: Consider candidates established by original body evidence as well as table registrations. Body-context pools expand review coverage only; a shared chapter does not prove that a passage describes every candidate. Resolve an area or other context object through its original investigation definition and the current discourse, including unnumbered phrases such as this area or this investigation scope. When the passage substantively describes that identified area and its verified feature inventory, preserve both independently; restoring the feature recipients does not remove the area. Do not propagate a mere location reference or an ancestor without direct-description evidence. Once original inventory membership within the current investigation is established, a tentative, estimated or possible classification alone does not exclude that observation from a described collective. Keep its unchanged hedge. Distinguish classification uncertainty from membership uncertainty; exclusion needs an actual source-supported scope/membership contradiction or absence, not relabeling a tentative observation as outside the confirmed inventory. A later relationship may still have unresolved participant alternatives independently of collective evidence. For work accounts, distinguish the action subject from an intended purpose or beneficiary. A generic conservation, protection or safety purpose does not by itself directly describe treatment of every feature in a known inventory. Preserve the excerpt on the identified work subjects; add a beneficiary only if original evidence independently describes that object or establishes it as a subject of this specific action. Do not treat general conservation purpose, containment, investigation membership or the mere existence of the inventory as that action link. A pure table/navigation pointer without substantive object description is excluded. Keep all source words, qualifiers and boundaries unchanged; code never inserts semantic targets or rewrites a model response.';

/** Expand review coverage through original chapter contexts without deciding semantic recipients. */
export function createContentAttachmentBodyReviewCoverage(
  input: Input,
  inventoryRequired: Required[],
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
  const grouped = new Map<string, Set<string>>();
  for (const [ref, context] of input.bodyCandidateContexts) {
    if (!contexts.has(context) || inventoryMembers.has(ref)) continue;
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
