import type { LoggerMethods } from '@heripo/logger';
import type {
  DoclingTextItem,
  PageRange,
  ProcessedFootnote,
  ProcessedImage,
  ProcessedTable,
} from '@heripo/model';

import type { TocEntry } from '../types';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { IdGenerator } from '../utils';
import { ChapterConverter } from './chapter-converter';

describe('ChapterConverter', () => {
  let mockLogger: LoggerMethods;
  let idGenerator: IdGenerator;
  let converter: ChapterConverter;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as LoggerMethods;

    idGenerator = new IdGenerator();
    converter = new ChapterConverter(mockLogger, idGenerator);
  });

  describe('convert', () => {
    test('should convert flat TocEntry[] to Chapter[]', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 1 },
        { title: 'Chapter 2', level: 1, pageNo: 5 },
        { title: 'Chapter 3', level: 1, pageNo: 10 },
      ];

      const textItems: DoclingTextItem[] = [
        createTextItem('Text on page 1', 1),
        createTextItem('Text on page 3', 3),
        createTextItem('Text on page 6', 6),
        createTextItem('Text on page 11', 11),
      ];

      const pageRangeMap: Record<number, PageRange> = {
        1: { startPageNo: 1, endPageNo: 1 },
        3: { startPageNo: 3, endPageNo: 3 },
        6: { startPageNo: 6, endPageNo: 6 },
        11: { startPageNo: 11, endPageNo: 11 },
      };

      const images: ProcessedImage[] = [];
      const tables: ProcessedTable[] = [];

      const chapters = converter.convert(
        tocEntries,
        textItems,
        pageRangeMap,
        images,
        tables,
        [],
      );

      // Front Matter + 3 TOC chapters
      expect(chapters).toHaveLength(4);
      expect(chapters[0].title).toBe('Front Matter');
      expect(chapters[1].title).toBe('Chapter 1');
      expect(chapters[2].title).toBe('Chapter 2');
      expect(chapters[3].title).toBe('Chapter 3');

      // Check text block assignment
      // Front Matter: no pages (TOC starts at page 1)
      expect(chapters[0].textBlocks).toHaveLength(0);
      expect(chapters[1].textBlocks).toHaveLength(2); // Pages 1, 3 (before page 5)
      expect(chapters[2].textBlocks).toHaveLength(1); // Page 6 (before page 10)
      expect(chapters[3].textBlocks).toHaveLength(1); // Page 11 (after page 10)
    });

    test('should handle nested TocEntry[] recursively', () => {
      const tocEntries: TocEntry[] = [
        {
          title: 'Chapter 1',
          level: 1,
          pageNo: 1,
          children: [
            { title: 'Section 1.1', level: 2, pageNo: 2 },
            { title: 'Section 1.2', level: 2, pageNo: 3 },
          ],
        },
        { title: 'Chapter 2', level: 1, pageNo: 5 },
      ];

      const textItems: DoclingTextItem[] = [];
      const pageRangeMap: Record<number, PageRange> = {};
      const images: ProcessedImage[] = [];
      const tables: ProcessedTable[] = [];

      const chapters = converter.convert(
        tocEntries,
        textItems,
        pageRangeMap,
        images,
        tables,
        [],
      );

      // Front Matter + 2 TOC chapters
      expect(chapters).toHaveLength(3);
      expect(chapters[0].title).toBe('Front Matter');
      expect(chapters[1].children).toHaveLength(2);
      expect(chapters[1].children![0].title).toBe('Section 1.1');
      expect(chapters[1].children![1].title).toBe('Section 1.2');
      expect(chapters[1].children![0].level).toBe(2);
    });

    test('should assign text blocks to correct chapters based on page range', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Intro', level: 1, pageNo: 1 },
        { title: 'Body', level: 1, pageNo: 10 },
      ];

      const textItems: DoclingTextItem[] = [
        createTextItem('Page 5 text', 5),
        createTextItem('Page 10 text', 10),
        createTextItem('Page 15 text', 15),
      ];

      const pageRangeMap: Record<number, PageRange> = {
        5: { startPageNo: 5, endPageNo: 5 },
        10: { startPageNo: 10, endPageNo: 10 },
        15: { startPageNo: 15, endPageNo: 15 },
      };

      const chapters = converter.convert(
        tocEntries,
        textItems,
        pageRangeMap,
        [],
        [],
        [],
      );

      // chapters[0] = Front Matter, chapters[1] = Intro, chapters[2] = Body
      expect(chapters[0].textBlocks).toHaveLength(0); // Front Matter (before page 1)
      expect(chapters[1].textBlocks).toHaveLength(1); // Page 5 (1-9)
      expect(chapters[1].textBlocks[0].text).toBe('Page 5 text');
      expect(chapters[2].textBlocks).toHaveLength(2); // Pages 10, 15 (10+)
    });

    test('should link images to chapters by page range', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 1 },
        { title: 'Chapter 2', level: 1, pageNo: 10 },
      ];

      const images: ProcessedImage[] = [
        { id: 'img-001', pdfPageNo: 3, path: '/images/img1.png' },
        { id: 'img-002', pdfPageNo: 12, path: '/images/img2.png' },
        { id: 'img-003', pdfPageNo: 8, path: '/images/img3.png' },
      ];

      const pageRangeMap: Record<number, PageRange> = {
        3: { startPageNo: 3, endPageNo: 3 },
        8: { startPageNo: 8, endPageNo: 8 },
        12: { startPageNo: 12, endPageNo: 12 },
      };

      const chapters = converter.convert(
        tocEntries,
        [],
        pageRangeMap,
        images,
        [],
        [],
      );

      // chapters[0] = Front Matter, chapters[1] = Chapter 1, chapters[2] = Chapter 2
      expect(chapters[1].imageIds).toContain('img-001');
      expect(chapters[1].imageIds).toContain('img-003');
      expect(chapters[2].imageIds).toContain('img-002');
    });

    test('should link tables to chapters by page range', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 1 },
        { title: 'Chapter 2', level: 1, pageNo: 10 },
      ];

      const tables: ProcessedTable[] = [
        createTable('tbl-001', 5),
        createTable('tbl-002', 15),
      ];

      const pageRangeMap: Record<number, PageRange> = {
        5: { startPageNo: 5, endPageNo: 5 },
        15: { startPageNo: 15, endPageNo: 15 },
      };

      const chapters = converter.convert(
        tocEntries,
        [],
        pageRangeMap,
        [],
        tables,
        [],
      );

      // chapters[0] = Front Matter, chapters[1] = Chapter 1, chapters[2] = Chapter 2
      expect(chapters[1].tableIds).toContain('tbl-001');
      expect(chapters[2].tableIds).toContain('tbl-002');
    });

    test('should handle empty TocEntry[]', () => {
      const chapters = converter.convert([], [], {}, [], [], []);

      // Front Matter is always created
      expect(chapters).toHaveLength(1);
      expect(chapters[0].id).toBe('ch-000');
      expect(chapters[0].title).toBe('Front Matter');
    });

    test('should handle empty textItems', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 1 },
      ];

      const chapters = converter.convert(tocEntries, [], {}, [], [], []);

      // Front Matter + 1 TOC chapter
      expect(chapters).toHaveLength(2);
      expect(chapters[0].textBlocks).toHaveLength(0); // Front Matter
      expect(chapters[1].textBlocks).toHaveLength(0); // Chapter 1
    });

    test('should filter invalid text items', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 1 },
      ];

      const textItems: DoclingTextItem[] = [
        createTextItem('Valid text', 1),
        createTextItem('123', 1), // Invalid: numbers only
        createTextItem('', 1), // Invalid: empty
        createTextItem('   ', 1), // Invalid: whitespace only
        createTextItem('Another valid text', 1),
      ];

      const pageRangeMap: Record<number, PageRange> = {
        1: { startPageNo: 1, endPageNo: 1 },
      };

      const chapters = converter.convert(
        tocEntries,
        textItems,
        pageRangeMap,
        [],
        [],
        [],
      );

      // chapters[0] = Front Matter, chapters[1] = Chapter 1
      expect(chapters[1].textBlocks).toHaveLength(2);
      expect(chapters[1].textBlocks[0].text).toBe('Valid text');
      expect(chapters[1].textBlocks[1].text).toBe('Another valid text');
    });

    test('should filter text items by label (only text, section_header, list_item)', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 1 },
      ];

      const textItems: DoclingTextItem[] = [
        createTextItem('Regular text', 1, 'text'),
        createTextItem('Section header', 1, 'section_header'),
        createTextItem('List item', 1, 'list_item'),
        createTextItem('Caption text', 1, 'caption'), // Filtered out
        createTextItem('Footnote text', 1, 'footnote'), // Filtered out
        createTextItem('Page header', 1, 'page_header'), // Filtered out
        createTextItem('Page footer', 1, 'page_footer'), // Filtered out
        createTextItem('Title text', 1, 'title'), // Filtered out
        createTextItem('Table text', 1, 'table'), // Filtered out
      ];

      const pageRangeMap: Record<number, PageRange> = {
        1: { startPageNo: 1, endPageNo: 1 },
      };

      const chapters = converter.convert(
        tocEntries,
        textItems,
        pageRangeMap,
        [],
        [],
        [],
      );

      // chapters[0] = Front Matter, chapters[1] = Chapter 1
      expect(chapters[1].textBlocks).toHaveLength(3);
      expect(chapters[1].textBlocks[0].text).toBe('Regular text');
      expect(chapters[1].textBlocks[1].text).toBe('Section header');
      expect(chapters[1].textBlocks[2].text).toBe('List item');
    });

    test('should exclude text items with picture parent', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 1 },
      ];

      const textItems: DoclingTextItem[] = [
        createTextItem('Regular text', 1, 'text'),
        createTextItem('Text in picture', 1, 'text', '#/pictures/24'), // Filtered out
        createTextItem('Another picture text', 1, 'text', '#/pictures/0'), // Filtered out
        createTextItem('Text in table', 1, 'text', '#/tables/5'), // Not filtered (not picture)
        createTextItem('Text in body', 1, 'text', '#/body/10'), // Not filtered (not picture)
      ];

      const pageRangeMap: Record<number, PageRange> = {
        1: { startPageNo: 1, endPageNo: 1 },
      };

      const chapters = converter.convert(
        tocEntries,
        textItems,
        pageRangeMap,
        [],
        [],
        [],
      );

      // chapters[0] = Front Matter, chapters[1] = Chapter 1
      expect(chapters[1].textBlocks).toHaveLength(3);
      expect(chapters[1].textBlocks[0].text).toBe('Regular text');
      expect(chapters[1].textBlocks[1].text).toBe('Text in table');
      expect(chapters[1].textBlocks[2].text).toBe('Text in body');
    });

    test('should normalize chapter titles', () => {
      const tocEntries: TocEntry[] = [
        { title: '  Chapter  1  ', level: 1, pageNo: 1 },
        { title: 'Chapter\t2\n', level: 1, pageNo: 5 },
      ];

      const chapters = converter.convert(tocEntries, [], {}, [], [], []);

      // chapters[0] = Front Matter, chapters[1] = Chapter 1, chapters[2] = Chapter 2
      expect(chapters[1].title).toBe('Chapter 1');
      expect(chapters[1].originTitle).toBe('  Chapter  1  ');
      expect(chapters[2].title).toBe('Chapter 2');
    });

    test('should generate unique chapter IDs', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 1 },
        { title: 'Chapter 2', level: 1, pageNo: 5 },
        { title: 'Chapter 3', level: 1, pageNo: 10 },
      ];

      const chapters = converter.convert(tocEntries, [], {}, [], [], []);

      const ids = chapters.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
      // chapters[0] = Front Matter (ch-000), chapters[1-3] = TOC chapters
      expect(chapters[0].id).toBe('ch-000');
      expect(chapters[1].id).toBe('ch-001');
      expect(chapters[2].id).toBe('ch-002');
      expect(chapters[3].id).toBe('ch-003');
    });

    test('should preserve level from TocEntry', () => {
      const tocEntries: TocEntry[] = [
        {
          title: 'Level 1',
          level: 1,
          pageNo: 1,
          children: [
            {
              title: 'Level 2',
              level: 2,
              pageNo: 2,
              children: [{ title: 'Level 3', level: 3, pageNo: 3 }],
            },
          ],
        },
      ];

      const chapters = converter.convert(tocEntries, [], {}, [], [], []);

      // chapters[0] = Front Matter, chapters[1] = Level 1
      expect(chapters[1].level).toBe(1);
      expect(chapters[1].children![0].level).toBe(2);
      expect(chapters[1].children![0].children![0].level).toBe(3);
    });

    test('should assign resources to nested chapters correctly', () => {
      const tocEntries: TocEntry[] = [
        {
          title: 'Chapter 1',
          level: 1,
          pageNo: 1,
          children: [
            { title: 'Section 1.1', level: 2, pageNo: 3 },
            { title: 'Section 1.2', level: 2, pageNo: 6 },
          ],
        },
        { title: 'Chapter 2', level: 1, pageNo: 10 },
      ];

      const images: ProcessedImage[] = [
        { id: 'img-001', pdfPageNo: 2, path: '/img1.png' }, // Chapter 1 (before 1.1)
        { id: 'img-002', pdfPageNo: 4, path: '/img2.png' }, // Section 1.1
        { id: 'img-003', pdfPageNo: 7, path: '/img3.png' }, // Section 1.2
        { id: 'img-004', pdfPageNo: 12, path: '/img4.png' }, // Chapter 2
      ];

      const pageRangeMap: Record<number, PageRange> = {
        2: { startPageNo: 2, endPageNo: 2 },
        4: { startPageNo: 4, endPageNo: 4 },
        7: { startPageNo: 7, endPageNo: 7 },
        12: { startPageNo: 12, endPageNo: 12 },
      };

      const chapters = converter.convert(
        tocEntries,
        [],
        pageRangeMap,
        images,
        [],
        [],
      );

      // chapters[0] = Front Matter, chapters[1] = Chapter 1, chapters[2] = Chapter 2
      // Chapter 1 (pages 1-2) - before Section 1.1 starts
      expect(chapters[1].imageIds).toContain('img-001');
      expect(chapters[1].imageIds).not.toContain('img-002');

      // Section 1.1 (pages 3-5)
      expect(chapters[1].children![0].imageIds).toContain('img-002');

      // Section 1.2 (pages 6-9)
      expect(chapters[1].children![1].imageIds).toContain('img-003');

      // Chapter 2 (pages 10+)
      expect(chapters[2].imageIds).toContain('img-004');
    });

    test('should handle pageRangeMap fallback when mapping is missing', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 1 },
        { title: 'Chapter 2', level: 1, pageNo: 10 },
      ];

      const textItems: DoclingTextItem[] = [
        createTextItem('Page 5 text', 5),
        createTextItem('Page 15 text', 15),
      ];

      // Empty pageRangeMap - should use pdfPageNo as actualPageNo
      const pageRangeMap: Record<number, PageRange> = {};

      const chapters = converter.convert(
        tocEntries,
        textItems,
        pageRangeMap,
        [],
        [],
        [],
      );

      // chapters[0] = Front Matter, chapters[1] = Chapter 1, chapters[2] = Chapter 2
      expect(chapters[1].textBlocks).toHaveLength(1); // Page 5
      expect(chapters[2].textBlocks).toHaveLength(1); // Page 15
    });

    test('should handle double-sided scan pageRangeMap', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 1 },
        { title: 'Chapter 2', level: 1, pageNo: 5 },
      ];

      const textItems: DoclingTextItem[] = [
        createTextItem('PDF page 1 text', 1), // Actual pages 1-2
        createTextItem('PDF page 2 text', 2), // Actual pages 3-4
        createTextItem('PDF page 3 text', 3), // Actual pages 5-6
      ];

      // Double-sided scan: each PDF page contains 2 actual pages
      const pageRangeMap: Record<number, PageRange> = {
        1: { startPageNo: 1, endPageNo: 2 },
        2: { startPageNo: 3, endPageNo: 4 },
        3: { startPageNo: 5, endPageNo: 6 },
      };

      const chapters = converter.convert(
        tocEntries,
        textItems,
        pageRangeMap,
        [],
        [],
        [],
      );

      // chapters[0] = Front Matter, chapters[1] = Chapter 1, chapters[2] = Chapter 2
      // PDF pages 1, 2 -> actual pages 1-4 -> Chapter 1 (pages 1-4)
      expect(chapters[1].textBlocks).toHaveLength(2);
      // PDF page 3 -> actual pages 5-6 -> Chapter 2 (pages 5+)
      expect(chapters[2].textBlocks).toHaveLength(1);
    });

    test('should assign pre-TOC content to Front Matter', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 10 },
        { title: 'Chapter 2', level: 1, pageNo: 20 },
      ];

      // Text before first TOC chapter starts (page 5)
      const textItems: DoclingTextItem[] = [createTextItem('Early text', 5)];

      const pageRangeMap: Record<number, PageRange> = {
        5: { startPageNo: 5, endPageNo: 5 },
      };

      const chapters = converter.convert(
        tocEntries,
        textItems,
        pageRangeMap,
        [],
        [],
        [],
      );

      // chapters[0] = Front Matter, chapters[1] = Chapter 1, chapters[2] = Chapter 2
      // Page 5 is before Chapter 1 (page 10), so it goes to Front Matter
      expect(chapters[0].textBlocks).toHaveLength(1);
      expect(chapters[0].textBlocks[0].text).toBe('Early text');
      expect(chapters[1].textBlocks).toHaveLength(0);
      expect(chapters[2].textBlocks).toHaveLength(0);
    });

    test('should handle text items without prov', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 1 },
      ];

      const textItems: DoclingTextItem[] = [
        {
          self_ref: '#/texts/0',
          children: [],
          content_layer: 'body',
          label: 'text',
          prov: [], // Empty prov
          orig: 'Text without prov',
          text: 'Text without prov',
        },
      ];

      const pageRangeMap: Record<number, PageRange> = {
        1: { startPageNo: 1, endPageNo: 1 },
      };

      const chapters = converter.convert(
        tocEntries,
        textItems,
        pageRangeMap,
        [],
        [],
        [],
      );

      // chapters[0] = Front Matter, chapters[1] = Chapter 1
      // Should default to page 1 when prov is missing -> goes to Chapter 1
      expect(chapters[1].textBlocks).toHaveLength(1);
      expect(chapters[1].textBlocks[0].pdfPageNo).toBe(1);
    });
  });

  describe('page range calculation edge cases', () => {
    test('should return empty ranges when flatChapters is empty', () => {
      // Access private method to test defensive code path
      const calculatePageRanges = (
        converter as unknown as {
          calculatePageRanges: (
            flatChapters: unknown[],
            tocEntries: TocEntry[],
          ) => Map<string, unknown>;
        }
      ).calculatePageRanges.bind(converter);

      const result = calculatePageRanges([], []);

      expect(result.size).toBe(0);
    });

    test('should handle single chapter with MAX_SAFE_INTEGER end', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Only Chapter', level: 1, pageNo: 1 },
      ];

      const textItems: DoclingTextItem[] = [
        createTextItem('Page 1000 text', 1000),
      ];

      const pageRangeMap: Record<number, PageRange> = {
        1000: { startPageNo: 1000, endPageNo: 1000 },
      };

      const chapters = converter.convert(
        tocEntries,
        textItems,
        pageRangeMap,
        [],
        [],
        [],
      );

      // chapters[0] = Front Matter, chapters[1] = Only Chapter
      // Single TOC chapter should capture all pages after page 1
      expect(chapters[1].textBlocks).toHaveLength(1);
    });

    test('should handle chapters with same page number', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter A', level: 1, pageNo: 5 },
        { title: 'Chapter B', level: 1, pageNo: 5 }, // Same page
        { title: 'Chapter C', level: 1, pageNo: 10 },
      ];

      const textItems: DoclingTextItem[] = [
        createTextItem('Page 5 text', 5),
        createTextItem('Page 7 text', 7),
      ];

      const pageRangeMap: Record<number, PageRange> = {
        5: { startPageNo: 5, endPageNo: 5 },
        7: { startPageNo: 7, endPageNo: 7 },
      };

      const chapters = converter.convert(
        tocEntries,
        textItems,
        pageRangeMap,
        [],
        [],
        [],
      );

      // chapters[0] = Front Matter, chapters[1] = A, chapters[2] = B, chapters[3] = C
      // Both texts should go to Chapter B (last chapter with startPage <= page)
      // because of "start page first" strategy
      expect(chapters).toHaveLength(4);
      // Front Matter has range 1-4
      // Chapter A has range 5-4 (invalid, so no content)
      // Chapter B has range 5-9
      // Chapter C has range 10+
    });
  });

  describe('logging', () => {
    test('should log conversion progress', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 1 },
      ];

      converter.convert(tocEntries, [], {}, [], [], []);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[ChapterConverter] Starting chapter conversion...',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[ChapterConverter] Built 1 TOC chapters + Front Matter',
      );
    });
  });

  describe('Front Matter chapter', () => {
    test('should always create ch-000 as first chapter', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 10 },
      ];

      const chapters = converter.convert(tocEntries, [], {}, [], [], []);

      expect(chapters[0].id).toBe('ch-000');
      expect(chapters[0].title).toBe('Front Matter');
      expect(chapters[0].originTitle).toBe('Front Matter');
      expect(chapters[0].pageNo).toBe(1);
      expect(chapters[0].level).toBe(1);
    });

    test('should assign images before first TOC page to Front Matter', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 10 },
      ];

      const images: ProcessedImage[] = [
        { id: 'img-001', pdfPageNo: 3, path: '/cover.png' },
        { id: 'img-002', pdfPageNo: 5, path: '/preface.png' },
        { id: 'img-003', pdfPageNo: 12, path: '/content.png' },
      ];

      const pageRangeMap: Record<number, PageRange> = {
        3: { startPageNo: 3, endPageNo: 3 },
        5: { startPageNo: 5, endPageNo: 5 },
        12: { startPageNo: 12, endPageNo: 12 },
      };

      const chapters = converter.convert(
        tocEntries,
        [],
        pageRangeMap,
        images,
        [],
        [],
      );

      // Images on pages 3 and 5 should go to Front Matter
      expect(chapters[0].imageIds).toContain('img-001');
      expect(chapters[0].imageIds).toContain('img-002');
      expect(chapters[0].imageIds).not.toContain('img-003');

      // Image on page 12 should go to Chapter 1
      expect(chapters[1].imageIds).toContain('img-003');
    });

    test('should assign tables before first TOC page to Front Matter', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 10 },
      ];

      const tables: ProcessedTable[] = [
        createTable('tbl-001', 5),
        createTable('tbl-002', 15),
      ];

      const pageRangeMap: Record<number, PageRange> = {
        5: { startPageNo: 5, endPageNo: 5 },
        15: { startPageNo: 15, endPageNo: 15 },
      };

      const chapters = converter.convert(
        tocEntries,
        [],
        pageRangeMap,
        [],
        tables,
        [],
      );

      // Table on page 5 should go to Front Matter
      expect(chapters[0].tableIds).toContain('tbl-001');
      expect(chapters[0].tableIds).not.toContain('tbl-002');

      // Table on page 15 should go to Chapter 1
      expect(chapters[1].tableIds).toContain('tbl-002');
    });

    test('should have empty textBlocks when TOC starts at page 1', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 1 },
      ];

      const textItems: DoclingTextItem[] = [
        createTextItem('Page 1 text', 1),
        createTextItem('Page 2 text', 2),
      ];

      const pageRangeMap: Record<number, PageRange> = {
        1: { startPageNo: 1, endPageNo: 1 },
        2: { startPageNo: 2, endPageNo: 2 },
      };

      const chapters = converter.convert(
        tocEntries,
        textItems,
        pageRangeMap,
        [],
        [],
        [],
      );

      // Front Matter range is 1 to 0 (empty), so no text blocks
      expect(chapters[0].textBlocks).toHaveLength(0);
      // All text goes to Chapter 1
      expect(chapters[1].textBlocks).toHaveLength(2);
    });

    test('should handle empty TOC with all content going to Front Matter', () => {
      const tocEntries: TocEntry[] = [];

      const textItems: DoclingTextItem[] = [
        createTextItem('Page 1 text', 1),
        createTextItem('Page 5 text', 5),
      ];

      const images: ProcessedImage[] = [
        { id: 'img-001', pdfPageNo: 3, path: '/img.png' },
      ];

      const pageRangeMap: Record<number, PageRange> = {
        1: { startPageNo: 1, endPageNo: 1 },
        3: { startPageNo: 3, endPageNo: 3 },
        5: { startPageNo: 5, endPageNo: 5 },
      };

      const chapters = converter.convert(
        tocEntries,
        textItems,
        pageRangeMap,
        images,
        [],
        [],
      );

      // Only Front Matter exists
      expect(chapters).toHaveLength(1);
      expect(chapters[0].id).toBe('ch-000');

      // All content goes to Front Matter
      expect(chapters[0].textBlocks).toHaveLength(2);
      expect(chapters[0].imageIds).toContain('img-001');
    });
  });

  describe('footnote handling', () => {
    test('should link footnotes to chapters by page range', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 1 },
        { title: 'Chapter 2', level: 1, pageNo: 10 },
      ];

      const footnotes: ProcessedFootnote[] = [
        { id: 'ftn-001', text: 'Footnote on page 5', pdfPageNo: 5 },
        { id: 'ftn-002', text: 'Footnote on page 15', pdfPageNo: 15 },
      ];

      const pageRangeMap: Record<number, PageRange> = {
        5: { startPageNo: 5, endPageNo: 5 },
        15: { startPageNo: 15, endPageNo: 15 },
      };

      const chapters = converter.convert(
        tocEntries,
        [],
        pageRangeMap,
        [],
        [],
        footnotes,
      );

      // chapters[0] = Front Matter, chapters[1] = Chapter 1, chapters[2] = Chapter 2
      expect(chapters[1].footnoteIds).toContain('ftn-001');
      expect(chapters[2].footnoteIds).toContain('ftn-002');
    });

    test('should assign footnotes to nested chapters correctly', () => {
      const tocEntries: TocEntry[] = [
        {
          title: 'Chapter 1',
          level: 1,
          pageNo: 1,
          children: [{ title: 'Section 1.1', level: 2, pageNo: 5 }],
        },
      ];

      const footnotes: ProcessedFootnote[] = [
        { id: 'ftn-001', text: 'Early footnote', pdfPageNo: 3 },
        { id: 'ftn-002', text: 'Section footnote', pdfPageNo: 6 },
      ];

      const pageRangeMap: Record<number, PageRange> = {
        3: { startPageNo: 3, endPageNo: 3 },
        6: { startPageNo: 6, endPageNo: 6 },
      };

      const chapters = converter.convert(
        tocEntries,
        [],
        pageRangeMap,
        [],
        [],
        footnotes,
      );

      // ftn-001 goes to Chapter 1 (page 3 < 5)
      expect(chapters[1].footnoteIds).toContain('ftn-001');
      // ftn-002 goes to Section 1.1 (page 6 >= 5)
      expect(chapters[1].children![0].footnoteIds).toContain('ftn-002');
    });

    test('should assign pre-TOC footnotes to Front Matter', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 10 },
      ];

      const footnotes: ProcessedFootnote[] = [
        { id: 'ftn-001', text: 'Early footnote', pdfPageNo: 5 },
        { id: 'ftn-002', text: 'Chapter footnote', pdfPageNo: 12 },
      ];

      const pageRangeMap: Record<number, PageRange> = {
        5: { startPageNo: 5, endPageNo: 5 },
        12: { startPageNo: 12, endPageNo: 12 },
      };

      const chapters = converter.convert(
        tocEntries,
        [],
        pageRangeMap,
        [],
        [],
        footnotes,
      );

      // ftn-001 goes to Front Matter (page 5 < 10)
      expect(chapters[0].footnoteIds).toContain('ftn-001');
      expect(chapters[0].footnoteIds).not.toContain('ftn-002');
      // ftn-002 goes to Chapter 1 (page 12 >= 10)
      expect(chapters[1].footnoteIds).toContain('ftn-002');
    });

    test('should handle empty footnotes array', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 1 },
      ];

      const chapters = converter.convert(tocEntries, [], {}, [], [], []);

      expect(chapters[0].footnoteIds).toHaveLength(0);
      expect(chapters[1].footnoteIds).toHaveLength(0);
    });

    test('should handle footnotes without pageRangeMap', () => {
      const tocEntries: TocEntry[] = [
        { title: 'Chapter 1', level: 1, pageNo: 1 },
        { title: 'Chapter 2', level: 1, pageNo: 10 },
      ];

      const footnotes: ProcessedFootnote[] = [
        { id: 'ftn-001', text: 'Footnote on page 5', pdfPageNo: 5 },
      ];

      // Empty pageRangeMap - should use pdfPageNo as actualPageNo
      const pageRangeMap: Record<number, PageRange> = {};

      const chapters = converter.convert(
        tocEntries,
        [],
        pageRangeMap,
        [],
        [],
        footnotes,
      );

      // ftn-001 (page 5) should go to Chapter 1 (1-9)
      expect(chapters[1].footnoteIds).toContain('ftn-001');
    });

    test('should initialize footnoteIds array for all chapters', () => {
      const tocEntries: TocEntry[] = [
        {
          title: 'Chapter 1',
          level: 1,
          pageNo: 1,
          children: [{ title: 'Section 1.1', level: 2, pageNo: 5 }],
        },
      ];

      const chapters = converter.convert(tocEntries, [], {}, [], [], []);

      // All chapters should have footnoteIds initialized
      expect(chapters[0].footnoteIds).toBeDefined();
      expect(chapters[0].footnoteIds).toHaveLength(0);
      expect(chapters[1].footnoteIds).toBeDefined();
      expect(chapters[1].footnoteIds).toHaveLength(0);
      expect(chapters[1].children![0].footnoteIds).toBeDefined();
      expect(chapters[1].children![0].footnoteIds).toHaveLength(0);
    });
  });
});

// Helper functions
function createTextItem(
  text: string,
  pageNo: number,
  label: string = 'text',
  parentRef?: string,
): DoclingTextItem {
  const item: DoclingTextItem = {
    self_ref: `#/texts/${pageNo}`,
    children: [],
    content_layer: 'body',
    label,
    prov: [
      {
        page_no: pageNo,
        bbox: { l: 0, t: 0, r: 100, b: 100, coord_origin: 'BOTTOMLEFT' },
        charspan: [0, text.length],
      },
    ],
    orig: text,
    text,
  };
  if (parentRef) {
    item.parent = { $ref: parentRef };
  }
  return item;
}

function createTable(id: string, pdfPageNo: number): ProcessedTable {
  return {
    id,
    pdfPageNo,
    numRows: 2,
    numCols: 2,
    grid: [
      [
        { text: 'A', rowSpan: 1, colSpan: 1, isHeader: true },
        { text: 'B', rowSpan: 1, colSpan: 1, isHeader: true },
      ],
      [
        { text: 'C', rowSpan: 1, colSpan: 1, isHeader: false },
        { text: 'D', rowSpan: 1, colSpan: 1, isHeader: false },
      ],
    ],
  };
}
