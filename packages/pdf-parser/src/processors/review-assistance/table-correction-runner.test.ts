// @ts-nocheck
// Loose fixtures (partial PageReviewContext / model replies); full typing is a
// separate cleanup. These exercise the backoffice-style { grid, caption } table
// path: the model returns a corrected grid, the runner wraps it into a single
// replaceTable and reconciles structure against the source grid.
import type { PageReviewContext } from './page-review-context-builder';
import type { ReviewAssistanceWorkItem } from './review-assistance-work-scheduler';

import { describe, expect, test } from 'vitest';

import { TableCorrectionRunner } from './table-correction-runner';

const bbox = { l: 0, t: 0, r: 10, b: 10, coord_origin: 'TOPLEFT' as const };

const VALIDATOR_OPTIONS = {
  autoApplyThreshold: 0.85,
  proposalThreshold: 0.5,
  allowAutoApply: true,
};

function makeContext(): PageReviewContext {
  return {
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
    tables: [
      {
        ref: '#/tables/0',
        bbox,
        gridPreview: [['Layer', 'Depth 10cm']],
        rowCount: 2,
        colCount: 2,
        emptyCellRatio: 0,
        suspectReasons: [],
      },
    ],
    pictures: [],
    orphanCaptions: [],
    footnotes: [],
    layout: {
      readingOrderRefs: ['#/tables/0'],
      visualOrderRefs: [],
      bboxWarnings: [],
    },
    domainPatterns: [],
  };
}

function makeWorkItem(): ReviewAssistanceWorkItem {
  const context = makeContext();
  return {
    id: 'page-1:table:_tables_0',
    kind: 'table',
    pageNo: 1,
    targetRefs: ['#/tables/0'],
    priority: 'normal',
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

// A small table with a header row and a colSpan=2 master (so the (0,2) shadow
// placeholder + span/header carry-over are exercised).
function makeFullGridContext(): PageReviewContext {
  const context = makeContext();
  return {
    ...context,
    tables: [
      {
        ref: '#/tables/0',
        bbox,
        gridPreview: [
          ['구분', '제원(cm)', ''],
          ['토기', '10', '20'],
        ],
        fullGrid: [
          [
            { text: '구분', rowSpan: 1, colSpan: 1, columnHeader: true, rowHeader: false },
            { text: '제원(cm)', rowSpan: 1, colSpan: 2, columnHeader: true, rowHeader: false },
            { text: '', rowSpan: 1, colSpan: 1, columnHeader: false, rowHeader: false },
          ],
          [
            { text: '토기', rowSpan: 1, colSpan: 1, columnHeader: false, rowHeader: false },
            { text: '10', rowSpan: 1, colSpan: 1, columnHeader: false, rowHeader: false },
            { text: '20', rowSpan: 1, colSpan: 1, columnHeader: false, rowHeader: false },
          ],
        ],
        rowCount: 2,
        colCount: 3,
        hasSpans: true,
        headerRows: [0],
        emptyCellRatio: 0,
        suspectReasons: [],
      },
    ],
  };
}

describe('TableCorrectionRunner', () => {
  test('wraps a { grid, caption } reply into one replaceTable proposal with carried-over structure', () => {
    const runner = new TableCorrectionRunner();
    const tableContext = runner.buildContext(
      makeFullGridContext(),
      makeWorkItem(),
    );
    // The model returns text-only cells; carry-over re-derives spans/headers
    // from the source grid and only the corrected text (10 → 12) survives.
    const decisions = runner.validateGridOutput(
      tableContext,
      {
        grid: [
          [{ text: '구분' }, { text: '제원(cm)' }, { text: '' }],
          [{ text: '토기' }, { text: '12' }, { text: '20' }],
        ],
        caption: '표 1',
      },
      VALIDATOR_OPTIONS,
    );

    expect(decisions).toHaveLength(1);
    const [decision] = decisions;
    expect(decision.command.op).toBe('replaceTable');
    expect(decision.command.tableRef).toBe('#/tables/0');
    expect(decision.command.caption).toBe('표 1');
    expect(decision.command.grid[1][1].text).toBe('12');
    expect(decision.command.grid[0][1].colSpan).toBe(2);
    expect(decision.command.grid[0][1].columnHeader).toBe(true);
    expect(decision.disposition).toBe('proposal');
    expect(decision.reasons).toContain(
      'structural_command_requires_manual_review',
    );
  });

  test('skips a reply that echoes the current grid unchanged', () => {
    const runner = new TableCorrectionRunner();
    const tableContext = runner.buildContext(
      makeFullGridContext(),
      makeWorkItem(),
    );
    const decisions = runner.validateGridOutput(
      tableContext,
      {
        grid: [
          [{ text: '구분' }, { text: '제원(cm)' }, { text: '' }],
          [{ text: '토기' }, { text: '10' }, { text: '20' }],
        ],
        caption: null,
      },
      VALIDATOR_OPTIONS,
    );

    expect(decisions[0].disposition).toBe('skipped');
    expect(decisions[0].reasons).toContain('table_correction_noop');
  });

  test('table prompt carries the current grid JSON and re-ask feedback', () => {
    const runner = new TableCorrectionRunner();
    const tableContext = runner.buildContext(
      makeFullGridContext(),
      makeWorkItem(),
    );
    const prompt = runner.buildPrompt(tableContext, {
      outputLanguage: 'Korean',
      validationFeedback: ['table_correction_unit_hint_dropped'],
      attempt: 2,
    });

    expect(prompt).toContain('Current table data');
    expect(prompt).toContain('제원(cm)');
    expect(prompt).toContain('VALIDATION FEEDBACK FOR ATTEMPT 2');
    expect(prompt).toContain('table_correction_unit_hint_dropped');
  });
});
