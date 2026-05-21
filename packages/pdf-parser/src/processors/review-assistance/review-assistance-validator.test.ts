import type { DoclingBBox } from '@heripo/model';

import type { ReviewAssistanceRawCommand } from '../../types/review-assistance-schema';
import type { PageReviewContext } from './page-review-context-builder';

import { describe, expect, test } from 'vitest';

import { REVIEW_ASSISTANCE_MISSING_ENUM_SENTINEL } from '../../types/review-assistance-schema';
import { ReviewAssistanceValidator } from './review-assistance-validator';

const bbox: DoclingBBox = {
  l: 10,
  t: 10,
  r: 80,
  b: 40,
  coord_origin: 'TOPLEFT',
};

type RawCell = Extract<
  ReviewAssistanceRawCommand,
  { op: 'replaceTable' }
>['grid'][number][number];

// Schema-correct table cell with every nullable field present. The validator's
// `toCommand` drops null span/header/bbox fields, so omitted extras vanish from
// the resulting command — keeping fixtures terse while satisfying the strict
// discriminated-union type.
function cell(text: string, extra: Partial<RawCell> = {}): RawCell {
  return {
    text,
    bbox: null,
    rowSpan: null,
    colSpan: null,
    columnHeader: null,
    rowHeader: null,
    ...extra,
  };
}

type RawRegion = Extract<
  ReviewAssistanceRawCommand,
  { op: 'splitPicture' }
>['regions'][number];

// Schema-correct split-picture region with every nullable field present.
function region(
  regionBbox: RawRegion['bbox'],
  extra: Partial<RawRegion> = {},
): RawRegion {
  return {
    id: null,
    bbox: regionBbox,
    imageUri: null,
    caption: null,
    ...extra,
  };
}

