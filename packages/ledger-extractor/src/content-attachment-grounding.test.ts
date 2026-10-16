import type { ProcessedDocument } from '@heripo/model';
import type * as Shared from '@heripo/shared';

import type {
  ContentAttachmentPlan,
  ContentAttachmentSelectionAudit,
} from './content-attachment';
import type { ContentAttachmentGroundedResponse } from './content-attachment-grounding';
import type { ContentAttachmentRequiredResponse } from './content-attachment-response';

import { LLMCaller, createAuditedModel } from '@heripo/shared';
import { Output } from 'ai';
import { expect, test, vi } from 'vitest';

import {
  assembleContentAttachment,
  attachContentUnit,
  createContentAttachmentRequest,
} from './content-attachment';
import {
  createContentAttachmentGroundedInput,
  createContentAttachmentGroundedSchema,
  inspectContentAttachmentGrounding,
} from './content-attachment-grounding';
import {
  createContentAttachmentIndependentReviewRequest,
  inspectContentAttachmentIndependentReview,
} from './content-attachment-independent-review';
import {
  createContentAttachmentInventoryReviewRequest,
  inspectContentAttachmentInventoryReview,
} from './content-attachment-inventory-review';
import { flattenContentAttachmentResponse } from './content-attachment-response';
import { buildDocumentResourceIndex } from './document-resource-index';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

function fixture(repeatedOrigins = false) {
  const path = [{ id: 'c', originTitle: 'Survey' }];
  const doc = {
    reportId: 'test',
    pageRangeMap: {},
    images: [],
    footnotes: [],
    chapters: [
      {
        id: 'c',
        originTitle: 'Survey',
        title: 'Survey',
        level: 1,
        pageNo: 1,
        imageIds: [],
        tableIds: [],
        footnoteIds: [],
        textBlocks: [
          { id: 'body', pdfPageNo: 1, text: 'Area work. Period A features.' },
        ],
      },
    ],
    tables: [
      {
        id: 't',
        pdfPageNo: 2,
        numRows: 2,
        numCols: 1,
        grid: [
          [
            {
              text: 'Tentative road (A)',
              rowSpan: 1,
              colSpan: 1,
              isHeader: false,
            },
          ],
          [{ text: 'Pit (B)', rowSpan: 1, colSpan: 1, isHeader: false }],
        ],
      },
    ],
  } as ProcessedDocument;
  if (repeatedOrigins)
    doc.tables.push({
      ...structuredClone(doc.tables[0]),
      id: 'second-table',
      pdfPageNo: 3,
    });
  const index = buildDocumentResourceIndex(doc),
    sources = index.resources
      .filter((r) => r.kind === 'text' || r.kind === 'tableCell')
      .map((resource) => ({ sourceId: resource.key, resource }));
  const evidence = (key: string) => {
    const r = sources.find((s) => s.resource.key === key)!.resource;
    return {
      sourceId: key,
      resourceKey: key,
      resourceId: r.resourceId,
      sourceRefs: r.sourceRefs,
      pdfPageNo: r.pdfPageNo,
      logicalPageRange: r.logicalPageRange,
      charStart: 0,
      charEnd: r.data.text.length,
      quote: r.data.text,
    };
  };
  const plan: ContentAttachmentPlan = {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: 'h',
    candidateSnapshotId: 's',
    registrySha256: 'r',
    registryUncertainties: [],
    pages: [],
    registry: [
      ['opaque-nine', '/tables/0/grid/0/0'],
      ['opaque-two', '/tables/0/grid/1/0'],
      ['area', '/chapters/0/textBlocks/0'],
    ].map(([ref, key]) => ({
      ref,
      groupId: ref,
      recordKind: ref === 'area' ? 'area' : 'feature',
      mentions: [
        {
          candidateId: ref,
          sourceName: ref,
          sourceIdentifier: null,
          chapterPath: path,
          evidence: [evidence(key)],
        },
      ],
    })),
    units: [
      {
        unitId: 'b',
        pdfPageNo: 1,
        sources: sources.filter((s) => s.resource.kind === 'text'),
        chapters: [{ chapterId: 'c', path }],
        tables: [],
        readOnlyContext: [],
      },
      {
        unitId: 't',
        pdfPageNo: 2,
        sources: sources.filter((s) => s.resource.kind === 'tableCell'),
        chapters: [{ chapterId: 'c', path }],
        readOnlyContext: [],
        tables: index.resources
          .filter((r) => r.kind === 'table')
          .map((r) => ({ key: r.key, data: r.data })),
      },
    ],
  };
  if (repeatedOrigins)
    plan.registry[0].mentions.push({
      ...structuredClone(plan.registry[0].mentions[0]),
      candidateId: 'repeated',
      evidence: [evidence('/tables/1/grid/0/0')],
    });
  return { plan, unit: plan.units[0] };
}
function response(): ContentAttachmentGroundedResponse {
  return {
    decisions: {
      E1: {
        status: 'assigned',
        candidateRefs: ['area'],
        reason: 'Area work',
        unresolved: null,
      },
      E2: {
        status: 'assigned',
        candidateRefs: ['opaque-nine'],
        reason: 'Current set',
        unresolved: null,
      },
    },
    inventoryAudits: [
      {
        excerptRef: 'E2',
        inventoryRef: 'U1',
        members: {
          'opaque-nine': { state: 'included' },
          'opaque-two': {
            state: 'excluded',
            contextRef: 'E2',
            candidateEvidenceRefs: ['K2.1'],
            reason: 'Different period',
          },
        },
      },
    ],
    exclusions: [],
  };
}

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

