import type * as Shared from '@heripo/shared';

import type { ContentAttachmentSelectionAudit } from './types';

import { LLMCaller, createAuditedModel } from '@heripo/shared';
import { Output } from 'ai';
import { expect, test, vi } from 'vitest';

import { assembleContentAttachment } from './assembly';
import { attachContentUnit } from './attach-unit';
import { createContentAttachmentGroundedInput } from './grounding';
import {
  fixture,
  frozenSelection,
  independentMember,
} from './grounding.test-fixture';
import { createContentAttachmentRequest } from './request';
import { flattenContentAttachmentResponse } from './response';
import { createContentAttachmentIndependentReviewRequest } from './review/independent-review-request';
import {
  createContentAttachmentInventoryReviewRequest,
  inspectContentAttachmentInventoryReview,
} from './review/inventory-review';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

test('requires each derived review key and member, including overlapping collective and role recipients, in the provider schema', async () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const request = createContentAttachmentInventoryReviewRequest(
    input,
    selection,
  );
  expect(request.required.map((r) => r.key)).toEqual(['E2:U1']);
  const raw = {
    reviews: {
      'E2:U1': {
        'opaque-nine': { state: 'included' },
        'opaque-two': { state: 'included' },
      },
    },
  };
  const before = structuredClone({ input, selection, raw });
  expect(request.schema.safeParse(raw).success).toBe(true);
  expect(request.schema.safeParse({ reviews: {} }).success).toBe(false);
  expect(
    request.schema.safeParse({
      reviews: { 'E2:U1': { 'opaque-nine': { state: 'included' } } },
    }).success,
  ).toBe(false);
  expect(
    request.schema.safeParse({
      reviews: {
        'E2:U1': { ...raw.reviews['E2:U1'], extra: { state: 'included' } },
      },
    }).success,
  ).toBe(false);
  const json = JSON.parse(
    JSON.stringify(
      await Output.object({ schema: request.schema }).responseFormat,
    ),
  ).schema;
  expect(json.properties.reviews.required).toEqual(['E2:U1']);
  expect(json.properties.reviews.properties['E2:U1'].required).toEqual([
    'opaque-nine',
    'opaque-two',
  ]);
  const audit = {
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    rawResponse: raw,
    usage: {} as never,
    callAttempts: [],
  } as const;
  expect(
    inspectContentAttachmentInventoryReview(input, selection, {
      ...audit,
      rawResponse: request.schema.parse(raw),
      callAttempts: [],
    }).issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentInventoryReview(input, selection).issues,
  ).toHaveLength(1);
  expect(
    inspectContentAttachmentInventoryReview(input, selection, {
      ...audit,
      rawResponse: request.schema.parse(raw),
      callAttempts: [],
      userPrompt: 'changed',
    }).issues,
  ).toHaveLength(1);
  expect(
    inspectContentAttachmentInventoryReview(input, selection, {
      ...audit,
      rawResponse: request.schema.parse(raw),
      callAttempts: [],
      systemPrompt: 'changed',
    }).issues,
  ).toHaveLength(1);
  selection.decisions.E2 = {
    status: 'unresolved',
    candidateRefs: ['opaque-nine', 'opaque-two'],
    reason: 'Role only',
  } as never;
  expect(
    createContentAttachmentInventoryReviewRequest(input, selection).required,
  ).toHaveLength(1);
  expect(input).toEqual(before.input);
  expect(raw).toEqual(before.raw);
});

