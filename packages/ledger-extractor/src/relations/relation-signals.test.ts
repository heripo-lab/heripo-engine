import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { ArchaeologyLedgerResult } from '../ledger/archaeology-ledger';

import { describe, expect, test } from 'vitest';

import {
  RELATION_SIGNALS_VERSION,
  collectRelationSignals,
} from './relation-signals';

const text = (key: string, value: string) => ({
  sourceId: `s:${key}`,
  resource: {
    key,
    kind: 'text',
    resourceId: null,
    sourceRefs: [],
    chapterIds: ['ch-0', 'ch-1'],
    pdfPageNo: 1,
    logicalPageRange: null,
    data: { text: value, pdfPageNo: 1 },
  },
});
const cell = (row: number, column: number, value: string) => ({
  sourceId: `s:cell-${row}-${column}`,
  resource: {
    key: `/tables/0/grid/${row}/${column}`,
    kind: 'tableCell',
    tableId: 't0',
    rowIndex: row,
    columnIndex: column,
    resourceId: null,
    sourceRefs: [],
    chapterIds: ['ch-9'],
    pdfPageNo: 2,
    logicalPageRange: null,
    data: { text: value },
  },
});
const ev = (resourceKey: string, quote: string) => ({ resourceKey, quote });
const entry = (
  ref: string,
  recordKind: string,
  sourceName: string,
  sourceIdentifier: string | null,
  evidence: ReturnType<typeof ev>[],
  chapterPath: Array<{ id: string; originTitle: string }> = [],
) => ({
  ref,
  groupId: ref,
  recordKind,
  mentions: [{ sourceName, sourceIdentifier, chapterPath, evidence }],
});

function fixture() {
  const plan = {
    candidateSnapshotId: 'snap',
    units: [
      {
        sources: [
          text('b0', '① 1트렌치(도판 4)'),
          text('b1', '1트렌치는 북쪽에 설정하였다.'),
          text('b2', '교란층'),
          text('b3', '암갈색층'),
          text('b4', '2) 토층 조사'),
          text('b5', '역석층'),
          cell(1, 0, '2'),
          cell(1, 1, '1호 수혈'),
          cell(1, 2, '토기'),
          cell(1, 3, '접시'),
          cell(2, 1, '11호 수혈'),
          cell(0, 1, '출토유구'),
          cell(2, 0, '4'),
          cell(2, 4, '1호 수혈'),
        ],
      },
      { sources: [text('b0', '① 1트렌치(도판 4)')] },
    ],
    registry: [
      entry('T1', 'trench', '트렌치', '1', [ev('b1', '1트렌치')]),
      entry('L1', 'layer', '교란층', null, [ev('b2', '교란층')]),
      entry('L2', 'layer', '암갈색층', null, [
        ev('b3', '암갈색층'),
        ev('b5', '역석층'),
      ]),
      entry('L3', 'layer', '역석층', null, [ev('b5', '역석층')]),
      entry('F1', 'feature', '1호 수혈', '1호', [ev('/x', '1호 수혈')]),
      entry(
        'F11',
        'feature',
        '수혈',
        '11호',
        [ev('/x', '11호 수혈')],
        [{ id: 'ch-4', originTitle: '4) 수혈' }],
      ),
      entry('G', 'feature', '수혈', null, [ev('/x', '수혈')]),
      entry('F98', 'feature', '수혈', '98', [ev('/x', '98 수혈')]),
      entry('F1b', 'feature', '수혈', '1', [ev('/x', '1 수혈')]),
      entry(
        'A1',
        'artifact',
        '토기',
        '1',
        [ev('/x', '토기')],
        [
          { id: 'ch-0', originTitle: 'IV. 조사' },
          { id: 'ch-5', originTitle: '(1) 1호 수혈 (도면 3)' },
        ],
      ),
      entry('A2', 'artifact', '접시', '2', [
        ev('/x', '접시'),
        ev('/tables/0/grid/1/3', '접시'),
        ev('/tables/0/grid/1/0', '2'),
      ]),
      entry('A3', 'artifact', '토기', null, [ev('/x', '토기')]),
      entry('A4', 'artifact', '병', '4', [ev('/tables/0/grid/2/0', '4')]),
      entry(
        'X',
        'unknown',
        'x',
        null,
        [],
        [{ id: 'ch-x', originTitle: '기타' }],
      ),
    ],
  } as unknown as ContentAttachmentPlan;
  const source = (id: string, recordId: string, excerpt: string) => ({
    id,
    recordId,
    excerpt,
    locator: `/loc/${id}`,
    pdfPageNo: 5,
  });
  const ledger = {
    sources: [
      source(
        'source-1',
        'record-A1',
        '1호 수혈 내부에서 출토된 토기이다. 11호 수혈에서 출토. 98호 수혈에서 출토. 출토위치: 9구역',
      ),
      source(
        'source-2',
        'record-A1',
        '1호 수혈 출토 토기. 1호 수혈 출토 토기. 기타 출토 유물. 에서 출토. 조사에서 확인\n 출토 유물',
      ),
      source('source-3', 'record-F11', '1호 수혈에서 확인되었다.'),
      source('source-4', 'record-T1', '출토 지점에 대한 설명'),
    ],
  } as unknown as ArchaeologyLedgerResult;
  return { plan, ledger };
}

