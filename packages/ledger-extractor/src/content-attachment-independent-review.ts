import type { ExtendedTokenUsage, LLMCallAttempt } from '@heripo/shared';

import type { CandidateEvidence } from './candidate-discovery';
import type { createContentAttachmentGroundedInput } from './content-attachment-grounding';
import type { ContentAttachmentRequiredResponse } from './content-attachment-response';

import { z } from 'zod';

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
  CONTENT_ATTACHMENT_RECIPIENT_REF_CHECK_POLICY,
  createContentAttachmentBodyReviewCoverage,
} from './content-attachment-body-review';
import { createContentAttachmentInventoryReviewRequest } from './content-attachment-inventory-review';

type Input = ReturnType<typeof createContentAttachmentGroundedInput>;
const attachment = z
  .enum(['included', 'excluded', 'unresolved'])
  .meta({ id: 'IndependentAttachment' });
const relationshipSubject = z
  .enum(['alternative', 'not_alternative'])
  .meta({ id: 'IndependentSubject' });
export interface ContentAttachmentIndependentMember {
  attachment: z.infer<typeof attachment>;
  relationshipSubject: z.infer<typeof relationshipSubject>;
  contextRef: string;
  candidateEvidenceRefs: string[];
  reason: string;
}
export interface ContentAttachmentIndependentReviewResponse {
  reviews: Record<string, Record<string, ContentAttachmentIndependentMember>>;
}
export interface ContentAttachmentIndependentReviewAudit {
  systemPrompt: string;
  userPrompt: string;
  rawResponse: ContentAttachmentIndependentReviewResponse;
  usage: ExtendedTokenUsage;
  callAttempts: LLMCallAttempt[];
}
export interface ContentAttachmentReviewFinding {
  excerptRef: string;
  inventoryRef: string;
  candidateRef: string;
  original: { assigned: boolean; unresolved: boolean };
  review: ContentAttachmentIndependentMember;
  contextEvidence: CandidateEvidence[];
  candidateEvidence: CandidateEvidence[];
  changedFields: Array<'attachment' | 'unresolved'>;
  reviewBasis?: 'inventory' | 'body_context';
}

/** Require original pool coverage while withholding earlier decisions from the independent judge. */
export function createContentAttachmentIndependentReviewRequest(
  input: Input,
  selection: ContentAttachmentRequiredResponse,
  options: {
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
  const context = z
    .enum(input.codeMap.excerpts.map((e) => e.ref) as [string, ...string[]])
    .meta({ id: 'IndependentContext' });
  const refs = [...new Set(required.flatMap((r) => r.candidateRefs))];
  const members = new Map(
    refs.map((ref, index) => [
      ref,
      z
        .strictObject({
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
        })
        .meta({ id: `IndependentMember${index + 1}` }),
    ]),
  );
  const schema: z.ZodType<ContentAttachmentIndependentReviewResponse> =
    z.strictObject({
      reviews: z.strictObject(
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
      ),
    });
  const systemPrompt =
    'Independently judge every required original excerpt/inventory member from the supplied original evidence. Earlier model selections are intentionally withheld. No inclusion or exclusion is predetermined by an earlier decision or by the schema. Return every review key and every candidate member key. The registration pool is a review baseline, not an automatically eligible set. For EACH member decide attachment as included, excluded or unresolved, then independently decide relationshipSubject as alternative or not_alternative. Included means the unchanged E directly describes this source-established member, including supported collective evidence; unresolved attachment means genuinely ambiguous recipient identity. Alternative means a genuinely unresolved subject of a relationship clause, not uncertain classification or uncertain existence of the relationship. Included attachment and alternative relationship subject may coexist on the SAME candidate. A relationship participant with resolved identity requires no subject alternatives.\nFirst establish the bounded original investigation set through the body, original rows and candidate evidence, then apply the CURRENT clause period, investigation, location and type qualifiers. Preserve every directly described verified member of a collective even without repeated numbers, including original tentative classifications. Candidate row context establishes identity and membership; it does not automatically describe the row owner or propagate an excerpt to all trenches, ancestors or same-type records. A directly described area is an additional recipient and never replaces a supported feature set. Collective evidence does not prove physical identity or every member participation in a later relationship. Evaluate all substantive clauses of the indivisible E: later uncertainty about one relationship subject does not erase an earlier collective description. Keep genuine role alternatives separately from collective recipients, without adding unsupported comparisons or previous-investigation objects. The lack of an individual identifier is not itself a reason to exclude a verified member of a collective.\nGive contextRef equal to the current E and one or more of the SAME candidate provided K evidence IDs for EVERY disposition, plus a concise Korean explanation grounded in that source context. Apply these grounds to qualifier-excluded candidates too; do not justify exclusion from an earlier model shortlist or fabricate absent evidence. If original membership or identity cannot actually be established, state that uncertainty rather than guessing. E and K select immutable original text and exact locations: never reproduce, normalize or invent source quotations, merge records or alter source boundaries. Code preserves both original responses and computes disagreement separately; your judgment is not required to agree with another response.';
  return {
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
        : ''),
    userPrompt: JSON.stringify(evidence),
  };
}

