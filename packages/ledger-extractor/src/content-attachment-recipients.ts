import type { ExtendedTokenUsage, LLMCallAttempt } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { CandidateEvidence } from './candidate-discovery';
import type { ContentAttachmentAreaAssessment } from './content-attachment-area-assessments';
import type { ContentAttachmentCollectiveTrace } from './content-attachment-collective-trace';
import type { createContentAttachmentGroundedInput } from './content-attachment-grounding';
import type { ContentAttachmentInventoryContext } from './content-attachment-inventory-reviews';
import type {
  ContentAttachmentIdentifiedSegment,
  ContentAttachmentSegmentationAudit,
} from './content-attachment-segmentation';
import type { ContentAttachmentWordRangeEvidence } from './content-attachment-word-evidence';
import type { ContentAttachmentWorkScopeAssessment } from './content-attachment-work-scope';

import { LLMCaller, createAuditedModel } from '@heripo/shared';
import { z } from 'zod';

import {
  CONTENT_ATTACHMENT_AREA_ASSESSMENT_POLICY,
  CONTENT_ATTACHMENT_AREA_FINDING_RESULTS_POLICY,
  CONTENT_ATTACHMENT_INVENTORY_MEMBER_AREA_POLICY,
  createContentAttachmentAreaAssessmentsSchema,
  inspectContentAttachmentAreaAssessments,
} from './content-attachment-area-assessments';
import {
  CONTENT_ATTACHMENT_COLLECTIVE_TRACE_POLICY,
  CONTENT_ATTACHMENT_CURRENT_PERIOD_MEMBER_POLICY,
  createContentAttachmentCollectiveTraceSchema,
  inspectContentAttachmentCollectiveTrace,
} from './content-attachment-collective-trace';
import {
  CONTENT_ATTACHMENT_COLLECTIVE_SOURCE_SHARING_POLICY,
  CONTENT_ATTACHMENT_CURRENT_TYPE_BOUNDARY_POLICY,
  CONTENT_ATTACHMENT_INVENTORY_REVIEW_POLICY,
  CONTENT_ATTACHMENT_MAPPED_INVENTORY_REVIEW_POLICY,
  CONTENT_ATTACHMENT_WORK_SCOPE_POLICY,
  createContentAttachmentInventoryReviewsSchema,
  resolveContentAttachmentInventoryContexts,
} from './content-attachment-inventory-reviews';
import { inspectContentAttachmentSegmentation } from './content-attachment-segmentation';
import {
  CONTENT_ATTACHMENT_WORD_RANGE_PATTERN,
  contentAttachmentWordRows,
  resolveContentAttachmentWordRange,
} from './content-attachment-word-evidence';
import {
  createContentAttachmentWorkGroups,
  inspectContentAttachmentWorkGroupReviews,
} from './content-attachment-work-group-reviews';
import {
  CONTENT_ATTACHMENT_WORK_SCOPE_ASSESSMENT_POLICY,
  CONTENT_ATTACHMENT_WORK_SCOPE_EVIDENCE_BOUNDARY_POLICY,
  createContentAttachmentWorkScopeSchema,
  inspectContentAttachmentWorkScope,
} from './content-attachment-work-scope';

type Input = ReturnType<typeof createContentAttachmentGroundedInput>;
type CandidateRow = [
  string,
  string,
  string,
  string | null,
  string | null,
  Array<[string, string]>,
];
export const CONTENT_ATTACHMENT_RECIPIENT_VERSION =
  'segment-recipients.v15' as const;
type RecipientVersion =
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
  | typeof CONTENT_ATTACHMENT_RECIPIENT_VERSION;
