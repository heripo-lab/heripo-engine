import type * as Shared from '@heripo/shared';

import { LLMCaller } from '@heripo/shared';
import { Output } from 'ai';
import { expect, test, vi } from 'vitest';

import { inspectContentAttachmentRecipients } from './inspection';
import {
  CONTENT_ATTACHMENT_INVENTORY_SUPPORT_POLICY,
  CONTENT_ATTACHMENT_MAPPED_INVENTORY_REVIEW_POLICY,
} from './inventory-reviews';
import {
  expandProviderSchema,
  singleAreaFixture,
} from './recipients.test-fixture';
import { createContentAttachmentRecipientRequest } from './request';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

test('preserves v20 wording, input and judgments while sharing equivalent provider definitions', async () => {
  const previous = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v19',
  );
  const current = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v20',
  );
  const policy =
    "Identify the current operation's source-defined targets separately from the group's membership. Return established whole-group coverage only when the operation's targets are supported as covering the full identified group. Plural wording, matching counts, method definitions or inventory membership alone do not establish this connection; no particular word is required.\n\nUse the existing evidence IDs and reason to explain the operation-to-target connection or gap. Keep group-identification grounds in targetIdentification, positive coverage grounds in supportingWordRanges, and inspected but insufficient grounds in consideredWordRanges. If whole-group coverage is not established, retain group relevance and independently supported area or subset attachments.";
  const anchor =
    '\n\nThese work-assessment rules do not narrow source-established collective findings';
  expect(current.request.systemPrompt).toBe(
    previous.request.systemPrompt.replace(anchor, '\n\n' + policy + anchor),
  );
  const historicalRequest = createContentAttachmentRecipientRequest(
    current.input,
    current.segmentation,
    'segment-recipients.v20',
  );
  expect(historicalRequest.version).toBe('segment-recipients.v20');
  expect(historicalRequest.systemPrompt).toBe(current.request.systemPrompt);
  expect(current.request.userPrompt).toBe(previous.request.userPrompt);
  expect(current.request.segmentSnapshot).toEqual(
    previous.request.segmentSnapshot,
  );
  expect(current.request.candidateEvidence).toEqual(
    previous.request.candidateEvidence,
  );
  const shared = await Output.object({ schema: current.request.schema })
    .responseFormat;
  const original = await Output.object({ schema: previous.request.schema })
    .responseFormat;
  expect(expandProviderSchema(shared)).toEqual(expandProviderSchema(original));
  expect(JSON.stringify(shared)).toContain('#/definitions/WorkTargetGroup');
  expect(JSON.stringify(shared)).toContain('#/definitions/WorkGroupReview');
  expect(JSON.stringify(original)).not.toContain('WorkGroupReview');
  const before = JSON.stringify(current.audit.rawResponse);
  expect(
    inspectContentAttachmentRecipients(
      current.input,
      current.segmentation,
      current.audit,
    ),
  ).toEqual(
    inspectContentAttachmentRecipients(
      previous.input,
      previous.segmentation,
      previous.audit,
    ),
  );
  expect(JSON.stringify(current.audit.rawResponse)).toBe(before);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});

test('adds only the approved v21 returned-work-object check while preserving v20 input, schema and inspection', async () => {
  const previous = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v20',
  );
  const current = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v21',
  );
  const policy =
    'Before returning an operation segment, cross-check every recipient in nonAreaAttachments and every included areaAssessments entry against the work-scope objects actually returned. Each must appear in targetIdentification.candidateRefs of an assessment with operationCoverage.state = established, in workScopeAssessment.targetGroups or groupReviews.*.fullGroupAssessment.\n\nFor a source-supported independent work target outside the reviewed inventory groups, return its own targetGroups assessment with positive operation evidence in the existing fields. If that assessment is missing, include it; do not remove the supported recipient or invent support to satisfy this check.\n\nPreserve the existing full-group/subset judgments and uncertainty decisions. Identity or membership evidence alone does not establish operation coverage. This check does not require work objects for not_applicable segments.';
  const request = createContentAttachmentRecipientRequest(
    current.input,
    current.segmentation,
    'segment-recipients.v21',
  );
  expect(request.version).toBe('segment-recipients.v21');
  expect(current.request.systemPrompt).toBe(
    previous.request.systemPrompt + '\n\n' + policy,
  );
  expect(request.systemPrompt).toBe(current.request.systemPrompt);
  expect(current.request.userPrompt).toBe(previous.request.userPrompt);
  expect(current.request.segmentSnapshot).toEqual(
    previous.request.segmentSnapshot,
  );
  expect(current.request.candidateEvidence).toEqual(
    previous.request.candidateEvidence,
  );
  expect(current.request.workGroups).toEqual(previous.request.workGroups);
  expect(
    await Output.object({ schema: current.request.schema }).responseFormat,
  ).toEqual(
    await Output.object({ schema: previous.request.schema }).responseFormat,
  );
  const before = JSON.stringify(current.audit.rawResponse);
  expect(
    inspectContentAttachmentRecipients(
      current.input,
      current.segmentation,
      current.audit,
    ),
  ).toEqual(
    inspectContentAttachmentRecipients(
      previous.input,
      previous.segmentation,
      previous.audit,
    ),
  );
  expect(JSON.stringify(current.audit.rawResponse)).toBe(before);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});

