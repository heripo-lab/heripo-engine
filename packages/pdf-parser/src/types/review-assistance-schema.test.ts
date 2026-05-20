import { describe, expect, test } from 'vitest';

import {
  REVIEW_ASSISTANCE_EVIDENCE_MAX_LENGTH,
  REVIEW_ASSISTANCE_MISSING_ENUM_SENTINEL,
  REVIEW_ASSISTANCE_PAGE_NOTE_MAX_LENGTH,
  REVIEW_ASSISTANCE_RATIONALE_MAX_LENGTH,
  buildReviewAssistancePageSchemaForOps,
  reviewAssistancePageSchema,
} from './review-assistance-schema';

describe('Review Assistance 응답 스키마', () => {
  test('긴 evidence 문단을 허용하고 상한을 유지한다', () => {
    const output = {
      pageNo: 12,
      commands: [
        {
          op: 'replaceText',
          textRef: '#/texts/94',
          text: '교정된 텍스트',
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
          textRef: '#/texts/203',
          text: '교정된 텍스트',
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

describe('buildReviewAssistancePageSchemaForOps', () => {
  test('단일 op task 는 strict 단일 객체 스키마를 유지한다', () => {
    const schema = buildReviewAssistancePageSchemaForOps(['replaceText']);
    const parsed = schema.safeParse({
      pageNo: 1,
      commands: [
        {
          op: 'replaceText',
          textRef: '#/texts/0',
          text: '교정',
          confidence: 0.9,
          rationale: 'OCR 교정',
          evidence: null,
        },
      ],
      pageNotes: [],
    });
    expect(parsed.success).toBe(true);
  });

  test('multi-op task 는 flat 객체를 받아 타입드 command 로 transform 한다', () => {
    const schema = buildReviewAssistancePageSchemaForOps([
      'updateBbox',
      'moveNode',
    ]);
    const parsed = schema.safeParse({
      pageNo: 5,
      commands: [
        {
          op: 'moveNode',
          sourceRef: '#/texts/1',
          targetRef: '#/texts/2',
          position: 'after',
          confidence: 0.8,
          rationale: '읽기 순서 교정',
          evidence: null,
        },
      ],
      pageNotes: [],
    });
    expect(parsed.success).toBe(true);
    const command = parsed.success ? parsed.data.commands[0] : undefined;
    expect(command).toMatchObject({
      op: 'moveNode',
      sourceRef: '#/texts/1',
      targetRef: '#/texts/2',
      position: 'after',
    });
    // unrelated payload fields are not carried into the typed command
    expect(command).not.toHaveProperty('bbox');
  });

  test('flat 스키마는 미사용 페이로드 필드 생략을 허용한다', () => {
    const schema = buildReviewAssistancePageSchemaForOps([
      'updateBbox',
      'moveNode',
    ]);
    const parsed = schema.safeParse({
      pageNo: 2,
      commands: [
        {
          op: 'updateBbox',
          targetRef: '#/texts/3',
          bbox: { l: 1, t: 2, r: 3, b: 4 },
          confidence: 0.7,
          rationale: 'bbox 보정',
          evidence: null,
        },
      ],
      pageNotes: [],
    });
    expect(parsed.success).toBe(true);
  });

  test('필수 enum 누락 시 sentinel 로 transform 되어 이후 validator 가 거부할 수 있다', () => {
    const schema = buildReviewAssistancePageSchemaForOps([
      'updateBbox',
      'moveNode',
    ]);
    const parsed = schema.safeParse({
      pageNo: 3,
      commands: [
        {
          op: 'moveNode',
          sourceRef: '#/texts/1',
          targetRef: '#/texts/2',
          // position omitted
          confidence: 0.8,
          rationale: '순서 교정',
          evidence: null,
        },
      ],
      pageNotes: [],
    });
    expect(parsed.success).toBe(true);
    const command = parsed.success ? parsed.data.commands[0] : undefined;
    expect(command).toMatchObject({
      op: 'moveNode',
      position: REVIEW_ASSISTANCE_MISSING_ENUM_SENTINEL,
    });
  });

  test('빈/미지원 op 목록은 전체 op flat 스키마로 폴백한다 (LLM-facing union 없음)', () => {
    const schema = buildReviewAssistancePageSchemaForOps(undefined);
    // fallback is no longer the discriminated union — it is a flat object that
    // still parses a flat command from any op and transforms it to typed.
    expect(schema).not.toBe(reviewAssistancePageSchema);
    const parsed = schema.safeParse({
      pageNo: 1,
      commands: [
        {
          op: 'replaceText',
          textRef: '#/texts/0',
          text: '교정',
          confidence: 0.9,
          rationale: 'OCR',
          evidence: null,
        },
      ],
      pageNotes: [],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.commands[0] : undefined).toMatchObject({
      op: 'replaceText',
      textRef: '#/texts/0',
      text: '교정',
    });
  });
});
