import type { ProcessedDocument } from '@heripo/model';
import type { LanguageModel } from 'ai';

import type { CandidateDeduplicationResult } from './candidate-deduplication';
import type { CandidateDiscoveryResult } from './candidate-discovery';
import type {
  ContentAttachmentAudit,
  ContentAttachmentResponse,
} from './content-attachment';

import { LLMCaller } from '@heripo/shared';
import { describe, expect, test, vi } from 'vitest';

import { prepareCandidateDiscovery } from './candidate-discovery';
import {
  assembleContentAttachment,
  attachContentUnit,
  createContentAttachmentRequest,
  prepareContentAttachment,
} from './content-attachment';
import { buildDocumentResourceIndex } from './document-resource-index';

vi.mock('@heripo/shared', () => ({ LLMCaller: { call: vi.fn() } }));
const usage = {
  component: 'test',
  phase: 'test',
  model: 'primary' as const,
  modelName: 'mock',
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
};
function fixture() {
  const doc: ProcessedDocument = {
    reportId: 'report',
    pageRangeMap: {
      1: { startPageNo: -1, endPageNo: -1 },
      2: { startPageNo: 0, endPageNo: 0 },
      3: { startPageNo: 1, endPageNo: 1 },
    },
    chapters: [
      {
        id: 'ch',
        originTitle: '調査',
        title: '調査',
        level: 1,
        pageNo: 1,
        textBlocks: [
          { id: 'cover', text: '報告書', pdfPageNo: 2 },
          {
            id: 'a',
            text: '井戸と廃棄層。',
            sourceRef: '#/texts/1',
            pdfPageNo: 3,
          },
          { id: 'b', text: '井戸と廃棄層。', pdfPageNo: 4 },
          { id: 'c', text: '前半の文は切れ', pdfPageNo: 4 },
          { id: 'd', text: 'たまま。', pdfPageNo: 4 },
          { id: 'repeated', text: '同文。同文。', pdfPageNo: 4 },
        ],
        imageIds: [],
        tableIds: ['table'],
        footnoteIds: [],
      },
    ],
    images: [],
    footnotes: [],
    tables: [
      {
        id: 'table',
        pdfPageNo: 3,
        numRows: 2,
        numCols: 3,
        grid: [
          [
            { text: '番号', rowSpan: 2, colSpan: 1, isHeader: true },
            { text: '寸法', rowSpan: 1, colSpan: 2, isHeader: true },
          ],
          [
            { text: '7', rowSpan: 1, colSpan: 1, isHeader: false },
            { text: '20', rowSpan: 1, colSpan: 1, isHeader: false },
            { text: '', rowSpan: 1, colSpan: 1, isHeader: false },
          ],
        ],
      },
    ],
  };
  const index = buildDocumentResourceIndex(doc);
  const dp = prepareCandidateDiscovery(index, {
    scopeChapterId: 'ch',
    inputSha256: 'hash',
    maxTextChars: 8000,
    tableRowsPerUnit: 12,
  });
  const evidence = {
    sourceId: 'id:a',
    resourceKey: '/chapters/0/textBlocks/1',
    resourceId: 'a',
    sourceRefs: ['#/texts/1'],
    pdfPageNo: 3,
    logicalPageRange: { startPageNo: 1, endPageNo: 1 },
    quote: '井戸と廃棄層。',
    charStart: 0,
    charEnd: 7,
  };
  const discovery: CandidateDiscoveryResult = {
    version: 'ledger-object-candidates.v1',
    inputSha256: 'hash',
    scopeChapterId: 'ch',
    scopeTitle: '調査',
    candidates: ['one', 'two'].map((id) => ({
      candidateId: id,
      status: 'proposed',
      recordKind: 'layer',
      sourceName: '廃棄層',
      sourceIdentifier: null,
      eligibilityBasis: 'explicit_context_unit',
      reason: '原文',
      chapterId: 'ch',
      unitIds: [dp.units[0].unitId],
      evidence: [evidence],
    })),
    issues: [],
    exclusions: [],
    completedUnitIds: dp.units.map((u) => u.unitId),
    totalUnits: dp.units.length,
    inspectedResourceCount: index.resources.length,
  };
  const groups: CandidateDeduplicationResult = {
    version: 'ledger-candidate-groups.v1',
    groups: [
      {
        groupId: 'g1',
        status: 'proposed',
        memberCandidateIds: ['one'],
        reason: '原文',
      },
      {
        groupId: 'g2',
        status: 'proposed',
        memberCandidateIds: ['two'],
        reason: '原文',
      },
    ],
    issues: [],
    uncertainMatches: [
      { leftCandidateId: 'one', rightCandidateId: 'two', reason: '未確定' },
    ],
  };
  const options = {
    inputSha256: 'hash',
    candidateSnapshotId: 'snapshot',
    pdfPageNumbers: [1, 2, 3, 4, 5],
    maxUnitChars: 8000,
  };
  return { doc, index, dp, discovery, groups, options };
}
const prepare = async () => {
  const f = fixture();
  return prepareContentAttachment(
    f.index,
    f.dp,
    f.discovery,
    f.groups,
    f.options,
  );
};
const empty = (): ContentAttachmentResponse => ({
  assignments: [],
  unresolved: [],
  ignoredSources: [],
});
const audit = (
  plan: Awaited<ReturnType<typeof prepare>>,
  i: number,
  response: ContentAttachmentResponse,
): ContentAttachmentAudit => ({
  unitId: plan.units[i].unitId,
  ...createContentAttachmentRequest(plan, plan.units[i]),
  response,
  usage,
});
const ignore = (plan: Awaited<ReturnType<typeof prepare>>, i: number) =>
  plan.units[i].sources.map((s) => ({
    sourceId: s.sourceId,
    reason: '対象外',
  }));

