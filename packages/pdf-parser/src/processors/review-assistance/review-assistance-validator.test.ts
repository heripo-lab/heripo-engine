import type { DoclingBBox } from '@heripo/model';

import type { ReviewAssistanceRawCommand } from '../../types/review-assistance-schema';
import type { PageReviewContext } from './page-review-context-builder';

import { describe, expect, test } from 'vitest';

import { ReviewAssistanceValidator } from './review-assistance-validator';

const bbox: DoclingBBox = {
  l: 10,
  t: 10,
  r: 80,
  b: 40,
  coord_origin: 'TOPLEFT',
};

function makeContext(
  textSuspectReasons: string[] = ['ocr_noise'],
): PageReviewContext {
  return {
    pageNo: 1,
    pageSize: { width: 100, height: 100 },
    pageImagePath: '/tmp/page_0.png',
    textBlocks: [
      {
        ref: '#/texts/0',
        label: 'text',
        text: 'T e s t',
        bbox,
        suspectReasons: textSuspectReasons,
      },
      {
        ref: '#/texts/1',
        label: 'footnote',
        text: '1) Footnote',
        bbox,
        suspectReasons: ['footnote_like_body_text'],
      },
    ],
    missingTextCandidates: [],
    tables: [
      {
        ref: '#/tables/0',
        bbox,
        gridPreview: [
          ['A', 'B'],
          ['C', 'D'],
        ],
        emptyCellRatio: 0,
        suspectReasons: [],
      },
      {
        ref: '#/tables/1',
        bbox,
        gridPreview: [['A', 'B']],
        emptyCellRatio: 0,
        suspectReasons: ['multi_page_table_candidate'],
      },
    ],
    pictures: [
      {
        ref: '#/pictures/0',
        bbox,
        suspectReasons: ['image_missing_caption'],
      },
    ],
    orphanCaptions: [],
    footnotes: [],
    layout: {
      readingOrderRefs: ['#/texts/0', '#/tables/0', '#/pictures/0'],
      visualOrderRefs: ['#/texts/0', '#/tables/0', '#/pictures/0'],
      bboxWarnings: [],
    },
    domainPatterns: [],
  };
}

function validate(command: ReviewAssistanceRawCommand) {
  return validateWithContext(makeContext(), command);
}

function validateWithContext(
  context: PageReviewContext,
  command: ReviewAssistanceRawCommand,
) {
  return new ReviewAssistanceValidator().validatePageOutput(
    context,
    {
      pageNo: 1,
      commands: [command],
      pageNotes: [],
    },
    {
      autoApplyThreshold: 0.85,
      proposalThreshold: 0.5,
      allowAutoApply: false,
    },
  )[0];
}