test('forces own-candidate ID grounds for every excluded member of a reviewed original pool', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit);
  input.inventories[0].candidateRefs.push('area');
  const selection = frozenSelection();
  selection.decisions.E2.candidateRefs = ['opaque-nine'];
  const request = createContentAttachmentInventoryReviewRequest(
    input,
    selection,
  );
  const excluded = {
    state: 'excluded',
    contextRef: 'E2',
    candidateEvidenceRefs: ['K3.1'],
    reason: 'Area not directly described',
  };
  const raw = {
    reviews: {
      'E2:U1': {
        'opaque-nine': { state: 'included' },
        'opaque-two': { state: 'included' },
        area: excluded,
      },
    },
  };
  expect(request.schema.safeParse(raw).success).toBe(true);
  for (const change of [
    { candidateEvidenceRefs: [] },
    { candidateEvidenceRefs: ['K2.1'] },
    { contextRef: 'E1' },
    { reason: '' },
    { quote: 'invented' },
  ]) {
    expect(
      request.schema.safeParse({
        reviews: {
          'E2:U1': {
            ...raw.reviews['E2:U1'],
            area: { ...excluded, ...change },
          },
        },
      }).success,
    ).toBe(false);
  }
  expect(
    inspectContentAttachmentInventoryReview(input, selection, {
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      rawResponse: request.schema.parse(raw),
      usage: {} as never,
      callAttempts: [],
    }).exclusions[0].candidateEvidence[0].quote,
  ).toBe('Area work. Period A features.');
  const ignored = {
    decisions: {
      E1: { status: 'ignored' as const, reason: 'No description' },
      E2: { status: 'ignored' as const, reason: 'No description' },
    },
  };
  const empty = createContentAttachmentInventoryReviewRequest(input, ignored);
  expect(empty.required).toEqual([]);
  expect(empty.schema.safeParse({ reviews: {} }).success).toBe(true);
  expect(inspectContentAttachmentInventoryReview(input, ignored)).toEqual({
    issues: [],
    exclusions: [],
  });
});

test('runs immutable selection then a mandatory bounded review, checkpoints distinct attempts and blocks missing review replay', async () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const request = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      {
        includeBodyContext: true,
        qualifyBeforeIdentity: true,
        reconcileRecipientRefs: true,
        crossChapterAreas: true,
        preserveAreaWork: true,
        preserveAreaResults: true,
        boundAreaResultRecipients: true,
        reviewTableWork: true,
        traceAreaRecording: true,
        boundAreaRecording: true,
        checkClauseGrounds: true,
        gateQualifierStage: true,
        preserveTentativeMembership: true,
        segmentReview: true,
        wordEvidence: true,
        sourceGroundedCoverage: true,
      },
    ),
    legacyReview = {
      reviews: {
        'E1:U1': Object.fromEntries(
          ['opaque-nine', 'opaque-two'].map((ref, i) => [
            ref,
            {
              ...independentMember(
                'excluded',
                'not_alternative',
                `K${i + 1}.1`,
              ),
              contextRef: 'E1',
            },
          ]),
        ),
        'E1:B1': {
          area: {
            ...independentMember('included', 'not_alternative', 'K3.1'),
            contextRef: 'E1',
          },
        },
        'E2:B1': {
          area: independentMember('included', 'not_alternative', 'K3.1'),
        },
        'E2:U1': {
          'opaque-nine': independentMember('included', 'alternative', 'K1.1'),
          'opaque-two': independentMember('included', 'alternative', 'K2.1'),
        },
      },
    };
  const review = request.schema.parse({
    segments: Object.fromEntries(
      request
        .wordEvidence!.sources.filter((source) =>
          request.required.some((r) => r.excerptRef === source.ref),
        )
        .map((source) => [
          source.ref,
          [
            {
              kind: 'substantive',
              wordRanges: [`${source.ref}:W1-${source.words.at(-1)!.ref}`],
            },
          ],
        ]),
    ),
    reviews: Object.fromEntries(
      Object.entries(legacyReview.reviews).map(([key, members]) => [
        key,
        Object.fromEntries(
          Object.entries(members).map(([ref, answer]) => [
            ref,
            {
              ...answer,
              segmentDecisions: [
                {
                  segment: 1,
                  attachment: answer.attachment,
                  relationshipSubject: answer.relationshipSubject,
                  reason: answer.reason,
                },
              ],
              wordRanges:
                answer.attachment === 'included' ||
                answer.relationshipSubject === 'alternative'
                  ? [`${key.split(':')[0]}:W1-W1`]
                  : [],
            },
          ]),
        ),
      ]),
    ),
  });
  const usage = {
    component: 'test',
    phase: 'test',
    model: 'primary' as const,
    modelName: 'test',
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
  };
  const attempt = { sequence: 1 } as never;
  vi.mocked(createAuditedModel).mockImplementation((_model, onAttempt) => {
    void onAttempt?.(attempt);
    return { model: {} as never, attempts: [attempt] };
  });
  vi.mocked(LLMCaller.call)
    .mockResolvedValueOnce({ output: selection, usage, usedFallback: false })
    .mockResolvedValueOnce({ output: review, usage, usedFallback: false });
  const onAttempt = vi.fn(),
    audit = await attachContentUnit(plan, unit, {
      model: {} as never,
      maxRetries: 0,
      onAttempt,
    });
  expect(onAttempt.mock.calls.map(([a]) => a.sequence)).toEqual([1, 2]);
  expect(audit.rawResponse).toBe(selection);
  expect(audit.independentReview?.rawResponse).toBe(review);
  expect(audit.independentReview?.callAttempts[0].sequence).toBe(2);
  expect(audit.usage.totalTokens).toBe(30);
  expect(audit.selectionUsage?.totalTokens).toBe(15);
  expect(LLMCaller.call).toHaveBeenCalledTimes(2);
  const before = structuredClone(audit);
  expect(assembleContentAttachment(plan, [audit]).issues).toEqual([]);
  expect(audit).toEqual(before);
  expect(
    assembleContentAttachment(plan, [audit]).reviewDisagreements?.map(
      (f) => f.candidateRef,
    ),
  ).toEqual(['opaque-two']);
  expect(
    assembleContentAttachment(plan, [
      { ...audit, independentReview: undefined },
    ]).issues[0].reason,
  ).toContain('missing independent inventory review');
  vi.mocked(LLMCaller.call)
    .mockResolvedValueOnce({ output: selection, usage, usedFallback: false })
    .mockResolvedValueOnce({ output: review, usage, usedFallback: false });
  await attachContentUnit(plan, unit, { model: {} as never, maxRetries: 0 });
});