describe('collectRelationSignals', () => {
  test('collects find-spot phrases, table rows, heading scopes and chapter titles with exact names', () => {
    const { plan, ledger } = fixture();

    const result = collectRelationSignals(plan, ledger);
    const of = (ref: string) =>
      result.records.find((r) => r.recordId === `record-${ref}`)!.signals;

    expect(result.version).toBe(RELATION_SIGNALS_VERSION);
    expect(result.candidateSnapshotId).toBe('snap');
    expect(
      of('A1').map((s) => [s.kind, s.text, s.targetRecordIds, s.finding]),
    ).toEqual([
      ['phrase', '1호 수혈 내부에서 출토', ['record-F1'], true],
      ['phrase', '11호 수혈에서 출토', ['record-F11'], true],
      ['phrase', '98호 수혈에서 출토', ['record-F98'], true],
      ['phrase', '출토위치: 9구역', [], true],
      ['phrase', '1호 수혈 출토', ['record-F1'], true],
      ['chapter_title', '(1) 1호 수혈 (도면 3)', ['record-F1'], undefined],
    ]);
    expect(of('A1')[0]).toMatchObject({
      place: '1호 수혈 내부',
      sourceId: 'source-1',
      locator: '/loc/source-1',
      pdfPageNo: 5,
    });
    expect(of('A1')[5].chapterId).toBe('ch-5');
    expect(of('F11')).toEqual([
      expect.objectContaining({
        kind: 'phrase',
        targetRecordIds: ['record-F1'],
        finding: false,
      }),
    ]);
    expect(of('A2')).toEqual([
      {
        kind: 'table_row',
        targetRecordIds: ['record-F1'],
        text: '1호 수혈',
        locator: '/tables/0/grid/1/1',
        pdfPageNo: 2,
        header: '출토유구',
        finding: true,
      },
    ]);
    expect(of('L1')).toEqual([
      {
        kind: 'heading_scope',
        targetRecordIds: ['record-T1'],
        text: '① 1트렌치(도판 4)',
        locator: 'b0',
        pdfPageNo: 1,
      },
    ]);
    expect(of('L2')[0].targetRecordIds).toEqual(['record-T1']);
    expect(of('L3')).toEqual([]);
    expect(of('T1')).toEqual([]);
    expect(of('A3')).toEqual([]);
    expect(of('A4').map((s) => [s.text, s.header, s.finding])).toEqual([
      ['11호 수혈', '출토유구', true],
      ['1호 수혈', undefined, false],
    ]);
    expect(of('X')).toEqual([]);
  });
});

