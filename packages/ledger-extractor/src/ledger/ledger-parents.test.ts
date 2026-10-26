import type { RelationParentJudgment } from '../relations/parent-judgment';
import type { RelationParents } from '../relations/relation-parents';
import type { ArchaeologyLedgerResult } from './archaeology-ledger';

import { describe, expect, test } from 'vitest';

import { applyLedgerParents } from './ledger-parents';

const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'c1', 'c2', 'f1', 'z1'];
const ledger = (): ArchaeologyLedgerResult =>
  ({
    ledger: { id: 'ledger-1' },
    records: ids.map((id) => ({ id, needsReview: id === 'z1' })),
    links: [],
    pending: ['parent_hierarchy', 'attributes', 'media_references', 'links'],
    reviewItems: [{ id: 'review-1', kind: 'identity' }],
  }) as unknown as ArchaeologyLedgerResult;
const phrase = {
  kind: 'phrase' as const,
  targetRecordIds: ['f1'],
  text: '1호 수혈에서 출토',
  locator: '/b/1#0-9',
  pdfPageNo: 3,
};
const title = {
  kind: 'chapter_title' as const,
  targetRecordIds: ['z1'],
  text: '1) 1구역',
  chapterId: 'ch-1',
};
const question = (recordId: string, reasons: string[]) => ({
  recordId,
  reasons,
  candidateRecordIds: ['z1'],
  signals: [],
});
const parents = {
  parents: [
    {
      recordId: 'a1',
      parentRecordId: 'f1',
      basis: 'phrase',
      evidence: [phrase],
      otherSignals: [],
    },
    {
      recordId: 'c1',
      parentRecordId: 'c2',
      basis: 'phrase',
      evidence: [title],
      otherSignals: [],
    },
  ],
  questions: [
    question('a2', ['scope_only']),
    question('a3', ['scope_only']),
    question('a4', ['unmatched_place']),
    question('a5', ['ambiguous_target']),
    question('a6', ['title_only']),
    question('c2', ['scope_only']),
  ],
  links: [
    {
      fromRecordId: 'a1',
      toRecordId: 'z1',
      relationLabel: '출토',
      evidence: [phrase],
    },
    {
      fromRecordId: 'a6',
      toRecordId: 'z1',
      relationLabel: '같은 표 행',
      evidence: [title],
    },
  ],
} as unknown as RelationParents;
const judgment = (
  recordId: string,
  status: RelationParentJudgment['status'],
  extra: Partial<RelationParentJudgment> = {},
): RelationParentJudgment => ({
  recordId,
  status,
  evidence: [],
  votes: [],
  ...extra,
});

describe('applyLedgerParents', () => {
  test('sets decided parents and reviews unresolved, unmatched and cyclic ones', () => {
    const result = applyLedgerParents(ledger(), parents, [
      judgment('a2', 'parent', {
        parentRecordId: 'z1',
        evidence: [
          { ref: 'E1', questionRef: 'Q1', kind: 'excerpt', text: '1구역 안' },
        ],
        votes: ['z1', 'z1', 'z1'],
      }),
      judgment('a3', 'none', { votes: ['none', 'none', 'none'] }),
      judgment('a4', 'none', { votes: ['none', 'none', 'none'] }),
      judgment('a5', 'review', { votes: ['z1', 'none', 'invalid'] }),
      judgment('c2', 'parent', { parentRecordId: 'c1' }),
      judgment('x9', 'parent', { parentRecordId: 'z1' }),
    ]);
    const record = (id: string) => result.records.find((r) => r.id === id)!;

    expect(record('a1')).toEqual({
      id: 'a1',
      needsReview: false,
      parentRecordId: 'f1',
      parentBasis: 'code',
      parentEvidence: [
        {
          kind: 'phrase',
          text: '1호 수혈에서 출토',
          locator: '/b/1#0-9',
          pdfPageNo: 3,
        },
      ],
    });
    expect(record('a2')).toMatchObject({
      parentRecordId: 'z1',
      parentBasis: 'judgment',
      parentEvidence: [{ kind: 'excerpt', text: '1구역 안' }],
    });
    expect(record('a3')).toEqual({ id: 'a3', needsReview: false });
    expect(record('z1').needsReview).toBe(true);
    expect(
      ['a4', 'a5', 'a6', 'c1', 'c2'].map((id) => [
        id,
        record(id).needsReview,
        record(id).parentRecordId,
      ]),
    ).toEqual([
      ['a4', true, undefined],
      ['a5', true, undefined],
      ['a6', true, undefined],
      ['c1', true, undefined],
      ['c2', true, undefined],
    ]);
    expect(result.reviewItems.slice(1)).toEqual([
      {
        id: 'review-2',
        kind: 'parent',
        recordIds: ['a4'],
        confirmedRecordIds: [],
        reasons: ['unresolved_parent', 'unmatched_place', 'judged_none'],
        candidateRecordIds: ['z1'],
        votes: ['none', 'none', 'none'],
      },
      expect.objectContaining({
        recordIds: ['a5'],
        reasons: ['unresolved_parent', 'ambiguous_target', 'judgment_split'],
      }),
      {
        id: 'review-4',
        kind: 'parent',
        recordIds: ['a6'],
        confirmedRecordIds: [],
        reasons: ['unresolved_parent', 'title_only', 'not_judged'],
        candidateRecordIds: ['z1'],
      },
      expect.objectContaining({
        recordIds: ['c1'],
        reasons: ['unresolved_parent', 'cycle'],
        candidateRecordIds: ['c2'],
      }),
      expect.objectContaining({
        recordIds: ['c2'],
        candidateRecordIds: ['c1'],
      }),
    ]);
    expect(result.links).toEqual([
      {
        id: 'link-1',
        ledgerId: 'ledger-1',
        fromRecordId: 'a1',
        toRecordId: 'z1',
        relationLabel: '출토',
        evidence: [record('a1').parentEvidence![0]],
        needsReview: false,
      },
    ]);
    expect(result.pending).toEqual(['attributes', 'media_references', 'links']);
  });

  test('keeps chapter evidence without a locator and works without judgments', () => {
    const result = applyLedgerParents(ledger(), {
      parents: [
        { ...parents.parents[1], recordId: 'a1', parentRecordId: 'z1' },
      ],
      questions: [],
      links: [],
    } as unknown as RelationParents);

    expect(result.records[0].parentEvidence).toEqual([
      { kind: 'chapter_title', text: '1) 1구역', chapterId: 'ch-1' },
    ]);
    expect(result.reviewItems).toHaveLength(1);
  });
});

