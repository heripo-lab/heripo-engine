import type * as Shared from '@heripo/shared';

import type { ContentAttachmentSelectionAudit } from '../types';

import { Output } from 'ai';
import { expect, test, vi } from 'vitest';

import { assembleContentAttachment } from '../assembly';
import { createContentAttachmentGroundedInput } from '../grounding';
import {
  fixture,
  frozenSelection,
  independentMember,
} from '../grounding.test-fixture';
import { createContentAttachmentRequest } from '../request';
import { flattenContentAttachmentResponse } from '../response';
import { inspectContentAttachmentIndependentReview } from './independent-review-inspection';
import { createContentAttachmentIndependentReviewRequest } from './independent-review-request';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

test('independently permits inclusion, exclusion and role alternatives for every member while requiring exact review coverage', async () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const request = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
  );
  const raw = {
    reviews: {
      'E2:U1': {
        'opaque-nine': independentMember('excluded', 'not_alternative', 'K1.1'),
        'opaque-two': independentMember('included', 'alternative', 'K2.1'),
      },
    },
  };
  const before = structuredClone({ selection, raw, input });
  expect(request.schema.safeParse(raw).success).toBe(true);
  expect(JSON.parse(request.userPrompt)).not.toHaveProperty('decisions');
  expect(JSON.parse(request.userPrompt)).not.toHaveProperty('selected');
  const revised = structuredClone(selection);
  revised.decisions.E2.candidateRefs = ['opaque-two'];
  expect(
    createContentAttachmentIndependentReviewRequest(input, revised).userPrompt,
  ).toBe(request.userPrompt);
  expect(request.schema.safeParse({ reviews: {} }).success).toBe(false);
  expect(
    request.schema.safeParse({
      reviews: {
        'E2:U1': { 'opaque-nine': raw.reviews['E2:U1']['opaque-nine'] },
      },
    }).success,
  ).toBe(false);
  for (const change of [
    { candidateEvidenceRefs: [] },
    { candidateEvidenceRefs: ['K2.1'] },
    { attachment: 'invented' },
    { quote: 'rewritten' },
    { reason: '' },
  ])
    expect(
      request.schema.safeParse({
        reviews: {
          'E2:U1': {
            ...raw.reviews['E2:U1'],
            'opaque-nine': {
              ...raw.reviews['E2:U1']['opaque-nine'],
              ...change,
            },
          },
        },
      }).success,
    ).toBe(false);
  const format = JSON.parse(
    JSON.stringify(
      await Output.object({ schema: request.schema }).responseFormat,
    ),
  ).schema;
  expect(format.properties.reviews.required).toEqual(['E2:U1']);
  expect(format.properties.reviews.properties['E2:U1'].required).toEqual([
    'opaque-nine',
    'opaque-two',
  ]);
  const audit = {
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    rawResponse: request.schema.parse(raw),
    usage: {} as never,
    callAttempts: [],
  };
  const result = inspectContentAttachmentIndependentReview(
    input,
    selection,
    audit,
  );
  expect(result.issues).toEqual([]);
  expect(
    result.disagreements.map((f) => [f.candidateRef, f.changedFields]),
  ).toEqual([
    ['opaque-nine', ['attachment', 'unresolved']],
    ['opaque-two', ['attachment']],
  ]);
  expect(result.findings[0].contextEvidence[0].quote).toBe(
    'Period A features.',
  );
  expect(result.findings[1].candidateEvidence[0].quote).toBe('Pit (B)');
  expect({ selection, raw, input }).toEqual(before);
  expect(
    inspectContentAttachmentIndependentReview(input, selection).issues,
  ).toHaveLength(1);
  expect(
    inspectContentAttachmentIndependentReview(input, selection, {
      ...audit,
      systemPrompt: 'changed',
    }).issues,
  ).toHaveLength(1);
  expect(
    inspectContentAttachmentIndependentReview(input, selection, {
      ...audit,
      userPrompt: 'changed',
    }).issues,
  ).toHaveLength(1);
  expect(
    inspectContentAttachmentIndependentReview(input, selection, {
      ...audit,
      rawResponse: { reviews: {} },
    }).issues,
  ).toHaveLength(1);
});