function frozenSelection() {
  return {
    decisions: {
      ...response().decisions,
      E2: {
        status: 'assigned' as const,
        candidateRefs: ['area', 'opaque-nine'],
        reason: 'Collective and area description',
        unresolved: {
          candidateRefs: ['opaque-nine', 'opaque-two'],
          reason: 'Independent relationship subject alternatives',
        },
      },
    },
  };
}

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
      },
    ),
    review = request.schema.parse({
      reviews: {
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

function independentMember(
  attachment: 'included' | 'excluded' | 'unresolved',
  relationshipSubject: 'alternative' | 'not_alternative',
  evidence: string,
) {
  return {
    attachment,
    relationshipSubject,
    contextRef: 'E2',
    candidateEvidenceRefs: [evidence],
    reason: 'Original source-based independent judgment',
  };
}

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

test('preserves historical body review while qualifying collective evidence and relationship identity independently', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const archived = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v62',
    ),
    current = createContentAttachmentRequest(plan, unit),
    historicalReview = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      { includeBodyContext: true },
    ),
    currentReview = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      {
        includeBodyContext: true,
        qualifyBeforeIdentity: true,
        reconcileRecipientRefs: true,
      },
    );
  expect(current.userPrompt).toBe(archived.userPrompt);
  expect(currentReview.userPrompt).toBe(historicalReview.userPrompt);
  expect(currentReview.required).toEqual(historicalReview.required);
  expect(current.systemPrompt).toContain(
    'FIRST narrow that inventory by the CURRENT clause period',
  );
  expect(currentReview.systemPrompt).toContain(
    'attachment=included plus relationshipSubject=alternative',
  );
  expect(archived.systemPrompt).not.toContain('ORDERED CLAUSE JUDGMENT');
  expect(historicalReview.systemPrompt).not.toContain(
    'ORDERED CLAUSE JUDGMENT',
  );
  const raw = {
    reviews: Object.fromEntries(
      currentReview.required.map((r) => [
        r.key,
        Object.fromEntries(
          r.candidateRefs.map((ref) => [
            ref,
            {
              attachment: 'included',
              relationshipSubject: 'alternative',
              contextRef: r.excerptRef,
              candidateEvidenceRefs: [
                input.citations.find((c) => c.candidateRef === ref)!.ref,
              ],
              reason:
                'Original collective membership; relationship subject unresolved',
            },
          ]),
        ),
      ]),
    ),
  };
  expect(currentReview.schema.safeParse(raw).success).toBe(true);
  expect(historicalReview.schema.safeParse(raw).success).toBe(true);
  const audit = {
    systemPrompt: currentReview.systemPrompt,
    userPrompt: currentReview.userPrompt,
    rawResponse: currentReview.schema.parse(raw),
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, {
      includeBodyContext: true,
      qualifyBeforeIdentity: true,
      reconcileRecipientRefs: true,
    }).issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, {
      includeBodyContext: true,
    }).issues,
  ).toHaveLength(1);
});

