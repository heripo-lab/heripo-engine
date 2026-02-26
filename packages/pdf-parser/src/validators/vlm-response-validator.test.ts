import type { VlmPageElement } from '../types/vlm-page-result';

import { describe, expect, test } from 'vitest';

import { VlmResponseValidator } from './vlm-response-validator';

/** Helper to create a text element */
function textElement(content: string, order: number): VlmPageElement {
  return { type: 'text', content, order };
}

/** Helper to create a picture element */
function pictureElement(order: number): VlmPageElement {
  return {
    type: 'picture',
    content: '',
    order,
    bbox: { l: 0, t: 0, r: 1, b: 1 },
  };
}

describe('VlmResponseValidator', () => {
  describe('validate', () => {
    test('returns valid for empty elements array', () => {
      const result = VlmResponseValidator.validate([], ['ko-KR']);
      expect(result.isValid).toBe(true);
      expect(result.issues).toEqual([]);
    });

    test('returns valid for picture-only elements', () => {
      const result = VlmResponseValidator.validate(
        [pictureElement(0), pictureElement(1)],
        ['ko-KR'],
      );
      expect(result.isValid).toBe(true);
      expect(result.issues).toEqual([]);
    });

    test('returns valid for normal Korean text elements', () => {
      const result = VlmResponseValidator.validate(
        [
          textElement(
            '아산 지산공원 수목식재사업부지내 문화유적 발굴조사 보고서',
            0,
          ),
          textElement('본 조사에서는 정밀한 층위 분석을 수행하였다.', 1),
        ],
        ['ko-KR'],
      );
      expect(result.isValid).toBe(true);
      expect(result.issues).toEqual([]);
    });

    test('returns valid for Korean text with some English terms', () => {
      const result = VlmResponseValidator.validate(
        [
          textElement('OCR 엔진을 사용하여 PDF를 변환합니다.', 0),
          textElement('VLM (Vision Language Model) 기반 처리', 1),
        ],
        ['ko-KR'],
      );
      expect(result.isValid).toBe(true);
    });

    test('returns valid for Korean text with numbers and punctuation', () => {
      const result = VlmResponseValidator.validate(
        [textElement('유적번호 15, 16, 17 (2009년 조사)', 0)],
        ['ko-KR'],
      );
      expect(result.isValid).toBe(true);
    });

    test('returns valid without documentLanguages even for Latin text', () => {
      const result = VlmResponseValidator.validate([
        textElement(
          'This is entirely English text that would normally be flagged.',
          0,
        ),
      ]);
      expect(result.isValid).toBe(true);
    });

    test('reports both placeholder and script anomaly when both present', () => {
      const result = VlmResponseValidator.validate(
        [
          textElement(
            'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
            0,
          ),
        ],
        ['ko-KR'],
      );
      expect(result.isValid).toBe(false);
      const issueTypes = result.issues.map((i) => i.type);
      expect(issueTypes).toContain('placeholder_text');
      expect(issueTypes).toContain('script_anomaly');
    });

    test('returns isValid=false when any issue is detected', () => {
      const result = VlmResponseValidator.validate(
        [textElement('Lorem ipsum dolor sit amet.', 0)],
        ['ko-KR'],
      );
      expect(result.isValid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    test('returns isValid=true only when no issues found', () => {
      const result = VlmResponseValidator.validate(
        [textElement('정상적인 한국어 텍스트입니다.', 0)],
        ['ko-KR'],
      );
      expect(result.isValid).toBe(true);
      expect(result.issues).toEqual([]);
    });
  });

  describe('placeholder text detection', () => {
    test('detects "Lorem ipsum" in element content', () => {
      const result = VlmResponseValidator.validate([
        textElement('Lorem ipsum is placeholder text.', 0),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].type).toBe('placeholder_text');
    });

    test('detects "dolor sit amet" variant', () => {
      const result = VlmResponseValidator.validate([
        textElement('Some text dolor sit amet and more.', 0),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].type).toBe('placeholder_text');
    });

    test('detects "consectetur adipiscing" variant', () => {
      const result = VlmResponseValidator.validate([
        textElement('Text with consectetur adipiscing elit.', 0),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].type).toBe('placeholder_text');
    });

    test('detects "sed do eiusmod" variant', () => {
      const result = VlmResponseValidator.validate([
        textElement('Text with sed do eiusmod tempor.', 0),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].type).toBe('placeholder_text');
    });

    test('detects "ut labore et dolore" variant', () => {
      const result = VlmResponseValidator.validate([
        textElement('Text with ut labore et dolore magna.', 0),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].type).toBe('placeholder_text');
    });

    test('detects placeholder case-insensitively', () => {
      const result = VlmResponseValidator.validate([
        textElement('LOREM IPSUM DOLOR SIT AMET.', 0),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].type).toBe('placeholder_text');
    });

    test('reports correct affected element orders', () => {
      const result = VlmResponseValidator.validate([
        textElement('Normal text here.', 0),
        textElement('Lorem ipsum dolor sit amet.', 1),
        textElement('Another normal line.', 2),
        textElement('Sed do eiusmod tempor.', 3),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].affectedElements).toEqual([1, 3]);
    });

    test('detects placeholder across multiple elements', () => {
      const result = VlmResponseValidator.validate([
        textElement('Lorem ipsum text.', 0),
        textElement('More lorem ipsum content.', 1),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].affectedElements).toHaveLength(2);
    });

    test('does not flag normal Latin text as placeholder', () => {
      const result = VlmResponseValidator.validate([
        textElement('The archaeological site was discovered in 2009.', 0),
      ]);
      expect(result.isValid).toBe(true);
    });
  });

  describe('script anomaly detection', () => {
    test('detects all-Latin content when documentLanguages starts with ko', () => {
      const result = VlmResponseValidator.validate(
        [
          textElement(
            'At the outset of the proceedings, the claimant presented evidence.',
            0,
          ),
        ],
        ['ko-KR'],
      );
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.type === 'script_anomaly')).toBe(true);
    });

    test('detects all-Latin content even with numbers mixed in', () => {
      const result = VlmResponseValidator.validate(
        [textElement('Section 12.3 of the report dated 2024-01-15', 0)],
        ['ko-KR'],
      );
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.type === 'script_anomaly')).toBe(true);
    });

    test('does not flag when documentLanguages is not set', () => {
      const result = VlmResponseValidator.validate([
        textElement(
          'Entirely English text without any Korean characters at all.',
          0,
        ),
      ]);
      expect(result.isValid).toBe(true);
    });

    test('does not flag when documentLanguages is en-US', () => {
      const result = VlmResponseValidator.validate(
        [textElement('English text that should not be flagged as anomaly.', 0)],
        ['en-US'],
      );
      expect(result.isValid).toBe(true);
    });

    test('does not flag Korean text with some Latin terms when ratio is above threshold', () => {
      // ~50% Korean characters — well above 10% threshold
      const result = VlmResponseValidator.validate(
        [textElement('한국어 text와 English가 mixed된 content입니다.', 0)],
        ['ko-KR'],
      );
      expect(result.isValid).toBe(true);
    });

    test('skips validation for content shorter than minimum length', () => {
      // Short Latin text (< 20 non-whitespace chars) should not be flagged
      const result = VlmResponseValidator.validate(
        [textElement('Page 5', 0)],
        ['ko-KR'],
      );
      expect(result.isValid).toBe(true);
    });

    test('skips validation for whitespace-only content', () => {
      const result = VlmResponseValidator.validate(
        [textElement('   \n\t   ', 0)],
        ['ko-KR'],
      );
      // whitespace-only: non-whitespace length is 0 → skip
      expect(result.isValid).toBe(true);
    });

    test('correctly calculates Hangul character ratio', () => {
      // 10 Hangul + 10 Latin + 5 numbers = 25 non-whitespace chars → 40% Korean
      const result = VlmResponseValidator.validate(
        [textElement('가나다라마바사아자차 abcdefghij 12345', 0)],
        ['ko-KR'],
      );
      expect(result.isValid).toBe(true);
    });

    test('includes CJK characters (Hanja) in Korean ratio calculation', () => {
      // Hanja characters count toward Korean/CJK ratio
      const result = VlmResponseValidator.validate(
        [textElement('遺蹟 發掘 調査 報告書 文化財 research', 0)],
        ['ko-KR'],
      );
      expect(result.isValid).toBe(true);
    });

    test('reports all element orders as affected for script anomaly', () => {
      const result = VlmResponseValidator.validate(
        [
          textElement('English paragraph one with enough text.', 0),
          textElement('English paragraph two with more content.', 1),
        ],
        ['ko-KR'],
      );
      expect(result.isValid).toBe(false);
      const scriptIssue = result.issues.find(
        (i) => i.type === 'script_anomaly',
      );
      expect(scriptIssue?.affectedElements).toEqual([0, 1]);
    });

    test('includes ratio percentage in script anomaly message', () => {
      const result = VlmResponseValidator.validate(
        [textElement('All English text without Korean characters here.', 0)],
        ['ko-KR'],
      );
      const scriptIssue = result.issues.find(
        (i) => i.type === 'script_anomaly',
      );
      expect(scriptIssue?.message).toContain('0.0%');
      expect(scriptIssue?.message).toContain('10%');
    });
  });

  describe('meta description detection', () => {
    test('detects Korean meta description about image resolution', () => {
      const result = VlmResponseValidator.validate([
        textElement('이미지 해상도가 낮아 판독하기 어렵습니다.', 0),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.type === 'meta_description')).toBe(
        true,
      );
    });

    test('detects Korean pattern: 해상도가 부족', () => {
      const result = VlmResponseValidator.validate([
        textElement('해상도가 부족하여 텍스트를 판독할 수 없습니다.', 0),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.type === 'meta_description')).toBe(
        true,
      );
    });

    test('detects Korean pattern: 글자를 읽기 어렵', () => {
      const result = VlmResponseValidator.validate([
        textElement('글자를 읽기 어렵습니다.', 0),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.type === 'meta_description')).toBe(
        true,
      );
    });

    test('detects Korean pattern: 정확한 판독이 불가', () => {
      const result = VlmResponseValidator.validate([
        textElement('정확한 판독이 불가합니다.', 0),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.type === 'meta_description')).toBe(
        true,
      );
    });

    test('detects English meta description: "the image contains"', () => {
      const result = VlmResponseValidator.validate([
        textElement(
          'The image contains Korean text that is difficult to read.',
          0,
        ),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.type === 'meta_description')).toBe(
        true,
      );
    });

    test('detects English meta description: "unable to transcribe"', () => {
      const result = VlmResponseValidator.validate([
        textElement('Unable to transcribe the text due to low resolution.', 0),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.type === 'meta_description')).toBe(
        true,
      );
    });

    test('detects English meta description: "resolution too low"', () => {
      const result = VlmResponseValidator.validate([
        textElement('The resolution is too low to read the text.', 0),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.type === 'meta_description')).toBe(
        true,
      );
    });

    test('detects English meta description: "text is not legible"', () => {
      const result = VlmResponseValidator.validate([
        textElement('The text is not legible in this image.', 0),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.type === 'meta_description')).toBe(
        true,
      );
    });

    test('detects English meta description: "exact transcription is not possible"', () => {
      const result = VlmResponseValidator.validate([
        textElement(
          'The exact transcription is not possible due to image quality.',
          0,
        ),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.type === 'meta_description')).toBe(
        true,
      );
    });

    test('does not flag normal text as meta description', () => {
      const result = VlmResponseValidator.validate([
        textElement(
          '아산 지산공원 수목식재사업부지내 문화유적 발굴조사 보고서',
          0,
        ),
      ]);
      const metaIssue = result.issues.find(
        (i) => i.type === 'meta_description',
      );
      expect(metaIssue).toBeUndefined();
    });

    test('reports correct affected element orders for meta description', () => {
      const result = VlmResponseValidator.validate([
        textElement('Normal text here.', 0),
        textElement('이미지 해상도가 낮습니다.', 1),
        textElement('Another normal line.', 2),
      ]);
      const metaIssue = result.issues.find(
        (i) => i.type === 'meta_description',
      );
      expect(metaIssue?.affectedElements).toEqual([1]);
    });
  });

  describe('repetitive pattern detection', () => {
    test('detects repetitive colon pattern ": : : : : : :"', () => {
      const repetitive = ': : : : : : : : : : : : : : : : : : : :';
      const result = VlmResponseValidator.validate([
        textElement(repetitive, 0),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.type === 'repetitive_pattern')).toBe(
        true,
      );
    });

    test('detects repetitive equals pattern "= = = = = = ="', () => {
      const repetitive = '= = = = = = = = = = = = = = = = = = = =';
      const result = VlmResponseValidator.validate([
        textElement(repetitive, 0),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.type === 'repetitive_pattern')).toBe(
        true,
      );
    });

    test('does not flag normal text as repetitive', () => {
      const result = VlmResponseValidator.validate([
        textElement('This is a normal paragraph with varied content.', 0),
      ]);
      const repIssue = result.issues.find(
        (i) => i.type === 'repetitive_pattern',
      );
      expect(repIssue).toBeUndefined();
    });

    test('does not flag short repetitive patterns below ratio threshold', () => {
      // Small repetitive portion in a larger text
      const result = VlmResponseValidator.validate([
        textElement(
          'Normal text with lots of content that is much longer than any pattern. ' +
            'More text to make the ratio low. Even more text to ensure the ratio stays under threshold. ' +
            'And yet more text. : : : : :',
          0,
        ),
      ]);
      const repIssue = result.issues.find(
        (i) => i.type === 'repetitive_pattern',
      );
      expect(repIssue).toBeUndefined();
    });

    test('does not flag patterns with fewer than 5 repetitions', () => {
      const result = VlmResponseValidator.validate([textElement(': : : :', 0)]);
      const repIssue = result.issues.find(
        (i) => i.type === 'repetitive_pattern',
      );
      expect(repIssue).toBeUndefined();
    });

    test('includes ratio in repetitive pattern message', () => {
      const repetitive = ': : : : : : : : : : : : : : : : : : : :';
      const result = VlmResponseValidator.validate([
        textElement(repetitive, 0),
      ]);
      const repIssue = result.issues.find(
        (i) => i.type === 'repetitive_pattern',
      );
      expect(repIssue?.message).toContain('% of content');
    });

    test('reports all element orders as affected for repetitive pattern', () => {
      const repetitive = ': : : : : : : : : : : : : : : : : : : :';
      const result = VlmResponseValidator.validate([
        textElement(repetitive, 0),
        textElement(repetitive, 1),
      ]);
      const repIssue = result.issues.find(
        (i) => i.type === 'repetitive_pattern',
      );
      expect(repIssue?.affectedElements).toEqual([0, 1]);
    });
  });
});
