import type { ProcessedDocument } from '@heripo/model';

import { describe, expect, test, vi } from 'vitest';

import { buildDocumentResourceIndex } from '../resources/document-resource-index';
import {
  chapter,
  input,
  sideBySideRegister,
} from './candidate-discovery.test-fixture';
import { assembleCandidateDiscovery } from './discovery-assembly';
import {
  CANDIDATE_DISCOVERY_MAX_MOVED_BLOCKS,
  isSameCandidateDiscoveryScope,
  prepareCandidateDiscovery,
} from './discovery-plan';

vi.mock('@heripo/shared', () => ({ LLMCaller: { call: vi.fn() } }));

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

  test('reads tables outside the scope with their own chapter and the short text of their page', () => {
    const index = buildDocumentResourceIndex(input());
    const plan = prepareCandidateDiscovery(index, {
      scopeChapterId: 'child',
      inputSha256: 'h',
      maxTextChars: 100,
      tableRowsPerUnit: 1,
      tableIds: ['t'],
    });

    expect(plan.units.map((u) => [u.chapterId, u.table?.id ?? null])).toEqual([
      ['child', null],
      ['root', 't'],
      ['root', 't'],
    ]);
    expect(plan.units[1].chapterPath.map((c) => c.id)).toEqual(['root']);
    expect(plan.units[1].context.map((c) => c.text)).toEqual(['1호 우물']);
    expect(() =>
      prepareCandidateDiscovery(index, {
        scopeChapterId: 'child',
        inputSha256: 'h',
        maxTextChars: 100,
        tableRowsPerUnit: 1,
        tableIds: ['missing'],
      }),
    ).toThrow('Table not found: missing');
  });

  test('lists the register rows of a table outside the scope whose number the scope writes with a Latin prefix', () => {
    const doc = input();
    doc.chapters[0].children![0].textBlocks = [
      { text: '묘 M2와 99XXM2를 조사했다.', pdfPageNo: 3 },
      { text: '묘 K3과 수혈 H3도 조사했다.', pdfPageNo: 3 },
    ];
    doc.tables[0].grid = [
      [{ text: '墓号', colSpan: 1, rowSpan: 1, isHeader: true }],
      [{ text: '2A', colSpan: 1, rowSpan: 1, isHeader: false }],
      [{ text: '2B', colSpan: 1, rowSpan: 1, isHeader: false }],
      [{ text: '3', colSpan: 1, rowSpan: 1, isHeader: false }],
    ];
    const plan = prepareCandidateDiscovery(buildDocumentResourceIndex(doc), {
      scopeChapterId: 'child',
      inputSha256: 'h',
      maxTextChars: 100,
      tableRowsPerUnit: 3,
      tableIds: ['t'],
    });

    // row 3 is left out: the scope writes 3 for a tomb (K3) and for a pit (H3)
    expect(plan.units[1].table?.registerRows).toEqual([
      { rowIndex: 1, number: '2', writtenAs: 'M2' },
      { rowIndex: 2, number: '2', writtenAs: 'M2' },
    ]);
    expect(plan.units[1].context.map((c) => c.text)).toEqual([
      '1호 우물',
      '묘 M2와 99XXM2를 조사했다.',
    ]);
    expect(plan.units[2].table).not.toHaveProperty('registerRows');
    expect(plan.units[1].table).not.toHaveProperty('columnBlocks');
  });

  test('lists the register blocks of a register that holds several numbered objects in each row', () => {
    const { unit } = sideBySideRegister();

    expect(unit.table?.columnBlocks).toEqual({ count: 2, columnsPerBlock: 3 });
    expect(unit.table?.registerRows).toEqual([
      { rowIndex: 2, block: 0, number: '201', writtenAs: 'M201' },
      { rowIndex: 2, block: 1, number: '301', writtenAs: 'M301' },
      { rowIndex: 3, block: 0, number: '202', writtenAs: 'M202' },
    ]);
    expect(unit.context.map((c) => c.text)).toEqual([
      '1호 우물',
      '墓 M201、M301、M202。',
    ]);
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
});

describe('original table identifiers and chapter continuations', () => {
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
});

