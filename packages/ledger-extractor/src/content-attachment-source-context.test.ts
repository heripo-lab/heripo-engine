import type { ProcessedDocument } from '@heripo/model';

import type { ContentAttachmentPlan } from './content-attachment';
import type { ContentAttachmentSegmentationAudit } from './content-attachment-segmentation';

import { Output } from 'ai';
import { expect, test, vi } from 'vitest';

import { createContentAttachmentGroundedInput } from './content-attachment-grounding';
import { createContentAttachmentRecipientRequest } from './content-attachment-recipients';
import { createContentAttachmentSegmentationRequest } from './content-attachment-segmentation';
import {
  createContentAttachmentSourceContextRequest,
  resolveContentAttachmentSourceContextRange,
} from './content-attachment-source-context';
import { buildDocumentResourceIndex } from './document-resource-index';

function fixture() {
  const cell = (text: string, isHeader = false) => ({
    text,
    isHeader,
    rowSpan: 1,
    colSpan: 1,
  });
  const headers = () => [
    cell('현장일수', true),
    cell('날짜', true),
    cell('작업내용', true),
  ];
  const document: ProcessedDocument = {
    reportId: 'unrelated-report',
    pageRangeMap: { 4: { startPageNo: -1, endPageNo: -1 } },
    images: [],
    footnotes: [],
    chapters: [
      {
        id: 'methods',
        title: 'Methods',
        originTitle: 'Methods',
        level: 1,
        pageNo: 1,
        imageIds: [],
        footnoteIds: [],
        tableIds: ['before', 'current'],
        textBlocks: [
          { id: 'scope', pdfPageNo: 1, text: '전체 조사범위 30㎡.' },
          { id: 'partial', pdfPageNo: 1, text: '시굴범위 10㎡.' },
          { id: 'heading', pdfPageNo: 2, text: '2) 발굴조사' },
          {
            id: 'definition',
            pdfPageNo: 2,
            text: '발굴조사는 전체 조사범위에서 실시하였다.',
          },
          {
            id: 'method',
            pdfPageNo: 3,
            text: '기록하였다. 조사 완료 후 현황 측량.\n3.5㎝ (미완 😀',
          },
          { id: 'bridge', pdfPageNo: 3, text: '조사 경과는 표9와 같다.' },
          { id: 'later', pdfPageNo: 6, text: '다음 장의 원문.' },
        ],
      },
    ],
    tables: [
      {
        id: 'before',
        pdfPageNo: 3,
        numRows: 2,
        numCols: 3,
        caption: { fullText: '표 9 조사 일지' },
        captionSourceRefs: ['#/texts/9'],
        grid: [headers(), [cell('7'), cell('2월 7일'), cell('준비 작업')]],
      },
      {
        id: 'current',
        pdfPageNo: 4,
        numRows: 3,
        numCols: 3,
        grid: [
          headers(),
          [cell('8'), cell('2월 8일'), cell('진행 작업')],
          [cell('9'), cell('2월 9일'), cell('현황 측량')],
        ],
      },
    ],
  };
  const index = buildDocumentResourceIndex(document);
  const selected = index.resources
    .filter((r) => r.kind === 'text' || r.kind === 'tableCell')
    .map((resource) => ({ sourceId: 'source:' + resource.key, resource }));
  const path = [{ id: 'methods', originTitle: 'Methods' }];
  const scope = selected.find(
    (s) => s.resource.key === '/chapters/0/textBlocks/0',
  )!;
  const plan: ContentAttachmentPlan = {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: 'source-hash',
    candidateSnapshotId: 'frozen-registry',
    registrySha256: 'registry-hash',
    registryUncertainties: [],
    pages: [],
    registry: [
      {
        ref: 'R1',
        groupId: 'long-area-group',
        recordKind: 'area',
        mentions: [
          {
            candidateId: 'long-area-mention',
            sourceName: '조사범위',
            sourceIdentifier: null,
            chapterPath: path,
            evidence: [
              {
                sourceId: scope.sourceId,
                resourceKey: scope.resource.key,
                resourceId: scope.resource.resourceId,
                sourceRefs: scope.resource.sourceRefs,
                pdfPageNo: 1,
                logicalPageRange: null,
                charStart: 0,
                charEnd: scope.resource.data.text.length,
                quote: scope.resource.data.text,
              },
            ],
          },
        ],
      },
    ],
    units: [1, 2, 3, 4, 6].map((page) => ({
      unitId: 'page-' + page,
      pdfPageNo: page,
      sources: selected.filter((s) => s.resource.pdfPageNo === page),
      chapters: [{ chapterId: 'methods', path }],
      tables: index.resources
        .filter((r) => r.kind === 'table')
        .filter((r) => r.pdfPageNo === page)
        .map((r) => ({ key: r.key, data: r.data })),
      readOnlyContext: [],
    })),
  };
  const unit = plan.units.find((u) => u.pdfPageNo === 4)!;
  unit.readOnlyContext = [0, 1, 2, 3].map((i) => ({
    resourceKey: `/chapters/0/textBlocks/${i}`,
    text: document.chapters[0].textBlocks[i].text,
  }));
  const segment = (
    target = unit,
    key = '/tables/1/grid/2/2',
    excerptIndex = 0,
  ) => {
    const input = createContentAttachmentGroundedInput(plan, target);
    const excerpt = input.codeMap.excerpts.filter(
      (e) => e.evidence[0].resourceKey === key,
    )[excerptIndex];
    const request = createContentAttachmentSegmentationRequest(input, [
      excerpt.ref,
    ]);
    const source = request.wordEvidence.sources.find(
      (s) => s.ref === excerpt.ref,
    )!;
    return {
      ...request,
      rawResponse: {
        segments: {
          [excerpt.ref]: [
            { wordRanges: [`${excerpt.ref}:W1-W${source.words.length}`] },
          ],
        },
      },
      usage: {} as never,
      callAttempts: [],
    } satisfies ContentAttachmentSegmentationAudit;
  };
  const pair = {
    precedingTableKey: '/tables/0',
    followingTableKey: '/tables/1',
    boundaryCellIndexes: [0, 1],
  };
  return { plan, unit, pair, segment };
}