function makeContext(
  textSuspectReasons: string[] = ['ocr_noise'],
): PageReviewContext {
  return {
    pageNo: 1,
    reviewAssistanceEligibility: {
      pageNo: 1,
      eligible: true,
      kind: 'archaeological_data',
      score: 50,
      reasons: ['table_present'],
      exclusionReasons: [],
    },
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
        splitCandidate: {
          score: 0.88,
          orientation: 'vertical',
          reasons: ['vertical_gutter_with_content_on_both_sides'],
          suggestedRegions: [
            {
              bbox: { ...bbox, r: 35 },
              confidence: 0.86,
            },
            {
              bbox: { ...bbox, l: 45 },
              confidence: 0.86,
            },
          ],
        },
        suspectReasons: [
          'image_missing_caption',
          'picture_split_boundary_candidate',
        ],
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
      textRef: '#/texts/0',
      text: 'Test',
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
    expect(decision.reasons).toContain('auto_apply_disabled');
    expect(decision.evidence?.suspectReasons).toContain('ocr_noise');
  });

  test('includes image-only evidence when a command has no target suspect reasons', () => {
    const decision = validate({
      op: 'addText',
      bbox,
      text: 'Visible text',
      label: 'text',
      pageNo: null,
      afterRef: null,
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
            textRef: '#/texts/0',
            label: 'caption',
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

  test('한자 보정 후보는 VLM 판단을 더 신뢰해서 자동 반영한다', () => {
    const [decision] = new ReviewAssistanceValidator().validatePageOutput(
      makeContext(['hanja_ocr_candidate']),
      {
        pageNo: 1,
        commands: [
          {
            op: 'replaceText',
            textRef: '#/texts/0',
            text: '분지상(盆地床)',
            confidence: 0.72,
            rationale: '이미지에서 한자 표기가 확인됩니다.',
            evidence: '분지상(盆地床)',
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
    expect(decision.reasons).not.toContain('below_auto_apply_threshold');
  });

  test('이미지 내부 텍스트 삭제는 VLM 판단을 더 신뢰해서 자동 반영한다', () => {
    const [decision] = new ReviewAssistanceValidator().validatePageOutput(
      makeContext(['picture_internal_text']),
      {
        pageNo: 1,
        commands: [
          {
            op: 'removeText',
            textRef: '#/texts/0',
            confidence: 0.72,
            rationale: '이미지 내부 라벨이라 본문 텍스트에서 제외합니다.',
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
    expect(decision.confidence).toBe(0.72);
    expect(decision.reasons).not.toContain('below_auto_apply_threshold');
  });

  test('defers high-confidence structural commands to manual review', () => {
    const [decision] = new ReviewAssistanceValidator().validatePageOutput(
      makeContext(),
      {
        pageNo: 1,
        commands: [
          {
            op: 'replaceTable',
            tableRef: '#/tables/0',
            grid: [[cell('A')]],
            caption: null,
            confidence: 0.95,
            rationale: 'Visible table differs',
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

    expect(decision.disposition).toBe('proposal');
    expect(decision.reasons).toContain(
      'structural_command_requires_manual_review',
    );
  });

  test('auto-applies addText, updateBbox, linkFootnote, and moveNode only with deterministic gates', () => {
    const context = makeContext();
    context.missingTextCandidates = [
      {
        text: 'Missing line',
        source: 'text_layer',
        reason: 'unmatched_text_layer_block',
      },
    ];
    context.layout.bboxWarnings = [
      { targetRef: '#/texts/0', reason: 'bbox_outside_page' },
    ];
    context.layout.visualOrderRefs = [
      '#/tables/0',
      '#/texts/0',
      '#/pictures/0',
    ];
    context.footnotes = [
      { ref: '#/texts/1', text: '1) Footnote', marker: '1)', bbox },
    ];

    const commands: ReviewAssistanceRawCommand[] = [
      {
        op: 'addText',
        bbox,
        text: 'Missing line',
        label: 'text',
        pageNo: null,
        afterRef: null,
        confidence: 0.95,
        rationale: 'Missing text is present in text layer',
        evidence: null,
      },
      {
        op: 'updateBbox',
        targetRef: '#/texts/0',
        bbox,
        confidence: 0.95,
        rationale: 'Bbox warning matches',
        evidence: null,
      },
      {
        op: 'linkFootnote',
        markerTextRef: '#/texts/0',
        footnoteTextRef: '#/texts/1',
        confidence: 0.95,
        rationale: 'Footnote candidate',
        evidence: null,
      },
      {
        op: 'moveNode',
        sourceRef: '#/texts/0',
        targetRef: '#/tables/0',
        position: 'after',
        confidence: 0.95,
        rationale: 'Reading order mismatch',
        evidence: null,
      },
    ];

    const decisions = commands.map(
      (command) =>
        new ReviewAssistanceValidator().validatePageOutput(
          context,
          { pageNo: 1, commands: [command], pageNotes: [] },
          {
            autoApplyThreshold: 0.85,
            proposalThreshold: 0.5,
            allowAutoApply: true,
          },
        )[0],
    );

    expect(decisions.map((decision) => decision.disposition)).toEqual([
      'auto_applied',
      'auto_applied',
      'auto_applied',
      'auto_applied',
    ]);
  });

  test('records auto-apply gate reasons for otherwise valid commands', () => {
    const commands: ReviewAssistanceRawCommand[] = [
      {
        op: 'addText',
        bbox,
        text: 'Unmatched by deterministic text layer',
        label: 'text',
        pageNo: null,
        afterRef: null,
        confidence: 0.95,
        rationale: 'Visible text',
        evidence: null,
      },
      {
        op: 'updateBbox',
        targetRef: '#/texts/0',
        bbox,
        confidence: 0.95,
        rationale: 'Bbox update',
        evidence: null,
      },
      {
        op: 'linkFootnote',
        markerTextRef: '#/texts/0',
        footnoteTextRef: '#/texts/1',
        confidence: 0.95,
        rationale: 'Footnote link',
        evidence: null,
      },
      {
        op: 'moveNode',
        sourceRef: '#/texts/0',
        targetRef: '#/tables/0',
        position: 'after',
        confidence: 0.95,
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
            allowAutoApply: true,
          },
        )[0],
    );
    const reasons = decisions.map((decision) => decision.reasons.at(-1));

    expect(decisions.map((decision) => decision.disposition)).toEqual([
      'proposal',
      'proposal',
      'proposal',
      'proposal',
    ]);
    expect(reasons).toEqual([
      'add_text_requires_missing_text_candidate',
      'update_bbox_requires_bbox_warning',
      'link_footnote_requires_footnote_candidate',
      'move_node_requires_visual_order_improvement',
    ]);
  });

  test('blocks moveNode auto-apply when the requested move does not improve visual order', () => {
    const context = makeContext();
    context.layout.visualOrderRefs = [
      '#/tables/0',
      '#/texts/0',
      '#/pictures/0',
    ];

    const [decision] = new ReviewAssistanceValidator().validatePageOutput(
      context,
      {
        pageNo: 1,
        commands: [
          {
            op: 'moveNode',
            sourceRef: '#/pictures/0',
            targetRef: '#/texts/0',
            position: 'before',
            confidence: 0.95,
            rationale: 'Wrong move',
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

    expect(decision.disposition).toBe('proposal');
    expect(decision.reasons).toContain(
      'move_node_requires_visual_order_improvement',
    );
  });

  test('skips commands that target unknown refs', () => {
    const decision = validate({
      op: 'replaceText',
      textRef: '#/texts/99',
      text: 'replacement',
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
            textRef: '#/texts/0',
            text: 'Test',
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
            textRef: '#/texts/0',
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

  test('이미지 내부 텍스트 후보는 removeText 검증 근거로 인정한다', () => {
    const [decision] = new ReviewAssistanceValidator().validatePageOutput(
      makeContext(['picture_internal_text']),
      {
        pageNo: 1,
        commands: [
          {
            op: 'removeText',
            textRef: '#/texts/0',
            confidence: 0.99,
            rationale: '이미지 내부 라벨은 본문 텍스트가 아니다.',
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

    expect(decision.command).toEqual({
      op: 'removeText',
      textRef: '#/texts/0',
    });
    expect(decision.reasons).not.toContain(
      'remove_text_without_deterministic_suspect_reason',
    );
  });

  test('skips malformed replacement tables', () => {
    const decision = validate({
      op: 'replaceTable',
      tableRef: '#/tables/0',
      grid: [[cell('A')], [cell('B'), cell('C')]],
      caption: null,
      confidence: 0.95,
      rationale: 'Visible table differs',
      evidence: null,
    });

    expect(decision.disposition).toBe('skipped');
    expect(decision.reasons).toContain('table_grid_not_rectangular');
  });

  test('preserves cell bbox and span metadata in replaceTable commands', () => {
    const cellBbox: DoclingBBox = {
      l: 5,
      t: 6,
      r: 25,
      b: 16,
      coord_origin: 'TOPLEFT',
    };
    const decision = validate({
      op: 'replaceTable',
      tableRef: '#/tables/0',
      grid: [
        [
          cell('A', {
            bbox: cellBbox,
            rowSpan: 1,
            colSpan: 2,
            columnHeader: true,
          }),
          cell('B'),
        ],
        [cell('C'), cell('D')],
      ],
      caption: null,
      confidence: 0.9,
      rationale: 'Replace grid with cell-level metadata',
      evidence: null,
    });

    expect(decision.command?.op).toBe('replaceTable');
    const grid =
      decision.command?.op === 'replaceTable' ? decision.command.grid : [];
    expect(grid[0][0]).toMatchObject({
      text: 'A',
      bbox: cellBbox,
      rowSpan: 1,
      colSpan: 2,
      columnHeader: true,
    });
    expect(grid[0][1]).toEqual({ text: 'B' });
  });

  test('allows updating existing empty table cells', () => {
    const context = makeContext();
    context.tables[0].gridPreview[0][0] = '';

    const decision = validateWithContext(context, {
      op: 'updateTableCell',
      tableRef: '#/tables/0',
      row: 0,
      col: 0,
      text: 'Filled',
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
      sourceTableRef: '#/tables/0',
      continuedTableRef: '#/tables/99',
      relation: 'continues_on_next_page',
      confidence: 0.95,
      rationale: 'Compatible adjacent table',
      evidence: null,
    });

    expect(decision.disposition).toBe('proposal');
    expect(decision.reasons).not.toContain('table_ref_not_found');
  });

  test('allows splitPicture only when a boundary candidate supports the regions', () => {
    const context = makeContext();

    const decision = validateWithContext(context, {
      op: 'splitPicture',
      pictureRef: '#/pictures/0',
      regions: [
        region({ ...bbox, r: 35 }, { caption: 'A' }),
        region({ ...bbox, l: 45 }, { caption: 'B' }),
      ],
      confidence: 0.95,
      rationale: 'Visible gutter separates two panels',
      evidence: null,
    });

    expect(decision.disposition).toBe('proposal');
    expect(decision.reasons).not.toContain(
      'split_picture_without_boundary_candidate',
    );
    expect(decision.reasons).not.toContain(
      'split_picture_boundary_not_supported',
    );
  });

  test('skips splitPicture when the target picture has no boundary candidate', () => {
    const context = makeContext();
    context.pictures[0].splitCandidate = undefined;
    context.pictures[0].suspectReasons = ['image_missing_caption'];

    const decision = validateWithContext(context, {
      op: 'splitPicture',
      pictureRef: '#/pictures/0',
      regions: [
        region({ ...bbox, r: 35 }, { caption: 'A' }),
        region({ ...bbox, l: 45 }, { caption: 'B' }),
      ],
      confidence: 0.95,
      rationale: 'Model wants to split a large image',
      evidence: null,
    });

    expect(decision.disposition).toBe('skipped');
    expect(decision.reasons).toContain(
      'split_picture_without_boundary_candidate',
    );
  });

  test('skips splitPicture regions that conflict with candidate geometry', () => {
    const context = makeContext();

    const decision = validateWithContext(context, {
      op: 'splitPicture',
      pictureRef: '#/pictures/0',
      regions: [
        region({ ...bbox, b: 20 }, { caption: 'Top' }),
        region({ ...bbox, t: 25 }, { caption: 'Bottom' }),
        region({ ...bbox, t: 41, b: 55 }, { caption: 'Outside source' }),
      ],
      confidence: 0.95,
      rationale: 'Unsupported split geometry',
      evidence: null,
    });

    expect(decision.disposition).toBe('skipped');
    expect(decision.reasons).toContain('split_picture_region_outside_source');
    expect(decision.reasons).toContain('split_picture_region_count_mismatch');
    expect(decision.reasons).toContain('split_picture_boundary_not_supported');
  });

  test('skips splitPicture when the source picture is missing or lacks geometry', () => {
    const missingPicture = validateWithContext(makeContext(), {
      op: 'splitPicture',
      pictureRef: '#/pictures/404',
      regions: [
        region({ ...bbox, r: 35 }, { caption: 'A' }),
        region({ ...bbox, l: 45 }, { caption: 'B' }),
      ],
      confidence: 0.95,
      rationale: 'Unknown source picture',
      evidence: null,
    });
    const missingBboxContext = makeContext();
    missingBboxContext.pictures[0].bbox = undefined;
    const missingBbox = validateWithContext(missingBboxContext, {
      op: 'splitPicture',
      pictureRef: '#/pictures/0',
      regions: [
        region({ ...bbox, r: 35 }, { caption: 'A' }),
        region({ ...bbox, l: 45 }, { caption: 'B' }),
      ],
      confidence: 0.95,
      rationale: 'Source picture has candidate but no bbox',
      evidence: null,
    });

    expect(missingPicture.reasons).toContain('target_ref_not_found');
    expect(missingPicture.reasons).not.toContain(
      'split_picture_without_boundary_candidate',
    );
    expect(missingBbox.disposition).toBe('skipped');
    expect(missingBbox.reasons).toContain('split_picture_source_bbox_missing');
  });

  test('supports horizontal and grid split candidates', () => {
    const horizontalContext = makeContext();
    horizontalContext.pictures[0].splitCandidate = {
      score: 0.88,
      orientation: 'horizontal',
      reasons: ['horizontal_gutter_with_content_on_both_sides'],
      suggestedRegions: [
        { bbox: { ...bbox, b: 20 }, confidence: 0.86 },
        { bbox: { ...bbox, t: 25 }, confidence: 0.86 },
      ],
    };
    const horizontal = validateWithContext(horizontalContext, {
      op: 'splitPicture',
      pictureRef: '#/pictures/0',
      regions: [
        region({ ...bbox, b: 20 }, { caption: 'Top' }),
        region({ ...bbox, t: 25 }, { caption: 'Bottom' }),
      ],
      confidence: 0.95,
      rationale: 'Horizontal gutter separates panels',
      evidence: null,
    });

    const gridContext = makeContext();
    gridContext.pictures[0].splitCandidate = {
      score: 0.88,
      orientation: 'grid',
      reasons: ['grid_gutters_with_content_in_each_region'],
      suggestedRegions: [
        { bbox: { ...bbox, r: 35, b: 20 }, confidence: 0.86 },
        { bbox: { ...bbox, l: 45, b: 20 }, confidence: 0.86 },
        { bbox: { ...bbox, r: 35, t: 25 }, confidence: 0.86 },
        { bbox: { ...bbox, l: 45, t: 25 }, confidence: 0.86 },
      ],
    };
    const grid = validateWithContext(gridContext, {
      op: 'splitPicture',
      pictureRef: '#/pictures/0',
      regions: [
        region({ ...bbox, r: 35, b: 20 }, { caption: 'Top left' }),
        region({ ...bbox, l: 45, b: 20 }, { caption: 'Top right' }),
        region({ ...bbox, r: 35, t: 25 }, { caption: 'Bottom left' }),
        region({ ...bbox, l: 45, t: 25 }, { caption: 'Bottom right' }),
      ],
      confidence: 0.95,
      rationale: 'Grid gutters separate panels',
      evidence: null,
    });

    expect(horizontal.disposition).toBe('proposal');
    expect(horizontal.reasons).not.toContain(
      'split_picture_boundary_not_supported',
    );
    expect(grid.disposition).toBe('proposal');
    expect(grid.reasons).not.toContain('split_picture_boundary_not_supported');
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
      sourceTableRef: '#/tables/99',
      continuedTableRef: '#/tables/0',
      relation: 'continued_from_previous_page',
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
        bbox,
        text: 'Missing text',
        label: 'text',
        pageNo: null,
        afterRef: '#/texts/0',
        confidence: 0.9,
        rationale: 'Visible missing text',
        evidence: null,
      },
      {
        op: 'updateTextRole',
        textRef: '#/texts/0',
        label: 'caption',
        confidence: 0.9,
        rationale: 'Role mismatch',
        evidence: null,
      },
      {
        op: 'removeText',
        textRef: '#/texts/0',
        confidence: 0.99,
        rationale: 'Deterministic noise',
        evidence: null,
      },
      {
        op: 'mergeTexts',
        textRefs: ['#/texts/0', '#/texts/1'],
        text: 'Merged',
        keepRef: '#/texts/0',
        confidence: 0.95,
        rationale: 'Adjacent fragments',
        evidence: null,
      },
      {
        op: 'splitText',
        textRef: '#/texts/0',
        parts: [
          { text: 'T e', label: null },
          { text: 's t', label: 'text' },
        ],
        confidence: 0.95,
        rationale: 'Merged fragments',
        evidence: null,
      },
      {
        op: 'updateTableCell',
        tableRef: '#/tables/0',
        row: 0,
        col: 0,
        text: 'AA',
        confidence: 0.9,
        rationale: 'Cell OCR',
        evidence: null,
      },
      {
        op: 'replaceTable',
        tableRef: '#/tables/0',
        grid: [[cell('A')]],
        caption: 'Table 1',
        confidence: 0.95,
        rationale: 'Table OCR',
        evidence: null,
      },
      {
        op: 'linkContinuedTable',
        sourceTableRef: '#/tables/0',
        continuedTableRef: '#/tables/1',
        relation: 'continues_on_next_page',
        confidence: 0.95,
        rationale: 'Continued table',
        evidence: null,
      },
      {
        op: 'updatePictureCaption',
        pictureRef: '#/pictures/0',
        caption: 'Figure 1',
        confidence: 0.9,
        rationale: 'Nearby caption',
        evidence: null,
      },
      {
        op: 'addPicture',
        bbox,
        imageUri: 'images/new.png',
        caption: 'Figure 2',
        pageNo: null,
        confidence: 0.9,
        rationale: 'Missing picture',
        evidence: null,
      },
      {
        op: 'splitPicture',
        pictureRef: '#/pictures/0',
        regions: [
          region({ ...bbox, r: 30 }, { id: 'region-a', caption: 'A' }),
          region({ ...bbox, l: 40, r: 80 }, { imageUri: 'b.png' }),
        ],
        confidence: 0.95,
        rationale: 'Combined picture',
        evidence: null,
      },
      {
        op: 'hidePicture',
        pictureRef: '#/pictures/0',
        reason: 'duplicate',
        confidence: 0.99,
        rationale: 'Duplicate image',
        evidence: null,
      },
      {
        op: 'updateBbox',
        targetRef: '#/texts/0',
        bbox,
        confidence: 0.95,
        rationale: 'Bbox mismatch',
        evidence: null,
      },
      {
        op: 'linkFootnote',
        markerTextRef: '#/texts/0',
        footnoteTextRef: '#/texts/1',
        confidence: 0.9,
        rationale: 'Footnote marker',
        evidence: null,
      },
      {
        op: 'moveNode',
        sourceRef: '#/texts/0',
        targetRef: '#/tables/0',
        position: 'after',
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

    expect(decisions.map((decision) => decision.command?.op)).toEqual(
      commands.map((command) => command.op),
    );
    expect(
      decisions.every((decision) => decision.disposition === 'proposal'),
    ).toBe(true);
  });

  test('skips unhandled command ops and omitted required enums', () => {
    // Malformed/missing-field payloads are now rejected by the structured
    // -output Zod schema before reaching the validator, so the validator no
    // longer re-checks command shapes. What it still guards: an unhandled op
    // (defensive — the schema enum makes this unreachable in production) yields
    // no command, and a required enum the flat schema left empty arrives as the
    // sentinel and is rejected with `missing_required_field:*` rather than the
    // engine guessing a value.
    const sentinel = REVIEW_ASSISTANCE_MISSING_ENUM_SENTINEL;
    const commands = [
      {
        op: 'bogusOp',
        confidence: 0.9,
        rationale: 'unhandled op',
        evidence: null,
      },
      {
        op: 'addText',
        bbox,
        text: 'x',
        label: sentinel,
        pageNo: null,
        afterRef: null,
        confidence: 0.9,
        rationale: 'omitted label',
        evidence: null,
      },
      {
        op: 'updateTextRole',
        textRef: '#/texts/0',
        label: sentinel,
        confidence: 0.9,
        rationale: 'omitted label',
        evidence: null,
      },
      {
        op: 'linkContinuedTable',
        sourceTableRef: '#/tables/0',
        continuedTableRef: '#/tables/1',
        relation: sentinel,
        confidence: 0.9,
        rationale: 'omitted relation',
        evidence: null,
      },
      {
        op: 'moveNode',
        sourceRef: '#/texts/0',
        targetRef: '#/tables/0',
        position: sentinel,
        confidence: 0.9,
        rationale: 'omitted position',
        evidence: null,
      },
    ] as unknown as ReviewAssistanceRawCommand[];

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
    expect(decisions[0].command).toBeUndefined();
    expect(decisions[0].invalidOp).toBe('bogusOp');
    const reasons = decisions.flatMap((decision) => decision.reasons);
    expect(reasons).toContain('missing_required_field:label');
    expect(reasons).toContain('missing_required_field:relation');
    expect(reasons).toContain('missing_required_field:position');
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
        textRef: '#/texts/0',
        text: 'x',
        confidence: 0.99,
        rationale: 'too short',
        evidence: null,
      },
      {
        op: 'addText',
        bbox: invalidBbox,
        text: 'x',
        label: 'text',
        pageNo: 2,
        afterRef: null,
        confidence: 0.99,
        rationale: 'bad bbox',
        evidence: null,
      },
      {
        op: 'splitText',
        textRef: '#/texts/0',
        parts: [
          { text: 'x', label: null },
          { text: 'y', label: null },
        ],
        confidence: 0.99,
        rationale: 'bad split',
        evidence: null,
      },
      {
        op: 'mergeTexts',
        textRefs: ['#/texts/0', '#/texts/1'],
        text: 'Merged',
        keepRef: '#/texts/99',
        confidence: 0.99,
        rationale: 'bad keep ref',
        evidence: null,
      },
      {
        op: 'addPicture',
        bbox: { l: -1, t: 0, r: 20, b: 20 },
        imageUri: 'images/new.png',
        caption: null,
        pageNo: null,
        confidence: 0.99,
        rationale: 'outside bbox',
        evidence: null,
      },
      {
        op: 'updateTableCell',
        tableRef: '#/tables/0',
        row: -1,
        col: 0,
        text: 'x',
        confidence: 0.99,
        rationale: 'bad cell',
        evidence: null,
      },
      {
        op: 'updateTableCell',
        tableRef: '#/tables/0',
        row: 9,
        col: 9,
        text: 'x',
        confidence: 0.99,
        rationale: 'bad cell',
        evidence: null,
      },
      {
        op: 'updatePictureCaption',
        pictureRef: '#/pictures/0',
        caption: '',
        confidence: 0.99,
        rationale: 'empty caption',
        evidence: null,
      },
      {
        op: 'updatePictureCaption',
        pictureRef: '#/pictures/0',
        caption: 'x'.repeat(241),
        confidence: 0.99,
        rationale: 'long caption',
        evidence: null,
      },
      {
        op: 'splitPicture',
        pictureRef: '#/pictures/0',
        regions: [region(bbox), region(bbox)],
        confidence: 0.99,
        rationale: 'overlap',
        evidence: null,
      },
      {
        op: 'updateBbox',
        targetRef: '#/missing/0',
        bbox,
        confidence: 0.99,
        rationale: 'bad target',
        evidence: null,
      },
      {
        op: 'linkFootnote',
        markerTextRef: '#/texts/99',
        footnoteTextRef: '#/texts/98',
        confidence: 0.99,
        rationale: 'bad refs',
        evidence: null,
      },
      {
        op: 'moveNode',
        sourceRef: '#/texts/99',
        targetRef: '#/texts/99',
        position: 'before',
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
    expect(reasons).toContain('merge_keep_ref_not_in_text_refs');
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
      textRef: '#/texts/0',
      label: 'caption',
      confidence: 0.1,
      rationale: 'Weak evidence',
      evidence: null,
    });

    expect(decision.disposition).toBe('skipped');
  });

  test('keeps valid commands as proposals below the auto-apply threshold', () => {
    const [decision] = new ReviewAssistanceValidator().validatePageOutput(
      makeContext(),
      {
        pageNo: 1,
        commands: [
          {
            op: 'updateTextRole',
            textRef: '#/texts/0',
            label: 'caption',
            confidence: 0.7,
            rationale: 'Plausible caption',
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

    expect(decision.disposition).toBe('proposal');
    expect(decision.reasons).toContain('below_auto_apply_threshold');
  });

  test('allows moveNode auto-apply when visual and reading order lengths differ', () => {
    const context = makeContext();
    context.layout.visualOrderRefs = ['#/tables/0'];

    const [decision] = new ReviewAssistanceValidator().validatePageOutput(
      context,
      {
        pageNo: 1,
        commands: [
          {
            op: 'moveNode',
            sourceRef: '#/texts/0',
            targetRef: '#/tables/0',
            position: 'after',
            confidence: 0.95,
            rationale: 'Reading order mismatch',
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

  test('detects command conflicts and additional ref/bbox edge cases', () => {
    const noPageSize = makeContext();
    noPageSize.pageSize = null;
    const commands: ReviewAssistanceRawCommand[] = [
      {
        op: 'updateTextRole',
        textRef: '#/texts/0',
        label: 'caption',
        confidence: 0.9,
        rationale: 'first',
        evidence: null,
      },
      {
        op: 'replaceText',
        textRef: '#/texts/0',
        text: 'Test',
        confidence: 0.9,
        rationale: 'second',
        evidence: null,
      },
      {
        op: 'linkContinuedTable',
        sourceTableRef: '#/tables/0',
        continuedTableRef: '#/tables/99',
        relation: 'continued_from_previous_page',
        confidence: 0.9,
        rationale: 'bad table',
        evidence: null,
      },
      {
        op: 'addText',
        bbox: { l: 90, t: 90, r: 10, b: 10 },
        text: 'bad bbox',
        label: 'text',
        pageNo: null,
        afterRef: null,
        confidence: 0.9,
        rationale: 'bad bbox',
        evidence: null,
      },
      {
        op: 'addText',
        bbox: { l: 0, t: 10, r: 20, b: 30 },
        text: 'bottom left',
        label: 'text',
        pageNo: null,
        afterRef: null,
        confidence: 0.9,
        rationale: 'bottom left',
        evidence: null,
      },
      {
        op: 'replaceTable',
        tableRef: '#/tables/0',
        grid: [[]],
        caption: null,
        confidence: 0.9,
        rationale: 'empty row',
        evidence: null,
      },
      {
        op: 'splitPicture',
        pictureRef: '#/pictures/0',
        regions: [
          region({ l: 10, t: 10, r: 10, b: 10 }),
          region({ l: 10, t: 10, r: 10, b: 10 }),
        ],
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
        context: PageReviewContext,
        rawCommand: ReviewAssistanceRawCommand,
        command?: undefined,
      ) => number;
      buildReasons: (
        rawCommand: ReviewAssistanceRawCommand,
        validationReasons: string[],
        disposition: 'proposal',
        options: {
          autoApplyEnabled: boolean;
          belowAutoApplyThreshold: boolean;
          autoApplyBlockReason?: string;
        },
      ) => string[];
      getAutoApplyBlockReason: (
        context: PageReviewContext,
        command?: undefined,
      ) => string | undefined;
      hasReadingOrderMismatch: (context: PageReviewContext) => boolean;
      moveNodeImprovesReadingOrder: (
        context: PageReviewContext,
        command: {
          op: 'moveNode';
          sourceRef: string;
          targetRef: string;
          position: 'before' | 'after';
        },
      ) => boolean;
      getRiskPenalty: (context: PageReviewContext, command: any) => number;
      iou: (a: DoclingBBox, b: DoclingBBox) => number;
      splitRegionsMatchOrientation: (
        regions: Array<{ bbox: DoclingBBox }>,
        orientation: 'horizontal' | 'vertical' | 'grid',
        pageSize: PageReviewContext['pageSize'],
      ) => boolean;
      hasSeparatedRegionPair: (
        regions: Array<{ bbox: DoclingBBox }>,
        orientation: 'horizontal' | 'vertical',
        pageSize: PageReviewContext['pageSize'],
      ) => boolean;
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

    const gridRegions = [
      { bbox: { ...bbox, r: 35, b: 20 } },
      { bbox: { ...bbox, l: 45, b: 20 } },
      { bbox: { ...bbox, r: 35, t: 25 } },
      { bbox: { ...bbox, l: 45, t: 25 } },
    ];
    expect(
      validator.splitRegionsMatchOrientation(
        gridRegions,
        'grid',
        makeContext().pageSize,
      ),
    ).toBe(true);
    expect(
      validator.splitRegionsMatchOrientation(
        gridRegions.slice(0, 2),
        'grid',
        makeContext().pageSize,
      ),
    ).toBe(false);
    expect(
      validator.splitRegionsMatchOrientation(
        [
          { bbox: { ...bbox, b: 18 } },
          { bbox: { ...bbox, t: 20, b: 25 } },
          { bbox: { ...bbox, t: 27, b: 32 } },
          { bbox: { ...bbox, t: 34 } },
        ],
        'grid',
        makeContext().pageSize,
      ),
    ).toBe(false);
    expect(
      validator.splitRegionsMatchOrientation(
        [
          { bbox: { ...bbox, r: 35 } },
          { bbox: { ...bbox, l: 45 } },
          { bbox: { ...bbox, l: 46, r: 79 } },
          { bbox: { ...bbox, l: 47, r: 78 } },
        ],
        'grid',
        makeContext().pageSize,
      ),
    ).toBe(false);
    expect(
      validator.hasSeparatedRegionPair(
        [{ bbox: { ...bbox, b: 20 } }, { bbox: { ...bbox, t: 25 } }],
        'horizontal',
        makeContext().pageSize,
      ),
    ).toBe(true);
    expect(
      validator.hasSeparatedRegionPair(
        [{ bbox: { ...bbox, b: 20 } }, { bbox: { ...bbox, b: 20 } }],
        'horizontal',
        makeContext().pageSize,
      ),
    ).toBe(false);
    expect(
      validator.getRiskPenalty(makeContext(), {
        op: 'removeText',
        textRef: '#/texts/0',
      }),
    ).toBe(0.12);
    expect(
      validator.getRiskPenalty(makeContext(), {
        op: 'moveNode',
        sourceRef: '#/texts/0',
        targetRef: '#/texts/1',
        position: 'after',
      }),
    ).toBe(0.05);
    expect(
      validator.getRiskPenalty(makeContext(), {
        op: 'addText',
        pageNo: 1,
        bbox,
        text: 'A',
        label: 'text',
      }),
    ).toBe(0);
    expect(validator.getSuspectReasons(makeContext(), '#/pictures/0')).toEqual([
      'image_missing_caption',
      'picture_split_boundary_candidate',
    ]);
    expect(validator.getSuspectReasons(makeContext(), '#/unknown/0')).toEqual(
      [],
    );
    expect(
      validator.computeFinalConfidence(
        makeContext(),
        {
          op: 'replaceText',
          textRef: '#/texts/0',
          text: 'A',
          confidence: 0.42,
          rationale: 'raw',
          evidence: null,
        },
        undefined,
      ),
    ).toBe(0.42);
    expect(
      validator.buildReasons(
        {
          op: 'replaceText',
          textRef: '#/texts/0',
          text: 'A',
          confidence: 0.9,
          rationale: 'manual proposal',
          evidence: null,
        },
        [],
        'proposal',
        {
          autoApplyEnabled: true,
          belowAutoApplyThreshold: false,
        },
      ),
    ).toEqual(['manual proposal']);
    expect(validator.getAutoApplyBlockReason(makeContext(), undefined)).toBe(
      'auto_apply_requires_valid_command',
    );
    const emptyOrderContext = makeContext();
    emptyOrderContext.layout.readingOrderRefs = [];
    expect(validator.hasReadingOrderMismatch(emptyOrderContext)).toBe(false);
    const missingOrderRefContext = makeContext();
    missingOrderRefContext.layout.readingOrderRefs = ['#/texts/0'];
    missingOrderRefContext.layout.visualOrderRefs = ['#/tables/0', '#/texts/0'];
    expect(
      validator.moveNodeImprovesReadingOrder(missingOrderRefContext, {
        op: 'moveNode',
        sourceRef: '#/texts/0',
        targetRef: '#/tables/0',
        position: 'after',
      }),
    ).toBe(false);
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

  test('detects domain patterns for a target ref', () => {
    const validator = new ReviewAssistanceValidator() as unknown as {
      hasDomainPattern: (
        context: PageReviewContext,
        targetRef: string,
        pattern: PageReviewContext['domainPatterns'][number]['pattern'],
      ) => boolean;
    };
    const context = makeContext();

    context.domainPatterns = [
      { targetRef: '#/texts/99', pattern: 'hanja_term', value: '山' },
      { targetRef: '#/texts/0', pattern: 'unit', value: '10 cm' },
      { targetRef: '#/texts/0', pattern: 'hanja_term', value: '山' },
    ];

    expect(validator.hasDomainPattern(context, '#/texts/0', 'hanja_term')).toBe(
      true,
    );
    expect(
      validator.hasDomainPattern(context, '#/texts/0', 'institution_name'),
    ).toBe(false);
  });
});
