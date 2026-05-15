import type { PageReviewContext } from './page-review-context-builder';
import type { ReviewAssistanceWorkItem } from './review-assistance-work-scheduler';

import { describe, expect, test } from 'vitest';

import { TableCorrectionContextBuilder } from './table-correction-context-builder';

const bbox = { l: 0, t: 0, r: 10, b: 10, coord_origin: 'TOPLEFT' as const };

function makeContext(
  overrides: Partial<PageReviewContext> = {},
): PageReviewContext {
  return {
    pageNo: 3,
    reviewAssistanceEligibility: {
      pageNo: 3,
      eligible: true,
      kind: 'archaeological_data',
      score: 90,
      reasons: ['table page'],
      exclusionReasons: [],
    },
    pageSize: { width: 100, height: 100 },
    pageImagePath: '/tmp/page.png',
    textBlocks: [
      {
        ref: '#/texts/0',
        label: 'caption',
        text: 'Table 1. Target',
        bbox,
        suspectReasons: ['caption_like_body_text'],
      },
      {
        ref: '#/texts/1',
        label: 'text',
        text: 'Between',
        bbox,
        suspectReasons: [],
      },
      {
        ref: '#/texts/2',
        label: 'caption',
        text: 'Table 2. Other',
        bbox,
        suspectReasons: ['caption_like_body_text'],
      },
      {
        ref: '#/texts/3',
        label: 'text',
        text: 'Tail',
        bbox,
        suspectReasons: [],
      },
    ],
    missingTextCandidates: [
      {
        text: 'Missing',
        source: 'text_layer',
        reason: 'unmatched_text_layer_block',
      },
    ],
    tables: [
      {
        ref: '#/tables/0',
        caption: 'Table 1',
        bbox,
        gridPreview: [
          ['층위', '깊이 10cm'],
          ['Ⅰ', ''],
        ],
        rowCount: 10,
        colCount: 2,
        hasSpans: true,
        headerRows: [0],
        headerColumns: [0],
        unitHints: ['10cm'],
        footnoteRefs: ['#/texts/4'],
        footnoteMarkers: ['※'],
        emptyCellRatio: 0.2,
        nextPageTableRefs: ['#/tables/9'],
        suspectReasons: ['multi_page_table_candidate'],
      },
      {
        ref: '#/tables/1',
        caption: 'Table 2',
        bbox: { l: 20, t: 0, r: 30, b: 10, coord_origin: 'TOPLEFT' },
        gridPreview: [['Other']],
        rowCount: 1,
        colCount: 1,
        emptyCellRatio: 0,
        suspectReasons: [],
      },
    ],
    pictures: [],
    orphanCaptions: [
      {
        ref: '#/texts/0',
        text: 'Table 1. Target',
        bbox,
        currentLabel: 'caption',
        captionLikeBodyText: true,
        nearestMediaRefs: [{ ref: '#/tables/0', kind: 'table', distance: 1 }],
      },
      {
        ref: '#/texts/2',
        text: 'Table 2. Other',
        bbox,
        currentLabel: 'caption',
        captionLikeBodyText: true,
        nearestMediaRefs: [{ ref: '#/tables/1', kind: 'table', distance: 1 }],
      },
    ],
    footnotes: [{ ref: '#/texts/0', text: 'Table 1. Target', bbox }],
    layout: {
      readingOrderRefs: [
        '#/texts/0',
        '#/tables/0',
        '#/texts/1',
        '#/texts/2',
        '#/tables/1',
        '#/texts/3',
      ],
      visualOrderRefs: [
        '#/texts/0',
        '#/tables/0',
        '#/texts/1',
        '#/texts/2',
        '#/tables/1',
        '#/texts/3',
      ],
      bboxWarnings: [{ targetRef: '#/tables/0', reason: 'bbox_outside_page' }],
    },
    domainPatterns: [
      { targetRef: '#/texts/1', pattern: 'unit', value: '10cm' },
    ],
    ...overrides,
  };
}

function makeWorkItem(
  targetRefs: string[] = ['#/tables/0'],
): ReviewAssistanceWorkItem {
  const context = makeContext();
  return {
    id: 'table-item',
    kind: 'table',
    pageNo: context.pageNo,
    targetRefs,
    priority: 'required',
    contextBudget: 'small',
    eligibility: context.reviewAssistanceEligibility,
    task: {
      id: 'tables',
      label: 'Tables',
      allowedOps: ['updateTableCell', 'replaceTable', 'linkContinuedTable'],
      focus: 'Tables',
    },
  };
}

describe('TableCorrectionContextBuilder', () => {
  test('builds one isolated table correction context per table', () => {
    const contexts = new TableCorrectionContextBuilder().build(makeContext());

    expect(contexts).toHaveLength(2);
    expect(contexts[0]).toMatchObject({
      pageNo: 3,
      tableCountOnPage: 2,
      targetTable: {
        ref: '#/tables/0',
        rowCount: 10,
        colCount: 2,
        hasSpans: true,
      },
      otherTablesOnPage: [expect.objectContaining({ ref: '#/tables/1' })],
      validationHints: expect.arrayContaining([
        'multiple_tables_on_page',
        'span_cells_present',
        'column_headers_present',
        'row_headers_present',
        'unit_hints_present',
        'footnote_hints_present',
        'continued_table_neighbors_present',
      ]),
    });
    expect(
      contexts[0].scopedPageContext.tables.map((table) => table.ref),
    ).toEqual(['#/tables/0']);
    expect(contexts[0].scopedPageContext.pictures).toEqual([]);
    expect(contexts[0].orphanCaptions.map((caption) => caption.ref)).toEqual([
      '#/texts/0',
    ]);
  });

  test('builds table context from a scheduler work item', () => {
    const context = new TableCorrectionContextBuilder().buildForWorkItem(
      makeContext(),
      makeWorkItem(['#/tables/1']),
    );

    expect(context.targetTable.ref).toBe('#/tables/1');
    expect(context.otherTablesOnPage.map((table) => table.ref)).toEqual([
      '#/tables/0',
    ]);
    expect(context.scopedPageContext.layout.readingOrderRefs).toEqual([
      '#/texts/0',
      '#/texts/1',
      '#/texts/2',
      '#/tables/1',
      '#/texts/3',
    ]);
  });

  test('throws when the target table ref is missing or unknown', () => {
    const builder = new TableCorrectionContextBuilder();

    expect(() =>
      builder.buildForWorkItem(makeContext(), makeWorkItem([])),
    ).toThrow('table_correction_target_ref_missing');
    expect(() => builder.buildForTable(makeContext(), '#/tables/404')).toThrow(
      'table_correction_target_ref_not_found:#/tables/404',
    );
  });

  test('records bbox and empty-cell hints for sparse tables without nearby text', () => {
    const [context] = new TableCorrectionContextBuilder().build(
      makeContext({
        textBlocks: [],
        tables: [
          {
            ref: '#/tables/0',
            gridPreview: [['']],
            emptyCellRatio: 1,
            suspectReasons: ['table_many_empty_cells'],
          },
        ],
        orphanCaptions: [],
        footnotes: [],
        layout: {
          readingOrderRefs: [],
          visualOrderRefs: [],
          bboxWarnings: [],
        },
        domainPatterns: [],
      }),
    );

    expect(context.nearbyTextBlocks).toEqual([]);
    expect(context.validationHints).toEqual([
      'target_table_bbox_missing',
      'many_empty_cells_present',
    ]);
  });
});
