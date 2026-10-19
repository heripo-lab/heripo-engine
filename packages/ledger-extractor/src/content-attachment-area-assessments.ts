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
