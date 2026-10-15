import type { Chapter, ProcessedDocument } from '@heripo/model';

import { describe, expect, test } from 'vitest';

import {
  buildDocumentResourceIndex,
  queryDocumentResources,
} from './document-resource-index';

const chapter = (overrides: Partial<Chapter> = {}): Chapter => ({
  id: 'ch-1',
  originTitle: ' 원제목 ',
  title: '제목',
  pageNo: 0,
  level: 1,
  textBlocks: [],
  imageIds: [],
  tableIds: [],
  footnoteIds: [],
  ...overrides,
});
const document = (
  overrides: Partial<ProcessedDocument> = {},
): ProcessedDocument => ({
  reportId: 'report-1',
  pageRangeMap: {
    1: { startPageNo: -1, endPageNo: 0 },
    2: { startPageNo: 1, endPageNo: 2 },
  },
  chapters: [],
  images: [],
  tables: [],
  footnotes: [],
  ...overrides,
});

const fixture = (): ProcessedDocument =>
  document({
    chapters: [
      chapter({
        sourceRefs: ['#/texts/0'],
        textBlocks: [
          {
            id: 'txt-1',
            sourceRef: '#/texts/1',
            text: '우물  원문\n그대로.',
            pdfPageNo: 1,
          },
          { text: 'ID 없는 원문', pdfPageNo: 9 },
        ],
        imageIds: ['img-1', 'img-1'],
        tableIds: ['tbl-1'],
        footnoteIds: ['fn-1'],
        children: [chapter({ id: 'ch-2', pageNo: 1, imageIds: ['img-1'] })],
      }),
    ],
    images: [
      {
        id: 'img-1',
        sourceRef: '#/pictures/0',
        captionSourceRefs: ['#/texts/99'],
        caption: { fullText: '도면 61 우물 출토유물' },
        pdfPageNo: 2,
        path: 'https://example.com/1.png',
      },
      { id: 'img-2', pdfPageNo: 9, path: 'unchanged.png' },
    ],
    tables: [
      {
        id: 'tbl-1',
        sourceRef: '#/tables/0',
        captionSourceRefs: ['#/texts/100'],
        caption: { fullText: '표 1 목록' },
        pdfPageNo: 2,
        numRows: 1,
        numCols: 3,
        grid: [
          [
            { text: '합계', rowSpan: 1, colSpan: 2, isHeader: true },
            { text: '3점', rowSpan: 1, colSpan: 1, isHeader: false },
          ],
        ],
      },
    ],
    footnotes: [
      { id: 'fn-1', sourceRef: '#/texts/50', text: '각주', pdfPageNo: 1 },
      { id: 'fn-2', text: '독립 각주', pdfPageNo: 9 },
    ],
  });

