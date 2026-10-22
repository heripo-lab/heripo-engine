import type {
  AttachmentRegistryEntry,
  AttachmentUnit,
  ContentAttachmentPlan,
} from './content-attachment';

import { describe, expect, test } from 'vitest';

import {
  cellRegisteredCandidates,
  createContentAttachmentThinRowOwners,
} from './content-attachment-thin-row-owners';

type Table = AttachmentUnit['tables'][number];
type Cell = Table['data']['grid'][number][number];

const cell = (text: string, isHeader = false): Cell => ({
  text,
  isHeader,
  rowSpan: 1,
  colSpan: 1,
});
const table = (index: number, grid: Cell[][], caption?: string): Table => ({
  key: `/tables/${index}`,
  data: {
    id: `t${index}`,
    pdfPageNo: 1,
    numRows: grid.length,
    numCols: Math.max(...grid.map((r) => r.length)),
    grid,
    ...(caption ? { caption: { fullText: caption } } : {}),
  },
});
const entry = (
  ref: string,
  sourceName: string,
  sourceIdentifier: string | null,
  resourceKey = '/chapters/0/textBlocks/0',
  quote = sourceName,
): AttachmentRegistryEntry => ({
  ref,
  groupId: `g-${ref}`,
  recordKind: 'feature',
  mentions: [
    {
      candidateId: `c-${ref}`,
      sourceName,
      sourceIdentifier,
      chapterPath: [],
      evidence: [
        {
          sourceId: `source:${resourceKey}`,
          resourceKey,
          resourceId: null,
          sourceRefs: [],
          pdfPageNo: 1,
          logicalPageRange: null,
          quote,
          charStart: 0,
          charEnd: quote.length,
        },
      ],
    },
  ],
});
function setup(tables: Table[], registry: AttachmentRegistryEntry[]) {
  const unit: AttachmentUnit = {
    unitId: 'page-1',
    pdfPageNo: 1,
    sources: [],
    chapters: [],
    tables,
    readOnlyContext: [],
  };
  const plan: ContentAttachmentPlan = {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: 'input',
    candidateSnapshotId: 'snapshot',
    registrySha256: 'registry',
    registryUncertainties: [],
    registry,
    pages: [],
    units: [unit],
  };
  return { plan, unit };
}

describe('createContentAttachmentThinRowOwners', () => {
  test('keeps registration owners and binds unregistered rows by caption or same-column header', () => {
    const { plan, unit } = setup(
      [
        table(
          0,
          [
            [cell('호수', true), cell('규모', true), cell('비고', true)],
            [cell('1호'), cell('509'), cell('구 외곽')],
            [cell(''), cell('2호'), cell('x', true), cell('메모')],
            [cell('5호'), cell('미등록')],
          ],
          '표 8 건물지 현황',
        ),
        table(1, [[cell('수혈', true)], [cell('43호')], [cell('20')]]),
        table(2, [[cell('1'), cell('트렌치')]]),
      ],
      [
        entry('R1', '건물지', '1호'),
        entry('R2', '건물지', '2호'),
        entry('R3', '수혈', '43호'),
        entry('R4', '트렌치', '1', '/tables/2/grid/0/0', '1'),
        entry('R5', '구', '5호'),
      ],
    );

    const { owners, rowBindings } = createContentAttachmentThinRowOwners(
      plan,
      unit,
    );

    expect(owners.get('/tables/0/grid/1/0')).toBe('R1');
    expect(owners.get('/tables/0/grid/1/2')).toBe('R1');
    expect(owners.get('/tables/0/grid/2/0')).toBeNull();
    expect(owners.get('/tables/0/grid/2/1')).toBe('R2');
    expect(owners.get('/tables/0/grid/2/2')).toBeNull();
    expect(owners.get('/tables/0/grid/2/3')).toBe('R2');
    expect(owners.get('/tables/0/grid/3/0')).toBeNull();
    expect(owners.get('/tables/1/grid/1/0')).toBe('R3');
    expect(owners.get('/tables/1/grid/2/0')).toBeNull();
    expect(owners.get('/tables/2/grid/0/1')).toBe('R4');
    expect(rowBindings).toEqual([
      {
        table: '/tables/0',
        row: 1,
        column: 0,
        numberText: '1호',
        owner: 'R1',
        name: '건물지',
        caption: '표 8 건물지 현황',
      },
      {
        table: '/tables/0',
        row: 2,
        column: 1,
        numberText: '2호',
        owner: 'R2',
        name: '건물지',
        caption: '표 8 건물지 현황',
      },
      {
        table: '/tables/1',
        row: 1,
        column: 0,
        numberText: '43호',
        owner: 'R3',
        name: '수혈',
        caption: null,
      },
    ]);
  });

  test('ignores row headers in other columns and reports ambiguous numbers without binding', () => {
    const { plan, unit } = setup(
      [
        table(0, [
          [cell('6) 수혈', true), cell('111')],
          [cell('7) 우물', true), cell('3호')],
        ]),
        table(1, [[cell('3호')]], '표 2 우물 현황'),
      ],
      [
        entry('R1', '수혈', '111'),
        entry('R2', '우물', '3호'),
        entry('R3', '우물', '3호'),
      ],
    );

    const { owners, rowBindings } = createContentAttachmentThinRowOwners(
      plan,
      unit,
    );

    expect(owners.get('/tables/0/grid/0/1')).toBeNull();
    expect(owners.get('/tables/1/grid/0/0')).toBeNull();
    expect(rowBindings).toEqual([
      {
        table: '/tables/1',
        row: 0,
        column: 0,
        numberText: '3호',
        ambiguous: ['R2', 'R3'],
      },
    ]);
  });
});

describe('cellRegisteredCandidates', () => {
  test('lists other candidates registered from the cell', () => {
    const { plan } = setup(
      [],
      [
        entry('R1', '트렌치', '1', '/tables/0/grid/1/0', '1'),
        entry('R2', '도로', null, '/tables/0/grid/1/3', '도로'),
        entry('R3', '수혈', null, '/tables/0/grid/1/3', '수혈'),
        entry('R4', '구', null),
      ],
    );

    expect(cellRegisteredCandidates(plan, '/tables/0/grid/1/3', 'R1')).toEqual([
      'R2',
      'R3',
    ]);
    expect(cellRegisteredCandidates(plan, '/tables/0/grid/1/0', 'R1')).toEqual(
      [],
    );
  });
});
