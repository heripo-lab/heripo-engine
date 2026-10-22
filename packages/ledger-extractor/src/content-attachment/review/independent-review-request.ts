import type { ContentAttachmentRequiredResponse } from '../response';
import type {
  ContentAttachmentIndependentReviewResponse,
  Input,
} from './independent-review-types';

import { z } from 'zod';

import {
  CONTENT_ATTACHMENT_WORD_EVIDENCE_POLICY,
  CONTENT_ATTACHMENT_WORD_RANGE_PATTERN,
  contentAttachmentWordRows,
  createContentAttachmentWordEvidence,
} from '../recipients/word-evidence';
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
  createContentAttachmentBodyReviewCoverage,
} from './body-review';
import { attachment, relationshipSubject } from './independent-review-types';
import { createContentAttachmentInventoryReviewRequest } from './inventory-review';
import { CONTENT_ATTACHMENT_SEGMENT_REVIEW_POLICY } from './segment-review';

/** Require original pool coverage while withholding earlier decisions from the independent judge. */
export function createContentAttachmentIndependentReviewRequest(
  input: Input,
  selection: ContentAttachmentRequiredResponse,
  options: {
    segmentReview?: boolean;
    wordEvidence?: boolean;
    sourceGroundedCoverage?: boolean;
    includeBodyContext?: boolean;
    qualifyBeforeIdentity?: boolean;
    reconcileRecipientRefs?: boolean;
    crossChapterAreas?: boolean;
    preserveAreaWork?: boolean;
    preserveAreaResults?: boolean;
    boundAreaResultRecipients?: boolean;
    reviewTableWork?: boolean;
    traceAreaRecording?: boolean;
    boundAreaRecording?: boolean;
    checkClauseGrounds?: boolean;
    gateQualifierStage?: boolean;
    preserveTentativeMembership?: boolean;
  } = {},
) {
  const baseline = createContentAttachmentInventoryReviewRequest(
    input,
    selection,
  );
  const evidence = JSON.parse(baseline.userPrompt);
  delete evidence.decisions;
  const coverage = options.includeBodyContext
    ? createContentAttachmentBodyReviewCoverage(
        input,
        baseline.required,
        options.crossChapterAreas ? selection : undefined,
        options.reviewTableWork,
        options.sourceGroundedCoverage,
      )
    : null;
  const required = coverage?.required ?? baseline.required;
  if (coverage) {
    const candidates = new Set(required.flatMap((r) => r.candidateRefs));
    evidence.candidates = input.payload.candidates.filter((row) =>
      candidates.has(row[0] as string),
    );
    evidence.bodyReviewPools = coverage.pools;
    evidence.requiredReviews = required.map((r) => [
      r.key,
      r.excerptRef,
      r.inventoryRef,
    ]);
  }
  if (options.reviewTableWork) {
    evidence.excerpts = input.payload.current.excerpts;
    evidence.currentTables = input.payload.current.tables;
    const inventories = new Set(required.map((r) => r.inventoryRef));
    evidence.originTables = input.payload.originTables.filter((t) =>
      inventories.has(t.ref),
    );
    evidence.originRows = input.payload.originRows.filter((r) =>
      inventories.has(r[1]),
    );
    const rows = new Set(evidence.originRows.map((r: [string]) => r[0]));
    evidence.originAnchors = input.payload.originAnchors.filter((a) =>
      rows.has(a[1]),
    );
  }
  const wordEvidence =
    options.wordEvidence || options.segmentReview
      ? createContentAttachmentWordEvidence(
          input,
          new Set(evidence.excerpts.map((e: [string]) => e[0])),
        )
      : undefined;
  if (wordEvidence) {
    evidence.excerpts = evidence.excerpts.map((e: unknown[]) => [
      ...e.slice(0, 4),
      contentAttachmentWordRows(
        wordEvidence.sources.find((s) => s.ref === e[0])!,
      ),
    ]);
    evidence.readOnlyContext = wordEvidence.sources
      .filter((s) => s.kind === 'read_only')
      .map((s) => [
        s.ref,
        input.payload.current.readOnlyContext.find(
          (r) => r[0] === s.originalRef,
        )![1],
        contentAttachmentWordRows(s),
      ]);
    evidence.excerptColumns = ['ref', 'kind', 'contexts', 'tableCell', 'words'];
    evidence.readOnlyContextColumns = ['ref', 'contexts', 'words'];
    evidence.wordColumns = ['ref', 'literalSurfaceUnit'];
  }
  const context = z
    .enum(input.codeMap.excerpts.map((e) => e.ref) as [string, ...string[]])
    .meta({ id: 'IndependentContext' });
  const refs = [...new Set(required.flatMap((r) => r.candidateRefs))];
  const wordRanges = z
    .array(z.string().regex(CONTENT_ATTACHMENT_WORD_RANGE_PATTERN))
    .meta({ id: 'IndependentWordRanges' });
  const segmentDecision = z
    .strictObject({
      segment: z.number().int().min(1),
      attachment,
      relationshipSubject,
      reason: z.string().min(1),
    })
    .meta({ id: 'IndependentSegmentDecision' });
  const members = new Map(
    refs.map((ref, index) => {
      const baseMember = z.strictObject({
        attachment,
        relationshipSubject,
        contextRef: context,
        candidateEvidenceRefs: z
          .array(
            z.enum(
              input.citations
                .filter((c) => c.candidateRef === ref)
                .map((c) => c.ref) as [string, ...string[]],
            ),
          )
          .min(1),
        reason: z.string().min(1),
      });
      const member = options.segmentReview
        ? z.strictObject({
            segmentDecisions: z.array(segmentDecision),
            ...baseMember.shape,
          })
        : baseMember;
      return [
        ref,
        (wordEvidence ? member.extend({ wordRanges }) : member).meta({
          id: `IndependentMember${index + 1}`,
        }),
      ];
    }),
  );
  const reviews = z.strictObject(
    Object.fromEntries(
      required.map((r) => [
        r.key,
        z.strictObject(
          Object.fromEntries(
            r.candidateRefs.map((ref) => [ref, members.get(ref)!]),
          ),
        ),
      ]),
    ),
  );
  const segment = z
    .strictObject({
      kind: z.enum(['substantive', 'non_substantive']),
      wordRanges: z
        .array(z.string().regex(CONTENT_ATTACHMENT_WORD_RANGE_PATTERN))
        .min(1)
        .meta({ id: 'IndependentSegmentWordRanges' }),
    })
    .meta({ id: 'IndependentSegment' });
  const schema: z.ZodType<ContentAttachmentIndependentReviewResponse> =
    options.segmentReview
      ? z.strictObject({
          segments: z.strictObject(
            Object.fromEntries(
              [...new Set(required.map((r) => r.excerptRef))].map((ref) => [
                ref,
                z
                  .array(segment)
                  .min(
                    wordEvidence!.sources.find((s) => s.ref === ref)!.words
                      .length
                      ? 1
                      : 0,
                  ),
              ]),
            ),
          ),
          reviews,
        })
      : z.strictObject({ reviews });
  const systemPrompt =
    'Independently judge every required original excerpt/inventory member from the supplied original evidence. Earlier model selections are intentionally withheld. No inclusion or exclusion is predetermined by an earlier decision or by the schema. Return every review key and every candidate member key. The registration pool is a review baseline, not an automatically eligible set. For EACH member decide attachment as included, excluded or unresolved, then independently decide relationshipSubject as alternative or not_alternative. Included means the unchanged E directly describes this source-established member, including supported collective evidence; unresolved attachment means genuinely ambiguous recipient identity. Alternative means a genuinely unresolved subject of a relationship clause, not uncertain classification or uncertain existence of the relationship. Included attachment and alternative relationship subject may coexist on the SAME candidate. A relationship participant with resolved identity requires no subject alternatives.\nFirst establish the bounded original investigation set through the body, original rows and candidate evidence, then apply the CURRENT clause period, investigation, location and type qualifiers. Preserve every directly described verified member of a collective even without repeated numbers, including original tentative classifications. Candidate row context establishes identity and membership; it does not automatically describe the row owner or propagate an excerpt to all trenches, ancestors or same-type records. A directly described area is an additional recipient and never replaces a supported feature set. Collective evidence does not prove physical identity or every member participation in a later relationship. Evaluate all substantive clauses of the indivisible E: later uncertainty about one relationship subject does not erase an earlier collective description. Keep genuine role alternatives separately from collective recipients, without adding unsupported comparisons or previous-investigation objects. The lack of an individual identifier is not itself a reason to exclude a verified member of a collective.\nGive contextRef equal to the current E and one or more of the SAME candidate provided K evidence IDs for EVERY disposition, plus a concise Korean explanation grounded in that source context. Apply these grounds to qualifier-excluded candidates too; do not justify exclusion from an earlier model shortlist or fabricate absent evidence. If original membership or identity cannot actually be established, state that uncertainty rather than guessing. E and K select immutable original text and exact locations: never reproduce, normalize or invent source quotations, merge records or alter source boundaries. Code preserves both original responses and computes disagreement separately; your judgment is not required to agree with another response.';
  return {
    segmentReview: options.segmentReview
      ? { version: 'segment-review.v1' as const }
      : undefined,
    wordEvidence,
    coverage: options.sourceGroundedCoverage
      ? {
          version: 'source-grounded.v1' as const,
          referentMatches: coverage?.referentMatches ?? [],
        }
      : undefined,
    required,
    schema,
    systemPrompt:
      (options.includeBodyContext
        ? systemPrompt +
          '\n' +
          CONTENT_ATTACHMENT_CONTEXT_REVIEW_POLICY +
          '\nBody review pools use B refs for original body-grounded context candidates; U refs retain original table membership. Evaluate every supplied E/pool/member independently, including excluded or ignored passages. A pool is review coverage, not a claim of table membership or a preset inclusion. Explain all decisions with the current E and the candidate own K evidence.'
        : systemPrompt) +
      (options.qualifyBeforeIdentity
        ? '\n' + CONTENT_ATTACHMENT_QUALIFIED_COLLECTIVE_POLICY
        : '') +
      (options.reconcileRecipientRefs
        ? '\n' + CONTENT_ATTACHMENT_RECIPIENT_REF_CHECK_POLICY
        : '') +
      (options.crossChapterAreas
        ? '\n' + CONTENT_ATTACHMENT_AREA_SCOPE_POLICY
        : '') +
      (options.preserveAreaWork
        ? '\n' + CONTENT_ATTACHMENT_AREA_WORK_POLICY
        : '') +
      (options.preserveAreaResults
        ? '\n' + CONTENT_ATTACHMENT_AREA_RESULTS_POLICY
        : '') +
      (options.boundAreaResultRecipients
        ? '\n' + CONTENT_ATTACHMENT_AREA_RECIPIENT_BOUNDARY_POLICY
        : '') +
      (options.reviewTableWork
        ? '\n' + CONTENT_ATTACHMENT_FIELDWORK_CONTINUITY_POLICY
        : '') +
      (options.traceAreaRecording
        ? '\n' + CONTENT_ATTACHMENT_AREA_RECORD_LINK_POLICY
        : '') +
      (options.boundAreaRecording
        ? '\n' + CONTENT_ATTACHMENT_AREA_RECORD_BOUNDARY_POLICY
        : '') +
      (options.checkClauseGrounds
        ? '\n' + CONTENT_ATTACHMENT_CLAUSE_GROUNDS_POLICY
        : '') +
      (options.gateQualifierStage
        ? '\n' + CONTENT_ATTACHMENT_QUALIFIER_STAGE_GATE_POLICY
        : '') +
      (options.preserveTentativeMembership
        ? '\n' + CONTENT_ATTACHMENT_TENTATIVE_MEMBERSHIP_POLICY
        : '') +
      (wordEvidence ? '\n' + CONTENT_ATTACHMENT_WORD_EVIDENCE_POLICY : '') +
      (options.segmentReview
        ? '\n' + CONTENT_ATTACHMENT_SEGMENT_REVIEW_POLICY
        : ''),
    userPrompt: JSON.stringify(evidence),
  };
}
