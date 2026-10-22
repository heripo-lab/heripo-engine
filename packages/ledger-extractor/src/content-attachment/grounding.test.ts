import type * as Shared from '@heripo/shared';

import type { ContentAttachmentGroundedResponse } from './grounding';
import type { ContentAttachmentSelectionAudit } from './types';

import { Output } from 'ai';
import { expect, test, vi } from 'vitest';

import { assembleContentAttachment } from './assembly';
import {
  createContentAttachmentGroundedInput,
  createContentAttachmentGroundedSchema,
  inspectContentAttachmentGrounding,
} from './grounding';
import { fixture, response } from './grounding.test-fixture';
import { createContentAttachmentRequest } from './request';
import { flattenContentAttachmentResponse } from './response';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

test('requires all inventory members and evidence IDs in the provider schema; resolves exact source evidence without rewriting', async () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    schema = createContentAttachmentGroundedSchema(input),
    raw = response(),
    before = structuredClone({ plan, raw });
  expect(input.payload.candidates[0][5]).toEqual([
    ['K1.1', 'Tentative road (A)'],
  ]);
  expect(input.payload.inventoryMembers).toEqual([
    ['U1', ['opaque-nine', 'opaque-two']],
  ]);
  expect(schema.safeParse(raw).success).toBe(true);
  const inspected = inspectContentAttachmentGrounding(input, raw);
  expect(inspected.issues).toEqual([]);
  expect(inspected.exclusions[0]).toMatchObject({
    candidateRef: 'opaque-two',
    contextEvidence: [{ quote: 'Period A features.' }],
    candidateEvidence: [
      { quote: 'Pit (B)', resourceKey: '/tables/0/grid/1/0' },
    ],
  });
  expect({ plan, raw }).toEqual(before);
  for (const missing of ['opaque-nine', 'opaque-two']) {
    const bad = structuredClone(raw);
    delete bad.inventoryAudits[0].members[missing];
    expect(schema.safeParse(bad).success).toBe(false);
  }
  for (const bad of [
    { ...raw, inventoryAudits: undefined },
    { ...raw, exclusions: undefined },
    { ...raw, extra: true },
    {
      ...raw,
      inventoryAudits: [
        {
          ...raw.inventoryAudits[0],
          members: {
            ...raw.inventoryAudits[0].members,
            foreign: { state: 'included' },
          },
        },
      ],
    },
    {
      ...raw,
      inventoryAudits: [
        {
          ...raw.inventoryAudits[0],
          members: {
            ...raw.inventoryAudits[0].members,
            'opaque-two': {
              state: 'excluded',
              contextRef: 'E2',
              candidateEvidenceRefs: [],
              reason: 'Missing',
            },
          },
        },
      ],
    },
    {
      ...raw,
      inventoryAudits: [
        {
          ...raw.inventoryAudits[0],
          members: {
            ...raw.inventoryAudits[0].members,
            'opaque-two': {
              state: 'excluded',
              contextRef: 'E2',
              candidateEvidenceRefs: ['K2.1'],
              reason: '',
              quote: 'Rewritten',
            },
          },
        },
      ],
    },
  ])
    expect(schema.safeParse(bad).success).toBe(false);
  const format = await Output.object({ schema }).responseFormat;
  const json = JSON.parse(JSON.stringify(format)).schema;
  expect(json.required).toEqual(['decisions', 'inventoryAudits', 'exclusions']);
  expect(JSON.stringify(json)).toContain('opaque-nine');
  expect(JSON.stringify(json)).toContain('K2.1');
});

