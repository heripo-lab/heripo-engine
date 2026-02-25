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
      const result = VlmResponseValidator.validate([], 'ko');
      expect(result.isValid).toBe(true);
      expect(result.issues).toEqual([]);
    });

    test('returns valid for picture-only elements', () => {
      const result = VlmResponseValidator.validate(
        [pictureElement(0), pictureElement(1)],
        'ko',
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
        'ko',
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
        'ko',
      );
      expect(result.isValid).toBe(true);
    });

    test('returns valid for Korean text with numbers and punctuation', () => {
      const result = VlmResponseValidator.validate(
        [textElement('유적번호 15, 16, 17 (2009년 조사)', 0)],
        'ko',
      );
      expect(result.isValid).toBe(true);
    });

    test('returns valid without documentLanguage even for Latin text', () => {
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
        'ko',
      );
      expect(result.isValid).toBe(false);
      const issueTypes = result.issues.map((i) => i.type);
      expect(issueTypes).toContain('placeholder_text');
      expect(issueTypes).toContain('script_anomaly');
    });

    test('returns isValid=false when any issue is detected', () => {
      const result = VlmResponseValidator.validate(
        [textElement('Lorem ipsum dolor sit amet.', 0)],
        'ko',
      );
      expect(result.isValid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    test('returns isValid=true only when no issues found', () => {
      const result = VlmResponseValidator.validate(
        [textElement('정상적인 한국어 텍스트입니다.', 0)],
        'ko',
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
    test('detects all-Latin content when documentLanguage is ko', () => {
      const result = VlmResponseValidator.validate(
        [
          textElement(
            'At the outset of the proceedings, the claimant presented evidence.',
            0,
          ),
        ],
        'ko',
      );
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.type === 'script_anomaly')).toBe(true);
    });

    test('detects all-Latin content even with numbers mixed in', () => {
      const result = VlmResponseValidator.validate(
        [textElement('Section 12.3 of the report dated 2024-01-15', 0)],
        'ko',
      );
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.type === 'script_anomaly')).toBe(true);
    });

    test('does not flag when documentLanguage is not set', () => {
      const result = VlmResponseValidator.validate([
        textElement(
          'Entirely English text without any Korean characters at all.',
          0,
        ),
      ]);
      expect(result.isValid).toBe(true);
    });

    test('does not flag when documentLanguage is en', () => {
      const result = VlmResponseValidator.validate(
        [textElement('English text that should not be flagged as anomaly.', 0)],
        'en',
      );
      expect(result.isValid).toBe(true);
    });

    test('does not flag Korean text with some Latin terms when ratio is above threshold', () => {
      // ~50% Korean characters — well above 10% threshold
      const result = VlmResponseValidator.validate(
        [textElement('한국어 text와 English가 mixed된 content입니다.', 0)],
        'ko',
      );
      expect(result.isValid).toBe(true);
    });

    test('skips validation for content shorter than minimum length', () => {
      // Short Latin text (< 20 non-whitespace chars) should not be flagged
      const result = VlmResponseValidator.validate(
        [textElement('Page 5', 0)],
        'ko',
      );
      expect(result.isValid).toBe(true);
    });

    test('skips validation for whitespace-only content', () => {
      const result = VlmResponseValidator.validate(
        [textElement('   \n\t   ', 0)],
        'ko',
      );
      // whitespace-only: non-whitespace length is 0 → skip
      expect(result.isValid).toBe(true);
    });

    test('correctly calculates Hangul character ratio', () => {
      // 10 Hangul + 10 Latin + 5 numbers = 25 non-whitespace chars → 40% Korean
      const result = VlmResponseValidator.validate(
        [textElement('가나다라마바사아자차 abcdefghij 12345', 0)],
        'ko',
      );
      expect(result.isValid).toBe(true);
    });

    test('includes CJK characters (Hanja) in Korean ratio calculation', () => {
      // Hanja characters count toward Korean/CJK ratio
      const result = VlmResponseValidator.validate(
        [textElement('遺蹟 發掘 調査 報告書 文化財 research', 0)],
        'ko',
      );
      expect(result.isValid).toBe(true);
    });

    test('reports all element orders as affected for script anomaly', () => {
      const result = VlmResponseValidator.validate(
        [
          textElement('English paragraph one with enough text.', 0),
          textElement('English paragraph two with more content.', 1),
        ],
        'ko',
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
        'ko',
      );
      const scriptIssue = result.issues.find(
        (i) => i.type === 'script_anomaly',
      );
      expect(scriptIssue?.message).toContain('0.0%');
      expect(scriptIssue?.message).toContain('10%');
    });
  });
});
