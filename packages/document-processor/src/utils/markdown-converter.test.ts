import type { LoggerMethods } from '@heripo/logger';
import type {
  DoclingDocument,
  DoclingGroupItem,
  DoclingTableCell,
  DoclingTableItem,
  DoclingTextItem,
} from '@heripo/model';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { MarkdownConverter } from './markdown-converter';
import { RefResolver } from './ref-resolver';

describe('MarkdownConverter', () => {
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
    options?: Partial<DoclingTextItem>,
  ): DoclingTextItem => ({
    self_ref: `#/texts/${index}`,
    parent: { $ref: '#/body' },
    children: [],
    content_layer: 'body',
    label: 'list_item',
    prov: [
      {
        page_no: 1,
        bbox: { l: 0, t: 0, r: 100, b: 100, coord_origin: 'TOPLEFT' },
        charspan: [0, 10],
      },
    ],
    orig: text,
    text,
    ...options,
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
  ): DoclingTableItem => ({
    self_ref: `#/tables/${index}`,
    parent: { $ref: '#/body' },
    children: [],
    content_layer: 'body',
    label: 'table',
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
      table_cells: grid.flat(),
      num_rows: grid.length,
      num_cols: grid[0]?.length ?? 0,
      grid,
    },
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

  describe('convert', () => {
    test('returns empty string for empty refs array', () => {
      const doc = createMockDocument([]);
      const resolver = new RefResolver(mockLogger, doc);

      const result = MarkdownConverter.convert([], resolver);

      expect(result).toBe('');
    });

    test('converts single text item ref', () => {
      const texts = [createMockTextItem(0, 'Chapter 1 ..... 1')];
      const doc = createMockDocument(texts);
      const resolver = new RefResolver(mockLogger, doc);

      const result = MarkdownConverter.convert(['#/texts/0'], resolver);

      expect(result).toBe('- Chapter 1 ..... 1');
    });

    test('converts group ref to markdown list', () => {
      const texts = [
        createMockTextItem(0, 'Chapter 1 ..... 1'),
        createMockTextItem(1, 'Chapter 2 ..... 5'),
      ];
      const groups = [createMockGroupItem(0, ['#/texts/0', '#/texts/1'])];
      const doc = createMockDocument(texts, groups);
      const resolver = new RefResolver(mockLogger, doc);

      const result = MarkdownConverter.convert(['#/groups/0'], resolver);

      expect(result).toBe('- Chapter 1 ..... 1\n- Chapter 2 ..... 5');
    });

    test('converts table ref to markdown table', () => {
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
          createMockTableCell('Methodology', 2, 0),
          createMockTableCell('10', 2, 1),
        ],
      ];
      const tables = [createMockTableItem(0, grid)];
      const doc = createMockDocument([], [], tables);
      const resolver = new RefResolver(mockLogger, doc);

      const result = MarkdownConverter.convert(['#/tables/0'], resolver);

      expect(result).toBe(
        '| Chapter | Page |\n| --- | --- |\n| Introduction | 1 |\n| Methodology | 10 |',
      );
    });

    test('converts mixed refs (group and table)', () => {
      const texts = [createMockTextItem(0, 'TOC Title')];
      const groups = [createMockGroupItem(0, ['#/texts/0'])];
      const grid = [
        [
          createMockTableCell('Chapter', 0, 0),
          createMockTableCell('Page', 0, 1),
        ],
        [
          createMockTableCell('Section 1', 1, 0),
          createMockTableCell('5', 1, 1),
        ],
      ];
      const tables = [createMockTableItem(0, grid)];
      const doc = createMockDocument(texts, groups, tables);
      const resolver = new RefResolver(mockLogger, doc);

      const result = MarkdownConverter.convert(
        ['#/groups/0', '#/tables/0'],
        resolver,
      );

      expect(result).toContain('- TOC Title');
      expect(result).toContain('| Chapter | Page |');
      expect(result).toContain('| Section 1 | 5 |');
    });

    test('skips unresolved refs', () => {
      const texts = [createMockTextItem(0, 'Chapter 1')];
      const doc = createMockDocument(texts);
      const resolver = new RefResolver(mockLogger, doc);

      const result = MarkdownConverter.convert(
        ['#/texts/0', '#/texts/999', '#/groups/999'],
        resolver,
      );

      expect(result).toBe('- Chapter 1');
    });
  });

  describe('groupToMarkdown', () => {
    test('converts flat group to list', () => {
      const texts = [
        createMockTextItem(0, 'Item 1'),
        createMockTextItem(1, 'Item 2'),
        createMockTextItem(2, 'Item 3'),
      ];
      const group = createMockGroupItem(0, [
        '#/texts/0',
        '#/texts/1',
        '#/texts/2',
      ]);
      const doc = createMockDocument(texts, [group]);
      const resolver = new RefResolver(mockLogger, doc);

      const result = MarkdownConverter.groupToMarkdown(group, resolver);

      expect(result).toBe('- Item 1\n- Item 2\n- Item 3');
    });

    test('converts nested groups with indentation', () => {
      const texts = [
        createMockTextItem(0, 'Chapter 1'),
        createMockTextItem(1, 'Section 1.1'),
        createMockTextItem(2, 'Section 1.2'),
        createMockTextItem(3, 'Chapter 2'),
      ];
      const nestedGroup = createMockGroupItem(1, ['#/texts/1', '#/texts/2']);
      const parentGroup = createMockGroupItem(0, [
        '#/texts/0',
        '#/groups/1',
        '#/texts/3',
      ]);
      const doc = createMockDocument(texts, [parentGroup, nestedGroup]);
      const resolver = new RefResolver(mockLogger, doc);

      const result = MarkdownConverter.groupToMarkdown(parentGroup, resolver);

      expect(result).toBe(
        '- Chapter 1\n  - Section 1.1\n  - Section 1.2\n- Chapter 2',
      );
    });

    test('converts deeply nested groups', () => {
      const texts = [
        createMockTextItem(0, 'Level 1'),
        createMockTextItem(1, 'Level 2'),
        createMockTextItem(2, 'Level 3'),
      ];
      const innerGroup = createMockGroupItem(2, ['#/texts/2']);
      const middleGroup = createMockGroupItem(1, ['#/texts/1', '#/groups/2']);
      const outerGroup = createMockGroupItem(0, ['#/texts/0', '#/groups/1']);
      const doc = createMockDocument(texts, [
        outerGroup,
        middleGroup,
        innerGroup,
      ]);
      const resolver = new RefResolver(mockLogger, doc);

      const result = MarkdownConverter.groupToMarkdown(outerGroup, resolver);

      expect(result).toBe('- Level 1\n  - Level 2\n    - Level 3');
    });

    test('handles group with enumerated items', () => {
      const texts = [
        createMockTextItem(0, 'First item', { enumerated: true, marker: '1.' }),
        createMockTextItem(1, 'Second item', {
          enumerated: true,
          marker: '2.',
        }),
      ];
      const group = createMockGroupItem(0, ['#/texts/0', '#/texts/1']);
      const doc = createMockDocument(texts, [group]);
      const resolver = new RefResolver(mockLogger, doc);

      const result = MarkdownConverter.groupToMarkdown(group, resolver);

      expect(result).toBe('1. First item\n2. Second item');
    });

    test('handles empty group', () => {
      const group = createMockGroupItem(0, []);
      const doc = createMockDocument([], [group]);
      const resolver = new RefResolver(mockLogger, doc);

      const result = MarkdownConverter.groupToMarkdown(group, resolver);

      expect(result).toBe('');
    });

    test('skips unresolved children', () => {
      const texts = [createMockTextItem(0, 'Valid item')];
      const group = createMockGroupItem(0, ['#/texts/0', '#/texts/999']);
      const doc = createMockDocument(texts, [group]);
      const resolver = new RefResolver(mockLogger, doc);

      const result = MarkdownConverter.groupToMarkdown(group, resolver);

      expect(result).toBe('- Valid item');
    });

    test('handles group with name "group" type', () => {
      const texts = [createMockTextItem(0, 'Item')];
      const group = createMockGroupItem(0, ['#/texts/0'], 'group');
      const doc = createMockDocument(texts, [group]);
      const resolver = new RefResolver(mockLogger, doc);

      const result = MarkdownConverter.groupToMarkdown(group, resolver);

      expect(result).toBe('- Item');
    });
  });

  describe('tableToMarkdown', () => {
    test('converts simple table to markdown', () => {
      const grid = [
        [
          createMockTableCell('Header 1', 0, 0),
          createMockTableCell('Header 2', 0, 1),
        ],
        [
          createMockTableCell('Cell 1', 1, 0),
          createMockTableCell('Cell 2', 1, 1),
        ],
      ];
      const table = createMockTableItem(0, grid);

      const result = MarkdownConverter.tableToMarkdown(table);

      expect(result).toBe(
        '| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |',
      );
    });

    test('converts table with multiple rows', () => {
      const grid = [
        [createMockTableCell('Title', 0, 0), createMockTableCell('Page', 0, 1)],
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
      const table = createMockTableItem(0, grid);

      const result = MarkdownConverter.tableToMarkdown(table);

      expect(result).toContain('| Title | Page |');
      expect(result).toContain('| Chapter 1 | 1 |');
      expect(result).toContain('| Chapter 2 | 10 |');
      expect(result).toContain('| Chapter 3 | 20 |');
    });

    test('returns empty string for empty grid', () => {
      const table = createMockTableItem(0, []);

      const result = MarkdownConverter.tableToMarkdown(table);

      expect(result).toBe('');
    });

    test('escapes pipe characters in cell content', () => {
      const grid = [
        [createMockTableCell('Header', 0, 0)],
        [createMockTableCell('Cell | with | pipes', 1, 0)],
      ];
      const table = createMockTableItem(0, grid);

      const result = MarkdownConverter.tableToMarkdown(table);

      expect(result).toContain('Cell \\| with \\| pipes');
    });

    test('replaces newlines with spaces in cell content', () => {
      const grid = [
        [createMockTableCell('Header', 0, 0)],
        [createMockTableCell('Line 1\nLine 2\nLine 3', 1, 0)],
      ];
      const table = createMockTableItem(0, grid);

      const result = MarkdownConverter.tableToMarkdown(table);

      expect(result).toContain('Line 1 Line 2 Line 3');
    });

    test('handles single column table', () => {
      const grid = [
        [createMockTableCell('Header', 0, 0)],
        [createMockTableCell('Row 1', 1, 0)],
        [createMockTableCell('Row 2', 2, 0)],
      ];
      const table = createMockTableItem(0, grid);

      const result = MarkdownConverter.tableToMarkdown(table);

      expect(result).toBe('| Header |\n| --- |\n| Row 1 |\n| Row 2 |');
    });

    test('handles single row table (header only)', () => {
      const grid = [
        [
          createMockTableCell('Header 1', 0, 0),
          createMockTableCell('Header 2', 0, 1),
        ],
      ];
      const table = createMockTableItem(0, grid);

      const result = MarkdownConverter.tableToMarkdown(table);

      expect(result).toBe('| Header 1 | Header 2 |\n| --- | --- |');
    });

    test('skips empty rows', () => {
      const grid = [
        [createMockTableCell('Header', 0, 0)],
        [],
        [createMockTableCell('Data', 2, 0)],
      ];
      const table = createMockTableItem(0, grid);

      const result = MarkdownConverter.tableToMarkdown(table);

      expect(result).toBe('| Header |\n| --- |\n| Data |');
    });
  });

  describe('textToMarkdown', () => {
    test('converts basic text to list item', () => {
      const text = createMockTextItem(0, 'Simple text');

      const result = MarkdownConverter.textToMarkdown(text);

      expect(result).toBe('- Simple text');
    });

    test('applies indent based on level', () => {
      const text = createMockTextItem(0, 'Indented text');

      expect(MarkdownConverter.textToMarkdown(text, 0)).toBe('- Indented text');
      expect(MarkdownConverter.textToMarkdown(text, 1)).toBe(
        '  - Indented text',
      );
      expect(MarkdownConverter.textToMarkdown(text, 2)).toBe(
        '    - Indented text',
      );
      expect(MarkdownConverter.textToMarkdown(text, 3)).toBe(
        '      - Indented text',
      );
    });

    test('uses enumerated marker when enumerated is true', () => {
      const text = createMockTextItem(0, 'Ordered item', { enumerated: true });

      const result = MarkdownConverter.textToMarkdown(text);

      expect(result).toBe('1. Ordered item');
    });

    test('uses custom marker when provided', () => {
      const text = createMockTextItem(0, 'Custom item', {
        enumerated: true,
        marker: 'a)',
      });

      const result = MarkdownConverter.textToMarkdown(text);

      expect(result).toBe('a) Custom item');
    });

    test('uses dash for non-enumerated items', () => {
      const text = createMockTextItem(0, 'Unordered item', {
        enumerated: false,
      });

      const result = MarkdownConverter.textToMarkdown(text);

      expect(result).toBe('- Unordered item');
    });

    test('returns empty string for empty text', () => {
      const text = createMockTextItem(0, '   ');

      const result = MarkdownConverter.textToMarkdown(text);

      expect(result).toBe('');
    });

    test('trims whitespace from text', () => {
      const text = createMockTextItem(0, '  Text with spaces  ');

      const result = MarkdownConverter.textToMarkdown(text);

      expect(result).toBe('- Text with spaces');
    });
  });

  describe('group name variations', () => {
    test('convert handles group with name "group"', () => {
      const texts = [
        createMockTextItem(0, 'Item 1 ..... 1'),
        createMockTextItem(1, 'Item 2 ..... 5'),
      ];
      // Use 'group' instead of 'list'
      const groups = [
        createMockGroupItem(0, ['#/texts/0', '#/texts/1'], 'group'),
      ];
      const doc = createMockDocument(texts, groups);
      const resolver = new RefResolver(mockLogger, doc);

      const result = MarkdownConverter.convert(['#/groups/0'], resolver);

      expect(result).toContain('Item 1 ..... 1');
      expect(result).toContain('Item 2 ..... 5');
    });

    test('groupToMarkdown handles nested group with name "group"', () => {
      const texts = [
        createMockTextItem(0, 'Parent Item ..... 1'),
        createMockTextItem(1, 'Child Item ..... 3'),
      ];
      // Child group with name 'group'
      const groups = [
        createMockGroupItem(0, ['#/texts/0', '#/groups/1']),
        createMockGroupItem(1, ['#/texts/1'], 'group'), // nested group with name 'group'
      ];
      const doc = createMockDocument(texts, groups);
      const resolver = new RefResolver(mockLogger, doc);

      const result = MarkdownConverter.groupToMarkdown(groups[0], resolver, 0);

      expect(result).toContain('Parent Item ..... 1');
      expect(result).toContain('Child Item ..... 3');
    });
  });
});
