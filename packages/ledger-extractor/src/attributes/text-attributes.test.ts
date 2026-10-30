import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { ArchaeologyLedgerResult } from '../ledger/archaeology-ledger';

import { describe, expect, test } from 'vitest';

import {
  TEXT_ATTRIBUTES_VERSION,
  collectTextAttributes,
} from './text-attributes';

const entry = (
  groupId: string,
  recordKind: string,
  sourceName: string,
  sourceIdentifier: string | null,
) => ({
  ref: groupId,
  groupId,
  recordKind,
  mentions: [{ sourceName, sourceIdentifier, chapterPath: [], evidence: [] }],
});
const plan = {
  registry: [
    entry('W', 'feature', '우물', '1호'),
    entry('P2', 'feature', '수혈', '2호'),
    entry('P11', 'feature', '수혈', '11호'),
    entry('G', 'feature', '수혈', null),
    entry('A', 'artifact', '토기', '1'),
  ],
} as unknown as ContentAttachmentPlan;
const source = (id: string, recordId: string, excerpt: string) => ({
  id,
  recordId: `record-${recordId}`,
  excerpt,
  locator: `/loc/${id}`,
  pdfPageNo: 4,
});
const ledger = {
  records: plan.registry.map((e) => ({
    id: `record-${e.groupId}`,
    recordKind: e.recordKind,
  })),
  sources: [
    source(
      's1',
      'W',
      '우물의 전체 규모는 길이 4.9m, 너비 3.89m이상, 깊이 3.7m이다. 확인된 수혈의 규모는 직경 140~160cm 정도이다.\n높이(잔존) 6.0cm 입지름 16.0cm',
    ),
    source(
      's2',
      'W',
      '길이 2.4m와 너비 30cm로 남아 있다. 크기 238×28×32cm이다.',
    ),
    source(
      's3',
      'W',
      '우물의 전체 규모는 길이 4.9m, 너비 3.89m이상, 깊이 3.7m이다.',
    ),
    source(
      's4',
      'P2',
      '2호 수혈과 11호 수혈은 깊이 20cm이다. 1호 우물 옆 깊이 9cm.',
    ),
    source('s5', 'G', '수혈 5기가 조사되었다. 토기 1점이 나왔다.'),
    source('s6', 'A', '1호 우물에서 출토된 토기로 높이 10cm이다.'),
    source('s7', 'W', '굽높이 0.5cm(내) 0.5cm(외) 두께 0.5~0.7cm'),
  ],
} as unknown as ArchaeologyLedgerResult;

describe('collectTextAttributes', () => {
  test('keeps measurement runs as one source phrase with source labels and asks about shared sentences', () => {
    const result = collectTextAttributes(plan, ledger);
    const rows = result.attributes.map((a) => [
      a.recordId.replace('record-', ''),
      a.keyText,
      a.valueText,
      a.unitText,
    ]);

    expect(result.version).toBe(TEXT_ATTRIBUTES_VERSION);
    expect(rows).toEqual([
      ['W', '전체 규모', '길이 4.9m, 너비 3.89m이상, 깊이 3.7m', 'm'],
      ['W', '규모', '직경 140~160cm 정도', 'cm'],
      ['W', '크기', '높이(잔존) 6.0cm 입지름 16.0cm', 'cm'],
      ['W', '크기', '길이 2.4m와 너비 30cm', undefined],
      ['W', '크기', '238×28×32cm', 'cm'],
      ['G', '수량', '5기', undefined],
      ['A', '높이', '높이 10cm', 'cm'],
      ['W', '크기', '굽높이 0.5cm(내) 0.5cm(외) 두께 0.5~0.7cm', 'cm'],
    ]);
    expect(result.attributes[0]).toEqual({
      recordId: 'record-W',
      keyText: '전체 규모',
      valueText: '길이 4.9m, 너비 3.89m이상, 깊이 3.7m',
      unitText: 'm',
      sourceText:
        '우물의 전체 규모는 길이 4.9m, 너비 3.89m이상, 깊이 3.7m이다.',
      extractionMethod: 'rule',
      metadata: {
        kind: 'measurement',
        sourceId: 's1',
        locator: '/loc/s1',
        pdfPageNo: 4,
      },
    });
    expect(result.attributes[5].metadata.kind).toBe('quantity');
    expect(result.ownerQuestions).toEqual([
      {
        recordId: 'record-P2',
        otherRecordIds: ['record-P11'],
        attribute: expect.objectContaining({ valueText: '깊이 20cm' }),
      },
      {
        recordId: 'record-P2',
        otherRecordIds: ['record-W'],
        attribute: expect.objectContaining({ valueText: '깊이 9cm' }),
      },
    ]);
  });
});
