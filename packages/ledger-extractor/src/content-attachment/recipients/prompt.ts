import {
  CONTENT_ATTACHMENT_AREA_ASSESSMENT_POLICY,
  CONTENT_ATTACHMENT_AREA_FINDING_RESULTS_POLICY,
  CONTENT_ATTACHMENT_AREA_RECIPIENT_ASSEMBLY_POLICY,
  CONTENT_ATTACHMENT_INVENTORY_MEMBER_AREA_POLICY,
} from './area-assessments';
import {
  CONTENT_ATTACHMENT_COLLECTIVE_TRACE_POLICY,
  CONTENT_ATTACHMENT_CURRENT_PERIOD_MEMBER_POLICY,
} from './collective-trace';
import {
  CONTENT_ATTACHMENT_COLLECTIVE_SOURCE_SHARING_POLICY,
  CONTENT_ATTACHMENT_CURRENT_TYPE_BOUNDARY_POLICY,
  CONTENT_ATTACHMENT_INVENTORY_REVIEW_POLICY,
  CONTENT_ATTACHMENT_INVENTORY_SUPPORT_POLICY,
  CONTENT_ATTACHMENT_MAPPED_INVENTORY_REVIEW_POLICY,
  CONTENT_ATTACHMENT_WORK_SCOPE_POLICY,
} from './inventory-reviews';
import {
  CONTENT_ATTACHMENT_WORK_GROUP_RELEVANCE_POLICY,
  CONTENT_ATTACHMENT_WORK_SCOPE_ASSESSMENT_POLICY,
  CONTENT_ATTACHMENT_WORK_SCOPE_EVIDENCE_BOUNDARY_POLICY,
} from './work-scope';

export const CONTENT_ATTACHMENT_RECIPIENT_VERSION =
  'segment-recipients.v26' as const;
export type RecipientVersion =
  | 'segment-recipients.v1'
  | 'segment-recipients.v2'
  | 'segment-recipients.v3'
  | 'segment-recipients.v4'
  | 'segment-recipients.v5'
  | 'segment-recipients.v6'
  | 'segment-recipients.v7'
  | 'segment-recipients.v8'
  | 'segment-recipients.v9'
  | 'segment-recipients.v10'
  | 'segment-recipients.v11'
  | 'segment-recipients.v12'
  | 'segment-recipients.v13'
  | 'segment-recipients.v14'
  | 'segment-recipients.v15'
  | 'segment-recipients.v16'
  | 'segment-recipients.v17'
  | 'segment-recipients.v18'
  | 'segment-recipients.v19'
  | 'segment-recipients.v20'
  | 'segment-recipients.v21'
  | 'segment-recipients.v22'
  | 'segment-recipients.v23'
  | 'segment-recipients.v24'
  | 'segment-recipients.v25'
  | typeof CONTENT_ATTACHMENT_RECIPIENT_VERSION;

export const V1_SYSTEM_PROMPT =
  'Judge recipients for the supplied, already inspected original source segments. Do not segment again, rewrite source text or infer expected answers. Inspect each segment in its unchanged whole E, original body/table boundaries and neighboring source context. Return every required segment key, with attachments, recipientIdentityAlternatives and relationshipSubjectAlternatives independently. Empty lists are meaningful; do not force attachment. Use compact IDs only for evidence, never reproduce or normalize quotations. Give a concise reason for the segment disposition, including the source-based boundary of any relevant exclusion. Consider the entire supplied registry; unselected candidates are not confirmed recipients.\nAn attachment means this segment independently describes the candidate. Identify candidates from their own names, numbers, K grounds, original rows, chapter and investigation scope. Origin rows establish membership, not automatic propagation to containing trenches or areas. Preserve a source-established collective description on its identified members even without repeated numbers. Apply current period/type/scope qualifiers before broader antecedent membership. A tentative classification is not by itself evidence against membership or a relationship-subject alternative. Local row counts do not establish a global count or unique relation subject. Do not enlarge a collective to unrelated same-type candidates. General type summaries alone cannot identify individual artifacts.\nPreserve an identified investigation area own boundary, layout, recording and finding results when supported by its definition and original body continuity, separately from contained-unit work. Keep whole project areas distinct from partial survey areas. Same-cell or body-to-table continuation may supply a common action scope; local excavation/backfill does not automatically describe the area. Do not propagate the action object of a later local task backwards into preceding common work. Retain substantive object descriptions even when introduced by a meeting; meeting-only events, generic headers and pure table navigation need no recipients. Respect source-bound nonregistration decisions.\nKeep collective attachment independent of individual relationship-subject identity. A collective clause can have confirmed recipients while a separate relationship clause with an unidentified individual subject has NO confirmed attachment and only alternative subjects. Do not turn collective membership into confirmation of that individual relationship. Merely being a possible relationship subject does not justify a confirmed attachment for that relationship segment. Recipient-identity alternatives mean uncertainty about who receives this description, not uncertainty about which already identified collective member participates in an individual relationship. A road relation must not gain pit/area subject alternatives. Do not identify a relationship counterpart across investigation stages without original linking evidence. Use the original qualifiers and retain genuine uncertainty; never choose a candidate just because it is registered.\nFor every attachment or alternative, select nonempty currentWordRanges contained in that segment. Other current-E segments and E/X sources may supply contextWordRanges but cannot alone justify the current action. Supply each selected candidate own candidateEvidenceRefs; a group needs grounds for every member. originRowRefs may select supporting original O rows bound to the candidates; use an empty list if no such row is needed. Relation alternatives use role subject. Attachments and recipient-identity alternatives cannot assert both certainty and uncertainty for the same candidate in the same segment. Do not copy earlier answers or invent missing IDs. Code resolves provenance and separately previews whole-E preservation without changing your response or applying it to the ledger.';

