import type { ProcessedDocument } from '@heripo/model';

import type { DocumentResource } from '../../resources/document-resource-index';
import type {
  AttachmentRegistryEntry,
  AttachmentUnit,
  ContentAttachmentPlan,
} from '../content-attachment';

import { describe, expect, test } from 'vitest';

import { buildDocumentResourceIndex } from '../../resources/document-resource-index';
import {
  CONTENT_ATTACHMENT_THIN_COMPILE_VERSION,
  createContentAttachmentThinInput,
} from './compile';

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
