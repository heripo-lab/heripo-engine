import type { Chapter, ProcessedDocument } from '@heripo/model';

import { describe, expect, test, vi } from 'vitest';

import { LedgerExtractor } from './ledger-extractor';

function createChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'ch-1',
    originTitle: 'Chapter 1',
    title: 'Chapter 1',
    pageNo: 1,
    level: 1,
    textBlocks: [],
    imageIds: [],
    tableIds: [],
    footnoteIds: [],
    ...overrides,
  };
}

function createDocument(
  overrides: Partial<ProcessedDocument> = {},
): ProcessedDocument {
  return {
    reportId: 'report-001',
    schemaVersion: '1.0.0',
    pageRangeMap: { 1: { startPageNo: 1, endPageNo: 1 } },
    chapters: [],
    images: [],
    tables: [],
    footnotes: [],
    ...overrides,
  };
}

function createLoggerMock() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('LedgerExtractor', () => {
  test('summarizes a document with nested chapters recursively', async () => {
    const document = createDocument({
      chapters: [
        createChapter({
          id: 'ch-1',
          title: 'Chapter 1',
          textBlocks: [
            { text: 'Block A', pdfPageNo: 1 },
            { text: 'Block B', pdfPageNo: 2 },
          ],
          children: [
            createChapter({
              id: 'ch-1-1',
              title: '1.1 Background',
              level: 2,
              textBlocks: [{ text: 'Nested block', pdfPageNo: 3 }],
              children: [
                createChapter({
                  id: 'ch-1-1-1',
                  title: '1.1.1 Detail',
                  level: 3,
                  textBlocks: [{ text: 'Deeply nested block', pdfPageNo: 4 }],
                }),
              ],
            }),
          ],
        }),
        createChapter({
          id: 'ch-2',
          title: 'Chapter 2',
          textBlocks: [{ text: 'Block C', pdfPageNo: 5 }],
        }),
      ],
    });

    const extractor = new LedgerExtractor();
    const preview = await extractor.extract(document);

    expect(preview.counts.chapters).toBe(4);
    expect(preview.counts.textBlocks).toBe(5);
    // Depth-first order: parent chapters come before their children
    expect(preview.samples.chapterTitles).toEqual([
      'Chapter 1',
      '1.1 Background',
      '1.1.1 Detail',
      'Chapter 2',
    ]);
    expect(preview.samples.textBlocks).toEqual([
      { chapterId: 'ch-1', pdfPageNo: 1, text: 'Block A' },
      { chapterId: 'ch-1', pdfPageNo: 2, text: 'Block B' },
      { chapterId: 'ch-1-1', pdfPageNo: 3, text: 'Nested block' },
      { chapterId: 'ch-1-1-1', pdfPageNo: 4, text: 'Deeply nested block' },
      { chapterId: 'ch-2', pdfPageNo: 5, text: 'Block C' },
    ]);
  });

  test('aggregates table grid cells across all tables', async () => {
    const cell = { text: 'x', rowSpan: 1, colSpan: 1, isHeader: false };
    const document = createDocument({
      tables: [
        {
          id: 'tbl-1',
          caption: { fullText: 'Table 1 Artifact list' },
          pdfPageNo: 1,
          numRows: 2,
          numCols: 3,
          grid: [
            [cell, cell, cell],
            [cell, cell, cell],
          ],
        },
        {
          id: 'tbl-2',
          pdfPageNo: 2,
          numRows: 1,
          numCols: 2,
          grid: [[cell, cell]],
        },
      ],
    });

    const preview = await new LedgerExtractor().extract(document);

    expect(preview.counts.tables).toBe(2);
    expect(preview.counts.tableCells).toBe(8);
    expect(preview.samples.tables).toEqual([
      {
        id: 'tbl-1',
        caption: 'Table 1 Artifact list',
        pdfPageNo: 1,
        numRows: 2,
        numCols: 3,
      },
      {
        id: 'tbl-2',
        caption: null,
        pdfPageNo: 2,
        numRows: 1,
        numCols: 2,
      },
    ]);
  });

  test('carries image path values verbatim as sample URLs', async () => {
    const document = createDocument({
      images: [
        {
          id: 'img-1',
          pdfPageNo: 1,
          path: 'https://cdn.example.com/images/report-001/file-1/image.png',
        },
        {
          id: 'img-2',
          pdfPageNo: 2,
          path: 'https://cdn.example.com/images/report-001/file-2/image.png',
        },
      ],
    });
    const logger = createLoggerMock();

    const preview = await new LedgerExtractor({ logger }).extract(document);

    expect(preview.counts.images).toBe(2);
    expect(preview.samples.images).toEqual([
      {
        id: 'img-1',
        pdfPageNo: 1,
        url: 'https://cdn.example.com/images/report-001/file-1/image.png',
      },
      {
        id: 'img-2',
        pdfPageNo: 2,
        url: 'https://cdn.example.com/images/report-001/file-2/image.png',
      },
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      '[LedgerExtractor] sample image URL: https://cdn.example.com/images/report-001/file-1/image.png',
    );
  });

  test('limits every sample list to the configured sampleLimit', async () => {
    const chapters = Array.from({ length: 4 }, (_, index) =>
      createChapter({
        id: `ch-${index}`,
        title: `Chapter ${index}`,
        textBlocks: [
          { text: `Block ${index}-a`, pdfPageNo: index },
          { text: `Block ${index}-b`, pdfPageNo: index },
        ],
      }),
    );
    const document = createDocument({
      chapters,
      images: Array.from({ length: 4 }, (_, index) => ({
        id: `img-${index}`,
        pdfPageNo: index,
        path: `https://cdn.example.com/${index}.png`,
      })),
      tables: Array.from({ length: 4 }, (_, index) => ({
        id: `tbl-${index}`,
        pdfPageNo: index,
        numRows: 1,
        numCols: 1,
        grid: [[{ text: 'x', rowSpan: 1, colSpan: 1, isHeader: false }]],
      })),
    });

    const preview = await new LedgerExtractor({ sampleLimit: 2 }).extract(
      document,
    );

    expect(preview.samples.chapterTitles).toHaveLength(2);
    expect(preview.samples.textBlocks).toHaveLength(2);
    expect(preview.samples.images).toHaveLength(2);
    expect(preview.samples.tables).toHaveLength(2);
    // Counts are not limited by sampleLimit
    expect(preview.counts.chapters).toBe(4);
    expect(preview.counts.textBlocks).toBe(8);
  });

  test('normalizes a negative or fractional sampleLimit', async () => {
    const document = createDocument({
      chapters: [createChapter({ textBlocks: [{ text: 'a', pdfPageNo: 1 }] })],
    });

    const negative = await new LedgerExtractor({ sampleLimit: -3 }).extract(
      document,
    );
    expect(negative.samples.chapterTitles).toHaveLength(0);
    expect(negative.samples.textBlocks).toHaveLength(0);

    const fractional = await new LedgerExtractor({ sampleLimit: 1.9 }).extract(
      document,
    );
    expect(fractional.samples.chapterTitles).toHaveLength(1);
  });

  test('truncates long sampled text', async () => {
    const longText = 'a'.repeat(500);
    const document = createDocument({
      chapters: [
        createChapter({ textBlocks: [{ text: longText, pdfPageNo: 1 }] }),
      ],
      tables: [
        {
          id: 'tbl-1',
          caption: { fullText: longText },
          pdfPageNo: 1,
          numRows: 0,
          numCols: 0,
          grid: [],
        },
      ],
    });

    const preview = await new LedgerExtractor().extract(document);

    expect(preview.samples.textBlocks[0].text).toHaveLength(121);
    expect(preview.samples.textBlocks[0].text.endsWith('…')).toBe(true);
    expect(preview.samples.tables[0].caption).toHaveLength(121);
  });

  test('handles an empty document', async () => {
    const document = createDocument({ schemaVersion: undefined });
    const logger = createLoggerMock();

    const preview = await new LedgerExtractor({ logger }).extract(document);

    expect(preview).toEqual({
      reportId: 'report-001',
      schemaVersion: null,
      counts: {
        chapters: 0,
        textBlocks: 0,
        images: 0,
        tables: 0,
        tableCells: 0,
        footnotes: 0,
      },
      samples: {
        chapterTitles: [],
        textBlocks: [],
        images: [],
        tables: [],
      },
    });
    // No sample image log when there are no images
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('sample image URL'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[LedgerExtractor] extraction preview completed',
    );
  });

  test('logs count summaries through the injected logger', async () => {
    const document = createDocument({
      chapters: [createChapter({ textBlocks: [{ text: 'a', pdfPageNo: 1 }] })],
      footnotes: [{ id: 'fn-1', text: 'note', pdfPageNo: 1 }],
    });
    const logger = createLoggerMock();

    await new LedgerExtractor({ logger }).extract(document);

    expect(logger.info).toHaveBeenCalledWith(
      '[LedgerExtractor] ProcessedDocument loaded: reportId=report-001',
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[LedgerExtractor] chapters=1, textBlocks=1',
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[LedgerExtractor] images=0, tables=0, tableCells=0, footnotes=1',
    );
  });

  test('does not mutate the input document', async () => {
    const document = createDocument({
      chapters: [
        createChapter({
          textBlocks: [{ text: 'a'.repeat(500), pdfPageNo: 1 }],
          children: [createChapter({ id: 'ch-child', level: 2 })],
        }),
      ],
      images: [
        { id: 'img-1', pdfPageNo: 1, path: 'https://cdn.example.com/1.png' },
      ],
    });
    const snapshot = JSON.parse(JSON.stringify(document));

    await new LedgerExtractor().extract(document);

    expect(document).toEqual(snapshot);
  });
});
