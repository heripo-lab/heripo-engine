// @ts-nocheck
// See review-assistance-validator.test.ts: mock command literals here use the
// legacy raw-command shape. Phase 1.6 will rewrite them against the new
// discriminated-union schema.
import type { PageReviewContext } from './page-review-context-builder';
import type { ReviewAssistanceWorkItem } from './review-assistance-work-scheduler';

import { describe, expect, test } from 'vitest';

import { TableCorrectionRunner } from './table-correction-runner';

const bbox = { l: 0, t: 0, r: 10, b: 10, coord_origin: 'TOPLEFT' as const };

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

// A small table with a header row and a colSpan=2 master so the fold exercises
// shadow handling (the (0,2) placeholder) and span/header carry-over.
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

describe('TableCorrectionRunner', () => {
  test('builds context, prompt, and validates flat table output', () => {
    const runner = new TableCorrectionRunner();
    const tableContext = runner.buildContext(makeContext(), makeWorkItem());
    const prompt = runner.buildPrompt(tableContext, {
      outputLanguage: 'Korean',
      validationFeedback: ['table_correction_unit_hint_dropped'],
      attempt: 2,
    });
    const [decision] = runner.validateOutput(
      tableContext,
      {
        pageNo: 1,
        commands: [
          {
            op: 'updateTableCell',
            tableRef: '#/tables/0',
            row: 0,
            col: 1,
            text: 'Depth 12cm',
            confidence: 0.95,
            rationale: 'Cell OCR correction',
            evidence: '12cm',
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

    expect(tableContext.targetTable.ref).toBe('#/tables/0');
    expect(prompt).toContain('table_correction_unit_hint_dropped');
    // Table cell edits mirror the backoffice AI table-correction feature:
    // they are always routed to human review (proposal), never auto-applied,
    // even at high confidence.
    expect(decision.disposition).toBe('proposal');
    expect(decision.reasons).toContain(
      'table_correction_requires_manual_review',
    );
    expect(decision.command).toMatchObject({
      op: 'updateTableCell',
      tableRef: '#/tables/0',
      row: 0,
      col: 1,
      text: 'Depth 12cm',
    });
  });

  test('binds an omitted tableRef back to the target table', () => {
    const runner = new TableCorrectionRunner();
    const tableContext = runner.buildContext(makeContext(), makeWorkItem());
    // The flat schema makes tableRef optional; the model frequently omits it
    // (→ '' after the transform). The single-target work item must still
    // resolve to context.targetTable.ref instead of failing on an empty ref.
    const [decision] = runner.validateOutput(
      tableContext,
      {
        pageNo: 1,
        commands: [
          {
            op: 'updateTableCell',
            tableRef: '',
            row: 0,
            col: 1,
            text: 'Depth 12cm',
            confidence: 0.95,
            rationale: 'Cell OCR correction',
            evidence: '12cm',
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

    expect(decision.reasons).not.toContain(
      'table_correction_target_ref_mismatch',
    );
    expect(decision.reasons).not.toContain('target_ref_not_found');
    expect(decision.command).toMatchObject({
      op: 'updateTableCell',
      tableRef: '#/tables/0',
    });
  });

  test('folds sparse cell edits onto the authoritative grid as one replaceTable', () => {
    const runner = new TableCorrectionRunner();
    const tableContext = runner.buildContext(
      makeFullGridContext(),
      makeWorkItem(),
    );
    // Weak models emit sparse { row, col, text } edits; the runner folds them
    // onto the original grid and emits a single replaceTable so structure is
    // preserved by construction. The out-of-range edit must be dropped (not
    // clamped onto a valid cell) and the wrong top-level pageNo clamped.
    const decisions = runner.validateOutput(
      tableContext,
      {
        pageNo: 7,
        commands: [
          {
            op: 'updateTableCell',
            tableRef: '#/tables/0',
            row: 1,
            col: 1,
            text: '12',
            confidence: 0.95,
            rationale: 'depth fix',
            evidence: '12',
          },
          {
            op: 'updateTableCell',
            tableRef: '#/tables/0',
            row: 9,
            col: 9,
            text: 'X',
            confidence: 0.4,
            rationale: 'out of range',
            evidence: null,
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

    expect(decisions).toHaveLength(1);
    const [decision] = decisions;
    expect(decision.command.op).toBe('replaceTable');
    expect(decision.command.tableRef).toBe('#/tables/0');
    expect(decision.command.grid[1][1].text).toBe('12');
    expect(decision.command.grid[0][0].text).toBe('구분');
    expect(decision.command.grid[0][1].colSpan).toBe(2);
    expect(decision.command.grid[0][1].columnHeader).toBe(true);
    expect(decision.reasons).not.toContain('page_number_mismatch');
    expect(decision.disposition).toBe('proposal');
    expect(decision.reasons).toContain(
      'structural_command_requires_manual_review',
    );
  });

  test('drops sparse cell edits when every coordinate is out of bounds', () => {
    const runner = new TableCorrectionRunner();
    const tableContext = runner.buildContext(
      makeFullGridContext(),
      makeWorkItem(),
    );
    const decisions = runner.validateOutput(
      tableContext,
      {
        pageNo: 1,
        commands: [
          {
            op: 'updateTableCell',
            tableRef: '#/tables/0',
            row: 5,
            col: 0,
            text: 'A',
            confidence: 0.9,
            rationale: 'out of range',
            evidence: null,
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

    expect(decisions).toHaveLength(0);
  });
});