const payload = (
  request: ReturnType<typeof createContentAttachmentSourceContextRequest>,
) => JSON.parse(request.userPrompt);

test('keeps frozen requests and IDs while exposing native order, gaps and original table positions', async () => {
  const { plan, unit, pair, segment } = fixture();
  const segmentation = segment();
  const before = JSON.stringify({ plan, segmentation });
  const input = createContentAttachmentGroundedInput(plan, unit);
  const legacy = createContentAttachmentRecipientRequest(
    input,
    segmentation,
    'segment-recipients.v25',
  );
  const noNetwork = vi.fn(() => {
    throw new Error('Network is forbidden');
  });
  vi.stubGlobal('fetch', noNetwork);
  const request = createContentAttachmentSourceContextRequest(
    plan,
    unit,
    segmentation,
    { tablePairs: [pair] },
  );
  const p = payload(request),
    old = JSON.parse(legacy.userPrompt);
  expect(request.contextVersion).toBe('content-source-context.v1');
  expect(request.version).toBe('segment-recipients.v25');
  expect(request.systemPrompt).toBe(legacy.systemPrompt);
  expect(
    await Output.object({ schema: request.schema }).responseFormat,
  ).toEqual(await Output.object({ schema: legacy.schema }).responseFormat);
  expect(p.registry).toEqual(old.registry);
  expect(p.current).toEqual(old.current);
  expect(p.workGroups).toEqual(old.workGroups);
  expect(p.sourceContext.tables[0]).toEqual(old.sourceContext.tables[0]);
  expect(p.sourceContext.tables[0].caption).toBeNull();
  expect(p.sourceContext.tables[1].caption).toBe('표 9 조사 일지');
  for (const s of old.sourceContext.sources) {
    expect(
      p.sourceContext.sources.find((v: { ref: string }) => v.ref === s.ref),
    ).toMatchObject(s);
  }
  expect(
    request.wordEvidence.sources.slice(
      0,
      segmentation.wordEvidence.sources.length,
    ),
  ).toEqual(segmentation.wordEvidence.sources);
  const bodyOrder = p.sourceContext.bodySequences[0].sources.map(
    (ref: string) =>
      p.sourceContext.sources.find((s: { ref: string }) => s.ref === ref)
        .blockIndex,
  );
  expect(bodyOrder).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(p.sourceContext.bodySequences[0].complete).toBe(false);
  expect(p.sourceContext.tableContinuationCandidates[0]).toMatchObject({
    tables: ['T2', 'T1'],
    judgment: 'not_evaluated',
    facts: {
      adjacentPdfPages: true,
      sameOriginalChapter: true,
      headerCellsAndSpansEqual: true,
    },
    sourceDeclaredContinuation: false,
  });
  for (const name of ['preceding', 'following']) {
    const refs =
      p.sourceContext.tableContinuationCandidates[0].boundaryCells[name];
    expect(refs).toHaveLength(2);
    expect(
      refs.map(
        (ref: string) =>
          resolveContentAttachmentSourceContextRange(
            request,
            ref + ':W1-W1',
            p.current[0].ref,
          ).text,
      ),
    ).toEqual(name === 'preceding' ? ['7', '2월'] : ['8', '2월']);
  }
  const caption = request.wordEvidence.sources.find((s) =>
    s.resourceKey.endsWith('/caption'),
  )!;
  expect(
    resolveContentAttachmentSourceContextRange(
      request,
      caption.ref + ':W1-W4',
      p.current[0].ref,
    ),
  ).toMatchObject({
    text: '표 9 조사 일지',
    field: 'fullText',
    basis: 'context',
    resourceKey: '/tables/0/caption',
  });
  expect(request.contextBindings.headers[0].rowSpan).toBe(1);
  expect(
    request.contextBindings.sources.find(
      (b) => b.resourceKey === '/tables/1/grid/1/0',
    )!.logicalPageRange,
  ).toEqual({ startPageNo: -1, endPageNo: -1 });
  expect(JSON.stringify({ plan, segmentation })).toBe(before);
  expect(
    createContentAttachmentRecipientRequest(
      input,
      segmentation,
      'segment-recipients.v25',
    ).userPrompt,
  ).toBe(legacy.userPrompt);
  expect(noNetwork).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test('keeps body gaps, UTF-16 offsets and incomplete source fragments without stage inference', () => {
  const { plan, unit, segment } = fixture();
  unit.readOnlyContext = unit.readOnlyContext.slice(2);
  const request = createContentAttachmentSourceContextRequest(
    plan,
    unit,
    segment(),
  );
  const p = payload(request);
  expect(
    p.sourceContext.bodySequences[0].sources.map(
      (ref: string) =>
        p.sourceContext.sources.find((s: { ref: string }) => s.ref === ref)
          .blockIndex,
    ),
  ).toEqual([2, 3, 4, 5, 6]);
  const s = request.wordEvidence.sources.find((s) => s.text.includes('😀'))!;
  expect(
    resolveContentAttachmentSourceContextRange(
      request,
      `${s.ref}:W${s.words.length}-W${s.words.length}`,
      p.current[0].ref,
    ).text,
  ).toBe('😀');
  expect(p.sourceContext.tableContinuationCandidates).toEqual([]);
  expect(request.userPrompt).not.toContain('investigationStage');
  expect(request.userPrompt).not.toContain('/chapters/');
  expect(request.userPrompt).not.toContain('/tables/');
  const currentUnit = plan.units.find((u) => u.pdfPageNo === 3)!;
  const second = segment(currentUnit, '/chapters/0/textBlocks/4', 1);
  const current = createContentAttachmentSourceContextRequest(
    plan,
    currentUnit,
    second,
  );
  const word = current.wordEvidence.sources.find(
    (s) => s.ref === second.excerptRefs[0],
  )!;
  const bound = resolveContentAttachmentSourceContextRange(
    current,
    word.ref + ':W1-W1',
    word.ref,
  );
  expect(bound.basis).toBe('direct');
  expect(bound.charStart).toBeGreaterThan(0);
  const source = currentUnit.sources.find(
    (s) => s.resource.key === bound.resourceKey,
  )!;
  expect(source.resource.data.text.slice(bound.charStart, bound.charEnd)).toBe(
    bound.text,
  );
});

test('deduplicates selected boundary sources and keeps empty or absent captions literal', () => {
  const { plan, unit, pair, segment } = fixture();
  const key = '/tables/0/grid/1/0';
  unit.readOnlyContext.push({ resourceKey: key, text: '7' });
  plan.units.find((u) => u.pdfPageNo === 3)!.tables[0].data.caption = {
    fullText: '',
  };
  delete plan.units.find((u) => u.pdfPageNo === 3)!.tables[0].data
    .captionSourceRefs;
  plan.units.find((u) => u.pdfPageNo === 3)!.tables[0].data.sourceRef =
    '#/tables/0';
  const request = createContentAttachmentSourceContextRequest(
    plan,
    unit,
    segment(),
    { tablePairs: [pair] },
  );
  expect(
    request.wordEvidence.sources.filter((s) => s.resourceKey === key),
  ).toHaveLength(1);
  expect(payload(request).sourceContext.tables[1].caption).toBe('');
  expect(
    request.wordEvidence.sources.find((s) =>
      s.resourceKey.endsWith('/caption'),
    )!.words,
  ).toEqual([]);
  const noCaption = fixture();
  delete noCaption.plan.units.find((u) => u.pdfPageNo === 3)!.tables[0].data
    .caption;
  const without = createContentAttachmentSourceContextRequest(
    noCaption.plan,
    noCaption.unit,
    noCaption.segment(),
    { tablePairs: [noCaption.pair] },
  );
  expect(payload(without).sourceContext.tables[1].caption).toBeNull();
  expect(
    without.wordEvidence.sources.some((s) =>
      s.resourceKey.endsWith('/caption'),
    ),
  ).toBe(false);
});

test('exposes comparison counterexamples without converting them into semantic continuation judgments', () => {
  const { plan, unit, pair, segment } = fixture();
  const previous = plan.units.find((u) => u.pdfPageNo === 3)!.tables[0];
  previous.data.pdfPageNo = 1;
  previous.data.grid[0][0].colSpan = 2;
  for (const u of plan.units)
    for (const s of u.sources)
      if (
        s.resource.kind === 'tableCell' &&
        s.resource.tableId === previous.data.id
      )
        s.resource.chapterIds = [];
  const r = createContentAttachmentSourceContextRequest(plan, unit, segment(), {
    tablePairs: [pair],
  });
  expect(payload(r).sourceContext.tableContinuationCandidates[0]).toMatchObject(
    {
      judgment: 'not_evaluated',
      facts: {
        adjacentPdfPages: false,
        sameOriginalChapter: false,
        headerCellsAndSpansEqual: false,
      },
    },
  );
});

test('handles header-only or empty tables without inventing data rows or positive header matches', () => {
  const { plan, unit, pair, segment } = fixture();
  const previous = plan.units.find((u) => u.pdfPageNo === 3)!.tables[0];
  previous.data.grid = [];
  const r = createContentAttachmentSourceContextRequest(plan, unit, segment(), {
    tablePairs: [pair],
  });
  expect(
    payload(r).sourceContext.tableContinuationCandidates[0].boundaryCells
      .preceding,
  ).toEqual([]);
  expect(
    payload(r).sourceContext.tableContinuationCandidates[0].facts
      .headerCellsAndSpansEqual,
  ).toBe(false);
});

for (const [label, change] of [
  [
    'same table',
    (p: ReturnType<typeof fixture>['pair']) => ({
      ...p,
      precedingTableKey: p.followingTableKey,
    }),
  ],
  [
    'unknown table',
    (p: ReturnType<typeof fixture>['pair']) => ({
      ...p,
      precedingTableKey: '/tables/missing',
    }),
  ],
  [
    'negative cell index',
    (p: ReturnType<typeof fixture>['pair']) => ({
      ...p,
      boundaryCellIndexes: [-1],
    }),
  ],
  [
    'fractional cell index',
    (p: ReturnType<typeof fixture>['pair']) => ({
      ...p,
      boundaryCellIndexes: [0.5],
    }),
  ],
  [
    'repeated cell index',
    (p: ReturnType<typeof fixture>['pair']) => ({
      ...p,
      boundaryCellIndexes: [0, 0],
    }),
  ],
  [
    'missing native cell',
    (p: ReturnType<typeof fixture>['pair']) => ({
      ...p,
      boundaryCellIndexes: [99],
    }),
  ],
] as const)
  test(`rejects ${label} without repairing the pair or source`, () => {
    const f = fixture();
    expect(() =>
      createContentAttachmentSourceContextRequest(f.plan, f.unit, f.segment(), {
        tablePairs: [change(f.pair)],
      }),
    ).toThrow();
  });

test('rejects repeated table pairs', () => {
  const f = fixture();
  expect(() =>
    createContentAttachmentSourceContextRequest(f.plan, f.unit, f.segment(), {
      tablePairs: [f.pair, f.pair],
    }),
  ).toThrow('duplicate table context pair');
});

test('rejects unknown or rewritten read-only source text and invalid body positions', () => {
  const missing = fixture();
  missing.unit.readOnlyContext.push({
    resourceKey: '/missing',
    text: 'missing',
  });
  expect(() =>
    createContentAttachmentSourceContextRequest(
      missing.plan,
      missing.unit,
      missing.segment(),
    ),
  ).toThrow('Unknown original context source');
  const rewritten = fixture();
  rewritten.unit.readOnlyContext[0].text += ' rewritten';
  expect(() =>
    createContentAttachmentSourceContextRequest(
      rewritten.plan,
      rewritten.unit,
      rewritten.segment(),
    ),
  ).toThrow('differs from original text');
  const badPosition = fixture();
  badPosition.plan.units.find(
    (u) => u.pdfPageNo === 6,
  )!.sources[0].resource.key = '/invalid-position';
  expect(() =>
    createContentAttachmentSourceContextRequest(
      badPosition.plan,
      badPosition.unit,
      badPosition.segment(),
    ),
  ).toThrow('Invalid original body array position');
});

test('rejects a read-only cell whose plan resource disagrees with its native grid', () => {
  const f = fixture();
  const cell = f.unit.sources.find(
    (s) => s.resource.key === '/tables/1/grid/1/1',
  )!;
  if (cell.resource.kind !== 'tableCell')
    throw new Error('Expected fixture cell');
  cell.resource = {
    ...cell.resource,
    data: { ...cell.resource.data, text: 'different' },
  };
  f.unit.readOnlyContext.push({
    resourceKey: cell.resource.key,
    text: 'different',
  });
  expect(() =>
    createContentAttachmentSourceContextRequest(f.plan, f.unit, f.segment()),
  ).toThrow('Context cell differs from original table');
});

test('rejects invalid ranges and modified context bindings instead of correcting them', () => {
  const f = fixture();
  const r = createContentAttachmentSourceContextRequest(
    f.plan,
    f.unit,
    f.segment(),
    { tablePairs: [f.pair] },
  );
  const binding = r.contextBindings.sources.find(
    (s) => s.field === 'fullText',
  )!;
  expect(() =>
    resolveContentAttachmentSourceContextRange(r, 'X999:W1-W1', 'E1'),
  ).toThrow('Unknown');
  const oldKey = binding.resourceKey;
  binding.resourceKey = '/different';
  expect(() =>
    resolveContentAttachmentSourceContextRange(r, binding.ref + ':W1-W1', 'E1'),
  ).toThrow('differs from original binding');
  binding.resourceKey = oldKey;
  binding.text = 'modified';
  expect(() =>
    resolveContentAttachmentSourceContextRange(r, binding.ref + ':W1-W1', 'E1'),
  ).toThrow('differs from original binding');
  r.contextBindings.sources = r.contextBindings.sources.filter(
    (b) => b.ref !== binding.ref,
  );
  expect(() =>
    resolveContentAttachmentSourceContextRange(r, binding.ref + ':W1-W1', 'E1'),
  ).toThrow('differs from original binding');
});

test('exposes a same-page context table that was absent from the selected table cards', () => {
  const f = fixture();
  const previousUnit = f.plan.units.find((u) => u.pdfPageNo === 3)!;
  f.unit.tables.push(previousUnit.tables[0]);
  f.unit.readOnlyContext.push({ resourceKey: '/tables/0/grid/1/0', text: '7' });
  const r = createContentAttachmentSourceContextRequest(
    f.plan,
    f.unit,
    f.segment(),
  );
  expect(
    payload(r).sourceContext.tables.map((t: { ref: string }) => t.ref),
  ).toEqual(['T1', 'T2']);
  expect(payload(r).sourceContext.tables[1].caption).toBe('표 9 조사 일지');
});

test('rejects selected cells and missing native grids that disagree with the resource snapshot', () => {
  for (const missingTable of [false, true]) {
    const f = fixture();
    const source = f.unit.sources.find(
      (s) => s.resource.key === '/tables/1/grid/2/2',
    )!;
    if (source.resource.kind !== 'tableCell')
      throw new Error('Expected fixture cell');
    if (missingTable) {
      const readOnly = f.plan.units
        .find((u) => u.pdfPageNo === 3)!
        .sources.find((s) => s.resource.key === '/tables/0/grid/1/1')!;
      if (readOnly.resource.kind !== 'tableCell')
        throw new Error('Expected fixture cell');
      readOnly.resource = {
        ...readOnly.resource,
        tableId: 'not-a-native-table',
      };
      f.unit.readOnlyContext.push({
        resourceKey: readOnly.resource.key,
        text: readOnly.resource.data.text,
      });
    } else
      source.resource = {
        ...source.resource,
        data: { ...source.resource.data, text: 'not the grid text' },
      };
    expect(() =>
      createContentAttachmentSourceContextRequest(f.plan, f.unit, f.segment()),
    ).toThrow('Context cell differs from original table');
  }
});

test('rejects read-only cells whose native row or cell disappeared', () => {
  for (const missingRow of [false, true]) {
    const f = fixture();
    const previous = f.plan.units.find((u) => u.pdfPageNo === 3)!;
    f.unit.readOnlyContext.push({
      resourceKey: '/tables/0/grid/1/1',
      text: '2월 7일',
    });
    if (missingRow) previous.tables[0].data.grid = [];
    else previous.tables[0].data.grid[1] = [];
    expect(() =>
      createContentAttachmentSourceContextRequest(f.plan, f.unit, f.segment()),
    ).toThrow('Context cell differs from original table');
  }
});

test('compares original header fields without depending on object key serialization order', () => {
  const f = fixture();
  const previous = f.plan.units.find((u) => u.pdfPageNo === 3)!.tables[0];
  previous.data.grid[0] = previous.data.grid[0].map((c) => ({
    colSpan: c.colSpan,
    rowSpan: c.rowSpan,
    isHeader: c.isHeader,
    text: c.text,
  }));
  const r = createContentAttachmentSourceContextRequest(
    f.plan,
    f.unit,
    f.segment(),
    { tablePairs: [f.pair] },
  );
  expect(
    payload(r).sourceContext.tableContinuationCandidates[0].facts
      .headerCellsAndSpansEqual,
  ).toBe(true);
});