test('clarifies optional inventory support in v22 while preserving the v21 input, provider schema and raw inspection', async () => {
  const previous = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v21',
  );
  const current = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v22',
  );
  const request = createContentAttachmentRecipientRequest(
    current.input,
    current.segmentation,
    'segment-recipients.v22',
  );
  expect(request.version).toBe('segment-recipients.v22');
  expect(request.systemPrompt).toBe(
    previous.request.systemPrompt.replace(
      CONTENT_ATTACHMENT_MAPPED_INVENTORY_REVIEW_POLICY,
      CONTENT_ATTACHMENT_MAPPED_INVENTORY_REVIEW_POLICY +
        '\n\n' +
        CONTENT_ATTACHMENT_INVENTORY_SUPPORT_POLICY,
    ),
  );
  expect(request.userPrompt).toBe(previous.request.userPrompt);
  expect(request.segmentSnapshot).toEqual(previous.request.segmentSnapshot);
  expect(request.candidateEvidence).toEqual(previous.request.candidateEvidence);
  expect(request.workGroups).toEqual(previous.request.workGroups);
  expect(
    await Output.object({ schema: request.schema }).responseFormat,
  ).toEqual(
    await Output.object({ schema: previous.request.schema }).responseFormat,
  );
  const before = JSON.stringify(current.audit.rawResponse);
  expect(
    inspectContentAttachmentRecipients(
      current.input,
      current.segmentation,
      current.audit,
    ),
  ).toEqual(
    inspectContentAttachmentRecipients(
      previous.input,
      previous.segmentation,
      previous.audit,
    ),
  );
  expect(JSON.stringify(current.audit.rawResponse)).toBe(before);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});

test('adds only the approved v23 area operation link while preserving v22 input, schema and raw inspection', async () => {
  const previous = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v22',
  );
  const current = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v23',
  );
  const request = createContentAttachmentRecipientRequest(
    current.input,
    current.segmentation,
    'segment-recipients.v23',
  );
  const policy =
    'Identify each area from its own K/context grounds, then separately determine whether the current operation applies to it. Read the whole segment with its original cell/body context.\n\nIn abbreviated or coordinated work entries, assess which named targets share the action; abbreviation alone does not make an area mention a heading. A linked table detailing other targets neither establishes nor cancels independently supported area work. Definition, containment and inventory membership alone do not establish operation coverage.\n\nUse the existing reason and evidence IDs to distinguish area identification from the operation link or source-based gap. Keep group coverage independent and preserve a separate established work object for an included independent area target.';
  expect(request.version).toBe('segment-recipients.v23');
  expect(request.systemPrompt).toBe(
    previous.request.systemPrompt + '\n\n' + policy,
  );
  expect(request.userPrompt).toBe(previous.request.userPrompt);
  expect(request.segmentSnapshot).toEqual(previous.request.segmentSnapshot);
  expect(request.candidateEvidence).toEqual(previous.request.candidateEvidence);
  expect(request.workGroups).toEqual(previous.request.workGroups);
  expect(
    await Output.object({ schema: request.schema }).responseFormat,
  ).toEqual(
    await Output.object({ schema: previous.request.schema }).responseFormat,
  );
  const before = JSON.stringify(current.audit.rawResponse);
  expect(
    inspectContentAttachmentRecipients(
      current.input,
      current.segmentation,
      current.audit,
    ),
  ).toEqual(
    inspectContentAttachmentRecipients(
      previous.input,
      previous.segmentation,
      previous.audit,
    ),
  );
  expect(JSON.stringify(current.audit.rawResponse)).toBe(before);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});

test('adds only the approved v24 inventory source and qualifier roles while preserving v23 input, schema and raw inspection', async () => {
  const previous = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v23',
  );
  const current = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v24',
  );
  const request = createContentAttachmentRecipientRequest(
    current.input,
    current.segmentation,
    'segment-recipients.v24',
  );
  const policy =
    'Separate target identification from the source link connecting an inventory to the set described by the CURRENT segment. Using a table only to identify already named targets does not establish that link. If no other source bridge is supported, reject the inventory connection while retaining valid identification grounds in the recipient and work-target fields. A bounded set established by body/context can remain collective with no accepted inventory and an empty inventoryMembershipLinks list. An explicitly supported inventory link remains admissible even when its descriptive predicate is stated in the body.\n\nSelect qualifier ranges by their semantic role. periodWordRanges records archaeological chronology of the described objects. Operational timing or target-selection conditions belong to scopeWordRanges when they constrain the current account; preserve the complete qualifying expression. Selection timing alone does not date either the objects or the operation. Keep type qualifiers in typeWordRanges and leave absent roles empty. These judgments do not replace independently supported recipient decisions or establish operation coverage by themselves.';
  expect(request.version).toBe('segment-recipients.v24');
  expect(request.systemPrompt).toBe(
    previous.request.systemPrompt + '\n\n' + policy,
  );
  expect(request.userPrompt).toBe(previous.request.userPrompt);
  expect(request.segmentSnapshot).toEqual(previous.request.segmentSnapshot);
  expect(request.candidateEvidence).toEqual(previous.request.candidateEvidence);
  expect(request.workGroups).toEqual(previous.request.workGroups);
  expect(
    await Output.object({ schema: request.schema }).responseFormat,
  ).toEqual(
    await Output.object({ schema: previous.request.schema }).responseFormat,
  );
  const before = JSON.stringify(current.audit.rawResponse);
  expect(
    inspectContentAttachmentRecipients(
      current.input,
      current.segmentation,
      current.audit,
    ),
  ).toEqual(
    inspectContentAttachmentRecipients(
      previous.input,
      previous.segmentation,
      previous.audit,
    ),
  );
  expect(JSON.stringify(current.audit.rawResponse)).toBe(before);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});