test('retains original recipient lists and historical policy while checking area recipients and original numbers before return', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const legacyOptions = {
      includeBodyContext: true,
      qualifyBeforeIdentity: true,
    },
    options = { ...legacyOptions, reconcileRecipientRefs: true },
    historical = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v63',
    ),
    current = createContentAttachmentRequest(plan, unit),
    legacyReview = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      legacyOptions,
    ),
    currentReview = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      options,
    ),
    before = structuredClone(selection);
  expect(current.userPrompt).toBe(historical.userPrompt);
  expect(currentReview.userPrompt).toBe(legacyReview.userPrompt);
  expect(currentReview.required).toEqual(legacyReview.required);
  expect(current.systemPrompt).toContain(
    'inspect the candidateRefs array you will ACTUALLY return',
  );
  expect(currentReview.systemPrompt).toContain(
    'preserve the area alongside the qualified feature set',
  );
  expect(historical.systemPrompt).not.toContain(
    'FINAL RECIPIENT AND ORIGINAL-NUMBER RECONCILIATION',
  );
  expect(legacyReview.systemPrompt).not.toContain(
    'FINAL RECIPIENT AND ORIGINAL-NUMBER RECONCILIATION',
  );
  const raw = {
    reviews: Object.fromEntries(
      currentReview.required.map((r) => [
        r.key,
        Object.fromEntries(
          r.candidateRefs.map((ref) => [
            ref,
            {
              attachment: 'excluded',
              relationshipSubject: 'not_alternative',
              contextRef: r.excerptRef,
              candidateEvidenceRefs: [
                input.citations.find((c) => c.candidateRef === ref)!.ref,
              ],
              reason: 'Fixture exclusion retained for independent judgment',
            },
          ]),
        ),
      ]),
    ),
  };
  expect(legacyReview.schema.safeParse(raw).success).toBe(true);
  const audit = {
    systemPrompt: currentReview.systemPrompt,
    userPrompt: currentReview.userPrompt,
    rawResponse: currentReview.schema.parse(raw),
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, options)
      .issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentIndependentReview(
      input,
      selection,
      audit,
      legacyOptions,
    ).issues,
  ).toHaveLength(1);
  expect(selection).toEqual(before);
});

test('reviews whole and partial area definitions across chapters and proposed body recipients without preselecting judgments', () => {
  const { plan, unit } = fixture();
  for (const [ref, kind, chapter] of [
    ['whole', 'area', 'Whole project definition'],
    ['remote', 'feature', 'Other investigation'],
    ['role', 'feature', 'Other investigation'],
    ['unrelated', 'feature', 'Unrelated definition'],
  ] as const) {
    const entry = structuredClone(plan.registry[2]);
    entry.ref = ref;
    entry.groupId = ref;
    entry.recordKind = kind;
    entry.mentions[0].candidateId = ref;
    entry.mentions[0].sourceName = ref;
    entry.mentions[0].chapterPath = [{ id: chapter, originTitle: chapter }];
    plan.registry.push(entry);
  }
  const input = createContentAttachmentGroundedInput(plan, unit),
    selection: ContentAttachmentRequiredResponse = frozenSelection(),
    options = {
      includeBodyContext: true,
      qualifyBeforeIdentity: true,
      reconcileRecipientRefs: true,
      crossChapterAreas: true,
    };
  selection.decisions.E1 = {
    status: 'assigned',
    candidateRefs: ['area', 'remote'],
    unresolved: {
      candidateRefs: ['role'],
      reason: 'Relationship alternatives',
    },
    reason: 'First judgment remains separate',
  };
  const before = structuredClone({ input, selection });
  const current = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    options,
  );
  const payload = JSON.parse(current.userPrompt);
  expect(
    payload.bodyReviewPools.map(
      (p: { candidateRefs: string[] }) => p.candidateRefs,
    ),
  ).toEqual([['area'], ['whole'], ['remote', 'role']]);
  expect(payload.candidates.some((r: string[]) => r[0] === 'unrelated')).toBe(
    false,
  );
  expect(payload).not.toHaveProperty('decisions');
  const archived = createContentAttachmentRequest(
    plan,
    unit,
    'content-attachment.v64',
  );
  expect(
    createContentAttachmentRequest(plan, unit, 'content-attachment.v65')
      .systemPrompt,
  ).toBe(
    archived.systemPrompt + '\n' + current.systemPrompt.split('\n').at(-1),
  );
  expect(current.systemPrompt).toContain(
    'A whole project site and a bounded survey or excavation portion are distinct recipients',
  );
  expect(archived.systemPrompt).not.toContain(
    'WHOLE PROJECT AND PARTIAL INVESTIGATION AREAS',
  );
  const raw = {
    reviews: Object.fromEntries(
      current.required.map((r) => [
        r.key,
        Object.fromEntries(
          r.candidateRefs.map((ref) => [
            ref,
            {
              attachment: 'excluded',
              relationshipSubject: 'not_alternative',
              contextRef: r.excerptRef,
              candidateEvidenceRefs: [
                input.citations.find((c) => c.candidateRef === ref)!.ref,
              ],
              reason:
                'Independent exclusion supported by the original definition',
            },
          ]),
        ),
      ]),
    ),
  };
  expect(current.schema.safeParse(raw).success).toBe(true);
  const missing = structuredClone(raw);
  delete missing.reviews['E1:B2'].whole;
  expect(current.schema.safeParse(missing).success).toBe(false);
  const review = {
    systemPrompt: current.systemPrompt,
    userPrompt: current.userPrompt,
    rawResponse: current.schema.parse(raw),
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, review, options)
      .issues,
  ).toEqual([]);
  const legacy = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    { includeBodyContext: true },
  );
  expect(JSON.parse(legacy.userPrompt).bodyReviewPools).toEqual([
    { ref: 'B1', context: 'C1', candidateRefs: ['area'] },
  ]);
  expect({ input, selection }).toEqual(before);

  selection.decisions.E1 = {
    status: 'ignored',
    reason: 'No direct description',
  };
  selection.decisions.E2 = {
    status: 'unresolved',
    candidateRefs: ['remote', 'role'],
    reason: 'Unresolved source identity',
  };
  const unresolved = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    options,
  );
  expect(
    JSON.parse(unresolved.userPrompt).bodyReviewPools.map(
      (p: { candidateRefs: string[] }) => p.candidateRefs,
    ),
  ).toContainEqual(['remote', 'role']);
  expect(
    unresolved.required.some(
      (r) => r.key === 'E1:B2' && r.candidateRefs.includes('whole'),
    ),
  ).toBe(true);
});