export interface ContentAttachmentRecipientSupport {
  currentWordRanges: string[];
  contextWordRanges: string[];
  candidateEvidenceRefs: string[];
  originRowRefs: string[];
}
export interface ContentAttachmentRecipientAttachment extends ContentAttachmentRecipientSupport {
  candidateRef: string;
}
export interface ContentAttachmentRecipientAlternative extends ContentAttachmentRecipientSupport {
  candidateRefs: string[];
}
export interface ContentAttachmentRecipientDecision extends Partial<ContentAttachmentCollectiveTrace> {
  areaAssessments?: Record<string, ContentAttachmentAreaAssessment>;
  workScopeAssessment?: ContentAttachmentWorkScopeAssessment;
  attachments: ContentAttachmentRecipientAttachment[];
  recipientIdentityAlternatives: ContentAttachmentRecipientAlternative[];
  relationshipSubjectAlternatives: Array<
    ContentAttachmentRecipientAlternative & { role: 'subject' }
  >;
  reason: string;
}
export interface ContentAttachmentRecipientResponse {
  decisions: Record<string, ContentAttachmentRecipientDecision>;
}
interface CandidateBinding {
  ref: string;
  candidateRef: string;
  evidence: CandidateEvidence;
}
export interface ContentAttachmentRecipientAudit {
  version: RecipientVersion;
  segmentSnapshot: ContentAttachmentIdentifiedSegment[];
  candidateEvidence: CandidateBinding[];
  systemPrompt: string;
  userPrompt: string;
  rawResponse: ContentAttachmentRecipientResponse;
  usage: ExtendedTokenUsage;
  callAttempts: LLMCallAttempt[];
}
export interface ContentAttachmentResolvedRecipientSupport {
  candidateRefs: string[];
  currentEvidence: ContentAttachmentWordRangeEvidence[];
  contextEvidence: ContentAttachmentWordRangeEvidence[];
  candidateEvidence: CandidateBinding[];
  originRowRefs: string[];
}
export interface ContentAttachmentRecipientFinding {
  areaAssessments?: Record<string, ContentAttachmentAreaAssessment>;
  workScopeAssessment?: ContentAttachmentWorkScopeAssessment;
  collectiveTrace?: ContentAttachmentCollectiveTrace;
  inventoryContexts?: Record<string, ContentAttachmentInventoryContext>;
  segmentRef: string;
  excerptRef: string;
  attachments: ContentAttachmentResolvedRecipientSupport[];
  recipientIdentityAlternatives: ContentAttachmentResolvedRecipientSupport[];
  relationshipSubjectAlternatives: ContentAttachmentResolvedRecipientSupport[];
}

const V1_SYSTEM_PROMPT =
  'Judge recipients for the supplied, already inspected original source segments. Do not segment again, rewrite source text or infer expected answers. Inspect each segment in its unchanged whole E, original body/table boundaries and neighboring source context. Return every required segment key, with attachments, recipientIdentityAlternatives and relationshipSubjectAlternatives independently. Empty lists are meaningful; do not force attachment. Use compact IDs only for evidence, never reproduce or normalize quotations. Give a concise reason for the segment disposition, including the source-based boundary of any relevant exclusion. Consider the entire supplied registry; unselected candidates are not confirmed recipients.\nAn attachment means this segment independently describes the candidate. Identify candidates from their own names, numbers, K grounds, original rows, chapter and investigation scope. Origin rows establish membership, not automatic propagation to containing trenches or areas. Preserve a source-established collective description on its identified members even without repeated numbers. Apply current period/type/scope qualifiers before broader antecedent membership. A tentative classification is not by itself evidence against membership or a relationship-subject alternative. Local row counts do not establish a global count or unique relation subject. Do not enlarge a collective to unrelated same-type candidates. General type summaries alone cannot identify individual artifacts.\nPreserve an identified investigation area own boundary, layout, recording and finding results when supported by its definition and original body continuity, separately from contained-unit work. Keep whole project areas distinct from partial survey areas. Same-cell or body-to-table continuation may supply a common action scope; local excavation/backfill does not automatically describe the area. Do not propagate the action object of a later local task backwards into preceding common work. Retain substantive object descriptions even when introduced by a meeting; meeting-only events, generic headers and pure table navigation need no recipients. Respect source-bound nonregistration decisions.\nKeep collective attachment independent of individual relationship-subject identity. A collective clause can have confirmed recipients while a separate relationship clause with an unidentified individual subject has NO confirmed attachment and only alternative subjects. Do not turn collective membership into confirmation of that individual relationship. Merely being a possible relationship subject does not justify a confirmed attachment for that relationship segment. Recipient-identity alternatives mean uncertainty about who receives this description, not uncertainty about which already identified collective member participates in an individual relationship. A road relation must not gain pit/area subject alternatives. Do not identify a relationship counterpart across investigation stages without original linking evidence. Use the original qualifiers and retain genuine uncertainty; never choose a candidate just because it is registered.\nFor every attachment or alternative, select nonempty currentWordRanges contained in that segment. Other current-E segments and E/X sources may supply contextWordRanges but cannot alone justify the current action. Supply each selected candidate own candidateEvidenceRefs; a group needs grounds for every member. originRowRefs may select supporting original O rows bound to the candidates; use an empty list if no such row is needed. Relation alternatives use role subject. Attachments and recipient-identity alternatives cannot assert both certainty and uncertainty for the same candidate in the same segment. Do not copy earlier answers or invent missing IDs. Code resolves provenance and separately previews whole-E preservation without changing your response or applying it to the ledger.';

