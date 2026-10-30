import type { createContentAttachmentGroundedInput } from '../grounding';
import type { ContentAttachmentRequiredResponse } from '../response';
import type { createContentAttachmentInventoryReviewRequest } from './inventory-review';

import { retrieveContentAttachmentReviewReferents } from './review-retrieval';

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

export const CONTENT_ATTACHMENT_AREA_RECORD_BOUNDARY_POLICY =
  'AREA OWN LAYOUT/RECORD VS UNIT WORK BOUNDARY IN BOTH STAGES: Classify the object of the unchanged current action before deciding an area recipient. A record of the identified investigation area boundary, grid, subdivision, collective unit layout or documentation of that established arrangement independently describes the area as well as supported units; preserve the definition -> layout -> recording link even if the area name is omitted. In contrast, excavation, cleaning, internal investigation, surveying or photography of named/local units, and backfilling those units, do not describe the area itself merely because they occur within it, involve several or all units, form part of the same investigation, or are recorded in an area investigation diary. Survey, photograph, record, completion and backfill words alone do not change the action object to the area or its collective layout. Keep the nearest explicit unit work subject unless original evidence positively establishes a different work object; absence of a restriction is not expansion evidence. Distinguish a collective layout plan from a plan, measurement or photograph of one unit. Body-to-table inheritance recovers the source-established subjects of the SAME action, not extra containing areas: a body account establishing unit backfill supports those units for an elliptical diary backfill cell, but adds no area recipient without an independently substantive area clause. Apply this boundary equally in first selection and independent review, including both the defining body account and the linked table cell. A valid area K definition identifies scope; it does not prove that every action within that scope directly describes the area. For an area judgment, cite the K definition and relevant E action/layout refs and explain the actual action object. Exclude the area when only unit work or containment is supported; retain it when original evidence directly describes its own layout/record. Do not omit positively linked area layout documentation merely because units are also documented. Keep supported unit recipients, whole/partial area boundaries, qualified collective evidence and genuine relationship alternatives independently unchanged. This is a general source-subject rule, not a report-specific answer; do not change evidence, review coverage, schemas, saved responses or adopt review judgments in code.';

export const CONTENT_ATTACHMENT_CLAUSE_GROUNDS_POLICY = `MEETING-ONLY EVENTS AND RETURNED CANDIDATE GROUNDS CHECK IN BOTH STAGES: Judge what the current unchanged E itself substantively says about an object. A sentence only stating that a meeting, consultation or administrative event was held, even based on investigation results, does not describe an investigation area or its features and must be excluded. Event timing, purpose, result processing or association with the investigation alone does not turn that event into an object record. A neighboring sentence in the same original paragraph may give substantive observations or relationships; retain that neighboring E on its own supported recipients without transferring its descriptive content to the meeting-only E. Conversely, preserve an indivisible E that actually includes substantive object observations, interpretation, relationships or source-established work alongside meeting/administrative words; do not discard its supported recipients solely because a meeting is also mentioned. Apply this same test to body sentences and table cells, retaining whole original E boundaries.
Before returning ACTUAL recipients, compare each proposed candidate ref back to its own supplied literal name and K evidence, original row and investigation context. First establish the CURRENT clause period and other qualifiers, then narrow the verified antecedent set. For each ref you will return, check that its own K grounds support the current qualified set; a correct period written in the reason is not proof that the candidateRefs array contains only supported members. A broader preceding mixed-period inventory, common object type, shared survey, chapter or table-row co-occurrence does not override a source-established incompatible period. Exclude an incompatible-period candidate from attachment and relationship alternatives even if other members of its original row qualify. Explain that exclusion with that candidate own K evidence in independent review. Do not mechanically exclude an area with no period label, an original tentative classification or a genuinely cross-period participant independently described by another clause. Do not invent chronology when the supplied source does not resolve it. Keep qualified collective attachment separate from individual relationship-subject identity, and retain original tentative wording and genuine alternatives. First selection must reconcile the actual returned refs, qualifiers and its reason before returning; independent review must perform the same per-candidate K comparison without seeing or rationalizing the first answer. Preserve independently supported area layout records, local unit work subjects, exact evidence, input, coverage and output schemas. Code never filters semantic recipients, rewrites an original quote, repairs a model response or adopts review corrections.`;

