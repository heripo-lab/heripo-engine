import type { ProcessedDocument } from '@heripo/model';

import type { DocumentResource } from '../../resources/document-resource-index';
import type {
  AttachmentRegistryEntry,
  AttachmentUnit,
  ContentAttachmentPlan,
} from '../types';

import { describe, expect, test } from 'vitest';

import { buildDocumentResourceIndex } from '../../resources/document-resource-index';
import { createContentAttachmentThinInput } from './compile';
import { isContentAttachmentThinTrivialText } from './compile-candidates';
import {
  CONTENT_ATTACHMENT_THIN_COMPILE_VERSION,
  CONTENT_ATTACHMENT_THIN_LINKED_COMPILE_VERSION,
  CONTENT_ATTACHMENT_THIN_LOCAL_COMPILE_VERSION,
  CONTENT_ATTACHMENT_THIN_LOCAL_LINKED_COMPILE_VERSION,
} from './compile-types';

const cell = (text: string, isHeader = false) => ({
  text,
  isHeader,
  rowSpan: 1,
  colSpan: 1,
});
const longSentence = Array.from({ length: 20 }, (_, i) => `w${i + 1}`).join(
  ' ',
);

function fixture() {
  const document: ProcessedDocument = {
    reportId: 'report',
    pageRangeMap: {},
    images: [],
    footnotes: [],
    chapters: [
      {
        id: 'survey',
        title: '1. 시굴조사',
        originTitle: '1. 시굴조사',
        level: 1,
        pageNo: 1,
        imageIds: [],
        footnoteIds: [],
        tableIds: ['inventory', 'log'],
        textBlocks: [
          {
            id: 'b0',
            pdfPageNo: 1,
            text: '시굴조사 결과 트렌치 1에서 수혈 3호와 도로를 확인하였다. 29. 목록',
          },
          { id: 'b1', pdfPageNo: 1, text: `  ${longSentence}. 끝.  ` },
          { id: 'b2', pdfPageNo: 1, text: '' },
          { id: 'b3', pdfPageNo: 1, text: '본격적인 조사에 앞서,' },
        ],
      },
    ],
    tables: [
      {
        id: 'inventory',
        pdfPageNo: 1,
        numRows: 3,
        numCols: 3,
        caption: { fullText: '표 1 트렌치 현황' },
        grid: [
          [cell('번호', true), cell('유구', true), cell('비고', true)],
          [cell('1'), cell('수혈 3호'), cell('')],
          [cell('9'), cell('없음'), cell('기타')],
        ],
      },
      {
        id: 'log',
        pdfPageNo: 1,
        numRows: 1,
        numCols: 1,
        grid: [[cell('흐림')]],
      },
    ],
  };
  const index = buildDocumentResourceIndex(document);
  const sources = index.resources
    .filter(
      (r): r is Extract<DocumentResource, { kind: 'text' | 'tableCell' }> =>
        (r.kind === 'text' && r.key !== '/chapters/0/textBlocks/3') ||
        r.kind === 'tableCell',
    )
    .map((resource) => ({ sourceId: `source:${resource.key}`, resource }));
  const source = (key: string) => sources.find((s) => s.resource.key === key)!;
  const evidence = (key: string, quote: string) => {
    const s = source(key);
    return [
      {
        sourceId: s.sourceId,
        resourceKey: key,
        resourceId: s.resource.resourceId,
        sourceRefs: s.resource.sourceRefs,
        pdfPageNo: 1,
        logicalPageRange: null,
        quote,
        charStart: s.resource.data.text.indexOf(quote),
        charEnd: s.resource.data.text.indexOf(quote) + quote.length,
      },
    ];
  };
  const surveyPath = [{ id: 'survey', originTitle: '1. 시굴조사' }];
  const otherPath = [{ id: 'other', originTitle: '2. 발굴조사' }];
  const bigPath = [{ id: 'big', originTitle: 'A. 트렌치' }];
  const shortPath = [{ id: 'short', originTitle: '1) 구' }];
  const entry = (
    ref: string,
    recordKind: AttachmentRegistryEntry['recordKind'],
    sourceName: string,
    sourceIdentifier: string | null,
    chapterPath: typeof surveyPath,
    ev = evidence('/chapters/0/textBlocks/0', '시굴조사'),
  ): AttachmentRegistryEntry => ({
    ref,
    groupId: `g-${ref}`,
    recordKind,
    mentions: [
      {
        candidateId: `c-${ref}`,
        sourceName,
        sourceIdentifier,
        chapterPath,
        evidence: ev,
      },
    ],
  });
  const registry: AttachmentRegistryEntry[] = [
    entry('R1', 'area', '사업범위', null, otherPath),
    entry(
      'R2',
      'trench',
      '트렌치',
      '1',
      surveyPath,
      evidence('/tables/0/grid/1/0', '1'),
    ),
    entry(
      'R3',
      'feature',
      '수혈',
      '3호',
      otherPath,
      evidence('/tables/0/grid/1/1', '수혈 3호'),
    ),
    entry('R4', 'feature', '도로', null, otherPath),
    entry('R5', 'feature', '수', null, otherPath),
    entry('R6', 'feature', '구상유구', null, otherPath),
    entry('R7', 'feature', '건물지', '9', surveyPath),
    entry('R8', 'feature', '건물지', '9', otherPath),
    entry('R9', 'feature', '우물', '7호', otherPath),
    entry('R10', 'feature', '주공', null, shortPath),
    ...Array.from({ length: 31 }, (_, i) =>
      entry(`R${11 + i}`, 'artifact', '편', `${100 + i}`, bigPath),
    ),
  ];
  const unit: AttachmentUnit = {
    unitId: 'page-1',
    pdfPageNo: 1,
    sources,
    chapters: [{ chapterId: 'survey', path: surveyPath }],
    tables: index.resources
      .filter(
        (r): r is Extract<DocumentResource, { kind: 'table' }> =>
          r.kind === 'table',
      )
      .map((r) => ({ key: r.key, data: r.data })),
    readOnlyContext: [
      {
        resourceKey: '/chapters/0/textBlocks/3',
        text: '본격적인 조사에 앞서,',
      },
      { resourceKey: '/footnotes/0', text: '주석' },
    ],
  };
  const plan: ContentAttachmentPlan = {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: 'input',
    candidateSnapshotId: 'snapshot',
    registrySha256: 'registry',
    registryUncertainties: [
      { leftCandidateId: 'c-R3', rightCandidateId: 'c-R9', reason: 'offered' },
      { leftCandidateId: 'c-R9', rightCandidateId: 'c-R11', reason: 'hidden' },
    ],
    registry,
    pages: [{ pdfPageNo: 1, unitIds: ['page-1'], status: 'planned' }],
    units: [unit],
  };
  return { plan, unit };
}

