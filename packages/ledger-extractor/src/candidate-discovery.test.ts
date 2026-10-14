import type { Chapter, ProcessedDocument } from '@heripo/model';
import type { LanguageModel } from 'ai';

import type {
  CandidateDiscoveryAudit,
  CandidateDiscoveryResponse,
  CandidateDiscoveryUnit,
} from './candidate-discovery';

import { LLMCaller } from '@heripo/shared';
import { describe, expect, test, vi } from 'vitest';

import {
  assembleCandidateDiscovery,
  createCandidateDiscoveryRequest,
  discoverCandidateUnit,
  prepareCandidateDiscovery,
} from './candidate-discovery';
import { buildDocumentResourceIndex } from './document-resource-index';

vi.mock('@heripo/shared', () => ({ LLMCaller: { call: vi.fn() } }));
const usage = {
  component: 'test',
  phase: 'test',
  model: 'primary' as const,
  modelName: 'mock',
  inputTokens: 1,
  outputTokens: 2,
  totalTokens: 3,
};
const chapter = (overrides: Partial<Chapter> = {}): Chapter => ({
  id: 'root',
  originTitle: '조사 내용',
  title: '조사 내용',
  pageNo: 1,
  level: 1,
  textBlocks: [],
  imageIds: [],
  tableIds: [],
  footnoteIds: [],
  ...overrides,
});
const input = (): ProcessedDocument => ({
  reportId: 'report',
  pageRangeMap: { 1: { startPageNo: 0, endPageNo: 0 } },
  chapters: [
    chapter({
      textBlocks: [
        { id: 'a', sourceRef: '#/texts/1', text: '1호 우물', pdfPageNo: 1 },
        { id: 'b', text: '우물의 독립 본문이다.', pdfPageNo: 2 },
        { id: 'c', text: '마지막 문단', pdfPageNo: 2 },
      ],
      tableIds: ['t'],
      children: [
        chapter({
          id: 'child',
          textBlocks: [{ text: '우물 상부 폐기층', pdfPageNo: 3 }],
        }),
        chapter({ id: 'empty' }),
      ],
    }),
  ],
  images: [],
  footnotes: [],
  tables: [
    {
      id: 't',
      sourceRef: '#/tables/0',
      pdfPageNo: 1,
      numRows: 2,
      numCols: 1,
      grid: [
        [{ text: '호수', colSpan: 1, rowSpan: 1, isHeader: true }],
        [{ text: '2호', colSpan: 1, rowSpan: 1, isHeader: false }],
      ],
    },
  ],
});
const prepare = () =>
  prepareCandidateDiscovery(buildDocumentResourceIndex(input()), {
    scopeChapterId: 'root',
    inputSha256: 'hash',
    maxTextChars: 20,
    tableRowsPerUnit: 1,
  });
const proposal = (
  unit: CandidateDiscoveryUnit,
): CandidateDiscoveryResponse['candidates'][number] => ({
  recordKind: 'feature',
  sourceName: '우물',
  sourceIdentifier: '1호',
  eligibilityBasis: 'independent_body',
  reason: '독립 설명',
  evidence: [{ resourceKey: unit.resources[0].key, quote: '1호 우물' }],
});
const audit = (
  unit: CandidateDiscoveryUnit,
  response: CandidateDiscoveryResponse,
): CandidateDiscoveryAudit => ({
  unitId: unit.unitId,
  ...createCandidateDiscoveryRequest(unit),
  response,
  usage,
});

