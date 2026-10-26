import type { TableAttributes } from '../attributes/table-attributes';
import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { ArchaeologyLedgerResult } from '../ledger/archaeology-ledger';

/** Records and excerpts covering every relation sentence and link rule. */
const entry = (
  groupId: string,
  sourceName: string,
  sourceIdentifier: string | null,
) => ({
  ref: groupId,
  groupId,
  recordKind: 'feature',
  mentions: [{ sourceName, sourceIdentifier, chapterPath: [], evidence: [] }],
});
export const plan = {
  registry: [
    entry('P72', '수혈', '72호'),
    entry('P96', '수혈', '96'),
    entry('D2', '구상유구', '2호'),
    entry('B1', '건물지', '1호'),
    entry('B2', '건물지', '2호'),
    entry('B3', '건물지', '3호'),
    entry('B4', '건물지', '4호'),
    entry('H5a', '주거지', '5호'),
    entry('H5b', '주거지', '5호'),
    entry('R', '도로유구', null),
    entry('W', '연못지', null),
    entry('S', '사등성지', null),
    entry('C', '연결통로', null),
    entry('T', '트렌치', null),
    entry('T1', '트렌치', '1'),
    entry('G', '구상유구', null),
  ],
} as unknown as ContentAttachmentPlan;
let n = 0;
const source = (recordId: string, excerpt: string) => ({
  id: `s${++n}`,
  recordId: `record-${recordId}`,
  excerpt,
  locator: `/l/${n}`,
  pdfPageNo: n,
});
export const ledger = {
  records: plan.registry.map((e) => ({
    id: `record-${e.groupId}`,
    parentRecordId: e.groupId === 'B1' ? 'record-S' : undefined,
  })),
  sources: [
    source('D2', '삼국시대 72호 수혈 및 96호 수혈과 중복된 상태이다.'),
    source(
      'R',
      '노면 일부가 연못지와 중복되고, 연못지와 중복되어 훼손되었다.\n노면 일부가 연못지와 중복되고, 연못지와 중복되어 훼손되었다.',
    ),
    source('W', '연못지는 도로유구와 중복된다.'),
    source(
      'B1',
      '2호 건물지를 파괴하고 축조되었다. 3호 건물지에 의해 파괴되었다. 사등성지 내 서남쪽에 인접한다. 도로유구는 동쪽으로 길게 위치한다. 동쪽으로 4호 건물지는 위치한다.',
    ),
    source(
      'B4',
      '1호 건물지와 약 8.5m 정도 거리를 두고 나란히 위치한다. 북측에 도로유구가 4.3m 떨어져 위치한다. 동쪽으로 조선시대 2호 건물지가 위치해 있다. 3호 건물지가 동쪽으로 위치한다. 2호 구상유구로 감싸여 있다. 동쪽으로 연못지가 인접하여 위치한다.',
    ),
    source(
      'B2',
      '서측으로 1호 건물지, 동측으로 4호 건물지, 남측으로 도로유구가 인접한다. 2~4호 건물지는 구상유구로 감싸여져 있다. 2호 건물지는 3호 건물지와 인접한다.',
    ),
    source(
      'B3',
      '4호 건물지와 연결될 가능성이 있다. 1호 건물지와 연결된다. 4호 건물지와 접합된다. 2호 건물지에 인접한다. 5호 주거지와 중복된다. 9호 주거지와 1호 건물지와 중복된다. 1호 건물지 서쪽의 2호 건물지와 중복된다.',
    ),
    source(
      'P72',
      '96호 수혈은 동시기로 판단되며 연결 흔적이 없다. 1호 건물지 출토 유물과 비교하면, 2호 건물지와 중복된다. 1호 건물지가 확인되었다.',
    ),
    source('P96', '연결통로와 72호 수혈이 확인되었다. 중복된 흔적이 많다.'),
    source('S', '1호 건물지와 인접한다.'),
    source(
      'T1',
      '⑧ 1트렌치는 사등성지 북쪽 하수관로에 인접한 지점이다. 1트렌치는 사등성지 중앙부 하수관에 인접하며 트렌치 내부는 교란되었다.',
    ),
  ],
} as unknown as ArchaeologyLedgerResult;
const cell = (
  recordId: string,
  keyText: string,
  valueText: string,
  i: number,
) => ({
  recordId: `record-${recordId}`,
  keyText,
  valueText,
  sourceText: valueText,
  extractionMethod: 'table_mapping' as const,
  metadata: {
    tableId: 'tbl-1',
    cellKey: `/tables/1/grid/${i}/3`,
    rowIndex: i,
    logicalColumn: 3,
    layout: 'columns' as const,
    pdfPageNo: 40,
  },
});
export const table = {
  version: 'table-attributes.v2',
  attributes: [
    cell('D2', '중복관계', '72호 수혈, 5호 주거지, 8호 주거지', 1),
    cell('P72', '유구 / 선후관계', '2호 구상유구', 2),
    cell('P72', '비고', '2호 구상유구', 3),
    cell('P72', '중복관계', '-', 4),
    cell('P72', '중복관계', '72호 수혈', 5),
  ],
  tables: [],
  cellsWithoutHeader: [],
} as TableAttributes;