export const V19_UNCERTAINTY_POLICY =
  'When the sole uncertainty is which candidate is the individual subject of a relationship, return only relationshipSubjectAlternatives; do not duplicate that uncertainty in recipientIdentityAlternatives.\n\nIf both uncertainty types are returned, ground each in a distinct unresolved source referent or independent predicate. Select its supporting evidence IDs in the existing fields and explain the distinction in the existing reason. Repeating the same uncertainty under another role does not establish a second uncertainty. Candidate overlap alone neither establishes nor invalidates two independent judgments.';

export const V20_OPERATION_TARGET_POLICY =
  "Identify the current operation's source-defined targets separately from the group's membership. Return established whole-group coverage only when the operation's targets are supported as covering the full identified group. Plural wording, matching counts, method definitions or inventory membership alone do not establish this connection; no particular word is required.\n\nUse the existing evidence IDs and reason to explain the operation-to-target connection or gap. Keep group-identification grounds in targetIdentification, positive coverage grounds in supportingWordRanges, and inspected but insufficient grounds in consideredWordRanges. If whole-group coverage is not established, retain group relevance and independently supported area or subset attachments.";

export const V21_WORK_TARGET_CROSS_CHECK_POLICY =
  'Before returning an operation segment, cross-check every recipient in nonAreaAttachments and every included areaAssessments entry against the work-scope objects actually returned. Each must appear in targetIdentification.candidateRefs of an assessment with operationCoverage.state = established, in workScopeAssessment.targetGroups or groupReviews.*.fullGroupAssessment.\n\nFor a source-supported independent work target outside the reviewed inventory groups, return its own targetGroups assessment with positive operation evidence in the existing fields. If that assessment is missing, include it; do not remove the supported recipient or invent support to satisfy this check.\n\nPreserve the existing full-group/subset judgments and uncertainty decisions. Identity or membership evidence alone does not establish operation coverage. This check does not require work objects for not_applicable segments.';

export const V23_AREA_OPERATION_LINK_POLICY =
  'Identify each area from its own K/context grounds, then separately determine whether the current operation applies to it. Read the whole segment with its original cell/body context.\n\nIn abbreviated or coordinated work entries, assess which named targets share the action; abbreviation alone does not make an area mention a heading. A linked table detailing other targets neither establishes nor cancels independently supported area work. Definition, containment and inventory membership alone do not establish operation coverage.\n\nUse the existing reason and evidence IDs to distinguish area identification from the operation link or source-based gap. Keep group coverage independent and preserve a separate established work object for an included independent area target.';

export const V24_INVENTORY_SOURCE_QUALIFIER_POLICY =
  'Separate target identification from the source link connecting an inventory to the set described by the CURRENT segment. Using a table only to identify already named targets does not establish that link. If no other source bridge is supported, reject the inventory connection while retaining valid identification grounds in the recipient and work-target fields. A bounded set established by body/context can remain collective with no accepted inventory and an empty inventoryMembershipLinks list. An explicitly supported inventory link remains admissible even when its descriptive predicate is stated in the body.\n\nSelect qualifier ranges by their semantic role. periodWordRanges records archaeological chronology of the described objects. Operational timing or target-selection conditions belong to scopeWordRanges when they constrain the current account; preserve the complete qualifying expression. Selection timing alone does not date either the objects or the operation. Keep type qualifiers in typeWordRanges and leave absent roles empty. These judgments do not replace independently supported recipient decisions or establish operation coverage by themselves.';