describe('ReviewAssistanceValidator', () => {
  test('maps valid raw commands to parser commands as proposals by default', () => {
    const decision = validate({
      op: 'replaceText',
      targetRef: '#/texts/0',
      payload: { text: 'Test' },
      confidence: 0.92,
      rationale: 'OCR spacing noise',
      evidence: 'Image reads Test',
    });

    expect(decision.disposition).toBe('proposal');
    expect(decision.command).toEqual({
      op: 'replaceText',
      textRef: '#/texts/0',
      text: 'Test',
    });
    expect(decision.reasons).toContain(
      'auto_apply_deferred_until_patcher_phase',
    );
    expect(decision.evidence?.suspectReasons).toContain('ocr_noise');
  });

  test('includes image-only evidence when a command has no target suspect reasons', () => {
    const decision = validate({
      op: 'addText',
      targetRef: null,
      payload: { bbox, text: 'Visible text', label: 'text' },
      confidence: 0.92,
      rationale: 'Missing text',
      evidence: 'Visible on page image',
    });

    expect(decision.evidence).toEqual({
      imageEvidence: 'Visible on page image',
      suspectReasons: undefined,
    });
  });

  test('can mark validated commands as auto_applied when caller enables it', () => {
    const [decision] = new ReviewAssistanceValidator().validatePageOutput(
      makeContext(),
      {
        pageNo: 1,
        commands: [
          {
            op: 'updateTextRole',
            targetRef: '#/texts/0',
            payload: { label: 'caption' },
            confidence: 0.9,
            rationale: 'Caption position',
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

    expect(decision.disposition).toBe('auto_applied');
  });

  test('skips commands that target unknown refs', () => {
    const decision = validate({
      op: 'replaceText',
      targetRef: '#/texts/99',
      payload: { text: 'replacement' },
      confidence: 0.9,
      rationale: 'Bad ref',
      evidence: null,
    });

    expect(decision.disposition).toBe('skipped');
    expect(decision.reasons).toContain('target_ref_not_found');
  });

  test('skips every command when model returns a mismatched page number', () => {
    const [decision] = new ReviewAssistanceValidator().validatePageOutput(
      makeContext(),
      {
        pageNo: 2,
        commands: [
          {
            op: 'replaceText',
            targetRef: '#/texts/0',
            payload: { text: 'Test' },
            confidence: 0.95,
            rationale: 'OCR spacing noise',
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

    expect(decision.disposition).toBe('skipped');
    expect(decision.reasons).toContain('page_number_mismatch');
  });

  test('skips removeText without deterministic suspect evidence', () => {
    const [decision] = new ReviewAssistanceValidator().validatePageOutput(
      makeContext([]),
      {
        pageNo: 1,
        commands: [
          {
            op: 'removeText',
            targetRef: '#/texts/0',
            payload: {},
            confidence: 0.99,
            rationale: 'Looks duplicated',
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

    expect(decision.disposition).toBe('skipped');
    expect(decision.reasons).toContain(
      'remove_text_without_deterministic_suspect_reason',
    );
  });

  test('skips malformed replacement tables', () => {
    const decision = validate({
      op: 'replaceTable',
      targetRef: '#/tables/0',
      payload: {
        grid: [[{ text: 'A' }], [{ text: 'B' }, { text: 'C' }]],
      },
      confidence: 0.95,
      rationale: 'Visible table differs',
      evidence: null,
    });

    expect(decision.disposition).toBe('skipped');
    expect(decision.reasons).toContain('table_grid_not_rectangular');
  });

  test('allows updating existing empty table cells', () => {
    const context = makeContext();
    context.tables[0].gridPreview[0][0] = '';

    const decision = validateWithContext(context, {
      op: 'updateTableCell',
      targetRef: '#/tables/0',
      payload: { row: 0, col: 0, text: 'Filled' },
      confidence: 0.9,
      rationale: 'Visible cell text',
      evidence: null,
    });

    expect(decision.disposition).toBe('proposal');
    expect(decision.reasons).not.toContain('table_cell_out_of_preview_range');
  });

  test('allows continued-table links to adjacent page table refs', () => {
    const context = makeContext();
    context.tables[0].nextPageTableRefs = ['#/tables/99'];

    const decision = validateWithContext(context, {
      op: 'linkContinuedTable',
      targetRef: '#/tables/0',
      payload: {
        continuedTableRef: '#/tables/99',
        relation: 'continues_on_next_page',
      },
      confidence: 0.95,
      rationale: 'Compatible adjacent table',
      evidence: null,
    });

    expect(decision.disposition).toBe('proposal');
    expect(decision.reasons).not.toContain('table_ref_not_found');
  });

  test('requires continued-table source ref to belong to the current page', () => {
    const context = makeContext();
    context.tables = [
      {
        ref: '#/tables/0',
        bbox,
        gridPreview: [['A', 'B']],
        emptyCellRatio: 0,
        nextPageTableRefs: ['#/tables/99'],
        suspectReasons: ['multi_page_table_candidate'],
      },
    ];

    const decision = validateWithContext(context, {
      op: 'linkContinuedTable',
      targetRef: '#/tables/99',
      payload: {
        continuedTableRef: '#/tables/0',
        relation: 'continued_from_previous_page',
      },
      confidence: 0.95,
      rationale: 'Wrong source ref',
      evidence: null,
    });

    expect(decision.disposition).toBe('skipped');
    expect(decision.reasons).toContain('target_ref_not_found');
    expect(decision.reasons).toContain('table_ref_not_found');
  });

  test('maps every supported command operation', () => {
    const commands: ReviewAssistanceRawCommand[] = [
      {
        op: 'addText',
        targetRef: null,
        payload: {
          bbox,
          text: 'Missing text',
          label: 'text',
          afterRef: '#/texts/0',
        },
        confidence: 0.9,
        rationale: 'Visible missing text',
        evidence: null,
      },
      {
        op: 'updateTextRole',
        targetRef: '#/texts/0',
        payload: { label: 'caption' },
        confidence: 0.9,
        rationale: 'Role mismatch',
        evidence: null,
      },
      {
        op: 'removeText',
        targetRef: '#/texts/0',
        payload: {},
        confidence: 0.99,
        rationale: 'Deterministic noise',
        evidence: null,
      },
      {
        op: 'mergeTexts',
        targetRef: '#/texts/0',
        payload: {
          textRefs: ['#/texts/0', '#/texts/1'],
          text: 'Merged',
          keepRef: '#/texts/0',
        },
        confidence: 0.95,
        rationale: 'Adjacent fragments',
        evidence: null,
      },
      {
        op: 'splitText',
        targetRef: '#/texts/0',
        payload: {
          parts: [{ text: 'T e' }, { text: 's t', label: 'text' }],
        },
        confidence: 0.95,
        rationale: 'Merged fragments',
        evidence: null,
      },
      {
        op: 'updateTableCell',
        targetRef: '#/tables/0',
        payload: { row: 0, col: 0, text: 'AA' },
        confidence: 0.9,
        rationale: 'Cell OCR',
        evidence: null,
      },
      {
        op: 'replaceTable',
        targetRef: '#/tables/0',
        payload: { grid: [[{ text: 'A' }]], caption: 'Table 1' },
        confidence: 0.95,
        rationale: 'Table OCR',
        evidence: null,
      },
      {
        op: 'linkContinuedTable',
        targetRef: '#/tables/0',
        payload: {
          continuedTableRef: '#/tables/1',
          relation: 'continues_on_next_page',
        },
        confidence: 0.95,
        rationale: 'Continued table',
        evidence: null,
      },
      {
        op: 'updatePictureCaption',
        targetRef: '#/pictures/0',
        payload: { caption: 'Figure 1' },
        confidence: 0.9,
        rationale: 'Nearby caption',
        evidence: null,
      },
      {
        op: 'addPicture',
        targetRef: null,
        payload: { bbox, imageUri: 'images/new.png', caption: 'Figure 2' },
        confidence: 0.9,
        rationale: 'Missing picture',
        evidence: null,
      },
      {
        op: 'splitPicture',
        targetRef: '#/pictures/0',
        payload: {
          regions: [
            { bbox: { ...bbox, r: 30 }, caption: 'A' },
            { bbox: { ...bbox, l: 40, r: 80 }, imageUri: 'b.png' },
          ],
        },
        confidence: 0.95,
        rationale: 'Combined picture',
        evidence: null,
      },
      {
        op: 'hidePicture',
        targetRef: '#/pictures/0',
        payload: { reason: 'duplicate' },
        confidence: 0.99,
        rationale: 'Duplicate image',
        evidence: null,
      },
      {
        op: 'updateBbox',
        targetRef: '#/texts/0',
        payload: { bbox },
        confidence: 0.95,
        rationale: 'Bbox mismatch',
        evidence: null,
      },
      {
        op: 'linkFootnote',
        targetRef: null,
        payload: { markerTextRef: '#/texts/0', footnoteTextRef: '#/texts/1' },
        confidence: 0.9,
        rationale: 'Footnote marker',
        evidence: null,
      },
      {
        op: 'moveNode',
        targetRef: '#/texts/0',
        payload: { targetRef: '#/tables/0', position: 'after' },
        confidence: 0.9,
        rationale: 'Reading order',
        evidence: null,
      },
    ];

    const decisions = commands.map(
      (command) =>
        new ReviewAssistanceValidator().validatePageOutput(
          makeContext(),
          { pageNo: 1, commands: [command], pageNotes: [] },
          {
            autoApplyThreshold: 0.85,
            proposalThreshold: 0.5,
            allowAutoApply: false,
          },
        )[0],
    );

    expect(decisions.map((decision) => decision.command.op)).toEqual(
      commands.map((command) => command.op),
    );
    expect(
      decisions.every((decision) => decision.disposition === 'proposal'),
    ).toBe(true);
  });

  test('skips malformed payloads for each command operation', () => {
    const commands: ReviewAssistanceRawCommand[] = [
      {
        op: 'replaceText',
        targetRef: null,
        payload: {},
        confidence: 0.9,
        rationale: 'bad',
        evidence: null,
      },
      {
        op: 'addText',
        targetRef: null,
        payload: { text: 'x' },
        confidence: 0.9,
        rationale: 'bad',
        evidence: null,
      },
      {
        op: 'updateTextRole',
        targetRef: '#/texts/0',
        payload: {},
        confidence: 0.9,
        rationale: 'bad',
        evidence: null,
      },
      {
        op: 'removeText',
        targetRef: null,
        payload: {},
        confidence: 0.9,
        rationale: 'bad',
        evidence: null,
      },
      {
        op: 'mergeTexts',
        targetRef: '#/texts/0',
        payload: { textRefs: ['#/texts/0'], text: 'x' },
        confidence: 0.9,
        rationale: 'bad',
        evidence: null,
      },
      {
        op: 'splitText',
        targetRef: '#/texts/0',
        payload: { parts: [{ text: 'x' }] },
        confidence: 0.9,
        rationale: 'bad',
        evidence: null,
      },
      {
        op: 'updateTableCell',
        targetRef: '#/tables/0',
        payload: { row: 0, col: 0 },
        confidence: 0.9,
        rationale: 'bad',
        evidence: null,
      },
      {
        op: 'replaceTable',
        targetRef: '#/tables/0',
        payload: { grid: [] },
        confidence: 0.9,
        rationale: 'bad',
        evidence: null,
      },
      {
        op: 'linkContinuedTable',
        targetRef: '#/tables/0',
        payload: { continuedTableRef: '#/tables/1', relation: 'bad' },
        confidence: 0.9,
        rationale: 'bad',
        evidence: null,
      },
      {
        op: 'updatePictureCaption',
        targetRef: '#/pictures/0',
        payload: {},
        confidence: 0.9,
        rationale: 'bad',
        evidence: null,
      },
      {
        op: 'addPicture',
        targetRef: null,
        payload: { bbox: null },
        confidence: 0.9,
        rationale: 'bad',
        evidence: null,
      },
      {
        op: 'splitPicture',
        targetRef: '#/pictures/0',
        payload: { regions: [{ bbox }] },
        confidence: 0.9,
        rationale: 'bad',
        evidence: null,
      },
      {
        op: 'hidePicture',
        targetRef: '#/pictures/0',
        payload: {},
        confidence: 0.9,
        rationale: 'bad',
        evidence: null,
      },
      {
        op: 'updateBbox',
        targetRef: '#/texts/0',
        payload: {},
        confidence: 0.9,
        rationale: 'bad',
        evidence: null,
      },
      {
        op: 'linkFootnote',
        targetRef: null,
        payload: { markerTextRef: '#/texts/0' },
        confidence: 0.9,
        rationale: 'bad',
        evidence: null,
      },
      {
        op: 'moveNode',
        targetRef: '#/texts/0',
        payload: { targetRef: '#/tables/0', position: 'inside' },
        confidence: 0.9,
        rationale: 'bad',
        evidence: null,
      },
    ];

    const decisions = new ReviewAssistanceValidator().validatePageOutput(
      makeContext(),
      { pageNo: 1, commands, pageNotes: [] },
      {
        autoApplyThreshold: 0.85,
        proposalThreshold: 0.5,
        allowAutoApply: true,
      },
    );

    expect(
      decisions.every((decision) => decision.disposition === 'skipped'),
    ).toBe(true);
    expect(
      decisions.every((decision) => decision.command.op === 'addText'),
    ).toBe(true);
  });

  test('reports validation failures for risky command shapes', () => {
    const longTextContext = makeContext(['ocr_noise']);
    longTextContext.textBlocks[0].text =
      'This is a long text block that must not be deleted';
    const invalidBbox = {
      l: 90,
      t: Number.NaN,
      r: 10,
      b: 10,
      coord_origin: 'TOPLEFT',
    };
    const commands: ReviewAssistanceRawCommand[] = [
      {
        op: 'replaceText',
        targetRef: '#/texts/0',
        payload: { text: 'x' },
        confidence: 0.99,
        rationale: 'too short',
        evidence: null,
      },
      {
        op: 'addText',
        targetRef: null,
        payload: { pageNo: 2, bbox: invalidBbox, text: 'x', label: 'text' },
        confidence: 0.99,
        rationale: 'bad bbox',
        evidence: null,
      },
      {
        op: 'splitText',
        targetRef: '#/texts/0',
        payload: { parts: [{ text: 'x' }, { text: 'y' }] },
        confidence: 0.99,
        rationale: 'bad split',
        evidence: null,
      },
      {
        op: 'addPicture',
        targetRef: null,
        payload: {
          bbox: { l: -1, t: 0, r: 20, b: 20, coord_origin: 'TOPLEFT' },
        },
        confidence: 0.99,
        rationale: 'outside bbox',
        evidence: null,
      },
      {
        op: 'updateTableCell',
        targetRef: '#/tables/0',
        payload: { row: -1, col: 0, text: 'x' },
        confidence: 0.99,
        rationale: 'bad cell',
        evidence: null,
      },
      {
        op: 'updateTableCell',
        targetRef: '#/tables/0',
        payload: { row: 9, col: 9, text: 'x' },
        confidence: 0.99,
        rationale: 'bad cell',
        evidence: null,
      },
      {
        op: 'updatePictureCaption',
        targetRef: '#/pictures/0',
        payload: { caption: '' },
        confidence: 0.99,
        rationale: 'empty caption',
        evidence: null,
      },
      {
        op: 'updatePictureCaption',
        targetRef: '#/pictures/0',
        payload: { caption: 'x'.repeat(241) },
        confidence: 0.99,
        rationale: 'long caption',
        evidence: null,
      },
      {
        op: 'splitPicture',
        targetRef: '#/pictures/0',
        payload: { regions: [{ bbox }, { bbox }] },
        confidence: 0.99,
        rationale: 'overlap',
        evidence: null,
      },
      {
        op: 'updateBbox',
        targetRef: '#/missing/0',
        payload: { bbox },
        confidence: 0.99,
        rationale: 'bad target',
        evidence: null,
      },
      {
        op: 'linkFootnote',
        targetRef: null,
        payload: { markerTextRef: '#/texts/99', footnoteTextRef: '#/texts/98' },
        confidence: 0.99,
        rationale: 'bad refs',
        evidence: null,
      },
      {
        op: 'moveNode',
        targetRef: '#/texts/99',
        payload: { targetRef: '#/texts/99', position: 'before' },
        confidence: 0.99,
        rationale: 'bad move',
        evidence: null,
      },
    ];

    const decisions = new ReviewAssistanceValidator().validatePageOutput(
      longTextContext,
      { pageNo: 1, commands, pageNotes: [] },
      {
        autoApplyThreshold: 0.85,
        proposalThreshold: 0.5,
        allowAutoApply: true,
      },
    );
    const reasons = decisions.flatMap((decision) => decision.reasons);

    expect(reasons).toContain('replacement_deletes_too_much_text');
    expect(reasons).toContain('page_number_mismatch');
    expect(reasons).toContain('bbox_non_finite');
    expect(reasons).toContain('bbox_outside_page');
    expect(reasons).toContain('split_text_parts_do_not_match_original_length');
    expect(reasons).toContain('table_cell_negative_index');
    expect(reasons).toContain('table_cell_out_of_preview_range');
    expect(reasons).toContain('caption_empty');
    expect(reasons).toContain('caption_too_long');
    expect(reasons).toContain('split_picture_regions_overlap');
    expect(reasons).toContain('bbox_target_ref_not_found');
    expect(reasons).toContain('text_ref_not_found');
    expect(reasons).toContain('move_source_ref_not_found');
    expect(reasons).toContain('move_self_reference');
  });

  test('skips low confidence commands even when valid', () => {
    const decision = validate({
      op: 'updateTextRole',
      targetRef: '#/texts/0',
      payload: { label: 'caption' },
      confidence: 0.1,
      rationale: 'Weak evidence',
      evidence: null,
    });

    expect(decision.disposition).toBe('skipped');
  });

  test('detects command conflicts and additional ref/bbox edge cases', () => {
    const noPageSize = makeContext();
    noPageSize.pageSize = null;
    const commands: ReviewAssistanceRawCommand[] = [
      {
        op: 'updateTextRole',
        targetRef: '#/texts/0',
        payload: { label: 'caption' },
        confidence: 0.9,
        rationale: 'first',
        evidence: null,
      },
      {
        op: 'replaceText',
        targetRef: '#/texts/0',
        payload: { text: 'Test' },
        confidence: 0.9,
        rationale: 'second',
        evidence: null,
      },
      {
        op: 'linkContinuedTable',
        targetRef: '#/tables/0',
        payload: {
          continuedTableRef: '#/tables/99',
          relation: 'continued_from_previous_page',
        },
        confidence: 0.9,
        rationale: 'bad table',
        evidence: null,
      },
      {
        op: 'addText',
        targetRef: null,
        payload: {
          bbox: { l: 90, t: 90, r: 10, b: 10, coord_origin: 'TOPLEFT' },
          text: 'bad bbox',
          label: 'text',
        },
        confidence: 0.9,
        rationale: 'bad bbox',
        evidence: null,
      },
      {
        op: 'addText',
        targetRef: null,
        payload: {
          bbox: { l: 0, t: 10, r: 20, b: 30, coord_origin: 'BOTTOMLEFT' },
          text: 'bottom left',
          label: 'text',
        },
        confidence: 0.9,
        rationale: 'bottom left',
        evidence: null,
      },
      {
        op: 'replaceTable',
        targetRef: '#/tables/0',
        payload: { grid: [[]] },
        confidence: 0.9,
        rationale: 'empty row',
        evidence: null,
      },
      {
        op: 'splitPicture',
        targetRef: '#/pictures/0',
        payload: {
          regions: [
            { bbox: { l: 10, t: 10, r: 10, b: 10, coord_origin: 'TOPLEFT' } },
            { bbox: { l: 10, t: 10, r: 10, b: 10, coord_origin: 'TOPLEFT' } },
          ],
        },
        confidence: 0.9,
        rationale: 'zero area',
        evidence: null,
      },
    ];

    const decisions = new ReviewAssistanceValidator().validatePageOutput(
      noPageSize,
      { pageNo: 1, commands, pageNotes: [] },
      {
        autoApplyThreshold: 0.85,
        proposalThreshold: 0.5,
        allowAutoApply: false,
      },
    );
    const reasons = decisions.flatMap((decision) => decision.reasons);

    expect(reasons).toContain('target_already_modified');
    expect(reasons).toContain('table_ref_not_found');
    expect(reasons).toContain('bbox_invalid_horizontal_order');
    expect(reasons).toContain('bbox_invalid_vertical_order');
    expect(reasons).toContain('table_grid_not_rectangular');
  });

  test('covers defensive validation branches for normalized internal payloads', () => {
    const validator = new ReviewAssistanceValidator() as unknown as {
      validateSplitRegions: (
        regions: Array<{ bbox: DoclingBBox }>,
        reasons: string[],
      ) => void;
      bboxValue: (value: unknown) => DoclingBBox | undefined;
      stringArrayValue: (value: unknown) => string[];
      tableGridValue: (value: unknown) => Array<Array<{ text: string }>>;
      imageRegionsValue: (value: unknown) => Array<{
        id?: string;
        bbox: DoclingBBox;
        imageUri?: string;
        caption?: string;
      }>;
      textPartsValue: (
        value: unknown,
      ) => Array<{ text: string; label?: string }>;
      validateSplitText: (
        context: PageReviewContext,
        textRef: string,
        parts: Array<{ text: string }>,
        reasons: string[],
      ) => void;
      validateTableCell: (
        context: PageReviewContext,
        tableRef: string,
        row: number,
        col: number,
        reasons: string[],
      ) => void;
      validateTableGrid: (
        grid: Array<Array<{ text: string }>>,
        reasons: string[],
      ) => void;
      validateBbox: (
        context: PageReviewContext,
        bbox: DoclingBBox,
        reasons: string[],
      ) => void;
      validateRemoveText: (
        context: PageReviewContext,
        textRef: string,
        reasons: string[],
      ) => void;
      getSuspectReasons: (context: PageReviewContext, ref: string) => string[];
      computeFinalConfidence: (
        rawCommand: ReviewAssistanceRawCommand,
        command?: undefined,
      ) => number;
      getRiskPenalty: (command: any) => number;
      iou: (a: DoclingBBox, b: DoclingBBox) => number;
    };
    const reasons: string[] = [];

    validator.validateTableGrid([], reasons);
    validator.validateSplitRegions([{ bbox }], reasons);
    validator.validateSplitText(
      makeContext(),
      '#/texts/99',
      [{ text: 'A' }, { text: 'B' }],
      reasons,
    );
    validator.validateTableCell(makeContext(), '#/tables/99', 0, 0, reasons);
    validator.validateTableGrid([[{ text: 'A' }]], reasons);
    validator.validateTableGrid([[{ text: 'A' }], []], reasons);
    validator.validateBbox(
      makeContext(),
      { l: 0, t: 10, r: 20, b: 30, coord_origin: 'BOTTOMLEFT' },
      reasons,
    );
    validator.validateRemoveText(makeContext(), '#/texts/0', reasons);

    expect(validator.bboxValue({ l: 1, t: 2, r: 3 })).toBeUndefined();
    expect(validator.bboxValue({ l: 1, t: 2, r: 3, b: 4 })).toEqual({
      l: 1,
      t: 2,
      r: 3,
      b: 4,
      coord_origin: 'TOPLEFT',
    });
    expect(validator.stringArrayValue('bad')).toEqual([]);
    expect(validator.stringArrayValue(['a', 1, 'b'])).toEqual(['a', 'b']);
    expect(validator.tableGridValue('bad')).toEqual([]);
    expect(
      validator.tableGridValue([[{ text: 'A' }, { text: 1 }, null], 'bad']),
    ).toEqual([[{ text: 'A' }, { text: '' }, { text: '' }], []]);
    expect(validator.imageRegionsValue('bad')).toEqual([]);
    expect(
      validator.imageRegionsValue([
        null,
        { bbox: null },
        { bbox, id: 1, imageUri: 2, caption: 3 },
        { bbox, id: 'a', imageUri: 'image.png', caption: 'Figure' },
      ]),
    ).toEqual([
      { bbox },
      { bbox, id: 'a', imageUri: 'image.png', caption: 'Figure' },
    ]);
    expect(validator.textPartsValue('bad')).toEqual([]);
    expect(
      validator.textPartsValue([
        null,
        {},
        { text: 'A', label: 1 },
        { text: 'B', label: 'body' },
      ]),
    ).toEqual([{ text: 'A' }, { text: 'B', label: 'body' }]);
    expect(
      validator.getRiskPenalty({
        op: 'removeText',
        textRef: '#/texts/0',
      }),
    ).toBe(0.12);
    expect(
      validator.getRiskPenalty({
        op: 'moveNode',
        sourceRef: '#/texts/0',
        targetRef: '#/texts/1',
        position: 'after',
      }),
    ).toBe(0.05);
    expect(
      validator.getRiskPenalty({
        op: 'addText',
        pageNo: 1,
        bbox,
        text: 'A',
        label: 'text',
      }),
    ).toBe(0);
    expect(validator.getSuspectReasons(makeContext(), '#/pictures/0')).toEqual([
      'image_missing_caption',
    ]);
    expect(validator.getSuspectReasons(makeContext(), '#/unknown/0')).toEqual(
      [],
    );
    expect(
      validator.computeFinalConfidence(
        {
          op: 'replaceText',
          targetRef: '#/texts/0',
          payload: { text: 'A' },
          confidence: 0.42,
          rationale: 'raw',
          evidence: null,
        },
        undefined,
      ),
    ).toBe(0.42);
    expect(
      validator.iou(bbox, {
        l: 200,
        t: 200,
        r: 220,
        b: 220,
        coord_origin: 'TOPLEFT',
      }),
    ).toBe(0);
    expect(
      validator.iou(
        { l: 10, t: 10, r: 10, b: 10, coord_origin: 'TOPLEFT' },
        { l: 10, t: 10, r: 10, b: 10, coord_origin: 'TOPLEFT' },
      ),
    ).toBe(0);
    expect(reasons).toEqual([
      'table_grid_empty',
      'split_picture_requires_multiple_regions',
      'table_grid_not_rectangular',
    ]);
  });

  test('returns no decisions for an empty page command list', () => {
    expect(
      new ReviewAssistanceValidator().validatePageOutput(
        makeContext(),
        { pageNo: 1, commands: [], pageNotes: [] },
        {
          autoApplyThreshold: 0.85,
          proposalThreshold: 0.5,
          allowAutoApply: true,
        },
      ),
    ).toEqual([]);
  });
});
