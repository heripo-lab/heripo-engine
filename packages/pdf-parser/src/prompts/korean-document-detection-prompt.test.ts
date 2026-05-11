import { describe, expect, test } from 'vitest';

import { KOREAN_DOCUMENT_DETECTION_PROMPT } from './korean-document-detection-prompt';

describe('KOREAN_DOCUMENT_DETECTION_PROMPT', () => {
  test('is a non-empty string', () => {
    expect(typeof KOREAN_DOCUMENT_DETECTION_PROMPT).toBe('string');
    expect(KOREAN_DOCUMENT_DETECTION_PROMPT.length).toBeGreaterThan(0);
  });

  test('contains Korean language detection instructions', () => {
    expect(KOREAN_DOCUMENT_DETECTION_PROMPT).toContain('Korean text');
    expect(KOREAN_DOCUMENT_DETECTION_PROMPT).toContain('ko-KR');
  });

  test('contains supported language tags', () => {
    expect(KOREAN_DOCUMENT_DETECTION_PROMPT).toContain('en-US');
    expect(KOREAN_DOCUMENT_DETECTION_PROMPT).toContain('ja-JP');
    expect(KOREAN_DOCUMENT_DETECTION_PROMPT).toContain('zh-Hant');
  });
});
