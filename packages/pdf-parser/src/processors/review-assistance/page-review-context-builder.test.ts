import type { DoclingBBox, DoclingDocument, DoclingProv } from '@heripo/model';

import { describe, expect, test } from 'vitest';

import { PageReviewContextBuilder } from './page-review-context-builder';

const bbox: DoclingBBox = {
  l: 10,
  t: 20,
  r: 110,
  b: 60,
  coord_origin: 'TOPLEFT',
};

const pageProv: DoclingProv = {
  page_no: 1,
  bbox,
  charspan: [0, 10],
};

function makeDoc(): DoclingDocument {
  return {
    schema_name: 'DoclingDocument',
    version: '1.0',
    name: 'sample',
    origin: {
      mimetype: 'application/pdf',
      binary_hash: 1,
      filename: 'sample.pdf',
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
      children: [
        { $ref: '#/texts/0' },
        { $ref: '#/pictures/0' },
        { $ref: '#/texts/1' },
        { $ref: '#/tables/0' },
      ],
      content_layer: 'body',
      name: '_root_',
      label: 'unspecified',
    },
    groups: [],
    texts: [
      {
        self_ref: '#/texts/0',
        parent: { $ref: '#/body' },
        children: [],
        content_layer: 'body',
        label: 'text',
        prov: [pageProv],
        orig: 'Tltle',
        text: 'Tltle',
      },
      {
        self_ref: '#/texts/1',
        parent: { $ref: '#/body' },
        children: [],
        content_layer: 'body',
        label: 'text',
        prov: [
          {
            page_no: 1,
            bbox: { l: 12, t: 70, r: 90, b: 90, coord_origin: 'TOPLEFT' },
            charspan: [0, 10],
          },
        ],
        orig: 'Figure 1. Trench',
        text: 'Figure 1. Trench',
      },
    ],
    pictures: [
      {
        self_ref: '#/pictures/0',
        parent: { $ref: '#/body' },
        children: [],
        content_layer: 'body',
        label: 'picture',
        prov: [
          {
            page_no: 1,
            bbox: { l: 10, t: 95, r: 180, b: 190, coord_origin: 'TOPLEFT' },
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
    tables: [
      {
        self_ref: '#/tables/0',
        parent: { $ref: '#/body' },
        children: [],
        content_layer: 'body',
        label: 'table',
        prov: [
          {
            page_no: 1,
            bbox: { l: 10, t: 200, r: 180, b: 260, coord_origin: 'TOPLEFT' },
            charspan: [0, 0],
          },
        ],
        captions: [],
        references: [],
        footnotes: [],
        data: {
          num_rows: 2,
          num_cols: 2,
          table_cells: [],
          grid: [
            [
              {
                bbox,
                row_span: 1,
                col_span: 1,
                start_row_offset_idx: 0,
                end_row_offset_idx: 1,
                start_col_offset_idx: 0,
                end_col_offset_idx: 1,
                text: 'Layer',
                column_header: true,
                row_header: false,
                row_section: false,
                fillable: false,
              },
              {
                bbox,
                row_span: 1,
                col_span: 1,
                start_row_offset_idx: 0,
                end_row_offset_idx: 1,
                start_col_offset_idx: 1,
                end_col_offset_idx: 2,
                text: 'Depth',
                column_header: true,
                row_header: false,
                row_section: false,
                fillable: false,
              },
            ],
            [
              {
                bbox,
                row_span: 1,
                col_span: 1,
                start_row_offset_idx: 1,
                end_row_offset_idx: 2,
                start_col_offset_idx: 0,
                end_col_offset_idx: 1,
                text: '',
                column_header: false,
                row_header: false,
                row_section: false,
                fillable: false,
              },
              {
                bbox,
                row_span: 1,
                col_span: 1,
                start_row_offset_idx: 1,
                end_row_offset_idx: 2,
                start_col_offset_idx: 1,
                end_col_offset_idx: 2,
                text: '',
                column_header: false,
                row_header: false,
                row_section: false,
                fillable: false,
              },
            ],
          ],
        },
      },
    ],
    pages: {
      '1': {
        page_no: 1,
        size: { width: 200, height: 300 },
        image: {
          mimetype: 'image/png',
          dpi: 200,
          size: { width: 200, height: 300 },
          uri: 'pages/page_0.png',
        },
      },
    },
  };
}

describe('PageReviewContextBuilder', () => {
  test('builds page context with text, media, layout, and suspect hints', () => {
    const [context] = new PageReviewContextBuilder().build(makeDoc(), '/out', {
      pageTexts: new Map([[1, 'Title\n\nFigure 1. Trench']]),
    });

    expect(context.pageNo).toBe(1);
    expect(context.pageImagePath).toBe('/out/pages/page_0.png');
    expect(context.textBlocks[0]).toMatchObject({
      ref: '#/texts/0',
      textLayerReference: 'Title',
    });
    expect(context.textBlocks[1].suspectReasons).toContain(
      'caption_like_body_text',
    );
    expect(context.pictures[0].suspectReasons).toContain(
      'image_missing_caption',
    );
    expect(context.tables[0].suspectReasons).toEqual([
      'table_missing_caption',
      'table_many_empty_cells',
    ]);
    expect(context.orphanCaptions[0]).toMatchObject({
      ref: '#/texts/1',
      captionLikeBodyText: true,
    });
    expect(context.layout.readingOrderRefs).toEqual([
      '#/texts/0',
      '#/pictures/0',
      '#/texts/1',
      '#/tables/0',
    ]);
  });

  test('detects multilingual domain patterns without assuming one locale', () => {
    const doc = makeDoc();
    doc.texts[0].text = 'Feature no. 12, layer SU-4, 35 cm, 研究所';

    const [context] = new PageReviewContextBuilder().build(doc, '/out');
    const patterns = context.domainPatterns.map((entry) => entry.pattern);

    expect(patterns).toContain('feature_number');
    expect(patterns).toContain('layer_code');
    expect(patterns).toContain('unit');
    expect(patterns).toContain('institution_name');
  });

  test('covers groups, linked captions, repeated text, adjacent tables, and bbox warnings', () => {
    const doc = makeDoc();
    doc.pages['2'] = {
      page_no: 2,
      size: { width: 200, height: 300 },
      image: {
        mimetype: 'image/png',
        dpi: 200,
        size: { width: 200, height: 300 },
        uri: '/abs/page_1.png',
      },
    };
    doc.groups.push({
      self_ref: '#/groups/0',
      parent: { $ref: '#/body' },
      children: [{ $ref: '#/texts/2' }],
      content_layer: 'body',
      name: 'group',
      label: 'list',
    });
    doc.body.children = [
      { $ref: '#/groups/0' },
      { $ref: '#/groups/0' },
      { $ref: '#/unknown/0' },
      { $ref: '#/texts/not-a-number' },
      { $ref: '#/pictures/0' },
      { $ref: '#/tables/0' },
    ];
    doc.furniture.children = [{ $ref: '#/texts/3' }];
    doc.texts.push(
      {
        self_ref: '#/texts/2',
        parent: { $ref: '#/groups/0' },
        children: [],
        content_layer: 'body',
        label: 'section_header',
        prov: [
          {
            page_no: 1,
            bbox: {
              l: -1,
              t: 10,
              r: 10,
              b: 20,
              coord_origin: 'TOPLEFT',
            },
            charspan: [0, 1],
          },
        ],
        orig: 'A'.repeat(81),
        text: 'A'.repeat(81),
      },
      {
        self_ref: '#/texts/3',
        parent: { $ref: '#/furniture' },
        children: [],
        content_layer: 'furniture',
        label: 'text',
        prov: [
          {
            page_no: 1,
            bbox: {
              l: 10,
              t: 10,
              r: 10,
              b: 10,
              coord_origin: 'TOPLEFT',
            },
            charspan: [0, 1],
          },
        ],
        orig: '',
        text: '',
      },
      {
        self_ref: '#/texts/4',
        parent: { $ref: '#/body' },
        children: [],
        content_layer: 'body',
        label: 'text',
        prov: [
          {
            page_no: 1,
            bbox: {
              l: 20,
              t: 20,
              r: 20.5,
              b: 20.5,
              coord_origin: 'BOTTOMLEFT',
            },
            charspan: [0, 12],
          },
          {
            page_no: 2,
            bbox: {
              l: 20,
              t: 20,
              r: 25,
              b: 25,
              coord_origin: 'TOPLEFT',
            },
            charspan: [0, 12],
          },
        ],
        orig: 'Repeated',
        text: 'Repeated',
      },
      {
        self_ref: '#/texts/5',
        parent: { $ref: '#/body' },
        children: [],
        content_layer: 'body',
        label: 'caption',
        prov: [pageProv],
        orig: 'Table 1',
        text: 'Table 1',
      },
      {
        self_ref: '#/texts/6',
        parent: { $ref: '#/body' },
        children: [],
        content_layer: 'body',
        label: 'text',
        prov: [pageProv],
        orig: '1) Footnote body',
        text: '1) Footnote body',
      },
      {
        self_ref: '#/texts/7',
        parent: { $ref: '#/body' },
        children: [],
        content_layer: 'body',
        label: 'caption',
        prov: [pageProv],
        orig: 'Unlinked caption',
        text: 'Unlinked caption',
      },
    );
    doc.pictures[0].captions = [{ $ref: '#/texts/5' }];
    doc.pictures[0].prov[0].bbox = {
      l: 0,
      t: 0,
      r: 400,
      b: 400,
      coord_origin: 'TOPLEFT',
    };
    doc.tables[0].captions = [{ $ref: '#/texts/5' }];
    doc.tables.push({
      ...doc.tables[0],
      self_ref: '#/tables/1',
      prov: [
        {
          page_no: 2,
          bbox: { l: 10, t: 20, r: 180, b: 100, coord_origin: 'TOPLEFT' },
          charspan: [0, 0],
        },
      ],
    });

    const contexts = new PageReviewContextBuilder().build(doc, '/out');
    const first = contexts[0];
    const second = contexts[1];
    const reasons = first.textBlocks.flatMap((block) => block.suspectReasons);

    expect(contexts).toHaveLength(2);
    expect(second.pageImagePath).toBe('/abs/page_1.png');
    expect(reasons).toContain('heading_too_long');
    expect(reasons).toContain('empty_text');
    expect(reasons).toContain('footnote_like_body_text');
    expect(
      first.textBlocks.find((block) => block.ref === '#/texts/4')
        ?.repeatedAcrossPages,
    ).toBe(true);
    expect(first.tables[0].caption).toBe('Table 1');
    expect(first.tables[0].suspectReasons).toContain(
      'multi_page_table_candidate',
    );
    expect(first.pictures[0].caption).toBe('Table 1');
    expect(first.pictures[0].suspectReasons).toContain(
      'large_picture_split_candidate',
    );
    expect(first.layout.bboxWarnings.map((warning) => warning.reason)).toEqual(
      expect.arrayContaining([
        'bbox_outside_page',
        'bbox_too_small',
        'invalid_bbox_order',
      ]),
    );
  });

  test('handles missing geometry and pages without declared size', () => {
    const doc = makeDoc();
    doc.pages['2'] = {
      page_no: 2,
    } as any;
    doc.texts.push(
      {
        self_ref: '#/texts/2',
        parent: { $ref: '#/body' },
        children: [],
        content_layer: 'body',
        label: 'caption',
        prov: [{ page_no: 1, charspan: [0, 1] } as any],
        orig: 'Figure 2. Missing geometry',
        text: 'Figure 2. Missing geometry',
      },
      {
        self_ref: '#/texts/3',
        parent: { $ref: '#/body' },
        children: [],
        content_layer: 'body',
        label: 'text',
        prov: [
          {
            page_no: 1,
            bbox: {
              l: 20,
              t: 30,
              r: 50,
              b: 30.1,
              coord_origin: 'TOPLEFT',
            },
            charspan: [0, 1],
          },
        ],
        orig: 'thin',
        text: 'thin',
      },
      {
        self_ref: '#/texts/4',
        parent: { $ref: '#/body' },
        children: [],
        content_layer: 'body',
        label: 'text',
        prov: [
          {
            page_no: 2,
            bbox: {
              l: 10,
              t: 10,
              r: 60,
              b: 30,
              coord_origin: 'TOPLEFT',
            },
            charspan: [0, 1],
          },
        ],
        orig: 'page without size',
        text: 'page without size',
      },
    );

    const contexts = new PageReviewContextBuilder().build(doc, '/out');
    const first = contexts.find((context) => context.pageNo === 1);
    const second = contexts.find((context) => context.pageNo === 2);

    expect(
      first?.layout.bboxWarnings.map((warning) => warning.reason),
    ).toContain('bbox_too_small');
    expect(
      first?.orphanCaptions.find((caption) => caption.ref === '#/texts/2')
        ?.nearestMediaRefs[0]?.distance,
    ).toBe(Number.POSITIVE_INFINITY);
    expect(second?.pageSize).toBeNull();
    expect(second?.layout.bboxWarnings).toEqual([]);
  });

  test('handles sparse and empty table grids', () => {
    const sparseDoc = makeDoc();
    delete (sparseDoc.tables[0].data.grid[0][0] as any).text;

    const [sparseContext] = new PageReviewContextBuilder().build(
      sparseDoc,
      '/out',
    );

    expect(sparseContext.tables[0].gridPreview[0][0]).toBe('');

    const emptyDoc = makeDoc();
    emptyDoc.tables[0].data.grid = [];
    emptyDoc.tables[0].data.num_cols = 0;

    const [emptyContext] = new PageReviewContextBuilder().build(
      emptyDoc,
      '/out',
    );

    expect(emptyContext.tables[0].gridPreview).toEqual([]);
    expect(emptyContext.tables[0].emptyCellRatio).toBe(0);
    expect(emptyContext.tables[0].suspectReasons).not.toContain(
      'multi_page_table_candidate',
    );
  });
});
