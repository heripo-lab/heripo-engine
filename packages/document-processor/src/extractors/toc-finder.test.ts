import type { LoggerMethods } from '@heripo/logger';
import type {
  DoclingDocument,
  DoclingGroupItem,
  DoclingTableCell,
  DoclingTableItem,
  DoclingTextItem,
} from '@heripo/model';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { RefResolver } from '../utils';
import { TocNotFoundError } from './toc-extract-error';
import {
  CONTINUATION_MARKERS,
  PAGE_NUMBER_PATTERN,
  RESOURCE_INDEX_PATTERNS,
  TOC_KEYWORDS,
  TocFinder,
} from './toc-finder';

describe('TocFinder', () => {
  let mockLogger: LoggerMethods;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  // Test fixtures
  const createMockTextItem = (
    index: number,
    text: string,
    pageNo: number,
    options?: Partial<DoclingTextItem>,
  ): DoclingTextItem => ({
    self_ref: `#/texts/${index}`,
    parent: options?.parent,
    children: [],
    content_layer: 'body',
    label: 'list_item',
    prov: [
      {
        page_no: pageNo,
        bbox: { l: 0, t: 0, r: 100, b: 100, coord_origin: 'TOPLEFT' },
        charspan: [0, 10],
      },
    ],
    orig: text,
    text,
    ...options,
  });

  const createMockGroupItem = (
    index: number,
    childRefs: string[],
    name: 'list' | 'group' = 'list',
  ): DoclingGroupItem => ({
    self_ref: `#/groups/${index}`,
    parent: { $ref: '#/body' },
    children: childRefs.map((ref) => ({ $ref: ref })),
    content_layer: 'body',
    name,
    label: 'list',
  });

  const createMockTableCell = (
    text: string,
    row: number,
    col: number,
  ): DoclingTableCell => ({
    bbox: { l: 0, t: 0, r: 100, b: 100, coord_origin: 'TOPLEFT' },
    row_span: 1,
    col_span: 1,
    start_row_offset_idx: row,
    end_row_offset_idx: row + 1,
    start_col_offset_idx: col,
    end_col_offset_idx: col + 1,
    text,
    column_header: row === 0,
    row_header: false,
    row_section: false,
    fillable: false,
  });

  const createMockTableItem = (
    index: number,
    grid: DoclingTableCell[][],
    pageNo: number,
    label: 'table' | 'document_index' = 'table',
  ): DoclingTableItem => ({
    self_ref: `#/tables/${index}`,
    parent: { $ref: '#/body' },
    children: [],
    content_layer: 'body',
    label,
    prov: [
      {
        page_no: pageNo,
        bbox: { l: 0, t: 0, r: 100, b: 100, coord_origin: 'TOPLEFT' },
        charspan: [0, 0],
      },
    ],
    captions: [],
    references: [],
    footnotes: [],
    data: {
      table_cells: grid.flat(),
      num_rows: grid.length,
      num_cols: grid[0]?.length ?? 0,
      grid,
    },
  });

  const createMockDocument = (
    texts: DoclingTextItem[],
    groups: DoclingGroupItem[] = [],
    tables: DoclingTableItem[] = [],
  ): DoclingDocument => ({
    schema_name: 'DoclingDocument',
    version: '1.0',
    name: 'test-doc',
    origin: {
      mimetype: 'application/pdf',
      binary_hash: 123456,
      filename: 'test.pdf',
    },
    furniture: {
      self_ref: '#/furniture',
      children: [],
      content_layer: 'furniture',
      name: '_root_',
      label: 'unspecified',
    },
    body: {
      self_ref: '#/body',
      children: [],
      content_layer: 'body',
      name: '_root_',
      label: 'unspecified',
    },
    groups,
    texts,
    pictures: [],
    tables,
    pages: {},
  });

  describe('constants', () => {
    test('TOC_KEYWORDS contains expected Korean keywords', () => {
      expect(TOC_KEYWORDS).toContain('목차');
      expect(TOC_KEYWORDS).toContain('차례');
      expect(TOC_KEYWORDS).toContain('목 차');
    });

    test('TOC_KEYWORDS contains expected English keywords', () => {
      expect(TOC_KEYWORDS).toContain('Contents');
      expect(TOC_KEYWORDS).toContain('Table of Contents');
      expect(TOC_KEYWORDS).toContain('TABLE OF CONTENTS');
    });

    test('CONTINUATION_MARKERS contains expected patterns', () => {
      expect(CONTINUATION_MARKERS).toContain('목차(계속)');
      expect(CONTINUATION_MARKERS).toContain('(continued)');
    });

    test('PAGE_NUMBER_PATTERN matches expected patterns', () => {
      expect(PAGE_NUMBER_PATTERN.test('Chapter 1 ..... 10')).toBe(true);
      expect(PAGE_NUMBER_PATTERN.test('Section 2 .... 25')).toBe(true);
      expect(PAGE_NUMBER_PATTERN.test('Introduction … 1')).toBe(true);
      expect(PAGE_NUMBER_PATTERN.test('Conclusion 100')).toBe(true);
      expect(PAGE_NUMBER_PATTERN.test('Just text')).toBe(false);
    });
  });

  describe('find', () => {
    describe('keyword search', () => {
      test('finds TOC by Korean keyword "목차"', () => {
        const texts = [
          createMockTextItem(0, '목차', 1, {
            label: 'section_header',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, '제1장 서론 ..... 1', 1, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(2, '제2장 본론 ..... 10', 1, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const groups = [
          createMockGroupItem(0, ['#/texts/0', '#/texts/1', '#/texts/2']),
        ];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        expect(result.itemRefs).toContain('#/groups/0');
        expect(result.startPage).toBe(1);
      });

      test('finds TOC by Korean keyword "차례"', () => {
        const texts = [
          createMockTextItem(0, '차례', 2, {
            label: 'section_header',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, '1. 개요 ..... 5', 2, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const groups = [createMockGroupItem(0, ['#/texts/0', '#/texts/1'])];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        expect(result.itemRefs).toContain('#/groups/0');
        expect(result.startPage).toBe(2);
      });

      test('finds TOC by English keyword "Contents"', () => {
        const texts = [
          createMockTextItem(0, 'Contents', 1, {
            label: 'section_header',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Chapter 1 ..... 1', 1, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const groups = [createMockGroupItem(0, ['#/texts/0', '#/texts/1'])];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        expect(result.itemRefs).toContain('#/groups/0');
      });

      test('finds TOC by "Table of Contents"', () => {
        const texts = [
          createMockTextItem(0, 'Table of Contents', 1, {
            label: 'section_header',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Introduction ..... 1', 1, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const groups = [createMockGroupItem(0, ['#/texts/0', '#/texts/1'])];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        expect(result.itemRefs).toContain('#/groups/0');
      });

      test('finds TOC with keyword in spaced form "목 차"', () => {
        const texts = [
          createMockTextItem(0, '목 차', 1, {
            label: 'section_header',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, '서론 ..... 1', 1, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const groups = [createMockGroupItem(0, ['#/texts/0', '#/texts/1'])];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        expect(result.itemRefs).toContain('#/groups/0');
      });

      test('returns single text ref when no parent group', () => {
        const texts = [
          createMockTextItem(0, '목차', 1, { label: 'section_header' }),
        ];
        const doc = createMockDocument(texts);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        expect(result.itemRefs).toContain('#/texts/0');
        expect(result.startPage).toBe(1);
      });
    });

    describe('structure analysis', () => {
      test('finds TOC-like group by page number pattern', () => {
        const texts = [
          createMockTextItem(0, '제1장 서론 ..... 1', 3, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, '제2장 본론 ..... 10', 3, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(2, '제3장 결론 ..... 50', 3, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const groups = [
          createMockGroupItem(0, ['#/texts/0', '#/texts/1', '#/texts/2']),
        ];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        expect(result.itemRefs).toContain('#/groups/0');
        expect(result.startPage).toBe(3);
      });

      test('finds TOC table with document_index label', () => {
        const grid = [
          [
            createMockTableCell('Title', 0, 0),
            createMockTableCell('Page', 0, 1),
          ],
          [
            createMockTableCell('Chapter 1', 1, 0),
            createMockTableCell('1', 1, 1),
          ],
          [
            createMockTableCell('Chapter 2', 2, 0),
            createMockTableCell('10', 2, 1),
          ],
          [
            createMockTableCell('Chapter 3', 3, 0),
            createMockTableCell('20', 3, 1),
          ],
        ];
        const tables = [createMockTableItem(0, grid, 2, 'document_index')];
        const doc = createMockDocument([], [], tables);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        expect(result.itemRefs).toContain('#/tables/0');
        expect(result.startPage).toBe(2);
      });

      test('finds TOC table by numeric last column', () => {
        const grid = [
          [
            createMockTableCell('Chapter', 0, 0),
            createMockTableCell('Page', 0, 1),
          ],
          [
            createMockTableCell('Introduction', 1, 0),
            createMockTableCell('1', 1, 1),
          ],
          [
            createMockTableCell('Methods', 2, 0),
            createMockTableCell('5', 2, 1),
          ],
          [
            createMockTableCell('Results', 3, 0),
            createMockTableCell('15', 3, 1),
          ],
        ];
        const tables = [createMockTableItem(0, grid, 1)];
        const doc = createMockDocument([], [], tables);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        expect(result.itemRefs).toContain('#/tables/0');
      });

      test('prioritizes earlier pages', () => {
        const texts1 = [
          createMockTextItem(0, 'Item 1 ..... 1', 2, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Item 2 ..... 5', 2, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(2, 'Item 3 ..... 10', 2, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const texts2 = [
          createMockTextItem(3, 'Other 1 ..... 1', 5, {
            parent: { $ref: '#/groups/1' },
          }),
          createMockTextItem(4, 'Other 2 ..... 5', 5, {
            parent: { $ref: '#/groups/1' },
          }),
          createMockTextItem(5, 'Other 3 ..... 10', 5, {
            parent: { $ref: '#/groups/1' },
          }),
        ];
        const groups = [
          createMockGroupItem(0, ['#/texts/0', '#/texts/1', '#/texts/2']),
          createMockGroupItem(1, ['#/texts/3', '#/texts/4', '#/texts/5']),
        ];
        const doc = createMockDocument([...texts1, ...texts2], groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        expect(result.startPage).toBe(2);
        expect(result.itemRefs).toContain('#/groups/0');
      });
    });

    describe('multi-page TOC', () => {
      test('expands TOC to consecutive pages with continuation marker', () => {
        const texts = [
          createMockTextItem(0, '목차', 1, {
            label: 'section_header',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Chapter 1 ..... 1', 1, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(2, '목차(계속)', 2, {
            label: 'section_header',
            parent: { $ref: '#/groups/1' },
          }),
          createMockTextItem(3, 'Chapter 10 ..... 100', 2, {
            parent: { $ref: '#/groups/1' },
          }),
        ];
        const groups = [
          createMockGroupItem(0, ['#/texts/0', '#/texts/1']),
          createMockGroupItem(1, ['#/texts/2', '#/texts/3']),
        ];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        expect(result.startPage).toBe(1);
        expect(result.endPage).toBe(2);
        expect(result.itemRefs).toContain('#/groups/0');
        expect(result.itemRefs).toContain('#/groups/1');
      });

      test('expands TOC to consecutive pages with same structure', () => {
        const texts = [
          createMockTextItem(0, '목차', 1, {
            label: 'section_header',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Part 1 ..... 1', 1, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(2, 'Part 2 ..... 10', 1, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(3, 'Part 3 ..... 20', 1, {
            parent: { $ref: '#/groups/0' },
          }),
          // Page 2 continuation (no keyword, but TOC-like structure)
          createMockTextItem(4, 'Part 4 ..... 30', 2, {
            parent: { $ref: '#/groups/1' },
          }),
          createMockTextItem(5, 'Part 5 ..... 40', 2, {
            parent: { $ref: '#/groups/1' },
          }),
          createMockTextItem(6, 'Part 6 ..... 50', 2, {
            parent: { $ref: '#/groups/1' },
          }),
        ];
        const groups = [
          createMockGroupItem(0, [
            '#/texts/0',
            '#/texts/1',
            '#/texts/2',
            '#/texts/3',
          ]),
          createMockGroupItem(1, ['#/texts/4', '#/texts/5', '#/texts/6']),
        ];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        expect(result.startPage).toBe(1);
        expect(result.endPage).toBe(2);
      });
    });

    describe('options', () => {
      test('respects maxSearchPages option', () => {
        const texts = [
          createMockTextItem(0, '목차', 15, {
            label: 'section_header',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Chapter 1 ..... 20', 15, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const groups = [createMockGroupItem(0, ['#/texts/0', '#/texts/1'])];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);

        // With default maxSearchPages (10), should not find TOC
        const finder1 = new TocFinder(mockLogger, resolver);
        expect(() => finder1.find(doc)).toThrow(TocNotFoundError);

        // With higher maxSearchPages, should find TOC
        const finder2 = new TocFinder(mockLogger, resolver, {
          maxSearchPages: 20,
        });
        const result = finder2.find(doc);
        expect(result.itemRefs).toContain('#/groups/0');
      });

      test('uses additionalKeywords option', () => {
        const texts = [
          createMockTextItem(0, 'Custom TOC Title', 1, {
            label: 'section_header',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Section 1 ..... 1', 1, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const groups = [createMockGroupItem(0, ['#/texts/0', '#/texts/1'])];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);

        // Without custom keyword, should not find by keyword search
        // but may find by structure analysis
        const _finder1 = new TocFinder(mockLogger, resolver);
        // This may throw or find by structure - depends on impl

        // With custom keyword, should find
        const finder2 = new TocFinder(mockLogger, resolver, {
          additionalKeywords: ['Custom TOC Title'],
        });
        const result = finder2.find(doc);
        expect(result.itemRefs).toContain('#/groups/0');
      });
    });

    describe('error cases', () => {
      test('throws TocNotFoundError when no TOC found', () => {
        const texts = [
          createMockTextItem(0, 'Just some text', 1),
          createMockTextItem(1, 'Another text', 2),
        ];
        const doc = createMockDocument(texts);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        expect(() => finder.find(doc)).toThrow(TocNotFoundError);
      });

      test('throws TocNotFoundError for empty document', () => {
        const doc = createMockDocument([]);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        expect(() => finder.find(doc)).toThrow(TocNotFoundError);
      });

      test('ignores TOC on pages beyond maxSearchPages', () => {
        const texts = [
          createMockTextItem(0, '목차', 20, {
            label: 'section_header',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Chapter 1 ..... 25', 20, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const groups = [createMockGroupItem(0, ['#/texts/0', '#/texts/1'])];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        expect(() => finder.find(doc)).toThrow(TocNotFoundError);
      });
    });

    describe('multi-page TOC with tables', () => {
      test('expands TOC to consecutive pages with TOC-like table on next page', () => {
        const texts = [
          createMockTextItem(0, '목차', 1, {
            label: 'section_header',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Chapter 1 ..... 1', 1, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const groups = [createMockGroupItem(0, ['#/texts/0', '#/texts/1'])];
        // TOC-like table on page 2
        const grid = [
          [
            createMockTableCell('Chapter', 0, 0),
            createMockTableCell('Page', 0, 1),
          ],
          [
            createMockTableCell('Chapter 5', 1, 0),
            createMockTableCell('50', 1, 1),
          ],
          [
            createMockTableCell('Chapter 6', 2, 0),
            createMockTableCell('60', 2, 1),
          ],
          [
            createMockTableCell('Chapter 7', 3, 0),
            createMockTableCell('70', 3, 1),
          ],
        ];
        const tables = [createMockTableItem(0, grid, 2)];
        const doc = createMockDocument(texts, groups, tables);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        expect(result.startPage).toBe(1);
        expect(result.endPage).toBe(2);
        expect(result.itemRefs).toContain('#/groups/0');
        expect(result.itemRefs).toContain('#/tables/0');
      });
    });

    describe('edge cases', () => {
      test('handles group with empty children returning undefined page', () => {
        const groups = [createMockGroupItem(0, [])];
        const doc = createMockDocument([], groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        expect(() => finder.find(doc)).toThrow(TocNotFoundError);
      });

      test('handles group with children that have no prov field', () => {
        const texts = [
          {
            self_ref: '#/texts/0',
            children: [],
            content_layer: 'body',
            label: 'text' as const,
            prov: [], // Empty prov array
            orig: 'text',
            text: 'text',
          },
        ];
        const groups = [createMockGroupItem(0, ['#/texts/0'])];
        const doc = createMockDocument(texts as DoclingTextItem[], groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        expect(() => finder.find(doc)).toThrow(TocNotFoundError);
      });
    });

    describe('logging', () => {
      test('logs search progress', () => {
        const texts = [
          createMockTextItem(0, '목차', 1, {
            label: 'section_header',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Chapter 1 ..... 1', 1, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const groups = [createMockGroupItem(0, ['#/texts/0', '#/texts/1'])];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        finder.find(doc);

        expect(mockLogger.info).toHaveBeenCalledWith(
          '[TocFinder] Starting TOC search...',
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('[TocFinder] Found TOC keyword'),
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('[TocFinder] Found TOC by keyword search'),
        );
      });

      test('logs warning when TOC not found', () => {
        const doc = createMockDocument([]);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        try {
          finder.find(doc);
        } catch {
          // Expected
        }

        expect(mockLogger.warn).toHaveBeenCalledWith(
          '[TocFinder] No TOC found in document',
        );
      });
    });

    describe('findTocContainer edge cases', () => {
      test('finds TOC when parent is a table', () => {
        const doc = createMockDocument([
          createMockTextItem(0, '목차', 1, {
            label: 'section_header',
            parent: { $ref: '#/tables/0' },
          }),
        ]);
        doc.tables = [
          {
            self_ref: '#/tables/0',
            parent: { $ref: '#/body' },
            children: [{ $ref: '#/texts/0' }],
            content_layer: 'body',
            label: 'document_index',
            prov: [
              {
                page_no: 1,
                bbox: { l: 0, t: 0, r: 100, b: 100, coord_origin: 'TOPLEFT' },
                charspan: [0, 0],
              },
            ],
            captions: [],
            references: [],
            footnotes: [],
            data: {
              table_cells: [],
              num_rows: 5,
              num_cols: 2,
              grid: [
                [
                  createMockTableCell('Title', 0, 0),
                  createMockTableCell('Page', 0, 1),
                ],
                [
                  createMockTableCell('Chapter 1', 1, 0),
                  createMockTableCell('1', 1, 1),
                ],
                [
                  createMockTableCell('Chapter 2', 2, 0),
                  createMockTableCell('10', 2, 1),
                ],
                [
                  createMockTableCell('Chapter 3', 3, 0),
                  createMockTableCell('20', 3, 1),
                ],
                [
                  createMockTableCell('Chapter 4', 4, 0),
                  createMockTableCell('30', 4, 1),
                ],
              ],
            },
          },
        ];

        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);
        expect(result.itemRefs).toContain('#/tables/0');
      });

      test('navigates up hierarchy when direct parent is not group or table', () => {
        const texts = [
          createMockTextItem(0, '목차', 1, {
            label: 'section_header',
            parent: { $ref: '#/body' },
          }),
          createMockTextItem(1, 'Chapter 1 ..... 1', 1, {
            label: 'list_item',
            parent: { $ref: '#/groups/1' },
          }),
          createMockTextItem(2, 'Chapter 2 ..... 10', 1, {
            label: 'list_item',
            parent: { $ref: '#/groups/1' },
          }),
          createMockTextItem(3, 'Chapter 3 ..... 20', 1, {
            label: 'list_item',
            parent: { $ref: '#/groups/1' },
          }),
        ];
        const doc = createMockDocument(texts);
        // Nested group: groups/1 -> groups/0 -> body
        doc.groups = [
          {
            self_ref: '#/groups/0',
            parent: { $ref: '#/body' },
            children: [{ $ref: '#/groups/1' }],
            content_layer: 'body',
            name: 'list',
            label: 'list',
          },
          {
            self_ref: '#/groups/1',
            parent: { $ref: '#/groups/0' },
            children: texts.slice(1).map((t) => ({ $ref: t.self_ref })),
            content_layer: 'body',
            name: 'list',
            label: 'list',
          },
        ];

        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);
        expect(result.startPage).toBe(1);
      });

      test('handles parent without further parent in hierarchy', () => {
        // This tests the case where findTocContainer returns null and falls back to structure analysis
        // Create text with TOC keyword but parent that resolves to item without parent
        const texts = [
          createMockTextItem(0, '목차', 1, {
            label: 'section_header',
            parent: { $ref: '#/body' },
          }),
          // TOC items with page number patterns
          createMockTextItem(1, 'Chapter 1 ..... 1', 1, {
            label: 'list_item',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(2, 'Chapter 2 ..... 10', 1, {
            label: 'list_item',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(3, 'Chapter 3 ..... 20', 1, {
            label: 'list_item',
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const doc = createMockDocument(texts);
        doc.groups = [
          {
            self_ref: '#/groups/0',
            parent: { $ref: '#/body' },
            children: texts.slice(1).map((t) => ({ $ref: t.self_ref })),
            content_layer: 'body',
            name: 'list',
            label: 'list',
          },
        ];

        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        // Should find TOC via structure analysis since keyword search's findTocContainer returns null
        // (because #/body is not a group/table)
        const result = finder.find(doc);
        expect(result.startPage).toBe(1);
        expect(result.itemRefs.length).toBeGreaterThan(0);
      });
    });

    describe('backward expansion', () => {
      test('expands TOC to preceding pages (backward expansion)', () => {
        // Structure analysis picks page 4 group, but page 3 also has TOC content
        const texts = [
          // Page 3: TOC-like items
          createMockTextItem(0, 'Chapter 1 ..... 1', 3, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Chapter 2 ..... 10', 3, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(2, 'Chapter 3 ..... 20', 3, {
            parent: { $ref: '#/groups/0' },
          }),
          // Page 4: TOC keyword triggers keyword search
          createMockTextItem(3, '목차', 4, {
            label: 'section_header',
            parent: { $ref: '#/groups/1' },
          }),
          createMockTextItem(4, 'Chapter 4 ..... 30', 4, {
            parent: { $ref: '#/groups/1' },
          }),
          createMockTextItem(5, 'Chapter 5 ..... 40', 4, {
            parent: { $ref: '#/groups/1' },
          }),
          createMockTextItem(6, 'Chapter 6 ..... 50', 4, {
            parent: { $ref: '#/groups/1' },
          }),
        ];
        const groups = [
          createMockGroupItem(0, ['#/texts/0', '#/texts/1', '#/texts/2']),
          createMockGroupItem(1, [
            '#/texts/3',
            '#/texts/4',
            '#/texts/5',
            '#/texts/6',
          ]),
        ];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        expect(result.startPage).toBe(3);
        expect(result.endPage).toBe(4);
        expect(result.itemRefs).toContain('#/groups/0');
        expect(result.itemRefs).toContain('#/groups/1');
        // Backward-expanded items should come first
        expect(result.itemRefs.indexOf('#/groups/0')).toBeLessThan(
          result.itemRefs.indexOf('#/groups/1'),
        );
      });

      test('expands bidirectionally for multi-page TOC', () => {
        const texts = [
          // Page 2: TOC items (backward)
          createMockTextItem(0, 'Part A ..... 1', 2, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Part B ..... 10', 2, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(2, 'Part C ..... 20', 2, {
            parent: { $ref: '#/groups/0' },
          }),
          // Page 3: TOC keyword (initial)
          createMockTextItem(3, '목차', 3, {
            label: 'section_header',
            parent: { $ref: '#/groups/1' },
          }),
          createMockTextItem(4, 'Part D ..... 30', 3, {
            parent: { $ref: '#/groups/1' },
          }),
          // Page 4: TOC items (forward)
          createMockTextItem(5, 'Part E ..... 40', 4, {
            parent: { $ref: '#/groups/2' },
          }),
          createMockTextItem(6, 'Part F ..... 50', 4, {
            parent: { $ref: '#/groups/2' },
          }),
          createMockTextItem(7, 'Part G ..... 60', 4, {
            parent: { $ref: '#/groups/2' },
          }),
        ];
        const groups = [
          createMockGroupItem(0, ['#/texts/0', '#/texts/1', '#/texts/2']),
          createMockGroupItem(1, ['#/texts/3', '#/texts/4']),
          createMockGroupItem(2, ['#/texts/5', '#/texts/6', '#/texts/7']),
        ];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        expect(result.startPage).toBe(2);
        expect(result.endPage).toBe(4);
        expect(result.itemRefs).toContain('#/groups/0');
        expect(result.itemRefs).toContain('#/groups/1');
        expect(result.itemRefs).toContain('#/groups/2');
      });

      test('stops backward expansion when no TOC content found', () => {
        const texts = [
          // Page 1: non-TOC content
          createMockTextItem(0, 'Some random text', 1),
          // Page 2: TOC keyword
          createMockTextItem(1, '목차', 2, {
            label: 'section_header',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(2, 'Chapter 1 ..... 1', 2, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const groups = [createMockGroupItem(0, ['#/texts/1', '#/texts/2'])];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        // Should not expand backward since page 1 has no TOC content
        expect(result.startPage).toBe(2);
        expect(result.endPage).toBe(2);
        expect(result.itemRefs).toHaveLength(1);
        expect(result.itemRefs).toContain('#/groups/0');
      });

      test('does not expand backward when initial page is 1', () => {
        const texts = [
          createMockTextItem(0, '목차', 1, {
            label: 'section_header',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Chapter 1 ..... 1', 1, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const groups = [createMockGroupItem(0, ['#/texts/0', '#/texts/1'])];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        expect(result.startPage).toBe(1);
        expect(result.endPage).toBe(1);
      });

      test('deduplicates refs when backward expansion returns already-known ref', () => {
        // Scenario: keyword is on page 3, group spans pages 2-3.
        // initial.itemRefs contains #/groups/1 (from keyword search on page 3).
        // Backward expansion finds page 2, where #/groups/1 has its first child.
        // Without dedup, #/groups/1 would appear twice.
        const texts = [
          // Page 2: first children of group 1 (same group as keyword page)
          createMockTextItem(0, 'Chapter 1 ..... 1', 2, {
            parent: { $ref: '#/groups/1' },
          }),
          createMockTextItem(1, 'Chapter 2 ..... 10', 2, {
            parent: { $ref: '#/groups/1' },
          }),
          createMockTextItem(2, 'Chapter 3 ..... 20', 2, {
            parent: { $ref: '#/groups/1' },
          }),
          // Page 3: keyword + more children of the same group
          createMockTextItem(3, '목차', 3, {
            label: 'section_header',
            parent: { $ref: '#/groups/1' },
          }),
          createMockTextItem(4, 'Chapter 4 ..... 30', 3, {
            parent: { $ref: '#/groups/1' },
          }),
          createMockTextItem(5, 'Chapter 5 ..... 40', 3, {
            parent: { $ref: '#/groups/1' },
          }),
          createMockTextItem(6, 'Chapter 6 ..... 50', 3, {
            parent: { $ref: '#/groups/1' },
          }),
        ];
        const groups = [
          // group 1 spans both page 2 and page 3
          createMockGroupItem(1, [
            '#/texts/0',
            '#/texts/1',
            '#/texts/2',
            '#/texts/3',
            '#/texts/4',
            '#/texts/5',
            '#/texts/6',
          ]),
        ];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        // #/groups/1 should appear exactly once despite backward expansion
        const occurrences = result.itemRefs.filter(
          (ref) => ref === '#/groups/1',
        );
        expect(occurrences).toHaveLength(1);
        expect(result.startPage).toBeLessThanOrEqual(3);
      });
    });

    describe('findContinuationOnPage edge cases', () => {
      test('skips continuation marker text with no parent', () => {
        // Page 1: TOC keyword
        // Page 2: continuation marker text WITHOUT parent (text.parent is undefined)
        // This covers the false branch at line 404 (parentRef is falsy)
        const texts = [
          createMockTextItem(0, '목차', 1, {
            label: 'section_header',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Chapter 1 ..... 1', 1, {
            parent: { $ref: '#/groups/0' },
          }),
          // Continuation marker on page 2 but NO parent
          createMockTextItem(2, '(continued)', 2, {
            label: 'section_header',
            parent: undefined,
          }),
        ];
        const groups = [createMockGroupItem(0, ['#/texts/0', '#/texts/1'])];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        // Should not expand to page 2 since the continuation marker has no parent
        expect(result.startPage).toBe(1);
        expect(result.endPage).toBe(1);
        expect(result.itemRefs).toContain('#/groups/0');
        expect(result.itemRefs).not.toContain('#/texts/2');
      });

      test('skips continuation marker text when resolveGroup returns null', () => {
        // Page 1: TOC keyword
        // Page 2: continuation marker text with parent pointing to a non-group item (e.g., table)
        // resolveGroup returns null for that parent ref
        // This covers the false branch at line 406 (group is null)
        const texts = [
          createMockTextItem(0, '목차', 1, {
            label: 'section_header',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Chapter 1 ..... 1', 1, {
            parent: { $ref: '#/groups/0' },
          }),
          // Continuation marker on page 2 with parent pointing to a text item (not a group)
          createMockTextItem(2, '(계속)', 2, {
            label: 'section_header',
            parent: { $ref: '#/texts/3' },
          }),
          // This text item is the parent - resolveGroup will return null for it
          createMockTextItem(3, 'Some non-group item', 2),
        ];
        const groups = [createMockGroupItem(0, ['#/texts/0', '#/texts/1'])];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        // Should not expand to page 2 since resolveGroup returns null for the parent
        expect(result.startPage).toBe(1);
        expect(result.endPage).toBe(1);
        expect(result.itemRefs).toContain('#/groups/0');
      });

      test('skips non-TOC-like table on continuation page', () => {
        // Page 1: TOC keyword
        // Page 2: table that is NOT TOC-like (no document_index label, only 1 column)
        // This covers the false branch at line 431 (isTableTocLike returns false)
        const texts = [
          createMockTextItem(0, '목차', 1, {
            label: 'section_header',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Chapter 1 ..... 1', 1, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const groups = [createMockGroupItem(0, ['#/texts/0', '#/texts/1'])];
        // Non-TOC-like table: only 1 column, not document_index
        const grid = [
          [createMockTableCell('Header', 0, 0)],
          [createMockTableCell('Row 1', 1, 0)],
          [createMockTableCell('Row 2', 2, 0)],
          [createMockTableCell('Row 3', 3, 0)],
        ];
        const tables = [createMockTableItem(0, grid, 2)];
        const doc = createMockDocument(texts, groups, tables);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        // Should not expand to page 2 since the table is not TOC-like
        expect(result.startPage).toBe(1);
        expect(result.endPage).toBe(1);
        expect(result.itemRefs).not.toContain('#/tables/0');
      });
    });

    describe('calculateScore edge cases', () => {
      test('does not add page number score for children without page number pattern', () => {
        // Group children have text but no page number patterns (no dots followed by numbers)
        // This covers the false branch at line 493 (PAGE_NUMBER_PATTERN.test returns false)
        const texts = [
          createMockTextItem(0, 'Introduction', 1, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Chapter One', 1, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(2, 'Appendix', 1, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        // Use a group with enough children that have page number patterns (>= 3)
        // to pass isGroupTocLike, but also include children without patterns.
        // Actually, we need at least 3 children with patterns to pass isGroupTocLike.
        // So we mix: 3 with patterns (to pass isGroupTocLike) + 3 without (to cover false branch in calculateScore)
        const textsWithPatterns = [
          createMockTextItem(3, 'Part A ..... 1', 1, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(4, 'Part B ..... 10', 1, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(5, 'Part C ..... 20', 1, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const allTexts = [...texts, ...textsWithPatterns];
        const groups = [
          createMockGroupItem(0, [
            '#/texts/0',
            '#/texts/1',
            '#/texts/2',
            '#/texts/3',
            '#/texts/4',
            '#/texts/5',
          ]),
        ];
        const doc = createMockDocument(allTexts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        // Should still find TOC via structure analysis (3 items have page number patterns)
        expect(result.itemRefs).toContain('#/groups/0');
        expect(result.startPage).toBe(1);
      });
    });

    describe('isGroupTocLike edge cases', () => {
      test('returns false for group with unsupported name', () => {
        // Create text items that look like TOC but parent group has unsupported name
        const texts = [
          createMockTextItem(0, 'Chapter 1 ..... 1', 1, {
            label: 'list_item',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Chapter 2 ..... 10', 1, {
            label: 'list_item',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(2, 'Chapter 3 ..... 20', 1, {
            label: 'list_item',
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const doc = createMockDocument(texts);
        // Create a group with name that is not 'list' or 'group'
        doc.groups = [
          {
            self_ref: '#/groups/0',
            parent: { $ref: '#/body' },
            children: texts.map((t) => ({ $ref: t.self_ref })),
            content_layer: 'body',
            name: 'chapter' as 'list', // Cast to satisfy type but test different name
            label: 'list',
          },
        ];

        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        // Should not find TOC because group has unsupported name
        expect(() => finder.find(doc)).toThrow(TocNotFoundError);
      });

      test('skips non-text children in group when counting page numbers', () => {
        // No keyword texts - forces findByStructure (Stage 2)
        const texts = [
          createMockTextItem(0, 'Chapter 1 ..... 1', 1, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Chapter 2 ..... 10', 1, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(2, 'Chapter 3 ..... 20', 1, {
            parent: { $ref: '#/groups/0' },
          }),
        ];

        // Nested group has no 'text' or 'orig' properties
        const nestedGroup: DoclingGroupItem = {
          self_ref: '#/groups/1',
          parent: { $ref: '#/groups/0' },
          children: [],
          content_layer: 'body',
          name: 'group',
          label: 'group',
        };

        const groups: DoclingGroupItem[] = [
          {
            self_ref: '#/groups/0',
            parent: { $ref: '#/body' },
            children: [
              { $ref: '#/texts/0' },
              { $ref: '#/texts/1' },
              { $ref: '#/groups/1' },
              { $ref: '#/texts/2' },
            ],
            content_layer: 'body',
            name: 'list',
            label: 'list',
          },
          nestedGroup,
        ];

        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        // findByStructure calls isGroupTocLike, exercising the non-text child branch
        const result = finder.find(doc);
        expect(result.itemRefs).toContain('#/groups/0');
      });
    });

    describe('findTocContainer recursive call', () => {
      test('recursively traverses parent hierarchy to find group', () => {
        const texts = [
          createMockTextItem(0, '목차', 1, {
            label: 'section_header',
            parent: { $ref: '#/intermediate/0' },
          }),
        ];
        const groups: DoclingGroupItem[] = [
          {
            self_ref: '#/groups/0',
            parent: { $ref: '#/body' },
            children: [],
            content_layer: 'body',
            name: 'list',
            label: 'list',
          },
        ];
        const doc = createMockDocument(texts, groups);

        // Create a mock resolver that returns custom items for specific refs
        const resolver = new RefResolver(mockLogger, doc);

        // Mock resolve to return an intermediate item that has parent pointing to group
        const originalResolve = resolver.resolve.bind(resolver);
        const originalResolveGroup = resolver.resolveGroup.bind(resolver);
        const originalResolveTable = resolver.resolveTable.bind(resolver);

        vi.spyOn(resolver, 'resolve').mockImplementation((ref: string) => {
          if (ref === '#/intermediate/0') {
            // Return an item that is not a group/table but has parent pointing to group
            return {
              self_ref: '#/intermediate/0',
              parent: { $ref: '#/groups/0' },
              children: [],
              content_layer: 'body',
              name: 'section',
              label: 'section',
            } as unknown as DoclingTextItem;
          }
          return originalResolve(ref);
        });

        vi.spyOn(resolver, 'resolveGroup').mockImplementation((ref: string) => {
          if (ref === '#/intermediate/0') {
            return null; // Not a group
          }
          if (ref === '#/groups/0') {
            return groups[0];
          }
          return originalResolveGroup(ref);
        });

        vi.spyOn(resolver, 'resolveTable').mockImplementation((ref: string) => {
          if (ref === '#/intermediate/0') {
            return null; // Not a table
          }
          return originalResolveTable(ref);
        });

        const finder = new TocFinder(mockLogger, resolver);
        const result = finder.find(doc);

        // Should find the group through recursive traversal
        expect(result.itemRefs).toContain('#/groups/0');
      });
    });

    describe('isGroupTocLike with null children', () => {
      test('skips null children when checking TOC-like structure', () => {
        const texts = [
          createMockTextItem(0, 'Chapter 1 ..... 1', 1, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Chapter 2 ..... 10', 1, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(2, 'Chapter 3 ..... 20', 1, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const groups: DoclingGroupItem[] = [
          {
            self_ref: '#/groups/0',
            parent: { $ref: '#/body' },
            // Include a reference to non-existent item
            children: [
              { $ref: '#/texts/0' },
              { $ref: '#/texts/999' }, // This will resolve to null
              { $ref: '#/texts/1' },
              { $ref: '#/texts/2' },
            ],
            content_layer: 'body',
            name: 'list',
            label: 'list',
          },
        ];
        const doc = createMockDocument(texts, groups);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        // Should find TOC despite null child - the valid children have page numbers
        const result = finder.find(doc);
        expect(result.itemRefs).toContain('#/groups/0');
      });
    });

    describe('RESOURCE_INDEX_PATTERNS', () => {
      test('matches Korean drawing index pattern [도면 N]', () => {
        expect(
          RESOURCE_INDEX_PATTERNS.some((p) => p.test('[도면 1] 유구배치도')),
        ).toBe(true);
        expect(
          RESOURCE_INDEX_PATTERNS.some((p) => p.test('[도면 23] 토층도')),
        ).toBe(true);
      });

      test('matches Korean photo index pattern [사진 N]', () => {
        expect(
          RESOURCE_INDEX_PATTERNS.some((p) => p.test('[사진 1] 전경사진')),
        ).toBe(true);
        expect(
          RESOURCE_INDEX_PATTERNS.some((p) => p.test('[사진 45] 출토유물')),
        ).toBe(true);
      });

      test('matches English resource index patterns', () => {
        expect(
          RESOURCE_INDEX_PATTERNS.some((p) => p.test('Fig. 1 Site plan')),
        ).toBe(true);
        expect(
          RESOURCE_INDEX_PATTERNS.some((p) => p.test('Photo 3 Excavation')),
        ).toBe(true);
        expect(
          RESOURCE_INDEX_PATTERNS.some((p) => p.test('Plate 2 Artifacts')),
        ).toBe(true);
        expect(
          RESOURCE_INDEX_PATTERNS.some((p) => p.test('Map 1 Location')),
        ).toBe(true);
      });

      test('does not match main TOC entries', () => {
        expect(RESOURCE_INDEX_PATTERNS.some((p) => p.test('제1장 서론'))).toBe(
          false,
        );
        expect(RESOURCE_INDEX_PATTERNS.some((p) => p.test('Chapter 1'))).toBe(
          false,
        );
        expect(
          RESOURCE_INDEX_PATTERNS.some((p) => p.test('Ⅲ. 조사내용 및 결과')),
        ).toBe(false);
      });
    });

    describe('isResourceIndexTable', () => {
      test('detects Korean drawing index table', () => {
        const grid = [
          [
            createMockTableCell('[도면 1] 유구배치도', 0, 0),
            createMockTableCell('1', 0, 1),
          ],
          [
            createMockTableCell('[도면 2] 토층도', 1, 0),
            createMockTableCell('2', 1, 1),
          ],
          [
            createMockTableCell('[도면 3] 유구실측도', 2, 0),
            createMockTableCell('3', 2, 1),
          ],
        ];
        const tables = [createMockTableItem(0, grid, 6, 'document_index')];
        const doc = createMockDocument([], [], tables);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        // Resource index table should still be found by structure but penalized
        // When it's the only table, it should still be found
        const result = finder.find(doc);
        expect(result.itemRefs).toContain('#/tables/0');
      });

      test('detects Korean photo index table', () => {
        const grid = [
          [
            createMockTableCell('[사진 1] 전경사진', 0, 0),
            createMockTableCell('1', 0, 1),
          ],
          [
            createMockTableCell('[사진 2] 출토유물', 1, 0),
            createMockTableCell('2', 1, 1),
          ],
          [
            createMockTableCell('[사진 3] 유구사진', 2, 0),
            createMockTableCell('3', 2, 1),
          ],
        ];
        const tables = [createMockTableItem(0, grid, 7, 'document_index')];
        const doc = createMockDocument([], [], tables);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);
        expect(result.itemRefs).toContain('#/tables/0');
      });

      test('returns false for main TOC table', () => {
        const grid = [
          [
            createMockTableCell('제1장 서론', 0, 0),
            createMockTableCell('1', 0, 1),
          ],
          [
            createMockTableCell('제2장 본론', 1, 0),
            createMockTableCell('10', 1, 1),
          ],
          [
            createMockTableCell('제3장 결론', 2, 0),
            createMockTableCell('50', 2, 1),
          ],
        ];
        const mainTocTable = createMockTableItem(0, grid, 5, 'document_index');

        // Resource index table for comparison
        const resourceGrid = [
          [
            createMockTableCell('[도면 1] 유구배치도', 0, 0),
            createMockTableCell('1', 0, 1),
          ],
          [
            createMockTableCell('[도면 2] 토층도', 1, 0),
            createMockTableCell('2', 1, 1),
          ],
          [
            createMockTableCell('[도면 3] 유구실측도', 2, 0),
            createMockTableCell('3', 2, 1),
          ],
        ];
        const resourceTable = createMockTableItem(
          1,
          resourceGrid,
          6,
          'document_index',
        );

        const doc = createMockDocument([], [], [mainTocTable, resourceTable]);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        // Main TOC should win over resource index
        const result = finder.find(doc);
        expect(result.itemRefs).toContain('#/tables/0');
      });

      test('returns false when resource ratio is below 50%', () => {
        const grid = [
          [
            createMockTableCell('[도면 1] 유구배치도', 0, 0),
            createMockTableCell('1', 0, 1),
          ],
          [
            createMockTableCell('제1장 서론', 1, 0),
            createMockTableCell('10', 1, 1),
          ],
          [
            createMockTableCell('제2장 본론', 2, 0),
            createMockTableCell('20', 2, 1),
          ],
          [
            createMockTableCell('제3장 결론', 3, 0),
            createMockTableCell('30', 3, 1),
          ],
        ];
        const tables = [createMockTableItem(0, grid, 5, 'document_index')];
        const doc = createMockDocument([], [], tables);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        // Only 1/4 = 25% resource entries, not a resource index
        const result = finder.find(doc);
        expect(result.itemRefs).toContain('#/tables/0');
      });

      test('returns false when no first-column cells exist', () => {
        // Table with no table_cells (only grid)
        const grid = [
          [
            createMockTableCell('Title', 0, 0),
            createMockTableCell('Page', 0, 1),
          ],
          [
            createMockTableCell('Chapter 1', 1, 0),
            createMockTableCell('1', 1, 1),
          ],
          [
            createMockTableCell('Chapter 2', 2, 0),
            createMockTableCell('10', 2, 1),
          ],
        ];
        const table = createMockTableItem(0, grid, 5, 'document_index');
        // Override table_cells to only have non-zero col cells
        table.data.table_cells = table.data.table_cells.filter(
          (c) => c.start_col_offset_idx !== 0,
        );

        const doc = createMockDocument([], [], [table]);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        // No first-column cells means isResourceIndexTable returns false
        const result = finder.find(doc);
        expect(result.itemRefs).toContain('#/tables/0');
      });
    });

    describe('findSiblingTocItem', () => {
      test('finds adjacent TOC table when keyword parent is #/body', () => {
        const tocKeyword = createMockTextItem(0, '目次', 5, {
          label: 'section_header',
          parent: { $ref: '#/body' },
        });
        const grid = [
          [
            createMockTableCell('제1장 서론', 0, 0),
            createMockTableCell('1', 0, 1),
          ],
          [
            createMockTableCell('제2장 본론', 1, 0),
            createMockTableCell('10', 1, 1),
          ],
          [
            createMockTableCell('제3장 결론', 2, 0),
            createMockTableCell('50', 2, 1),
          ],
        ];
        const mainTocTable = createMockTableItem(0, grid, 5, 'document_index');

        const doc = createMockDocument([tocKeyword], [], [mainTocTable]);
        // Set body.children to have keyword text followed by table
        doc.body.children = [{ $ref: '#/texts/0' }, { $ref: '#/tables/0' }];
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);
        expect(result.itemRefs).toContain('#/tables/0');
        expect(result.startPage).toBe(5);
      });

      test('finds adjacent TOC group when keyword parent is #/body', () => {
        const tocKeyword = createMockTextItem(0, '목차', 3, {
          label: 'section_header',
          parent: { $ref: '#/body' },
        });
        const tocEntries = [
          createMockTextItem(1, 'Chapter 1 ..... 1', 3, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(2, 'Chapter 2 ..... 10', 3, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(3, 'Chapter 3 ..... 20', 3, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const groups = [
          createMockGroupItem(0, ['#/texts/1', '#/texts/2', '#/texts/3']),
        ];

        const doc = createMockDocument([tocKeyword, ...tocEntries], groups);
        doc.body.children = [{ $ref: '#/texts/0' }, { $ref: '#/groups/0' }];
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);
        expect(result.itemRefs).toContain('#/groups/0');
        expect(result.startPage).toBe(3);
      });

      test('skips siblings on different page', () => {
        const tocKeyword = createMockTextItem(0, '목차', 5, {
          label: 'section_header',
          parent: { $ref: '#/body' },
        });
        const grid = [
          [
            createMockTableCell('Chapter 1', 0, 0),
            createMockTableCell('1', 0, 1),
          ],
          [
            createMockTableCell('Chapter 2', 1, 0),
            createMockTableCell('10', 1, 1),
          ],
          [
            createMockTableCell('Chapter 3', 2, 0),
            createMockTableCell('20', 2, 1),
          ],
        ];
        // Table is on page 6, not page 5
        const table = createMockTableItem(0, grid, 6, 'document_index');

        const doc = createMockDocument([tocKeyword], [], [table]);
        doc.body.children = [{ $ref: '#/texts/0' }, { $ref: '#/tables/0' }];

        // Add TOC-like group on page 5 for structure analysis fallback
        const tocTexts = [
          createMockTextItem(1, 'Part A ..... 1', 5, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(2, 'Part B ..... 10', 5, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(3, 'Part C ..... 20', 5, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        doc.texts.push(...tocTexts);
        doc.groups = [
          createMockGroupItem(0, ['#/texts/1', '#/texts/2', '#/texts/3']),
        ];

        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        // Should not find the table via sibling search (different page),
        // falls back to structure analysis
        const result = finder.find(doc);
        expect(result.itemRefs).toContain('#/groups/0');
      });

      test('skips sibling group on different page', () => {
        const tocKeyword = createMockTextItem(0, '목차', 5, {
          label: 'section_header',
          parent: { $ref: '#/body' },
        });
        // Group sibling is on page 6, not page 5
        const groupEntries = [
          createMockTextItem(1, 'Chapter 1 ..... 1', 6, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(2, 'Chapter 2 ..... 10', 6, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(3, 'Chapter 3 ..... 20', 6, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const groups = [
          createMockGroupItem(0, ['#/texts/1', '#/texts/2', '#/texts/3']),
        ];

        const doc = createMockDocument([tocKeyword, ...groupEntries], groups);
        doc.body.children = [{ $ref: '#/texts/0' }, { $ref: '#/groups/0' }];

        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        // Sibling group is on different page, falls to structure analysis
        const result = finder.find(doc);
        // Found via structure analysis, not sibling search
        expect(result.itemRefs).toContain('#/groups/0');
        expect(result.startPage).toBe(6);
      });

      test('returns null when no TOC sibling within range', () => {
        const tocKeyword = createMockTextItem(0, '목차', 5, {
          label: 'section_header',
          parent: { $ref: '#/body' },
        });

        const doc = createMockDocument([tocKeyword]);
        // Keyword is at index 0, but no siblings after it
        doc.body.children = [{ $ref: '#/texts/0' }];

        // Add fallback TOC-like group
        const tocTexts = [
          createMockTextItem(1, 'Part A ..... 1', 5, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(2, 'Part B ..... 10', 5, {
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(3, 'Part C ..... 20', 5, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        doc.texts.push(...tocTexts);
        doc.groups = [
          createMockGroupItem(0, ['#/texts/1', '#/texts/2', '#/texts/3']),
        ];

        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        // Should fall back to structure analysis
        const result = finder.find(doc);
        expect(result.itemRefs).toContain('#/groups/0');
      });
    });

    describe('resource index expansion filtering', () => {
      test('excludes resource index tables during expansion', () => {
        const texts = [
          createMockTextItem(0, '목차', 5, {
            label: 'section_header',
            parent: { $ref: '#/groups/0' },
          }),
          createMockTextItem(1, 'Chapter 1 ..... 1', 5, {
            parent: { $ref: '#/groups/0' },
          }),
        ];
        const groups = [createMockGroupItem(0, ['#/texts/0', '#/texts/1'])];

        // Resource index table on page 6
        const resourceGrid = [
          [
            createMockTableCell('[도면 1] 유구배치도', 0, 0),
            createMockTableCell('1', 0, 1),
          ],
          [
            createMockTableCell('[도면 2] 토층도', 1, 0),
            createMockTableCell('2', 1, 1),
          ],
          [
            createMockTableCell('[도면 3] 유구실측도', 2, 0),
            createMockTableCell('3', 2, 1),
          ],
        ];
        const resourceTable = createMockTableItem(
          0,
          resourceGrid,
          6,
          'document_index',
        );

        const doc = createMockDocument(texts, groups, [resourceTable]);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);
        // Should not expand to page 6 (resource index table excluded)
        expect(result.startPage).toBe(5);
        expect(result.endPage).toBe(5);
        expect(result.itemRefs).not.toContain('#/tables/0');
      });
    });

    describe('resource index scoring penalty', () => {
      test('penalizes resource index tables in scoring', () => {
        // Main TOC table on page 5 (fewer rows)
        const mainGrid = [
          [
            createMockTableCell('제1장 서론', 0, 0),
            createMockTableCell('1', 0, 1),
          ],
          [
            createMockTableCell('제2장 본론', 1, 0),
            createMockTableCell('10', 1, 1),
          ],
          [
            createMockTableCell('제3장 결론', 2, 0),
            createMockTableCell('50', 2, 1),
          ],
          [createMockTableCell('부록', 3, 0), createMockTableCell('80', 3, 1)],
          [
            createMockTableCell('참고문헌', 4, 0),
            createMockTableCell('90', 4, 1),
          ],
          [
            createMockTableCell('Abstract', 5, 0),
            createMockTableCell('100', 5, 1),
          ],
        ];
        const mainTocTable = createMockTableItem(
          0,
          mainGrid,
          5,
          'document_index',
        );

        // Resource index table on page 6 (more rows)
        const resourceGrid: DoclingTableCell[][] = [];
        for (let i = 0; i < 33; i++) {
          resourceGrid.push([
            createMockTableCell(`[도면 ${i + 1}] 유구도 ${i + 1}`, i, 0),
            createMockTableCell(`${i + 1}`, i, 1),
          ]);
        }
        const resourceTable = createMockTableItem(
          1,
          resourceGrid,
          6,
          'document_index',
        );

        const doc = createMockDocument([], [], [mainTocTable, resourceTable]);
        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);
        // Main TOC should win despite fewer rows
        expect(result.itemRefs).toContain('#/tables/0');
      });
    });

    describe('integration: real document structure', () => {
      test('selects main TOC over resource indices when keyword + multiple document_index tables exist', () => {
        // Simulates the real bug scenario:
        // Page 5: "目次" text + tables/0 (main TOC, 6 rows)
        // Page 6: tables/1 (drawing index, ~33 rows)
        // Page 7: tables/2 (photo index, ~37 rows)
        const tocKeyword = createMockTextItem(0, '目次', 5, {
          label: 'section_header',
          parent: { $ref: '#/body' },
        });

        // Main TOC table (page 5)
        const mainGrid = [
          [
            createMockTableCell('Ⅰ. 조사개요', 0, 0),
            createMockTableCell('1', 0, 1),
          ],
          [
            createMockTableCell('Ⅱ. 유적환경', 1, 0),
            createMockTableCell('5', 1, 1),
          ],
          [
            createMockTableCell('Ⅲ. 조사내용 및 결과', 2, 0),
            createMockTableCell('10', 2, 1),
          ],
          [
            createMockTableCell('Ⅳ. 고찰', 3, 0),
            createMockTableCell('50', 3, 1),
          ],
          [
            createMockTableCell('Ⅴ. 결론', 4, 0),
            createMockTableCell('80', 4, 1),
          ],
          [createMockTableCell('부록', 5, 0), createMockTableCell('90', 5, 1)],
        ];
        const mainTocTable = createMockTableItem(
          0,
          mainGrid,
          5,
          'document_index',
        );

        // Drawing index table (page 6, ~33 rows)
        const drawingGrid: DoclingTableCell[][] = [];
        for (let i = 0; i < 33; i++) {
          drawingGrid.push([
            createMockTableCell(`[도면 ${i + 1}] 유구도`, i, 0),
            createMockTableCell(`${i + 1}`, i, 1),
          ]);
        }
        const drawingTable = createMockTableItem(
          1,
          drawingGrid,
          6,
          'document_index',
        );

        // Photo index table (page 7, ~37 rows)
        const photoGrid: DoclingTableCell[][] = [];
        for (let i = 0; i < 37; i++) {
          photoGrid.push([
            createMockTableCell(`[사진 ${i + 1}] 유구사진`, i, 0),
            createMockTableCell(`${i + 1}`, i, 1),
          ]);
        }
        const photoTable = createMockTableItem(
          2,
          photoGrid,
          7,
          'document_index',
        );

        const doc = createMockDocument(
          [tocKeyword],
          [],
          [mainTocTable, drawingTable, photoTable],
        );
        // Set body children: keyword text followed by main TOC table
        doc.body.children = [
          { $ref: '#/texts/0' },
          { $ref: '#/tables/0' },
          { $ref: '#/tables/1' },
          { $ref: '#/tables/2' },
        ];

        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        const result = finder.find(doc);

        // Should find main TOC via keyword + sibling search
        expect(result.itemRefs).toContain('#/tables/0');
        expect(result.startPage).toBe(5);
        // Should NOT expand to include resource index tables
        expect(result.itemRefs).not.toContain('#/tables/1');
        expect(result.itemRefs).not.toContain('#/tables/2');
        expect(result.endPage).toBe(5);
      });
    });

    describe('isTableTocLike edge cases', () => {
      test('skips table without page number in prov', () => {
        const doc = createMockDocument([]);
        doc.tables = [
          {
            self_ref: '#/tables/0',
            parent: { $ref: '#/body' },
            children: [],
            content_layer: 'body',
            label: 'document_index',
            prov: [], // Empty prov - pageNo will be undefined
            captions: [],
            references: [],
            footnotes: [],
            data: {
              table_cells: [],
              num_rows: 5,
              num_cols: 2,
              grid: [
                [
                  createMockTableCell('Title', 0, 0),
                  createMockTableCell('Page', 0, 1),
                ],
                [
                  createMockTableCell('Chapter 1', 1, 0),
                  createMockTableCell('1', 1, 1),
                ],
                [
                  createMockTableCell('Chapter 2', 2, 0),
                  createMockTableCell('10', 2, 1),
                ],
                [
                  createMockTableCell('Chapter 3', 3, 0),
                  createMockTableCell('20', 3, 1),
                ],
                [
                  createMockTableCell('Chapter 4', 4, 0),
                  createMockTableCell('30', 4, 1),
                ],
              ],
            },
          },
        ];

        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        // Should throw TocNotFoundError since table is skipped
        expect(() => finder.find(doc)).toThrow(TocNotFoundError);
      });

      test('returns false for table with insufficient rows or columns', () => {
        // Create a document with only a table that has too few rows
        const doc = createMockDocument([]);
        doc.tables = [
          {
            self_ref: '#/tables/0',
            parent: { $ref: '#/body' },
            children: [],
            content_layer: 'body',
            label: 'table',
            data: {
              table_cells: [],
              num_rows: 2, // Less than 3
              num_cols: 2,
              grid: [
                [
                  createMockTableCell('Title', 0, 0),
                  createMockTableCell('Page', 0, 1),
                ],
                [
                  createMockTableCell('Chapter 1', 1, 0),
                  createMockTableCell('1', 1, 1),
                ],
              ],
            },
            prov: [
              {
                page_no: 1,
                bbox: { t: 0, l: 0, b: 0, r: 0, coord_origin: 'TOPLEFT' },
                charspan: [0, 0],
              },
            ],
            captions: [],
            references: [],
            footnotes: [],
          },
        ];

        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        expect(() => finder.find(doc)).toThrow(TocNotFoundError);
      });

      test('returns false for table with single column', () => {
        const doc = createMockDocument([]);
        doc.tables = [
          {
            self_ref: '#/tables/0',
            parent: { $ref: '#/body' },
            children: [],
            content_layer: 'body',
            label: 'table',
            data: {
              table_cells: [],
              num_rows: 5,
              num_cols: 1, // Less than 2
              grid: [
                [createMockTableCell('Title', 0, 0)],
                [createMockTableCell('Chapter 1', 1, 0)],
                [createMockTableCell('Chapter 2', 2, 0)],
                [createMockTableCell('Chapter 3', 3, 0)],
                [createMockTableCell('Chapter 4', 4, 0)],
              ],
            },
            prov: [
              {
                page_no: 1,
                bbox: { t: 0, l: 0, b: 0, r: 0, coord_origin: 'TOPLEFT' },
                charspan: [0, 0],
              },
            ],
            captions: [],
            references: [],
            footnotes: [],
          },
        ];

        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        expect(() => finder.find(doc)).toThrow(TocNotFoundError);
      });

      test('checks non-numeric last column cells in table', () => {
        // No keyword texts - forces findByStructure (Stage 2)
        const doc = createMockDocument([]);
        doc.tables = [
          {
            self_ref: '#/tables/0',
            parent: { $ref: '#/body' },
            children: [],
            content_layer: 'body',
            label: 'table',
            prov: [
              {
                page_no: 1,
                bbox: {
                  t: 0,
                  l: 0,
                  b: 0,
                  r: 0,
                  coord_origin: 'TOPLEFT' as const,
                },
                charspan: [0, 0],
              },
            ],
            captions: [],
            references: [],
            footnotes: [],
            data: {
              table_cells: [],
              num_rows: 5,
              num_cols: 2,
              grid: [
                [
                  createMockTableCell('Title', 0, 0),
                  createMockTableCell('Page', 0, 1),
                ],
                [
                  createMockTableCell('Chapter 1', 1, 0),
                  createMockTableCell('1', 1, 1),
                ],
                [
                  createMockTableCell('Chapter 2', 2, 0),
                  createMockTableCell('abc', 2, 1),
                ],
                [
                  createMockTableCell('Chapter 3', 3, 0),
                  createMockTableCell('10', 3, 1),
                ],
                [
                  createMockTableCell('Chapter 4', 4, 0),
                  createMockTableCell('20', 4, 1),
                ],
              ],
            },
          },
        ];

        const resolver = new RefResolver(mockLogger, doc);
        const finder = new TocFinder(mockLogger, resolver);

        // 3/4 numeric last cells (75% > 50%), TOC-like.
        // Row with 'abc' covers the false branch at line 323.
        const result = finder.find(doc);
        expect(result.itemRefs).toContain('#/tables/0');
      });
    });
  });
});
