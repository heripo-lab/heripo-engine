import type { ProcessedDocument } from '@heripo/model';

import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { ArchaeologyLedgerResult } from './archaeology-ledger';

import { describe, expect, test } from 'vitest';

import { applyLedgerNameAnchors } from './ledger-name-anchors';

const blocks = [
  '1) 정밀발굴조사(23-1~6구역)',
  '이번 정밀발굴조사는 지난 시굴조사 결과를 바탕으로 중심 좌표를 정하고 그리드를 설치하여 진행하였다.',
  '10 × 10m 크기의 그리드를 하나의 구역으로 설치하였다.',
  '매도23-21',
  '청자접시 靑磁楪匙',
  '높이 4.4cm',
  '토기',
  '마도23-9',
  '토기',
  '기타',
];
const document = {
  reportId: 'r',
  pageRangeMap: {},
  chapters: [
    {
      id: 'ch-1',
      originTitle: '조사 내용',
      title: '조사 내용',
      pageNo: 1,
      level: 1,
      textBlocks: blocks.map((text, i) => ({
        ...(i === 4 ? {} : { id: `txt-${i}`, sourceRef: `#/texts/${i}` }),
        text,
        pdfPageNo: 10 + i,
      })),
      imageIds: [],
      tableIds: [],
      footnoteIds: [],
    },
  ],
  images: [],
  tables: [],
  footnotes: [],
} as unknown as ProcessedDocument;
const plan = {
  registry: ['scope', 'dish', 'pot', 'found', 'lost', 'cell'].map((id) => ({
    groupId: id,
    mentions: [{ chapterPath: [{ originTitle: '조사 내용' }], evidence: [] }],
  })),
} as unknown as ContentAttachmentPlan;
const registration = (id: string, recordId: string, locator: string) => ({
  id,
  recordId: `record-${recordId}`,
  locator,
  excerpt: 'x',
  basis: 'registration',
});
const ledger = {
  records: [
    { id: 'record-scope', sourceName: '정밀발굴조사' },
    { id: 'record-dish', sourceName: '청자 접시' },
    { id: 'record-pot', sourceName: '토기' },
    { id: 'record-found', sourceName: '조사 내용' },
    { id: 'record-lost', sourceName: '없는 이름' },
    { id: 'record-cell', sourceName: '셀 이름' },
  ],
  sources: [
    registration('source-1', 'scope', '/chapters/0/textBlocks/2#0-5'),
    registration('source-2', 'dish', '/chapters/0/textBlocks/3#0-7'),
    registration('source-3', 'pot', '/chapters/0/textBlocks/7#0-6'),
    registration('source-4', 'found', '/chapters/0/textBlocks/9#0-2'),
    registration('source-5', 'lost', '/chapters/0/textBlocks/9#0-2'),
    registration('source-6', 'cell', '/tables/0/grid/1/0#0-1'),
    {
      ...registration('source-7', 'lost', '/chapters/0/textBlocks/2#0-5'),
      basis: 'model_unanimous',
    },
  ],
} as unknown as ArchaeologyLedgerResult;

describe('applyLedgerNameAnchors', () => {
  test('adds the nearby block where a missing name is written, preferring short blocks, then near, then early', () => {
    const before = structuredClone(ledger);
    const result = applyLedgerNameAnchors(ledger, plan, document);
    const added = result.sources.slice(ledger.sources.length);

    expect(ledger).toEqual(before);
    expect(result.records).toBe(ledger.records);
    expect(added).toEqual([
      {
        id: 'source-8',
        recordId: 'record-scope',
        chapterId: 'ch-1',
        textBlockId: 'txt-0',
        sourceRef: '#/texts/0',
        pdfPageNo: 10,
        locator: '/chapters/0/textBlocks/0#3-9',
        excerpt: '정밀발굴조사',
        charStart: 3,
        charEnd: 9,
        basis: 'name_anchor',
      },
      {
        id: 'source-9',
        recordId: 'record-dish',
        chapterId: 'ch-1',
        pdfPageNo: 14,
        locator: '/chapters/0/textBlocks/4#0-4',
        excerpt: '청자접시',
        charStart: 0,
        charEnd: 4,
        basis: 'name_anchor',
      },
      expect.objectContaining({
        id: 'source-10',
        recordId: 'record-pot',
        locator: '/chapters/0/textBlocks/6#0-2',
        excerpt: '토기',
      }),
    ]);
  });
});