/** Compile all frozen candidate grounds and inspected segments without earlier recipient answers. */
export function createContentAttachmentRecipientRequest(
  input: Input,
  segmentation: ContentAttachmentSegmentationAudit,
  version: RecipientVersion = CONTENT_ATTACHMENT_RECIPIENT_VERSION,
) {
  if (
    version !== 'segment-recipients.v1' &&
    version !== 'segment-recipients.v2' &&
    version !== 'segment-recipients.v3' &&
    version !== 'segment-recipients.v4' &&
    version !== 'segment-recipients.v5' &&
    version !== 'segment-recipients.v6' &&
    version !== 'segment-recipients.v7' &&
    version !== 'segment-recipients.v8' &&
    version !== 'segment-recipients.v9' &&
    version !== 'segment-recipients.v10' &&
    version !== 'segment-recipients.v11' &&
    version !== 'segment-recipients.v12' &&
    version !== 'segment-recipients.v13' &&
    version !== 'segment-recipients.v14' &&
    version !== CONTENT_ATTACHMENT_RECIPIENT_VERSION
  )
    throw new Error('Unsupported recipient version');
  const inspected = inspectContentAttachmentSegmentation(input, segmentation);
  if (inspected.issues.length || !inspected.segments.length)
    throw new Error('Expected valid nonempty inspected segmentation');
  const { current } = input.payload;
  const registry = {
    columns: input.payload.columns,
    contexts: input.payload.contexts,
    candidates: input.payload.candidates,
    uncertainties: input.payload.uncertainties,
    candidateTableRowColumns: input.payload.candidateTableRowColumns,
    candidateTableRows: input.payload.candidateTableRows,
    candidateTableAnchorColumns: input.payload.candidateTableAnchorColumns,
    candidateTableAnchors: input.payload.candidateTableAnchors,
    supportingTables: input.payload.supportingTables,
    supportingRowColumns: input.payload.supportingRowColumns,
    supportingRows: input.payload.supportingRows,
    supportingAnchorColumns: input.payload.supportingAnchorColumns,
    supportingAnchors: input.payload.supportingAnchors,
    originQuantityScope: input.payload.originQuantityScope,
    originTables: input.payload.originTables,
    originRowColumns: input.payload.originRowColumns,
    originCellColumns: input.payload.originCellColumns,
    originRows: input.payload.originRows,
    originAnchorColumns: input.payload.originAnchorColumns,
    originAnchors: input.payload.originAnchors,
    candidateQuoteColumns: input.payload.candidateQuoteColumns,
    inventoryMembers: input.payload.inventoryMembers,
  };
  const candidateRows = registry.candidates as CandidateRow[];
  const candidateRefs = [...new Set(candidateRows.map((c) => c[0]))];
  if (!candidateRefs.length) throw new Error('Expected candidate registry');
  const areaRefs = [
    ...new Set(candidateRows.filter((r) => r[1] === 'area').map((r) => r[0])),
  ];
  const candidateEvidence: CandidateBinding[] = [];
  for (const [index, row] of candidateRows.entries()) {
    const binding = input.codeMap.candidateRows[index];
    if (
      !binding ||
      binding.ref !== row[0] ||
      binding.evidence.length !== row[5].length
    )
      throw new Error('Candidate grounds differ from original binding');
    for (const [i, quote] of row[5].entries()) {
      const evidence = binding.evidence[i];
      if (
        evidence.quote !== quote[1] ||
        candidateEvidence.some((b) => b.ref === quote[0])
      )
        throw new Error('Candidate grounds differ from original binding');
      candidateEvidence.push({ ref: quote[0], candidateRef: row[0], evidence });
    }
  }
  const sourcePayload = JSON.parse(segmentation.userPrompt);
  const workGroups =
    version === 'segment-recipients.v14' ||
    version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
      ? createContentAttachmentWorkGroups(input)
      : undefined;
  const payload = {
    ...(workGroups
      ? {
          workGroupColumns: ['ref', 'inventoryRef', 'recordKind'],
          workGroups: workGroups.map((g) => [
            g.ref,
            g.inventoryRef,
            g.recordKind,
          ]),
        }
      : {}),
    registry,
    current: sourcePayload.current.map((e: { ref: string }) => ({
      ...e,
      segments: inspected.segments
        .filter((s) => s.excerptRef === e.ref)
        .map((s) => ({
          ref: s.ref,
          wordRanges: s.evidence.map((r) => r.range),
        })),
    })),
    sourceContext: {
      bodyBlocks: sourcePayload.bodyBlocks,
      tables: sourcePayload.tables,
      tableCellColumns: current.tableCellColumns,
      registrationDecisions: current.registrationDecisions,
      sources: segmentation.wordEvidence.sources
        .filter((s) => !segmentation.excerptRefs.includes(s.ref))
        .map((s) => ({
          ref: s.ref,
          text: s.text,
          words: contentAttachmentWordRows(s),
        })),
    },
    wordColumns: ['ref', 'literalSourceUnit'],
  };
  const ref = z
    .enum(candidateRefs as [string, ...string[]])
    .meta({ id: 'RecipientCandidateRef' });
  const ranges = z
    .array(z.string().regex(CONTENT_ATTACHMENT_WORD_RANGE_PATTERN))
    .meta({ id: 'RecipientRanges' });
  const support = {
    currentWordRanges: z
      .array(z.string().regex(CONTENT_ATTACHMENT_WORD_RANGE_PATTERN))
      .min(1)
      .meta({ id: 'RecipientCurrentRanges' }),
    contextWordRanges: ranges,
    candidateEvidenceRefs: z.array(z.string()).min(1),
    originRowRefs: z.array(z.string()),
  };
  const alternative = z
    .strictObject({ candidateRefs: z.array(ref).min(1), ...support })
    .meta({ id: 'RecipientIdentityAlternative' });
  const decision = z
    .strictObject({
      attachments: z.array(
        z
          .strictObject({ candidateRef: ref, ...support })
          .meta({ id: 'RecipientAttachment' }),
      ),
      recipientIdentityAlternatives: z.array(alternative),
      relationshipSubjectAlternatives: z.array(
        z
          .strictObject({ ...alternative.shape, role: z.literal('subject') })
          .meta({ id: 'RecipientSubjectAlternative' }),
      ),
      reason: z.string().min(1),
      ...(version === 'segment-recipients.v8' ||
      version === 'segment-recipients.v9' ||
      version === 'segment-recipients.v10' ||
      version === 'segment-recipients.v11' ||
      version === 'segment-recipients.v12' ||
      version === 'segment-recipients.v13' ||
      version === 'segment-recipients.v14' ||
      version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
        ? {
            workScopeAssessment: createContentAttachmentWorkScopeSchema(
              candidateRefs,
              workGroups?.map((g) => g.ref),
              version === 'segment-recipients.v14',
            ),
          }
        : {}),
      ...(version === 'segment-recipients.v9' ||
      version === 'segment-recipients.v10' ||
      version === 'segment-recipients.v11' ||
      version === 'segment-recipients.v12' ||
      version === 'segment-recipients.v13' ||
      version === 'segment-recipients.v14' ||
      version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
        ? {
            areaAssessments:
              createContentAttachmentAreaAssessmentsSchema(areaRefs),
          }
        : {}),
      ...(version === 'segment-recipients.v1'
        ? {}
        : createContentAttachmentCollectiveTraceSchema(input)),
      ...(version === 'segment-recipients.v3' ||
      version === 'segment-recipients.v4' ||
      version === 'segment-recipients.v5' ||
      version === 'segment-recipients.v6' ||
      version === 'segment-recipients.v7' ||
      version === 'segment-recipients.v8' ||
      version === 'segment-recipients.v9' ||
      version === 'segment-recipients.v10' ||
      version === 'segment-recipients.v11' ||
      version === 'segment-recipients.v12' ||
      version === 'segment-recipients.v13' ||
      version === 'segment-recipients.v14' ||
      version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
        ? {
            inventoryReviews: createContentAttachmentInventoryReviewsSchema(
              input,
              version === 'segment-recipients.v3',
            ),
          }
        : {}),
    })
    .meta({
      id: 'RecipientDecision',
    }) as z.ZodType<ContentAttachmentRecipientDecision>;
  const schema: z.ZodType<ContentAttachmentRecipientResponse> = z.strictObject({
    decisions: z.strictObject(
      Object.fromEntries(inspected.segments.map((s) => [s.ref, decision])),
    ),
  });
  return {
    version,
    ...(workGroups ? { workGroups } : {}),
    segmentSnapshot: inspected.segments,
    candidateEvidence,
    systemPrompt:
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
                                                  CONTENT_ATTACHMENT_CURRENT_PERIOD_MEMBER_POLICY))))))))),
    userPrompt: JSON.stringify(payload),
    schema,
  };
}