describe('candidate discovery', () => {
  test('plans only the selected subtree with bounded text, adjacent context and actual table cells', () => {
    const doc = input();
    const before = structuredClone(doc);
    const plan = prepareCandidateDiscovery(buildDocumentResourceIndex(doc), {
      scopeChapterId: 'root',
      inputSha256: 'hash',
      maxTextChars: 1,
      tableRowsPerUnit: 1,
    });
    expect(doc).toEqual(before);
    expect(plan.units.map((u) => u.resources.length)).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
    expect(plan.units[1].context.map((c) => c.text)).toContain('1호 우물');
    expect(plan.units[3].table?.headerRows).toEqual([['호수'], ['2호']]);
    expect(plan.units[4].resources[0]).toMatchObject({
      kind: 'tableCell',
      rowIndex: 1,
      columnIndex: 0,
    });
    expect(plan.units[5].chapterPath.map((c) => c.id)).toEqual([
      'root',
      'child',
    ]);
    expect(
      prepareCandidateDiscovery(buildDocumentResourceIndex(doc), {
        scopeChapterId: 'child',
        inputSha256: 'h',
        maxTextChars: 100,
        tableRowsPerUnit: 1,
      }).units,
    ).toHaveLength(1);
    const missingRefs = input();
    missingRefs.tables[0].caption = { fullText: '우물 목록' };
    missingRefs.tables[0].grid = [];
    expect(
      prepareCandidateDiscovery(buildDocumentResourceIndex(missingRefs), {
        scopeChapterId: 'root',
        inputSha256: 'h',
        maxTextChars: 100,
        tableRowsPerUnit: 1,
      }).units,
    ).toHaveLength(2);
    missingRefs.tables[0].grid = [
      [{ text: '1', rowSpan: 1, colSpan: 1, isHeader: false }],
    ];
    expect(
      prepareCandidateDiscovery(buildDocumentResourceIndex(missingRefs), {
        scopeChapterId: 'root',
        inputSha256: 'h',
        maxTextChars: 100,
        tableRowsPerUnit: 1,
      }).units[1].table?.caption,
    ).toBe('우물 목록');
  });
  test('rejects invalid scope and chunk limits', () => {
    const index = buildDocumentResourceIndex(input());
    for (const [maxTextChars, tableRowsPerUnit] of [
      [0, 1],
      [1, 0],
      [1.2, 1],
      [1, 1.2],
    ])
      expect(() =>
        prepareCandidateDiscovery(index, {
          scopeChapterId: 'root',
          inputSha256: 'h',
          maxTextChars,
          tableRowsPerUnit,
        }),
      ).toThrow('positive integers');
    expect(() =>
      prepareCandidateDiscovery(index, {
        scopeChapterId: 'absent',
        inputSha256: 'h',
        maxTextChars: 1,
        tableRowsPerUnit: 1,
      }),
    ).toThrow('Scope chapter not found');
  });
  test('retains prompts, validates the model response schema and propagates model failure', async () => {
    const unit = prepare().units[0];
    const response = { candidates: [], exclusions: [] };
    vi.mocked(LLMCaller.call).mockResolvedValue({
      output: response,
      usage,
      usedFallback: false,
    });
    const result = await discoverCandidateUnit(unit, {
      model: {} as LanguageModel,
      maxRetries: 0,
    });
    expect(result.userPrompt).toBe(JSON.stringify(unit));
    expect(result.response).toEqual(response);
    expect(result.systemPrompt).toContain('THIS investigation');
    expect(LLMCaller.call).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRetries: 0,
        component: 'LedgerCandidateDiscovery',
      }),
    );
    vi.mocked(LLMCaller.call).mockRejectedValue(new Error('model failed'));
    await expect(
      discoverCandidateUnit(unit, {
        model: {} as LanguageModel,
        maxRetries: 0,
      }),
    ).rejects.toThrow('model failed');
  });
  test('creates stable, proposed candidates from exact source anchors and replays in plan order', async () => {
    const plan = prepare();
    const unit = plan.units[0];
    const response = {
      candidates: [proposal(unit)],
      exclusions: [{ resourceKey: unit.resources[1].key, reason: '대상 제외' }],
    };
    const first = await assembleCandidateDiscovery(plan, [
      audit(unit, response),
    ]);
    expect(first.candidates[0]).toMatchObject({
      status: 'proposed',
      sourceName: '우물',
      sourceIdentifier: '1호',
      evidence: [
        {
          charStart: 0,
          charEnd: 5,
          sourceRefs: ['#/texts/1'],
          logicalPageRange: { startPageNo: 0, endPageNo: 0 },
        },
      ],
    });
    expect(first.candidates[0].candidateId).toMatch(/^candidate-[a-f0-9]{64}$/);
    expect(first.completedUnitIds).toEqual([unit.unitId]);
    expect(first.exclusions).toHaveLength(1);
    expect(
      await assembleCandidateDiscovery(plan, [audit(unit, response)]),
    ).toEqual(first);
    const changed = {
      ...response,
      candidates: [{ ...proposal(unit), reason: '새로운 이유' }],
    };
    expect(
      (await assembleCandidateDiscovery(plan, [audit(unit, changed)]))
        .candidates[0].candidateId,
    ).toBe(first.candidates[0].candidateId);
    const unknownId = {
      ...proposal(unit),
      sourceIdentifier: null,
      evidence: [
        { resourceKey: unit.resources[1].key, quote: '우물의 독립 본문이다.' },
      ],
    };
    expect(
      (
        await assembleCandidateDiscovery(plan, [
          audit(unit, { candidates: [unknownId], exclusions: [] }),
        ])
      ).candidates[0].evidence[0].logicalPageRange,
    ).toBeNull();
  });
  test('keeps invalid quotes, sources, identifiers, names and eligibility as visible issues', async () => {
    const plan = prepare();
    const unit = plan.units[0];
    const p = proposal(unit);
    const invalids = [
      { ...p, evidence: [{ resourceKey: 'outside', quote: '1호 우물' }] },
      {
        ...p,
        evidence: [{ resourceKey: unit.resources[0].key, quote: '다른 원문' }],
      },
      { ...p, sourceName: '추정 석축 우물' },
      { ...p, sourceIdentifier: '999' },
      { ...p, eligibilityBasis: 'explicit_context_unit' as const },
      { ...p, eligibilityBasis: 'table_item' as const },
    ];
    const result = await assembleCandidateDiscovery(plan, [
      audit(unit, {
        candidates: invalids,
        exclusions: [{ resourceKey: 'outside', reason: 'invalid' }],
      }),
    ]);
    expect(result.candidates).toEqual([]);
    expect(result.issues).toHaveLength(7);
    const malformed = audit(unit, { candidates: [], exclusions: [] });
    malformed.response = null as unknown as CandidateDiscoveryResponse;
    expect(
      (await assembleCandidateDiscovery(plan, [malformed])).issues[0].reason,
    ).toContain('schema');
    for (const changed of [
      { promptVersion: 'different' },
      { systemPrompt: 'different' },
      { userPrompt: 'different' },
    ]) {
      const stale = {
        ...audit(unit, { candidates: [], exclusions: [] }),
        ...changed,
      };
      expect(
        (await assembleCandidateDiscovery(plan, [stale])).issues[0].reason,
      ).toContain('does not match');
    }
  });
  test('preserves distinct table items and context units, and reports duplicate anchors', async () => {
    const plan = prepare();
    const unit = plan.units[0];
    const p = proposal(unit);
    const duplicates = await assembleCandidateDiscovery(plan, [
      audit(unit, { candidates: [p, p], exclusions: [] }),
    ]);
    expect(duplicates.candidates).toHaveLength(1);
    expect(duplicates.issues[0].reason).toContain('Duplicate anchor');
    const tableUnit = plan.units.find(
      (u) => u.table && u.resources.some((r) => r.data.text === '2호'),
    )!;
    const tableCandidate = {
      ...p,
      sourceName: '2호',
      sourceIdentifier: '2호',
      eligibilityBasis: 'table_item' as const,
      evidence: [{ resourceKey: tableUnit.resources[0].key, quote: '2호' }],
    };
    const ctxUnit = plan.units.at(-1)!;
    const contextCandidate = {
      ...p,
      sourceName: '우물 상부 폐기층',
      sourceIdentifier: null,
      recordKind: 'layer' as const,
      eligibilityBasis: 'explicit_context_unit' as const,
      evidence: [
        { resourceKey: ctxUnit.resources[0].key, quote: '우물 상부 폐기층' },
      ],
    };
    const result = await assembleCandidateDiscovery(plan, [
      audit(ctxUnit, { candidates: [contextCandidate], exclusions: [] }),
      audit(tableUnit, { candidates: [tableCandidate], exclusions: [] }),
    ]);
    expect(result.candidates.map((c) => c.recordKind)).toEqual([
      'feature',
      'layer',
    ]);
    expect(
      (
        await assembleCandidateDiscovery(plan, [
          audit(tableUnit, {
            candidates: [
              { ...tableCandidate, eligibilityBasis: 'independent_body' },
            ],
            exclusions: [],
          }),
        ])
      ).issues[0].reason,
    ).toContain('no body input');
  });
});