export const V25_BODY_SUBSET_COLLECTIVE_POLICY =
  'Judge collectiveAssessment for the source-defined set described by the CURRENT segment, including a proper subset and a work account. When current words and source continuity establish that set and describe its members together, return collective; no whole-inventory result or accepted inventory is required. Rejected inventory adoption or unestablished larger-group coverage does not negate that body-defined collective.\n\nKeep workScopeAssessment independent: establish operation coverage only for source-supported targets, leaving unsupported larger-group coverage not_established. A collective verdict alone neither establishes coverage nor adds recipients or resolves uncertainty. Preserve existing inventory, qualifier and independent-area judgments.';

export const V26_NARRATIVE_TABLE_OPERATION_LINK_POLICY =
  'When a recipient decision relies on a narrative-to-table reference or continuation across table fragments, distinguish three links: (1) the narrative identifies the relevant table; (2) the fragments continue the same table; and (3) the current operation applies to the identified candidate.\n\nIn the existing operationCoverage.reason, or areaAssessments reason when no target group is returned, state the outcome and source-grounded basis for each necessary link separately. Explain an established, rejected, or unresolved link without substituting another link for it. Use original word ranges in the existing evidence fields and structural references in reason; never place structural references in word-range or candidate-evidence fields.\n\nAssess continuation from the combined original context, captions, headers, boundaries and sequence. An unjudged continuation is not a rejection. Table continuity alone does not establish an operation target, and candidate definition alone does not establish operation coverage. Respect explicit table boundaries and current investigation or task-scope restrictions. Preserve independently supported attachments; an unresolved link does not automatically create recipient-identity alternatives. Do not add fields or rewrite source text.';

export function isSingleAreaRecipientVersion(version: RecipientVersion) {
  return (
    version === 'segment-recipients.v18' ||
    version === 'segment-recipients.v19' ||
    version === 'segment-recipients.v20' ||
    version === 'segment-recipients.v21' ||
    version === 'segment-recipients.v22' ||
    version === 'segment-recipients.v23' ||
    version === 'segment-recipients.v24' ||
    version === 'segment-recipients.v25' ||
    version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
  );
}

