import { describe, expect, test } from 'vitest';

import {
  REVIEW_ASSISTANCE_EVIDENCE_MAX_LENGTH,
  REVIEW_ASSISTANCE_MISSING_ENUM_SENTINEL,
  REVIEW_ASSISTANCE_PAGE_NOTE_MAX_LENGTH,
  REVIEW_ASSISTANCE_RATIONALE_MAX_LENGTH,
  buildReviewAssistancePageSchemaForOps,
  reviewAssistanceCommandOpSchema,
  reviewAssistancePageSchema,
} from './review-assistance-schema';

const flatBase = { confidence: 0.5, rationale: 'reason', evidence: null };
const flatBbox = { l: 1, t: 2, r: 3, b: 4 };
const fallbackBbox = { l: 0, t: 0, r: 0, b: 0 };
const sentinel = REVIEW_ASSISTANCE_MISSING_ENUM_SENTINEL;

function fullCell(text: string) {
  return {
    text,
    bbox: null,
    rowSpan: null,
    colSpan: null,
    columnHeader: null,
    rowHeader: null,
  };
}

function fullRegion() {
  return { id: null, bbox: flatBbox, imageUri: null, caption: null };
}

// A multi-op task schema routes each command through flatCommandToRawCommand
// (the discriminated union is never used as an LLM schema). Parsing a flat
// command therefore exercises every transform branch.
const flatSchema = buildReviewAssistancePageSchemaForOps(
  reviewAssistanceCommandOpSchema.options,
);

function fold(flat: Record<string, unknown>) {
  return flatSchema.parse({ pageNo: 1, commands: [flat], pageNotes: [] })
    .commands[0];
}

