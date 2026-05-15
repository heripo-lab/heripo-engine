import type { ReviewAssistancePageOutput } from '../../types/review-assistance-schema';
import type { TableCorrectionContext } from './table-correction-context-builder';

import { describe, expect, test } from 'vitest';

import { ReviewAssistanceValidator } from './review-assistance-validator';
import { TableCorrectionValidator } from './table-correction-validator';

const bbox = { l: 0, t: 0, r: 10, b: 10, coord_origin: 'TOPLEFT' as const };

function makeContext(
  overrides: Partial<TableCorrectionContext> = {},
): TableCorrectionContext {
  const targetTable = {
    ref: '#/tables/0',
    caption: 'Target table',
    bbox,
    gridPreview: [['Layer', 'Depth 10cm']],
    rowCount: 10,
    colCount: 2,
    hasSpans: true,
    headerRows: [0],
    headerColumns: [],
    unitHints: ['10cm'],
    footnoteRefs: [],
    footnoteMarkers: ['※'],
    emptyCellRatio: 0,
    previousPageTableRefs: ['#/tables/prev'],
    nextPageTableRefs: ['#/tables/next'],
    suspectReasons: ['multi_page_table_candidate'],
  };
  const scopedPageContext = {
    pageNo: 1,
    reviewAssistanceEligibility: {
      pageNo: 1,
      eligible: true,
      kind: 'archaeological_data' as const,
      score: 90,
      reasons: [],
      exclusionReasons: [],
    },
    pageSize: { width: 100, height: 100 },
    pageImagePath: '/tmp/page.png',
    textBlocks: [],
    missingTextCandidates: [],
    tables: [{ ...targetTable }],
    pictures: [],
    orphanCaptions: [],
    footnotes: [],
    layout: { readingOrderRefs: [], visualOrderRefs: [], bboxWarnings: [] },
    domainPatterns: [],
  };
  return {
    pageNo: 1,
    pageSize: { width: 100, height: 100 },
    pageImagePath: '/tmp/page.png',
    targetTable,
    tableCountOnPage: 2,
    otherTablesOnPage: [
      {
        ref: '#/tables/1',
        caption: 'Other table',
        bbox,
        gridPreview: [['OtherLongCell']],
        rowCount: 1,
        colCount: 1,
        emptyCellRatio: 0,
        suspectReasons: [],
      },
    ],
    nearbyTextBlocks: [],
    orphanCaptions: [],
    validationHints: ['multiple_tables_on_page'],
    scopedPageContext,
    ...overrides,
  };
}

function validate(output: ReviewAssistancePageOutput) {
  return new TableCorrectionValidator().validatePageOutput(
    makeContext(),
    output,
    {
      autoApplyThreshold: 0.85,
      proposalThreshold: 0.5,
      allowAutoApply: true,
    },
  );
}

