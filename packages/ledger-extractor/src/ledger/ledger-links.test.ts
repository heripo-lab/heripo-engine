import type { RecordLinks } from '../links/record-links';
import type { ArchaeologyLedgerResult } from './archaeology-ledger';

import { describe, expect, test } from 'vitest';

import { applyLedgerLinks } from './ledger-links';

const ledger = (issues: unknown[] = []): ArchaeologyLedgerResult =>
  ({
    ledger: { id: 'ledger-1', validationStatus: 'passed' },
    records: [
      { id: 'r1', sourceName: '1호 수혈', sourceIdentifier: '1호' },
      { id: 'r2', sourceName: '수혈', sourceIdentifier: '2' },
      { id: 'r3', sourceName: '연못지' },
    ].map((r, ordinal) => ({ ...r, ordinal, needsReview: false })),
    sources: [],
    attributes: [],
    mediaReferences: [],
    links: [
      {
        id: 'link-1',
        ledgerId: 'ledger-1',
        fromRecordId: 'r2',
        toRecordId: 'r1',
        relationLabel: '중복',
        evidence: [{ kind: 'phrase', text: '1호 수혈과 중복' }],
        needsReview: false,
      },
    ],
    pending: ['links'],
    reviewItems: [{ id: 'review-1', kind: 'identity' }],
    issues,
  }) as unknown as ArchaeologyLedgerResult;
const sentence = (recordId: string, quote: string) => ({
  recordId,
  quote,
  sourceId: 's1',
  locator: '/l/1',
  pdfPageNo: 4,
});
const links: RecordLinks = {
  version: 'record-links.v1',
  links: [
    {
      fromRecordId: 'r1',
      toRecordId: 'r2',
      relationLabel: '중복',
      symmetric: true,
      basis: 'rule',
      evidence: [sentence('r1', '2호 수혈과 중복된다.')],
    },
    {
      fromRecordId: 'r1',
      toRecordId: 'r2',
      relationLabel: '파괴',
      symmetric: false,
      basis: 'rule',
      evidence: [sentence('r1', '2호 수혈을 파괴하였다.')],
    },
    {
      fromRecordId: 'r1',
      toRecordId: 'r2',
      relationLabel: '파괴',
      symmetric: false,
      basis: 'rule',
      evidence: [sentence('r1', '2호 수혈을 다시 파괴하였다.')],
    },
    {
      fromRecordId: 'r1',
      toRecordId: 'r3',
      relationLabel: '중복관계',
      symmetric: true,
      basis: 'table_column',
      evidence: [
        {
          recordId: 'r1',
          quote: '중복관계: 연못지',
          tableId: 'tbl-1',
          cellKey: '/tables/1/grid/2/3',
          pdfPageNo: 9,
        },
      ],
    },
  ],
  questions: [
    {
      recordId: 'r3',
      candidateRecordIds: ['r1', 'r2'],
      reason: 'link_several_targets',
      evidence: sentence('r3', '서측으로 1호 수혈, 동측으로 2호 수혈.'),
    },
    {
      recordId: 'r3',
      candidateRecordIds: ['r1'],
      reason: 'link_unclear',
      evidence: {
        recordId: 'r3',
        quote: '비고: 1호 수혈',
        cellKey: '/tables/2/grid/1/1',
        pdfPageNo: 10,
      },
    },
  ],
  unresolved: [
    {
      recordId: 'r1',
      written: '5호주거지',
      candidateRecordIds: ['r2', 'r3'],
      evidence: sentence('r1', '5호 주거지와 중복된다.'),
    },
    {
      recordId: 'r2',
      written: '9호주거지',
      candidateRecordIds: [],
      evidence: {
        recordId: 'r2',
        quote: '중복관계: 9호 주거지',
        cellKey: '/tables/3/grid/1/2',
        pdfPageNo: 11,
      },
    },
  ],
  locatedInSkipped: 0,
  inRangeSkipped: 0,
  withoutCueSkipped: 0,
};

describe('applyLedgerLinks', () => {
  test('adds and merges links, asks the questions and reports unresolved targets', () => {
    const result = applyLedgerLinks(ledger(), links);

    expect(result.links).toEqual([
      {
        id: 'link-1',
        ledgerId: 'ledger-1',
        fromRecordId: 'r2',
        toRecordId: 'r1',
        relationLabel: '중복',
        evidence: [
          { kind: 'phrase', text: '1호 수혈과 중복' },
          {
            kind: 'excerpt',
            text: '2호 수혈과 중복된다.',
            quote: '2호 수혈과 중복된다.',
            locator: '/l/1',
            pdfPageNo: 4,
          },
        ],
        needsReview: false,
      },
      {
        id: 'link-2',
        ledgerId: 'ledger-1',
        fromRecordId: 'r1',
        toRecordId: 'r2',
        relationLabel: '파괴',
        evidence: [
          expect.objectContaining({ text: '2호 수혈을 파괴하였다.' }),
          expect.objectContaining({ text: '2호 수혈을 다시 파괴하였다.' }),
        ],
        needsReview: false,
        basis: 'rule',
        symmetric: false,
      },
      expect.objectContaining({
        id: 'link-3',
        relationLabel: '중복관계',
        basis: 'table_column',
        evidence: [
          {
            kind: 'table_cell',
            text: '중복관계: 연못지',
            quote: '중복관계: 연못지',
            locator: '/tables/1/grid/2/3',
            pdfPageNo: 9,
          },
        ],
      }),
    ]);
    expect(ledger().links[0].evidence).toHaveLength(1);
    expect(result.reviewItems.slice(1)).toEqual([
      {
        id: 'review-2',
        kind: 'link',
        recordIds: ['r3'],
        confirmedRecordIds: [],
        reasons: ['link_several_targets'],
        candidateRecordIds: ['r1', 'r2'],
        text: '서측으로 1호 수혈, 동측으로 2호 수혈.',
        locator: '/l/1',
        pdfPageNo: 4,
      },
      expect.objectContaining({
        id: 'review-3',
        reasons: ['link_unclear'],
        locator: '/tables/2/grid/1/1',
      }),
    ]);
    expect(result.records.map((r) => r.needsReview)).toEqual([
      false,
      false,
      true,
    ]);
    expect(result.issues).toEqual([
      {
        code: 'UNRESOLVED_LINK_TARGET',
        severity: 'warning',
        stage: 'links',
        recordId: 'r1',
        message: '1호 수혈 names "5호주거지", which 2 수혈, 연못지 share',
        locator: '/l/1',
      },
      expect.objectContaining({
        code: 'UNRESOLVED_LINK_TARGET',
        severity: 'warning',
        stage: 'links',
        message: '2 수혈 names "9호주거지", which no registered record has',
        locator: '/tables/3/grid/1/2',
        recordId: 'r2',
      }),
    ]);
    expect(result.pending).toEqual([]);
    expect(result.ledger.validationStatus).toBe('passed');
  });

  test('passes with nothing to add and keeps earlier warnings', () => {
    const none: RecordLinks = {
      ...links,
      links: [],
      questions: [],
      unresolved: [],
    };

    expect(applyLedgerLinks(ledger(), none).issues).toEqual([]);
    expect(applyLedgerLinks(ledger(['earlier']), none).issues).toEqual([
      'earlier',
    ]);
  });
});
