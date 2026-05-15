import type { ReviewAssistanceTaskDefinition } from '../../prompts/review-assistance-prompt';
import type { PageReviewContext } from './page-review-context-builder';
import type { ReviewAssistanceWorkItem } from './review-assistance-work-scheduler';

import { describe, expect, test } from 'vitest';

import { ReviewAssistanceContextPacker } from './review-assistance-context-packer';

const bbox = { l: 0, t: 0, r: 10, b: 10, coord_origin: 'TOPLEFT' as const };
const task = {
  id: 'text_ocr_hanja',
  label: 'Text OCR',
  allowedOps: ['replaceText'] as const,
  focus: 'Text OCR',
} satisfies ReviewAssistanceTaskDefinition;

function makeContext(): PageReviewContext {
  return {
    pageNo: 1,
    reviewAssistanceEligibility: {
      pageNo: 1,
      eligible: true,
      kind: 'archaeological_data',
      score: 80,
      reasons: ['data-bearing page'],
      exclusionReasons: [],
    },
    pageSize: { width: 100, height: 100 },
    pageImagePath: '/tmp/page.png',
    textBlocks: [
      {
        ref: '#/texts/0',
        label: 'text',
        text: 'Before',
        bbox,
        nextRef: '#/texts/1',
        suspectReasons: [],
      },
      {
        ref: '#/texts/1',
        label: 'caption',
        text: 'T e s t',
        bbox,
        previousRef: '#/texts/0',
        nextRef: '#/texts/2',
        suspectReasons: ['ocr_noise', 'caption_like_body_text'],
      },
      {
        ref: '#/texts/2',
        label: 'text',
        text: 'After',
        bbox,
        previousRef: '#/texts/1',
        suspectReasons: ['picture_internal_text'],
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
        bbox,
        gridPreview: [['A']],
        emptyCellRatio: 0,
        suspectReasons: ['table_missing_caption'],
      },
      {
        ref: '#/tables/1',
        bbox,
        gridPreview: [['B']],
        emptyCellRatio: 0,
        suspectReasons: [],
      },
    ],
    pictures: [
      {
        ref: '#/pictures/0',
        bbox,
        suspectReasons: ['image_missing_caption'],
        splitCandidate: { score: 0.9, reasons: ['visible gutter'] },
      },
      {
        ref: '#/pictures/1',
        bbox,
        suspectReasons: [],
      },
    ],
    orphanCaptions: [
      {
        ref: '#/texts/3',
        text: 'Table 1',
        bbox,
        currentLabel: 'text',
        captionLikeBodyText: true,
        nearestMediaRefs: [{ ref: '#/tables/0', kind: 'table', distance: 3 }],
      },
      {
        ref: '#/texts/4',
        text: 'Figure 1',
        bbox,
        currentLabel: 'text',
        captionLikeBodyText: true,
        nearestMediaRefs: [
          { ref: '#/pictures/0', kind: 'picture', distance: 4 },
        ],
      },
    ],
    footnotes: [{ ref: '#/texts/2', text: 'After', bbox }],
    layout: {
      readingOrderRefs: ['#/texts/0', '#/texts/1', '#/tables/0'],
      visualOrderRefs: ['#/texts/1', '#/texts/0', '#/tables/0'],
      bboxWarnings: [{ targetRef: '#/texts/1', reason: 'bbox_outside_page' }],
    },
    domainPatterns: [
      { targetRef: '#/texts/1', pattern: 'hanja_term', value: '山' },
    ],
  };
}

function makeItem(
  overrides: Partial<ReviewAssistanceWorkItem>,
): ReviewAssistanceWorkItem {
  return {
    id: 'item',
    kind: 'text_ocr_hanja',
    pageNo: 1,
    targetRefs: ['#/texts/1'],
    priority: 'required',
    contextBudget: 'tiny',
    eligibility: makeContext().reviewAssistanceEligibility,
    task,
    ...overrides,
  };
}

describe('ReviewAssistanceContextPacker', () => {
  test('packs text OCR context with target text and neighbors only', () => {
    const packed = new ReviewAssistanceContextPacker().pack(
      makeContext(),
      makeItem({ kind: 'text_ocr_hanja' }),
    );

    expect(packed.textBlocks.map((block) => block.ref)).toEqual([
      '#/texts/0',
      '#/texts/1',
      '#/texts/2',
    ]);
    expect(packed.tables).toEqual([]);
    expect(packed.domainPatterns).toEqual([
      { targetRef: '#/texts/1', pattern: 'hanja_term', value: '山' },
    ]);
  });

  test('packs table and picture contexts around their target refs', () => {
    const packer = new ReviewAssistanceContextPacker();
    const tableContext = packer.pack(
      makeContext(),
      makeItem({
        kind: 'table',
        targetRefs: ['#/tables/0'],
        task: { ...task, id: 'tables', allowedOps: ['replaceTable'] },
      }),
    );
    const pictureContext = packer.pack(
      makeContext(),
      makeItem({
        kind: 'picture_caption',
        targetRefs: ['#/pictures/0'],
        task: {
          ...task,
          id: 'pictures_captions',
          allowedOps: ['updatePictureCaption'],
        },
      }),
    );

    expect(tableContext.tables.map((table) => table.ref)).toEqual([
      '#/tables/0',
    ]);
    expect(tableContext.orphanCaptions.map((caption) => caption.ref)).toEqual([
      '#/texts/3',
    ]);
    expect(pictureContext.pictures.map((picture) => picture.ref)).toEqual([
      '#/pictures/0',
    ]);
    expect(pictureContext.orphanCaptions.map((caption) => caption.ref)).toEqual(
      ['#/texts/4'],
    );
  });

  test('packs each work item kind without unrelated payloads', () => {
    const packer = new ReviewAssistanceContextPacker();
    const textIntegrity = packer.pack(
      makeContext(),
      makeItem({ kind: 'text_integrity', targetRefs: ['#/pictures/0'] }),
    );
    const textRole = packer.pack(
      makeContext(),
      makeItem({
        kind: 'text_role_footnote',
        targetRefs: ['#/texts/2', '#/tables/0'],
        task: {
          ...task,
          id: 'text_role_footnote',
          allowedOps: ['linkFootnote'],
        },
      }),
    );
    const pictureSplit = packer.pack(
      makeContext(),
      makeItem({
        kind: 'picture_split',
        targetRefs: ['#/pictures/0'],
        task: {
          ...task,
          id: 'pictures_captions',
          allowedOps: ['splitPicture'],
        },
      }),
    );
    const layout = packer.pack(
      makeContext(),
      makeItem({
        kind: 'layout_bbox_order',
        targetRefs: ['#/texts/1', '#/tables/0'],
        task: { ...task, id: 'layout_bbox_order', allowedOps: ['updateBbox'] },
      }),
    );

    expect(textIntegrity.pictures.map((picture) => picture.ref)).toEqual([
      '#/pictures/0',
    ]);
    expect(textRole.footnotes.map((footnote) => footnote.ref)).toEqual([
      '#/texts/2',
    ]);
    expect(pictureSplit.pictures[0].splitCandidate).toBeDefined();
    expect(layout.layout.bboxWarnings).toEqual([
      { targetRef: '#/texts/1', reason: 'bbox_outside_page' },
    ]);
  });

  test('falls back to the original context for unknown work item kinds', () => {
    const context = makeContext();
    const packed = new ReviewAssistanceContextPacker().pack(
      context,
      makeItem({ kind: 'unknown_kind' as any }),
    );

    expect(packed).toBe(context);
  });
});