describe('applyLedgerParents with place aliases', () => {
  test('records alias parents with their rule once, identity items for short forms and the table header', () => {
    const alias = {
      ruleId: 'excavation',
      written: '발굴1구역',
      registered: '23-1 구역',
      quote: '정밀발굴조사(23-1~6구역)',
      recordIds: ['z1'],
    };
    const viaPhrase = { ...phrase, targetRecordIds: ['z1'], alias };
    const viaRow = {
      kind: 'table_row' as const,
      targetRecordIds: ['z1'],
      text: '발굴 1구역',
      locator: '/t/1',
      alias,
    };
    const summary = {
      ruleIds: ['excavation'],
      source: 'manual' as const,
      confirmedAt: 'now',
      inputSha256: 'hash',
      sha256: 'abc',
    };

    const result = applyLedgerParents(ledger(), {
      parents: [
        {
          recordId: 'a1',
          parentRecordId: 'z1',
          basis: 'alias',
          evidence: [viaPhrase, viaRow],
          otherSignals: [],
        },
      ],
      questions: [
        question('a2', ['unmatched_place']),
        question('a3', ['scope_only']),
      ],
      links: [],
      placeAliases: summary,
      aliasDuplicates: [
        {
          recordId: 'a2',
          ruleId: 'excavation',
          written: '발굴2구역',
          registered: '23-2 구역',
          registeredRecordId: 'f1',
        },
        {
          recordId: 'a6',
          ruleId: 'excavation',
          written: '발굴3구역',
          registered: '23-3 구역',
        },
      ],
    } as unknown as RelationParents);
    const record = (id: string) => result.records.find((r) => r.id === id)!;

    expect(record('a1')).toMatchObject({
      parentRecordId: 'z1',
      parentBasis: 'alias',
      parentEvidence: [
        { kind: 'phrase', text: '1호 수혈에서 출토' },
        {
          kind: 'alias_rule',
          text: '발굴1구역 → 23-1 구역',
          ruleId: 'excavation',
          quote: '정밀발굴조사(23-1~6구역)',
        },
        { kind: 'table_row', text: '발굴 1구역', locator: '/t/1' },
      ],
    });
    expect(result.reviewItems.slice(1)).toEqual([
      expect.objectContaining({ kind: 'parent', recordIds: ['a3'] }),
      {
        id: 'review-3',
        kind: 'identity',
        recordIds: ['a2', 'f1'],
        confirmedRecordIds: [],
        reasons: ['alias_duplicate'],
        detail: '발굴2구역 = 23-2 구역 (excavation)',
      },
      expect.objectContaining({ recordIds: ['a6'] }),
    ]);
    expect(
      [record('a2'), record('f1'), record('a6')].map((r) => r.needsReview),
    ).toEqual([true, true, true]);
    expect(result.ledger.placeAliases).toEqual(summary);
  });
});