test('assembles exact excluded evidence from a required v60 review without changing the selection or original candidate', async () => {
  const { plan, unit } = fixture();
  plan.registry.push({
    ...structuredClone(plan.registry[1]),
    ref: 'extra',
    groupId: 'extra',
  });
  const input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const request = createContentAttachmentInventoryReviewRequest(
    input,
    selection,
  );
  const review = request.schema.parse({
    reviews: {
      'E2:U1': {
        'opaque-nine': { state: 'included' },
        'opaque-two': { state: 'included' },
        extra: {
          state: 'excluded',
          contextRef: 'E2',
          candidateEvidenceRefs: ['K4.1'],
          reason: 'Not directly described',
        },
      },
    },
  });
  const audit: ContentAttachmentSelectionAudit = {
    unitId: unit.unitId,
    ...createContentAttachmentRequest(plan, unit, 'content-attachment.v60'),
    codeMap: input.codeMap,
    rawResponse: selection,
    response: flattenContentAttachmentResponse(selection),
    inventoryReview: {
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      rawResponse: review,
      usage: {} as never,
      callAttempts: [],
    },
    usage: {} as never,
  };
  const before = structuredClone(audit),
    result = assembleContentAttachment(plan, [audit]);
  expect(result.issues).toEqual([]);
  expect(result.exclusionEvidence?.[0]).toMatchObject({
    candidateRef: 'extra',
    contextEvidence: [{ quote: 'Period A features.' }],
    candidateEvidence: [{ quote: 'Pit (B)' }],
  });
  expect(audit).toEqual(before);
  const invalid = structuredClone(audit);
  invalid.inventoryReview!.rawResponse.reviews['E2:U1'].extra = {
    state: 'excluded',
    contextRef: 'E1',
    candidateEvidenceRefs: ['K4.1'],
    reason: 'Wrong context',
  };
  expect(assembleContentAttachment(plan, [invalid]).issues).toHaveLength(1);
  expect(assembleContentAttachment(plan, [invalid]).completedUnitIds).toEqual(
    [],
  );
});
