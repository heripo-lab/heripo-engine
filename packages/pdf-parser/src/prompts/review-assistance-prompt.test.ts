import type { PageReviewContext } from '../processors/review-assistance/page-review-context-builder';

import { describe, expect, test } from 'vitest';

import {
  REVIEW_ASSISTANCE_SYSTEM_PROMPT,
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
  });

  test('serializes all page review context sections into prompt JSON', () => {
    const context: PageReviewContext = {
      pageNo: 1,
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
  });
});
