import {
  HISTORICAL_SYSTEM_PROMPTS,
  QUOTE_SCOPE_SYSTEM_PROMPT_V58,
} from './prompts-history';
import {
  CONTENT_ATTACHMENT_AREA_RECIPIENT_BOUNDARY_POLICY,
  CONTENT_ATTACHMENT_AREA_RECORD_BOUNDARY_POLICY,
  CONTENT_ATTACHMENT_AREA_RECORD_LINK_POLICY,
  CONTENT_ATTACHMENT_AREA_RESULTS_POLICY,
  CONTENT_ATTACHMENT_AREA_SCOPE_POLICY,
  CONTENT_ATTACHMENT_AREA_WORK_POLICY,
  CONTENT_ATTACHMENT_CLAUSE_GROUNDS_POLICY,
  CONTENT_ATTACHMENT_CONTEXT_REVIEW_POLICY,
  CONTENT_ATTACHMENT_FIELDWORK_CONTINUITY_POLICY,
  CONTENT_ATTACHMENT_QUALIFIED_COLLECTIVE_POLICY,
  CONTENT_ATTACHMENT_QUALIFIER_STAGE_GATE_POLICY,
  CONTENT_ATTACHMENT_RECIPIENT_REF_CHECK_POLICY,
  CONTENT_ATTACHMENT_TENTATIVE_MEMBERSHIP_POLICY,
} from './review/body-review';

export const CONTENT_ATTACHMENT_PROMPT_VERSION = 'content-attachment.v74';
const GROUNDED_REPLACEMENTS: Record<number, string> = {
  1: 'Code freezes every E excerpt and its source text. Select only the supplied E and candidate refs. Candidate quotes are now pairs [K ref, unchanged text] following candidateQuoteColumns. Never return, normalize or quote source text as evidence. Evidence provenance is selected exclusively through E and K refs; code resolves the frozen original strings. Existing reasons explain judgments in Korean, never serve as quoted evidence or reproduce text values. Keep all E boundaries and characters unchanged.',
  14: 'BEFORE RETURNING: Check every fixed E for all directly described candidates, grounded shared context and genuine identity alternatives. Select evidence IDs rather than copying text. Keep original source strings and fixed E boundaries unchanged; explanatory reason prose is not an original-source citation.',
  71: "REQUIRED GROUNDED OUTPUT CONTRACT: Return exactly {decisions, inventoryAudits, exclusions}. decisions keeps EVERY supplied E key and its existing assigned/unresolved/ignored decision shape. Assigned decisions keep all confirmed candidateRefs and independently supported nested unresolved role alternatives. inventoryAudits and exclusions are required arrays, empty only where no review applies. Each inventory audit names its excerptRef and original inventoryRef and returns EVERY member key required by that inventory schema. Each member is either state included or state excluded. Included means that member occurs among the same E assignments or genuine unresolved alternatives. Excluded requires contextRef equal to that E, candidateEvidenceRefs selecting that SAME candidate's provided K evidence, and a concise explanation. Every excluded member has its own structured grounds; a summary reason cannot replace those required fields. Code reports incomplete, contradictory or missing required reviews without adding targets or repairing the response.",
  72: 'Earlier assignments/unresolved/ignored array references still describe the same semantic categories inside decisions. Audit metadata is provenance and coverage, never a replacement for selecting the E or its targets. Multiple candidates may share the unchanged E and assigned/role-uncertain refs may overlap. Do not add quote fields, source paths, copied source strings, calculated IDs or extra properties. All actual citations use provided IDs; code reconstructs their unchanged text and source ranges.',
  97: 'STRUCTURED EXCLUSION GROUNDS: inventoryMembers lists original-table registration pools, not automatically eligible description recipients. When reviewing a source-established set, select the relevant original inventory and classify EVERY member using the current E and its original K evidence. Members removed by current period/investigation/location/type qualifiers remain in this review and require an excluded entry with contextRef, their own candidateEvidenceRefs and reason. Do not remove them from the audit after narrowing. Unrelated inventory members such as row owners need a direct-description explanation for exclusion, never automatic sharing from registration context. Use exclusions for additional excluded candidates outside a selected table review, with excerptRef, candidateRef, contextRef, candidateEvidenceRefs and reason; do not duplicate the same E/member in both places. No source text is requested in either structure.',
  99: 'REVIEW COVERAGE AND PROVENANCE CHECK: A body E selecting multiple registered candidates from multiple rows of the same original table requires that inventory audit. Code checks this deterministic source-trace condition, every included/excluded member against the actual selected refs, and each K ID against that candidate. This trace rule does not determine the semantic truth of membership or of an exclusion. For any other source-established set, still provide the relevant inventory audit or explicit exclusions rather than silently dropping supported members. Select the full original set before narrowing; explain real qualifier exclusions through context E and candidate K IDs. Preserve originally recorded tentative observations and genuine relationship-role alternatives; a tentative classification is not by itself an exclusion ground.',
};
const GROUNDED_SYSTEM_PROMPT_V59 =
  QUOTE_SCOPE_SYSTEM_PROMPT_V58.split('\n')
    .map((line, index) => GROUNDED_REPLACEMENTS[index] ?? line)
    .join('\n') +
  `
MIXED AREA-WORK AND NAMED-UNIT CELLS: Read every substantive clause of an indivisible diary cell. An explicitly stated current investigation area, its boundary survey, grid or site-layout work is its own work subject, even when another clause names one trench or feature. Resolve that area through the supplied current investigation definition, body-to-table context and registry evidence. Preserve the SAME whole cell on the identified area AND the named unit when their independent work is described. A later named unit does not retroactively absorb an earlier explicitly named area subject; the nearest-subject default only resolves genuinely omitted work subjects. Do not classify an area's own boundary survey as unrelated administration merely because it has no object number or differs from the registry's literal name. Do not spread local work to all units or ancestors without original grounds. Keep full E source text immutable and return only evidence IDs for provenance.`;

