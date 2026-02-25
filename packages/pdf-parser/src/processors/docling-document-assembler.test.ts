import type { VlmPageResult } from '../types/vlm-page-result';

import { describe, expect, test } from 'vitest';

import {
  type AssemblerMetadata,
  DoclingDocumentAssembler,
} from './docling-document-assembler';

/** Helper to create standard metadata */
function createMetadata(
  pageCount: number,
  width = 1190,
  height = 1684,
): AssemblerMetadata {
  const pageDimensions = new Map<number, { width: number; height: number }>();
  for (let i = 1; i <= pageCount; i++) {
    pageDimensions.set(i, { width, height });
  }
  return {
    name: 'test-document',
    filename: 'test.pdf',
    pageDimensions,
  };
}

describe('DoclingDocumentAssembler', () => {
  const assembler = new DoclingDocumentAssembler();

  describe('assemble - basic structure', () => {
    test('returns valid DoclingDocument with correct schema fields', () => {
      const pageResults: VlmPageResult[] = [{ pageNo: 1, elements: [] }];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.schema_name).toBe('DoclingDocument');
      expect(doc.version).toBe('1.0.0');
      expect(doc.name).toBe('test-document');
      expect(doc.origin.mimetype).toBe('application/pdf');
      expect(doc.origin.filename).toBe('test.pdf');
    });

    test('creates empty arrays for document with no elements', () => {
      const pageResults: VlmPageResult[] = [{ pageNo: 1, elements: [] }];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.texts).toHaveLength(0);
      expect(doc.pictures).toHaveLength(0);
      expect(doc.tables).toHaveLength(0);
      expect(doc.groups).toHaveLength(0);
      expect(doc.body.children).toHaveLength(0);
      expect(doc.furniture.children).toHaveLength(0);
    });

    test('handles empty pageResults array', () => {
      const metadata = createMetadata(0);
      const doc = assembler.assemble([], metadata);

      expect(doc.texts).toHaveLength(0);
      expect(doc.pictures).toHaveLength(0);
      expect(doc.tables).toHaveLength(0);
      expect(doc.pages).toEqual({});
    });
  });

  describe('assemble - text elements', () => {
    test('assigns sequential self_ref to text items', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            { type: 'text', content: 'First', order: 0 },
            { type: 'text', content: 'Second', order: 1 },
            { type: 'text', content: 'Third', order: 2 },
          ],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.texts).toHaveLength(3);
      expect(doc.texts[0].self_ref).toBe('#/texts/0');
      expect(doc.texts[1].self_ref).toBe('#/texts/1');
      expect(doc.texts[2].self_ref).toBe('#/texts/2');
    });

    test('populates text and orig fields', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [{ type: 'text', content: 'Hello world', order: 0 }],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.texts[0].text).toBe('Hello world');
      expect(doc.texts[0].orig).toBe('Hello world');
    });

    test('sets label matching element type', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            { type: 'text', content: 'Body', order: 0 },
            { type: 'caption', content: 'Fig 1', order: 1 },
            { type: 'footnote', content: 'Note 1', order: 2 },
          ],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.texts[0].label).toBe('text');
      expect(doc.texts[1].label).toBe('caption');
      expect(doc.texts[2].label).toBe('footnote');
    });

    test('sets level for section_header elements', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            {
              type: 'section_header',
              content: 'Chapter 1',
              level: 1,
              order: 0,
            },
            {
              type: 'section_header',
              content: 'Section 1.1',
              level: 2,
              order: 1,
            },
          ],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.texts[0].level).toBe(1);
      expect(doc.texts[1].level).toBe(2);
    });

    test('sets enumerated and marker for list_item elements', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            {
              type: 'list_item',
              content: 'Ordered item',
              marker: '1)',
              order: 0,
            },
            {
              type: 'list_item',
              content: 'Unordered item',
              marker: '\u2022',
              order: 1,
            },
            { type: 'list_item', content: 'No marker item', order: 2 },
          ],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.texts[0].enumerated).toBe(true);
      expect(doc.texts[0].marker).toBe('1)');
      expect(doc.texts[1].enumerated).toBe(false);
      expect(doc.texts[1].marker).toBe('\u2022');
      expect(doc.texts[2].enumerated).toBe(false);
    });
  });

  describe('assemble - body vs furniture separation', () => {
    test('places page_header and page_footer in furniture', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            { type: 'page_header', content: 'Report Title', order: 0 },
            { type: 'text', content: 'Body text', order: 1 },
            { type: 'page_footer', content: 'Page 1', order: 2 },
          ],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.body.children).toHaveLength(1);
      expect(doc.body.children[0].$ref).toBe('#/texts/1');

      expect(doc.furniture.children).toHaveLength(2);
      expect(doc.furniture.children[0].$ref).toBe('#/texts/0');
      expect(doc.furniture.children[1].$ref).toBe('#/texts/2');
    });

    test('body and furniture have correct self_ref and name', () => {
      const doc = assembler.assemble(
        [{ pageNo: 1, elements: [] }],
        createMetadata(1),
      );

      expect(doc.body.self_ref).toBe('#/body');
      expect(doc.body.name).toBe('_root_');
      expect(doc.body.label).toBe('unspecified');
      expect(doc.furniture.self_ref).toBe('#/furniture');
      expect(doc.furniture.name).toBe('_root_');
    });
  });

  describe('assemble - picture elements', () => {
    test('assigns sequential self_ref to picture items', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            {
              type: 'picture',
              content: '',
              order: 0,
              bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 },
            },
            {
              type: 'picture',
              content: '',
              order: 1,
              bbox: { l: 0.2, t: 0.3, r: 0.8, b: 0.7 },
            },
          ],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.pictures).toHaveLength(2);
      expect(doc.pictures[0].self_ref).toBe('#/pictures/0');
      expect(doc.pictures[1].self_ref).toBe('#/pictures/1');
    });

    test('initializes picture item with empty arrays', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            {
              type: 'picture',
              content: '',
              order: 0,
              bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 },
            },
          ],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.pictures[0].captions).toEqual([]);
      expect(doc.pictures[0].references).toEqual([]);
      expect(doc.pictures[0].footnotes).toEqual([]);
      expect(doc.pictures[0].annotations).toEqual([]);
      expect(doc.pictures[0].label).toBe('picture');
    });
  });

  describe('assemble - table elements', () => {
    test('creates table item with empty data', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [{ type: 'table', content: '| A | B |', order: 0 }],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.tables).toHaveLength(1);
      expect(doc.tables[0].self_ref).toBe('#/tables/0');
      expect(doc.tables[0].label).toBe('table');
      expect(doc.tables[0].data.table_cells).toEqual([]);
      expect(doc.tables[0].data.num_rows).toBe(0);
      expect(doc.tables[0].data.num_cols).toBe(0);
      expect(doc.tables[0].data.grid).toEqual([]);
    });
  });

  describe('assemble - body.children ordering', () => {
    test('creates $ref entries in reading order across element types', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            { type: 'section_header', content: 'Title', level: 1, order: 0 },
            { type: 'text', content: 'Paragraph', order: 1 },
            {
              type: 'picture',
              content: '',
              order: 2,
              bbox: { l: 0.1, t: 0.3, r: 0.9, b: 0.7 },
            },
            { type: 'caption', content: 'Figure 1', order: 3 },
            { type: 'table', content: '| Col |', order: 4 },
          ],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.body.children).toEqual([
        { $ref: '#/texts/0' }, // section_header
        { $ref: '#/texts/1' }, // text
        { $ref: '#/pictures/0' }, // picture
        { $ref: '#/texts/2' }, // caption
        { $ref: '#/tables/0' }, // table
      ]);
    });

    test('maintains order across multiple pages', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 2,
          elements: [{ type: 'text', content: 'Page 2 text', order: 0 }],
        },
        {
          pageNo: 1,
          elements: [{ type: 'text', content: 'Page 1 text', order: 0 }],
        },
      ];
      const metadata = createMetadata(2);

      const doc = assembler.assemble(pageResults, metadata);

      // Pages are sorted by pageNo, so page 1 elements come first
      expect(doc.texts[0].text).toBe('Page 1 text');
      expect(doc.texts[1].text).toBe('Page 2 text');
    });
  });

  describe('assemble - bbox coordinate conversion', () => {
    test('converts VLM normalized bbox to BOTTOMLEFT absolute pixels', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            {
              type: 'text',
              content: 'Test',
              order: 0,
              bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 },
            },
          ],
        },
      ];
      // Page: 1000 x 2000 px
      const metadata = createMetadata(1, 1000, 2000);

      const doc = assembler.assemble(pageResults, metadata);
      const prov = doc.texts[0].prov[0];

      // l = 0.1 * 1000 = 100
      expect(prov.bbox.l).toBeCloseTo(100);
      // r = 0.9 * 1000 = 900
      expect(prov.bbox.r).toBeCloseTo(900);
      // t = (1 - 0.2) * 2000 = 1600 (VLM top → high Y in BOTTOMLEFT)
      expect(prov.bbox.t).toBeCloseTo(1600);
      // b = (1 - 0.8) * 2000 = 400 (VLM bottom → low Y in BOTTOMLEFT)
      expect(prov.bbox.b).toBeCloseTo(400);
      expect(prov.bbox.coord_origin).toBe('BOTTOMLEFT');
    });

    test('handles corner case bbox at full page bounds', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            {
              type: 'picture',
              content: '',
              order: 0,
              bbox: { l: 0, t: 0, r: 1, b: 1 },
            },
          ],
        },
      ];
      const metadata = createMetadata(1, 1190, 1684);

      const doc = assembler.assemble(pageResults, metadata);
      const prov = doc.pictures[0].prov[0];

      expect(prov.bbox.l).toBeCloseTo(0);
      expect(prov.bbox.r).toBeCloseTo(1190);
      expect(prov.bbox.t).toBeCloseTo(1684);
      expect(prov.bbox.b).toBeCloseTo(0);
    });

    test('generates zero bbox when element has no bbox', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [{ type: 'text', content: 'No bbox', order: 0 }],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);
      const prov = doc.texts[0].prov[0];

      expect(prov.bbox.l).toBe(0);
      expect(prov.bbox.t).toBe(0);
      expect(prov.bbox.r).toBe(0);
      expect(prov.bbox.b).toBe(0);
      expect(prov.bbox.coord_origin).toBe('BOTTOMLEFT');
    });

    test('sets charspan based on content length', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [{ type: 'text', content: 'Hello', order: 0 }],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.texts[0].prov[0].charspan).toEqual([0, 5]);
    });

    test('sets correct page_no in prov', () => {
      const pageResults: VlmPageResult[] = [
        { pageNo: 1, elements: [{ type: 'text', content: 'P1', order: 0 }] },
        { pageNo: 3, elements: [{ type: 'text', content: 'P3', order: 0 }] },
      ];
      const dims = new Map<number, { width: number; height: number }>();
      dims.set(1, { width: 1190, height: 1684 });
      dims.set(3, { width: 1190, height: 1684 });
      const metadata: AssemblerMetadata = {
        name: 'test',
        filename: 'test.pdf',
        pageDimensions: dims,
      };

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.texts[0].prov[0].page_no).toBe(1);
      expect(doc.texts[1].prov[0].page_no).toBe(3);
    });
  });

  describe('assemble - pages', () => {
    test('creates page entries for each VLM page result', () => {
      const pageResults: VlmPageResult[] = [
        { pageNo: 1, elements: [] },
        { pageNo: 2, elements: [] },
      ];
      const metadata = createMetadata(2, 1190, 1684);

      const doc = assembler.assemble(pageResults, metadata);

      expect(Object.keys(doc.pages)).toEqual(['1', '2']);
      expect(doc.pages['1'].page_no).toBe(1);
      expect(doc.pages['1'].size).toEqual({ width: 1190, height: 1684 });
      expect(doc.pages['1'].image.mimetype).toBe('image/png');
      expect(doc.pages['1'].image.dpi).toBe(300);
      expect(doc.pages['1'].image.uri).toBe(''); // Filled by VlmDocumentBuilder
      expect(doc.pages['2'].page_no).toBe(2);
    });

    test('uses zero dimensions when page dimensions are missing', () => {
      const pageResults: VlmPageResult[] = [{ pageNo: 5, elements: [] }];
      const metadata: AssemblerMetadata = {
        name: 'test',
        filename: 'test.pdf',
        pageDimensions: new Map(),
      };

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.pages['5'].size).toEqual({ width: 0, height: 0 });
    });

    test('uses custom DPI when provided in metadata', () => {
      const pageResults: VlmPageResult[] = [{ pageNo: 1, elements: [] }];
      const metadata: AssemblerMetadata = {
        ...createMetadata(1),
        dpi: 150,
      };

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.pages['1'].image.dpi).toBe(150);
    });

    test('defaults to DPI 300 when not provided in metadata', () => {
      const pageResults: VlmPageResult[] = [{ pageNo: 1, elements: [] }];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.pages['1'].image.dpi).toBe(300);
    });
  });

  describe('assemble - caption linking', () => {
    test('links caption to preceding picture on the same page', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            {
              type: 'picture',
              content: '',
              order: 0,
              bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 },
            },
            { type: 'caption', content: 'Figure 1. Site overview', order: 1 },
          ],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.pictures[0].captions).toEqual([{ $ref: '#/texts/0' }]);
    });

    test('links caption to preceding table on the same page', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            { type: 'table', content: '| A | B |', order: 0 },
            { type: 'caption', content: 'Table 1. Results', order: 1 },
          ],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.tables[0].captions).toEqual([{ $ref: '#/texts/0' }]);
    });

    test('does not link caption when no preceding picture or table exists', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            { type: 'text', content: 'Body text', order: 0 },
            { type: 'caption', content: 'Orphan caption', order: 1 },
          ],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.pictures).toHaveLength(0);
      expect(doc.tables).toHaveLength(0);
    });

    test('links multiple captions to different pictures on the same page', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            {
              type: 'picture',
              content: '',
              order: 0,
              bbox: { l: 0, t: 0, r: 1, b: 0.4 },
            },
            { type: 'caption', content: 'Figure 1', order: 1 },
            {
              type: 'picture',
              content: '',
              order: 2,
              bbox: { l: 0, t: 0.5, r: 1, b: 0.9 },
            },
            { type: 'caption', content: 'Figure 2', order: 3 },
          ],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.pictures[0].captions).toEqual([{ $ref: '#/texts/0' }]);
      expect(doc.pictures[1].captions).toEqual([{ $ref: '#/texts/1' }]);
    });

    test('does not link caption across page boundaries', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            {
              type: 'picture',
              content: '',
              order: 0,
              bbox: { l: 0, t: 0, r: 1, b: 1 },
            },
          ],
        },
        {
          pageNo: 2,
          elements: [
            { type: 'caption', content: 'Caption on next page', order: 0 },
          ],
        },
      ];
      const metadata = createMetadata(2);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.pictures[0].captions).toEqual([]);
    });

    test('links caption to nearest preceding picture skipping text elements', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            {
              type: 'picture',
              content: '',
              order: 0,
              bbox: { l: 0, t: 0, r: 1, b: 0.5 },
            },
            { type: 'text', content: 'Some description', order: 1 },
            { type: 'caption', content: 'Figure 1', order: 2 },
          ],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      // Caption should link to the picture, skipping the text element
      expect(doc.pictures[0].captions).toEqual([{ $ref: '#/texts/1' }]);
    });

    test('links caption to nearest picture when both table and picture precede', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            { type: 'table', content: '| A | B |', order: 0 },
            {
              type: 'picture',
              content: '',
              order: 1,
              bbox: { l: 0, t: 0, r: 1, b: 0.5 },
            },
            { type: 'caption', content: 'Figure 1', order: 2 },
          ],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      // Caption links to the nearest (picture), not the table
      expect(doc.pictures[0].captions).toEqual([{ $ref: '#/texts/0' }]);
      expect(doc.tables[0].captions).toEqual([]);
    });
  });

  describe('extractIndex (private)', () => {
    test('extracts numeric index from valid self_ref', () => {
      const result = (assembler as any).extractIndex('#/pictures/0');
      expect(result).toBe(0);
    });

    test('extracts higher numeric index', () => {
      const result = (assembler as any).extractIndex('#/tables/5');
      expect(result).toBe(5);
    });

    test('returns null for non-numeric self_ref', () => {
      const result = (assembler as any).extractIndex('#/pictures/abc');
      expect(result).toBeNull();
    });
  });

  describe('assemble - caption linking with invalid selfRef', () => {
    test('does not link caption when picture selfRef has invalid index', () => {
      // Use a picture element, then a caption.
      // Override the selfRef to simulate invalid data by monkeypatching.
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            {
              type: 'picture',
              content: '',
              order: 0,
              bbox: { l: 0, t: 0, r: 1, b: 0.5 },
            },
            { type: 'caption', content: 'Figure caption', order: 1 },
          ],
        },
      ];
      const metadata = createMetadata(1);

      // Spy on extractIndex to return null for picture refs
      const origExtractIndex = (assembler as any).extractIndex.bind(assembler);
      (assembler as any).extractIndex = (selfRef: string) => {
        if (selfRef.includes('pictures')) return null;
        return origExtractIndex(selfRef);
      };

      const doc = assembler.assemble(pageResults, metadata);
      expect(doc.pictures[0].captions).toEqual([]);

      // Restore
      (assembler as any).extractIndex = origExtractIndex;
    });

    test('does not link caption when table selfRef has invalid index', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            { type: 'table', content: '| A | B |', order: 0 },
            { type: 'caption', content: 'Table caption', order: 1 },
          ],
        },
      ];
      const metadata = createMetadata(1);

      const origExtractIndex = (assembler as any).extractIndex.bind(assembler);
      (assembler as any).extractIndex = (selfRef: string) => {
        if (selfRef.includes('tables')) return null;
        return origExtractIndex(selfRef);
      };

      const doc = assembler.assemble(pageResults, metadata);
      expect(doc.tables[0].captions).toEqual([]);

      // Restore
      (assembler as any).extractIndex = origExtractIndex;
    });
  });

  describe('assemble - mixed element numbering', () => {
    test('numbers texts, pictures, tables independently', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            { type: 'text', content: 'T0', order: 0 },
            {
              type: 'picture',
              content: '',
              order: 1,
              bbox: { l: 0, t: 0, r: 1, b: 1 },
            },
            { type: 'text', content: 'T1', order: 2 },
            { type: 'table', content: 'Table', order: 3 },
            {
              type: 'picture',
              content: '',
              order: 4,
              bbox: { l: 0, t: 0, r: 1, b: 1 },
            },
            { type: 'text', content: 'T2', order: 5 },
          ],
        },
      ];
      const metadata = createMetadata(1);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.texts.map((t) => t.self_ref)).toEqual([
        '#/texts/0',
        '#/texts/1',
        '#/texts/2',
      ]);
      expect(doc.pictures.map((p) => p.self_ref)).toEqual([
        '#/pictures/0',
        '#/pictures/1',
      ]);
      expect(doc.tables.map((t) => t.self_ref)).toEqual(['#/tables/0']);
    });

    test('numbering continues across pages', () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [{ type: 'text', content: 'Page 1 text', order: 0 }],
        },
        {
          pageNo: 2,
          elements: [{ type: 'text', content: 'Page 2 text', order: 0 }],
        },
      ];
      const metadata = createMetadata(2);

      const doc = assembler.assemble(pageResults, metadata);

      expect(doc.texts[0].self_ref).toBe('#/texts/0');
      expect(doc.texts[1].self_ref).toBe('#/texts/1');
    });
  });
});
