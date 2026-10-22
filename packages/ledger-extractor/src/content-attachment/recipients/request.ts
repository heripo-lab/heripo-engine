import type { RecipientVersion } from './prompt';
import type { ContentAttachmentSegmentationAudit } from './segmentation';
import type {
  CandidateBinding,
  CandidateRow,
  ContentAttachmentAreaRecipientDecision,
  ContentAttachmentAreaRecipientResponse,
  ContentAttachmentRecipientDecision,
  ContentAttachmentRecipientResponse,
  Input,
} from './types';

import { z } from 'zod';

import { createContentAttachmentAreaAssessmentsSchema } from './area-assessments';
import { createContentAttachmentCollectiveTraceSchema } from './collective-trace';
import { createContentAttachmentInventoryReviewsSchema } from './inventory-reviews';
import {
  CONTENT_ATTACHMENT_RECIPIENT_VERSION,
  contentAttachmentRecipientSystemPrompt,
  isSingleAreaRecipientVersion,
} from './prompt';
import { inspectContentAttachmentSegmentation } from './segmentation';
import {
  CONTENT_ATTACHMENT_WORD_RANGE_PATTERN,
  contentAttachmentWordRows,
} from './word-evidence';
import { createContentAttachmentWorkGroups } from './work-group-reviews';
import { createContentAttachmentWorkScopeSchema } from './work-scope';

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
    version !== 'segment-recipients.v15' &&
    version !== 'segment-recipients.v16' &&
    version !== 'segment-recipients.v17' &&
    version !== 'segment-recipients.v18' &&
    version !== 'segment-recipients.v19' &&
    version !== 'segment-recipients.v20' &&
    version !== 'segment-recipients.v21' &&
    version !== 'segment-recipients.v22' &&
    version !== 'segment-recipients.v23' &&
    version !== 'segment-recipients.v24' &&
    version !== 'segment-recipients.v25' &&
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
    version === 'segment-recipients.v15' ||
    version === 'segment-recipients.v16' ||
    version === 'segment-recipients.v17' ||
    version === 'segment-recipients.v18' ||
    version === 'segment-recipients.v19' ||
    version === 'segment-recipients.v20' ||
    version === 'segment-recipients.v21' ||
    version === 'segment-recipients.v22' ||
    version === 'segment-recipients.v23' ||
    version === 'segment-recipients.v24' ||
    version === 'segment-recipients.v25' ||
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
  const singleAreaDecision = isSingleAreaRecipientVersion(version);
  const nonAreaRefs = candidateRefs.filter((id) => !areaRefs.includes(id));
  const nonAreaAttachment = z.array(
    z
      .strictObject({
        candidateRef: z.enum(
          (nonAreaRefs.length ? nonAreaRefs : candidateRefs) as [
            string,
            ...string[],
          ],
        ),
        ...support,
      })
      .meta({ id: 'NonAreaRecipientAttachment' }),
  );
  const decision = z
    .strictObject({
      ...(singleAreaDecision
        ? {
            nonAreaAttachments: nonAreaRefs.length
              ? nonAreaAttachment
              : nonAreaAttachment.max(0),
          }
        : {
            attachments: z.array(
              z
                .strictObject({ candidateRef: ref, ...support })
                .meta({ id: 'RecipientAttachment' }),
            ),
          }),
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
      version === 'segment-recipients.v15' ||
      version === 'segment-recipients.v16' ||
      version === 'segment-recipients.v17' ||
      version === 'segment-recipients.v18' ||
      version === 'segment-recipients.v19' ||
      version === 'segment-recipients.v20' ||
      version === 'segment-recipients.v21' ||
      version === 'segment-recipients.v22' ||
      version === 'segment-recipients.v23' ||
      version === 'segment-recipients.v24' ||
      version === 'segment-recipients.v25' ||
      version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
        ? {
            workScopeAssessment: createContentAttachmentWorkScopeSchema(
              candidateRefs,
              workGroups?.map((g) => g.ref),
              version === 'segment-recipients.v14',
              version === 'segment-recipients.v17' ||
                version === 'segment-recipients.v18' ||
                version === 'segment-recipients.v19' ||
                version === 'segment-recipients.v20' ||
                version === 'segment-recipients.v21' ||
                version === 'segment-recipients.v22' ||
                version === 'segment-recipients.v23' ||
                version === 'segment-recipients.v24' ||
                version === 'segment-recipients.v25' ||
                version === CONTENT_ATTACHMENT_RECIPIENT_VERSION,
              version === 'segment-recipients.v20' ||
                version === 'segment-recipients.v21' ||
                version === 'segment-recipients.v22' ||
                version === 'segment-recipients.v23' ||
                version === 'segment-recipients.v24' ||
                version === 'segment-recipients.v25' ||
                version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
                ? ref
                : undefined,
            ),
          }
        : {}),
      ...(version === 'segment-recipients.v9' ||
      version === 'segment-recipients.v10' ||
      version === 'segment-recipients.v11' ||
      version === 'segment-recipients.v12' ||
      version === 'segment-recipients.v13' ||
      version === 'segment-recipients.v14' ||
      version === 'segment-recipients.v15' ||
      version === 'segment-recipients.v16' ||
      version === 'segment-recipients.v17' ||
      version === 'segment-recipients.v18' ||
      version === 'segment-recipients.v19' ||
      version === 'segment-recipients.v20' ||
      version === 'segment-recipients.v21' ||
      version === 'segment-recipients.v22' ||
      version === 'segment-recipients.v23' ||
      version === 'segment-recipients.v24' ||
      version === 'segment-recipients.v25' ||
      version === CONTENT_ATTACHMENT_RECIPIENT_VERSION
        ? {
            areaAssessments: createContentAttachmentAreaAssessmentsSchema(
              areaRefs,
              singleAreaDecision,
            ),
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
      version === 'segment-recipients.v15' ||
      version === 'segment-recipients.v16' ||
      version === 'segment-recipients.v17' ||
      version === 'segment-recipients.v18' ||
      version === 'segment-recipients.v19' ||
      version === 'segment-recipients.v20' ||
      version === 'segment-recipients.v21' ||
      version === 'segment-recipients.v22' ||
      version === 'segment-recipients.v23' ||
      version === 'segment-recipients.v24' ||
      version === 'segment-recipients.v25' ||
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
    }) as z.ZodType<
    ContentAttachmentRecipientDecision | ContentAttachmentAreaRecipientDecision
  >;
  const schema = z.strictObject({
    decisions: z.strictObject(
      Object.fromEntries(inspected.segments.map((s) => [s.ref, decision])),
    ),
  }) as z.ZodType<
    ContentAttachmentRecipientResponse | ContentAttachmentAreaRecipientResponse
  >;
  const request = {
    version,
    ...(workGroups ? { workGroups } : {}),
    segmentSnapshot: inspected.segments,
    candidateEvidence,
    systemPrompt: contentAttachmentRecipientSystemPrompt(version),
    userPrompt: JSON.stringify(payload),
    schema,
  };
  return request;
}