/** The recipient system prompt for a supported version; it depends on the version only. */
export function contentAttachmentRecipientSystemPrompt(
  version: RecipientVersion,
): string {
  const singleAreaDecision = isSingleAreaRecipientVersion(version);
  const basePrompt =
    version === 'segment-recipients.v1'
      ? V1_SYSTEM_PROMPT
      : V1_SYSTEM_PROMPT +
        '\n' +
        (version === 'segment-recipients.v2'
          ? CONTENT_ATTACHMENT_COLLECTIVE_TRACE_POLICY
          : version === 'segment-recipients.v3'
            ? CONTENT_ATTACHMENT_INVENTORY_REVIEW_POLICY
            : version === 'segment-recipients.v4'
              ? CONTENT_ATTACHMENT_MAPPED_INVENTORY_REVIEW_POLICY
              : CONTENT_ATTACHMENT_MAPPED_INVENTORY_REVIEW_POLICY +
                '\n' +
                CONTENT_ATTACHMENT_COLLECTIVE_SOURCE_SHARING_POLICY +
                (version === 'segment-recipients.v5'
                  ? ''
                  : '\n' +
                    CONTENT_ATTACHMENT_CURRENT_TYPE_BOUNDARY_POLICY +
                    (version === 'segment-recipients.v6'
                      ? ''
                      : '\n' +
                        CONTENT_ATTACHMENT_WORK_SCOPE_POLICY +
                        (version === 'segment-recipients.v7'
                          ? ''
                          : '\n' +
                            CONTENT_ATTACHMENT_WORK_SCOPE_ASSESSMENT_POLICY +
                            (version === 'segment-recipients.v8'
                              ? ''
                              : '\n' +
                                CONTENT_ATTACHMENT_AREA_ASSESSMENT_POLICY +
                                (version === 'segment-recipients.v9'
                                  ? ''
                                  : '\n' +
                                    CONTENT_ATTACHMENT_AREA_FINDING_RESULTS_POLICY +
                                    (version === 'segment-recipients.v10'
                                      ? ''
                                      : '\n' +
                                        CONTENT_ATTACHMENT_INVENTORY_MEMBER_AREA_POLICY +
                                        (version === 'segment-recipients.v11'
                                          ? ''
                                          : '\n' +
                                            CONTENT_ATTACHMENT_WORK_SCOPE_EVIDENCE_BOUNDARY_POLICY +
                                            (version ===
                                            'segment-recipients.v12'
                                              ? ''
                                              : '\n' +
                                                CONTENT_ATTACHMENT_CURRENT_PERIOD_MEMBER_POLICY +
                                                (version ===
                                                  'segment-recipients.v16' ||
                                                version ===
                                                  'segment-recipients.v17' ||
                                                version ===
                                                  'segment-recipients.v18' ||
                                                version ===
                                                  'segment-recipients.v19' ||
                                                version ===
                                                  'segment-recipients.v20' ||
                                                version ===
                                                  'segment-recipients.v21' ||
                                                version ===
                                                  'segment-recipients.v22' ||
                                                version ===
                                                  'segment-recipients.v23' ||
                                                version ===
                                                  'segment-recipients.v24' ||
                                                version ===
                                                  'segment-recipients.v25' ||
                                                version ===
                                                  CONTENT_ATTACHMENT_RECIPIENT_VERSION
                                                  ? '\n' +
                                                    CONTENT_ATTACHMENT_WORK_GROUP_RELEVANCE_POLICY
                                                  : ''))))))))));
  const systemPrompt = singleAreaDecision
    ? basePrompt
        .replace(
          'with attachments, recipientIdentityAlternatives',
          'with nonAreaAttachments, recipientIdentityAlternatives',
        )
        .replace(
          'and never adds/removes recipients, repairs source or changes raw output.',
          'and never revises recipient judgments, repairs source or changes raw output.',
        ) +
      '\n' +
      CONTENT_ATTACHMENT_AREA_RECIPIENT_ASSEMBLY_POLICY
    : basePrompt;
  const uncertaintyPrompt =
    version === 'segment-recipients.v19' ||
    version === 'segment-recipients.v20' ||
    version === 'segment-recipients.v21' ||
    version === 'segment-recipients.v22' ||
    version === 'segment-recipients.v23' ||
    version === 'segment-recipients.v24' ||
    version === 'segment-recipients.v25' ||
    version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
      ? systemPrompt.replace(
          '\nFor every attachment or alternative,',
          '\n' +
            V19_UNCERTAINTY_POLICY +
            '\nFor every attachment or alternative,',
        )
      : systemPrompt;
  const operationTargetPrompt =
    version === 'segment-recipients.v20' ||
    version === 'segment-recipients.v21' ||
    version === 'segment-recipients.v22' ||
    version === 'segment-recipients.v23' ||
    version === 'segment-recipients.v24' ||
    version === 'segment-recipients.v25' ||
    version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
      ? uncertaintyPrompt.replace(
          '\n\nThese work-assessment rules do not narrow source-established collective findings',
          '\n\n' +
            V20_OPERATION_TARGET_POLICY +
            '\n\nThese work-assessment rules do not narrow source-established collective findings',
        )
      : uncertaintyPrompt;
  const crossCheckedPrompt =
    version === 'segment-recipients.v21' ||
    version === 'segment-recipients.v22' ||
    version === 'segment-recipients.v23' ||
    version === 'segment-recipients.v24' ||
    version === 'segment-recipients.v25' ||
    version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
      ? operationTargetPrompt + '\n\n' + V21_WORK_TARGET_CROSS_CHECK_POLICY
      : operationTargetPrompt;
  const inventorySupportPrompt =
    version === 'segment-recipients.v22' ||
    version === 'segment-recipients.v23' ||
    version === 'segment-recipients.v24' ||
    version === 'segment-recipients.v25' ||
    version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
      ? crossCheckedPrompt.replace(
          CONTENT_ATTACHMENT_MAPPED_INVENTORY_REVIEW_POLICY,
          CONTENT_ATTACHMENT_MAPPED_INVENTORY_REVIEW_POLICY +
            '\n\n' +
            CONTENT_ATTACHMENT_INVENTORY_SUPPORT_POLICY,
        )
      : crossCheckedPrompt;
  const areaOperationPrompt =
    version === 'segment-recipients.v23' ||
    version === 'segment-recipients.v24' ||
    version === 'segment-recipients.v25' ||
    version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
      ? inventorySupportPrompt + '\n\n' + V23_AREA_OPERATION_LINK_POLICY
      : inventorySupportPrompt;
  const inventorySourcePrompt =
    version === 'segment-recipients.v24' ||
    version === 'segment-recipients.v25' ||
    version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
      ? areaOperationPrompt + '\n\n' + V24_INVENTORY_SOURCE_QUALIFIER_POLICY
      : areaOperationPrompt;
  const bodySubsetPrompt =
    version === 'segment-recipients.v25' ||
    version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
      ? inventorySourcePrompt + '\n\n' + V25_BODY_SUBSET_COLLECTIVE_POLICY
      : inventorySourcePrompt;
  return version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
    ? bodySubsetPrompt + '\n\n' + V26_NARRATIVE_TABLE_OPERATION_LINK_POLICY
    : bodySubsetPrompt;
}
