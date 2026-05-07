import { describe, expect, test } from 'vitest';

import {
  REVIEW_ASSISTANCE_EVIDENCE_MAX_LENGTH,
  REVIEW_ASSISTANCE_PAGE_NOTE_MAX_LENGTH,
  REVIEW_ASSISTANCE_RATIONALE_MAX_LENGTH,
  reviewAssistancePageSchema,
} from './review-assistance-schema';

describe('Review Assistance 응답 스키마', () => {
  test('긴 evidence 문단을 허용하고 상한을 유지한다', () => {
    const output = {
      pageNo: 12,
      commands: [
        {
          op: 'replaceText',
          targetRef: '#/texts/94',
          payload: {},
          confidence: 0.9,
          rationale: '한자와 수치 OCR 오류를 교정한다.',
          evidence: '가'.repeat(REVIEW_ASSISTANCE_EVIDENCE_MAX_LENGTH),
        },
      ],
      pageNotes: [],
    };

    expect(reviewAssistancePageSchema.safeParse(output).success).toBe(true);
    expect(
      reviewAssistancePageSchema.safeParse({
        ...output,
        commands: [
          {
            ...output.commands[0],
            evidence: '가'.repeat(REVIEW_ASSISTANCE_EVIDENCE_MAX_LENGTH + 1),
          },
        ],
      }).success,
    ).toBe(false);
  });

  test('긴 rationale과 page note를 허용하고 상한을 유지한다', () => {
    const output = {
      pageNo: 16,
      commands: [
        {
          op: 'replaceText',
          targetRef: '#/texts/203',
          payload: { text: '교정된 텍스트' },
          confidence: 0.9,
          rationale: '가'.repeat(REVIEW_ASSISTANCE_RATIONALE_MAX_LENGTH),
          evidence: null,
        },
      ],
      pageNotes: ['나'.repeat(REVIEW_ASSISTANCE_PAGE_NOTE_MAX_LENGTH)],
    };

    expect(reviewAssistancePageSchema.safeParse(output).success).toBe(true);
    expect(
      reviewAssistancePageSchema.safeParse({
        ...output,
        commands: [
          {
            ...output.commands[0],
            rationale: '가'.repeat(REVIEW_ASSISTANCE_RATIONALE_MAX_LENGTH + 1),
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      reviewAssistancePageSchema.safeParse({
        ...output,
        pageNotes: ['나'.repeat(REVIEW_ASSISTANCE_PAGE_NOTE_MAX_LENGTH + 1)],
      }).success,
    ).toBe(false);
  });
});