const SELECTION_SYSTEM_PROMPT_V60 = GROUNDED_SYSTEM_PROMPT_V59.split('\n')
  .map((line, index) =>
    index === 71
      ? 'SELECTION OUTPUT CONTRACT: Return exactly {decisions}, preserving EVERY required E key. Keep confirmed evidence recipients in candidateRefs and independently supported relationship-role alternatives in the SAME decision unresolved field; those lists may overlap. Code freezes these selections and derives a separate required inventory-review schema from original multirow bindings. The later review only explains selections; it cannot add missing collective recipients or change role alternatives. Do not return inventoryAudits or exclusions in this selection response.'
      : index === 97
        ? 'EXCLUSION PROVENANCE IS REVIEWED SEPARATELY: First evaluate all original-set members against the current qualifiers and preserve every supported collective recipient. The later review must account for the full original registration pool, including qualifier-excluded candidates, through E and own-candidate K IDs. Do not suppress a supported target to avoid review, substitute review metadata for its assignment or invent exclusion grounds.'
        : index === 99
          ? 'SEPARATE CHECKS BEFORE FREEZING THE DECISION: For each mixed collective-and-relationship E, first record every source-established member directly described by its collective clause after applying current qualifiers. Then independently identify the relationship subject and keep all genuinely supported alternatives in unresolved when identity is not established. Preserve a directly described area as an additional recipient; it never replaces the feature set. An unidentified singular relationship subject does not erase earlier collective road, pit or other feature evidence. Tentative original classification alone does not remove a verified member or role alternative. Audit each E for both target lists before returning: later provenance review cannot repair an omitted assignment or alternative.'
          : line,
  )
  .join('\n');

const INDEPENDENT_SYSTEM_PROMPT_V61 = SELECTION_SYSTEM_PROMPT_V60.replace(
  'Code freezes these selections and derives a separate required inventory-review schema from original multirow bindings. The later review only explains selections; it cannot add missing collective recipients or change role alternatives.',
  'Code preserves these original selections and derives required review coverage from original multirow bindings. An independent reviewer then judges attachment and relationship-subject alternatives from source evidence without seeing these decisions. Both original responses and their disagreements are retained separately; review proposals never overwrite this response.',
).replace(
  'later provenance review cannot repair an omitted assignment or alternative.',
  'independent review may disagree, but it never replaces this original decision.',
);

const CONTEXT_SYSTEM_PROMPT_V62 =
  INDEPENDENT_SYSTEM_PROMPT_V61 +
  '\n' +
  CONTENT_ATTACHMENT_CONTEXT_REVIEW_POLICY;

const QUALIFIED_SYSTEM_PROMPT_V63 =
  CONTEXT_SYSTEM_PROMPT_V62 +
  '\n' +
  CONTENT_ATTACHMENT_QUALIFIED_COLLECTIVE_POLICY;