test('shares body inventory boundaries and area fieldwork criteria without changing coverage or adopting independent choices', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection(),
    before = structuredClone({ input, selection }),
    options = {
      includeBodyContext: true,
      qualifyBeforeIdentity: true,
      reconcileRecipientRefs: true,
      crossChapterAreas: true,
    },
    historical = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v65',
    ),
    current = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v66',
    ),
    historicalReview = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      options,
    ),
    review = createContentAttachmentIndependentReviewRequest(input, selection, {
      ...options,
      preserveAreaWork: true,
    });
  const addedSelection = current.systemPrompt.slice(
      historical.systemPrompt.length + 1,
    ),
    addedReview = review.systemPrompt.slice(
      historicalReview.systemPrompt.length + 1,
    );
  expect(current.systemPrompt).toBe(
    historical.systemPrompt + '\n' + addedSelection,
  );
  expect(review.systemPrompt).toBe(
    historicalReview.systemPrompt + '\n' + addedReview,
  );
  expect(addedSelection).toBe(addedReview);
  expect(addedReview).toContain(
    'never extend that cell-specific ownership rule to a body aggregate',
  );
  expect(addedReview).toContain(
    'taking pre-investigation site photographs and making field records of that area',
  );
  expect(addedReview).toContain(
    'Distinguishing whole-project and partial areas must identify WHICH area owns the described work',
  );
  expect(current.userPrompt).toBe(historical.userPrompt);
  expect(review.userPrompt).toBe(historicalReview.userPrompt);
  expect(review.required).toEqual(historicalReview.required);
  const rawResponse = review.schema.parse({
    reviews: Object.fromEntries(
      review.required.map((r) => [
        r.key,
        Object.fromEntries(
          r.candidateRefs.map((ref) => [
            ref,
            {
              attachment: 'excluded',
              relationshipSubject: 'not_alternative',
              contextRef: r.excerptRef,
              candidateEvidenceRefs: [
                input.citations.find((c) => c.candidateRef === ref)!.ref,
              ],
              reason: 'Independent judgment remains selectable',
            },
          ]),
        ),
      ]),
    ),
  });
  expect(historicalReview.schema.safeParse(rawResponse).success).toBe(true);
  const audit = {
    systemPrompt: review.systemPrompt,
    userPrompt: review.userPrompt,
    rawResponse,
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, {
      ...options,
      preserveAreaWork: true,
    }).issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, options)
      .issues,
  ).toHaveLength(1);
  expect({ input, selection }).toEqual(before);
});

