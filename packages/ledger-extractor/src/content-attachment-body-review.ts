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

export const CONTENT_ATTACHMENT_AREA_WORK_POLICY =
  'BODY INVENTORY BOUNDARIES AND AN AREA OWN FIELDWORK: Apply these SAME recipient criteria in first selection and independent review. A body sentence aggregating features found inside trenches or investigation units does not thereby describe every trench or unit. Original table membership and row anchors identify the feature inventory; they do not propagate that body sentence onto all row-owner units. Distinguish the units used only as find locations from units whose own work, condition or individually supported results the clause actually describes. A collective feature tally alone does not describe the same results for every unit, including rows recording no features. Retain the verified feature recipients and genuine role alternatives. The separate rule for an original table feature-occurrence CELL still preserves that exact cell on its identified row-owner unit and listed features; never extend that cell-specific ownership rule to a body aggregate.\nAn identified investigation area is directly described when a substantive clause records surveying its boundaries, establishing its grid, subdividing it, laying out its identified investigation units, or taking pre-investigation site photographs and making field records of that area. Resolve the continuing current area from its original scope definition and body context; its registered name, area measurement or number need not repeat. These activities describe the area own investigation organization and documentation, not merely a location reference or unrelated methodology. Preserve the area independently alongside any separately described units or features. Inspect every substantive clause: a sentence about surrounding or earlier-investigated evidence can also describe current onsite photography or recording. Do not omit that current work merely because another clause supplies background. Keep the earlier campaign or external reference distinct. Distinguishing whole-project and partial areas must identify WHICH area owns the described work, not erase the area recipient altogether. Conversely, a tool, reference point, generic procedure, nearby object or conservation purpose alone supplies no direct area-work link. Do not spread work to containing areas, all units or beneficiary features without independent original grounds. Before returning each E/member, distinguish scope identity from direct-description judgment and reconcile both under these shared criteria. Keep source boundaries, E text, candidate definitions, required keys and both actual responses unchanged; code supplies no semantic targets or adopted review corrections.';

export const CONTENT_ATTACHMENT_AREA_RESULTS_POLICY =
  'IDENTIFIED INVESTIGATION AREA RESULTS ARE DIRECT DESCRIPTIONS: Apply this SAME criterion in first selection and independent review. When the original area definition, current investigation stage, body continuity and verified inventory identify a bounded investigation area, a substantive account of the archaeological features confirmed by THAT investigation directly describes that area own investigation results as well as the supported feature members. A sentence reporting that the investigation found features inside its trenches or units can therefore be preserved on the identified area AND those feature members. The fact that its predicate also describes a feature collective is not a reason to exclude the area. Do not require a second geometric predicate, a repeated area name or measurement, or an additional sentence describing the area separately. This is preservation of the investigation results for their identified scope, not automatic propagation from a child to an ancestor or a mere location reference. Establish the specific scope through the supplied original definitions and investigation context; a generic place name, containment or a matching type alone remains insufficient. Keep whole-project and partial investigation areas distinct; do not spread a partial investigation result to a containing project area without independent direct-description evidence. Do not spread a body feature aggregate to every trench or unit, infer identical findings in each unit or imply that every part of the area was fully excavated. Preserve original aggregate qualifiers, uncertainties and differing source counts without inventing attributes or repairing text. Retain the verified feature recipients, genuine relationship-subject alternatives and existing area-fieldwork criteria independently. In review, judge area identity and result-description eligibility separately using the current E and the area own K grounds; do not exclude an identified area solely because the same E also reports its feature inventory. Return the unchanged required schema and preserve both actual responses without code-selected semantic answers or adopted review corrections.';

export const CONTENT_ATTACHMENT_AREA_RECIPIENT_BOUNDARY_POLICY =
  'AREA RESULT PRESERVATION DOES NOT EXPAND FEATURE RECIPIENTS: Apply this SAME separation in first selection and independent review. Decide three dimensions independently: (a) the identified area whose own investigation results the clause describes, (b) the feature collective actually described by that CURRENT clause, and (c) unresolved individual relationship-subject alternatives. Area eligibility in (a) neither broadens nor narrows the feature set in (b). Resolve (b) from the source-established inventory after applying the current clause period, investigation stage, location and object-type qualifiers; decide (c) separately within its source-supported role scope. The phrases supported feature members and those feature members in the area-results policy mean only the members supported for THIS clause, not every feature registered for that area, period, table, row or earlier broader inventory. Original row co-occurrence and investigation membership establish candidate identity and inventory membership, not direct description by every later clause. A non-exhaustive expression such as etc. is not by itself evidence that every other known type belongs to the current described collective; extending a named type set needs an original discourse or definition link that supports the additional types. Do not replace a source type-qualified collective with a broader generic feature collective merely to preserve its area results. Conversely, retain all independently supported collective members, their original tentative classifications and genuine relationship-subject alternatives; do not demand individual relationship identity as a condition for collective attachment. Preserve the independently described area even when additional feature types are excluded. In each stage, recheck proposed area and feature recipients separately against the current original clause and each candidate own grounds, and keep a current type restriction even when the area has a wider inventory. Do not infer per-object attributes from collective preservation. Keep evidence, required schema, first judgments and independent judgments unchanged except for the actual model decision; code never supplies expected recipients, adopts review corrections or repairs a response.';