test('retains genuine attachment uncertainty, validates original context and duplicate IDs, and skips review only when coverage is empty', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit);
  const selection = frozenSelection();
  Object.assign(selection.decisions, {
    E1: { status: 'ignored', reason: 'No target' },
  });
  selection.decisions.E2 = {
    status: 'unresolved',
    candidateRefs: ['opaque-nine', 'opaque-two'],
    reason: 'Recipients uncertain',
  } as never;
  const request = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
  );
  const raw = {
    reviews: {
      'E2:U1': {
        'opaque-nine': independentMember(
          'unresolved',
          'not_alternative',
          'K1.1',
        ),
        'opaque-two': independentMember('excluded', 'not_alternative', 'K2.1'),
      },
    },
  };
  const audit = {
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    rawResponse: request.schema.parse(raw),
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(
      input,
      selection,
      audit,
    ).disagreements.map((f) => f.candidateRef),
  ).toEqual(['opaque-two']);
  audit.rawResponse.reviews['E2:U1']['opaque-nine'].contextRef = 'E1';
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit)
      .issues[0],
  ).toContain('provenance');
  audit.rawResponse.reviews['E2:U1']['opaque-nine'].contextRef = 'E2';
  audit.rawResponse.reviews['E2:U1']['opaque-nine'].candidateEvidenceRefs = [
    'K1.1',
    'K1.1',
  ];
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit)
      .issues[0],
  ).toContain('provenance');
  const ignored = {
    decisions: {
      E1: { status: 'ignored' as const, reason: 'No target' },
      E2: { status: 'ignored' as const, reason: 'No target' },
    },
  };
  const empty = createContentAttachmentIndependentReviewRequest(input, ignored);
  expect(empty.schema.safeParse({ reviews: {} }).success).toBe(true);
  expect(inspectContentAttachmentIndependentReview(input, ignored)).toEqual({
    issues: [],
    findings: [],
    disagreements: [],
  });
});

test('preserves original assembled contents alongside independent disagreements and blocks invalid review provenance', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const request = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
  );
  const review = request.schema.parse({
    reviews: {
      'E2:U1': {
        'opaque-nine': independentMember('included', 'alternative', 'K1.1'),
        'opaque-two': independentMember('included', 'alternative', 'K2.1'),
      },
    },
  });
  const audit: ContentAttachmentSelectionAudit = {
    unitId: unit.unitId,
    ...createContentAttachmentRequest(plan, unit, 'content-attachment.v61'),
    codeMap: input.codeMap,
    rawResponse: selection,
    response: flattenContentAttachmentResponse(selection),
    usage: {} as never,
    independentReview: {
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      rawResponse: review,
      usage: {} as never,
      callAttempts: [],
    },
  };
  const before = structuredClone(audit),
    result = assembleContentAttachment(plan, [audit]);
  expect(result.issues).toEqual([]);
  expect(result.reviewDisagreements?.map((f) => f.candidateRef)).toEqual([
    'opaque-two',
  ]);
  expect(result.independentReviewFindings).toHaveLength(2);
  expect(result.contents.map((c) => c.registryRef)).not.toContain('opaque-two');
  expect(audit).toEqual(before);
  audit.independentReview!.rawResponse.reviews['E2:U1'][
    'opaque-nine'
  ].contextRef = 'E1';
  expect(assembleContentAttachment(plan, [audit]).issues[0].reason).toContain(
    'provenance',
  );
  expect(assembleContentAttachment(plan, [audit]).completedUnitIds).toEqual([]);
});

