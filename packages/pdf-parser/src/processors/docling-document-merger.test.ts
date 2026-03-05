import type { DoclingDocument } from '@heripo/model';

import { describe, expect, test } from 'vitest';

import { DoclingDocumentMerger } from './docling-document-merger';

function makeChunk(overrides: Partial<DoclingDocument> = {}): DoclingDocument {
  return {
    schema_name: 'DoclingDocument',
    version: '1.0',
    name: 'test',
    origin: {
      mimetype: 'application/pdf',
      binary_hash: 123,
      filename: 'test.pdf',
    },
    body: {
      self_ref: '#/body',
      children: [],
      content_layer: 'body',
      name: '_root_',
      label: 'unspecified',
    },
    furniture: {
      self_ref: '#/furniture',
      children: [],
      content_layer: 'furniture',
      name: '_root_',
      label: 'unspecified',
    },
    groups: [],
    texts: [],
    pictures: [],
    tables: [],
    pages: {},
    ...overrides,
  };
}

describe('DoclingDocumentMerger', () => {
  const merger = new DoclingDocumentMerger();

  test('throws on zero chunks', () => {
    expect(() => merger.merge([])).toThrow('Cannot merge zero chunks');
  });

  test('single chunk passthrough', () => {
    const chunk = makeChunk({
      texts: [
        {
          self_ref: '#/texts/0',
          parent: { $ref: '#/body' },
          children: [],
          content_layer: 'body',
          label: 'text',
          prov: [],
          orig: 'hello',
          text: 'hello',
        },
      ],
      body: {
        self_ref: '#/body',
        children: [{ $ref: '#/texts/0' }],
        content_layer: 'body',
        name: '_root_',
        label: 'unspecified',
      },
    });

    const result = merger.merge([chunk]);
    // Single chunk returns the same object (no clone)
    expect(result).toBe(chunk);
  });

  test('two chunks: text $ref remapping', () => {
    const chunk1 = makeChunk({
      texts: [
        {
          self_ref: '#/texts/0',
          parent: { $ref: '#/body' },
          children: [],
          content_layer: 'body',
          label: 'text',
          prov: [],
          orig: 'a',
          text: 'a',
        },
        {
          self_ref: '#/texts/1',
          parent: { $ref: '#/body' },
          children: [],
          content_layer: 'body',
          label: 'text',
          prov: [],
          orig: 'b',
          text: 'b',
        },
      ],
      body: {
        self_ref: '#/body',
        children: [{ $ref: '#/texts/0' }, { $ref: '#/texts/1' }],
        content_layer: 'body',
        name: '_root_',
        label: 'unspecified',
      },
    });

    const chunk2 = makeChunk({
      texts: [
        {
          self_ref: '#/texts/0',
          parent: { $ref: '#/body' },
          children: [],
          content_layer: 'body',
          label: 'text',
          prov: [],
          orig: 'c',
          text: 'c',
        },
      ],
      body: {
        self_ref: '#/body',
        children: [{ $ref: '#/texts/0' }],
        content_layer: 'body',
        name: '_root_',
        label: 'unspecified',
      },
    });

    const result = merger.merge([chunk1, chunk2]);

    expect(result.texts).toHaveLength(3);
    expect(result.texts[2].self_ref).toBe('#/texts/2');
    expect(result.texts[2].text).toBe('c');
    // parent #/body should NOT be remapped
    expect(result.texts[2].parent?.$ref).toBe('#/body');
    expect(result.body.children).toHaveLength(3);
    expect(result.body.children[2].$ref).toBe('#/texts/2');
  });

  test('three chunks: cumulative offset accuracy', () => {
    const chunks = [
      makeChunk({
        texts: [
          {
            self_ref: '#/texts/0',
            children: [],
            content_layer: 'body',
            label: 'text',
            prov: [],
            orig: '0',
            text: '0',
          },
          {
            self_ref: '#/texts/1',
            children: [],
            content_layer: 'body',
            label: 'text',
            prov: [],
            orig: '1',
            text: '1',
          },
        ],
        body: {
          self_ref: '#/body',
          children: [{ $ref: '#/texts/0' }, { $ref: '#/texts/1' }],
          content_layer: 'body',
          name: '_root_',
          label: 'unspecified',
        },
      }),
      makeChunk({
        texts: [
          {
            self_ref: '#/texts/0',
            children: [],
            content_layer: 'body',
            label: 'text',
            prov: [],
            orig: '2',
            text: '2',
          },
        ],
        body: {
          self_ref: '#/body',
          children: [{ $ref: '#/texts/0' }],
          content_layer: 'body',
          name: '_root_',
          label: 'unspecified',
        },
      }),
      makeChunk({
        texts: [
          {
            self_ref: '#/texts/0',
            children: [],
            content_layer: 'body',
            label: 'text',
            prov: [],
            orig: '3',
            text: '3',
          },
          {
            self_ref: '#/texts/1',
            children: [],
            content_layer: 'body',
            label: 'text',
            prov: [],
            orig: '4',
            text: '4',
          },
        ],
        body: {
          self_ref: '#/body',
          children: [{ $ref: '#/texts/0' }, { $ref: '#/texts/1' }],
          content_layer: 'body',
          name: '_root_',
          label: 'unspecified',
        },
      }),
    ];

    const result = merger.merge(chunks);

    expect(result.texts).toHaveLength(5);
    // Chunk 2 offset = 2
    expect(result.texts[2].self_ref).toBe('#/texts/2');
    // Chunk 3 offset = 3
    expect(result.texts[3].self_ref).toBe('#/texts/3');
    expect(result.texts[4].self_ref).toBe('#/texts/4');

    expect(result.body.children).toHaveLength(5);
    expect(result.body.children[3].$ref).toBe('#/texts/3');
    expect(result.body.children[4].$ref).toBe('#/texts/4');
  });

  test('parent #/body and #/furniture are NOT remapped', () => {
    const chunk1 = makeChunk({
      texts: [
        {
          self_ref: '#/texts/0',
          parent: { $ref: '#/body' },
          children: [],
          content_layer: 'body',
          label: 'text',
          prov: [],
          orig: 'a',
          text: 'a',
        },
      ],
    });
    const chunk2 = makeChunk({
      texts: [
        {
          self_ref: '#/texts/0',
          parent: { $ref: '#/body' },
          children: [],
          content_layer: 'body',
          label: 'text',
          prov: [],
          orig: 'b',
          text: 'b',
        },
        {
          self_ref: '#/texts/1',
          parent: { $ref: '#/furniture' },
          children: [],
          content_layer: 'furniture',
          label: 'page_header',
          prov: [],
          orig: 'c',
          text: 'c',
        },
      ],
    });

    const result = merger.merge([chunk1, chunk2]);

    expect(result.texts[1].parent?.$ref).toBe('#/body');
    expect(result.texts[2].parent?.$ref).toBe('#/furniture');
  });

  test('parent #/groups/N is correctly remapped', () => {
    const chunk1 = makeChunk({
      groups: [
        {
          self_ref: '#/groups/0',
          children: [{ $ref: '#/texts/0' }],
          content_layer: 'body',
          name: 'list',
          label: 'list',
        },
      ],
      texts: [
        {
          self_ref: '#/texts/0',
          parent: { $ref: '#/groups/0' },
          children: [],
          content_layer: 'body',
          label: 'list_item',
          prov: [],
          orig: 'a',
          text: 'a',
        },
      ],
    });
    const chunk2 = makeChunk({
      groups: [
        {
          self_ref: '#/groups/0',
          children: [{ $ref: '#/texts/0' }],
          content_layer: 'body',
          name: 'list',
          label: 'list',
        },
      ],
      texts: [
        {
          self_ref: '#/texts/0',
          parent: { $ref: '#/groups/0' },
          children: [],
          content_layer: 'body',
          label: 'list_item',
          prov: [],
          orig: 'b',
          text: 'b',
        },
      ],
    });

    const result = merger.merge([chunk1, chunk2]);

    // Second chunk's group remapped from #/groups/0 to #/groups/1
    expect(result.groups[1].self_ref).toBe('#/groups/1');
    expect(result.groups[1].children[0].$ref).toBe('#/texts/1');
    // Second chunk's text parent remapped
    expect(result.texts[1].parent?.$ref).toBe('#/groups/1');
  });

  test('group with parent.$ref is remapped correctly', () => {
    const chunk1 = makeChunk({
      groups: [
        {
          self_ref: '#/groups/0',
          parent: { $ref: '#/body' },
          children: [],
          content_layer: 'body',
          name: 'group',
          label: 'key_value_area',
        },
      ],
    });
    const chunk2 = makeChunk({
      groups: [
        {
          self_ref: '#/groups/0',
          parent: { $ref: '#/groups/0' },
          children: [],
          content_layer: 'body',
          name: 'group',
          label: 'key_value_area',
        },
        {
          self_ref: '#/groups/1',
          parent: { $ref: '#/body' },
          children: [{ $ref: '#/groups/0' }],
          content_layer: 'body',
          name: 'group',
          label: 'key_value_area',
        },
      ],
    });

    const result = merger.merge([chunk1, chunk2]);

    // chunk2's groups/0 parent was #/groups/0 → remapped to #/groups/1
    expect(result.groups[1].parent?.$ref).toBe('#/groups/1');
    // chunk2's groups/1 parent was #/body → stays #/body
    expect(result.groups[2].parent?.$ref).toBe('#/body');
    // chunk2's groups/1 children[0] was #/groups/0 → remapped to #/groups/1
    expect(result.groups[2].children[0].$ref).toBe('#/groups/1');
  });

  test('pictures.captions $ref remapping', () => {
    const chunk1 = makeChunk({
      texts: [
        {
          self_ref: '#/texts/0',
          children: [],
          content_layer: 'body',
          label: 'caption',
          prov: [],
          orig: 'cap1',
          text: 'cap1',
        },
      ],
      pictures: [
        {
          self_ref: '#/pictures/0',
          parent: { $ref: '#/body' },
          children: [],
          content_layer: 'body',
          label: 'picture',
          prov: [],
          captions: [{ $ref: '#/texts/0' }],
          references: [],
          footnotes: [],
          annotations: [],
        },
      ],
    });
    const chunk2 = makeChunk({
      texts: [
        {
          self_ref: '#/texts/0',
          children: [],
          content_layer: 'body',
          label: 'caption',
          prov: [],
          orig: 'cap2',
          text: 'cap2',
        },
      ],
      pictures: [
        {
          self_ref: '#/pictures/0',
          parent: { $ref: '#/body' },
          children: [],
          content_layer: 'body',
          label: 'picture',
          prov: [],
          captions: [{ $ref: '#/texts/0' }],
          references: [],
          footnotes: [],
          annotations: [],
        },
      ],
    });

    const result = merger.merge([chunk1, chunk2]);

    expect(result.pictures[1].self_ref).toBe('#/pictures/1');
    expect(result.pictures[1].captions[0].$ref).toBe('#/texts/1');
  });

  test('tables.captions and tables.footnotes $ref remapping', () => {
    const chunk1 = makeChunk({
      texts: [
        {
          self_ref: '#/texts/0',
          children: [],
          content_layer: 'body',
          label: 'caption',
          prov: [],
          orig: 'tcap',
          text: 'tcap',
        },
        {
          self_ref: '#/texts/1',
          children: [],
          content_layer: 'body',
          label: 'footnote',
          prov: [],
          orig: 'tfn',
          text: 'tfn',
        },
      ],
      tables: [
        {
          self_ref: '#/tables/0',
          parent: { $ref: '#/body' },
          children: [],
          content_layer: 'body',
          label: 'table',
          prov: [],
          captions: [{ $ref: '#/texts/0' }],
          references: [],
          footnotes: [{ $ref: '#/texts/1' }],
          data: { table_cells: [], num_rows: 0, num_cols: 0, grid: [] },
        },
      ],
    });
    const chunk2 = makeChunk({
      texts: [
        {
          self_ref: '#/texts/0',
          children: [],
          content_layer: 'body',
          label: 'caption',
          prov: [],
          orig: 'tcap2',
          text: 'tcap2',
        },
        {
          self_ref: '#/texts/1',
          children: [],
          content_layer: 'body',
          label: 'footnote',
          prov: [],
          orig: 'tfn2',
          text: 'tfn2',
        },
      ],
      tables: [
        {
          self_ref: '#/tables/0',
          parent: { $ref: '#/body' },
          children: [],
          content_layer: 'body',
          label: 'table',
          prov: [],
          captions: [{ $ref: '#/texts/0' }],
          references: [],
          footnotes: [{ $ref: '#/texts/1' }],
          data: { table_cells: [], num_rows: 0, num_cols: 0, grid: [] },
        },
      ],
    });

    const result = merger.merge([chunk1, chunk2]);

    expect(result.tables[1].self_ref).toBe('#/tables/1');
    expect(result.tables[1].captions[0].$ref).toBe('#/texts/2');
    expect(result.tables[1].footnotes[0].$ref).toBe('#/texts/3');
  });

  test('image URI remapping', () => {
    const chunk1 = makeChunk({
      pictures: [
        {
          self_ref: '#/pictures/0',
          children: [],
          content_layer: 'body',
          label: 'picture',
          prov: [
            {
              page_no: 1,
              bbox: { l: 0, t: 0, r: 100, b: 100, coord_origin: 'BOTTOMLEFT' },
              charspan: [0, 0],
            },
          ],
          captions: [],
          references: [],
          footnotes: [],
          annotations: [],
          image: { uri: 'images/pic_0.png' },
        } as any,
      ],
    });
    const chunk2 = makeChunk({
      pictures: [
        {
          self_ref: '#/pictures/0',
          children: [],
          content_layer: 'body',
          label: 'picture',
          prov: [
            {
              page_no: 2,
              bbox: { l: 0, t: 0, r: 100, b: 100, coord_origin: 'BOTTOMLEFT' },
              charspan: [0, 0],
            },
          ],
          captions: [],
          references: [],
          footnotes: [],
          annotations: [],
          image: { uri: 'images/pic_0.png' },
        } as any,
      ],
    });

    const result = merger.merge([chunk1, chunk2]);

    const pic0 = result.pictures[0] as any;
    const pic1 = result.pictures[1] as any;
    expect(pic0.image.uri).toBe('images/pic_0.png');
    expect(pic1.image.uri).toBe('images/pic_1.png');
  });

  test('pages merge (no collision with global page numbers)', () => {
    const chunk1 = makeChunk({
      pages: {
        '1': {
          page_no: 1,
          size: { width: 595, height: 842 },
          image: {
            mimetype: 'image/png',
            dpi: 200,
            size: { width: 1190, height: 1684 },
            uri: 'pages/page_0.png',
          },
        },
        '2': {
          page_no: 2,
          size: { width: 595, height: 842 },
          image: {
            mimetype: 'image/png',
            dpi: 200,
            size: { width: 1190, height: 1684 },
            uri: 'pages/page_1.png',
          },
        },
      },
    });
    const chunk2 = makeChunk({
      pages: {
        '3': {
          page_no: 3,
          size: { width: 595, height: 842 },
          image: {
            mimetype: 'image/png',
            dpi: 200,
            size: { width: 1190, height: 1684 },
            uri: 'pages/page_2.png',
          },
        },
      },
    });

    const result = merger.merge([chunk1, chunk2]);

    expect(Object.keys(result.pages)).toEqual(['1', '2', '3']);
    expect(result.pages['3'].page_no).toBe(3);
  });

  test('empty array chunks are handled correctly', () => {
    const chunk1 = makeChunk({
      texts: [
        {
          self_ref: '#/texts/0',
          children: [],
          content_layer: 'body',
          label: 'text',
          prov: [],
          orig: 'a',
          text: 'a',
        },
      ],
    });
    const chunk2 = makeChunk(); // all arrays empty

    const result = merger.merge([chunk1, chunk2]);

    expect(result.texts).toHaveLength(1);
    expect(result.pictures).toHaveLength(0);
    expect(result.tables).toHaveLength(0);
    expect(result.groups).toHaveLength(0);
  });

  test('furniture children are merged and remapped', () => {
    const chunk1 = makeChunk({
      texts: [
        {
          self_ref: '#/texts/0',
          parent: { $ref: '#/furniture' },
          children: [],
          content_layer: 'furniture',
          label: 'page_header',
          prov: [],
          orig: 'h1',
          text: 'h1',
        },
      ],
      furniture: {
        self_ref: '#/furniture',
        children: [{ $ref: '#/texts/0' }],
        content_layer: 'furniture',
        name: '_root_',
        label: 'unspecified',
      },
    });
    const chunk2 = makeChunk({
      texts: [
        {
          self_ref: '#/texts/0',
          parent: { $ref: '#/furniture' },
          children: [],
          content_layer: 'furniture',
          label: 'page_footer',
          prov: [],
          orig: 'f1',
          text: 'f1',
        },
      ],
      furniture: {
        self_ref: '#/furniture',
        children: [{ $ref: '#/texts/0' }],
        content_layer: 'furniture',
        name: '_root_',
        label: 'unspecified',
      },
    });

    const result = merger.merge([chunk1, chunk2]);

    expect(result.furniture.children).toHaveLength(2);
    expect(result.furniture.children[1].$ref).toBe('#/texts/1');
  });

  test('remapRef passes through non-matching refs', () => {
    expect(
      merger.remapRef('#/body', {
        texts: 5,
        pictures: 0,
        tables: 0,
        groups: 0,
      }),
    ).toBe('#/body');
    expect(
      merger.remapRef('#/furniture', {
        texts: 5,
        pictures: 0,
        tables: 0,
        groups: 0,
      }),
    ).toBe('#/furniture');
    expect(
      merger.remapRef('', { texts: 5, pictures: 0, tables: 0, groups: 0 }),
    ).toBe('');
  });

  test('does not mutate original chunks', () => {
    const chunk1 = makeChunk({
      texts: [
        {
          self_ref: '#/texts/0',
          children: [],
          content_layer: 'body',
          label: 'text',
          prov: [],
          orig: 'a',
          text: 'a',
        },
      ],
      body: {
        self_ref: '#/body',
        children: [{ $ref: '#/texts/0' }],
        content_layer: 'body',
        name: '_root_',
        label: 'unspecified',
      },
    });
    const chunk2 = makeChunk({
      texts: [
        {
          self_ref: '#/texts/0',
          children: [],
          content_layer: 'body',
          label: 'text',
          prov: [],
          orig: 'b',
          text: 'b',
        },
      ],
      body: {
        self_ref: '#/body',
        children: [{ $ref: '#/texts/0' }],
        content_layer: 'body',
        name: '_root_',
        label: 'unspecified',
      },
    });

    merger.merge([chunk1, chunk2]);

    // Original chunk2 should be unchanged
    expect(chunk2.texts[0].self_ref).toBe('#/texts/0');
    expect(chunk2.body.children[0].$ref).toBe('#/texts/0');
  });

  test('picture without image field is handled gracefully', () => {
    const chunk1 = makeChunk({
      pictures: [
        {
          self_ref: '#/pictures/0',
          children: [],
          content_layer: 'body',
          label: 'picture',
          prov: [],
          captions: [],
          references: [],
          footnotes: [],
          annotations: [],
        },
      ],
    });
    const chunk2 = makeChunk({
      pictures: [
        {
          self_ref: '#/pictures/0',
          children: [],
          content_layer: 'body',
          label: 'picture',
          prov: [],
          captions: [],
          references: [],
          footnotes: [],
          annotations: [],
        },
      ],
    });

    const result = merger.merge([chunk1, chunk2]);
    expect(result.pictures).toHaveLength(2);
    expect(result.pictures[1].self_ref).toBe('#/pictures/1');
  });

  test('table without parent field is handled gracefully', () => {
    const chunk1 = makeChunk({
      tables: [
        {
          self_ref: '#/tables/0',
          children: [],
          content_layer: 'body',
          label: 'table',
          prov: [],
          captions: [],
          references: [],
          footnotes: [],
          data: { table_cells: [], num_rows: 0, num_cols: 0, grid: [] },
        },
      ],
    });
    const chunk2 = makeChunk({
      tables: [
        {
          self_ref: '#/tables/0',
          children: [],
          content_layer: 'body',
          label: 'table',
          prov: [],
          captions: [],
          references: [],
          footnotes: [],
          data: { table_cells: [], num_rows: 0, num_cols: 0, grid: [] },
        },
      ],
    });

    const result = merger.merge([chunk1, chunk2]);
    expect(result.tables).toHaveLength(2);
    expect(result.tables[1].self_ref).toBe('#/tables/1');
    expect(result.tables[1].parent).toBeUndefined();
  });

  test('table and picture children arrays are remapped', () => {
    const chunk1 = makeChunk({
      texts: [
        {
          self_ref: '#/texts/0',
          children: [],
          content_layer: 'body',
          label: 'text',
          prov: [],
          orig: 'x',
          text: 'x',
        },
      ],
      tables: [
        {
          self_ref: '#/tables/0',
          children: [{ $ref: '#/texts/0' }],
          content_layer: 'body',
          label: 'table',
          prov: [],
          captions: [],
          references: [],
          footnotes: [],
          data: { table_cells: [], num_rows: 0, num_cols: 0, grid: [] },
        },
      ],
      pictures: [
        {
          self_ref: '#/pictures/0',
          children: [{ $ref: '#/texts/0' }],
          content_layer: 'body',
          label: 'picture',
          prov: [],
          captions: [],
          references: [],
          footnotes: [],
          annotations: [],
        },
      ],
    });
    const chunk2 = makeChunk({
      texts: [
        {
          self_ref: '#/texts/0',
          children: [],
          content_layer: 'body',
          label: 'text',
          prov: [],
          orig: 'y',
          text: 'y',
        },
      ],
      tables: [
        {
          self_ref: '#/tables/0',
          children: [{ $ref: '#/texts/0' }],
          content_layer: 'body',
          label: 'table',
          prov: [],
          captions: [],
          references: [],
          footnotes: [],
          data: { table_cells: [], num_rows: 0, num_cols: 0, grid: [] },
        },
      ],
      pictures: [
        {
          self_ref: '#/pictures/0',
          children: [{ $ref: '#/texts/0' }],
          content_layer: 'body',
          label: 'picture',
          prov: [],
          captions: [],
          references: [],
          footnotes: [],
          annotations: [],
        },
      ],
    });

    const result = merger.merge([chunk1, chunk2]);

    // Table children remapped
    expect(result.tables[1].children[0].$ref).toBe('#/texts/1');
    // Picture children remapped
    expect(result.pictures[1].children[0].$ref).toBe('#/texts/1');
  });

  test('text children arrays are remapped', () => {
    const chunk1 = makeChunk({
      texts: [
        {
          self_ref: '#/texts/0',
          children: [{ $ref: '#/texts/1' }],
          content_layer: 'body',
          label: 'section_header',
          prov: [],
          orig: 'header',
          text: 'header',
        },
        {
          self_ref: '#/texts/1',
          parent: { $ref: '#/texts/0' },
          children: [],
          content_layer: 'body',
          label: 'text',
          prov: [],
          orig: 'child',
          text: 'child',
        },
      ],
    });
    const chunk2 = makeChunk({
      texts: [
        {
          self_ref: '#/texts/0',
          children: [{ $ref: '#/texts/1' }],
          content_layer: 'body',
          label: 'section_header',
          prov: [],
          orig: 'header2',
          text: 'header2',
        },
        {
          self_ref: '#/texts/1',
          parent: { $ref: '#/texts/0' },
          children: [],
          content_layer: 'body',
          label: 'text',
          prov: [],
          orig: 'child2',
          text: 'child2',
        },
      ],
    });

    const result = merger.merge([chunk1, chunk2]);

    // chunk2's texts/0 children[0] was #/texts/1 → remapped to #/texts/3
    expect(result.texts[2].children[0].$ref).toBe('#/texts/3');
    // chunk2's texts/1 parent was #/texts/0 → remapped to #/texts/2
    expect(result.texts[3].parent?.$ref).toBe('#/texts/2');
  });

  test('image URI remapping with picFileOffsets uses file-based offset', () => {
    const chunk1 = makeChunk({
      pictures: [
        {
          self_ref: '#/pictures/0',
          children: [],
          content_layer: 'body',
          label: 'picture',
          prov: [],
          captions: [],
          references: [],
          footnotes: [],
          annotations: [],
          image: { uri: 'images/pic_5.png' },
        } as any,
      ],
    });
    const chunk2 = makeChunk({
      pictures: [
        {
          self_ref: '#/pictures/0',
          children: [],
          content_layer: 'body',
          label: 'picture',
          prov: [],
          captions: [],
          references: [],
          footnotes: [],
          annotations: [],
          image: { uri: 'images/pic_3.png' },
        } as any,
      ],
    });

    // Without picFileOffsets: uses pictures count (1) as offset
    const resultDefault = merger.merge([
      structuredClone(chunk1),
      structuredClone(chunk2),
    ]);
    const pic1Default = resultDefault.pictures[1] as any;
    expect(pic1Default.image.uri).toBe('images/pic_4.png'); // 3 + 1

    // With picFileOffsets: uses file-based offset (10) for chunk 1
    const resultWithOffsets = merger.merge(
      [structuredClone(chunk1), structuredClone(chunk2)],
      [0, 10],
    );
    const pic1WithOffsets = resultWithOffsets.pictures[1] as any;
    expect(pic1WithOffsets.image.uri).toBe('images/pic_13.png'); // 3 + 10
  });

  test('picture with non-matching image URI is not remapped', () => {
    const chunk1 = makeChunk({
      pictures: [
        {
          self_ref: '#/pictures/0',
          children: [],
          content_layer: 'body',
          label: 'picture',
          prov: [],
          captions: [],
          references: [],
          footnotes: [],
          annotations: [],
          image: { uri: 'https://example.com/external.png' },
        } as any,
      ],
    });
    const chunk2 = makeChunk({
      pictures: [
        {
          self_ref: '#/pictures/0',
          children: [],
          content_layer: 'body',
          label: 'picture',
          prov: [],
          captions: [],
          references: [],
          footnotes: [],
          annotations: [],
          image: { uri: 'custom/path/image.jpg' },
        } as any,
      ],
    });

    const result = merger.merge([chunk1, chunk2]);

    // URIs that don't match "images/pic_N.png" pattern should be left unchanged
    const pic0 = result.pictures[0] as any;
    const pic1 = result.pictures[1] as any;
    expect(pic0.image.uri).toBe('https://example.com/external.png');
    expect(pic1.image.uri).toBe('custom/path/image.jpg');
  });
});
