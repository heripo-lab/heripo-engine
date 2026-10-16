import type { ProcessedDocument } from '@heripo/model';
import type * as Shared from '@heripo/shared';

import type {
  ContentAttachmentPlan,
  ContentAttachmentSelectionAudit,
} from './content-attachment';
import type { ContentAttachmentGroundedResponse } from './content-attachment-grounding';

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
  const request = createContentAttachmentInventoryReviewRequest(
      input,
      selection,
    ),
    review = request.schema.parse({
      reviews: {
        'E2:U1': {
          'opaque-nine': { state: 'included' },
          'opaque-two': { state: 'included' },
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
  expect(audit.inventoryReview?.rawResponse).toBe(review);
  expect(audit.inventoryReview?.callAttempts[0].sequence).toBe(2);
  expect(audit.usage.totalTokens).toBe(30);
  expect(audit.selectionUsage?.totalTokens).toBe(15);
  expect(LLMCaller.call).toHaveBeenCalledTimes(2);
  const before = structuredClone(audit);
  expect(assembleContentAttachment(plan, [audit]).issues).toEqual([]);
  expect(audit).toEqual(before);
  expect(
    assembleContentAttachment(plan, [{ ...audit, inventoryReview: undefined }])
      .issues[0].reason,
  ).toContain('missing required inventory review');
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
    ...createContentAttachmentRequest(plan, unit),
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
});
