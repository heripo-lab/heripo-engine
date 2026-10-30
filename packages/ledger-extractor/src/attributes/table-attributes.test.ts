import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { DocumentResourceIndex } from '../resources/document-resource-index';

import { describe, expect, test } from 'vitest';

import {
  TABLE_ATTRIBUTES_VERSION,
  collectTableAttributes,
  logicalTableCells,
} from './table-attributes';

const c = (text?: string, colSpan = 1, rowSpan = 1) => ({
  ...(text === undefined ? {} : { text }),
  colSpan,
  rowSpan,
  isHeader: false,
});
const table = (n: number, grid: ReturnType<typeof c>[][]) => ({
  kind: 'table',
  key: `/tables/${n}`,
  pdfPageNo: n + 1,
  data: { id: `tbl-${n}`, grid },
});
const index = {
  resources: [
    { kind: 'text', key: '/t', data: { text: '' } },
    table(0, [
      [c('번호', 1, 2), c('규모(cm)', 2), c('비고', 1, 2), c('98')],
      [c('길이'), c('너비'), c('154')],
      [c('1호'), c('28'), c(''), c('x'), c('0.5')],
      [c('7'), c('1')],
    ]),
    table(1, [
      [c('면적'), c('단위(m) / 값(㎡)')],
      [c('12'), c('3')],
      [c('A1'), c('5')],
    ]),
    table(2, [
      [c('유적명칭'), c('부여 유적')],
      [c('조사면적'), c('2,776㎡')],
      [c('조사기관'), c()],
    ]),
    table(3, [
      [c('명칭'), c('가 유적')],
      [c('구역'), c('나 구역')],
    ]),
    table(4, [
      [{ text: '가' } as ReturnType<typeof c>, c('나'), c('다')],
      [c('라'), c('마'), c('바')],
    ]),
    table(5, [
      [c('1'), c('가')],
      [c('2'), c('나')],
    ]),
    // a header merge lost in preprocessing: `크기(cm)` stored as one cell, then empty cells
    table(6, [
      [
        c('번호'),
        c('크기(cm)'),
        c(''),
        c(''),
        c('무게(g)'),
        c('9'),
        c(''),
        c('비고'),
        c('', 2),
        c('높이'),
        c(''),
      ],
      [
        c(''),
        c('길이'),
        c('너비'),
        c(''),
        c(''),
        c(''),
        c('두께'),
        c(''),
        c('가'),
        c('나'),
        c('높'),
      ],
      [
        c('3호'),
        c('10'),
        c('5'),
        c('7'),
        c('2'),
        c('x'),
        c('1'),
        c('y'),
        c('z'),
        c('w'),
        c('h'),
        c('q'),
      ],
    ]),
  ],
} as unknown as DocumentResourceIndex;
const cellEvidence = (key: string, quote: string) => ({
  resourceKey: key,
  quote,
  charStart: 0,
  charEnd: quote.length,
});
const entry = (
  ref: string,
  sourceIdentifier: string | null,
  evidence: ReturnType<typeof cellEvidence>[],
) => ({
  ref,
  groupId: ref,
  recordKind: 'feature',
  mentions: [
    { sourceName: '수혈', sourceIdentifier, chapterPath: [], evidence },
  ],
});
const plan = {
  registry: [
    entry('F1', '1호', [cellEvidence('/tables/0/grid/2/0', '1호')]),
    entry('A1', 'A1', [cellEvidence('/tables/1/grid/2/0', 'A1')]),
    entry('S', null, [cellEvidence('/tables/2/grid/0/1', '부여 유적')]),
    entry('T1', null, [cellEvidence('/tables/3/grid/0/1', '가 유적')]),
    entry('T2', null, [cellEvidence('/tables/3/grid/1/1', '나 구역')]),
    entry('F3', '3호', [cellEvidence('/tables/6/grid/2/0', '3호')]),
  ],
} as unknown as ContentAttachmentPlan;