describe('document resource index', () => {
  test('preserves source text, storage locators, memberships and merged cell coordinates', () => {
    const input = fixture();
    const before = structuredClone(input);
    const index = buildDocumentResourceIndex(input);
    expect(input).toEqual(before);
    expect(index.reportId).toBe('report-1');
    expect(index.resources).toHaveLength(11);
    expect(
      queryDocumentResources(index, { resourceId: 'txt-1' })[0],
    ).toMatchObject({
      key: '/chapters/0/textBlocks/0',
      sourceRefs: ['#/texts/1'],
      chapterIds: ['ch-1'],
      logicalPageRange: { startPageNo: -1, endPageNo: 0 },
      data: { text: '우물  원문\n그대로.' },
    });
    expect(
      queryDocumentResources(index, { resourceId: 'img-1' })[0].chapterIds,
    ).toEqual(['ch-1', 'ch-2']);
    expect(
      queryDocumentResources(index, { resourceId: 'img-2' })[0].chapterIds,
    ).toEqual([]);
    expect(
      queryDocumentResources(index, { kind: 'tableCell', text: '3점' })[0],
    ).toMatchObject({
      key: '/tables/0/grid/0/1',
      resourceId: null,
      tableId: 'tbl-1',
      rowIndex: 0,
      columnIndex: 1,
      sourceRefs: ['#/tables/0'],
      chapterIds: ['ch-1'],
    });
    expect(queryDocumentResources(index, { kind: 'chapter' })[0]).toMatchObject(
      { pdfPageNo: null, logicalPageRange: { startPageNo: 0, endPageNo: 0 } },
    );
    expect(queryDocumentResources(index, { text: 'ID 없는' })[0]).toMatchObject(
      { resourceId: null, sourceRefs: [], logicalPageRange: null },
    );
    expect(
      queryDocumentResources(index, { resourceId: 'fn-1' })[0].chapterIds,
    ).toEqual(['ch-1']);
    expect(
      queryDocumentResources(index, { resourceId: 'fn-2' })[0],
    ).toMatchObject({ sourceRefs: [], chapterIds: [] });
  });

  test('combines exact filters and signed logical page ranges without guessing missing pages', () => {
    const index = buildDocumentResourceIndex(fixture());
    expect(queryDocumentResources(index)).toEqual(index.resources);
    expect(
      queryDocumentResources(index, {
        kind: 'text',
        chapterId: 'ch-1',
        pdfPageNo: 1,
        logicalPageNo: 0,
        sourceRef: '#/texts/1',
        resourceId: 'txt-1',
        text: '원문\n그대로',
      }),
    ).toHaveLength(1);
    expect(
      queryDocumentResources(index, { logicalPageNo: -1 }).map((r) => r.kind),
    ).toEqual(['text', 'footnote']);
    expect(
      queryDocumentResources(index, { logicalPageNo: 2 }).map((r) => r.kind),
    ).toEqual(['image', 'table', 'tableCell', 'tableCell']);
    for (const query of [
      { kind: 'text' as const, chapterId: 'ch-2' },
      { resourceId: 'missing' },
      { sourceRef: '#/missing' },
      { pdfPageNo: 300 },
      { logicalPageNo: -2 },
      { logicalPageNo: 3 },
      { text: '우물 원문' },
    ])
      expect(queryDocumentResources(index, query)).toEqual([]);
    expect(
      queryDocumentResources(index, { sourceRef: '#/texts/99' })[0].kind,
    ).toBe('image');
    expect(queryDocumentResources(index, { text: '도면 61' })[0].kind).toBe(
      'image',
    );
    expect(queryDocumentResources(index, { text: '표 1' })[0].kind).toBe(
      'table',
    );
    expect(queryDocumentResources(index, { text: '원제목' })[0].kind).toBe(
      'chapter',
    );
    expect(
      queryDocumentResources(index, { text: '/tables/0/grid/0/1' }),
    ).toHaveLength(1);
    expect(queryDocumentResources(index, { text: '#/texts/50' })[0].kind).toBe(
      'footnote',
    );
    expect(queryDocumentResources(index, { text: 'img-1' })).toHaveLength(1);
  });

  test('keeps duplicate IDs distinct and supports optional references and empty documents', () => {
    const input = document({
      chapters: [
        chapter({
          textBlocks: [
            { id: 'same', text: 'A', pdfPageNo: 1 },
            { id: 'same', text: 'B', pdfPageNo: 1 },
          ],
        }),
      ],
      tables: [{ id: 'empty', pdfPageNo: 1, numRows: 0, numCols: 0, grid: [] }],
    });
    const index = buildDocumentResourceIndex(input);
    expect(
      queryDocumentResources(index, { resourceId: 'same' }).map((r) => r.key),
    ).toEqual(['/chapters/0/textBlocks/0', '/chapters/0/textBlocks/1']);
    expect(queryDocumentResources(index, { text: 'absent' })).toEqual([]);
    expect(
      queryDocumentResources(index, { resourceId: 'empty' })[0],
    ).toMatchObject({ sourceRefs: [], chapterIds: [] });
    expect(buildDocumentResourceIndex(document()).resources).toEqual([]);
  });
});