test('reports missing multirow body audits and contradictory review dispositions without inserting targets', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    raw = response();
  raw.decisions.E2 = {
    status: 'assigned',
    candidateRefs: ['opaque-nine', 'opaque-two'],
    reason: 'Mixed set',
    unresolved: null,
  };
  raw.inventoryAudits = [];
  expect(inspectContentAttachmentGrounding(input, raw).issues).toEqual([
    'Missing original inventory audit: E2:U1',
  ]);
  raw.inventoryAudits = response().inventoryAudits;
  expect(inspectContentAttachmentGrounding(input, raw).issues[0]).toContain(
    'Invalid or repeated exclusion provenance',
  );
  raw.decisions.E2 = {
    status: 'assigned',
    candidateRefs: ['opaque-nine'],
    reason: 'One',
    unresolved: null,
  };
  raw.inventoryAudits[0].members['opaque-two'] = { state: 'included' };
  expect(inspectContentAttachmentGrounding(input, raw).issues).toEqual([
    'Inventory member has no target selection: E2:opaque-two',
  ]);
  raw.inventoryAudits.push(structuredClone(raw.inventoryAudits[0]));
  expect(inspectContentAttachmentGrounding(input, raw).issues).toContain(
    'Repeated inventory audit: E2:U1',
  );
  raw.decisions.E2 = { status: 'ignored', reason: 'No targets' };
  expect(
    inspectContentAttachmentGrounding(input, raw).issues.length,
  ).toBeGreaterThan(0);
  raw.decisions.E2 = {
    status: 'unresolved',
    candidateRefs: ['opaque-nine'],
    reason: 'Role identity',
  };
  expect(
    inspectContentAttachmentGrounding(input, raw).issues.length,
  ).toBeGreaterThan(0);
});

test('validates ad-hoc exclusions, shared assigned/role alternatives and original-table source units', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    raw = response();
  raw.inventoryAudits = [];
  const extra = {
    excerptRef: 'E2',
    candidateRef: 'opaque-two',
    contextRef: 'E2',
    candidateEvidenceRefs: ['K2.1'],
    reason: 'Different source qualifier',
  };
  raw.exclusions = [extra];
  expect(inspectContentAttachmentGrounding(input, raw).issues).toEqual([]);
  for (const replacement of [
    { contextRef: 'E1' },
    { candidateEvidenceRefs: ['K1.1'] },
    { candidateEvidenceRefs: ['K2.1', 'K2.1'] },
    { candidateRef: 'opaque-nine' },
  ]) {
    raw.exclusions = [{ ...extra, ...replacement }];
    expect(inspectContentAttachmentGrounding(input, raw).issues[0]).toContain(
      'Invalid or repeated exclusion provenance',
    );
  }
  raw.exclusions = [
    {
      ...extra,
      excerptRef: 'E1',
      contextRef: 'E1',
      candidateRef: 'opaque-nine',
      candidateEvidenceRefs: ['K1.1'],
    },
    extra,
  ];
  expect(inspectContentAttachmentGrounding(input, raw).issues).toEqual([]);
  raw.exclusions = [
    { ...extra, candidateRef: 'area', candidateEvidenceRefs: ['K3.1'] },
    extra,
  ];
  expect(inspectContentAttachmentGrounding(input, raw).issues).toEqual([]);
  raw.exclusions = [extra, extra];
  expect(inspectContentAttachmentGrounding(input, raw).issues[0]).toContain(
    'Invalid or repeated exclusion provenance',
  );
  raw.exclusions = [extra];
  raw.decisions.E2 = {
    status: 'assigned',
    candidateRefs: ['opaque-nine'],
    reason: 'Observed',
    unresolved: { candidateRefs: ['opaque-nine'], reason: 'Role uncertain' },
  };
  expect(inspectContentAttachmentGrounding(input, raw).issues).toEqual([]);
  const cells = createContentAttachmentGroundedInput(plan, plan.units[1]);
  const tableRaw: ContentAttachmentGroundedResponse = {
    decisions: {
      E1: {
        status: 'assigned',
        candidateRefs: ['opaque-nine'],
        reason: 'Cell',
        unresolved: null,
      },
      E2: {
        status: 'assigned',
        candidateRefs: ['opaque-two'],
        reason: 'Cell',
        unresolved: null,
      },
    },
    inventoryAudits: [],
    exclusions: [],
  };
  expect(inspectContentAttachmentGrounding(cells, tableRaw).issues).toEqual([]);
});

