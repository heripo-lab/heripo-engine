import type { ArchaeologyLedgerResult } from '../ledger/archaeology-ledger';
import type { RelationSignal, RelationSignals } from './relation-signals';

import { describe, expect, test } from 'vitest';

import {
  RELATION_PARENTS_VERSION,
  resolveRelationParents,
} from './relation-parents';

const phrase = (
  targets: string[],
  text = '1호 수혈에서 출토',
  finding = true,
): RelationSignal => ({
  kind: 'phrase',
  targetRecordIds: targets,
  text,
  finding,
});
const row = (target: string): RelationSignal => ({
  kind: 'table_row',
  targetRecordIds: [target],
  text: target,
  finding: true,
});
const scope = (target: string): RelationSignal => ({
  kind: 'heading_scope',
  targetRecordIds: [target],
  text: `heading ${target}`,
});
const title = (target: string): RelationSignal => ({
  kind: 'chapter_title',
  targetRecordIds: [target],
  text: `chapter ${target}`,
});
const ledger = {
  records: [
    ['f1', 'feature'],
    ['f2', 'feature'],
    ['a1', 'area'],
    ['l1', 'layer'],
  ].map(([id, recordKind]) => ({ id, recordKind })),
} as unknown as ArchaeologyLedgerResult;
const signals = (
  records: Record<string, RelationSignal[]>,
): RelationSignals => ({
  version: 'relation-signals.v1',
  candidateSnapshotId: 'snap',
  records: Object.entries(records).map(([recordId, list]) => ({
    recordId,
    signals: list,
  })),
});

describe('resolveRelationParents', () => {
  test('sets parents only from one finding phrase or table-row target and keeps other relations as links', () => {
    const result = resolveRelationParents(
      signals({
        single: [phrase(['f1']), scope('a1'), title('f1')],
        byRow: [row('l1')],
        featureFirst: [
          phrase(['f1']),
          phrase(['a1'], '1구역에서 수습'),
          row('l1'),
        ],
        conflict: [phrase(['a1']), row('l1')],
        ambiguous: [phrase(['f1', 'f2'])],
        none: [],
      }),
      ledger,
    );

    expect(result.version).toBe(RELATION_PARENTS_VERSION);
    expect(result.parents).toEqual([
      {
        recordId: 'single',
        parentRecordId: 'f1',
        basis: 'phrase',
        evidence: [phrase(['f1'])],
        otherSignals: [scope('a1')],
      },
      {
        recordId: 'byRow',
        parentRecordId: 'l1',
        basis: 'table_row',
        evidence: [row('l1')],
        otherSignals: [],
      },
      expect.objectContaining({
        recordId: 'featureFirst',
        parentRecordId: 'f1',
      }),
    ]);
    expect(result.links).toEqual([
      {
        fromRecordId: 'featureFirst',
        toRecordId: 'a1',
        relationLabel: '수습',
        evidence: [phrase(['a1'], '1구역에서 수습')],
      },
      {
        fromRecordId: 'featureFirst',
        toRecordId: 'l1',
        relationLabel: '같은 표 행',
        evidence: [row('l1')],
      },
    ]);
    expect(result.questions).toEqual([
      {
        recordId: 'conflict',
        reasons: ['conflicting_targets'],
        candidateRecordIds: ['a1', 'l1'],
        signals: [phrase(['a1']), row('l1')],
      },
      expect.objectContaining({
        recordId: 'ambiguous',
        reasons: ['ambiguous_target'],
        candidateRecordIds: ['f1', 'f2'],
      }),
    ]);
  });

  test('asks about scope, title, confirming and unmatched signals and about parents closing a cycle', () => {
    const result = resolveRelationParents(
      signals({
        weakOnly: [
          phrase([], '98호 수혈에서 출토'),
          phrase(['a1'], '1구역에서 확인', false),
          { ...row('l1'), finding: false },
          scope('l1'),
          title('f1'),
        ],
        titleOnly: [title('f2')],
        f1: [phrase(['f2']), phrase(['a1'])],
        f2: [phrase(['f1'])],
        chained: [phrase(['f1'])],
      }),
      ledger,
    );

    expect(result.questions.map((q) => [q.recordId, q.reasons])).toEqual([
      [
        'weakOnly',
        [
          'unmatched_place',
          'confirming_phrase',
          'row_only',
          'scope_only',
          'title_only',
        ],
      ],
      ['titleOnly', ['title_only']],
      ['f1', ['cycle']],
      ['f2', ['cycle']],
    ]);
    expect(result.questions[0].candidateRecordIds).toEqual(['a1', 'l1', 'f1']);
    expect(result.parents.map((p) => p.recordId)).toEqual(['chained']);
    expect(result.links).toEqual([]);
  });
});

describe('resolveRelationParents with place aliases', () => {
  test('marks alias-only parents, asks about unresolved aliases and carries the table summary', () => {
    const alias = (recordIds: string[]) => ({
      ruleId: 'excavation',
      written: '발굴1구역',
      registered: '23-1 구역',
      quote: 'q',
      recordIds,
    });
    const viaAlias = { ...phrase(['a1']), alias: alias(['a1']) };
    const input = {
      ...signals({
        aliasOnly: [viaAlias],
        aliasAndRow: [viaAlias, row('a1')],
        aliasAndPhrase: [viaAlias, phrase(['a1'])],
        unresolved: [{ ...phrase([]), alias: alias([]) }],
      }),
      placeAliases: {
        ruleIds: ['excavation'],
        source: 'manual' as const,
        confirmedAt: 'now',
        inputSha256: 'hash',
      },
      aliasDuplicates: [],
    };

    const result = resolveRelationParents(input, ledger);

    expect(result.parents.map((p) => [p.recordId, p.basis])).toEqual([
      ['aliasOnly', 'alias'],
      ['aliasAndRow', 'table_row'],
      ['aliasAndPhrase', 'phrase'],
    ]);
    expect(result.questions).toEqual([
      expect.objectContaining({
        recordId: 'unresolved',
        reasons: ['unmatched_place', 'alias_unresolved'],
      }),
    ]);
    expect(result.placeAliases).toEqual(input.placeAliases);
    expect(result.aliasDuplicates).toEqual([]);
  });
});
