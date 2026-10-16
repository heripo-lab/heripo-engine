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
  createCandidateDiscoverySchema,
  discoverCandidateUnit,
  getCandidateSources,
  prepareCandidateDiscovery,
  prepareCandidateDiscoveryRetry,
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
  identifierSourceId: null,
  sourceIdentifier: '1호',
  eligibilityBasis: 'independent_body',
  reason: '독립 설명',
  evidence: [
    { sourceId: getCandidateSources(unit)[0].sourceId, quote: '1호 우물' },
  ],
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
    expect(plan.units[3].table?.headerRows).toEqual(doc.tables[0].grid);
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
    expect(result.userPrompt).toBe(
      createCandidateDiscoveryRequest(unit).userPrompt,
    );
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
      exclusions: [
        {
          sourceId: getCandidateSources(unit)[1].sourceId,
          reason: '대상 제외',
        },
      ],
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
        {
          sourceId: getCandidateSources(unit)[1].sourceId,
          quote: '우물의 독립 본문이다.',
        },
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
      { ...p, evidence: [{ sourceId: 'outside', quote: '1호 우물' }] },
      {
        ...p,
        evidence: [
          {
            sourceId: getCandidateSources(unit)[0].sourceId,
            quote: '다른 원문',
          },
        ],
      },
      { ...p, sourceName: '추정 석축 우물' },
      { ...p, sourceIdentifier: '999' },
      { ...p, eligibilityBasis: 'explicit_context_unit' as const },
      { ...p, eligibilityBasis: 'table_item' as const },
    ];
    const result = await assembleCandidateDiscovery(plan, [
      audit(unit, {
        candidates: invalids,
        exclusions: [{ sourceId: 'outside', reason: 'invalid' }],
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
      identifierSourceId: getCandidateSources(tableUnit)[0].sourceId,
      sourceIdentifier: '2호',
      eligibilityBasis: 'table_item' as const,
      evidence: [
        { sourceId: getCandidateSources(tableUnit)[0].sourceId, quote: '2호' },
      ],
    };
    const ctxUnit = plan.units.at(-1)!;
    const contextCandidate = {
      ...p,
      sourceName: '우물 상부 폐기층',
      sourceIdentifier: null,
      recordKind: 'layer' as const,
      eligibilityBasis: 'explicit_context_unit' as const,
      evidence: [
        {
          sourceId: getCandidateSources(ctxUnit)[0].sourceId,
          quote: '우물 상부 폐기층',
        },
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
  test('presents verbatim source text with unique selectors and constrains model choices to those selectors', () => {
    const unit = prepare().units[0];
    const before = structuredClone(unit);
    const request = createCandidateDiscoveryRequest(unit);
    const payload = JSON.parse(request.userPrompt);
    expect(unit).toEqual(before);
    expect(
      payload.selectableSources.map(
        (source: { sourceId: string; text: string }) => [
          source.sourceId,
          source.text,
        ],
      ),
    ).toEqual([
      ['id:a', '1호 우물'],
      ['id:b', '우물의 독립 본문이다.'],
    ]);
    expect(payload.readOnlyContext).toEqual(
      unit.context.map((block) => ({ text: block.text })),
    );
    const schema = createCandidateDiscoverySchema(unit);
    expect(
      schema.safeParse({ candidates: [proposal(unit)], exclusions: [] })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({
        candidates: [
          {
            ...proposal(unit),
            evidence: [{ sourceId: 'id:not-in-unit', quote: '1호 우물' }],
          },
        ],
        exclusions: [],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        candidates: [],
        exclusions: [{ sourceId: 'path:context-only', reason: 'outside' }],
      }).success,
    ).toBe(false);
    const duplicate = structuredClone(unit);
    duplicate.resources[1].resourceId = duplicate.resources[0].resourceId;
    expect(
      getCandidateSources(duplicate).map((source) => source.sourceId),
    ).toEqual(duplicate.resources.map((resource) => `path:${resource.key}`));
    const tableUnit = prepare().units.find((u) => u.table)!;
    const cell = JSON.parse(
      createCandidateDiscoveryRequest(tableUnit).userPrompt,
    ).selectableSources[0];
    expect(cell.sourceId).toBe(`path:${tableUnit.resources[0].key}`);
    expect(cell.tableCell).toMatchObject({
      tableId: 't',
      rowIndex: 0,
      columnIndex: 0,
      rowSpan: 1,
      colSpan: 1,
    });
    expect(() =>
      createCandidateDiscoverySchema({ ...unit, resources: [] }),
    ).toThrow('no selectable sources');
  });
  test('rejects a quote paired with the adjacent heading and never relocates or rewrites the model response', async () => {
    const doc = input();
    doc.chapters[0].textBlocks = [
      { id: 'txt-522', text: '29. 옹기 단경호', pdfPageNo: 124 },
      {
        id: 'txt-523',
        sourceRef: '#/texts/2870',
        text: '우물 상부 폐기층에서 출토된 옹기 단경호편이다.',
        pdfPageNo: 124,
      },
    ];
    const plan = prepareCandidateDiscovery(buildDocumentResourceIndex(doc), {
      scopeChapterId: 'root',
      inputSha256: 'h',
      maxTextChars: 1000,
      tableRowsPerUnit: 1,
    });
    const unit = plan.units[0];
    const layer: CandidateDiscoveryResponse['candidates'][number] = {
      recordKind: 'layer',
      sourceName: '우물 상부 폐기층',
      sourceIdentifier: null,
      eligibilityBasis: 'explicit_context_unit',
      reason: '명시된 출토 맥락',
      evidence: [
        {
          sourceId: 'id:txt-522',
          quote: '우물 상부 폐기층에서 출토된 옹기 단경호편',
        },
      ],
    };
    const response = { candidates: [layer], exclusions: [] };
    const saved = audit(unit, response);
    const before = structuredClone(saved);
    const rejected = await assembleCandidateDiscovery(plan, [saved]);
    expect(rejected.candidates).toEqual([]);
    expect(rejected.issues[0].reason).toContain('exact input quote');
    expect(saved).toEqual(before);
    const selected = {
      ...layer,
      evidence: [{ ...layer.evidence[0], sourceId: 'id:txt-523' }],
    };
    const accepted = await assembleCandidateDiscovery(plan, [
      audit(unit, { candidates: [selected], exclusions: [] }),
    ]);
    expect(accepted.issues).toEqual([]);
    expect(accepted.candidates[0].evidence[0]).toMatchObject({
      sourceId: 'id:txt-523',
      resourceId: 'txt-523',
      resourceKey: unit.resources[1].key,
      sourceRefs: ['#/texts/2870'],
      quote: layer.evidence[0].quote,
    });
  });
});

describe('discovery retries and preserved source fragments', () => {
  test('retries only failed units and replays mixed prompt versions without rewriting retained audits', async () => {
    const plan = prepare();
    const tableUnit = plan.units.find(
      (u) => u.table && u.resources.some((r) => r.data.text === '2호'),
    )!;
    const oldAudit = {
      ...audit(plan.units[0], {
        candidates: [proposal(plan.units[0])],
        exclusions: [],
      }),
      ...createCandidateDiscoveryRequest(
        plan.units[0],
        'candidate-discovery.v4',
      ),
    };
    const badProposal = {
      ...proposal(tableUnit),
      sourceName: '우물 2호',
      identifierSourceId: getCandidateSources(tableUnit)[0].sourceId,
      sourceIdentifier: '2호',
      eligibilityBasis: 'table_item' as const,
      evidence: [
        { sourceId: getCandidateSources(tableUnit)[0].sourceId, quote: '2호' },
      ],
    };
    const audits = plan.units.map((u) =>
      u === plan.units[0]
        ? oldAudit
        : audit(u, {
            candidates: u === tableUnit ? [badProposal] : [],
            exclusions: [],
          }),
    );
    const before = structuredClone(audits);
    const retry = await prepareCandidateDiscoveryRetry(plan, audits);
    expect(retry.retryUnitIds).toEqual([tableUnit.unitId]);
    expect(retry.retainedAudits).toEqual(
      audits.filter((a) => a.unitId !== tableUnit.unitId),
    );
    expect(retry.result.completedUnitIds).toHaveLength(plan.units.length - 1);
    const replacement = audit(tableUnit, {
      candidates: [{ ...badProposal, sourceName: '우물' }],
      exclusions: [],
    });
    const result = await assembleCandidateDiscovery(plan, [
      ...retry.retainedAudits,
      replacement,
    ]);
    expect(result.completedUnitIds).toHaveLength(plan.units.length);
    expect(result.issues).toEqual([]);
    expect(result.candidates.map((c) => c.sourceName)).toEqual([
      '우물',
      '우물',
    ]);
    expect(result.candidates[1].sourceIdentifier).toBe('2호');
    expect(audits).toEqual(before);
    const tampered = { ...oldAudit, systemPrompt: replacement.systemPrompt };
    expect(
      (await assembleCandidateDiscovery(plan, [tampered])).issues[0].reason,
    ).toContain('does not match');
    await expect(
      prepareCandidateDiscoveryRetry(plan, [oldAudit]),
    ).rejects.toThrow('complete, replayable');
    await expect(
      prepareCandidateDiscoveryRetry(
        plan,
        plan.units.map((u) => audit(u, { candidates: [], exclusions: [] })),
      ),
    ).rejects.toThrow('No discovery issues');
  });

  test('preserves split words in separate blocks and rejects a repaired cross-block quote', async () => {
    const doc = input();
    doc.chapters[0].textBlocks = [
      { id: 'heading', text: '83. 백자 접시편', pdfPageNo: 116 },
      { id: 'end', text: '유약은 백청색을 띠고 전', pdfPageNo: 116 },
      { id: 'start', text: '체적으로 시유가 이루어졌다.', pdfPageNo: 117 },
    ];
    const plan = prepareCandidateDiscovery(buildDocumentResourceIndex(doc), {
      scopeChapterId: 'root',
      inputSha256: 'hash',
      maxTextChars: 8000,
      tableRowsPerUnit: 12,
    });
    const unit = plan.units[0];
    const p = {
      ...proposal(unit),
      recordKind: 'artifact' as const,
      sourceName: '백자 접시편',
      sourceIdentifier: '83',
      evidence: [
        { sourceId: 'id:heading', quote: '83. 백자 접시편' },
        { sourceId: 'id:end', quote: '전' },
        { sourceId: 'id:start', quote: '체적으로 시유가 이루어졌다.' },
      ],
    };
    const raw = audit(unit, { candidates: [p], exclusions: [] });
    const before = structuredClone(raw);
    const result = await assembleCandidateDiscovery(plan, [raw]);
    expect(result.issues).toEqual([]);
    expect(
      result.candidates[0].evidence.map((e) => ({
        quote: e.quote,
        pdfPageNo: e.pdfPageNo,
      })),
    ).toEqual([
      { quote: '83. 백자 접시편', pdfPageNo: 116 },
      { quote: '전', pdfPageNo: 116 },
      { quote: '체적으로 시유가 이루어졌다.', pdfPageNo: 117 },
    ]);
    const repaired = audit(unit, {
      candidates: [
        {
          ...p,
          evidence: [
            p.evidence[0],
            { sourceId: 'id:start', quote: '전체적으로 시유가 이루어졌다.' },
          ],
        },
      ],
      exclusions: [],
    });
    expect(
      (await assembleCandidateDiscovery(plan, [repaired])).candidates,
    ).toEqual([]);
    expect(raw).toEqual(before);
    expect(repaired.response.candidates[0].evidence[1].quote).toBe(
      '전체적으로 시유가 이루어졌다.',
    );
  });
});

describe('original table identifiers and chapter continuations', () => {
  test('retains merged header cells and rejects mismatched, missing and partial table identifiers without repairing responses', async () => {
    const doc = input();
    doc.tables[0].caption = { fullText: '수혈 속성표' };
    doc.tables[0].grid = [
      [
        { text: '번호', rowSpan: 2, colSpan: 1, isHeader: true },
        { text: '규모', rowSpan: 1, colSpan: 3, isHeader: true },
      ],
      [{ text: '길이', rowSpan: 1, colSpan: 1, isHeader: true }],
      [
        { text: '35', rowSpan: 1, colSpan: 1, isHeader: false },
        { text: '46', rowSpan: 1, colSpan: 1, isHeader: false },
        { text: '미상', rowSpan: 1, colSpan: 1, isHeader: false },
      ],
    ];
    const before = structuredClone(doc);
    const plan = prepareCandidateDiscovery(buildDocumentResourceIndex(doc), {
      scopeChapterId: 'root',
      inputSha256: 'hash',
      maxTextChars: 8000,
      tableRowsPerUnit: 12,
    });
    const unit = plan.units.find((u) => u.table)!;
    expect(
      JSON.parse(createCandidateDiscoveryRequest(unit).userPrompt).table
        .headerRows,
    ).toEqual(doc.tables[0].grid.slice(0, 2));
    const sources = getCandidateSources(unit);
    const cell = sources.find((s) => s.resource.data.text === '35')!;
    const last = sources.find((s) => s.resource.data.text === '46')!;
    const named = sources.find((s) => s.resource.data.text === '미상')!;
    const p = {
      ...proposal(unit),
      sourceName: '수혈',
      sourceIdentifier: '35',
      identifierSourceId: cell.sourceId,
      eligibilityBasis: 'table_item' as const,
      evidence: [{ sourceId: cell.sourceId, quote: '35' }],
    };
    const variants = [
      p,
      { ...p, sourceIdentifier: '3' },
      { ...p, sourceIdentifier: null, identifierSourceId: null },
      { ...p, identifierSourceId: 'outside' },
      { ...p, identifierSourceId: sources[0].sourceId },
      { ...p, identifierSourceId: last.sourceId },
      {
        ...p,
        evidence: [{ sourceId: last.sourceId, quote: '46' }, ...p.evidence],
      },
      {
        ...p,
        evidence: [
          { sourceId: cell.sourceId, quote: '3' },
          { sourceId: cell.sourceId, quote: '35' },
        ],
      },
      {
        ...p,
        identifierSourceId: null,
        sourceIdentifier: null,
        evidence: [{ sourceId: named.sourceId, quote: '미상' }],
      },
    ];
    const raw = audit(unit, { candidates: variants, exclusions: [] });
    const rawBefore = structuredClone(raw);
    const result = await assembleCandidateDiscovery(plan, [raw]);
    expect(result.candidates.map((c) => c.sourceIdentifier)).toEqual([
      '35',
      null,
    ]);
    expect(result.issues).toHaveLength(7);
    const historical = {
      ...raw,
      ...createCandidateDiscoveryRequest(unit, 'candidate-discovery.v6'),
    };
    expect(await assembleCandidateDiscovery(plan, [historical])).toEqual(
      result,
    );
    expect(raw).toEqual(rawBefore);
    expect(doc).toEqual(before);
    expect(
      createCandidateDiscoverySchema(unit).safeParse({
        candidates: [{ ...p, identifierSourceId: 'outside' }],
        exclusions: [],
      }).success,
    ).toBe(false);
  });

  test('keeps a sibling object description together through the next actual chapter title with original locations', () => {
    const doc = input();
    doc.chapters = [
      chapter({
        textBlocks: [],
        tableIds: [],
        children: [
          chapter({
            id: 'building',
            originTitle: '1) 건물지',
            textBlocks: [
              { id: 'h', text: '(5) 4호 건물지', pdfPageNo: 121 },
              {
                id: 'b',
                text: '4호 건물지는 위치와 조사 방법이 서술된다.',
                pdfPageNo: 121,
              },
            ],
          }),
          chapter({
            id: 'well',
            originTitle: '2) 우물',
            textBlocks: [
              {
                id: 'continuation',
                sourceRef: '#/texts/2826',
                text: '조사 결과 4호 건물지의 규모는 435cm이다.',
                pdfPageNo: 122,
              },
              { id: 'well-heading', text: '2) 우물 (도면 80)', pdfPageNo: 122 },
              {
                id: 'well-body',
                text: '우물은 조사대상지에 있다.',
                pdfPageNo: 122,
              },
            ],
          }),
          chapter({
            id: 'other',
            originTitle: '3) 기타',
            textBlocks: [{ text: '제목을 찾을 수 없는 본문', pdfPageNo: 123 }],
          }),
        ],
      }),
    ];
    const before = structuredClone(doc);
    const plan = prepareCandidateDiscovery(buildDocumentResourceIndex(doc), {
      scopeChapterId: 'root',
      inputSha256: 'hash',
      maxTextChars: 8000,
      tableRowsPerUnit: 12,
    });
    expect(plan.units[0].resources.map((r) => r.resourceId)).toEqual([
      'h',
      'b',
      'continuation',
    ]);
    expect(plan.units[0].resources[2]).toMatchObject({
      key: '/chapters/0/children/1/textBlocks/0',
      chapterIds: ['well'],
      sourceRefs: ['#/texts/2826'],
      pdfPageNo: 122,
    });
    expect(plan.units[1].resources.map((r) => r.resourceId)).toEqual([
      'well-heading',
      'well-body',
    ]);
    expect(plan.units[2].resources[0].data.text).toBe(
      '제목을 찾을 수 없는 본문',
    );
    expect(doc).toEqual(before);
  });

  test('replaces only selected input units while preserving historical v5 audits and checking retry bindings', async () => {
    const plan = prepare();
    const audits = plan.units.map((u) => ({
      ...audit(u, { candidates: [], exclusions: [] }),
      ...createCandidateDiscoveryRequest(u, 'candidate-discovery.v5'),
    }));
    const updated = structuredClone(plan);
    updated.units[0].context.push({ key: 'extra', text: '추가 원문 문맥' });
    updated.units[1].context.push({ key: 'unselected', text: '보존 대상' });
    const before = structuredClone(audits);
    const retry = await prepareCandidateDiscoveryRetry(plan, audits, {
      unitIds: [plan.units[0].unitId],
      updatedPlan: updated,
    });
    expect(retry.plan.units[0]).toEqual(updated.units[0]);
    expect(retry.plan.units[1]).toEqual(plan.units[1]);
    expect(retry.retainedAudits).toEqual(audits.slice(1));
    expect(audits).toEqual(before);
    for (const options of [
      { unitIds: ['missing'] },
      {
        unitIds: [plan.units[0].unitId],
        updatedPlan: { ...updated, inputSha256: 'other' },
      },
      {
        unitIds: [plan.units[0].unitId],
        updatedPlan: { ...updated, scopeChapterId: 'other' },
      },
      {
        unitIds: [plan.units[0].unitId],
        updatedPlan: { ...updated, units: [] },
      },
    ])
      await expect(
        prepareCandidateDiscoveryRetry(plan, audits, options),
      ).rejects.toThrow('matching original');
  });
});

test('keeps distinct explicit investigation areas eligible in a stratigraphy unit while replaying v6 unchanged', async () => {
  const doc = input();
  doc.chapters = [
    chapter({
      textBlocks: [
        {
          id: 'scope',
          text: '전체 사업대상범위 4,200㎡를 발굴하였다.',
          pdfPageNo: 1,
        },
        { id: 'subset', text: '시굴범위 900㎡를 조사하였다.', pdfPageNo: 1 },
        { id: 'deposit', text: '회색 퇴적층이 확인된다.', pdfPageNo: 1 },
      ],
    }),
  ];
  doc.tables = [];
  doc.chapters[0].tableIds = [];
  const plan = prepareCandidateDiscovery(buildDocumentResourceIndex(doc), {
      scopeChapterId: 'root',
      inputSha256: 'hash',
      maxTextChars: 8000,
      tableRowsPerUnit: 12,
    }),
    unit = plan.units[0],
    old = createCandidateDiscoveryRequest(unit, 'candidate-discovery.v6'),
    current = createCandidateDiscoveryRequest(unit),
    response: CandidateDiscoveryResponse = {
      candidates: [
        {
          recordKind: 'area',
          sourceName: '사업대상범위',
          sourceIdentifier: null,
          identifierSourceId: null,
          eligibilityBasis: 'explicit_context_unit',
          reason: 'Current whole extent',
          evidence: [
            { sourceId: 'id:scope', quote: '전체 사업대상범위 4,200㎡' },
          ],
        },
        {
          recordKind: 'area',
          sourceName: '시굴범위',
          sourceIdentifier: null,
          identifierSourceId: null,
          eligibilityBasis: 'explicit_context_unit',
          reason: 'Distinct current survey portion',
          evidence: [{ sourceId: 'id:subset', quote: '시굴범위 900㎡' }],
        },
        {
          recordKind: 'layer',
          sourceName: '퇴적층',
          sourceIdentifier: null,
          identifierSourceId: null,
          eligibilityBasis: 'explicit_context_unit',
          reason: 'Named context layer',
          evidence: [{ sourceId: 'id:deposit', quote: '회색 퇴적층' }],
        },
      ],
      exclusions: [],
    };
  expect(current.userPrompt).toBe(old.userPrompt);
  expect(current.systemPrompt).toContain(
    'EXPLICIT INVESTIGATION AREAS REQUIRE A SEPARATE REVIEW',
  );
  expect(old.systemPrompt).not.toContain(
    'EXPLICIT INVESTIGATION AREAS REQUIRE A SEPARATE REVIEW',
  );
  const oldAudit = { unitId: unit.unitId, ...old, response, usage },
    currentAudit = { unitId: unit.unitId, ...current, response, usage },
    before = structuredClone({ plan, oldAudit, currentAudit }),
    historical = await assembleCandidateDiscovery(plan, [oldAudit]),
    result = await assembleCandidateDiscovery(plan, [currentAudit]);
  expect(result.issues).toEqual([]);
  expect(result).toEqual(historical);
  expect(result.candidates.map((c) => c.recordKind)).toEqual([
    'area',
    'area',
    'layer',
  ]);
  expect(result.candidates.map((c) => c.evidence[0].quote)).toEqual(
    response.candidates.map((c) => c.evidence[0].quote),
  );
  expect({ plan, oldAudit, currentAudit }).toEqual(before);
});
