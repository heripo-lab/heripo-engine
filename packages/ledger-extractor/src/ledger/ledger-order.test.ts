import type { ProcessedDocument } from '@heripo/model';

import type { ArchaeologyLedgerResult } from './archaeology-ledger';

import { describe, expect, test } from 'vitest';

import { sortArchaeologyLedger } from './ledger-order';

const document = {
  reportId: 'report-1',
  pageRangeMap: {},
  chapters: [
    {
      id: 'ch-1',
      originTitle: '1',
      title: '1',
      pageNo: 1,
      level: 1,
      textBlocks: [
        { id: 'txt-1', text: '첫 문장. 둘째 문장.', pdfPageNo: 1 },
        { id: 'txt-2', text: '셋째 문장.', pdfPageNo: 2 },
      ],
      imageIds: [],
      tableIds: [],
      footnoteIds: [],
    },
  ],
  images: [],
  tables: [
    {
      id: 'tbl-1',
      pdfPageNo: 3,
      numRows: 1,
      numCols: 1,
      grid: [[{ text: '40', rowSpan: 1, colSpan: 1, isHeader: false }]],
    },
  ],
  footnotes: [],
} as unknown as ProcessedDocument;
const record = (id: string, ordinal: number, parentRecordId?: string) => ({
  id,
  ordinal,
  ...(parentRecordId ? { parentRecordId } : {}),
  content: [],
});
const ledger = {
  ledger: { id: 'ledger-1' },
  records: [
    {
      ...record('child', 0, 'root'),
      content: [
        { id: 'c-missing', sourceIds: ['s-gone'] },
        { id: 'c-later', sourceIds: ['s2'] },
        { id: 'c-second', sourceIds: ['s1b'] },
        { id: 'c-first', sourceIds: ['s1'] },
      ],
    },
    record('root', 1),
    record('cycle-a', 2, 'cycle-b'),
    record('cycle-b', 3, 'cycle-a'),
    record('lost', 4, 'gone'),
    record('another-root', 5),
  ],
  sources: [
    {
      id: 's2',
      recordId: 'child',
      pdfPageNo: 2,
      locator: '/chapters/0/textBlocks/1#0-6',
    },
    {
      id: 's1b',
      recordId: 'child',
      pdfPageNo: 1,
      locator: '/chapters/0/textBlocks/0#6-13',
    },
    {
      id: 's1',
      recordId: 'child',
      pdfPageNo: 1,
      locator: '/chapters/0/textBlocks/0#0-5',
    },
    { id: 's-null', recordId: 'child', pdfPageNo: null, locator: '/x' },
    {
      id: 's-root',
      recordId: 'root',
      pdfPageNo: 9,
      locator: '/tables/0/grid/0/0#0-2',
    },
    { id: 's-stranger', recordId: 'nobody', pdfPageNo: 1, locator: '/a' },
  ],
  attributes: [
    {
      id: 'a-no-source',
      recordId: 'child',
      keyText: 'k',
      metadata: { sourceId: 's-gone' },
    },
    {
      id: 'a-text',
      recordId: 'child',
      keyText: 'k',
      metadata: { sourceId: 's2' },
    },
    {
      id: 'a-cell',
      recordId: 'child',
      keyText: 'k',
      metadata: { cellKey: '/tables/0/grid/0/0' },
    },
    {
      id: 'a-first',
      recordId: 'child',
      keyText: 'k',
      metadata: { sourceId: 's1' },
    },
    {
      id: 'a-root',
      recordId: 'root',
      keyText: 'k',
      metadata: { sourceId: 's-root' },
    },
    {
      id: 'a-b',
      recordId: 'root',
      keyText: 'k',
      metadata: { sourceId: 's-root' },
    },
  ],
  mediaReferences: [
    { id: 'm3', recordId: 'child', ordinal: 2, imageId: 'img-1' },
    { id: 'm2', recordId: 'child', ordinal: 1, imageId: 'img-2' },
    { id: 'm1', recordId: 'child', ordinal: 1, imageId: 'img-1' },
    { id: 'm0', recordId: 'root', ordinal: 5, imageId: 'img-9' },
  ],
  links: [
    {
      id: 'l3',
      fromRecordId: 'child',
      toRecordId: 'root',
      relationLabel: '중복',
    },
    {
      id: 'l2',
      fromRecordId: 'child',
      toRecordId: 'root',
      relationLabel: '인접',
    },
    {
      id: 'l1',
      fromRecordId: 'root',
      toRecordId: 'child',
      relationLabel: '중복',
    },
    {
      id: 'l0',
      fromRecordId: 'root',
      toRecordId: 'gone',
      relationLabel: '중복',
    },
  ],
  pending: [],
  reviewItems: [{ id: 'review-2' }, { id: 'review-1' }],
  issues: [],
} as unknown as ArchaeologyLedgerResult;
const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);

describe('sortArchaeologyLedger', () => {
  test('orders every list as the spec says without changing IDs or values', () => {
    const before = structuredClone(ledger);
    const result = sortArchaeologyLedger(ledger, document);

    expect(ledger).toEqual(before);
    expect(ids(result.records)).toEqual([
      'root',
      'another-root',
      'cycle-b',
      'cycle-a',
      'lost',
      'child',
    ]);
    expect(ids(result.records.at(-1)!.content)).toEqual([
      'c-first',
      'c-second',
      'c-later',
      'c-missing',
    ]);
    expect(ids(result.sources)).toEqual([
      's-root',
      's1',
      's1b',
      's2',
      's-null',
      's-stranger',
    ]);
    expect(ids(result.attributes)).toEqual([
      'a-b',
      'a-root',
      'a-first',
      'a-text',
      'a-cell',
      'a-no-source',
    ]);
    expect(ids(result.mediaReferences)).toEqual(['m0', 'm1', 'm2', 'm3']);
    expect(ids(result.links)).toEqual(['l1', 'l0', 'l2', 'l3']);
    expect(result.reviewItems).toBe(ledger.reviewItems);
  });
});