describe('collectRelationSignals with place aliases', () => {
  test('retries unmatched places and table cells through the rules and lists short-form records', () => {
    const aliasPlan = {
      inputSha256: 'hash',
      candidateSnapshotId: 'snap',
      units: [
        {
          sources: [
            text('b0', '정밀발굴조사(23-1~6구역)'),
            cell(0, 1, '출수위치'),
            cell(1, 0, '1'),
            cell(1, 1, '발굴 1구역'),
            cell(1, 2, '발굴 7구역'),
            cell(1, 3, '발굴 3구역'),
          ],
          readOnlyContext: [],
        },
      ],
      registry: [
        entry('Z1', 'area', '23-1 구역', null, [ev('/x', '23-1 구역')]),
        entry('A1', 'artifact', '청자', '1', [ev('/tables/0/grid/1/0', '1')]),
        entry('S', 'area', '발굴 2구역', null, [ev('/x', '발굴 2구역')]),
      ],
    } as unknown as ContentAttachmentPlan;
    const source = (id: string, recordId: string, excerpt: string) => ({
      id,
      recordId,
      excerpt,
      locator: `/loc/${id}`,
      pdfPageNo: 1,
    });
    const aliasLedger = {
      records: [
        { id: 'record-Z1', recordKind: 'area', sourceName: '23-1 구역' },
        { id: 'record-A1', recordKind: 'artifact', sourceName: '청자' },
        { id: 'record-S', recordKind: 'area', sourceName: '발굴 2구역' },
      ],
      sources: [
        source(
          's1',
          'record-A1',
          '출수위치 발굴 1구역. 출수위치 발굴 3구역. 23-1 구역에서 출토. 발굴 3구역에서 확인',
        ),
        source('s2', 'record-S', '출수위치 발굴 2구역'),
      ],
    } as unknown as ArchaeologyLedgerResult;
    const placeAliases = {
      version: 'place-aliases.v1',
      inputSha256: 'hash',
      source: 'manual',
      confirmedAt: '2026-10-26T00:00:00.000Z',
      rules: [
        {
          id: 'excavation',
          written: ['발굴 {n}구역'],
          registered: '23-{n} 구역',
          numbers: { from: 1, to: 6 },
          recordKind: 'area',
          basis: { quote: '정밀발굴조사(23-1~6구역)' },
        },
      ],
    } as const;

    const result = collectRelationSignals(aliasPlan, aliasLedger, {
      placeAliases: placeAliases as never,
      placeAliasesSha256: 'abc',
    });
    const of = (ref: string) =>
      result.records.find((r) => r.recordId === `record-${ref}`)!.signals;

    expect(
      of('A1').map((s) => [
        s.kind,
        s.text,
        s.targetRecordIds,
        s.alias?.registered,
      ]),
    ).toEqual([
      ['phrase', '출수위치 발굴 1구역.', ['record-Z1'], '23-1 구역'],
      ['phrase', '출수위치 발굴 3구역.', [], '23-3 구역'],
      ['phrase', '23-1 구역에서 출토', ['record-Z1'], undefined],
      ['phrase', '발굴 3구역에서 확인', [], '23-3 구역'],
      ['table_row', '발굴 1구역', ['record-Z1'], '23-1 구역'],
    ]);
    // the record's own field names itself: no find-spot, so no alias either
    expect(of('S')).toEqual([]);
    expect(result.placeAliases).toMatchObject({
      ruleIds: ['excavation'],
      sha256: 'abc',
    });
    expect(result.aliasDuplicates).toEqual([
      {
        recordId: 'record-S',
        ruleId: 'excavation',
        written: '발굴2구역',
        registered: '23-2 구역',
      },
    ]);
  });

  test("takes the same-named record of the speaking record's own chapter when numbering restarts", () => {
    const early = [{ id: 'early', originTitle: 'A. 삼국시대' }];
    const late = [{ id: 'late', originTitle: 'B. 조선시대' }];
    const plan = {
      candidateSnapshotId: 'snap',
      units: [],
      registry: [
        entry('E29', 'feature', '수혈', '29호', [ev('/x', '29호')], early),
        entry('L29', 'feature', '수혈', '29', [ev('/y', '29')], late),
        entry('P', 'artifact', '백자 잔', '72', [ev('/z', '72')], late),
      ],
    } as unknown as ContentAttachmentPlan;
    const ledger = {
      records: [
        { id: 'record-E29', recordKind: 'feature', sourceName: '수혈' },
        { id: 'record-L29', recordKind: 'feature', sourceName: '수혈' },
        { id: 'record-P', recordKind: 'artifact', sourceName: '백자 잔' },
      ],
      sources: [
        {
          id: 's1',
          recordId: 'record-P',
          excerpt: '29호 수혈에서 출토되었다.',
          locator: '/loc/s1',
          pdfPageNo: 1,
        },
        {
          id: 's2',
          recordId: 'record-L29',
          excerpt: '29호 수혈에서 출토',
          locator: '/loc/s2',
          pdfPageNo: 1,
        },
      ],
    } as unknown as ArchaeologyLedgerResult;

    const result = collectRelationSignals(plan, ledger);
    const of = (ref: string) =>
      result.records.find((r) => r.recordId === `record-${ref}`)!.signals;

    expect(of('P').map((s) => s.targetRecordIds)).toEqual([['record-L29']]);
    expect(of('L29')).toEqual([]);
  });
});