test('shares identified area result eligibility without changing evidence coverage or forcing an independent disposition', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection(),
    before = structuredClone({ input, selection }),
    options = {
      includeBodyContext: true,
      qualifyBeforeIdentity: true,
      reconcileRecipientRefs: true,
      crossChapterAreas: true,
      preserveAreaWork: true,
    },
    historical = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v66',
    ),
    current = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v67',
    ),
    historicalReview = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      options,
    ),
    review = createContentAttachmentIndependentReviewRequest(input, selection, {
      ...options,
      preserveAreaResults: true,
    });
  const added = current.systemPrompt.slice(historical.systemPrompt.length + 1);
  expect(current.systemPrompt).toBe(historical.systemPrompt + '\n' + added);
  expect(review.systemPrompt).toBe(
    historicalReview.systemPrompt + '\n' + added,
  );
  expect(added).toContain(
    'directly describes that area own investigation results as well as the supported feature members',
  );
  expect(added).toContain(
    'Do not spread a body feature aggregate to every trench or unit',
  );
  expect(added).toContain(
    'do not spread a partial investigation result to a containing project area',
  );
  expect(current.userPrompt).toBe(historical.userPrompt);
  expect(review.userPrompt).toBe(historicalReview.userPrompt);
  expect(review.required).toEqual(historicalReview.required);
  expect(JSON.parse(review.userPrompt)).not.toHaveProperty('decisions');
  const rawResponse = review.schema.parse({
    reviews: Object.fromEntries(
      review.required.map((r) => [
        r.key,
        Object.fromEntries(
          r.candidateRefs.map((ref) => [
            ref,
            {
              attachment: 'excluded',
              relationshipSubject: 'not_alternative',
              contextRef: r.excerptRef,
              candidateEvidenceRefs: [
                input.citations.find((c) => c.candidateRef === ref)!.ref,
              ],
              reason: 'Independent eligibility judgment retained',
            },
          ]),
        ),
      ]),
    ),
  });
  expect(historicalReview.schema.safeParse(rawResponse).success).toBe(true);
  const audit = {
    systemPrompt: review.systemPrompt,
    userPrompt: review.userPrompt,
    rawResponse,
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, {
      ...options,
      preserveAreaResults: true,
    }).issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, options)
      .issues,
  ).toHaveLength(1);
  expect({ input, selection }).toEqual(before);
});

test('separates area result eligibility from clause-qualified feature recipients in both stages without forcing either judgment', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection(),
    before = structuredClone({ input, selection }),
    options = {
      includeBodyContext: true,
      qualifyBeforeIdentity: true,
      reconcileRecipientRefs: true,
      crossChapterAreas: true,
      preserveAreaWork: true,
      preserveAreaResults: true,
    },
    historical = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v67',
    ),
    current = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v68',
    ),
    historicalReview = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      options,
    ),
    review = createContentAttachmentIndependentReviewRequest(input, selection, {
      ...options,
      boundAreaResultRecipients: true,
    });
  const added = current.systemPrompt.slice(historical.systemPrompt.length + 1);
  expect(current.systemPrompt).toBe(historical.systemPrompt + '\n' + added);
  expect(review.systemPrompt).toBe(
    historicalReview.systemPrompt + '\n' + added,
  );
  expect(added).toContain(
    'AREA RESULT PRESERVATION DOES NOT EXPAND FEATURE RECIPIENTS',
  );
  expect(added).toContain(
    'Area eligibility in (a) neither broadens nor narrows the feature set in (b)',
  );
  expect(added).toContain('CURRENT clause');
  expect(added).toContain('Original row co-occurrence');
  expect(added).toContain(
    'extending a named type set needs an original discourse or definition link',
  );
  expect(added).toContain('genuine relationship-subject alternatives');
  expect(added).not.toMatch(/R19|R21|화지산|E10/);
  expect(current.userPrompt).toBe(historical.userPrompt);
  expect(review.userPrompt).toBe(historicalReview.userPrompt);
  expect(review.required).toEqual(historicalReview.required);
  expect(JSON.parse(review.userPrompt)).not.toHaveProperty('decisions');
  const rawResponse = review.schema.parse({
    reviews: Object.fromEntries(
      review.required.map((r) => [
        r.key,
        Object.fromEntries(
          r.candidateRefs.map((ref) => [
            ref,
            {
              attachment: 'excluded',
              relationshipSubject: 'not_alternative',
              contextRef: r.excerptRef,
              candidateEvidenceRefs: [
                input.citations.find((c) => c.candidateRef === ref)!.ref,
              ],
              reason: 'Independent eligibility judgment retained',
            },
          ]),
        ),
      ]),
    ),
  });
  expect(historicalReview.schema.safeParse(rawResponse).success).toBe(true);
  const audit = {
    systemPrompt: review.systemPrompt,
    userPrompt: review.userPrompt,
    rawResponse,
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, {
      ...options,
      boundAreaResultRecipients: true,
    }).issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, options)
      .issues,
  ).toHaveLength(1);
  expect({ input, selection }).toEqual(before);
});

