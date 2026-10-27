import type { Chapter, ProcessedDocument } from '@heripo/model';

import type {
  CandidateDiscoveryAudit,
  CandidateDiscoveryResponse,
  CandidateDiscoveryUnit,
} from './discovery-types';

import { buildDocumentResourceIndex } from '../resources/document-resource-index';
import { prepareCandidateDiscovery } from './discovery-plan';
import {
  createCandidateDiscoveryRequest,
  getCandidateSources,
} from './discovery-request';

export const usage = {
  component: 'test',
  phase: 'test',
  model: 'primary' as const,
  modelName: 'mock',
  inputTokens: 1,
  outputTokens: 2,
  totalTokens: 3,
};

export const chapter = (overrides: Partial<Chapter> = {}): Chapter => ({
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

export const input = (): ProcessedDocument => ({
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

export const prepare = () =>
  prepareCandidateDiscovery(buildDocumentResourceIndex(input()), {
    scopeChapterId: 'root',
    inputSha256: 'hash',
    maxTextChars: 20,
    tableRowsPerUnit: 1,
  });

export const proposal = (
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

export const audit = (
  unit: CandidateDiscoveryUnit,
  response: CandidateDiscoveryResponse,
): CandidateDiscoveryAudit => ({
  unitId: unit.unitId,
  ...createCandidateDiscoveryRequest(unit),
  response,
  usage,
});

/** An item table whose first two grid rows are the headerRows given to the model; data rows are 2 to 5. */
export const registry = () => {
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
        [cell('4'), cell('도면 1')],
        [cell('합계'), cell('4점')],
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
  const item = (
    number: string,
    name: string,
  ): CandidateDiscoveryResponse['candidates'][number] => ({
    recordKind: 'artifact',
    sourceName: name,
    sourceIdentifier: number,
    identifierSourceId: id(number),
    nameSourceId: id(name),
    eligibilityBasis: 'table_item',
    reason: '등록표 행',
    evidence: [
      { sourceId: id(number), quote: number },
      { sourceId: id(name), quote: name },
    ],
  });
  return { plan, unit, id, item };
};

/** A body unit with numbered item headings, a date line and a passage that lists objects in passing. */
export const sections = () => {
  const doc = input();
  doc.chapters = [
    chapter({
      textBlocks: [
        {
          id: 'intro',
          text: '유구는 조사대상지 중앙에 분포한다.',
          pdfPageNo: 1,
        },
        { id: 'h1', text: '(1) 1호 건물지 (도면 5)', pdfPageNo: 1 },
        { id: 'b1', text: '1호 건물지는 중앙부에 위치한다.', pdfPageNo: 1 },
        { id: 'date', text: '2024. 12. 16', pdfPageNo: 1 },
        { id: 'h2', text: '21. 호 구연편', pdfPageNo: 2 },
        {
          id: 'b2',
          text: '96호 수혈에서 출토된 호 구연편으로, 그 외에도 청자와 백자가 확인되었다.',
          pdfPageNo: 2,
        },
      ],
    }),
  ];
  doc.tables = [];
  const plan = prepareCandidateDiscovery(buildDocumentResourceIndex(doc), {
    scopeChapterId: 'root',
    inputSha256: 'hash',
    maxTextChars: 8000,
    tableRowsPerUnit: 12,
  });
  const unit = plan.units[0];
  const body = (
    name: string,
    identifier: string | null,
    sourceId: string,
    quote: string,
  ): CandidateDiscoveryResponse['candidates'][number] => ({
    recordKind: 'artifact',
    sourceName: name,
    sourceIdentifier: identifier,
    identifierSourceId: null,
    nameSourceId: null,
    eligibilityBasis: 'independent_body',
    reason: '독립 설명',
    evidence: [{ sourceId, quote }],
  });
  return { plan, unit, body };
};

/**
 * A side-by-side item table: each data row holds two objects in blocks of three columns (number, length, width).
 * The merged first header row has compressed cell indexes. Data rows are 2 to 4; row 4's right block is empty.
 */
export const pairs = () => {
  const cell = (text: string, isHeader = false, colSpan = 1) => ({
    text,
    colSpan,
    rowSpan: 1,
    isHeader,
  });
  const doc = input();
  doc.chapters = [chapter({ originTitle: '수혈', tableIds: ['pairs'] })];
  doc.tables = [
    {
      id: 'pairs',
      pdfPageNo: 1,
      numRows: 5,
      numCols: 6,
      grid: [
        [
          cell('번호', true),
          cell('규모', true, 2),
          cell('번호', true),
          cell('규모', true, 2),
        ],
        [
          cell('길이', true),
          cell('너비', true),
          cell('길이', true),
          cell('너비', true),
        ],
        ['1', '10', '8', '4', '12', '9'].map((t) => cell(t)),
        ['2', '11', '7', '5', '13', '6'].map((t) => cell(t)),
        ['3', '14', '9', '', '', ''].map((t) => cell(t)),
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
  const cellId = (row: number, column: number) =>
    getCandidateSources(unit).find(
      (s) =>
        s.resource.kind === 'tableCell' &&
        s.resource.rowIndex === row &&
        s.resource.columnIndex === column,
    )!.sourceId;
  /** The item of one block; it quotes its whole row as evidence, as models often do. */
  const item = (
    row: number,
    block: number,
  ): CandidateDiscoveryResponse['candidates'][number] => {
    const number = cellId(row, block * 3);
    const text = getCandidateSources(unit).find((s) => s.sourceId === number)!
      .resource.data.text;
    return {
      recordKind: 'feature',
      sourceName: '수혈',
      sourceIdentifier: text,
      identifierSourceId: number,
      nameSourceId: null,
      eligibilityBasis: 'table_item',
      reason: '속성표 행',
      evidence: [
        { sourceId: number, quote: text },
        ...[0, 1, 2, 3, 4, 5]
          .filter((c) => c !== block * 3)
          .flatMap((c) => {
            const sourceId = cellId(row, c);
            const quote = getCandidateSources(unit).find(
              (s) => s.sourceId === sourceId,
            )!.resource.data.text;
            return quote ? [{ sourceId, quote }] : [];
          }),
      ],
    };
  };
  return { plan, unit, cellId, item };
};