test('handles a registry without original table bindings and enforces empty inventory audit output', () => {
  const { plan, unit } = fixture();
  plan.registry = plan.registry.filter((c) => c.ref === 'area');
  const input = createContentAttachmentGroundedInput(plan, unit),
    schema = createContentAttachmentGroundedSchema(input),
    raw: ContentAttachmentGroundedResponse = {
      decisions: {
        E1: {
          status: 'assigned',
          candidateRefs: ['area'],
          reason: 'Area',
          unresolved: null,
        },
        E2: { status: 'ignored', reason: 'No member' },
      },
      inventoryAudits: [],
      exclusions: [],
    };
  expect(schema.safeParse(raw).success).toBe(true);
  expect(inspectContentAttachmentGrounding(input, raw)).toEqual({
    issues: [],
    exclusions: [],
  });
  expect(
    schema.safeParse({
      ...raw,
      inventoryAudits: [
        { excerptRef: 'E1', inventoryRef: 'none', members: {} },
      ],
    }).success,
  ).toBe(false);
});

test('assembly preserves structured exclusions and rejects schema, coverage and provenance violations without repairing raw decisions', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    raw = response();
  const audit: ContentAttachmentSelectionAudit = {
    unitId: unit.unitId,
    ...createContentAttachmentRequest(plan, unit, 'content-attachment.v59'),
    codeMap: input.codeMap,
    rawResponse: raw,
    response: flattenContentAttachmentResponse(raw),
    usage: {
      component: 'test',
      phase: 'test',
      model: 'primary',
      modelName: 'test',
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    },
  };
  const before = structuredClone(audit),
    result = assembleContentAttachment(plan, [audit]);
  expect(result.issues).toEqual([]);
  expect(result.exclusionEvidence?.[0].candidateEvidence[0].quote).toBe(
    'Pit (B)',
  );
  expect(audit).toEqual(before);
  const bad = structuredClone(audit);
  (
    bad.rawResponse as ContentAttachmentGroundedResponse
  ).inventoryAudits[0].members['opaque-two'] = {
    state: 'excluded',
    contextRef: 'E1',
    candidateEvidenceRefs: ['K2.1'],
    reason: 'Wrong context',
  };
  expect(assembleContentAttachment(plan, [bad]).issues[0].reason).toContain(
    'exclusion provenance',
  );
  expect(assembleContentAttachment(plan, [bad]).completedUnitIds).toEqual([]);
});

test('retains separate original-table exclusion grounds for repeated member origins and rejects ad-hoc duplication', () => {
  const { plan, unit } = fixture(true),
    input = createContentAttachmentGroundedInput(plan, unit),
    raw = response();
  raw.decisions.E2 = {
    status: 'assigned',
    candidateRefs: ['opaque-two'],
    reason: 'Different described member',
    unresolved: null,
  };
  const quotes = input.citations.filter(
    (c) => c.candidateRef === 'opaque-nine',
  );
  const excluded = (ref: string) => ({
    state: 'excluded' as const,
    contextRef: 'E2',
    candidateEvidenceRefs: [ref],
    reason: 'Not directly described',
  });
  raw.inventoryAudits = [
    {
      excerptRef: 'E2',
      inventoryRef: 'U1',
      members: {
        'opaque-nine': excluded(quotes[0].ref),
        'opaque-two': { state: 'included' },
      },
    },
    {
      excerptRef: 'E2',
      inventoryRef: 'U2',
      members: { 'opaque-nine': excluded(quotes[1].ref) },
    },
  ];
  expect(
    createContentAttachmentGroundedSchema(input).safeParse(raw).success,
  ).toBe(true);
  const result = inspectContentAttachmentGrounding(input, raw);
  expect(result.issues).toEqual([]);
  expect(
    result.exclusions.map((e) => e.candidateEvidence[0].resourceKey),
  ).toEqual(['/tables/0/grid/0/0', '/tables/1/grid/0/0']);
  raw.exclusions = [
    {
      excerptRef: 'E2',
      candidateRef: 'opaque-nine',
      contextRef: 'E2',
      candidateEvidenceRefs: [quotes[0].ref],
      reason: 'Duplicate',
    },
  ];
  expect(inspectContentAttachmentGrounding(input, raw).issues[0]).toContain(
    'repeated exclusion provenance',
  );
});
