import type { TableCorrectionContext } from '../processors/review-assistance/table-correction-context-builder';

import { describe, expect, test } from 'vitest';

import {
  TABLE_CORRECTION_SYSTEM_PROMPT,
  buildTableCorrectionPrompt,
} from './table-correction-prompt';

const bbox = { l: 0, t: 0, r: 10, b: 10, coord_origin: 'TOPLEFT' as const };

function makeContext(): TableCorrectionContext {
  return {
    pageNo: 1,
    pageSize: { width: 100, height: 100 },
    pageImagePath: '/tmp/page.png',
    targetTable: {
      ref: '#/tables/0',
      caption: 'Table 1',
      bbox,
      gridPreview: [['Layer', 'Depth 10cm']],
      rowCount: 2,
      colCount: 2,
      hasSpans: true,
      headerRows: [0],
      headerColumns: [],
      unitHints: ['10cm'],
      footnoteRefs: [],
      footnoteMarkers: ['※'],
      emptyCellRatio: 0,
      previousPageTableRefs: ['#/tables/prev'],
      previousPageTableSummary:
        'Previous page table keeps Layer and Depth columns',
      nextPageTableRefs: ['#/tables/next'],
      nextPageTableSummary: 'Next page table continues Layer and Depth columns',
      suspectReasons: ['multi_page_table_candidate'],
    },
    tableCountOnPage: 2,
    otherTablesOnPage: [
      {
        ref: '#/tables/1',
        caption: 'Table 2',
        bbox,
        gridPreview: [['Other']],
        rowCount: 1,
        colCount: 1,
        emptyCellRatio: 0,
        suspectReasons: [],
      },
    ],
    nearbyTextBlocks: [
      {
        ref: '#/texts/0',
        label: 'caption',
        text: 'Table 1',
        bbox,
        suspectReasons: ['caption_like_body_text'],
      },
    ],
    orphanCaptions: [],
    validationHints: ['multiple_tables_on_page', 'span_cells_present'],
    scopedPageContext: {
      pageNo: 1,
      reviewAssistanceEligibility: {
        pageNo: 1,
        eligible: true,
        kind: 'archaeological_data',
        score: 90,
        reasons: [],
        exclusionReasons: [],
      },
      pageSize: { width: 100, height: 100 },
      pageImagePath: '/tmp/page.png',
      textBlocks: [],
      missingTextCandidates: [],
      tables: [],
      pictures: [],
      orphanCaptions: [],
      footnotes: [],
      layout: { readingOrderRefs: [], visualOrderRefs: [], bboxWarnings: [] },
      domainPatterns: [],
    },
  };
}

describe('table correction prompt', () => {
  test('describes target-table-only correction rules', () => {
    expect(TABLE_CORRECTION_SYSTEM_PROMPT).toContain('Use only the target table');
    expect(TABLE_CORRECTION_SYSTEM_PROMPT).toContain(
      'Preserve the table structure',
    );
  });

  test('teaches the { grid, caption } structured-output shape', () => {
    // The table task uses the dedicated grid schema (mirroring the backoffice
    // AI table-correction feature), so the prompt describes a bare
    // { grid, caption } reply — no command/payload wrapper.
    expect(TABLE_CORRECTION_SYSTEM_PROMPT).toContain('"grid"');
    expect(TABLE_CORRECTION_SYSTEM_PROMPT).toContain('"caption"');
    expect(TABLE_CORRECTION_SYSTEM_PROMPT).toContain('rowSpan');
    expect(TABLE_CORRECTION_SYSTEM_PROMPT).not.toContain('payload');
  });

  test('builds prompt with the current grid, caption, language, and feedback', () => {
    const prompt = buildTableCorrectionPrompt(makeContext(), {
      outputLanguage: 'Korean',
      validationFeedback: ['table_correction_target_ref_mismatch'],
      attempt: 2,
    });

    expect(prompt).toContain('OUTPUT LANGUAGE');
    expect(prompt).toContain('Korean');
    expect(prompt).toContain('VALIDATION FEEDBACK FOR ATTEMPT 2');
    expect(prompt).toContain('table_correction_target_ref_mismatch');
    // The fixture has only a gridPreview (no fullGrid) → the preview branch.
    expect(prompt).toContain('Current table preview');
    expect(prompt).toContain('Depth 10cm');
    expect(prompt).toContain('Current caption: Table 1');
  });

  test('omits optional language and feedback sections', () => {
    const prompt = buildTableCorrectionPrompt(makeContext());

    expect(prompt).not.toContain('OUTPUT LANGUAGE');
    expect(prompt).not.toContain('VALIDATION FEEDBACK');
  });

  test('uses the default feedback attempt number', () => {
    const prompt = buildTableCorrectionPrompt(makeContext(), {
      validationFeedback: ['table_correction_empty_cell_explosion'],
    });

    expect(prompt).toContain('VALIDATION FEEDBACK FOR ATTEMPT 2');
  });
});
