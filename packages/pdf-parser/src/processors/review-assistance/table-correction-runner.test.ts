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
            {
              text: '구분',
              rowSpan: 1,
              colSpan: 1,
              columnHeader: true,
              rowHeader: false,
            },
            {
              text: '제원(cm)',
              rowSpan: 1,
              colSpan: 2,
              columnHeader: true,
              rowHeader: false,
            },
            {
              text: '',
              rowSpan: 1,
              colSpan: 1,
              columnHeader: false,
              rowHeader: false,
            },
          ],
          [
            {
              text: '토기',
              rowSpan: 1,
              colSpan: 1,
              columnHeader: false,
              rowHeader: false,
            },
            {
              text: '10',
              rowSpan: 1,
              colSpan: 1,
              columnHeader: false,
              rowHeader: false,
            },
            {
              text: '20',
              rowSpan: 1,
              colSpan: 1,
              columnHeader: false,
              rowHeader: false,
            },
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

// fullGrid with a rowSpan=2 master (so (1,0) is a shadow), a footnote marker,
// and a unit-bearing cell — exercises shadow detection + marker/unit restore.
function makeMarkerGridContext(): PageReviewContext {
  const context = makeContext();
  return {
    ...context,
    tables: [
      {
        ref: '#/tables/0',
        bbox,
        gridPreview: [
          ['헤더※', '10cm'],
          ['', '값'],
        ],
        fullGrid: [
          [
            {
              text: '헤더※',
              rowSpan: 2,
              colSpan: 1,
              columnHeader: true,
              rowHeader: false,
            },
            {
              text: '10cm',
              rowSpan: 1,
              colSpan: 1,
              columnHeader: true,
              rowHeader: false,
            },
          ],
          [
            {
              text: '',
              rowSpan: 1,
              colSpan: 1,
              columnHeader: false,
              rowHeader: false,
            },
            {
              text: '값',
              rowSpan: 1,
              colSpan: 1,
              columnHeader: false,
              rowHeader: false,
            },
          ],
        ],
        rowCount: 2,
        colCount: 2,
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

  test('forceAutoApply lands a valid table correction without manual review', () => {
    const runner = new TableCorrectionRunner();
    const tableContext = runner.buildContext(
      makeFullGridContext(),
      makeWorkItem(),
    );
    // Same corrected grid as the proposal case (10 → 12), but the demo opted
    // into force-apply, so the structural replaceTable auto-applies instead of
    // routing to manual review.
    const decisions = runner.validateGridOutput(
      tableContext,
      {
        grid: [
          [{ text: '구분' }, { text: '제원(cm)' }, { text: '' }],
          [{ text: '토기' }, { text: '12' }, { text: '20' }],
        ],
        caption: '표 1',
      },
      { ...VALIDATOR_OPTIONS, forceAutoApply: true },
    );

    expect(decisions).toHaveLength(1);
    const [decision] = decisions;
    expect(decision.command.op).toBe('replaceTable');
    expect(decision.command.grid[1][1].text).toBe('12');
    expect(decision.disposition).toBe('auto_applied');
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

  test('carryOverTableStructure reconciles structure, restores markers, and guards edge cases', () => {
    const runner = new TableCorrectionRunner();
    const meta = { confidence: 0.95, rationale: '', evidence: null };
    const cell = (text) => ({
      text,
      bbox: null,
      rowSpan: null,
      colSpan: null,
      columnHeader: null,
      rowHeader: null,
    });

    // No fullGrid (oversized/unknown table) → output returned unchanged.
    const noGridContext = runner.buildContext(makeContext(), makeWorkItem());
    const passthrough = {
      pageNo: 1,
      commands: [
        {
          op: 'replaceTable',
          tableRef: '#/tables/0',
          grid: [[cell('x')]],
          caption: null,
          ...meta,
        },
      ],
      pageNotes: [],
    };
    expect(runner.carryOverTableStructure(noGridContext, passthrough)).toBe(
      passthrough,
    );

    const context = runner.buildContext(
      makeMarkerGridContext(),
      makeWorkItem(),
    );

    // Non-replaceTable commands pass through untouched (defensive op guard).
    const nonTable = {
      pageNo: 1,
      commands: [{ op: 'removeText', textRef: '#/texts/0', ...meta }],
      pageNotes: [],
    };
    expect(
      runner.carryOverTableStructure(context, nonTable).commands[0].op,
    ).toBe('removeText');

    // A different-dimension grid is left as-is for the reviewer.
    const diffDims = {
      pageNo: 1,
      commands: [
        {
          op: 'replaceTable',
          tableRef: '#/tables/0',
          grid: [[cell('only')]],
          caption: null,
          ...meta,
        },
      ],
      pageNotes: [],
    };
    expect(
      runner.carryOverTableStructure(context, diffDims).commands[0].grid,
    ).toHaveLength(1);

    // Same-dimension grid: spans/headers re-derived, shadow forced empty,
    // dropped markers/units re-attached, a missing cell text coerced to ''.
    const sameDims = {
      pageNo: 1,
      commands: [
        {
          op: 'replaceTable',
          tableRef: '#/tables/0',
          grid: [
            [{ text: '헤더' }, { text: '10' }],
            [{}, { text: '값' }],
          ],
          caption: null,
          ...meta,
        },
      ],
      pageNotes: [],
    };
    const grid = runner.carryOverTableStructure(context, sameDims).commands[0]
      .grid;
    expect(grid[0][0].text).toBe('헤더※'); // footnote marker re-attached
    expect(grid[0][0].rowSpan).toBe(2); // span carried over from source
    expect(grid[0][1].text).toContain('cm'); // unit token re-attached
    expect(grid[1][0].text).toBe(''); // shadow position forced empty
    expect(grid[1][1].text).toBe('값');

    // When the model already kept the marker/unit, nothing is re-attached.
    const kept = {
      pageNo: 1,
      commands: [
        {
          op: 'replaceTable',
          tableRef: '#/tables/0',
          grid: [
            [{ text: '헤더※' }, { text: '10cm' }],
            [{}, { text: '값' }],
          ],
          caption: null,
          ...meta,
        },
      ],
      pageNotes: [],
    };
    const keptGrid = runner.carryOverTableStructure(context, kept).commands[0]
      .grid;
    expect(keptGrid[0][0].text).toBe('헤더※');
    expect(keptGrid[0][1].text).toBe('10cm');
  });
});
