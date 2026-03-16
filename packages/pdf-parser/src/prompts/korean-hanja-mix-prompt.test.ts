import { describe, expect, test } from 'vitest';

import { KOREAN_HANJA_MIX_PROMPT } from './korean-hanja-mix-prompt';

describe('KOREAN_HANJA_MIX_PROMPT', () => {
  test('is a non-empty string', () => {
    expect(typeof KOREAN_HANJA_MIX_PROMPT).toBe('string');
    expect(KOREAN_HANJA_MIX_PROMPT.length).toBeGreaterThan(0);
  });

  test('contains Hanja detection instructions', () => {
    expect(KOREAN_HANJA_MIX_PROMPT).toContain('Hanja');
    expect(KOREAN_HANJA_MIX_PROMPT).toContain('漢字');
  });

  test('contains supported language tags', () => {
    expect(KOREAN_HANJA_MIX_PROMPT).toContain('ko-KR');
    expect(KOREAN_HANJA_MIX_PROMPT).toContain('en-US');
    expect(KOREAN_HANJA_MIX_PROMPT).toContain('ja-JP');
  });
});
