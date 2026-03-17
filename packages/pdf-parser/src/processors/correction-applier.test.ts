import type { LoggerMethods } from '@heripo/logger';
import type {
  DoclingDocument,
  DoclingTableCell,
  DoclingTableItem,
  DoclingTextItem,
} from '@heripo/model';

import { describe, expect, test, vi } from 'vitest';

import {
  LABEL_TO_TYPE_CODE,
  TEXT_LABELS,
  applyCorrections,
  getPageTables,
  getPageTexts,
} from './correction-applier';

function createMockLogger(): LoggerMethods {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function createTextItem(
  text: string,
  label: string,
  pageNo: number,
): DoclingTextItem {
  return {
    self_ref: '#/texts/0',
    label,
    prov: [
      {
        page_no: pageNo,
        bbox: { l: 0, t: 0, r: 100, b: 20, coord_origin: 'BOTTOMLEFT' },
        charspan: [0, text.length],
      },
    ],
    text,
    orig: text,
    children: [],
    content_layer: 'body',
  };
}

function createTableCell(
  text: string,
  row: number,
  col: number,
): DoclingTableCell {
  return {
    bbox: { l: 0, t: 0, r: 50, b: 20, coord_origin: 'BOTTOMLEFT' },
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
  };
}

function createGridCell(text: string): DoclingTableCell {
  return {
    bbox: { l: 0, t: 0, r: 50, b: 20, coord_origin: 'BOTTOMLEFT' },
    row_span: 1,
    col_span: 1,
    start_row_offset_idx: 0,
    end_row_offset_idx: 1,
    start_col_offset_idx: 0,
    end_col_offset_idx: 1,
    text,
    column_header: false,
    row_header: false,
    row_section: false,
    fillable: false,
  };
}

function createTableItem(
  cells: DoclingTableCell[],
  pageNo: number,
  grid?: DoclingTableCell[][],
): DoclingTableItem {
  return {
    self_ref: '#/tables/0',
    label: 'table',
    prov: [
      {
        page_no: pageNo,
        bbox: { l: 0, t: 0, r: 200, b: 100, coord_origin: 'BOTTOMLEFT' },
        charspan: [0, 0],
      },
    ],
    captions: [],
    references: [],
    footnotes: [],
    data: {
      table_cells: cells,
      num_rows: 2,
      num_cols: 2,
      grid: grid ?? [],
    },
    children: [],
    content_layer: 'body',
  };
}

function createTestDoc(
  texts: DoclingTextItem[],
  tables: DoclingTableItem[] = [],
): DoclingDocument {
  return {
    schema_name: 'DoclingDocument',
    version: '1.0.0',
    name: 'test',
    origin: {
      mimetype: 'application/pdf',
      binary_hash: 0,
      filename: 'test.pdf',
    },
    furniture: {
      self_ref: '#/furniture',
      name: '_root_',
      label: 'unspecified',
      children: [],
      content_layer: 'furniture',
    },
    body: {
      self_ref: '#/body',
      name: '_root_',
      label: 'unspecified',
      children: [],
      content_layer: 'body',
    },
    groups: [],
    texts,
    pictures: [],
    tables,
    pages: {
      '1': {
        page_no: 1,
        size: { width: 595, height: 842 },
        image: {
          mimetype: 'image/png',
          dpi: 200,
          size: { width: 2480, height: 3508 },
          uri: 'pages/page_0.png',
        },
      },
    },
  };
}

describe('LABEL_TO_TYPE_CODE', () => {
  test('maps all expected text labels', () => {
    expect(LABEL_TO_TYPE_CODE).toEqual({
      section_header: 'sh',
      text: 'tx',
      caption: 'ca',
      footnote: 'fn',
      list_item: 'li',
      page_header: 'ph',
      page_footer: 'pf',
    });
  });
});

describe('TEXT_LABELS', () => {
  test('contains all keys from LABEL_TO_TYPE_CODE', () => {
    for (const key of Object.keys(LABEL_TO_TYPE_CODE)) {
      expect(TEXT_LABELS.has(key)).toBe(true);
    }
    expect(TEXT_LABELS.size).toBe(Object.keys(LABEL_TO_TYPE_CODE).length);
  });
});

describe('getPageTexts', () => {
  test('returns text items on the specified page', () => {
    const doc = createTestDoc([
      createTextItem('text on page 1', 'text', 1),
      createTextItem('text on page 2', 'text', 2),
    ]);
    doc.pages['2'] = {
      page_no: 2,
      size: { width: 595, height: 842 },
      image: {
        mimetype: 'image/png',
        dpi: 200,
        size: { width: 2480, height: 3508 },
        uri: 'pages/page_1.png',
      },
    };

    const result = getPageTexts(doc, 1);
    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(0);
    expect(result[0].item.text).toBe('text on page 1');
  });

  test('filters out non-text labels', () => {
    const doc = createTestDoc([
      createTextItem('header', 'section_header', 1),
      createTextItem('picture caption', 'picture', 1),
      createTextItem('body text', 'text', 1),
    ]);

    const result = getPageTexts(doc, 1);
    expect(result).toHaveLength(2);
    expect(result[0].item.text).toBe('header');
    expect(result[1].item.text).toBe('body text');
  });

  test('preserves original document index', () => {
    const doc = createTestDoc([
      createTextItem('picture', 'picture', 1),
      createTextItem('text after picture', 'text', 1),
    ]);

    const result = getPageTexts(doc, 1);
    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(1);
  });

  test('returns empty array when no texts match', () => {
    const doc = createTestDoc([createTextItem('other page', 'text', 2)]);

    const result = getPageTexts(doc, 1);
    expect(result).toHaveLength(0);
  });

  test('includes all valid text labels', () => {
    const labels = [
      'section_header',
      'text',
      'caption',
      'footnote',
      'list_item',
      'page_header',
      'page_footer',
    ];
    const doc = createTestDoc(
      labels.map((label) => createTextItem(`item-${label}`, label, 1)),
    );

    const result = getPageTexts(doc, 1);
    expect(result).toHaveLength(labels.length);
  });
});

describe('getPageTables', () => {
  test('returns table items on the specified page', () => {
    const table1 = createTableItem([createTableCell('cell', 0, 0)], 1);
    const table2 = createTableItem([createTableCell('cell2', 0, 0)], 2);
    const doc = createTestDoc([], [table1, table2]);

    const result = getPageTables(doc, 1);
    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(0);
  });

  test('returns empty array when no tables match', () => {
    const table = createTableItem([createTableCell('cell', 0, 0)], 2);
    const doc = createTestDoc([], [table]);

    const result = getPageTables(doc, 1);
    expect(result).toHaveLength(0);
  });

  test('preserves original document index', () => {
    const table1 = createTableItem([createTableCell('t1', 0, 0)], 2);
    const table2 = createTableItem([createTableCell('t2', 0, 0)], 1);
    const doc = createTestDoc([], [table1, table2]);

    const result = getPageTables(doc, 1);
    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(1);
  });
});

describe('applyCorrections', () => {
  test('applies text substitution corrections', () => {
    const doc = createTestDoc([
      createTextItem('오래된 漢字 텍스트', 'text', 1),
    ]);
    const logger = createMockLogger();

    applyCorrections(
      doc,
      1,
      {
        tc: [{ i: 0, s: [{ f: '漢字', r: '한자' }] }],
        cc: [],
      },
      logger,
    );

    expect(doc.texts[0].text).toBe('오래된 한자 텍스트');
    expect(doc.texts[0].orig).toBe('오래된 한자 텍스트');
  });

  test('applies multiple substitutions in order', () => {
    const doc = createTestDoc([createTextItem('ABC DEF', 'text', 1)]);
    const logger = createMockLogger();

    applyCorrections(
      doc,
      1,
      {
        tc: [
          {
            i: 0,
            s: [
              { f: 'ABC', r: 'XYZ' },
              { f: 'DEF', r: 'QRS' },
            ],
          },
        ],
        cc: [],
      },
      logger,
    );

    expect(doc.texts[0].text).toBe('XYZ QRS');
  });

  test('logs warning when find string is not found', () => {
    const doc = createTestDoc([createTextItem('some text', 'text', 1)]);
    const logger = createMockLogger();

    applyCorrections(
      doc,
      1,
      {
        tc: [{ i: 0, s: [{ f: 'nonexistent', r: 'replacement' }] }],
        cc: [],
      },
      logger,
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('find string not found'),
    );
    expect(doc.texts[0].text).toBe('some text');
  });

  test('does not modify document when substitutions produce no change', () => {
    const doc = createTestDoc([createTextItem('same text', 'text', 1)]);
    const logger = createMockLogger();
    const originalText = doc.texts[0].text;
    const originalOrig = doc.texts[0].orig;

    applyCorrections(
      doc,
      1,
      {
        tc: [{ i: 0, s: [{ f: 'same text', r: 'same text' }] }],
        cc: [],
      },
      logger,
    );

    expect(doc.texts[0].text).toBe(originalText);
    expect(doc.texts[0].orig).toBe(originalOrig);
  });

  test('skips corrections with out-of-range text indices', () => {
    const doc = createTestDoc([createTextItem('text', 'text', 1)]);
    const logger = createMockLogger();

    applyCorrections(
      doc,
      1,
      {
        tc: [{ i: 5, s: [{ f: 'x', r: 'y' }] }],
        cc: [],
      },
      logger,
    );

    expect(doc.texts[0].text).toBe('text');
  });

  test('skips corrections with negative text indices', () => {
    const doc = createTestDoc([createTextItem('text', 'text', 1)]);
    const logger = createMockLogger();

    applyCorrections(
      doc,
      1,
      {
        tc: [{ i: -1, s: [{ f: 'x', r: 'y' }] }],
        cc: [],
      },
      logger,
    );

    expect(doc.texts[0].text).toBe('text');
  });

  test('replaces only first occurrence of find string', () => {
    const doc = createTestDoc([createTextItem('AAA BBB AAA', 'text', 1)]);
    const logger = createMockLogger();

    applyCorrections(
      doc,
      1,
      {
        tc: [{ i: 0, s: [{ f: 'AAA', r: 'CCC' }] }],
        cc: [],
      },
      logger,
    );

    expect(doc.texts[0].text).toBe('CCC BBB AAA');
  });

  test('applies cell corrections to table_cells', () => {
    const cells = [
      createTableCell('old value', 0, 0),
      createTableCell('keep', 0, 1),
    ];
    const grid = [[createGridCell('old value'), createGridCell('keep')]];
    const table = createTableItem(cells, 1, grid);
    const doc = createTestDoc([], [table]);
    const logger = createMockLogger();

    applyCorrections(
      doc,
      1,
      {
        tc: [],
        cc: [{ ti: 0, r: 0, c: 0, t: 'new value' }],
      },
      logger,
    );

    expect(doc.tables[0].data.table_cells[0].text).toBe('new value');
    expect(doc.tables[0].data.grid[0][0].text).toBe('new value');
    expect(doc.tables[0].data.table_cells[1].text).toBe('keep');
  });

  test('handles missing grid row gracefully', () => {
    const cells = [createTableCell('old', 0, 0)];
    const table = createTableItem(cells, 1, []);
    const doc = createTestDoc([], [table]);
    const logger = createMockLogger();

    applyCorrections(
      doc,
      1,
      {
        tc: [],
        cc: [{ ti: 0, r: 0, c: 0, t: 'new' }],
      },
      logger,
    );

    expect(doc.tables[0].data.table_cells[0].text).toBe('new');
  });

  test('handles missing grid cell gracefully', () => {
    const cells = [createTableCell('old', 0, 0)];
    const grid = [[createGridCell('old')]];
    const table = createTableItem(cells, 1, grid);
    const doc = createTestDoc([], [table]);
    const logger = createMockLogger();

    applyCorrections(
      doc,
      1,
      {
        tc: [],
        cc: [{ ti: 0, r: 0, c: 5, t: 'new' }],
      },
      logger,
    );

    // table_cell not matched (col mismatch), grid cell doesn't exist at col 5
    expect(doc.tables[0].data.table_cells[0].text).toBe('old');
  });

  test('skips cell corrections with out-of-range table indices', () => {
    const cells = [createTableCell('keep', 0, 0)];
    const table = createTableItem(cells, 1);
    const doc = createTestDoc([], [table]);
    const logger = createMockLogger();

    applyCorrections(
      doc,
      1,
      {
        tc: [],
        cc: [{ ti: 5, r: 0, c: 0, t: 'new' }],
      },
      logger,
    );

    expect(doc.tables[0].data.table_cells[0].text).toBe('keep');
  });

  test('skips cell corrections with negative table indices', () => {
    const cells = [createTableCell('keep', 0, 0)];
    const table = createTableItem(cells, 1);
    const doc = createTestDoc([], [table]);
    const logger = createMockLogger();

    applyCorrections(
      doc,
      1,
      {
        tc: [],
        cc: [{ ti: -1, r: 0, c: 0, t: 'new' }],
      },
      logger,
    );

    expect(doc.tables[0].data.table_cells[0].text).toBe('keep');
  });

  test('does nothing when corrections are empty', () => {
    const doc = createTestDoc([createTextItem('text', 'text', 1)]);
    const logger = createMockLogger();

    applyCorrections(doc, 1, { tc: [], cc: [] }, logger);

    expect(doc.texts[0].text).toBe('text');
  });
});