test.each([
  'content-attachment.v64',
  'content-attachment.v65',
  'content-attachment.v66',
  'content-attachment.v67',
  'content-attachment.v68',
  'content-attachment.v69',
  'content-attachment.v70',
] as const)(
  'replays archived %s request and independent coverage after the live version advances',
  (version) => {
    const { plan, unit } = fixture(),
      input = createContentAttachmentGroundedInput(plan, unit),
      selection = frozenSelection(),
      request = createContentAttachmentRequest(plan, unit, version),
      review = createContentAttachmentIndependentReviewRequest(
        input,
        selection,
        {
          includeBodyContext: true,
          qualifyBeforeIdentity: true,
          reconcileRecipientRefs: true,
          crossChapterAreas: version !== 'content-attachment.v64',
          preserveAreaWork:
            version !== 'content-attachment.v64' &&
            version !== 'content-attachment.v65',
          preserveAreaResults:
            version === 'content-attachment.v67' ||
            version === 'content-attachment.v68' ||
            version === 'content-attachment.v69' ||
            version === 'content-attachment.v70',
          boundAreaResultRecipients:
            version === 'content-attachment.v68' ||
            version === 'content-attachment.v69' ||
            version === 'content-attachment.v70',
          reviewTableWork:
            version === 'content-attachment.v69' ||
            version === 'content-attachment.v70',
          traceAreaRecording: version === 'content-attachment.v70',
        },
      );
    const rawResponse = review.schema.parse({
      reviews: Object.fromEntries(
        review.required.map((r) => [
          r.key,
          Object.fromEntries(
            r.candidateRefs.map((ref) => [
              ref,
              {
                attachment: 'excluded',
                relationshipSubject: 'not_alternative',
                contextRef: r.excerptRef,
                candidateEvidenceRefs: [
                  input.citations.find((c) => c.candidateRef === ref)!.ref,
                ],
                reason: 'Independent archived judgment',
              },
            ]),
          ),
        ]),
      ),
    });
    const audit = {
      unitId: unit.unitId,
      ...request,
      rawResponse: selection,
      response: flattenContentAttachmentResponse(selection),
      codeMap: input.codeMap,
      usage: {} as never,
      independentReview: {
        systemPrompt: review.systemPrompt,
        userPrompt: review.userPrompt,
        rawResponse,
        usage: {} as never,
        callAttempts: [],
      },
    };
    const before = structuredClone(audit);
    const result = assembleContentAttachment(plan, [audit]);
    expect(result.issues).toEqual([]);
    expect(result.completedUnitIds).toEqual([unit.unitId]);
    expect(audit).toEqual(before);
  },
);

