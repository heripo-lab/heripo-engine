import type { PageReviewContext } from './page-review-context-builder';

import { describe, expect, test } from 'vitest';

import { ReviewAssistanceWorkScheduler } from './review-assistance-work-scheduler';

const bbox = { l: 0, t: 0, r: 10, b: 10, coord_origin: 'TOPLEFT' as const };

function makeContext(
  overrides: Partial<PageReviewContext> = {},
): PageReviewContext {
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
        text: 'T e s t',
        bbox,
        nextRef: '#/texts/1',
        suspectReasons: ['ocr_noise'],
      },
      {
        ref: '#/texts/1',
        label: 'text',
        text: '1) Footnote',
        bbox,
        previousRef: '#/texts/0',
        suspectReasons: ['footnote_like_body_text'],
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
    ],
    pictures: [
      {
        ref: '#/pictures/0',
        bbox,
        suspectReasons: ['image_missing_caption'],
        splitCandidate: { score: 0.9, reasons: ['visible gutter'] },
      },
    ],
    orphanCaptions: [
      {
        ref: '#/texts/2',
        text: 'Figure 1',
        bbox,
        currentLabel: 'text',
        captionLikeBodyText: true,
        nearestMediaRefs: [
          { ref: '#/pictures/0', kind: 'picture', distance: 4 },
        ],
      },
    ],
    footnotes: [{ ref: '#/texts/1', text: '1) Footnote', bbox }],
    layout: {
      readingOrderRefs: ['#/texts/0', '#/texts/1'],
      visualOrderRefs: ['#/texts/1', '#/texts/0'],
      bboxWarnings: [{ targetRef: '#/texts/0', reason: 'bbox_outside_page' }],
    },
    domainPatterns: [
      { targetRef: '#/texts/0', pattern: 'hanja_term', value: '山' },
    ],
    ...overrides,
  };
}

describe('ReviewAssistanceWorkScheduler', () => {
  test('builds focused work items for eligible page contexts', () => {
    const items = new ReviewAssistanceWorkScheduler().build(makeContext());

    expect(items.map((item) => item.kind)).toEqual([
      'text_ocr_hanja',
      'text_integrity',
      'text_role_footnote',
      'table',
      'picture_caption',
      'picture_split',
      'layout_bbox_order',
    ]);
    expect(items.find((item) => item.kind === 'table')).toMatchObject({
      targetRefs: ['#/tables/0'],
      task: expect.objectContaining({ id: 'tables' }),
      priority: 'required',
    });
    expect(items.find((item) => item.kind === 'picture_split')).toMatchObject({
      contextBudget: 'tiny',
      priority: 'required',
      task: expect.objectContaining({ id: 'pictures_captions' }),
    });
  });

  test('returns no work items for non-eligible pages', () => {
    const items = new ReviewAssistanceWorkScheduler().build(
      makeContext({
        reviewAssistanceEligibility: {
          pageNo: 1,
          eligible: false,
          kind: 'non_meaningful',
          score: 10,
          reasons: ['cover'],
          exclusionReasons: ['cover'],
        },
      }),
    );

    expect(items).toEqual([]);
  });

  test('creates a fallback text OCR item when text exists without suspects', () => {
    const items = new ReviewAssistanceWorkScheduler().build(
      makeContext({
        textBlocks: [
          {
            ref: '#/texts/0',
            label: 'text',
            text: 'Plain text',
            bbox,
            suspectReasons: [],
          },
        ],
        missingTextCandidates: [],
        tables: [],
        pictures: [],
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

    expect(items).toEqual([
      expect.objectContaining({
        kind: 'text_ocr_hanja',
        targetRefs: ['#/texts/0'],
      }),
    ]);
  });

  test('does not create text OCR work when a page has no text', () => {
    const items = new ReviewAssistanceWorkScheduler().build(
      makeContext({
        textBlocks: [],
        missingTextCandidates: [],
        tables: [],
        pictures: [],
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

    expect(items).toEqual([]);
  });

  test('throws when an unknown work item kind cannot resolve a task', () => {
    const scheduler = new ReviewAssistanceWorkScheduler() as any;

    expect(() =>
      scheduler.createItem(makeContext(), 'unknown_kind', [], {
        priority: 'low',
        contextBudget: 'tiny',
      }),
    ).toThrow('No review assistance task definition for unknown_kind');
  });

  test('compacts very long work item ids', () => {
    const scheduler = new ReviewAssistanceWorkScheduler() as any;
    const item = scheduler.createItem(
      makeContext(),
      'text_ocr_hanja',
      [Array.from({ length: 30 }, (_, index) => `#/texts/${index}`).join('/')],
      {
        priority: 'required',
        contextBudget: 'tiny',
      },
    );

    expect(item.id.length).toBeLessThanOrEqual(180);
    expect(item.id).toMatch(/-\d+$/);
  });
});
