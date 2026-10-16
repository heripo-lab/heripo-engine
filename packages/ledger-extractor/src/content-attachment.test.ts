import type { ProcessedDocument } from '@heripo/model';
import type * as Shared from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { CandidateDeduplicationResult } from './candidate-deduplication';
import type { CandidateDiscoveryResult } from './candidate-discovery';
import type {
  ContentAttachmentAudit,
  ContentAttachmentResponse,
} from './content-attachment';
import type { ContentRegistrationDecision } from './content-attachment-decisions';

import { LLMCaller, createAuditedModel } from '@heripo/shared';
import { describe, expect, test, vi } from 'vitest';

import { prepareCandidateDiscovery } from './candidate-discovery';
import {
  assembleContentAttachment,
  attachContentUnit,
  createContentAttachmentRequest,
  prepareContentAttachment,
} from './content-attachment';
import { createContentAttachmentBodyBlockInput } from './content-attachment-body-blocks';
import { createContentAttachmentGroundedInput } from './content-attachment-grounding';
import { createContentAttachmentIndependentReviewRequest } from './content-attachment-independent-review';
import { createContentAttachmentInput } from './content-attachment-input';
import { buildDocumentResourceIndex } from './document-resource-index';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));
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
  ignoredPassages: [],
  ignoredSources: [],
});
const audit = (
  plan: Awaited<ReturnType<typeof prepare>>,
  i: number,
  response: ContentAttachmentResponse,
): ContentAttachmentAudit => ({
  unitId: plan.units[i].unitId,
  ...createContentAttachmentRequest(
    plan,
    plan.units[i],
    'content-attachment.v1',
  ),
  response,
  usage,
});
const ignore = (plan: Awaited<ReturnType<typeof prepare>>, i: number) =>
  plan.units[i].sources.map((s) => ({
    sourceId: s.sourceId,
    reason: '対象外',
  }));