describe('flatCommandToRawCommand', () => {
  test('folds fully populated flat commands into typed raw commands', () => {
    expect(
      fold({ op: 'replaceText', textRef: 't', text: 'X', ...flatBase }),
    ).toEqual({ op: 'replaceText', textRef: 't', text: 'X', ...flatBase });
    expect(
      fold({
        op: 'addText',
        bbox: flatBbox,
        text: 'X',
        label: 'text',
        pageNo: 2,
        afterRef: 'a',
        ...flatBase,
      }),
    ).toEqual({
      op: 'addText',
      bbox: flatBbox,
      text: 'X',
      label: 'text',
      pageNo: 2,
      afterRef: 'a',
      ...flatBase,
    });
    expect(
      fold({
        op: 'updateTextRole',
        textRef: 't',
        label: 'caption',
        ...flatBase,
      }),
    ).toEqual({
      op: 'updateTextRole',
      textRef: 't',
      label: 'caption',
      ...flatBase,
    });
    expect(fold({ op: 'removeText', textRef: 't', ...flatBase })).toEqual({
      op: 'removeText',
      textRef: 't',
      ...flatBase,
    });
    expect(
      fold({
        op: 'mergeTexts',
        textRefs: ['a', 'b'],
        text: 'M',
        keepRef: 'a',
        ...flatBase,
      }),
    ).toEqual({
      op: 'mergeTexts',
      textRefs: ['a', 'b'],
      text: 'M',
      keepRef: 'a',
      ...flatBase,
    });
    expect(
      fold({
        op: 'splitText',
        textRef: 't',
        parts: [{ text: 'a', label: null }],
        ...flatBase,
      }),
    ).toEqual({
      op: 'splitText',
      textRef: 't',
      parts: [{ text: 'a', label: null }],
      ...flatBase,
    });
    expect(
      fold({
        op: 'updateTableCell',
        tableRef: 't',
        row: 1,
        col: 2,
        text: 'X',
        ...flatBase,
      }),
    ).toEqual({
      op: 'updateTableCell',
      tableRef: 't',
      row: 1,
      col: 2,
      text: 'X',
      ...flatBase,
    });
    expect(
      fold({
        op: 'replaceTable',
        tableRef: 't',
        grid: [[fullCell('A')]],
        caption: 'C',
        ...flatBase,
      }),
    ).toEqual({
      op: 'replaceTable',
      tableRef: 't',
      grid: [[fullCell('A')]],
      caption: 'C',
      ...flatBase,
    });
    expect(
      fold({
        op: 'linkContinuedTable',
        sourceTableRef: 's',
        continuedTableRef: 'c',
        relation: 'continues_on_next_page',
        ...flatBase,
      }),
    ).toEqual({
      op: 'linkContinuedTable',
      sourceTableRef: 's',
      continuedTableRef: 'c',
      relation: 'continues_on_next_page',
      ...flatBase,
    });
    expect(
      fold({
        op: 'updatePictureCaption',
        pictureRef: 'p',
        caption: 'C',
        ...flatBase,
      }),
    ).toEqual({
      op: 'updatePictureCaption',
      pictureRef: 'p',
      caption: 'C',
      ...flatBase,
    });
    expect(
      fold({
        op: 'addPicture',
        bbox: flatBbox,
        imageUri: 'u',
        caption: 'C',
        pageNo: 2,
        ...flatBase,
      }),
    ).toEqual({
      op: 'addPicture',
      bbox: flatBbox,
      imageUri: 'u',
      caption: 'C',
      pageNo: 2,
      ...flatBase,
    });
    expect(
      fold({
        op: 'splitPicture',
        pictureRef: 'p',
        regions: [fullRegion()],
        ...flatBase,
      }),
    ).toEqual({
      op: 'splitPicture',
      pictureRef: 'p',
      regions: [fullRegion()],
      ...flatBase,
    });
    expect(
      fold({ op: 'hidePicture', pictureRef: 'p', reason: 'dup', ...flatBase }),
    ).toEqual({
      op: 'hidePicture',
      pictureRef: 'p',
      reason: 'dup',
      ...flatBase,
    });
    expect(
      fold({ op: 'updateBbox', targetRef: 't', bbox: flatBbox, ...flatBase }),
    ).toEqual({
      op: 'updateBbox',
      targetRef: 't',
      bbox: flatBbox,
      ...flatBase,
    });
    expect(
      fold({
        op: 'linkFootnote',
        markerTextRef: 'm',
        footnoteTextRef: 'f',
        ...flatBase,
      }),
    ).toEqual({
      op: 'linkFootnote',
      markerTextRef: 'm',
      footnoteTextRef: 'f',
      ...flatBase,
    });
    expect(
      fold({
        op: 'moveNode',
        sourceRef: 's',
        targetRef: 't',
        position: 'after',
        ...flatBase,
      }),
    ).toEqual({
      op: 'moveNode',
      sourceRef: 's',
      targetRef: 't',
      position: 'after',
      ...flatBase,
    });
  });

  test('applies deterministic fallbacks when optional flat fields are omitted', () => {
    expect(fold({ op: 'replaceText', ...flatBase })).toEqual({
      op: 'replaceText',
      textRef: '',
      text: '',
      ...flatBase,
    });
    expect(fold({ op: 'addText', ...flatBase })).toEqual({
      op: 'addText',
      bbox: fallbackBbox,
      text: '',
      label: sentinel,
      pageNo: null,
      afterRef: null,
      ...flatBase,
    });
    expect(fold({ op: 'updateTextRole', ...flatBase })).toEqual({
      op: 'updateTextRole',
      textRef: '',
      label: sentinel,
      ...flatBase,
    });
    expect(fold({ op: 'removeText', ...flatBase })).toEqual({
      op: 'removeText',
      textRef: '',
      ...flatBase,
    });
    expect(fold({ op: 'mergeTexts', ...flatBase })).toEqual({
      op: 'mergeTexts',
      textRefs: [],
      text: '',
      keepRef: '',
      ...flatBase,
    });
    expect(fold({ op: 'splitText', ...flatBase })).toEqual({
      op: 'splitText',
      textRef: '',
      parts: [],
      ...flatBase,
    });
    expect(fold({ op: 'updateTableCell', ...flatBase })).toEqual({
      op: 'updateTableCell',
      tableRef: '',
      row: 0,
      col: 0,
      text: '',
      ...flatBase,
    });
    expect(fold({ op: 'replaceTable', ...flatBase })).toEqual({
      op: 'replaceTable',
      tableRef: '',
      grid: [],
      caption: null,
      ...flatBase,
    });
    expect(fold({ op: 'linkContinuedTable', ...flatBase })).toEqual({
      op: 'linkContinuedTable',
      sourceTableRef: '',
      continuedTableRef: '',
      relation: sentinel,
      ...flatBase,
    });
    expect(fold({ op: 'updatePictureCaption', ...flatBase })).toEqual({
      op: 'updatePictureCaption',
      pictureRef: '',
      caption: '',
      ...flatBase,
    });
    expect(fold({ op: 'addPicture', ...flatBase })).toEqual({
      op: 'addPicture',
      bbox: fallbackBbox,
      imageUri: '',
      caption: null,
      pageNo: null,
      ...flatBase,
    });
    expect(fold({ op: 'splitPicture', ...flatBase })).toEqual({
      op: 'splitPicture',
      pictureRef: '',
      regions: [],
      ...flatBase,
    });
    expect(fold({ op: 'hidePicture', ...flatBase })).toEqual({
      op: 'hidePicture',
      pictureRef: '',
      reason: '',
      ...flatBase,
    });
    expect(fold({ op: 'updateBbox', ...flatBase })).toEqual({
      op: 'updateBbox',
      targetRef: '',
      bbox: fallbackBbox,
      ...flatBase,
    });
    expect(fold({ op: 'linkFootnote', ...flatBase })).toEqual({
      op: 'linkFootnote',
      markerTextRef: '',
      footnoteTextRef: '',
      ...flatBase,
    });
    expect(fold({ op: 'moveNode', ...flatBase })).toEqual({
      op: 'moveNode',
      sourceRef: '',
      targetRef: '',
      position: sentinel,
      ...flatBase,
    });
  });

  test('drops unknown ops from allowedOps and falls back to the full op set', () => {
    const schema = buildReviewAssistancePageSchemaForOps([
      'bogus',
    ] as unknown as Parameters<
      typeof buildReviewAssistancePageSchemaForOps
    >[0]);
    expect(
      schema.safeParse({
        pageNo: 1,
        commands: [{ op: 'removeText', ...flatBase }],
        pageNotes: [],
      }).success,
    ).toBe(true);
  });
});

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