test('requires separately grounded body-context candidates even when the initial assignment omits them', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  selection.decisions.E2.candidateRefs = ['opaque-nine'];
  input.bodyCandidateContexts.push(
    ['area', 'C1'],
    ['opaque-nine', 'C1'],
    ['area', 'unrelated-context'],
  );
  const original = structuredClone(selection),
    options = { includeBodyContext: true };
  const request = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    options,
  );
  expect(request.required.map((r) => r.key)).toEqual([
    'E2:U1',
    'E1:B1',
    'E2:B1',
  ]);
  expect(JSON.parse(request.userPrompt).bodyReviewPools).toEqual([
    { ref: 'B1', context: 'C1', candidateRefs: ['area'] },
  ]);
  expect(JSON.parse(request.userPrompt)).not.toHaveProperty('decisions');
  const raw = {
    reviews: {
      'E2:U1': {
        'opaque-nine': independentMember('included', 'alternative', 'K1.1'),
        'opaque-two': independentMember('excluded', 'alternative', 'K2.1'),
      },
      'E1:B1': {
        area: {
          ...independentMember('included', 'not_alternative', 'K3.1'),
          contextRef: 'E1',
        },
      },
      'E2:B1': {
        area: independentMember('included', 'not_alternative', 'K3.1'),
      },
    },
  };
  expect(request.schema.safeParse(raw).success).toBe(true);
  const missing = structuredClone(raw);
  delete (missing.reviews as Record<string, unknown>)['E2:B1'];
  expect(request.schema.safeParse(missing).success).toBe(false);
  const inspected = inspectContentAttachmentIndependentReview(
    input,
    selection,
    {
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      rawResponse: request.schema.parse(raw),
      usage: {} as never,
      callAttempts: [],
    },
    options,
  );
  expect(inspected.issues).toEqual([]);
  expect(inspected.disagreements).toMatchObject([
    {
      candidateRef: 'area',
      inventoryRef: 'B1',
      reviewBasis: 'body_context',
      changedFields: ['attachment'],
      original: { assigned: false },
    },
  ]);
  expect(
    inspected.findings.find((f) => f.inventoryRef === 'U1')!.reviewBasis,
  ).toBe('inventory');
  expect(
    inspected.findings.find((f) => f.candidateRef === 'area')!
      .candidateEvidence[0].quote,
  ).toBe('Area work. Period A features.');
  expect(selection).toEqual(original);
  const current = createContentAttachmentRequest(plan, unit),
    archived = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v61',
    );
  expect(current.userPrompt).toBe(archived.userPrompt);
  expect(current.systemPrompt).toContain(
    'A generic conservation, protection or safety purpose does not by itself',
  );
  expect(request.systemPrompt).toContain(
    'a tentative, estimated or possible classification alone does not exclude',
  );
  expect(archived.systemPrompt).not.toContain(
    'BODY-GROUNDED REFERENTS, TENTATIVE MEMBERS AND WORK PURPOSE',
  );
});

test('reviews body-only contexts without any initial inventory selections and retains a genuinely empty coverage case', () => {
  const { plan, unit } = fixture();
  plan.registry = plan.registry.filter((r) => r.ref === 'area');
  const input = createContentAttachmentGroundedInput(plan, unit),
    ignored = {
      decisions: {
        E1: { status: 'ignored' as const, reason: 'Original omission' },
        E2: { status: 'ignored' as const, reason: 'Original omission' },
      },
    };
  const request = createContentAttachmentIndependentReviewRequest(
    input,
    ignored,
    {
      includeBodyContext: true,
      qualifyBeforeIdentity: true,
      reconcileRecipientRefs: true,
    },
  );
  expect(request.required.map((r) => r.key)).toEqual(['E1:B1', 'E2:B1']);
  expect(
    JSON.parse(request.userPrompt).candidates.map((r: string[]) => r[0]),
  ).toEqual(['area']);
  plan.registry = [];
  const emptyInput = createContentAttachmentGroundedInput(plan, unit),
    empty = createContentAttachmentIndependentReviewRequest(
      emptyInput,
      ignored,
      {
        includeBodyContext: true,
        qualifyBeforeIdentity: true,
        reconcileRecipientRefs: true,
      },
    );
  expect(empty.required).toEqual([]);
  expect(empty.schema.safeParse({ reviews: {} }).success).toBe(true);
  expect(
    inspectContentAttachmentIndependentReview(emptyInput, ignored, undefined, {
      includeBodyContext: true,
    }),
  ).toEqual({ issues: [], findings: [], disagreements: [] });
});