describe('bounded content attachment', () => {
  test('snapshots caller-confirmed mention decisions without sharing mutable caller state', async () => {
    const f = fixture();
    const original = await prepare();
    const source = original.units
      .flatMap((u) => u.sources)
      .find((s) => s.resource.resourceId === 'a')!;
    const r = source.resource;
    const decisions: ContentRegistrationDecision[] = [
      {
        decisionId: 'author-scope',
        inputSha256: f.options.inputSha256,
        decision: 'not_independent_record',
        basis: 'no_independent_body_or_table_item',
        authority: 'author_confirmed',
        evidence: {
          sourceId: source.sourceId,
          resourceKey: r.key,
          resourceId: r.resourceId,
          sourceRefs: r.sourceRefs,
          pdfPageNo: r.pdfPageNo,
          logicalPageRange: r.logicalPageRange,
          charStart: 0,
          charEnd: 2,
          quote: r.data.text.slice(0, 2),
        },
        provenance: {
          reference: 'author-confirmation',
          text: 'Confirmed decision',
        },
      },
    ];
    const plan = await prepareContentAttachment(
      f.index,
      f.dp,
      f.discovery,
      f.groups,
      { ...f.options, registrationDecisions: decisions },
    );
    expect(plan.registrationDecisions).toEqual(decisions);
    decisions[0].provenance.text = 'Caller mutation';
    expect(plan.registrationDecisions![0].provenance.text).toBe(
      'Confirmed decision',
    );
    const unit = plan.units.find((u) =>
      u.sources.some((s) => s.sourceId === source.sourceId),
    )!;
    expect(
      JSON.parse(createContentAttachmentRequest(plan, unit).userPrompt).current
        .registrationDecisions,
    ).toHaveLength(1);
  });
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
    const mixed = (await prepare()).units.find((u) => u.pdfPageNo === 3)!;
    expect(mixed.sources.at(-1)!.resource.kind).toBe('tableCell');
    expect(mixed.readOnlyContext.map((c) => c.text)).toEqual([
      '報告書',
      '井戸と廃棄層。',
      '前半の文は切れ',
    ]);
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
      ignoredPassages: [],
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
      ignoredPassages: [],
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
    const a = audit(p, 0, {
      ...empty(),
      ignoredPassages: [],
      ignoredSources: ignore(p, 0),
    });
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
      ignoredPassages: [],
      ignoredSources: [...ignore(p, 0), { sourceId: 'outside', reason: 'x' }],
    });
    expect(assembleContentAttachment(p, [conflict]).issues).toHaveLength(2);
    expect(assembleContentAttachment(p, []).completedUnitIds).toEqual([]);
    expect(
      assembleContentAttachment(p, [audit(p, 0, empty())]).issues[0].reason,
    ).toContain('Unaccounted');
  });
  test('encodes all candidate mentions and literal quotes with shared contexts, short selectors and a lossless code map', async () => {
    const p = await prepare();
    const alias = structuredClone(p.registry[0].mentions[0]);
    alias.candidateId = 'third-long-candidate-id';
    alias.sourceName = '別名';
    alias.sourceIdentifier = '7.';
    alias.chapterPath = [{ id: 'different-chapter', originTitle: '調査' }];
    alias.evidence = [
      { ...alias.evidence[0], quote: '前半' },
      { ...alias.evidence[0], quote: 'のまま' },
    ];
    p.registry[0].mentions.push(alias);
    const before = structuredClone(p);
    const { payload, codeMap } = createContentAttachmentInput(p, p.units[1]);
    expect(payload.candidates).toHaveLength(3);
    expect(payload.candidates.map((row) => row[0])).toEqual(['R1', 'R1', 'R2']);
    expect(payload.candidates[1]).toEqual([
      'R1',
      'layer',
      'C2',
      '別名',
      '7.',
      ['前半', 'のまま'],
    ]);
    expect(payload.contexts).toEqual({ C1: ['調査'], C2: ['調査'] });
    expect(payload.uncertainties[0].refs).toEqual(['R1', 'R2']);
    expect(codeMap.candidateRows[1]).toMatchObject({
      groupId: 'g1',
      candidateId: alias.candidateId,
      evidence: alias.evidence,
    });
    expect(codeMap.sources.map((s) => s.ref)).toEqual(
      p.units[1].sources.map((_, i) => `S${i + 1}`),
    );
    expect(codeMap.sources.map((s) => s.source)).toEqual(p.units[1].sources);
    expect(codeMap.contextPaths.C2).toEqual(alias.chapterPath);
    expect(payload.current.sources[1][3]).toEqual(['T1', 0, 0]);
    expect(payload.current.tables[0].grid[0][0]).toEqual([
      'S2',
      null,
      2,
      1,
      true,
    ]);
    expect(payload.current.tables[0].caption).toBeNull();
    const encoded = JSON.stringify(payload);
    for (const hidden of [
      'third-long-candidate-id',
      '/chapters/',
      '#/texts/',
      'inputSha256',
      'registrySha256',
      'charStart',
      'sourceRefs',
      'resourceKey',
      'groupId',
    ])
      expect(encoded).not.toContain(hidden);
    expect(createContentAttachmentInput(p, p.units[1])).toEqual({
      payload,
      codeMap,
    });
    expect(p).toEqual(before);
    expect(() =>
      createContentAttachmentInput(p, { ...p.units[1], unitId: 'outside' }),
    ).toThrow('Unknown');
    const f = fixture();
    f.doc.tables[0].caption = { fullText: '表の原文' };
    const index = buildDocumentResourceIndex(f.doc);
    const split = await prepareContentAttachment(
      index,
      f.dp,
      f.discovery,
      f.groups,
      { ...f.options, maxUnitChars: 1 },
    );
    const headerUnit = split.units.find(
      (u) => u.sources[0].resource.kind === 'tableCell',
    )!;
    const header = createContentAttachmentInput(split, headerUnit).payload;
    expect(header.current.tables[0].caption).toBe('表の原文');
    expect(header.current.tables[0].grid[1][0]).toEqual([
      null,
      '7',
      1,
      1,
      false,
    ]);
  });
  test('replays compact selectors to exact original provenance while preserving raw decisions and rejecting forged maps', async () => {
    const p = await prepare();
    const raw: ContentAttachmentAudit = {
      unitId: p.units[1].unitId,
      ...createContentAttachmentRequest(p, p.units[1], 'content-attachment.v8'),
      response: {
        assignments: [
          {
            candidateRefs: ['R1', 'R2'],
            fragments: [{ sourceId: 'S1', quote: '井戸と廃棄層。' }],
            reason: '共有',
          },
        ],
        unresolved: [],
        ignoredPassages: [],
        ignoredSources: p.units[1].sources
          .slice(1)
          .map((_, i) => ({ sourceId: `S${i + 2}`, reason: '対象外' })),
      },
      usage,
      codeMap: createContentAttachmentInput(p, p.units[1]).codeMap,
    };
    const before = structuredClone(raw);
    const result = assembleContentAttachment(p, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.contents).toHaveLength(2);
    expect(
      result.contents[0].excerpts[0].occurrences[0].evidence[0],
    ).toMatchObject({
      sourceId: p.units[1].sources[0].sourceId,
      sourceRefs: ['#/texts/1'],
      charStart: 0,
      charEnd: 7,
    });
    expect(result.ignoredSources[0].sourceId).toBe(
      p.units[1].sources[1].sourceId,
    );
    expect(raw).toEqual(before);
    for (const change of [
      (a: ContentAttachmentAudit) => {
        delete a.codeMap;
      },
      (a: ContentAttachmentAudit) => {
        a.codeMap!.inputSha256 = 'other';
      },
      (a: ContentAttachmentAudit) => {
        a.codeMap!.sources[0].source.resource.sourceRefs = ['changed'];
      },
    ]) {
      const changed = structuredClone(raw);
      change(changed);
      expect(
        assembleContentAttachment(p, [changed]).issues[0].reason,
      ).toContain('code map');
    }
    const invalid = structuredClone(raw);
    invalid.response.assignments[0].fragments[0].sourceId =
      p.units[1].sources[0].sourceId;
    expect(assembleContentAttachment(p, [invalid]).contents).toEqual([]);
    const legacy = audit(p, 0, {
      ...empty(),
      ignoredPassages: [],
      ignoredSources: ignore(p, 0),
    });
    expect(
      assembleContentAttachment(p, [legacy, raw]).completedUnitIds,
    ).toHaveLength(2);
  });
  test('keeps sentence decisions separate, shares only the explicit context sentence and replays historical compact audits', async () => {
    const p = await prepare();
    const unit = p.units[2];
    unit.sources[0].resource.data.text =
      '壺は埋土から出土した。口縁は外反する。';
    const response: ContentAttachmentResponse = {
      assignments: [
        {
          candidateRefs: ['R1', 'R2'],
          fragments: [{ sourceId: 'S1', quote: '壺は埋土から出土した。' }],
          reason: '出土文脈を共有',
        },
        {
          candidateRefs: ['R1'],
          fragments: [{ sourceId: 'S1', quote: '口縁は外反する。' }],
          reason: '形態のみ',
        },
      ],
      unresolved: [],
      ignoredPassages: [],
      ignoredSources: unit.sources
        .slice(1)
        .map((_, i) => ({ sourceId: `S${i + 2}`, reason: '対象外' })),
    };
    const raw: ContentAttachmentAudit = {
      unitId: unit.unitId,
      ...createContentAttachmentRequest(p, unit, 'content-attachment.v8'),
      response,
      usage,
      codeMap: createContentAttachmentInput(p, unit).codeMap,
    };
    const before = structuredClone(raw);
    const result = assembleContentAttachment(p, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.contents[0].excerpts.map((e) => e.fragments)).toEqual([
      ['壺は埋土から出土した。'],
      ['口縁は外反する。'],
    ]);
    expect(result.contents[1].excerpts.map((e) => e.fragments)).toEqual([
      ['壺は埋土から出土した。'],
    ]);
    expect(
      result.contents[0].excerpts[1].occurrences[0].evidence[0].charStart,
    ).toBe('壺は埋土から出土した。'.length);
    expect(raw).toEqual(before);
    const current = createContentAttachmentRequest(
      p,
      unit,
      'content-attachment.v8',
    );
    const historical = createContentAttachmentRequest(
      p,
      unit,
      'content-attachment.v2',
    );
    expect(current.promptVersion).toBe('content-attachment.v8');
    expect(current.systemPrompt).toContain('exactly ONE original sentence');
    expect(current.systemPrompt).toContain(
      'include ALL those candidateRefs in the SAME item',
    );
    expect(current.userPrompt).toBe(historical.userPrompt);
    expect(current.systemPrompt).not.toBe(historical.systemPrompt);
    const v3 = createContentAttachmentRequest(p, unit, 'content-attachment.v3');
    expect(current.userPrompt).toBe(v3.userPrompt);
    expect(v3.systemPrompt).not.toContain('SOURCE CONTAINERS VS EXCERPT UNITS');
    expect(current.systemPrompt).toContain(
      'SOURCE CONTAINERS VS EXCERPT UNITS',
    );
    expect(assembleContentAttachment(p, [{ ...raw, ...v3 }])).toEqual(result);
    const v2 = { ...raw, ...historical };
    expect(assembleContentAttachment(p, [v2])).toEqual(result);
    expect(
      assembleContentAttachment(p, [
        { ...raw, promptVersion: 'content-attachment.v2' },
      ]).issues[0].reason,
    ).toContain('Audit does not match');
  });
  test('retains a leading boundary fragment and two following sentence decisions under the same source without merging or restoring them', async () => {
    const p = await prepare();
    const unit = p.units[2];
    const quotes = [
      'その一部である。',
      '壁は石組みである。',
      '内面は円形である。',
    ];
    const original = quotes.join('');
    unit.sources[0].resource.data.text = original;
    const response: ContentAttachmentResponse = {
      assignments: quotes.map((quote) => ({
        candidateRefs: ['R1'],
        fragments: [{ sourceId: 'S1', quote }],
        reason: '原文の一部',
      })),
      unresolved: [],
      ignoredPassages: [],
      ignoredSources: unit.sources
        .slice(1)
        .map((_, i) => ({ sourceId: `S${i + 2}`, reason: '対象外' })),
    };
    const raw: ContentAttachmentAudit = {
      unitId: unit.unitId,
      ...createContentAttachmentRequest(p, unit, 'content-attachment.v8'),
      response,
      usage,
      codeMap: createContentAttachmentInput(p, unit).codeMap,
    };
    const before = structuredClone(raw);
    const result = assembleContentAttachment(p, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.contents[0].excerpts.map((e) => e.fragments)).toEqual(
      quotes.map((q) => [q]),
    );
    expect(
      result.contents[0].excerpts.map(
        (e) => e.occurrences[0].evidence[0].charStart,
      ),
    ).toEqual([0, quotes[0].length, quotes[0].length + quotes[1].length]);
    expect(
      result.contents[0].excerpts.every(
        (e) =>
          e.occurrences[0].evidence[0].sourceId === unit.sources[0].sourceId,
      ),
    ).toBe(true);
    expect(unit.sources[0].resource.data.text).toBe(original);
    expect(raw).toEqual(before);
    expect(raw.systemPrompt).toContain(
      'put ONLY its leading incomplete sentence fragment',
    );
    expect(raw.systemPrompt).toContain(
      'every following complete sentence MUST be a separate item',
    );
    expect(raw.systemPrompt).not.toContain(
      'Return each original source block fragment separately in fragments',
    );
  });
  test('preserves a registered object heading verbatim while ignoring a generic category and retains historical v4 replay', async () => {
    const p = await prepare(),
      unit = p.units[0];
    const heading = '7. 土器 (図2、写真3)';
    unit.sources[0].resource.data.text = heading;
    const category = structuredClone(unit.sources[0]);
    category.sourceId = 'path:/category';
    category.resource.key = '/category';
    category.resource.resourceId = 'category';
    category.resource.data.text = '遺物';
    unit.sources.push(category);
    const response: ContentAttachmentResponse = {
      assignments: [
        {
          candidateRefs: ['R1'],
          fragments: [{ sourceId: 'S1', quote: heading }],
          reason: '登録済み対象の番号と名称',
        },
      ],
      unresolved: [],
      ignoredPassages: [],
      ignoredSources: [{ sourceId: 'S2', reason: '分類見出し' }],
    };
    const raw: ContentAttachmentAudit = {
      unitId: unit.unitId,
      ...createContentAttachmentRequest(p, unit, 'content-attachment.v8'),
      response,
      usage,
      codeMap: createContentAttachmentInput(p, unit).codeMap,
    };
    const before = structuredClone(raw);
    const result = assembleContentAttachment(p, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.contents[0].excerpts[0].fragments).toEqual([heading]);
    expect(result.ignoredSources[0].sourceId).toBe(category.sourceId);
    expect(result.contents).toHaveLength(1);
    expect(raw).toEqual(before);
    const v4 = createContentAttachmentRequest(p, unit, 'content-attachment.v4');
    expect(v4.userPrompt).toBe(raw.userPrompt);
    expect(v4.systemPrompt).toContain(
      'A title, contents entry or generic category alone',
    );
    expect(raw.systemPrompt).not.toContain(
      'A title, contents entry or generic category alone',
    );
    expect(raw.systemPrompt).toContain('HEADING ELIGIBILITY');
    expect(raw.systemPrompt).toContain('assign the ENTIRE unchanged heading');
    expect(raw.systemPrompt).toContain('ALREADY REGISTERED');
    expect(assembleContentAttachment(p, [{ ...raw, ...v4 }])).toEqual(result);
  });
  test('reports an omitted middle sentence and exact uncovered ranges without altering raw decisions or historical v5 replay', async () => {
    const p = await prepare(),
      unit = p.units[0];
    unit.sources[0].resource.data.text = '形態。 方向を推定する。 規模。';
    const response: ContentAttachmentResponse = {
      ...empty(),
      assignments: ['形態。', '規模。'].map((quote) => ({
        candidateRefs: ['R1'],
        fragments: [{ sourceId: 'S1', quote }],
        reason: '原文',
      })),
    };
    const raw: ContentAttachmentAudit = {
      unitId: unit.unitId,
      ...createContentAttachmentRequest(p, unit, 'content-attachment.v8'),
      response,
      usage,
      codeMap: createContentAttachmentInput(p, unit).codeMap,
    };
    const before = structuredClone([p, raw]);
    const result = assembleContentAttachment(p, [raw]);
    expect(result.issues).toEqual([
      {
        unitId: unit.unitId,
        reason:
          'Unaccounted text: path:/chapters/0/textBlocks/0 [3, 13) " 方向を推定する。 "',
      },
    ]);
    expect(result.completedUnitIds).toEqual([]);
    expect(result.contents[0].excerpts.map((e) => e.fragments)).toEqual([
      ['形態。'],
      ['規模。'],
    ]);
    expect([p, raw]).toEqual(before);
    const historical = {
      ...structuredClone(raw),
      ...createContentAttachmentRequest(p, unit, 'content-attachment.v5'),
    };
    delete historical.response.ignoredPassages;
    expect(assembleContentAttachment(p, [historical]).issues).toEqual([]);
    expect(historical.systemPrompt).not.toContain(
      'EXHAUSTIVE PASSAGE ACCOUNTING',
    );
    expect(raw.systemPrompt).toContain(
      'including direction, orientation, uncertainty and interpretation',
    );
    expect(raw.systemPrompt).toContain('founded on or constructed on');
    expect(raw.systemPrompt).toContain('a layer number need not occur');
    expect(raw.userPrompt).toBe(historical.userPrompt);
  });
  test('accounts for shared foundations, unresolved identity, partial exclusions and whitespace while retaining exact evidence', async () => {
    const p = await prepare(),
      unit = p.units[0];
    unit.sources[0].resource.data.text =
      '井戸は岩盤に築く。\n\t対象不明。 比較対象。\n';
    const response: ContentAttachmentResponse = {
      assignments: [
        {
          candidateRefs: ['R1', 'R2'],
          fragments: [{ sourceId: 'S1', quote: '井戸は岩盤に築く。' }],
          reason: '造営基盤を共有',
        },
      ],
      unresolved: [
        {
          candidateRefs: [],
          fragments: [{ sourceId: 'S1', quote: '対象不明。' }],
          reason: '同一性不明',
        },
      ],
      ignoredPassages: [
        {
          fragments: [{ sourceId: 'S1', quote: '比較対象。' }],
          reason: '比較例',
        },
      ],
      ignoredSources: [],
    };
    const raw: ContentAttachmentAudit = {
      unitId: unit.unitId,
      ...createContentAttachmentRequest(p, unit, 'content-attachment.v8'),
      response,
      usage,
      codeMap: createContentAttachmentInput(p, unit).codeMap,
    };
    const before = structuredClone([p, raw]);
    const result = assembleContentAttachment(p, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.completedUnitIds).toEqual([unit.unitId]);
    expect(result.contents.map((c) => c.excerpts[0].fragments)).toEqual([
      ['井戸は岩盤に築く。'],
      ['井戸は岩盤に築く。'],
    ]);
    expect(result.ignoredPassages[0]).toMatchObject({
      unitId: unit.unitId,
      reason: '比較例',
      evidence: [
        { quote: '比較対象。', charStart: 17, charEnd: 22, pdfPageNo: 2 },
      ],
    });
    expect(result.reviewStatus).toBe('not_reviewed');
    expect([p, raw]).toEqual(before);
    const overlap = structuredClone(raw);
    overlap.response.ignoredPassages![0].fragments[0].quote = '対象不明。';
    expect(
      assembleContentAttachment(p, [overlap]).issues.some((i) =>
        i.reason.includes('overlaps'),
      ),
    ).toBe(true);
    const invalid = structuredClone(raw);
    invalid.response.ignoredPassages![0].fragments[0].quote = '修正文';
    expect(
      assembleContentAttachment(p, [invalid]).issues.some((i) =>
        i.reason.includes('Ignored passage does not match'),
      ),
    ).toBe(true);
    const conflict = structuredClone(raw);
    conflict.response.ignoredSources.push({
      sourceId: 'S1',
      reason: '全体除外',
    });
    expect(
      assembleContentAttachment(p, [conflict]).issues.some((i) =>
        i.reason.includes('also used'),
      ),
    ).toBe(true);
    const repeated = structuredClone(raw);
    repeated.response.ignoredPassages!.push(
      repeated.response.ignoredPassages![0],
    );
    expect(
      assembleContentAttachment(p, [repeated]).issues.some((i) =>
        i.reason.includes('overlaps'),
      ),
    ).toBe(true);
  });
  test('detects uncovered leading and trailing text, table-cell substrings and punctuation without sentence guessing', async () => {
    const p = await prepare(),
      unit = p.units[0];
    unit.sources[0].resource.data.text = '前。中央。後。';
    const raw: ContentAttachmentAudit = {
      unitId: unit.unitId,
      ...createContentAttachmentRequest(p, unit, 'content-attachment.v8'),
      response: {
        ...empty(),
        assignments: [
          {
            candidateRefs: ['R1'],
            fragments: [{ sourceId: 'S1', quote: '中央' }],
            reason: '原文',
          },
        ],
      },
      usage,
      codeMap: createContentAttachmentInput(p, unit).codeMap,
    };
    expect(
      assembleContentAttachment(p, [raw]).issues.map((i) => i.reason),
    ).toEqual([
      'Unaccounted text: path:/chapters/0/textBlocks/0 [0, 2) "前。"',
      'Unaccounted text: path:/chapters/0/textBlocks/0 [4, 7) "。後。"',
    ]);
    const tableUnit = p.units[1];
    const cellIndex = tableUnit.sources.findIndex(
      (s) => s.resource.kind === 'tableCell' && s.resource.data.text === '20',
    );
    const cellRef = `S${cellIndex + 1}`;
    const tableAudit: ContentAttachmentAudit = {
      unitId: tableUnit.unitId,
      ...createContentAttachmentRequest(p, tableUnit, 'content-attachment.v8'),
      response: {
        ...empty(),
        assignments: [
          {
            candidateRefs: ['R1'],
            fragments: [{ sourceId: cellRef, quote: '2' }],
            reason: '原文',
          },
        ],
        ignoredSources: tableUnit.sources.flatMap((_, i) =>
          i === cellIndex ? [] : [{ sourceId: `S${i + 1}`, reason: '対象外' }],
        ),
      },
      usage,
      codeMap: createContentAttachmentInput(p, tableUnit).codeMap,
    };
    expect(
      assembleContentAttachment(p, [tableAudit]).issues[0].reason,
    ).toContain('[1, 2) "0"');
    const missingField = structuredClone(raw);
    delete missingField.response.ignoredPassages;
    expect(assembleContentAttachment(p, [missingField]).issues[0].reason).toBe(
      'Invalid attachment response schema',
    );
  });
  test('retains confirmed sentence assignments alongside ambiguous layer alternatives and preserves strict v6 replay', async () => {
    const p = await prepare(),
      unit = p.units[0];
    const direction = 'The structure faces east.';
    const removal =
      'Topsoil and the modern deposit were removed to reveal the structure.';
    const foundation = 'The structure was founded on weathered bedrock.';
    unit.sources[0].resource.data.text = [direction, removal, foundation].join(
      ' ',
    );
    const template = p.registry[0];
    p.registry = [
      'Structure',
      'Topsoil',
      'Topsoil',
      'Modern deposit',
      'Natural ground',
    ].map((name, i) => ({
      ...structuredClone(template),
      ref: `R${i + 1}`,
      groupId: `g${i + 1}`,
      recordKind: i === 0 ? 'feature' : 'layer',
      mentions: [
        {
          ...structuredClone(template.mentions[0]),
          candidateId: `candidate-${i}`,
          sourceName: name,
        },
      ],
    }));
    const response: ContentAttachmentResponse = {
      assignments: [
        {
          candidateRefs: ['R1'],
          fragments: [{ sourceId: 'S1', quote: direction }],
          reason: 'Direction',
        },
        {
          candidateRefs: ['R1', 'R4'],
          fragments: [{ sourceId: 'S1', quote: removal }],
          reason: 'Confirmed feature and deposit',
        },
        {
          candidateRefs: ['R1', 'R5'],
          fragments: [{ sourceId: 'S1', quote: foundation }],
          reason: 'Identified construction foundation',
        },
      ],
      unresolved: [
        {
          candidateRefs: ['R2', 'R3'],
          fragments: [{ sourceId: 'S1', quote: removal }],
          reason: 'Topsoil name alone cannot distinguish the existing layers',
        },
      ],
      ignoredPassages: [],
      ignoredSources: [],
    };
    const raw: ContentAttachmentAudit = {
      unitId: unit.unitId,
      ...createContentAttachmentRequest(p, unit, 'content-attachment.v8'),
      response,
      usage,
      codeMap: createContentAttachmentInput(p, unit).codeMap,
    };
    const before = structuredClone([p, raw]);
    const result = assembleContentAttachment(p, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.completedUnitIds).toEqual([unit.unitId]);
    expect(result.contents.map((c) => c.registryRef)).toEqual([
      'R1',
      'R4',
      'R5',
    ]);
    expect(result.contents[0].excerpts.map((e) => e.fragments)).toEqual([
      [direction],
      [removal],
      [foundation],
    ]);
    expect(result.unresolved[0].candidateRefs).toEqual(['R2', 'R3']);
    expect(result.unresolved[0].evidence).toEqual(
      result.contents[1].excerpts[0].occurrences[0].evidence,
    );
    expect([p, raw]).toEqual(before);
    const v6 = createContentAttachmentRequest(p, unit, 'content-attachment.v6');
    expect(raw.systemPrompt.startsWith(v6.systemPrompt + '\n')).toBe(true);
    expect(raw.systemPrompt).toContain('plausible alternative layer refs');
    expect(raw.systemPrompt).toContain('ambiguous layer alternatives ONLY');
    expect(raw.userPrompt).toBe(v6.userPrompt);
    expect(assembleContentAttachment(p, [{ ...raw, ...v6 }])).toEqual(result);
    const incomplete = structuredClone(raw);
    incomplete.response.assignments.shift();
    const currentIssues = assembleContentAttachment(p, [incomplete]).issues;
    expect(currentIssues[0].reason).toContain('Unaccounted text:');
    expect(
      assembleContentAttachment(p, [{ ...incomplete, ...v6 }]).issues,
    ).toEqual(currentIssues);
  });
  test('preserves owner words without expanding model-selected targets and retains direct sharing and strict v7 replay', async () => {
    const p = await prepare(),
      unit = p.units[0];
    const quotes = [
      'Feature A upper fill yielded sherds.',
      'Jar X was recovered from Feature A upper fill.',
      'Jar X was recovered from Feature A.',
      'Feature A was cut into Layer B.',
    ];
    unit.sources[0].resource.data.text = quotes.join(' ');
    const template = p.registry[0];
    p.registry = ['Feature A', 'Feature A upper fill', 'Jar X', 'Layer B'].map(
      (name, i) => ({
        ...structuredClone(template),
        ref: `R${i + 1}`,
        groupId: `g${i + 1}`,
        recordKind: i === 0 ? 'feature' : i === 2 ? 'artifact' : 'layer',
        mentions: [
          {
            ...structuredClone(template.mentions[0]),
            candidateId: `candidate-${i}`,
            sourceName: name,
          },
        ],
      }),
    );
    const refs = [['R2'], ['R3', 'R2'], ['R3', 'R1'], ['R1', 'R4']];
    const raw: ContentAttachmentAudit = {
      unitId: unit.unitId,
      ...createContentAttachmentRequest(p, unit, 'content-attachment.v8'),
      usage,
      codeMap: createContentAttachmentInput(p, unit).codeMap,
      response: {
        ...empty(),
        assignments: quotes.map((quote, i) => ({
          candidateRefs: refs[i],
          fragments: [{ sourceId: 'S1', quote }],
          reason: 'Directly described targets',
        })),
      },
    };
    const before = structuredClone([p, raw]);
    const result = assembleContentAttachment(p, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.completedUnitIds).toEqual([unit.unitId]);
    expect(
      result.contents
        .find((c) => c.registryRef === 'R1')!
        .excerpts.map((e) => e.fragments),
    ).toEqual([[quotes[2]], [quotes[3]]]);
    expect(
      result.contents
        .find((c) => c.registryRef === 'R2')!
        .excerpts.map((e) => e.fragments),
    ).toEqual([[quotes[0]], [quotes[1]]]);
    expect(
      result.contents
        .find((c) => c.registryRef === 'R3')!
        .excerpts.map((e) => e.fragments),
    ).toEqual([[quotes[1]], [quotes[2]]]);
    expect(
      result.contents.find((c) => c.registryRef === 'R4')!.excerpts[0]
        .fragments,
    ).toEqual([quotes[3]]);
    expect([p, raw]).toEqual(before);
    const v7 = createContentAttachmentRequest(p, unit, 'content-attachment.v7');
    expect(raw.systemPrompt.startsWith(v7.systemPrompt + '\n')).toBe(true);
    expect(v7.systemPrompt).not.toContain(
      'NESTED OWNER NAMES DO NOT PROPAGATE EXCERPTS',
    );
    expect(raw.systemPrompt).toContain('Preserve the full original sentence');
    expect(raw.systemPrompt).toContain(
      'without guessing individual artifacts or adding the owner feature',
    );
    expect(raw.userPrompt).toBe(v7.userPrompt);
    expect(assembleContentAttachment(p, [{ ...raw, ...v7 }])).toEqual(result);
    const missingSentence = structuredClone(raw);
    missingSentence.response.assignments.shift();
    const currentIssues = assembleContentAttachment(p, [
      missingSentence,
    ]).issues;
    expect(currentIssues[0].reason).toContain('Unaccounted text:');
    expect(
      assembleContentAttachment(p, [{ ...missingSentence, ...v7 }]).issues,
    ).toEqual(currentIssues);
    const missingField = structuredClone(raw);
    delete missingField.response.ignoredPassages;
    expect(
      assembleContentAttachment(p, [{ ...missingField, ...v7 }]).issues[0]
        .reason,
    ).toBe('Invalid attachment response schema');
  });
  test('runs exactly one selected unit, constrains source/candidate choices and propagates model failure', async () => {
    const p = await prepare();
    const response = {
      decisions: { E1: { status: 'ignored' as const, reason: '対象外' } },
    };
    vi.mocked(LLMCaller.call).mockResolvedValue({
      output: response,
      usage,
      usedFallback: false,
    });
    const compiled = createContentAttachmentGroundedInput(p, p.units[0]);
    const reviewRequest = createContentAttachmentIndependentReviewRequest(
      compiled,
      response,
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
      },
    );
    const reviewOutput = reviewRequest.schema.parse({
      reviews: Object.fromEntries(
        reviewRequest.required.map((r) => [
          r.key,
          Object.fromEntries(
            r.candidateRefs.map((ref) => [
              ref,
              {
                attachment: 'excluded',
                relationshipSubject: 'not_alternative',
                contextRef: r.excerptRef,
                candidateEvidenceRefs: [
                  compiled.citations.find((c) => c.candidateRef === ref)!.ref,
                ],
                reason: 'Fixture cover is not an object description',
              },
            ]),
          ),
        ]),
      ),
    });
    vi.mocked(LLMCaller.call)
      .mockResolvedValueOnce({ output: response, usage, usedFallback: false })
      .mockResolvedValueOnce({
        output: reviewOutput,
        usage,
        usedFallback: false,
      });
    const model = {} as LanguageModel;
    const onAttempt = vi.fn();
    const attempts = [
      {
        sequence: 1,
        modelId: 'mock',
        provider: 'openai.responses',
        startedAt: 'start',
        completedAt: 'end',
        outcome: 'returned' as const,
        finishReason: { unified: 'stop' },
        apiStatus: 'completed',
        incompleteDetails: null,
        responseId: 'resp-original',
        requestBody: { input: 'original' },
        responseBody: { id: 'resp-original', status: 'completed' },
        content: [],
        usage: null,
        error: null,
      },
    ];
    vi.mocked(createAuditedModel).mockReturnValueOnce({
      model: model as Exclude<LanguageModel, string>,
      attempts,
    });
    const out = await attachContentUnit(p, p.units[0], {
      model,
      maxRetries: 0,
      onAttempt,
    });
    expect(createAuditedModel).toHaveBeenCalledWith(model, onAttempt);
    expect(out.callAttempts).toBe(attempts);
    expect(LLMCaller.call).toHaveBeenCalledTimes(2);
    expect(out.rawResponse).toBe(response);
    expect(out.response).toEqual({
      assignments: [],
      unresolved: [],
      ignored: [{ excerptRef: 'E1', reason: '対象外' }],
    });
    const before = structuredClone(out);
    const {
      independentReviewFindings: _findings,
      reviewDisagreements: _disagreements,
      ...initialResult
    } = assembleContentAttachment(p, [out]);
    expect(assembleContentAttachment(p, [out]).issues).toEqual([]);
    expect(out).toEqual(before);
    const archivedUserPrompt = createContentAttachmentRequest(
      p,
      p.units[0],
      'content-attachment.v54',
    ).userPrompt;
    const preservedPrompt = createContentAttachmentRequest(
      p,
      p.units[0],
      'content-attachment.v57',
    ).systemPrompt;
    const v42 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v42',
      ),
    };
    expect(archivedUserPrompt).toBe(v42.userPrompt);
    expect(preservedPrompt.startsWith(v42.systemPrompt)).toBe(true);
    expect(v42.systemPrompt).not.toContain(
      'CARRY PREVIOUS-INVESTIGATION SUBJECTS THROUGH CATEGORY FRAGMENTS AND THEIR NEXT CONTEXT',
    );
    expect(assembleContentAttachment(p, [v42])).toEqual(initialResult);
    const alteredHistoricalProjection = structuredClone(v42);
    alteredHistoricalProjection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredHistoricalProjection]).issues[0]
        .reason,
    ).toContain('inconsistent projection');
    const v43 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v43',
      ),
    };
    expect(archivedUserPrompt).toBe(v43.userPrompt);
    expect(preservedPrompt.startsWith(v43.systemPrompt)).toBe(true);
    expect(v43.systemPrompt).not.toContain(
      'RESOLVE DIFFERENT REGISTRY AND NARRATIVE NAMES THROUGH ORIGINAL IDENTITY EVIDENCE',
    );
    expect(assembleContentAttachment(p, [v43])).toEqual(initialResult);
    const alteredV43Projection = structuredClone(v43);
    alteredV43Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV43Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const v45 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v45',
      ),
    };
    expect(archivedUserPrompt).toBe(v45.userPrompt);
    expect(preservedPrompt.startsWith(v45.systemPrompt)).toBe(true);
    expect(v45.systemPrompt).not.toContain('CURRENT CLAUSE PERIOD');
    expect(out.systemPrompt).toContain('CURRENT CLAUSE PERIOD');
    expect(out.systemPrompt).toContain('ELLIPTICAL TABLE WORK SUBJECTS');
    expect(assembleContentAttachment(p, [v45])).toEqual(initialResult);
    const alteredV45Projection = structuredClone(v45);
    alteredV45Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV45Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const v46 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v46',
      ),
    };
    expect(archivedUserPrompt).toBe(v46.userPrompt);
    expect(preservedPrompt.startsWith(v46.systemPrompt)).toBe(true);
    expect(v46.systemPrompt).not.toContain('ESTABLISHED FEATURE GROUPS REMAIN');
    expect(out.systemPrompt).toContain('ESTABLISHED FEATURE GROUPS REMAIN');
    expect(out.systemPrompt).toContain('INVESTIGATION-STAGE IDENTITY BOUNDS');
    expect(assembleContentAttachment(p, [v46])).toEqual(initialResult);
    const alteredV46Projection = structuredClone(v46);
    alteredV46Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV46Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const v47 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v47',
      ),
    };
    expect(archivedUserPrompt).toBe(v47.userPrompt);
    expect(preservedPrompt.startsWith(v47.systemPrompt)).toBe(true);
    expect(v47.systemPrompt).not.toContain('SET-LEVEL EVIDENCE ATTACHMENT');
    expect(out.systemPrompt).toContain('SET-LEVEL EVIDENCE ATTACHMENT');
    expect(out.systemPrompt).toContain('PARTIAL RELATION IDENTITY');
    expect(assembleContentAttachment(p, [v47])).toEqual(initialResult);
    const alteredV47Projection = structuredClone(v47);
    alteredV47Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV47Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const v48 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v48',
      ),
    };
    expect(archivedUserPrompt).toBe(v48.userPrompt);
    expect(preservedPrompt.startsWith(v48.systemPrompt)).toBe(true);
    expect(v48.systemPrompt).not.toContain(
      'QUANTITIES REMAIN WITH THEIR ORIGINAL',
    );
    expect(out.systemPrompt).toContain('QUANTITIES REMAIN WITH THEIR ORIGINAL');
    expect(out.systemPrompt).toContain('BOTH RELATION ENDPOINTS REQUIRE');
    expect(assembleContentAttachment(p, [v48])).toEqual(initialResult);
    const alteredV48Projection = structuredClone(v48);
    alteredV48Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV48Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const v49 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v49',
      ),
    };
    expect(archivedUserPrompt).toBe(v49.userPrompt);
    expect(preservedPrompt.startsWith(v49.systemPrompt)).toBe(true);
    expect(v49.systemPrompt).not.toContain('CONFIRMED SET MEMBERSHIP SUPPORTS');
    expect(out.systemPrompt).toContain('CONFIRMED SET MEMBERSHIP SUPPORTS');
    expect(out.systemPrompt).toContain('NEAREST EXPLICIT WORK SUBJECT LIMITS');
    expect(assembleContentAttachment(p, [v49])).toEqual(initialResult);
    const alteredV49Projection = structuredClone(v49);
    alteredV49Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV49Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const v50 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v50',
      ),
    };
    expect(archivedUserPrompt).toBe(v50.userPrompt);
    expect(preservedPrompt.startsWith(v50.systemPrompt)).toBe(true);
    expect(v50.systemPrompt).not.toContain(
      'NO STATED RESTRICTION IS NOT POSITIVE',
    );
    expect(out.systemPrompt).toContain('NO STATED RESTRICTION IS NOT POSITIVE');
    expect(assembleContentAttachment(p, [v50])).toEqual(initialResult);
    const alteredV50Projection = structuredClone(v50);
    alteredV50Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV50Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const v51 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v51',
      ),
    };
    expect(archivedUserPrompt).toBe(v51.userPrompt);
    expect(preservedPrompt.startsWith(v51.systemPrompt)).toBe(true);
    expect(v51.systemPrompt).not.toContain(
      'DO NOT REQUIRE INDIVIDUAL REIDENTIFICATION',
    );
    expect(out.systemPrompt).toContain(
      'DO NOT REQUIRE INDIVIDUAL REIDENTIFICATION',
    );
    expect(out.systemPrompt).toContain('NARROW THE VERIFIED ANTECEDENT SET');
    expect(assembleContentAttachment(p, [v51])).toEqual(initialResult);
    const alteredV51Projection = structuredClone(v51);
    alteredV51Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV51Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const v52 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v52',
      ),
    };
    expect(archivedUserPrompt).toBe(v52.userPrompt);
    expect(preservedPrompt.startsWith(v52.systemPrompt)).toBe(true);
    expect(v52.systemPrompt).not.toContain(
      'CROSS-CHECK EACH EXPLICITLY LISTED IDENTIFIER',
    );
    expect(out.systemPrompt).toContain(
      'CROSS-CHECK EACH EXPLICITLY LISTED IDENTIFIER',
    );
    expect(assembleContentAttachment(p, [v52])).toEqual(initialResult);
    const alteredV52Projection = structuredClone(v52);
    alteredV52Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV52Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const v53 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v53',
      ),
    };
    expect(archivedUserPrompt).toBe(v53.userPrompt);
    expect(preservedPrompt.startsWith(v53.systemPrompt)).toBe(true);
    expect(v53.systemPrompt).not.toContain(
      'IDENTIFIER CROSS-CHECKING IS LOCAL',
    );
    expect(out.systemPrompt).toContain('IDENTIFIER CROSS-CHECKING IS LOCAL');
    expect(out.systemPrompt).toContain(
      'COMPLETE COLLECTIVE RECIPIENTS AND RELATIONSHIP-SUBJECT ALTERNATIVES',
    );
    expect(assembleContentAttachment(p, [v53])).toEqual(initialResult);
    const alteredV53Projection = structuredClone(v53);
    alteredV53Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV53Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const withoutRaw = structuredClone(out);
    delete withoutRaw.rawResponse;
    expect(
      assembleContentAttachment(p, [withoutRaw]).issues[0].reason,
    ).toContain('required excerpt');
    const changedProjection = structuredClone(out);
    changedProjection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [changedProjection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const call = vi.mocked(LLMCaller.call).mock.calls[0][0];
    expect(call.schema.safeParse(response).success).toBe(true);
    expect(call.schema.safeParse({ decisions: {} }).success).toBe(false);
    expect(
      call.schema.safeParse({
        decisions: {
          E1: {
            status: 'assigned',
            candidateRefs: ['missing'],
            reason: 'x',
            unresolved: null,
          },
        },
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