describe('TableCorrectionValidator', () => {
  test('accepts target table cell updates beyond the preview when row and column counts are known', () => {
    const [decision] = validate({
      pageNo: 1,
      commands: [
        {
          op: 'updateTableCell',
          targetRef: '#/tables/0',
          payload: { row: 9, col: 1, text: '12cm' },
          confidence: 0.95,
          rationale: 'Cell OCR correction',
          evidence: '12cm',
        },
      ],
      pageNotes: [],
    });

    expect(decision.disposition).toBe('auto_applied');
    expect(decision.reasons).not.toContain('table_cell_out_of_preview_range');
    expect(decision.metadata?.tableCorrection).toMatchObject({
      targetRef: '#/tables/0',
      tableCountOnPage: 2,
    });
  });

  test('flags commands that target another same-page table or mix its content', () => {
    const [decision] = validate({
      pageNo: 1,
      commands: [
        {
          op: 'updateTableCell',
          targetRef: '#/tables/1',
          payload: {
            tableRef: '#/tables/1',
            row: 0,
            col: 0,
            text: 'OtherLongCell',
          },
          confidence: 0.95,
          rationale: 'Wrong table',
          evidence: 'OtherLongCell',
        },
      ],
      pageNotes: [],
    });

    expect(decision.disposition).toBe('skipped');
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        'target_ref_not_found',
        'table_correction_target_ref_mismatch',
        'table_correction_other_table_content_mixed',
      ]),
    );
  });

  test('flags replacement tables that drop spans, headers, units, footnotes, or fill with blanks', () => {
    const [decision] = validate({
      pageNo: 1,
      commands: [
        {
          op: 'replaceTable',
          targetRef: '#/tables/0',
          payload: {
            grid: [
              [{ text: '' }, { text: '' }],
              [{ text: '' }, { text: '' }],
            ],
          },
          confidence: 0.9,
          rationale: 'Replace broken grid',
          evidence: 'empty',
        },
      ],
      pageNotes: [],
    });

    expect(decision.disposition).toBe('skipped');
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        'table_correction_span_metadata_dropped',
        'table_correction_header_metadata_dropped',
        'table_correction_unit_hint_dropped',
        'table_correction_footnote_marker_dropped',
        'table_correction_empty_cell_explosion',
      ]),
    );
  });

  test('validates replacement table span bounds', () => {
    const [decision] = validate({
      pageNo: 1,
      commands: [
        {
          op: 'replaceTable',
          targetRef: '#/tables/0',
          payload: {
            grid: [
              [
                { text: 'Depth 10cm ※', rowSpan: 1.5, colSpan: 1 },
                {
                  text: 'A',
                  rowSpan: 2,
                  colSpan: 2,
                  columnHeader: true,
                  rowHeader: true,
                },
                { text: 'B', rowSpan: 0, colSpan: 1 },
              ],
            ],
          },
          confidence: 0.9,
          rationale: 'Span grid',
          evidence: 'span',
        },
      ],
      pageNotes: [],
    });

    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        'table_correction_invalid_span',
        'table_correction_span_out_of_bounds',
      ]),
    );
  });

  test('checks continued table direction against adjacent page refs', () => {
    const decisions = validate({
      pageNo: 1,
      commands: [
        {
          op: 'linkContinuedTable',
          targetRef: '#/tables/0',
          payload: {
            sourceTableRef: '#/tables/0',
            continuedTableRef: '#/tables/prev',
            relation: 'continues_on_next_page',
          },
          confidence: 0.9,
          rationale: 'Wrong direction',
          evidence: 'previous',
        },
        {
          op: 'linkContinuedTable',
          targetRef: '#/tables/0',
          payload: {
            sourceTableRef: '#/tables/0',
            continuedTableRef: '#/tables/next',
            relation: 'continued_from_previous_page',
          },
          confidence: 0.9,
          rationale: 'Wrong direction',
          evidence: 'next',
        },
      ],
      pageNotes: [],
    });

    expect(decisions[0].reasons).toContain(
      'table_correction_continuation_ref_not_next_page',
    );
    expect(decisions[1].reasons).toContain(
      'table_correction_continuation_ref_not_previous_page',
    );
  });

  test('flags non-table correction ops and missing target bbox on multi-table pages', () => {
    const context = makeContext({
      targetTable: {
        ...makeContext().targetTable,
        bbox: undefined,
      },
      scopedPageContext: {
        ...makeContext().scopedPageContext,
        tables: [
          { ...makeContext().scopedPageContext.tables[0], bbox: undefined },
        ],
      },
    });
    const decisions = new TableCorrectionValidator().validatePageOutput(
      context,
      {
        pageNo: 1,
        commands: [
          {
            op: 'replaceText',
            targetRef: '#/texts/0',
            payload: { text: 'A' },
            confidence: 0.9,
            rationale: 'Not a table op',
            evidence: 'A',
          },
          {
            op: 'updateTableCell',
            targetRef: '#/tables/0',
            payload: { row: 0, col: 0, text: '10cm ※' },
            confidence: 0.9,
            rationale: 'Cell correction',
            evidence: '10cm',
          },
        ],
        pageNotes: [],
      },
      {
        autoApplyThreshold: 0.85,
        proposalThreshold: 0.5,
        allowAutoApply: true,
      },
    );

    expect(decisions[0].reasons).toContain(
      'table_correction_op_not_allowed:replaceText',
    );
    expect(decisions[1].reasons).toContain(
      'table_correction_target_bbox_missing',
    );
  });

  test('keeps allowed invalid table ops as base validation failures only', () => {
    const [decision, nonTableDecision] = validate({
      pageNo: 1,
      commands: [
        {
          op: 'updateTableCell',
          targetRef: '#/tables/0',
          payload: { row: 0 },
          confidence: 0.9,
          rationale: 'Missing payload',
          evidence: 'missing',
        },
        {
          op: 'removeText',
          targetRef: null,
          payload: {},
          confidence: 0.9,
          rationale: 'Missing text ref',
          evidence: 'missing',
        },
      ],
      pageNotes: [],
    });

    expect(decision.invalidOp).toBe('updateTableCell');
    expect(decision.reasons).toContain('invalid_update_table_cell_payload');
    expect(decision.reasons).not.toContain(
      'table_correction_op_not_allowed:updateTableCell',
    );
    expect(nonTableDecision.reasons).toContain(
      'table_correction_op_not_allowed:removeText',
    );
  });

  test('detects other table content inside replacement grids', () => {
    const [decision] = validate({
      pageNo: 1,
      commands: [
        {
          op: 'replaceTable',
          targetRef: '#/tables/0',
          payload: {
            grid: [
              [
                {
                  text: 'OtherLongCell 10cm ※',
                  rowSpan: 1,
                  colSpan: 1,
                  columnHeader: true,
                },
                { text: 'A', rowSpan: 1, colSpan: 1 },
              ],
            ],
          },
          confidence: 0.9,
          rationale: 'Mixed table',
          evidence: 'OtherLongCell',
        },
      ],
      pageNotes: [],
    });

    expect(decision.reasons).toContain(
      'table_correction_other_table_content_mixed',
    );
  });

  test('falls back to grid preview width when table column counts are absent', () => {
    const base = makeContext();
    const context = makeContext({
      targetTable: {
        ...base.targetTable,
        rowCount: 2,
        colCount: undefined,
        hasSpans: false,
        headerRows: [],
        unitHints: [],
        footnoteMarkers: [],
      },
      scopedPageContext: {
        ...base.scopedPageContext,
        tables: [
          {
            ...base.scopedPageContext.tables[0],
            rowCount: 2,
            colCount: undefined,
            hasSpans: false,
            headerRows: [],
            unitHints: [],
            footnoteMarkers: [],
          },
        ],
      },
    });
    const [decision] = new TableCorrectionValidator().validatePageOutput(
      context,
      {
        pageNo: 1,
        commands: [
          {
            op: 'updateTableCell',
            targetRef: '#/tables/0',
            payload: { row: 0, col: 1, text: 'Depth' },
            confidence: 0.95,
            rationale: 'Preview width',
            evidence: 'Depth',
          },
          {
            op: 'updateTableCell',
            targetRef: '#/tables/0',
            payload: { row: 1, col: 1, text: 'Depth' },
            confidence: 0.95,
            rationale: 'Preview width',
            evidence: 'Depth',
          },
        ],
        pageNotes: [],
      },
      {
        autoApplyThreshold: 0.85,
        proposalThreshold: 0.5,
        allowAutoApply: true,
      },
    );

    expect(decision.reasons).not.toContain('table_cell_out_of_preview_range');
  });

  test('covers empty replacement grids and missing continuation neighbors', () => {
    const base = makeContext();
    const context = makeContext({
      targetTable: {
        ...base.targetTable,
        hasSpans: false,
        headerRows: [],
        unitHints: undefined,
        footnoteMarkers: undefined,
        previousPageTableRefs: undefined,
        nextPageTableRefs: undefined,
      },
      scopedPageContext: {
        ...base.scopedPageContext,
        tables: [
          {
            ...base.scopedPageContext.tables[0],
            hasSpans: false,
            headerRows: [],
            unitHints: undefined,
            footnoteMarkers: undefined,
            previousPageTableRefs: undefined,
            nextPageTableRefs: undefined,
          },
        ],
      },
    });
    const decisions = new TableCorrectionValidator().validatePageOutput(
      context,
      {
        pageNo: 1,
        commands: [
          {
            op: 'replaceTable',
            targetRef: '#/tables/0',
            payload: { grid: [[]] },
            confidence: 0.9,
            rationale: 'Empty row',
            evidence: 'empty',
          },
          {
            op: 'linkContinuedTable',
            targetRef: '#/tables/0',
            payload: {
              sourceTableRef: '#/tables/0',
              continuedTableRef: '#/tables/missing',
              relation: 'continues_on_next_page',
            },
            confidence: 0.9,
            rationale: 'Missing neighbor',
            evidence: 'missing',
          },
        ],
        pageNotes: [],
      },
      {
        autoApplyThreshold: 0.85,
        proposalThreshold: 0.5,
        allowAutoApply: true,
      },
    );

    expect(decisions[0].reasons).toContain('table_grid_not_rectangular');
    expect(decisions[1].reasons).toEqual(
      expect.arrayContaining([
        'table_ref_not_found',
        'table_correction_continuation_ref_not_next_page',
      ]),
    );
  });

  test('covers defensive validator fallbacks that are unreachable through valid schema payloads', () => {
    const tableValidator = new TableCorrectionValidator() as any;
    const spanReasons: string[] = [];
    tableValidator.validateSpans([], spanReasons);
    expect(spanReasons).toEqual([]);

    const pageContext = makeContext().scopedPageContext;
    pageContext.tables[0] = {
      ...pageContext.tables[0],
      rowCount: 2,
      colCount: undefined,
      gridPreview: [['A', 'B']],
    };
    const cellReasons: string[] = [];
    (new ReviewAssistanceValidator() as any).validateTableCell(
      pageContext,
      '#/tables/0',
      1,
      1,
      cellReasons,
    );
    expect(cellReasons).toEqual([]);

    pageContext.tables[0] = {
      ...pageContext.tables[0],
      rowCount: 1,
      colCount: undefined,
      gridPreview: [],
    };
    const emptyPreviewReasons: string[] = [];
    (new ReviewAssistanceValidator() as any).validateTableCell(
      pageContext,
      '#/tables/0',
      0,
      0,
      emptyPreviewReasons,
    );
    expect(emptyPreviewReasons).toEqual(['table_cell_out_of_preview_range']);
  });
});