describe('bounded content attachment', () => {
  test('plans from the first physical page, retains gaps, whole table rows, original spans and signed logical pages without mutating inputs', async () => {
    const f = fixture(),
      before = structuredClone(f);
    const p = await prepareContentAttachment(
      f.index,
      f.dp,
      f.discovery,
      f.groups,
      { ...f.options, maxUnitChars: 1 },
    );
    expect(f).toEqual(before);
    expect(p.pages[0]).toEqual({
      pdfPageNo: 1,
      unitIds: [],
      status: 'no_body_or_table_text',
    });
    expect(p.pages.at(-1)?.pdfPageNo).toBe(5);
    expect(p.units[0].pdfPageNo).toBe(2);
    expect(p.units[0].sources[0].resource.logicalPageRange).toEqual({
      startPageNo: 0,
      endPageNo: 0,
    });
    expect(
      p.units.find((u) =>
        u.sources.some(
          (s) => s.resource.kind === 'tableCell' && s.resource.rowIndex === 1,
        ),
      )?.sources,
    ).toHaveLength(3);
    expect(p.units.find((u) => u.tables.length)?.tables[0].data.grid).toEqual(
      f.doc.tables[0].grid,
    );
    expect(p.registryUncertainties).toEqual(f.groups.uncertainMatches);
    expect(p.registrySha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await prepare()).registrySha256).toBe(p.registrySha256);
    const nested = fixture();
    nested.doc.chapters = [
      {
        ...nested.doc.chapters[0],
        id: 'parent',
        textBlocks: [],
        tableIds: [],
        children: nested.doc.chapters,
      },
    ];
    nested.index = buildDocumentResourceIndex(nested.doc);
    nested.dp = prepareCandidateDiscovery(nested.index, {
      scopeChapterId: 'ch',
      inputSha256: 'hash',
      maxTextChars: 8000,
      tableRowsPerUnit: 12,
    });
    nested.discovery.completedUnitIds = nested.dp.units.map((u) => u.unitId);
    nested.discovery.candidates.forEach((c) => {
      c.unitIds = [nested.dp.units[0].unitId];
      c.evidence[0].resourceKey = '/chapters/0/children/0/textBlocks/1';
    });
    expect(
      (
        await prepareContentAttachment(
          nested.index,
          nested.dp,
          nested.discovery,
          nested.groups,
          nested.options,
        )
      ).units[0].chapters[0].path.map((c) => c.id),
    ).toEqual(['parent', 'ch']);
    const noPages = fixture();
    noPages.index.resources = [];
    noPages.discovery.candidates.forEach((c) => {
      c.evidence = [];
    });
    expect(
      (
        await prepareContentAttachment(
          noPages.index,
          noPages.dp,
          noPages.discovery,
          noPages.groups,
          { ...noPages.options, pdfPageNumbers: [] },
        )
      ).pages,
    ).toEqual([]);
  });
  test('rejects incomplete, inconsistent or malformed snapshots and unlocated physical sources', async () => {
    for (const change of [
      (f: ReturnType<typeof fixture>) => {
        f.options.inputSha256 = 'other';
      },
      (f: ReturnType<typeof fixture>) => {
        f.options.candidateSnapshotId = '';
      },
      (f: ReturnType<typeof fixture>) => {
        f.options.maxUnitChars = 0;
      },
      (f: ReturnType<typeof fixture>) => {
        f.options.maxUnitChars = 1.5;
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.issues = ['invalid'];
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.groups = [];
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.groups[0].memberCandidateIds = [];
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.groups[0].memberCandidateIds = ['missing'];
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.groups[0].memberCandidateIds = ['one', 'one'];
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.groups.pop();
        f.groups.uncertainMatches = [];
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.groups[1].groupId = 'g1';
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.uncertainMatches[0].leftCandidateId = 'missing';
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.uncertainMatches[0].rightCandidateId = 'missing';
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.groups[0].memberCandidateIds.push('two');
        f.groups.groups.pop();
      },
      (f: ReturnType<typeof fixture>) => {
        f.discovery.candidates[0].recordKind = 'feature';
        f.groups.groups[0].memberCandidateIds.push('two');
        f.groups.groups.pop();
      },
      (f: ReturnType<typeof fixture>) => {
        f.discovery.candidates[0].evidence[0].quote = '不存在';
      },
      (f: ReturnType<typeof fixture>) => {
        f.discovery.candidates[0].evidence[0].resourceKey = '/missing';
      },
      (f: ReturnType<typeof fixture>) => {
        f.discovery.candidates[0].evidence[0].resourceKey = '/chapters/0';
      },
      (f: ReturnType<typeof fixture>) => {
        f.options.pdfPageNumbers = [0];
      },
      (f: ReturnType<typeof fixture>) => {
        f.index.resources.find((r) => r.kind === 'text')!.pdfPageNo = null;
      },
      (f: ReturnType<typeof fixture>) => {
        f.discovery.completedUnitIds = [];
      },
    ]) {
      const f = fixture();
      change(f);
      await expect(
        prepareContentAttachment(
          f.index,
          f.dp,
          f.discovery,
          f.groups,
          f.options,
        ),
      ).rejects.toThrow();
    }
  });
  test('attaches a sentence to multiple candidates, retains all exact occurrences and separates unchanged table cells and split block fragments', async () => {
    const p = await prepare();
    const source = (i: number, id: string) =>
      p.units[i].sources.find((s) => s.resource.resourceId === id)!.sourceId;
    const a = audit(p, 1, {
      assignments: [
        {
          candidateRefs: ['R1', 'R2'],
          fragments: [{ sourceId: source(1, 'a'), quote: '井戸と廃棄層。' }],
          reason: '共有',
        },
        {
          candidateRefs: ['R1'],
          fragments: p.units[1].sources
            .filter(
              (s) =>
                s.resource.kind === 'tableCell' &&
                s.resource.rowIndex === 1 &&
                s.resource.columnIndex < 2,
            )
            .map((s) => ({
              sourceId: s.sourceId,
              quote: s.resource.data.text,
            })),
          reason: '表項目',
        },
      ],
      unresolved: [],
      ignoredSources: p.units[1].sources
        .filter(
          (s) =>
            s.resource.kind === 'tableCell' &&
            (s.resource.rowIndex === 0 || s.resource.columnIndex === 2),
        )
        .map((s) => ({ sourceId: s.sourceId, reason: '見出しまたは空欄' })),
    });
    const b = audit(p, 2, {
      assignments: [
        {
          candidateRefs: ['R1'],
          fragments: [{ sourceId: source(2, 'b'), quote: '井戸と廃棄層。' }],
          reason: '共有',
        },
        {
          candidateRefs: ['R1'],
          fragments: [{ sourceId: source(2, 'b'), quote: '井戸と廃棄層。' }],
          reason: '共有',
        },
        {
          candidateRefs: ['R1'],
          fragments: [
            { sourceId: source(2, 'c'), quote: '前半の文は切れ' },
            { sourceId: source(2, 'd'), quote: 'たまま。' },
          ],
          reason: '分割原文',
        },
      ],
      unresolved: [
        {
          candidateRefs: [],
          fragments: [
            { sourceId: source(2, 'repeated'), quote: '同文。同文。' },
          ],
          reason: '対応不明',
        },
      ],
      ignoredSources: [],
    });
    const before = structuredClone([p, a, b]);
    const result = assembleContentAttachment(p, [a, b]);
    expect(result.issues).toEqual([]);
    expect(result.completedUnitIds).toHaveLength(2);
    expect(result.totalUnits).toBe(3);
    expect(result.reviewStatus).toBe('not_reviewed');
    expect(result.contents[0].excerpts[0].occurrences).toHaveLength(2);
    expect(result.contents[0].excerpts[1]).toMatchObject({
      kind: 'table_item',
      fragments: ['7', '20'],
    });
    expect(result.contents[1].excerpts).toHaveLength(1);
    expect(result.unresolved[0].candidateRefs).toEqual([]);
    expect([p, a, b]).toEqual(before);
  });
  test('keeps invalid selectors, quotes, ambiguous locations, fragment order and unaccounted sources visible without repair', async () => {
    const p = await prepare();
    const source = p.units[2].sources[0].sourceId;
    const f = { sourceId: source, quote: '井戸と廃棄層。' };
    for (const item of [
      { candidateRefs: ['outside'], fragments: [f], reason: 'x' },
      { candidateRefs: ['R1', 'R1'], fragments: [f], reason: 'x' },
      {
        candidateRefs: ['R1'],
        fragments: [{ ...f, sourceId: 'outside' }],
        reason: 'x',
      },
      {
        candidateRefs: ['R1'],
        fragments: [{ ...f, quote: '修正原文' }],
        reason: 'x',
      },
      { candidateRefs: ['R1'], fragments: [f, f], reason: 'x' },
      {
        candidateRefs: ['R1'],
        fragments: [
          { sourceId: p.units[2].sources.at(-1)!.sourceId, quote: '同文。' },
        ],
        reason: 'x',
      },
      {
        candidateRefs: ['R1'],
        fragments: [
          { sourceId: p.units[2].sources[2].sourceId, quote: 'たまま。' },
          { sourceId: p.units[2].sources[1].sourceId, quote: '前半の文は切れ' },
        ],
        reason: 'x',
      },
    ]) {
      const raw = audit(p, 2, { ...empty(), assignments: [item] });
      const before = structuredClone(raw);
      const result = assembleContentAttachment(p, [raw]);
      expect(result.contents).toEqual([]);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.completedUnitIds).toEqual([]);
      expect(raw).toEqual(before);
    }
    const mixed = audit(p, 1, {
      ...empty(),
      assignments: [
        {
          candidateRefs: ['R1'],
          fragments: [
            {
              sourceId: p.units[1].sources[0].sourceId,
              quote: '井戸と廃棄層。',
            },
            { sourceId: p.units[1].sources[1].sourceId, quote: '番号' },
          ],
          reason: 'x',
        },
      ],
    });
    expect(assembleContentAttachment(p, [mixed]).issues[0].reason).toContain(
      'fragments',
    );
    const badTable = structuredClone(p);
    const other = badTable.units[1].sources[2].resource;
    if (other.kind === 'tableCell') other.tableId = 'other';
    const raw = audit(badTable, 1, {
      ...empty(),
      assignments: [
        {
          candidateRefs: ['R1'],
          fragments: badTable.units[1].sources.slice(1, 3).map((s) => ({
            sourceId: s.sourceId,
            quote: s.resource.data.text,
          })),
          reason: 'x',
        },
      ],
    });
    expect(assembleContentAttachment(badTable, [raw]).contents).toEqual([]);
  });
  test('requires exact audit bindings, source coverage and non-conflicting ignore decisions', async () => {
    const p = await prepare();
    const a = audit(p, 0, { ...empty(), ignoredSources: ignore(p, 0) });
    expect(assembleContentAttachment(p, [a, a]).issues[0].reason).toContain(
      'repeated',
    );
    for (const change of [
      { unitId: 'missing' },
      { promptVersion: 'other' },
      { systemPrompt: 'other' },
      { userPrompt: 'other' },
      { response: null },
    ])
      expect(
        assembleContentAttachment(p, [
          { ...a, ...change } as ContentAttachmentAudit,
        ]).issues,
      ).not.toEqual([]);
    const source = p.units[0].sources[0];
    const conflict = audit(p, 0, {
      assignments: [
        {
          candidateRefs: ['R1'],
          fragments: [
            { sourceId: source.sourceId, quote: source.resource.data.text },
          ],
          reason: 'x',
        },
      ],
      unresolved: [],
      ignoredSources: [...ignore(p, 0), { sourceId: 'outside', reason: 'x' }],
    });
    expect(assembleContentAttachment(p, [conflict]).issues).toHaveLength(2);
    expect(assembleContentAttachment(p, []).completedUnitIds).toEqual([]);
    expect(
      assembleContentAttachment(p, [audit(p, 0, empty())]).issues[0].reason,
    ).toContain('Unaccounted');
  });
  test('runs exactly one selected unit, constrains source/candidate choices and propagates model failure', async () => {
    const p = await prepare();
    const response = { ...empty(), ignoredSources: ignore(p, 0) };
    vi.mocked(LLMCaller.call).mockResolvedValue({
      output: response,
      usage,
      usedFallback: false,
    });
    const out = await attachContentUnit(p, p.units[0], {
      model: {} as LanguageModel,
      maxRetries: 0,
    });
    expect(LLMCaller.call).toHaveBeenCalledTimes(1);
    expect(out.response).toEqual(response);
    const call = vi.mocked(LLMCaller.call).mock.calls[0][0];
    expect(call.schema.safeParse(response).success).toBe(true);
    expect(
      call.schema.safeParse({
        ...response,
        assignments: [
          {
            candidateRefs: ['missing'],
            fragments: [
              { sourceId: p.units[0].sources[0].sourceId, quote: '報告書' },
            ],
            reason: 'x',
          },
        ],
      }).success,
    ).toBe(false);
    vi.mocked(LLMCaller.call).mockRejectedValue(new Error('model failed'));
    await expect(
      attachContentUnit(p, p.units[0], {
        model: {} as LanguageModel,
        maxRetries: 0,
      }),
    ).rejects.toThrow('model failed');
    await expect(
      attachContentUnit(
        p,
        { ...p.units[0], sources: [] },
        { model: {} as LanguageModel, maxRetries: 0 },
      ),
    ).rejects.toThrow('No selectable');
    expect(() =>
      createContentAttachmentRequest(p, { ...p.units[0], unitId: 'outside' }),
    ).toThrow('Unknown');
  });
});