export const CONTENT_ATTACHMENT_FIELDWORK_CONTINUITY_POLICY = `SAME AREA FIELDWORK AND BODY-TO-TABLE ACTION CRITERIA IN BOTH STAGES: Apply this identical rule in first selection and independent review. Resolve the investigation area from its own original extent and the continuing current investigation. A substantive record of laying out that area investigation units, measuring their collective layout, or producing the plan and field documentation of that investigation arrangement directly describes the identified area organization and record as well as its independently identified units. The area name or measurement need not repeat. Read the original paragraph and preceding layout definition: do not exclude the area solely because the documentation also describes its units. This requires an original link to that area own investigation arrangement, not containment, a generic procedure or a drawing of an unrelated individual object. Keep whole-project and partial scopes distinct; do not extend the area or feature set through this rule.
For a table task with an omitted work subject, read the original table caption, headers, complete row/date, source body and explicit body-to-table pointer together. If the body defines the participants of a completed investigation action and the linked diary records the same action/event, inherit those source-established participants even without repeated names or numbers. A navigation pointer is context establishing the link, not itself an attached object description. A cell combining administration or a meeting with substantive object work remains one unchanged E, preserved for the supported work participants. Do not dismiss it solely as an unnumbered diary entry. Before excluding a task, compare it with the source body action and explain any actual different event, narrower subject or missing link; lack of an identifier alone does not rebut an established link. A different dated row local subject does not silently replace a positively linked completed set-wide action. Conversely, a same-row local subject governs its own elliptical actions unless source evidence positively establishes expansion; shared action vocabulary or absence of a restriction alone never supplies a whole-set link. Preserve the confirmed participants independently of work purpose or beneficiaries. Review every supplied non-header data-cell/member key, including cells ignored by first selection: coverage is not evidence of eligibility. Use headers, dates and non-substantive cells as context; do not turn a day, weather or generic heading into an object description. Both stages keep exact E/K text and scope/period qualifiers. Preserve independent area, feature and relationship judgments; never repair responses, assign expected semantic targets in code or adopt review corrections.`;

export const CONTENT_ATTACHMENT_AREA_RECORD_LINK_POLICY =
  'EXPLICIT AREA DEFINITION -> LAYOUT -> RECORDING LINK CHECK IN BOTH STAGES: Before selecting recipients or independently judging an area member, trace three separate original links. (1) Identify the candidate area through its own K definition, extent and current investigation stage, distinguishing a partial investigation from a whole project. (2) Find the supplied original E or body clause that establishes that area investigation layout and its bounded units. (3) Read the current E with its original paragraph continuity to determine whether it surveys or records THAT established collective layout, including the layout plan and investigation documentation, rather than an unrelated individual object. Resolve unchanged referents through these links; the area name, extent and every unit identifier need not repeat in the recording sentence. When all three links are supported, the area own layout/recording is an independently described recipient alongside the supported units. Do not retain only the units merely because they are the grammatical noun in the recording clause or because a later clause also mentions unit plans or sections; inspect the collective layout clause of the whole unchanged E separately. Do not treat that positively linked area record as automatic ancestor propagation or generic methodology. Conversely, do not add an area from containment, matching chapter, a tool name or the existence of some unit drawings alone: locate the actual definition, layout and same-investigation recording links, and preserve genuine missing-link uncertainty without inventing evidence. In the existing reason for a relevant area/layout decision, cite the area own K and the layout/current E refs to explain the supported chain concisely; for exclusion or unresolved identity, identify the specific missing or contradicted link instead of just saying unit record or area record. First selection must check this chain before omitting an independently described area; independent review must apply the same check without seeing the first choice or treating inclusion as predetermined. References select original evidence and do not require rewriting its text. Preserve whole/partial scope boundaries, local diary action inheritance, qualified feature recipients and relationship-subject alternatives independently. Keep the same input, coverage and output schema; never insert a semantic target, adopt a review correction or repair a saved response in code.';

/** Expand review coverage without deciding semantic recipients or copying earlier judgments. */
export function createContentAttachmentBodyReviewCoverage(
  input: Input,
  inventoryRequired: Required[],
  selection?: ContentAttachmentRequiredResponse,
  includeTableCells = false,
) {
  const body = input.payload.current.excerpts.filter((e) => e[1] === 'text');
  const dataRefs = new Set(
    includeTableCells
      ? input.payload.current.tables.flatMap((table) =>
          table.grid.flatMap((row) =>
            row.flatMap((cell) => (cell[0] && !cell[4] ? [cell[0]] : [])),
          ),
        )
      : [],
  );
  const data = input.payload.current.excerpts.filter((e) => dataRefs.has(e[0]));
  const contexts = new Set([...body, ...data].flatMap((e) => e[2]));
  const tableInventories = includeTableCells
    ? input.inventories.filter(
        (inventory) =>
          inventoryRequired.some((r) => r.inventoryRef === inventory.ref) ||
          input.payload.originTables
            .find((t) => t.ref === inventory.ref)!
            .contexts.some((c) => contexts.has(c)) ||
          input.codeMap.originTables.some(
            (origin) =>
              origin.ref === inventory.ref &&
              input.codeMap.tables.some(
                (current) => current.table.key === origin.table.key,
              ),
          ),
      )
    : [];
  const tableRequired: ContextReviewSlot[] = data.flatMap((e) =>
    tableInventories.map((inventory) => ({
      key: `${e[0]}:${inventory.ref}`,
      excerptRef: e[0],
      inventoryRef: inventory.ref,
      candidateRefs: inventory.candidateRefs,
      selected: [],
      basis: 'inventory' as const,
    })),
  );
  const allInventoryRequired = [...inventoryRequired, ...tableRequired];
  for (const r of allInventoryRequired)
    for (const context of input.payload.originTables.find(
      (t) => t.ref === r.inventoryRef,
    )!.contexts)
      contexts.add(context);
  const inventoryMembers = new Set(
    allInventoryRequired.flatMap((r) => r.candidateRefs),
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
    ...allInventoryRequired.map((r) => ({ ...r, basis: 'inventory' as const })),
    ...[...body, ...data].flatMap((e) =>
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