test('reviews non-header table data independently even when first selection ignores every cell, with complete table and body context', () => {
  const { plan } = fixture();
  const unit = plan.units[1];
  unit.tables[0].data.grid[0][0].isHeader = true;
  const input = createContentAttachmentGroundedInput(plan, unit);
  input.payload.current.tables[0].grid[0].push([
    null,
    'Read-only context',
    1,
    1,
    false,
  ]);
  const selection: ContentAttachmentRequiredResponse = {
    decisions: Object.fromEntries(
      input.codeMap.excerpts.map((e) => [
        e.ref,
        { status: 'ignored', reason: 'First independent classification' },
      ]),
    ),
  };
  const before = structuredClone({ input, selection });
  const historical = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    { includeBodyContext: true },
  );
  const request = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    { includeBodyContext: true, reviewTableWork: true },
  );
  expect(historical.required.some((r) => r.excerptRef === 'E2')).toBe(false);
  expect(
    request.required.find((r) => r.key === 'E2:U1')?.candidateRefs,
  ).toEqual(['opaque-nine', 'opaque-two']);
  expect(request.required.some((r) => r.excerptRef === 'E1')).toBe(false);
  const payload = JSON.parse(request.userPrompt);
  expect(payload.excerpts).toEqual(input.payload.current.excerpts);
  expect(payload.currentTables).toEqual(input.payload.current.tables);
  expect(payload.originRows).toEqual(input.payload.originRows);
  expect(payload.originAnchors).toEqual(input.payload.originAnchors);
  expect(payload).not.toHaveProperty('decisions');
  const raw = {
    reviews: Object.fromEntries(
      request.required.map((r) => [
        r.key,
        Object.fromEntries(
          r.candidateRefs.map((ref) => [
            ref,
            {
              attachment: 'included',
              relationshipSubject: 'not_alternative',
              contextRef: r.excerptRef,
              candidateEvidenceRefs: [
                input.citations.find((c) => c.candidateRef === ref)!.ref,
              ],
              reason: 'Own source-grounded independent decision',
            },
          ]),
        ),
      ]),
    ),
  };
  expect(request.schema.safeParse(raw).success).toBe(true);
  const missing = structuredClone(raw);
  delete missing.reviews['E2:U1'];
  expect(request.schema.safeParse(missing).success).toBe(false);
  delete raw.reviews['E2:U1']['opaque-two'];
  expect(request.schema.safeParse(raw).success).toBe(false);
  expect({ input, selection }).toEqual(before);
});

test('shares layout recording and linked diary work criteria without forcing semantic answers or changing first evidence', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const options = {
    includeBodyContext: true,
    qualifyBeforeIdentity: true,
    reconcileRecipientRefs: true,
    crossChapterAreas: true,
    preserveAreaWork: true,
    preserveAreaResults: true,
    boundAreaResultRecipients: true,
  };
  const old = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v68',
    ),
    current = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v69',
    );
  const oldReview = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      options,
    ),
    review = createContentAttachmentIndependentReviewRequest(input, selection, {
      ...options,
      reviewTableWork: true,
    });
  const added = current.systemPrompt.slice(old.systemPrompt.length + 1);
  expect(current.systemPrompt).toBe(old.systemPrompt + '\n' + added);
  expect(review.systemPrompt).toBe(oldReview.systemPrompt + '\n' + added);
  expect(added).toContain('measuring their collective layout');
  expect(added).toContain(
    'inherit those source-established participants even without repeated names or numbers',
  );
  expect(added).toContain('whole-project and partial scopes distinct');
  expect(added).not.toMatch(/E7|E44|R1|화지산/);
  expect(current.userPrompt).toBe(old.userPrompt);
  const request = JSON.parse(review.userPrompt);
  expect(request.currentTables).toEqual([]);
  expect(request.excerpts).toEqual(input.payload.current.excerpts);
});