describe('createContentAttachmentThinInput', () => {
  test('offers kinds, literal matches, same-chapter numbers and small title chapters only', () => {
    const { plan, unit } = fixture();

    const { version, input, codeMap } = createContentAttachmentThinInput(
      plan,
      unit,
    );

    expect(version).toBe(CONTENT_ATTACHMENT_THIN_COMPILE_VERSION);
    expect(codeMap.candidateRefs).toEqual(['R1', 'R2', 'R3', 'R4', 'R7']);
    expect(input.candidates.map((row) => row[0])).toEqual(
      codeMap.candidateRefs,
    );
    expect(input.candidates[1]).toEqual([
      'R2',
      'trench',
      'C2',
      '트렌치',
      '1',
      [['K2.1', '1']],
    ]);
    expect(Object.keys(input.contexts)).toEqual(['C1', 'C2']);
    expect(input.uncertainties).toEqual([
      { refs: ['R3', 'R9'], reason: 'offered' },
    ]);
    expect(input.chapters).toEqual(['1. 시굴조사']);
  });

  test('offers a single-unit layer only in its unit and next to it in its chapter under the local layer policy', () => {
    const { plan, unit } = fixture();
    const others = ['far', 'next-but-one', 'next'].map(
      (unitId, i) =>
        ({
          ...unit,
          unitId,
          sources: [{ ...unit.sources[0], resource: { key: `/other/${i}` } }],
        }) as unknown as AttachmentUnit,
    );
    plan.units = [...others, unit];
    const layer = (
      ref: string,
      keys: string[],
      chapterPath = unit.chapters[0].path,
    ) => {
      const e = structuredClone(plan.registry[0]);
      e.ref = ref;
      e.groupId = `g-${ref}`;
      e.recordKind = 'layer';
      e.mentions[0].chapterPath = chapterPath;
      e.mentions[0].evidence = keys.map(
        (resourceKey) =>
          ({ resourceKey }) as (typeof e.mentions)[0]['evidence'][0],
      );
      return e;
    };
    plan.registry.push(
      layer('L1', [unit.sources[0].resource.key]),
      layer('L2', ['/other/0']),
      layer('L3', ['/other/2']),
      layer('L4', ['/other/0', '/other/1']),
      layer('L5', []),
      layer('L6', ['/elsewhere']),
      layer('L7', ['/other/2'], [{ id: 'other', originTitle: '2. 발굴조사' }]),
      layer('L8', ['/other/2'], []),
      layer(
        'L9',
        [unit.sources[0].resource.key],
        [{ id: 'other', originTitle: '2. 발굴조사' }],
      ),
    );

    const all = createContentAttachmentThinInput(plan, unit);
    plan.thinPolicy = { layers: 'local' };
    const local = createContentAttachmentThinInput(plan, unit);

    expect(all.version).toBe(CONTENT_ATTACHMENT_THIN_COMPILE_VERSION);
    expect(all.codeMap.candidateRefs).toEqual(
      expect.arrayContaining([
        'L1',
        'L2',
        'L3',
        'L4',
        'L5',
        'L6',
        'L7',
        'L8',
        'L9',
      ]),
    );
    expect(local.version).toBe(CONTENT_ATTACHMENT_THIN_LOCAL_COMPILE_VERSION);
    expect(
      local.codeMap.candidateRefs.filter((r) => r.startsWith('L')),
    ).toEqual(['L1', 'L3', 'L4', 'L5', 'L6', 'L8', 'L9']);
    expect(local.input.candidates.map((row) => row[0])).toEqual(
      local.codeMap.candidateRefs,
    );
  });

  test('links the preceding page context into the first block reading order under linked continuity', () => {
    const { plan, unit } = fixture();
    const prior = (key: string, text: string) => ({
      sourceId: `source:${key}`,
      resource: { ...unit.sources[0].resource, key, data: { text } },
    });
    const previous = {
      ...unit,
      unitId: 'page-0',
      sources: [
        unit.sources.find((x) => x.resource.kind === 'tableCell')!,
        prior('/chapters/9/textBlocks/3', '앞 장 머리'),
        prior('/chapters/9/textBlocks/4', '도로는 남북으로'),
        prior('/chapters/9/textBlocks/5', '이어지며'),
      ],
    } as unknown as AttachmentUnit;
    plan.units = [previous, unit];
    unit.readOnlyContext = [
      { resourceKey: '/chapters/9/textBlocks/4', text: '도로는 남북으로' },
      { resourceKey: '/chapters/9/textBlocks/5', text: '이어지며' },
      ...unit.readOnlyContext,
      { resourceKey: '/chapters/8/textBlocks/0', text: '다음 장' },
    ];
    const at = (ref: string, key: string) => {
      const e = plan.registry.find((r) => r.ref === ref)!;
      e.mentions[0].evidence = [
        {
          ...e.mentions[0].evidence[0],
          resourceKey: key,
        },
      ];
    };
    at('R4', '/chapters/9/textBlocks/5');
    at('R9', '/chapters/9/textBlocks/5');

    const before = createContentAttachmentThinInput(plan, unit);
    plan.thinPolicy = { layers: 'all', continuity: 'linked' };
    const linked = createContentAttachmentThinInput(plan, unit);
    plan.thinPolicy = { layers: 'local', continuity: 'linked' };
    const local = createContentAttachmentThinInput(plan, unit);

    expect(before.version).toBe(CONTENT_ATTACHMENT_THIN_COMPILE_VERSION);
    expect(before.input.bodySequences[0].slice(0, 2)).toEqual(['E1', 'E2']);
    expect(before.input.bodySequences).toContainEqual(['X1', 'X2']);
    expect(before.input.readOnlyContext.some((x) => 'evidenceOf' in x)).toBe(
      false,
    );
    expect(linked.version).toBe(CONTENT_ATTACHMENT_THIN_LINKED_COMPILE_VERSION);
    expect(local.version).toBe(
      CONTENT_ATTACHMENT_THIN_LOCAL_LINKED_COMPILE_VERSION,
    );
    expect(linked.input.bodySequences[0].slice(0, 3)).toEqual([
      'X1',
      'X2',
      'E1',
    ]);
    expect(linked.input.bodySequences).not.toContainEqual(['X1', 'X2']);
    expect(linked.input.bodySequences).toContainEqual(['X5']);
    expect(linked.input.readOnlyContext.map((x) => x.evidenceOf)).toEqual([
      undefined,
      ['R4'],
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(linked.codeMap).toEqual(before.codeMap);
  });

  test('keeps reading order when the preceding context is in the same sequence, absent or not before text', () => {
    const { plan, unit } = fixture();
    plan.thinPolicy = { layers: 'all', continuity: 'linked' };
    const previous = {
      ...unit,
      unitId: 'page-0',
      sources: [
        {
          sourceId: 'p',
          resource: {
            ...unit.sources[0].resource,
            key: '/chapters/0/textBlocks/9',
            data: { text: '같은 장' },
          },
        },
      ],
    } as unknown as AttachmentUnit;
    plan.units = [previous, unit];
    unit.readOnlyContext = [
      { resourceKey: '/chapters/0/textBlocks/9', text: '같은 장' },
    ];
    const plain = (u: AttachmentUnit) => {
      const off = structuredClone(plan);
      delete off.thinPolicy;
      return createContentAttachmentThinInput(off, u).input;
    };

    const same = createContentAttachmentThinInput(plan, unit).input;
    unit.readOnlyContext = [{ resourceKey: '/elsewhere', text: '다른 곳' }];
    const absent = createContentAttachmentThinInput(plan, unit).input;
    const absentPlain = plain(unit);
    const tableFirst = {
      ...unit,
      sources: [...unit.sources].reverse(),
    } as AttachmentUnit;
    plan.units = [previous, tableFirst];

    expect(same.bodySequences[0]).toEqual(['E1', 'E2', 'E3', 'X1']);
    expect(same.readOnlyContext[0].evidenceOf).toBeUndefined();
    expect(absent.bodySequences).toEqual(absentPlain.bodySequences);
    expect(
      createContentAttachmentThinInput(plan, tableFirst).input.bodySequences,
    ).toEqual(plain(tableFirst).bodySequences);
  });

  test('builds one handle per chapter node and record kind', () => {
    const { plan, unit } = fixture();

    const { input, codeMap } = createContentAttachmentThinInput(plan, unit);

    expect(input.handleColumns).toEqual([
      'ref',
      'chapterPath',
      'kind',
      'memberCount',
    ]);
    expect(input.handles.slice(0, 3)).toEqual([
      ['H1', '2. 발굴조사', 'area', 1],
      ['H2', '1. 시굴조사', 'trench', 1],
      ['H3', '2. 발굴조사', 'feature', 6],
    ]);
    expect(codeMap.handles.at(-1)).toEqual({
      ref: 'H6',
      members: Array.from({ length: 31 }, (_, i) => `R${11 + i}`),
    });
  });

  test('addresses words in windows and segments sentences in Q/L ranges', () => {
    const { plan, unit } = fixture();

    const { input, codeMap } = createContentAttachmentThinInput(plan, unit);

    expect(input.bodyBlocks[0].segments).toEqual([
      ['E1:S1', ['Q1:L1-L8']],
      ['E1:S2', ['Q1:L9-L10']],
    ]);
    expect(
      input.bodyBlocks[1].windows.map(([q, words]) => [q, words.length]),
    ).toEqual([
      ['Q2', 16],
      ['Q3', 5],
    ]);
    expect(input.bodyBlocks[1].segments).toEqual([
      ['E2:S1', ['Q2:L1-L16', 'Q3:L1-L4']],
      ['E2:S2', ['Q3:L5-L5']],
    ]);
    expect(input.bodyBlocks[2]).toEqual({
      ref: 'E3',
      windows: [],
      segments: [],
    });
    expect(codeMap.windows[1]).toEqual({
      ref: 'Q2',
      sourceRef: 'E2',
      originalWords: Array.from({ length: 16 }, (_, i) => `W${i + 1}`),
    });
    expect(codeMap.segSpans.slice(0, 3)).toEqual([
      {
        seg: 'E1:S1',
        key: '/chapters/0/textBlocks/0',
        charStart: 0,
        charEnd: 33,
        llm: true,
      },
      {
        seg: 'E1:S2',
        key: '/chapters/0/textBlocks/0',
        charStart: 34,
        charEnd: 40,
        llm: true,
      },
      {
        seg: 'E2:S1',
        key: '/chapters/0/textBlocks/1',
        charStart: 2,
        charEnd: 3 + longSentence.length,
        llm: true,
      },
    ]);
  });

  test('assigns registration row owners and cell-registered candidates in code and keeps other cells as segments', () => {
    const { plan, unit } = fixture();

    const { input, codeMap } = createContentAttachmentThinInput(plan, unit);

    const [inventory, log] = input.tables;
    expect(inventory.ref).toBe('T1');
    expect(inventory.rows[0].cells.every((c) => c.header)).toBe(true);
    expect(inventory.rows[1].cells.map((c) => c.rowOwner)).toEqual([
      'R2',
      'R2',
      undefined,
    ]);
    expect(inventory.rows[1].cells[2]).toEqual({
      ref: 'E9',
      header: false,
      windows: [],
    });
    expect(inventory.rows[2].cells[1].segments).toEqual([
      ['E11:S1', ['Q10:L1-L1']],
    ]);
    expect(log).toEqual({
      ref: 'T2',
      rows: [
        {
          index: 0,
          cells: [
            {
              ref: 'E13',
              header: false,
              windows: [['Q12', ['흐림']]],
              segments: [['E13:S1', ['Q12:L1-L1']]],
            },
          ],
        },
      ],
    });
    expect(inventory.rows[1].cells[1].registeredInCell).toEqual(['R3']);
    expect(inventory.rows[1].cells[0].registeredInCell).toBeUndefined();
    expect(codeMap.codeAssigned).toEqual([
      ['E7:S1', 'R2'],
      ['E8:S1', 'R2', 'R3'],
    ]);
    expect(codeMap.rowBindings).toEqual([]);
    expect(codeMap.segments).toEqual([
      'E1:S1',
      'E1:S2',
      'E2:S1',
      'E2:S2',
      'E10:S1',
      'E11:S1',
      'E12:S1',
      'E13:S1',
    ]);
    expect(codeMap.segSpans.find((s) => s.seg === 'E7:S1')).toEqual({
      seg: 'E7:S1',
      key: '/tables/0/grid/1/0',
      charStart: 0,
      charEnd: 1,
      llm: false,
      owner: 'R2',
      codeTargets: ['R2'],
    });
    expect(codeMap.segSpans.find((s) => s.seg === 'E10:S1')).toMatchObject({
      llm: true,
      owner: null,
      codeTargets: [],
    });
  });

  test('decides trivial body and cell segments by code under the trivial policy and keeps their windows', () => {
    const { plan, unit } = fixture();
    const block = unit.sources.find(
      (s) => s.resource.key === '/chapters/0/textBlocks/1',
    )!.resource;
    block.data.text = '사진 12 수혈 3호 출토유물(1~3) 6월 7일 끝.';

    const before = createContentAttachmentThinInput(plan, unit);
    const { input, codeMap } = createContentAttachmentThinInput(
      { ...plan, thinPolicy: { layers: 'all', trivial: 'code' } },
      unit,
    );

    expect(before.codeMap.codeNone).toBeUndefined();
    expect(before.codeMap.segments).toContain('E10:S1');
    expect(codeMap.codeNone).toEqual(['E10:S1']);
    expect(codeMap.segments).not.toContain('E10:S1');
    expect(codeMap.segSpans.find((s) => s.seg === 'E10:S1')).toMatchObject({
      llm: false,
      owner: null,
    });
    expect(input.tables[0].rows[2].cells[0]).toEqual({
      ref: 'E10',
      header: false,
      windows: [['Q8', ['9']]],
    });
    expect(input.bodyBlocks[1].windows.length).toBeGreaterThan(0);

    block.data.text = '사진 12 수혈 3호 출토유물(1~3)';
    const trivialBody = createContentAttachmentThinInput(
      { ...plan, thinPolicy: { layers: 'all', trivial: 'code' } },
      unit,
    );
    expect(trivialBody.codeMap.codeNone).toEqual(['E2:S1', 'E10:S1']);
    expect(trivialBody.input.bodyBlocks[1].segments).toEqual([]);
    expect(
      trivialBody.codeMap.segSpans.find((s) => s.seg === 'E2:S1'),
    ).toMatchObject({ llm: false });
  });

  test('treats numbers, dates and short non-sentence labels as trivial text', () => {
    for (const text of [
      '171',
      ' 1,123 28 ',
      '34,000',
      '(3.5)',
      '6월 7일',
      '2023년 6월 7일',
      '2023년8월19일(토)',
      '2023년 8월 19일 (토요일)',
      '14:30~15:30(60분)',
      '09:49~10:17 (2시간)',
      '사진 148 조선시대 건물지 주변 구상유구 출토유물2(80~83)',
      '도면 54 조선시대 1~4호 건물지와 주변 구상유구 평면도(S=1/100)',
      '표 1 주변 유적 분포 현황',
    ])
      expect(isContentAttachmentThinTrivialText(text)).toBe(true);
    for (const text of [
      '2,776㎡',
      '내저원각지름',
      '-',
      '표 3에서 보듯이 1호 주거지는 방형이다.',
      '사진 1 수혈은 원형이다',
      '사진 2 수혈 확인.',
      `사진 3 ${'유물 '.repeat(40)}`,
      '29. 목록',
      '(토)',
      '1호(토)',
      '2023년8월19일(토) 제토조사',
    ])
      expect(isContentAttachmentThinTrivialText(text)).toBe(false);
  });

  test('adds read-only context, captions and original reading order', () => {
    const { plan, unit } = fixture();

    const { input } = createContentAttachmentThinInput(plan, unit);

    expect(input.readOnlyContext).toEqual([
      { ref: 'X1', windows: [['Q13', ['본격적인', '조사에', '앞서,']]] },
      { ref: 'X2', windows: [['Q14', ['주석']]] },
      { ref: 'X3', windows: [['Q15', ['표', '1', '트렌치', '현황']]] },
    ]);
    expect(input.bodySequences).toEqual([['E1', 'E2', 'E3', 'X1']]);
    expect(input.tableLocations).toEqual([
      { ref: 'T1', pdfPage: 1, rowCount: 3, captionRef: 'X3' },
      { ref: 'T2', pdfPage: 1, rowCount: 1, captionRef: null },
    ]);
  });
});
