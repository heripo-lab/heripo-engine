import type { ProcessedDocument } from '@heripo/model';
import type { LanguageModel } from 'ai';

import type { ContentAttachmentPlan } from './content-attachment';

import { LLMCaller } from '@heripo/shared';
import { expect, test, vi } from 'vitest';

import {
  assembleContentAttachment,
  attachContentUnit,
  createContentAttachmentRequest,
} from './content-attachment';
import { createContentAttachmentBodyBlockInput } from './content-attachment-body-blocks';
import { createContentAttachmentOriginInput } from './content-attachment-origins';
import { buildDocumentResourceIndex } from './document-resource-index';

vi.mock('@heripo/shared', () => ({
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

function fixture() {
  const cell = (text: string, isHeader = false, rowSpan = 1, colSpan = 1) => ({
    text,
    isHeader,
    rowSpan,
    colSpan,
  });
  const doc: ProcessedDocument = {
    reportId: 'report',
    pageRangeMap: {},
    chapters: [
      {
        id: 'methods',
        originTitle: 'Methods',
        title: 'Methods',
        level: 1,
        pageNo: 1,
        textBlocks: [
          { id: 'summary', text: 'Features were observed.', pdfPageNo: 1 },
        ],
        imageIds: [],
        tableIds: [],
        footnoteIds: [],
      },
    ],
    images: [],
    footnotes: [],
    tables: [
      {
        id: 'long-origin-table',
        sourceRef: '#/tables/long-source',
        pdfPageNo: 2,
        caption: { fullText: 'Trial inventory' },
        numRows: 3,
        numCols: 3,
        grid: [
          [cell('Trench', true, 2), cell('Surveyed dimensions', true, 1, 2)],
          [cell('3'), cell('2.5'), cell('Pit 1; Ditch')],
          [cell('8'), cell('4.0'), cell('Pit')],
        ],
      },
      {
        id: 'second-long-origin-table',
        pdfPageNo: 3,
        numRows: 1,
        numCols: 1,
        grid: [[cell('Pit')]],
      },
      {
        id: 'unused-long-table',
        pdfPageNo: 4,
        numRows: 1,
        numCols: 1,
        grid: [[cell('Unrelated')]],
      },
    ],
  };
  const index = buildDocumentResourceIndex(doc),
    sources = index.resources
      .filter((r) => r.kind === 'text' || r.kind === 'tableCell')
      .map((resource) => ({
        sourceId: `long-source:${resource.key}`,
        resource,
      }));
  const methods = [{ id: 'methods', originTitle: 'Methods' }],
    survey = [{ id: 'survey', originTitle: 'Trial survey' }];
  const evidence = (key: string, start = 0, end?: number) => {
    const r = sources.find((s) => s.resource.key === key)!.resource;
    const stop = end ?? r.data.text.length;
    return {
      sourceId: `long-source:${key}`,
      resourceKey: key,
      resourceId: r.resourceId,
      sourceRefs: r.sourceRefs,
      pdfPageNo: r.pdfPageNo,
      logicalPageRange: r.logicalPageRange,
      charStart: start,
      charEnd: stop,
      quote: r.data.text.slice(start, stop),
    };
  };
  const specs = [
    ['object-z', 'Pit 1', null, '/tables/0/grid/1/2', 0, 5],
    ['object-a', 'Pit', null, '/tables/0/grid/2/2', 0, 3],
    ['object-b', 'Trench', '3', '/tables/0/grid/1/0', 0, 1],
    ['object-c', 'Pit', null, '/tables/1/grid/0/0', 0, 3],
    ['object-d', 'Ditch', null, '/tables/0/grid/1/2', 7, 12],
  ] as const;
  const plan: ContentAttachmentPlan = {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: 'input',
    candidateSnapshotId: 'snapshot',
    registrySha256: 'registry',
    registryUncertainties: [],
    pages: [],
    registry: specs.map(([ref, name, number, key, start, end]) => ({
      ref,
      groupId: `long-group:${ref}`,
      recordKind: ref === 'object-b' ? 'trench' : 'feature',
      mentions: [
        {
          candidateId: `long-candidate:${ref}`,
          sourceName: name,
          sourceIdentifier: number,
          chapterPath: survey,
          evidence: [evidence(key, start, end)],
        },
      ],
    })),
    units: [
      {
        unitId: 'body',
        pdfPageNo: 1,
        sources: sources.filter((s) => s.resource.kind === 'text'),
        chapters: [{ chapterId: 'methods', path: methods }],
        readOnlyContext: [],
        tables: [],
      },
      {
        unitId: 'tables',
        pdfPageNo: 2,
        sources: sources.filter((s) => s.resource.kind === 'tableCell'),
        chapters: [{ chapterId: 'survey', path: survey }],
        readOnlyContext: [],
        tables: index.resources
          .filter((r) => r.kind === 'table')
          .map((r) => ({ key: r.key, data: r.data })),
      },
    ],
  };
  plan.registry.push({
    ref: 'body-object',
    groupId: 'body-group',
    recordKind: 'area',
    mentions: [
      {
        candidateId: 'body-id',
        sourceName: 'Area',
        sourceIdentifier: null,
        chapterPath: methods,
        evidence: [evidence(sources[0].resource.key)],
      },
    ],
  });
  plan.registry.push({
    ...structuredClone(plan.registry[0]),
    ref: 'outside-object',
    mentions: [
      {
        ...structuredClone(plan.registry[0].mentions[0]),
        candidateId: 'outside-id',
        evidence: [
          {
            ...plan.registry[0].mentions[0].evidence[0],
            resourceKey: '/outside',
          },
        ],
      },
    ],
  });
  return { plan, unit: plan.units[0] };
}

test('shares read-only original rows and merged headers across chapters, binding local counts without interpreting them', () => {
  const { plan, unit } = fixture();
  const alias = structuredClone(plan.registry[0].mentions[0]);
  alias.candidateId = 'another-long-alias';
  plan.registry[0].mentions.push(alias);
  const before = structuredClone(plan),
    legacy = createContentAttachmentBodyBlockInput(plan, unit),
    current = createContentAttachmentOriginInput(plan, unit);
  expect(current.payload.originQuantityScope).toBe('cell_and_row');
  expect(current.payload.originTables).toEqual([
    {
      ref: 'U1',
      contexts: ['C1'],
      caption: 'Trial inventory',
      headers: [
        [0, 0, 'Trench', 2, 1, true],
        [0, 1, 'Surveyed dimensions', 1, 2, true],
      ],
    },
    { ref: 'U2', contexts: ['C1'], caption: null, headers: [] },
  ]);
  expect(current.payload.originRows).toEqual([
    [
      'O1',
      'U1',
      1,
      [
        [0, '3', 1, 1, false],
        [1, '2.5', 1, 1, false],
        [2, 'Pit 1; Ditch', 1, 1, false],
      ],
    ],
    [
      'O2',
      'U1',
      2,
      [
        [0, '8', 1, 1, false],
        [1, '4.0', 1, 1, false],
        [2, 'Pit', 1, 1, false],
      ],
    ],
    ['O3', 'U2', 0, [[0, 'Pit', 1, 1, false]]],
  ]);
  expect(current.payload.originAnchors).toEqual([
    ['object-z', 'O1', 2],
    ['object-a', 'O2', 2],
    ['object-b', 'O1', 0],
    ['object-c', 'O3', 0],
    ['object-d', 'O1', 2],
  ]);
  expect(current.codeMap.originAnchors).toHaveLength(6);
  expect(current.codeMap.originAnchors[0]).toMatchObject({
    candidateRef: 'object-z',
    candidateId: 'long-candidate:object-z',
    rowRef: 'O1',
    column: 2,
    quantityScope: 'cell_and_row',
    evidence: plan.registry[0].mentions[0].evidence[0],
  });
  const {
    originQuantityScope: _scope,
    originTables: _tables,
    originRows: _rows,
    originAnchors: _anchors,
    originRowColumns: _rc,
    originCellColumns: _cc,
    originAnchorColumns: _ac,
    ...oldPayload
  } = current.payload;
  expect(oldPayload).toEqual(legacy.payload);
  expect(current.codeMap.excerpts).toEqual(legacy.codeMap.excerpts);
  for (const hidden of [
    'long-source',
    'long-origin',
    'long-candidate',
    'long-group',
    '/tables/',
    'resourceKey',
    'charStart',
  ])
    expect(JSON.stringify(current.payload)).not.toContain(hidden);
  expect(plan).toEqual(before);
  plan.registry.reverse();
  const reversed = createContentAttachmentOriginInput(plan, unit);
  expect(reversed.payload.originRows).toEqual(current.payload.originRows);
  expect(reversed.payload.originTables).toEqual(current.payload.originTables);
  expect([...reversed.payload.originAnchors].sort()).toEqual(
    [...current.payload.originAnchors].sort(),
  );
  plan.registry = [];
  const empty = createContentAttachmentOriginInput(plan, unit);
  expect(empty.payload.originTables).toEqual([]);
  expect(empty.payload.originRows).toEqual([]);
  expect(empty.payload.originAnchors).toEqual([]);
});

test('rejects broken original cell bindings instead of guessing or correcting source data', () => {
  for (const mutate of [
    (p: ContentAttachmentPlan) => {
      p.registry[0].mentions[0].evidence[0].charStart = 0.5;
    },
    (p: ContentAttachmentPlan) => {
      p.registry[0].mentions[0].evidence[0].charEnd = 1.5;
    },
    (p: ContentAttachmentPlan) => {
      p.registry[0].mentions[0].evidence[0].charStart = -1;
    },
    (p: ContentAttachmentPlan) => {
      p.registry[0].mentions[0].evidence[0].charEnd = 0;
    },
    (p: ContentAttachmentPlan) => {
      p.registry[0].mentions[0].evidence[0].charEnd = 100;
    },
    (p: ContentAttachmentPlan) => {
      p.registry[0].mentions[0].evidence[0].quote = 'Corrected';
    },
    (p: ContentAttachmentPlan) => {
      p.units[1].tables[0].data.grid[1][2].text = 'Changed';
    },
    (p: ContentAttachmentPlan) => {
      p.units[1].tables[0].data.grid = [];
    },
    (p: ContentAttachmentPlan) => {
      p.units[1].tables[0].data.grid[1] = [];
    },
  ]) {
    const { plan, unit } = fixture();
    mutate(plan);
    expect(() => createContentAttachmentOriginInput(plan, unit)).toThrow(
      'differs from original cell',
    );
  }
  const { plan, unit } = fixture();
  plan.units[1].tables = [];
  expect(() => createContentAttachmentOriginInput(plan, unit)).toThrow(
    'table missing',
  );
});

test('sends compact origin context, replays v54 exactly and retains model decisions without filling targets', async () => {
  const { plan, unit } = fixture(),
    current = createContentAttachmentOriginInput(plan, unit),
    legacy = createContentAttachmentBodyBlockInput(plan, unit);
  const output = {
    decisions: {
      E1: {
        status: 'assigned' as const,
        candidateRefs: ['object-a'],
        reason: 'Original model choice',
        unresolved: null,
      },
    },
  };
  vi.mocked(LLMCaller.call).mockResolvedValue({
    output,
    usedFallback: false,
    usage: {
      component: 'test',
      phase: 'test',
      model: 'primary',
      modelName: 'mock',
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    },
  });
  const audit = await attachContentUnit(plan, unit, {
    model: {} as LanguageModel,
    maxRetries: 0,
  });
  expect(
    JSON.parse(vi.mocked(LLMCaller.call).mock.lastCall![0].userPrompt),
  ).toEqual(current.payload);
  expect(audit.codeMap).toEqual(current.codeMap);
  const result = assembleContentAttachment(plan, [audit]);
  expect(result.issues).toEqual([]);
  expect(result.contents.map((c) => c.registryRef)).toEqual(['object-a']);
  const old = {
    ...audit,
    ...createContentAttachmentRequest(plan, unit, 'content-attachment.v54'),
    codeMap: legacy.codeMap,
  };
  expect(JSON.parse(old.userPrompt)).toEqual(legacy.payload);
  expect(assembleContentAttachment(plan, [old])).toEqual(result);
  const v55 = {
    ...audit,
    ...createContentAttachmentRequest(plan, unit, 'content-attachment.v55'),
  };
  expect(v55.userPrompt).toBe(audit.userPrompt);
  expect(audit.systemPrompt.startsWith(v55.systemPrompt)).toBe(true);
  expect(v55.systemPrompt).not.toContain(
    'REGISTRATION CONTEXT IDENTIFIES CANDIDATES',
  );
  expect(audit.systemPrompt).toContain(
    'REGISTRATION CONTEXT IDENTIFIES CANDIDATES',
  );
  expect(audit.systemPrompt).toContain('CURRENT QUALIFIERS FIRST, THEN RETAIN');
  expect(assembleContentAttachment(plan, [v55])).toEqual(result);
  const forged = structuredClone(audit);
  (forged.codeMap as typeof current.codeMap).originRows[0].rowIndex = 99;
  expect(assembleContentAttachment(plan, [forged]).issues[0].reason).toContain(
    'code map',
  );
  const bad = structuredClone(audit);
  bad.rawResponse!.decisions.E1 = {
    status: 'assigned',
    candidateRefs: ['object-a'],
    reason: 'Context ref',
    unresolved: null,
  };
  bad.response.assignments[0].excerptRef = 'O1';
  expect(assembleContentAttachment(plan, [bad]).issues[0].reason).toContain(
    'inconsistent projection',
  );
});