test('shares an explicit original area-definition layout-recording check without changing evidence, coverage or semantic freedom', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const before = structuredClone({ input, selection });
  const options = {
    includeBodyContext: true,
    qualifyBeforeIdentity: true,
    reconcileRecipientRefs: true,
    crossChapterAreas: true,
    preserveAreaWork: true,
    preserveAreaResults: true,
    boundAreaResultRecipients: true,
    reviewTableWork: true,
  };
  const historical = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v69',
    ),
    current = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v70',
    );
  const oldReview = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      options,
    ),
    review = createContentAttachmentIndependentReviewRequest(input, selection, {
      ...options,
      traceAreaRecording: true,
    });
  const added = current.systemPrompt.slice(historical.systemPrompt.length + 1);
  expect(current.systemPrompt).toBe(historical.systemPrompt + '\n' + added);
  expect(review.systemPrompt).toBe(oldReview.systemPrompt + '\n' + added);
  expect(added).toContain('AREA DEFINITION -> LAYOUT -> RECORDING LINK CHECK');
  expect(added).toContain('area through its own K definition');
  expect(added).toContain('original E or body clause');
  expect(added).toContain('same-investigation recording links');
  expect(added).toContain('before omitting an independently described area');
  expect(added).toContain('specific missing or contradicted link');
  expect(added).not.toMatch(/E7|E4|R1|화지산|2,776/);
  expect(current.userPrompt).toBe(historical.userPrompt);
  expect(review.userPrompt).toBe(oldReview.userPrompt);
  expect(review.required).toEqual(oldReview.required);
  expect(JSON.parse(review.userPrompt)).not.toHaveProperty('decisions');
  const output = {
    reviews: Object.fromEntries(
      review.required.map((r) => [
        r.key,
        Object.fromEntries(
          r.candidateRefs.map((ref) => [
            ref,
            {
              attachment: 'excluded',
              relationshipSubject: 'not_alternative',
              contextRef: r.excerptRef,
              candidateEvidenceRefs: [
                input.citations.find((c) => c.candidateRef === ref)!.ref,
              ],
              reason:
                'Original link not established in this independent fixture judgment',
            },
          ]),
        ),
      ]),
    ),
  };
  expect(review.schema.safeParse(output).success).toBe(true);
  expect(oldReview.schema.safeParse(output).success).toBe(true);
  const audit = {
    systemPrompt: review.systemPrompt,
    userPrompt: review.userPrompt,
    rawResponse: review.schema.parse(output),
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, {
      ...options,
      traceAreaRecording: true,
    }).issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, options)
      .issues,
  ).toHaveLength(1);
  expect({ input, selection }).toEqual(before);
});

test('shares the area layout versus local unit work boundary while preserving historical prompts and independent judgment freedom', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const before = structuredClone({ input, selection });
  const options = {
    includeBodyContext: true,
    qualifyBeforeIdentity: true,
    reconcileRecipientRefs: true,
    crossChapterAreas: true,
    preserveAreaWork: true,
    preserveAreaResults: true,
    boundAreaResultRecipients: true,
    reviewTableWork: true,
    traceAreaRecording: true,
  };
  const old = createContentAttachmentRequest(
    plan,
    unit,
    'content-attachment.v70',
  );
  const current = createContentAttachmentRequest(plan, unit);
  const oldReview = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    options,
  );
  const review = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    {
      ...options,
      boundAreaRecording: true,
    },
  );
  const added = current.systemPrompt.slice(old.systemPrompt.length + 1);
  expect(current.promptVersion).toBe('content-attachment.v71');
  expect(current.systemPrompt).toBe(old.systemPrompt + '\n' + added);
  expect(review.systemPrompt).toBe(oldReview.systemPrompt + '\n' + added);
  expect(added).toContain('AREA OWN LAYOUT/RECORD VS UNIT WORK BOUNDARY');
  expect(added).toContain('collective layout plan');
  expect(added).toContain('nearest explicit unit work subject');
  expect(added).toContain('involve several or all units');
  expect(added).toContain('not extra containing areas');
  expect(added).toContain(
    'Do not omit positively linked area layout documentation',
  );
  expect(added).not.toMatch(/E29|E34|E39|E44|E7|R1|화지산|2,776/);
  expect(current.userPrompt).toBe(old.userPrompt);
  expect(review.userPrompt).toBe(oldReview.userPrompt);
  expect(review.required).toEqual(oldReview.required);
  expect(JSON.parse(review.userPrompt)).not.toHaveProperty('decisions');
  const output = {
    reviews: Object.fromEntries(
      review.required.map((r) => [
        r.key,
        Object.fromEntries(
          r.candidateRefs.map((ref) => [
            ref,
            {
              attachment: 'excluded',
              relationshipSubject: 'not_alternative',
              contextRef: r.excerptRef,
              candidateEvidenceRefs: [
                input.citations.find((c) => c.candidateRef === ref)!.ref,
              ],
              reason:
                'Original evidence identifies unit work without area layout documentation',
            },
          ]),
        ),
      ]),
    ),
  };
  expect(oldReview.schema.safeParse(output).success).toBe(true);
  expect(review.schema.safeParse(output).success).toBe(true);
  const audit = {
    systemPrompt: review.systemPrompt,
    userPrompt: review.userPrompt,
    rawResponse: review.schema.parse(output),
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, {
      ...options,
      boundAreaRecording: true,
    }).issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, options)
      .issues,
  ).toHaveLength(1);
  expect({ input, selection }).toEqual(before);
});