describe('aligned text unit boundaries', () => {
  const long = (label: string) => `${label} ${'설명'.repeat(70)}`;
  const plan = (
    texts: string[],
    maxTextChars: number,
    maxLabelledNumbers?: number,
  ) => {
    const doc = input();
    doc.tables = [];
    doc.chapters = [
      chapter({
        tableIds: [],
        textBlocks: texts.map((text, i) => ({
          id: `t${i}`,
          text,
          pdfPageNo: 1,
        })),
      }),
    ];
    return prepareCandidateDiscovery(buildDocumentResourceIndex(doc), {
      scopeChapterId: 'root',
      inputSha256: 'hash',
      maxTextChars,
      tableRowsPerUnit: 1,
      maxLabelledNumbers,
    }).units.map((u) => u.resources.map((r) => r.resourceId));
  };

  test('moves a trailing run of short blocks before a long block to the next unit', () => {
    const texts = [
      long('앞'),
      '마도23-19',
      'Celadon dish',
      long('뒤'),
      long('끝'),
    ];
    const fit = texts[0].length + texts[1].length + texts[2].length;

    expect(plan(texts, fit)).toEqual([['t0'], ['t1', 't2', 't3'], ['t4']]);
  });

  test('keeps the boundary when the next block is short, the unit is all short or the run is too long', () => {
    const shortNext = [long('앞'), '마도23-19', 'Celadon dish', '높이 3.4cm'];
    const allShort = ['마도23-19', 'Celadon dish', long('뒤')];
    const manyShort = [
      long('앞'),
      ...Array.from(
        { length: CANDIDATE_DISCOVERY_MAX_MOVED_BLOCKS + 1 },
        (_, i) => `줄 ${i}`,
      ),
      long('뒤'),
    ];
    const size = (texts: string[], n: number) =>
      texts.slice(0, n).reduce((a, t) => a + t.length, 0);

    expect(plan(shortNext, size(shortNext, 3))).toEqual([
      ['t0', 't1', 't2'],
      ['t3'],
    ]);
    expect(plan(allShort, size(allShort, 2))).toEqual([['t0', 't1'], ['t2']]);
    expect(plan(manyShort, size(manyShort, 12))[0]).toHaveLength(12);
  });

  test('closes a unit before it would hold more labelled numbers than the limit', () => {
    const catalog = [
      `示例类型。标本M102:11，灰色。标本M102:12，灰色。${'口径'.repeat(60)}`,
      `另一示例类型。标本M112:18，红色。${'口径'.repeat(60)}`,
      `第三示例类型。标本M111:2，灰色。标本M111:3，灰色。${'口径'.repeat(60)}`,
      `第四示例类型。标本M107:10，灰色。标本M107:11。标本M107:12。${'口径'.repeat(60)}`,
    ];

    expect(plan(catalog, 100_000, 3)).toEqual([['t0', 't1'], ['t2'], ['t3']]);
    expect(plan(catalog, 100_000)).toEqual([['t0', 't1', 't2', 't3']]);
  });
});

describe('multi-chapter discovery scope', () => {
  const doc = (): ProcessedDocument => ({
    ...input(),
    chapters: [
      chapter({
        id: 'range',
        originTitle: '조사 범위',
        textBlocks: [{ text: '1지점과 2지점을 조사하였다.', pdfPageNo: 1 }],
      }),
      chapter({
        id: 'other',
        originTitle: '주변 유적',
        textBlocks: [{ text: '주변 유적 설명', pdfPageNo: 1 }],
      }),
      chapter({
        id: 'trench',
        originTitle: '시굴 조사',
        textBlocks: [
          { text: '앞 문단에서 이어진 문장이다.', pdfPageNo: 2 },
          { text: '시굴 조사 1트렌치', pdfPageNo: 2 },
        ],
        children: [chapter({ id: 'trench-child', originTitle: '세부' })],
      }),
    ],
    tables: [],
  });
  const options = (scopeChapterId: string | string[]) => ({
    scopeChapterId,
    inputSha256: 'hash',
    maxTextChars: 100,
    tableRowsPerUnit: 1,
  });

  test('plans distinct chapters in document order without moving text across separate scopes', async () => {
    const index = buildDocumentResourceIndex(doc());

    const plan = prepareCandidateDiscovery(index, options(['trench', 'range']));

    expect(plan).toMatchObject({
      scopeChapterId: 'range',
      scopeChapterIds: ['range', 'trench'],
      scopeTitle: '조사 범위 · 시굴 조사',
    });
    expect(plan.units.map((u) => u.chapterId)).toEqual(['range', 'trench']);
    expect(plan.units[1].resources.map((r) => r.data.text)).toEqual([
      '앞 문단에서 이어진 문장이다.',
      '시굴 조사 1트렌치',
    ]);
    expect(
      prepareCandidateDiscovery(index, options(['range', 'trench'])),
    ).toEqual(plan);
    const single = prepareCandidateDiscovery(index, options(['range']));
    expect(single).not.toHaveProperty('scopeChapterIds');
    expect(single).not.toHaveProperty('scopeSource');
    const scopeSource = { kind: 'profile' as const, profileSha256: 'abc' };
    const fromProfile = prepareCandidateDiscovery(index, {
      ...options(['range', 'trench']),
      scopeSource,
    });
    expect(fromProfile).toEqual({ ...plan, scopeSource });
    expect(fromProfile.scopeSource).not.toBe(scopeSource);
    expect(single).toEqual(prepareCandidateDiscovery(index, options('range')));
    const result = await assembleCandidateDiscovery(plan, []);
    expect(result.scopeChapterIds).toEqual(['range', 'trench']);
    expect(isSameCandidateDiscoveryScope(plan, result)).toBe(true);
    expect(isSameCandidateDiscoveryScope(plan, single)).toBe(false);
  });

  test('rejects unknown, repeated and nested scope chapters', () => {
    const index = buildDocumentResourceIndex(doc());
    for (const scope of [[], ['missing'], ['range', 'missing']])
      expect(() => prepareCandidateDiscovery(index, options(scope))).toThrow(
        'Scope chapter not found',
      );
    for (const scope of [
      ['range', 'range'],
      ['trench', 'trench-child'],
    ])
      expect(() => prepareCandidateDiscovery(index, options(scope))).toThrow(
        'distinct and not nested',
      );
  });
});