const SYSTEM_PROMPT_V64 =
  QUALIFIED_SYSTEM_PROMPT_V63 +
  '\n' +
  CONTENT_ATTACHMENT_RECIPIENT_REF_CHECK_POLICY;

const SYSTEM_PROMPT_V65 =
  SYSTEM_PROMPT_V64 + '\n' + CONTENT_ATTACHMENT_AREA_SCOPE_POLICY;

const SYSTEM_PROMPT_V66 =
  SYSTEM_PROMPT_V65 + '\n' + CONTENT_ATTACHMENT_AREA_WORK_POLICY;

const SYSTEM_PROMPT_V67 =
  SYSTEM_PROMPT_V66 + '\n' + CONTENT_ATTACHMENT_AREA_RESULTS_POLICY;

const SYSTEM_PROMPT_V68 =
  SYSTEM_PROMPT_V67 + '\n' + CONTENT_ATTACHMENT_AREA_RECIPIENT_BOUNDARY_POLICY;

const SYSTEM_PROMPT_V69 =
  SYSTEM_PROMPT_V68 + '\n' + CONTENT_ATTACHMENT_FIELDWORK_CONTINUITY_POLICY;

const SYSTEM_PROMPT_V70 =
  SYSTEM_PROMPT_V69 + '\n' + CONTENT_ATTACHMENT_AREA_RECORD_LINK_POLICY;

const SYSTEM_PROMPT_V71 =
  SYSTEM_PROMPT_V70 + '\n' + CONTENT_ATTACHMENT_AREA_RECORD_BOUNDARY_POLICY;

const SYSTEM_PROMPT_V72 =
  SYSTEM_PROMPT_V71 + '\n' + CONTENT_ATTACHMENT_CLAUSE_GROUNDS_POLICY;

const SYSTEM_PROMPT_V73 =
  SYSTEM_PROMPT_V72 + '\n' + CONTENT_ATTACHMENT_QUALIFIER_STAGE_GATE_POLICY;

const SYSTEM_PROMPT =
  SYSTEM_PROMPT_V73 + '\n' + CONTENT_ATTACHMENT_TENTATIVE_MEMBERSHIP_POLICY;

/** System prompt of every saved content attachment prompt version; older versions stay replayable. */
const SYSTEM_PROMPTS = {
  ...HISTORICAL_SYSTEM_PROMPTS,
  'content-attachment.v59': GROUNDED_SYSTEM_PROMPT_V59,
  'content-attachment.v60': SELECTION_SYSTEM_PROMPT_V60,
  'content-attachment.v61': INDEPENDENT_SYSTEM_PROMPT_V61,
  'content-attachment.v62': CONTEXT_SYSTEM_PROMPT_V62,
  'content-attachment.v63': QUALIFIED_SYSTEM_PROMPT_V63,
  'content-attachment.v64': SYSTEM_PROMPT_V64,
  'content-attachment.v65': SYSTEM_PROMPT_V65,
  'content-attachment.v66': SYSTEM_PROMPT_V66,
  'content-attachment.v67': SYSTEM_PROMPT_V67,
  'content-attachment.v68': SYSTEM_PROMPT_V68,
  'content-attachment.v69': SYSTEM_PROMPT_V69,
  'content-attachment.v70': SYSTEM_PROMPT_V70,
  'content-attachment.v71': SYSTEM_PROMPT_V71,
  'content-attachment.v72': SYSTEM_PROMPT_V72,
  'content-attachment.v73': SYSTEM_PROMPT_V73,
  'content-attachment.v74': SYSTEM_PROMPT,
};
export type ContentAttachmentPromptVersion = keyof typeof SYSTEM_PROMPTS;

/** System prompt of one content attachment prompt version. */
export function contentAttachmentSystemPrompt(
  promptVersion: ContentAttachmentPromptVersion,
) {
  return SYSTEM_PROMPTS[promptVersion];
}

/** True for every saved content attachment prompt version and no other value. */
export function isContentAttachmentPromptVersion(
  version: string,
): version is ContentAttachmentPromptVersion {
  return Object.hasOwn(SYSTEM_PROMPTS, version);
}

/** True when a value is content-attachment.v{from} through v{to}; any other string is outside every range. */
export function isContentAttachmentPromptBetween(
  version: string,
  from: number,
  to: number,
) {
  const n = Number(
    `#${version}`.replace(/^#content-attachment\.v([1-9]\d*)$/, '$1'),
  );
  return n >= from && n <= to;
}