/** Validate references and preview recipients while preserving the raw response and original E text. */
export function inspectContentAttachmentRecipients(
  input: Input,
  segmentation: ContentAttachmentSegmentationAudit,
  audit: ContentAttachmentRecipientAudit,
): { issues: string[]; findings: ContentAttachmentRecipientFinding[] } {
  let request: ReturnType<typeof createContentAttachmentRecipientRequest>;
  try {
    request = createContentAttachmentRecipientRequest(
      input,
      segmentation,
      audit.version === 'segment-recipients.v1' ||
        audit.version === 'segment-recipients.v2' ||
        audit.version === 'segment-recipients.v3' ||
        audit.version === 'segment-recipients.v4' ||
        audit.version === 'segment-recipients.v5' ||
        audit.version === 'segment-recipients.v6' ||
        audit.version === 'segment-recipients.v7' ||
        audit.version === 'segment-recipients.v8' ||
        audit.version === 'segment-recipients.v9' ||
        audit.version === 'segment-recipients.v10' ||
        audit.version === 'segment-recipients.v11' ||
        audit.version === 'segment-recipients.v12' ||
        audit.version === 'segment-recipients.v13' ||
        audit.version === 'segment-recipients.v14'
        ? audit.version
        : CONTENT_ATTACHMENT_RECIPIENT_VERSION,
    );
  } catch {
    return { issues: ['Invalid recipient source input'], findings: [] };
  }
  const parsed = request.schema.safeParse(audit.rawResponse);
  if (
    !parsed.success &&
    (audit.version === 'segment-recipients.v14' ||
      audit.version === CONTENT_ATTACHMENT_RECIPIENT_VERSION)
  )
    return {
      issues: parsed.error.issues.map(
        (issue) =>
          `Invalid recipient response: ${issue.path.join('.')}: ${issue.message}`,
      ),
      findings: [],
    };
  if (
    !parsed.success ||
    audit.version !== request.version ||
    audit.systemPrompt !== request.systemPrompt ||
    audit.userPrompt !== request.userPrompt ||
    JSON.stringify(audit.segmentSnapshot) !==
      JSON.stringify(request.segmentSnapshot) ||
    JSON.stringify(audit.candidateEvidence) !==
      JSON.stringify(request.candidateEvidence)
  )
    return {
      issues: ['Invalid recipient response, request or source snapshot'],
      findings: [],
    };
  const findings: ContentAttachmentRecipientFinding[] = [],
    issues: string[] = [];
  for (const segment of request.segmentSnapshot) {
    try {
      const decision = parsed.data.decisions[segment.ref];
      const attachmentRefs = decision.attachments.map((a) => a.candidateRef);
      if (
        new Set(attachmentRefs).size !== attachmentRefs.length ||
        decision.recipientIdentityAlternatives.some((a) =>
          a.candidateRefs.some((r) => attachmentRefs.includes(r)),
        )
      )
        throw new Error('Conflicting or duplicate recipients');
      const resolve = (
        support: ContentAttachmentRecipientSupport,
        refs: string[],
      ) => {
        if (
          new Set(refs).size !== refs.length ||
          new Set(support.candidateEvidenceRefs).size !==
            support.candidateEvidenceRefs.length ||
          new Set(support.currentWordRanges).size !==
            support.currentWordRanges.length ||
          new Set(support.contextWordRanges).size !==
            support.contextWordRanges.length ||
          new Set(support.originRowRefs).size !== support.originRowRefs.length
        )
          throw new Error('Duplicate support');
        const currentEvidence = support.currentWordRanges.map((r) => {
          const evidence = resolveContentAttachmentWordRange(
            segmentation.wordEvidence,
            r,
            segment.excerptRef,
          );
          const source = segmentation.wordEvidence.sources.find(
            (s) => s.ref === segment.excerptRef,
          )!;
          if (
            evidence.basis !== 'direct' ||
            source.words
              .filter(
                (w) =>
                  w.charStart >= evidence.charStart &&
                  w.charEnd <= evidence.charEnd,
              )
              .some(
                (w) =>
                  !segment.evidence.some(
                    (e) => w.charStart >= e.charStart && w.charEnd <= e.charEnd,
                  ),
              )
          )
            throw new Error('Evidence outside segment');
          return evidence;
        });
        const contextEvidence = support.contextWordRanges.map((r) =>
          resolveContentAttachmentWordRange(
            segmentation.wordEvidence,
            r,
            segment.excerptRef,
          ),
        );
        const grounds = support.candidateEvidenceRefs.map((r) => {
          const binding = request.candidateEvidence.find((b) => b.ref === r);
          if (!binding || !refs.includes(binding.candidateRef))
            throw new Error('Foreign candidate grounds');
          return binding;
        });
        if (refs.some((ref) => !grounds.some((g) => g.candidateRef === ref)))
          throw new Error('Missing candidate grounds');
        if (
          support.originRowRefs.some(
            (r) =>
              !input.payload.originRows.some((row) => row[0] === r) ||
              !input.payload.originAnchors.some(
                (a) => a[1] === r && refs.includes(a[0]),
              ),
          )
        )
          throw new Error('Foreign origin row');
        return {
          candidateRefs: refs,
          currentEvidence,
          contextEvidence,
          candidateEvidence: grounds,
          originRowRefs: support.originRowRefs,
        };
      };
      if (
        audit.version === 'segment-recipients.v9' ||
        audit.version === 'segment-recipients.v10' ||
        audit.version === 'segment-recipients.v11' ||
        audit.version === 'segment-recipients.v12' ||
        audit.version === 'segment-recipients.v13' ||
        audit.version === 'segment-recipients.v14' ||
        audit.version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
      ) {
        try {
          inspectContentAttachmentAreaAssessments(
            decision.areaAssessments!,
            decision,
            resolve,
          );
        } catch (error) {
          issues.push(
            `Invalid recipient area assessment: ${segment.ref}: ${(error as Error).message}`,
          );
          continue;
        }
      }
      if (
        audit.version === 'segment-recipients.v8' ||
        audit.version === 'segment-recipients.v9' ||
        audit.version === 'segment-recipients.v10' ||
        audit.version === 'segment-recipients.v11' ||
        audit.version === 'segment-recipients.v12' ||
        audit.version === 'segment-recipients.v13' ||
        audit.version === 'segment-recipients.v14' ||
        audit.version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
      ) {
        try {
          if (
            audit.version === 'segment-recipients.v14' ||
            audit.version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
          )
            inspectContentAttachmentWorkGroupReviews(
              request.workGroups!,
              decision.workScopeAssessment!,
              attachmentRefs,
            );
          inspectContentAttachmentWorkScope(
            decision.workScopeAssessment!,
            attachmentRefs,
            resolve,
          );
        } catch (error) {
          issues.push(
            `Invalid recipient work scope: ${segment.ref}: ${(error as Error).message}`,
          );
          continue;
        }
      }
      if (audit.version !== 'segment-recipients.v1')
        inspectContentAttachmentCollectiveTrace(
          input,
          segmentation,
          segment,
          decision as ContentAttachmentCollectiveTrace,
          request.candidateEvidence,
          decision,
        );
      findings.push({
        segmentRef: segment.ref,
        ...(audit.version === 'segment-recipients.v9' ||
        audit.version === 'segment-recipients.v10' ||
        audit.version === 'segment-recipients.v11' ||
        audit.version === 'segment-recipients.v12' ||
        audit.version === 'segment-recipients.v13' ||
        audit.version === 'segment-recipients.v14' ||
        audit.version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
          ? { areaAssessments: decision.areaAssessments }
          : {}),
        ...(audit.version === 'segment-recipients.v8' ||
        audit.version === 'segment-recipients.v9' ||
        audit.version === 'segment-recipients.v10' ||
        audit.version === 'segment-recipients.v11' ||
        audit.version === 'segment-recipients.v12' ||
        audit.version === 'segment-recipients.v13' ||
        audit.version === 'segment-recipients.v14' ||
        audit.version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
          ? { workScopeAssessment: decision.workScopeAssessment }
          : {}),
        ...(audit.version === 'segment-recipients.v4' ||
        audit.version === 'segment-recipients.v5' ||
        audit.version === 'segment-recipients.v6' ||
        audit.version === 'segment-recipients.v7' ||
        audit.version === 'segment-recipients.v8' ||
        audit.version === 'segment-recipients.v9' ||
        audit.version === 'segment-recipients.v10' ||
        audit.version === 'segment-recipients.v11' ||
        audit.version === 'segment-recipients.v12' ||
        audit.version === 'segment-recipients.v13' ||
        audit.version === 'segment-recipients.v14' ||
        audit.version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
          ? {
              inventoryContexts:
                resolveContentAttachmentInventoryContexts(input),
            }
          : {}),
        ...(audit.version !== 'segment-recipients.v1'
          ? {
              collectiveTrace: {
                ...(decision.inventoryReviews
                  ? { inventoryReviews: decision.inventoryReviews }
                  : {}),
                collectiveAssessment: decision.collectiveAssessment!,
                qualifierAssessment: decision.qualifierAssessment!,
                inventoryMembershipLinks: decision.inventoryMembershipLinks!,
              },
            }
          : {}),
        excerptRef: segment.excerptRef,
        attachments: decision.attachments.map((a) =>
          resolve(a, [a.candidateRef]),
        ),
        recipientIdentityAlternatives:
          decision.recipientIdentityAlternatives.map((a) =>
            resolve(a, a.candidateRefs),
          ),
        relationshipSubjectAlternatives:
          decision.relationshipSubjectAlternatives.map((a) =>
            resolve(a, a.candidateRefs),
          ),
      });
    } catch {
      issues.push(`Invalid recipient evidence or dispositions: ${segment.ref}`);
    }
  }
  return { issues, findings };
}

/** Call only the recipient stage; do not rerun segmentation, earlier selection or ledger assembly. */
export async function judgeContentAttachmentRecipients(
  input: Input,
  segmentation: ContentAttachmentSegmentationAudit,
  options: {
    model: LanguageModel;
    maxRetries: number;
    abortSignal?: AbortSignal;
    onAttempt?: (attempt: LLMCallAttempt) => void | Promise<void>;
  },
): Promise<ContentAttachmentRecipientAudit> {
  const request = createContentAttachmentRecipientRequest(input, segmentation);
  const model = createAuditedModel(options.model, options.onAttempt);
  const result = await LLMCaller.call({
    schema: request.schema,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    primaryModel: model.model,
    maxRetries: options.maxRetries,
    abortSignal: options.abortSignal,
    component: 'LedgerContentAttachment',
    phase: 'segment-recipients',
    metadata: {
      version: request.version,
      excerptRefs: segmentation.excerptRefs.join(','),
    },
  });
  return {
    version: request.version,
    segmentSnapshot: request.segmentSnapshot,
    candidateEvidence: request.candidateEvidence,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    rawResponse: result.output,
    usage: result.usage,
    callAttempts: model.attempts,
  };
}