export const CONTENT_ATTACHMENT_QUALIFIER_STAGE_GATE_POLICY = `CANDIDATE-LOCAL CURRENT QUALIFIER AND CROSS-STAGE IDENTITY GATES IN BOTH STAGES: For EACH candidate considered for the current substantive clause, apply the current clause period, investigation stage, location and type BEFORE using a broader group or regional inventory as attachment grounds. Read that particular candidate own literal name and K evidence; do not treat a group label or another member compatible period as this candidate grounds. If its original period is incompatible with the CURRENT qualified clause, exclude it from attachment and relationship-subject alternatives. A reason saying that this is a pit present in this region, a verified inventory member or a described type does not resolve that contradiction. Apply the same current restriction to every comparable member, including candidates from different original rows; an exception needs its own explicit original clause/evidence link, not regional membership or a shared type. Do not keep an incompatible candidate merely because the previous mixed inventory included it, its row also includes a compatible object, or other members of the same type are retained. First selection must decode and check every ref in the actual proposed array, not only describe the intended qualified set in prose. Independent review must reconcile each individual disposition with the current E qualifier and that member own K; do not give a generic group-membership explanation that omits their conflict. Where supplied original definitions establish compatible labels or an explicitly described cross-period relationship, preserve that source-supported interpretation without inventing chronology. Independently described areas without a period label and original tentative classifications do not become incompatible merely through this gate.
Separately establish the identity of EACH relationship participant. A relation naming a road, structure or other object from a different investigation stage/campaign does not identify an available registry candidate of that type merely because its name, site or period matches. Require an original bridge between the actual relation referent and that candidate, such as an explicit cross-reference, continuation/reinvestigation account or an identifying scope/location/description chain that positively links the stages. The bridge may span supplied original context and need not repeat a number or identical name, but availability in the registry, matching chapter/type/period, or a later excavation account alone is not the bridge. If no such link supports this candidate, do not add it as a confirmed counterpart or as a speculative subject alternative solely to preserve the relation; retain independently identified participants and genuine source-supported uncertainty. Explain any proposed cross-stage counterpart through that bridge rather than merely repeating the relation wording. Before returning, recheck every actual recipient and alternative against BOTH gates and retain independently supported area layout records, local task recipients and qualified collective evidence. Use original candidate names/numbers to decode opaque refs, never their suffixes. Keep meeting-only exclusion, whole E boundaries, exact source data, review construction and schema rules unchanged; code does not filter targets, repair responses or adopt review corrections.`;

export const CONTENT_ATTACHMENT_TENTATIVE_MEMBERSHIP_POLICY = `TENTATIVE CLASSIFICATION IS NOT INVENTORY EXCLUSION; KEEP ATTACHMENT AND ROLE SEPARATE IN BOTH STAGES: Establish whether the original observation is a member of the bounded investigation inventory separately from how confidently the source classifies it. An original row registering an observation as a possible, estimated or tentative type is positive inventory evidence with a classification hedge, not an unregistered object. When an unchanged clause describes that source-established type group in the same investigation and qualifying scope, keep its eligible hedged members with their original qualification. Do not treat tentative Type T as an unrelated type that must be separately repeated in the group description, demand that an ordinary Type T heading explicitly list tentative Type T too, or require the type interpretation to be certain before preserving the group evidence. Confirmed inventory membership does not mean confirmed classification. Compare every otherwise compatible original member, not only unhedged candidates; the count of unhedged candidates is not the entire registered set. Exclusion requires a separate source-supported membership/scope/type contradiction or absence, not the hedge itself or lack of its repetition. A genuinely incompatible period or investigation stage still excludes a member under the existing current-clause gates, and this rule does not identify artifacts from a generic type-level finds summary.
Then make TWO independent decisions for the SAME unchanged E. (1) Preserve directly described qualified collective evidence on each supported member, including original tentative classifications. (2) Only if this E actually describes a relationship whose individual participant remains unidentified, retain the genuine source-supported role alternatives separately, including eligible hedged members. Individual role uncertainty is not grounds to delete collective recipients; a classification hedge is neither proof of a role nor grounds to omit a plausible participant. Do not reduce role alternatives to the unhedged members just because their interpretations are more certain. First selection uses assigned candidateRefs plus nested unresolved.candidateRefs for the separate role alternatives; independent review uses attachment=included and relationshipSubject=alternative for a member supported in both dimensions. A collective-only E without an unresolved relationship has no role alternative merely because some classification is tentative, and an adjacent relationship sentence does not supply that role to the current E. Recheck the actual recipient AND alternative arrays against every eligible original member before returning; for any exclusion identify the independent original contradiction rather than saying the tentative type is not explicitly listed. Retain current period/stage restrictions, original cross-stage identity bridges, area layout records, local work subjects and exact source hedges. Do not change inputs, evidence maps, review construction, schema rules or saved responses; code never supplies targets, repairs responses or adopts review judgments.`;

