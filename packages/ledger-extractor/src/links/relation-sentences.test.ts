import { describe, expect, test } from 'vitest';

import { ledger, plan, table } from './links.test-fixture';
import {
  RELATION_SENTENCES_VERSION,
  collectRelationSentences,
} from './relation-sentences';

describe('collectRelationSentences', () => {
  test('keeps cue sentences naming other records with their clauses, and relation table cells', () => {
    const result = collectRelationSentences(plan, ledger, table);
    const by = (recordId: string) =>
      result.sentences.filter((s) => s.recordId === `record-${recordId}`);

    expect(result.version).toBe(RELATION_SENTENCES_VERSION);
    expect(by('D2')[0]).toEqual({
      recordId: 'record-D2',
      text: '삼국시대 72호 수혈 및 96호 수혈과 중복된 상태이다.',
      sourceId: 's1',
      locator: '/l/1',
      pdfPageNo: 1,
      targets: [
        {
          recordIds: ['record-P72'],
          written: '72호수혈',
          clauseIndex: 0,
          before: '삼국시대',
          after: '및96호수혈과중복된상태이다.',
          inRange: false,
          afterTopic: false,
        },
        expect.objectContaining({
          recordIds: ['record-P96'],
          written: '96호수혈',
        }),
      ],
      cueClauses: [0],
      placeClauses: [],
      unregistered: [],
    });
    // the repeated sentence of R is kept once; class names (트렌치, 구상유구) never name a record
    expect(by('R')).toHaveLength(1);
    expect(by('P96')).toEqual([]);
    expect(by('S')).toEqual([]);
    expect(by('B1').map((s) => s.targets.map((t) => t.written).join())).toEqual(
      ['2호건물지', '3호건물지', '도로유구', '4호건물지'],
    );
    expect(by('B1')[2].placeClauses).toEqual([0]);
    expect(result.containmentSkipped).toBe(2);
    expect(by('B2')[1].targets[0]).toMatchObject({
      written: '4호건물지',
      inRange: true,
    });
    expect(by('B3')[5].unregistered).toEqual(['9호주거지']);
    expect(by('B3')[4].targets[0].recordIds).toEqual([
      'record-H5a',
      'record-H5b',
    ]);
    expect(by('T1').map((s) => s.targets[0].afterTopic)).toEqual([true, true]);
    expect(by('P72').map((s) => s.text)).toEqual([
      '96호 수혈은 동시기로 판단되며 연결 흔적이 없다.',
      '1호 건물지 출토 유물과 비교하면, 2호 건물지와 중복된다.',
    ]);
    expect(result.tableCells).toEqual([
      {
        recordId: 'record-D2',
        keyText: '중복관계',
        valueText: '72호 수혈, 5호 주거지, 8호 주거지',
        targets: [
          { written: '72호수혈', recordIds: ['record-P72'] },
          { written: '5호주거지', recordIds: ['record-H5a', 'record-H5b'] },
        ],
        unregistered: ['8호주거지'],
        cellKey: '/tables/1/grid/1/3',
        tableId: 'tbl-1',
        pdfPageNo: 40,
      },
      expect.objectContaining({
        recordId: 'record-P72',
        keyText: '유구 / 선후관계',
        targets: [{ written: '2호구상유구', recordIds: ['record-D2'] }],
      }),
    ]);
  });

  test('collects no table cells without table attributes', () => {
    expect(collectRelationSentences(plan, ledger).tableCells).toEqual([]);
  });
});
