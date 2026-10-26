import { describe, expect, test } from 'vitest';

import { ledger, plan, table } from './links.test-fixture';
import { RECORD_LINKS_VERSION, resolveRecordLinks } from './record-links';
import { collectRelationSentences } from './relation-sentences';

const short = (id: string) => id.replace('record-', '');

describe('resolveRecordLinks', () => {
  test('links names a clause predicate follows and asks about the rest', () => {
    const result = resolveRecordLinks(
      collectRelationSentences(plan, ledger, table),
    );

    expect(result.version).toBe(RECORD_LINKS_VERSION);
    expect(
      result.links.map(
        (l) =>
          `${short(l.fromRecordId)} ${l.relationLabel}${l.symmetric ? '' : '>'} ${short(l.toRecordId)} ${l.basis} ${l.evidence.length}`,
      ),
    ).toEqual([
      'D2 중복 P72 rule 1',
      'D2 중복 P96 rule 1',
      'R 중복 W rule 2',
      'B1 파괴> B2 rule 1',
      'B3 파괴> B1 rule 1',
      'B4 위치 B1 rule 1',
      'B4 위치 R rule 1',
      'B4 위치 B2 rule 1',
      'B4 위치 B3 rule 1',
      'B4 인접 W rule 1',
      'B2 인접 R rule 1',
      'B2 인접 B3 rule 2',
      'B3 연결 가능성 B4 rule 1',
      'B3 연결 B1 rule 1',
      'B3 접합 B4 rule 1',
      'B3 중복 B1 rule 1',
      'B3 중복 B2 rule 1',
      'P72 중복 B2 rule 1',
      'D2 중복관계 P72 table_column 1',
      'P72 선후관계 D2 table_column 1',
    ]);
    expect(result.links[2].evidence).toEqual([
      {
        recordId: 'record-R',
        quote: '노면 일부가 연못지와 중복되고, 연못지와 중복되어 훼손되었다.',
        sourceId: 's2',
        locator: '/l/2',
        pdfPageNo: 2,
      },
      expect.objectContaining({ recordId: 'record-W', sourceId: 's3' }),
    ]);
    expect(result.links[18].evidence).toEqual([
      {
        recordId: 'record-D2',
        quote: '중복관계: 72호 수혈, 5호 주거지, 8호 주거지',
        tableId: 'tbl-1',
        cellKey: '/tables/1/grid/1/3',
        pdfPageNo: 40,
      },
    ]);
    expect(
      result.questions.map(
        (q) =>
          `${short(q.recordId)} ${q.reason} ${q.candidateRecordIds.map(short).join(',')}`,
      ),
    ).toEqual([
      'B1 link_unclear B4',
      'B4 link_enclosure D2',
      'B2 link_several_targets B1,B4',
      'B3 link_several_targets B1',
      'P72 link_unclear P96',
    ]);
    expect(result.questions[1].evidence.quote).toBe(
      '2호 구상유구로 감싸여 있다.',
    );
    expect(
      result.unresolved.map(
        (u) =>
          `${short(u.recordId)} ${u.written} ${u.candidateRecordIds.map(short).join(',')}`,
      ),
    ).toEqual([
      'B3 5호주거지 H5a,H5b',
      'B3 9호주거지 ',
      'D2 5호주거지 H5a,H5b',
      'D2 8호주거지 ',
    ]);
    expect(result.locatedInSkipped).toBe(2);
    expect(result.inRangeSkipped).toBe(1);
    expect(result.withoutCueSkipped).toBe(2);
  });
});