/** Resolve exact evidence and retain differences without replacing either model response. */
export function inspectContentAttachmentIndependentReview(
  input: Input,
  selection: ContentAttachmentRequiredResponse,
  audit?: ContentAttachmentIndependentReviewAudit,
  options: {
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
  } = {},
): {
  issues: string[];
  findings: ContentAttachmentReviewFinding[];
  disagreements: ContentAttachmentReviewFinding[];
} {
  const request = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    options,
  );
  if (!audit && !request.required.length)
    return { issues: [], findings: [], disagreements: [] };
  const parsed = request.schema.safeParse(audit?.rawResponse);
  if (
    !parsed.success ||
    audit!.systemPrompt !== request.systemPrompt ||
    audit!.userPrompt !== request.userPrompt
  )
    return {
      issues: [
        'Invalid or missing independent inventory review response or request',
      ],
      findings: [],
      disagreements: [],
    };
  const issues: string[] = [],
    findings: ContentAttachmentReviewFinding[] = [];
  const originalTargets = Object.fromEntries(
    Object.entries(selection.decisions).map(([ref, decision]) => [
      ref,
      {
        assigned: decision.status === 'assigned' ? decision.candidateRefs : [],
        unresolved:
          decision.status === 'unresolved'
            ? decision.candidateRefs
            : decision.status === 'assigned'
              ? (decision.unresolved?.candidateRefs ?? [])
              : [],
      },
    ]),
  );
  for (const r of request.required) {
    const { assigned, unresolved } = originalTargets[r.excerptRef];
    for (const ref of r.candidateRefs) {
      const review = parsed.data.reviews[r.key][ref];
      if (
        review.contextRef !== r.excerptRef ||
        new Set(review.candidateEvidenceRefs).size !==
          review.candidateEvidenceRefs.length
      ) {
        issues.push(`Invalid independent review provenance: ${r.key}:${ref}`);
        continue;
      }
      const original = {
        assigned: assigned.includes(ref),
        unresolved: unresolved.includes(ref),
      };
      const changedFields: ContentAttachmentReviewFinding['changedFields'] = [];
      if (original.assigned !== (review.attachment === 'included'))
        changedFields.push('attachment');
      if (
        original.unresolved !==
        (review.attachment === 'unresolved' ||
          review.relationshipSubject === 'alternative')
      )
        changedFields.push('unresolved');
      findings.push({
        excerptRef: r.excerptRef,
        inventoryRef: r.inventoryRef,
        candidateRef: ref,
        original,
        review,
        contextEvidence: input.codeMap.excerpts.find(
          (e) => e.ref === r.excerptRef,
        )!.evidence,
        candidateEvidence: review.candidateEvidenceRefs.map(
          (k) => input.citations.find((c) => c.ref === k)!.evidence,
        ),
        changedFields,
        ...(options.includeBodyContext
          ? {
              reviewBasis: r.inventoryRef.startsWith('B')
                ? ('body_context' as const)
                : ('inventory' as const),
            }
          : {}),
      });
    }
  }
  return {
    issues,
    findings,
    disagreements: findings.filter((f) => f.changedFields.length),
  };
}
