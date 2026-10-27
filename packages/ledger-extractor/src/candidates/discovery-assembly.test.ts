import type { CandidateDiscoveryResponse } from './discovery-types';

import { describe, expect, test, vi } from 'vitest';

import { buildDocumentResourceIndex } from '../resources/document-resource-index';
import {
  audit,
  chapter,
  input,
  prepare,
  proposal,
  registry,
  usage,
} from './candidate-discovery.test-fixture';
import { assembleCandidateDiscovery } from './discovery-assembly';
import { prepareCandidateDiscovery } from './discovery-plan';
import {
  createCandidateDiscoveryRequest,
  createCandidateDiscoverySchema,
  getCandidateSources,
} from './discovery-request';
import { createFollowUpUnit } from './discovery-rows';

vi.mock('@heripo/shared', () => ({ LLMCaller: { call: vi.fn() } }));

describe('candidate discovery', () => {
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
  expect(
    createCandidateDiscoveryRequest(unit, 'candidate-discovery.v9').userPrompt,
  ).toBe(old.userPrompt);
  // from v10 body sources carry their heading section
  expect(current.userPrompt).toContain('"section":"S0","sectionHeading":false');
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

test('reports item-table data rows below the headerRows that are neither proposed nor excluded in prompts v7 and v8', async () => {
  const cell = (text: string, isHeader = false) => ({
    text,
    colSpan: 1,
    rowSpan: 1,
    isHeader,
  });
  const doc = input();
  doc.chapters = [chapter({ tableIds: ['registry'] })];
  doc.tables = [
    {
      id: 'registry',
      pdfPageNo: 1,
      numRows: 6,
      numCols: 2,
      grid: [
        [cell('번호', true), cell('유물명', true)],
        [cell('1'), cell('기대')],
        [cell('2'), cell('뚜껑')],
        [cell('3'), cell('삼족기')],
        [cell(''), cell('')],
        [cell('4'), cell('소계', true)],
      ],
    },
  ];
  const plan = prepareCandidateDiscovery(buildDocumentResourceIndex(doc), {
    scopeChapterId: 'root',
    inputSha256: 'hash',
    maxTextChars: 8000,
    tableRowsPerUnit: 12,
  });
  const unit = plan.units[0];
  const id = (text: string) =>
    getCandidateSources(unit).find((s) => s.resource.data.text === text)!
      .sourceId;
  const item: CandidateDiscoveryResponse['candidates'][number] = {
    recordKind: 'artifact',
    sourceName: '기대',
    sourceIdentifier: '1',
    identifierSourceId: id('1'),
    eligibilityBasis: 'table_item',
    reason: '등록표 행',
    evidence: [
      { sourceId: id('1'), quote: '1' },
      { sourceId: id('기대'), quote: '기대' },
    ],
  };
  const response: CandidateDiscoveryResponse = {
    candidates: [item],
    exclusions: [{ sourceId: id('뚜껑'), reason: '중복 행' }],
  };
  const v6 = {
    unitId: unit.unitId,
    ...createCandidateDiscoveryRequest(unit, 'candidate-discovery.v6'),
    response,
    usage,
  };

  const current = await assembleCandidateDiscovery(plan, [
    {
      ...v6,
      ...createCandidateDiscoveryRequest(unit, 'candidate-discovery.v8'),
    },
  ]);
  const old = await assembleCandidateDiscovery(plan, [v6]);
  const v7 = await assembleCandidateDiscovery(plan, [
    {
      ...v6,
      ...createCandidateDiscoveryRequest(unit, 'candidate-discovery.v7'),
    },
  ]);
  const noItems = await assembleCandidateDiscovery(plan, [
    audit(unit, { candidates: [], exclusions: [] }),
  ]);
  // row 1 is the second of the headerRows given to the model, so leaving it unanswered is not an issue
  const laterItem = await assembleCandidateDiscovery(plan, [
    audit(unit, {
      candidates: [
        {
          ...item,
          sourceName: '삼족기',
          sourceIdentifier: '3',
          identifierSourceId: id('3'),
          evidence: [
            { sourceId: id('3'), quote: '3' },
            { sourceId: id('삼족기'), quote: '삼족기' },
          ],
        },
      ],
      exclusions: [{ sourceId: id('뚜껑'), reason: '중복 행' }],
    }),
  ]);

  expect(current.candidates).toHaveLength(1);
  expect(current.issues).toEqual([
    {
      unitId: unit.unitId,
      candidateIndex: null,
      reason: 'Table rows neither proposed nor excluded: 3',
    },
  ]);
  expect(v7.issues).toEqual(current.issues);
  expect(old.issues).toEqual([]);
  expect(old.candidates).toEqual(current.candidates);
  expect(noItems.issues).toEqual([]);
  expect(
    (
      await assembleCandidateDiscovery(plan, [
        {
          ...v6,
          ...createCandidateDiscoveryRequest(unit, 'candidate-discovery.v8'),
          response: { candidates: [], exclusions: [] },
        },
      ])
    ).issues,
  ).toEqual([]);
  expect(unit.table?.headerRows).toHaveLength(2);
  expect(laterItem.candidates).toHaveLength(1);
  expect(laterItem.issues).toEqual([]);
});

describe('prompt v9 table roles, exclusion categories and follow-ups', () => {
  test('requires a row-level category for unanswered item-table rows and keeps earlier responses without categories', async () => {
    const { plan, unit, id, item } = registry();
    const answered = await assembleCandidateDiscovery(plan, [
      audit(unit, {
        tableRole: 'item_table',
        candidates: [item('2', '뚜껑')],
        exclusions: [
          { sourceId: id('3'), category: 'passing_mention', reason: '언급' },
          { sourceId: id('합계'), category: 'summary_row', reason: '합계' },
        ],
      }),
    ]);
    const nonItem = await assembleCandidateDiscovery(plan, [
      audit(unit, {
        tableRole: 'non_item_table',
        candidates: [item('2', '뚜껑')],
        exclusions: [],
      }),
    ]);
    const uncategorized = await assembleCandidateDiscovery(plan, [
      audit(unit, {
        candidates: [item('2', '뚜껑')],
        exclusions: ['3', '4', '합계'].map((text) => ({
          sourceId: id(text),
          reason: '제외',
        })),
      }),
    ]);

    expect(answered.candidates).toHaveLength(1);
    expect(answered.issues).toEqual([
      {
        unitId: unit.unitId,
        candidateIndex: null,
        reason:
          'Table rows neither proposed nor excluded with a row-level category: 3, 4',
      },
    ]);
    expect(answered.exclusions.map((e) => e.category)).toEqual([
      'passing_mention',
      'summary_row',
    ]);
    expect(nonItem.candidates).toEqual([]);
    expect(nonItem.issues.map((i) => i.reason)).toEqual([
      'Table item proposed in a unit answered as a non-item table',
    ]);
    expect(uncategorized.issues).toEqual([]);
    expect(uncategorized.exclusions[0]).not.toHaveProperty('category');
  });

  test('rejects header names, names outside the selected body cell and figure references in identifiers', async () => {
    const { plan, unit, id, item } = registry();
    const reasons = async (
      candidate: CandidateDiscoveryResponse['candidates'][number],
    ) =>
      (
        await assembleCandidateDiscovery(plan, [
          audit(unit, { candidates: [candidate], exclusions: [] }),
        ])
      ).issues.map((i) => i.reason);

    expect(
      await reasons({ ...item('2', '뚜껑'), sourceName: '유물명' }),
    ).toContain('Table item name is a column header');
    const nameRule =
      'Table item name must come from its selected body cell, the caption, the chapter titles or the context';
    for (const nameSourceId of [id('번호'), id('3'), 'path:missing'])
      expect(await reasons({ ...item('2', '뚜껑'), nameSourceId })).toContain(
        nameRule,
      );
    // named from the chapter title while selecting the number cell
    expect(
      await reasons({
        ...item('2', '뚜껑'),
        sourceName: '조사 내용',
        nameSourceId: id('2'),
      }),
    ).not.toContain(nameRule);
    expect(
      await reasons({
        ...item('2', '뚜껑'),
        sourceIdentifier: '도면 1',
        identifierSourceId: id('도면 1'),
        nameSourceId: null,
        evidence: [{ sourceId: id('도면 1'), quote: '도면 1' }],
      }),
    ).toContain('Source identifier includes a figure or plate reference');
    expect(
      await reasons({ ...item('2', '뚜껑'), nameSourceId: null }),
    ).not.toContain(nameRule);
    const body = prepare();
    expect(
      (
        await assembleCandidateDiscovery(body, [
          audit(body.units[0], {
            candidates: [{ ...proposal(body.units[0]), nameSourceId: 'id:a' }],
            exclusions: [],
          }),
        ])
      ).issues,
    ).toEqual([]);
  });

  test('merges a follow-up that asks exactly the unanswered rows and rejects a mismatched or malformed one', async () => {
    const { plan, unit, id, item } = registry();
    const first: CandidateDiscoveryResponse = {
      tableRole: 'item_table',
      candidates: [item('2', '뚜껑')],
      exclusions: [
        { sourceId: id('합계'), category: 'summary_row', reason: '합계' },
      ],
    };
    const followUp = {
      rowIndexes: [3, 4],
      userPrompt: createCandidateDiscoveryRequest(
        createFollowUpUnit(unit, [3, 4]),
      ).userPrompt,
      response: {
        tableRole: 'item_table' as const,
        candidates: [item('3', '삼족기')],
        exclusions: [
          {
            sourceId: id('4'),
            category: 'previous_or_external' as const,
            reason: '이전 조사',
          },
        ],
      },
      usage,
    };
    const assemble = (overrides: object) =>
      assembleCandidateDiscovery(plan, [
        { ...audit(unit, first), followUp, ...overrides },
      ]);

    const merged = await assemble({});
    expect(merged.candidates.map((c) => c.sourceName)).toEqual([
      '뚜껑',
      '삼족기',
    ]);
    expect(merged.issues).toEqual([]);
    expect(merged.exclusions).toHaveLength(2);
    const mismatch =
      'Saved follow-up does not match the unanswered rows, corrections and reconsidered headings of this unit';
    expect(
      (await assemble({ followUp: { ...followUp, rowIndexes: [3] } })).issues[0]
        .reason,
    ).toBe(mismatch);
    expect(
      (await assemble({ followUp: { ...followUp, userPrompt: '{}' } }))
        .issues[0].reason,
    ).toBe(mismatch);
    expect(
      (
        await assemble({
          ...createCandidateDiscoveryRequest(unit, 'candidate-discovery.v8'),
        })
      ).issues[0].reason,
    ).toBe(mismatch);
    expect(
      (await assemble({ followUp: { ...followUp, response: null } })).issues[0]
        .reason,
    ).toBe('Invalid saved model response schema');
  });
});