describe('logicalTableCells', () => {
  test('places stored cells in logical columns across row and column spans', () => {
    const cells = logicalTableCells(
      '/tables/0',
      (index.resources[1] as unknown as { data: never }).data,
    );

    expect(
      cells
        .filter((x) => x.row < 2)
        .map((x) => [x.key, x.column, x.span, x.text]),
    ).toEqual([
      ['/tables/0/grid/0/0', 0, 1, '번호'],
      ['/tables/0/grid/0/1', 1, 2, '규모(cm)'],
      ['/tables/0/grid/0/2', 3, 1, '비고'],
      ['/tables/0/grid/0/3', 4, 1, '98'],
      ['/tables/0/grid/1/0', 1, 1, '길이'],
      ['/tables/0/grid/1/1', 2, 1, '너비'],
      ['/tables/0/grid/1/2', 4, 1, '154'],
    ]);
  });
});

describe('collectTableAttributes', () => {
  test('carries a header whose merge was lost over the empty cells above named sub-headers', () => {
    const result = collectTableAttributes(index, plan);

    expect(
      result.attributes
        .filter((a) => a.recordId === 'record-F3')
        .map((a) => [a.keyText, a.valueText, a.unitText]),
    ).toEqual([
      ['크기(cm) / 길이', '10', 'cm'],
      ['크기(cm) / 너비', '5', 'cm'],
      ['무게(g)', '2', 'g'],
      ['두께', '1', undefined],
      ['비고', 'y', undefined],
      ['가', 'z', undefined],
      ['나', 'w', undefined],
      ['높이 / 높', 'h', undefined],
    ]);
    expect(
      result.cellsWithoutHeader
        .filter((x) => x.recordId === 'record-F3')
        .map((x) => x.text),
    ).toEqual(['7', 'x', 'q']);
  });

  test('keys owned row cells by meaningful header paths and key–value labels', () => {
    const all = collectTableAttributes(index, plan);
    // the lost-merge table is checked on its own above
    const result = {
      ...all,
      attributes: all.attributes.filter((a) => a.recordId !== 'record-F3'),
      tables: all.tables.filter((t) => t.tableKey !== '/tables/6'),
      cellsWithoutHeader: all.cellsWithoutHeader.filter(
        (x) => x.recordId !== 'record-F3',
      ),
    };

    expect(result.version).toBe(TABLE_ATTRIBUTES_VERSION);
    expect(
      result.attributes.map((a) => [
        a.recordId,
        a.keyText,
        a.valueText,
        a.unitText,
      ]),
    ).toEqual([
      ['record-F1', '규모(cm) / 길이', '28', 'cm'],
      ['record-F1', '비고', 'x', undefined],
      ['record-A1', '단위(m) / 값(㎡)', '5', '㎡'],
      ['record-S', '조사면적', '2,776㎡', undefined],
    ]);
    expect(result.attributes[0]).toEqual({
      recordId: 'record-F1',
      keyText: '규모(cm) / 길이',
      valueText: '28',
      unitText: 'cm',
      sourceText: '28',
      extractionMethod: 'table_mapping',
      metadata: {
        tableId: 'tbl-0',
        cellKey: '/tables/0/grid/2/1',
        rowIndex: 2,
        logicalColumn: 1,
        layout: 'columns',
        pdfPageNo: 1,
      },
    });
    expect(result.attributes[3].metadata.layout).toBe('key_value');
    expect(result.cellsWithoutHeader).toEqual([
      { recordId: 'record-F1', cellKey: '/tables/0/grid/2/4', text: '0.5' },
    ]);
    expect(result.tables).toEqual([
      {
        tableKey: '/tables/0',
        tableId: 'tbl-0',
        layout: 'columns',
        headerRows: [0, 1],
        recordIds: ['record-F1'],
      },
      {
        tableKey: '/tables/1',
        tableId: 'tbl-1',
        layout: 'columns',
        headerRows: [0],
        recordIds: ['record-A1'],
      },
      {
        tableKey: '/tables/2',
        tableId: 'tbl-2',
        layout: 'key_value',
        headerRows: [],
        recordIds: ['record-S'],
      },
    ]);
  });
});