/** Expand review coverage without deciding semantic recipients or copying earlier judgments. */
export function createContentAttachmentBodyReviewCoverage(
  input: Input,
  inventoryRequired: Required[],
  selection?: ContentAttachmentRequiredResponse,
  includeTableCells = false,
  sourceGroundedCoverage = false,
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
  const current = [...body, ...data];
  const contexts = new Set(current.flatMap((e) => e[2]));
  const referentMatches = sourceGroundedCoverage
    ? retrieveContentAttachmentReviewReferents(input).filter((m) =>
        current.some((e) => e[0] === m.excerptRef),
      )
    : [];
  const proposed = new Set(
    (sourceGroundedCoverage ? current : body).flatMap((e) => {
      const decision = selection?.decisions[e[0]];
      return decision?.status === 'assigned'
        ? [
            ...decision.candidateRefs,
            ...(decision.unresolved?.candidateRefs ?? []),
          ]
        : decision?.status === 'unresolved'
          ? decision.candidateRefs
          : [];
    }),
  );
  const sourceRefs = new Set([
    ...proposed,
    ...referentMatches.map((m) => m.candidateRef),
  ]);
  const tableInventories =
    includeTableCells || sourceGroundedCoverage
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
            ) ||
            (sourceGroundedCoverage &&
              inventory.candidateRefs.some((ref) => sourceRefs.has(ref))),
        )
      : [];
  const tableRequired: ContextReviewSlot[] = (
    sourceGroundedCoverage ? current : data
  ).flatMap((e) =>
    tableInventories
      .filter((inventory) => {
        if (!sourceGroundedCoverage || dataRefs.has(e[0])) return true;
        const decision = selection?.decisions[e[0]];
        const proposedHere =
          decision?.status === 'assigned'
            ? [
                ...decision.candidateRefs,
                ...(decision.unresolved?.candidateRefs ?? []),
              ]
            : decision?.status === 'unresolved'
              ? decision.candidateRefs
              : [];
        return (
          input.payload.originTables
            .find((t) => t.ref === inventory.ref)!
            .contexts.some((context) => e[2].includes(context)) ||
          inventory.candidateRefs.some(
            (ref) =>
              proposedHere.includes(ref) ||
              referentMatches.some(
                (m) => m.excerptRef === e[0] && m.candidateRef === ref,
              ),
          )
        );
      })
      .map((inventory) => ({
        key: `${e[0]}:${inventory.ref}`,
        excerptRef: e[0],
        inventoryRef: inventory.ref,
        candidateRefs: inventory.candidateRefs,
        selected: [],
        basis: 'inventory' as const,
      })),
  );
  const inventorySlots = new Map(inventoryRequired.map((r) => [r.key, r]));
  for (const required of tableRequired)
    if (!inventorySlots.has(required.key))
      inventorySlots.set(required.key, required);
  const allInventoryRequired = [...inventorySlots.values()];
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
          ...proposed,
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
  const existingRefs = new Set([
    ...inventoryMembers,
    ...pools.flatMap((p) => p.candidateRefs),
  ]);
  const retrieved = new Map<
    string,
    {
      context: string;
      candidateRefs: string[];
      excerpts: string[];
    }
  >();
  for (const e of current) {
    const matches = referentMatches.filter(
      (m) => m.excerptRef === e[0] && !existingRefs.has(m.candidateRef),
    );
    for (const context of new Set(matches.map((m) => m.contextRef))) {
      const refs = [
        ...new Set(
          matches
            .filter((m) => m.contextRef === context)
            .map((m) => m.candidateRef),
        ),
      ];
      const key = JSON.stringify([context, refs]);
      if (!retrieved.has(key))
        retrieved.set(key, { context, candidateRefs: refs, excerpts: [] });
      retrieved.get(key)!.excerpts.push(e[0]);
    }
  }
  const retrievedPools = [...retrieved.values()].map((p, i) => ({
    ...p,
    ref: `B${pools.length + i + 1}`,
  }));
  const required: ContextReviewSlot[] = [
    ...allInventoryRequired.map((r) => ({ ...r, basis: 'inventory' as const })),
    ...current.flatMap((e) =>
      pools.map((pool) => ({
        key: `${e[0]}:${pool.ref}`,
        excerptRef: e[0],
        inventoryRef: pool.ref,
        candidateRefs: pool.candidateRefs,
        selected: [],
        basis: 'body_context' as const,
      })),
    ),
    ...retrievedPools.flatMap((pool) =>
      pool.excerpts.map((excerptRef) => ({
        key: `${excerptRef}:${pool.ref}`,
        excerptRef,
        inventoryRef: pool.ref,
        candidateRefs: pool.candidateRefs,
        selected: [],
        basis: 'body_context' as const,
      })),
    ),
  ];
  return {
    required,
    pools: [
      ...pools,
      ...retrievedPools.map(({ excerpts: _, ...pool }) => pool),
    ],
    referentMatches,
  };
}
