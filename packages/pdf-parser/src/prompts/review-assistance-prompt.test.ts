import type { PageReviewContext } from '../processors/review-assistance/page-review-context-builder';

import { describe, expect, test } from 'vitest';

import {
  REVIEW_ASSISTANCE_SYSTEM_PROMPT,
  REVIEW_ASSISTANCE_TASKS,
  buildReviewAssistancePrompt,
} from './review-assistance-prompt';

describe('REVIEW_ASSISTANCE_SYSTEM_PROMPT', () => {
  test('does not scope Review Assistance to Korean reports only', () => {
    expect(REVIEW_ASSISTANCE_SYSTEM_PROMPT).not.toMatch(
      /Korean archaeological report/i,
    );
    expect(REVIEW_ASSISTANCE_SYSTEM_PROMPT).toContain(
      'archaeological and cultural heritage report PDFs',
    );
    expect(REVIEW_ASSISTANCE_SYSTEM_PROMPT).toContain('Hanja correction');
    expect(REVIEW_ASSISTANCE_SYSTEM_PROMPT).toContain(
      'payload must be {"text"',
    );
    expect(REVIEW_ASSISTANCE_SYSTEM_PROMPT).toContain('This is not a Q&A task');
    expect(REVIEW_ASSISTANCE_SYSTEM_PROMPT).toContain(
      '"commands": [], "pageNotes": []',
    );
    expect(REVIEW_ASSISTANCE_SYSTEM_PROMPT).toContain(
      'Treat each picture bbox as an opaque image',
    );
    expect(REVIEW_ASSISTANCE_SYSTEM_PROMPT).toContain(
      'Only external captions outside or directly adjacent to a picture',
    );
    expect(REVIEW_ASSISTANCE_SYSTEM_PROMPT).toContain(
      'emit a high-confidence removeText command',
    );
    expect(REVIEW_ASSISTANCE_SYSTEM_PROMPT).toContain(
      'Do not leave them as generic review notes',
    );
    expect(REVIEW_ASSISTANCE_SYSTEM_PROMPT).toContain(
      'Suggest splitPicture only when the picture context includes splitCandidate',
    );
    expect(REVIEW_ASSISTANCE_SYSTEM_PROMPT).toContain(
      'Do not split a single large photo',
    );
  });

  test('serializes all page review context sections into prompt JSON', () => {
    const context: PageReviewContext = {
      pageNo: 1,
      reviewAssistanceEligibility: {
        pageNo: 1,
        eligible: true,
        kind: 'archaeological_data',
        score: 80,
        reasons: ['table_present'],
        exclusionReasons: [],
      },
      pageSize: { width: 100, height: 200 },
      pageImagePath: '/tmp/page.png',
      textBlocks: [
        {
          ref: '#/texts/0',
          label: 'text',
          text: 'Example',
          previousRef: '#/texts/prev',
          nextRef: '#/tables/0',
          repeatedAcrossPages: true,
          suspectReasons: ['ocr_noise'],
        },
      ],
      missingTextCandidates: [
        {
          text: 'Visible but absent text',
          source: 'text_layer',
          reason: 'unmatched_text_layer_block',
        },
      ],
      tables: [
        {
          ref: '#/tables/0',
          caption: 'Table 1',
          gridPreview: [['A']],
          emptyCellRatio: 0,
          previousPageTableRefs: ['#/tables/prev'],
          previousPageTableSummary: 'prev',
          nextPageTableRefs: ['#/tables/next'],
          nextPageTableSummary: 'next',
          suspectReasons: [],
        },
      ],
      pictures: [
        {
          ref: '#/pictures/0',
          caption: 'Figure 1',
          imageUri: 'images/pic_0.png',
          splitCandidate: {
            score: 0.82,
            orientation: 'vertical',
            reasons: ['vertical_gutter_with_content_on_both_sides'],
          },
          suspectReasons: [],
        },
      ],
      orphanCaptions: [
        {
          ref: '#/texts/1',
          text: 'Figure 1',
          currentLabel: 'text',
          captionLikeBodyText: true,
          nearestMediaRefs: [
            { ref: '#/pictures/0', kind: 'picture', distance: 10 },
          ],
        },
      ],
      footnotes: [{ ref: '#/texts/2', text: '1) Note', marker: '1)' }],
      layout: {
        readingOrderRefs: ['#/texts/0'],
        visualOrderRefs: ['#/texts/0'],
        bboxWarnings: [{ targetRef: '#/texts/0', reason: 'bbox_too_small' }],
      },
      domainPatterns: [
        { targetRef: '#/texts/0', pattern: 'unit', value: '10 cm' },
      ],
    };

    const prompt = buildReviewAssistancePrompt(context);

    expect(prompt).toContain('PAGE CONTEXT JSON:');
    expect(prompt).toContain('"orphanCaptions"');
    expect(prompt).toContain('"missingTextCandidates"');
    expect(prompt).toContain('"nextPageTableRefs"');
    expect(prompt).toContain('"domainPatterns"');
    expect(prompt).toContain('"pictures"');
    expect(prompt).toContain('"splitCandidate"');
  });

  test('task prompt narrows allowed ops and focused context', () => {
    const context: PageReviewContext = {
      pageNo: 1,
      reviewAssistanceEligibility: {
        pageNo: 1,
        eligible: true,
        kind: 'archaeological_data',
        score: 80,
        reasons: ['table_present'],
        exclusionReasons: [],
      },
      pageSize: { width: 100, height: 200 },
      pageImagePath: '/tmp/page.png',
      textBlocks: [
        {
          ref: '#/texts/0',
          label: 'text',
          text: 'Test',
          suspectReasons: ['hanja_ocr_candidate'],
        },
      ],
      missingTextCandidates: [],
      tables: [
        {
          ref: '#/tables/0',
          gridPreview: [['A']],
          emptyCellRatio: 0,
          suspectReasons: [],
        },
      ],
      pictures: [
        {
          ref: '#/pictures/0',
          suspectReasons: ['image_missing_caption'],
        },
      ],
      orphanCaptions: [],
      footnotes: [],
      layout: {
        readingOrderRefs: ['#/texts/0'],
        visualOrderRefs: ['#/texts/0'],
        bboxWarnings: [],
      },
      domainPatterns: [
        { targetRef: '#/texts/0', pattern: 'hanja_term', value: '山' },
      ],
    };

    const task = REVIEW_ASSISTANCE_TASKS.find(
      (entry) => entry.id === 'text_ocr_hanja',
    )!;
    const prompt = buildReviewAssistancePrompt(context, task);

    expect(prompt).toContain('TASK: Text OCR and Hanja correction');
    expect(prompt).toContain('Allowed ops for this task: replaceText');
    expect(prompt).toContain('"domainPatterns"');
    expect(prompt).not.toContain('"gridPreview"');
    expect(prompt).not.toContain('"splitCandidate"');
  });

  test('picture task exposes split candidates only for candidate-backed pictures', () => {
    const context: PageReviewContext = {
      pageNo: 1,
      reviewAssistanceEligibility: {
        pageNo: 1,
        eligible: true,
        kind: 'archaeological_data',
        score: 80,
        reasons: ['picture_present'],
        exclusionReasons: [],
      },
      pageSize: { width: 100, height: 200 },
      pageImagePath: '/tmp/page.png',
      textBlocks: [
        {
          ref: '#/texts/0',
          label: 'text',
          text: 'Inside picture',
          suspectReasons: ['picture_internal_text'],
        },
        {
          ref: '#/texts/1',
          label: 'text',
          text: 'Caption-like',
          suspectReasons: ['caption_like_body_text'],
        },
        {
          ref: '#/texts/2',
          label: 'caption',
          text: 'Caption label',
          suspectReasons: [],
        },
      ],
      missingTextCandidates: [],
      tables: [],
      pictures: [
        {
          ref: '#/pictures/0',
          bbox: { l: 0, t: 0, r: 100, b: 100, coord_origin: 'TOPLEFT' },
          splitCandidate: {
            score: 0.88,
            orientation: 'vertical',
            reasons: ['vertical_gutter_with_content_on_both_sides'],
          },
          suspectReasons: ['picture_split_boundary_candidate'],
        },
      ],
      orphanCaptions: [],
      footnotes: [],
      layout: {
        readingOrderRefs: ['#/pictures/0'],
        visualOrderRefs: ['#/pictures/0'],
        bboxWarnings: [],
      },
      domainPatterns: [],
    };
    const task = REVIEW_ASSISTANCE_TASKS.find(
      (entry) => entry.id === 'pictures_captions',
    )!;
    const prompt = buildReviewAssistancePrompt(context, task);

    expect(prompt).toContain('Allowed ops for this task');
    expect(prompt).toContain('"splitCandidate"');
    expect(prompt).toContain('picture_split_boundary_candidate');
    expect(prompt).toContain('picture_internal_text');
    expect(prompt).toContain('caption_like_body_text');
    expect(prompt).toContain('Caption label');
  });

  test('출력 언어 지시를 포함한다', () => {
    const context: PageReviewContext = {
      pageNo: 1,
      reviewAssistanceEligibility: {
        pageNo: 1,
        eligible: false,
        kind: 'non_meaningful',
        score: 0,
        reasons: [],
        exclusionReasons: ['no_structural_review_signal'],
      },
      pageSize: { width: 100, height: 200 },
      pageImagePath: '/tmp/page.png',
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
    };
    const prompt = buildReviewAssistancePrompt(context, undefined, {
      outputLanguage: 'ko-KR',
    });

    expect(prompt).toContain('OUTPUT LANGUAGE: ko-KR');
    expect(prompt).toContain('Write rationale and pageNotes in ko-KR');
    expect(prompt).toContain(
      'Keep evidence as a short verbatim source snippet when possible',
    );
  });

  test('includes validation feedback for re-ask attempts', () => {
    const context: PageReviewContext = {
      pageNo: 1,
      reviewAssistanceEligibility: {
        pageNo: 1,
        eligible: true,
        kind: 'archaeological_data',
        score: 80,
        reasons: ['text'],
        exclusionReasons: [],
      },
      pageSize: { width: 100, height: 200 },
      pageImagePath: '/tmp/page.png',
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
    };
    const prompt = buildReviewAssistancePrompt(context, undefined, {
      validationFeedback: ['target_ref_not_found'],
    });

    expect(prompt).toContain('VALIDATION FEEDBACK FOR ATTEMPT 2');
    expect(prompt).toContain('- target_ref_not_found');
  });
});
