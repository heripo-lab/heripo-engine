import type { ContentAttachmentRecipientSupport } from './content-attachment-recipients';

import { z } from 'zod';

import { CONTENT_ATTACHMENT_WORD_RANGE_PATTERN } from './content-attachment-word-evidence';

export interface ContentAttachmentAreaAssessment {
  disposition: 'included' | 'excluded' | 'unresolved';
  currentWordRanges: string[];
  contextWordRanges: string[];
  candidateEvidenceRefs: string[];
  reason: string;
}

export const CONTENT_ATTACHMENT_AREA_ASSESSMENT_POLICY =
  'INDEPENDENT AREA ASSESSMENTS: For EVERY segment return areaAssessments with EVERY area candidate key required by the schema. Code derives these keys from the entire supplied registry, deduplicating original mentions; neither chapter paths, inventory membership nor workScopeAssessment selects or removes them. Do not add another model call or repeat source quotations. For each area independently return included, excluded or unresolved, its own candidateEvidenceRefs, currentWordRanges, contextWordRanges and a concise source-grounded reason. The K grounds are required even for exclusions. Included or unresolved recipients require nonempty current words in THIS segment; exclusions may have no current words when the area is not described, while explaining the source boundary or lack of a link.\nDetermine whether the current statement independently describes this identified area, including its own finding results, boundary, layout or recording supported by original definition and source continuity. An inventory collective and a directly described area are separate recipient judgments. Current feature-type restrictions limit the described feature set, not automatically the independently described area whose findings are reported. Preserve whole-project versus partial-investigation definitions. Do not propagate findings or local work to every containing area merely because it contains the objects. A location reference alone does not independently describe the area. Explain exclusions and genuine recipient-identity uncertainty instead of silently omitting an area.\nAn included area must be a final attachment and not a recipient-identity alternative; an excluded area must be neither; an unresolved area must remain a recipient-identity alternative and not a confirmed attachment. Preserve alternative grouping and judge relationship-subject alternatives independently. Findings or relationships classified as not_applicable for work coverage still require areaAssessments. Work descriptions must also satisfy their separate operation-coverage contract. Code checks completeness, provenance and agreement with final recipients, not semantic correctness, and never adds/removes recipients, repairs source or changes raw output.';

export const CONTENT_ATTACHMENT_AREA_FINDING_RESULTS_POLICY =
  "AREA FINDING RESULTS VERSUS LOCATION REFERENCES: First identify the area from its original definition, investigation phase and source continuity, keeping a partial investigation distinct from the whole project. Then assess what the current assertion describes. Findings reported for that identified investigation scope can independently describe the area THROUGH its confirmed archaeological objects. Such a result need not restate boundaries, dimensions, layout or another area-only property. Do not exclude an identified investigation area solely because its result is expressed as feature findings or shares recipients with a feature collective. Use the current claim and its linked investigation-result context as evidence in the existing area assessment fields.\nIn contrast, a place or findspot modifier that merely locates another object while the assertion describes that object's form, condition or other properties does not by itself describe the area. Judge the whole assertion and discourse: a location word, grammatical marker or finding verb alone is insufficient for either inclusion or exclusion. Independent area assessment means independent source support, not a requirement that the statement discuss only the area.\nArea-result preservation does not widen the described feature set, convert location anchors into recipients or propagate to other containing areas. Apply existing period/type limits to collective members and retain their original qualifications. Keep operation-coverage requirements and relationship-subject identity judgments separate. Record support or the failed source link in the existing evidence-ID and reason fields; do not add fields, rewrite source or infer recipients from containment.";

export const CONTENT_ATTACHMENT_INVENTORY_MEMBER_AREA_POLICY =
  'Keep inventory connection, member selection and independent area assessment separate. Accepting an inventory establishes a source-set connection; it does not include every member. Do not reject an otherwise source-established inventory connection merely because some members fall outside the current period or type restrictions. For an accepted inventory, review every original member and apply those restrictions individually, preserving tentative classifications under the existing rules.\n\nSeparately assess each area from its own definition and current source evidence. Area inclusion neither replaces nor proves collective member attachment; inventory acceptance or rejection does not by itself determine area inclusion. Express these judgments together in the existing fields without adding fields or inferring a missing source connection.';

/** Require one independent judgment for each registry-derived area, including exclusions. */
export function createContentAttachmentAreaAssessmentsSchema(
  areaRefs: string[],
) {
  const ranges = z
    .array(z.string().regex(CONTENT_ATTACHMENT_WORD_RANGE_PATTERN))
    .meta({ id: 'AreaAssessmentRanges' });
  const assessment = z
    .strictObject({
      disposition: z.enum(['included', 'excluded', 'unresolved']),
      currentWordRanges: ranges,
      contextWordRanges: ranges,
      candidateEvidenceRefs: z.array(z.string()).min(1),
      reason: z.string().min(1),
    })
    .meta({ id: 'AreaAssessment' });
  return z
    .strictObject(Object.fromEntries(areaRefs.map((ref) => [ref, assessment])))
    .meta({ id: 'AreaAssessments' });
}

/** Check area provenance and recipient consistency independently of inventory or work classification. */
export function inspectContentAttachmentAreaAssessments(
  assessments: Record<string, ContentAttachmentAreaAssessment>,
  final: {
    attachments: Array<{ candidateRef: string }>;
    recipientIdentityAlternatives: Array<{ candidateRefs: string[] }>;
  },
  resolve: (
    support: ContentAttachmentRecipientSupport,
    refs: string[],
  ) => unknown,
) {
  for (const [ref, assessment] of Object.entries(assessments)) {
    if (
      assessment.disposition !== 'excluded' &&
      !assessment.currentWordRanges.length
    )
      throw new Error(
        `Area inclusion or uncertainty lacks current evidence: ${ref}`,
      );
    resolve({ ...assessment, originRowRefs: [] }, [ref]);
    const attached = final.attachments.some((a) => a.candidateRef === ref);
    const uncertain = final.recipientIdentityAlternatives.some((a) =>
      a.candidateRefs.includes(ref),
    );
    if (
      attached !== (assessment.disposition === 'included') ||
      uncertain !== (assessment.disposition === 'unresolved')
    )
      throw new Error(`Area judgment and final recipients disagree: ${ref}`);
  }
}