test('adds only the approved v25 body subset collective definition while preserving v24 input, schema and raw inspection', async () => {
  const previous = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v24',
  );
  const current = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v25',
  );
  const request = createContentAttachmentRecipientRequest(
    current.input,
    current.segmentation,
    'segment-recipients.v25',
  );
  const policy =
    'Judge collectiveAssessment for the source-defined set described by the CURRENT segment, including a proper subset and a work account. When current words and source continuity establish that set and describe its members together, return collective; no whole-inventory result or accepted inventory is required. Rejected inventory adoption or unestablished larger-group coverage does not negate that body-defined collective.\n\nKeep workScopeAssessment independent: establish operation coverage only for source-supported targets, leaving unsupported larger-group coverage not_established. A collective verdict alone neither establishes coverage nor adds recipients or resolves uncertainty. Preserve existing inventory, qualifier and independent-area judgments.';
  expect(request.version).toBe('segment-recipients.v25');
  expect(request.systemPrompt).toBe(
    previous.request.systemPrompt + '\n\n' + policy,
  );
  expect(request.userPrompt).toBe(previous.request.userPrompt);
  expect(request.segmentSnapshot).toEqual(previous.request.segmentSnapshot);
  expect(request.candidateEvidence).toEqual(previous.request.candidateEvidence);
  expect(request.workGroups).toEqual(previous.request.workGroups);
  expect(
    await Output.object({ schema: request.schema }).responseFormat,
  ).toEqual(
    await Output.object({ schema: previous.request.schema }).responseFormat,
  );
  const before = JSON.stringify(current.audit.rawResponse);
  expect(
    inspectContentAttachmentRecipients(
      current.input,
      current.segmentation,
      current.audit,
    ),
  ).toEqual(
    inspectContentAttachmentRecipients(
      previous.input,
      previous.segmentation,
      previous.audit,
    ),
  );
  expect(JSON.stringify(current.audit.rawResponse)).toBe(before);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});

test('adds only the approved v26 narrative/table/operation links while preserving v25 input, schema and raw inspection', async () => {
  const previous = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v25',
  );
  const current = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v26',
  );
  const request = createContentAttachmentRecipientRequest(
    current.input,
    current.segmentation,
    'segment-recipients.v26',
  );
  const policy =
    'When a recipient decision relies on a narrative-to-table reference or continuation across table fragments, distinguish three links: (1) the narrative identifies the relevant table; (2) the fragments continue the same table; and (3) the current operation applies to the identified candidate.\n\nIn the existing operationCoverage.reason, or areaAssessments reason when no target group is returned, state the outcome and source-grounded basis for each necessary link separately. Explain an established, rejected, or unresolved link without substituting another link for it. Use original word ranges in the existing evidence fields and structural references in reason; never place structural references in word-range or candidate-evidence fields.\n\nAssess continuation from the combined original context, captions, headers, boundaries and sequence. An unjudged continuation is not a rejection. Table continuity alone does not establish an operation target, and candidate definition alone does not establish operation coverage. Respect explicit table boundaries and current investigation or task-scope restrictions. Preserve independently supported attachments; an unresolved link does not automatically create recipient-identity alternatives. Do not add fields or rewrite source text.';
  expect(request.version).toBe('segment-recipients.v26');
  expect(request.systemPrompt).toBe(
    previous.request.systemPrompt + '\n\n' + policy,
  );
  expect(request.userPrompt).toBe(previous.request.userPrompt);
  expect(request.segmentSnapshot).toEqual(previous.request.segmentSnapshot);
  expect(request.candidateEvidence).toEqual(previous.request.candidateEvidence);
  expect(request.workGroups).toEqual(previous.request.workGroups);
  expect(
    await Output.object({ schema: request.schema }).responseFormat,
  ).toEqual(
    await Output.object({ schema: previous.request.schema }).responseFormat,
  );
  const before = JSON.stringify(current.audit.rawResponse);
  expect(
    inspectContentAttachmentRecipients(
      current.input,
      current.segmentation,
      current.audit,
    ),
  ).toEqual(
    inspectContentAttachmentRecipients(
      previous.input,
      previous.segmentation,
      previous.audit,
    ),
  );
  expect(JSON.stringify(current.audit.rawResponse)).toBe(before);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});
