import { describe, expect, test } from 'vitest';

import {
  BCP47_LANGUAGE_TAGS,
  BCP47_LANGUAGE_TAG_SET,
  isValidBcp47Tag,
  normalizeToBcp47,
} from './bcp47-language-tag';

describe('BCP47_LANGUAGE_TAGS', () => {
  test('contains expected language tags', () => {
    expect(BCP47_LANGUAGE_TAGS).toContain('ko-KR');
    expect(BCP47_LANGUAGE_TAGS).toContain('en-US');
    expect(BCP47_LANGUAGE_TAGS).toContain('ja-JP');
    expect(BCP47_LANGUAGE_TAGS).toContain('zh-Hans');
  });
});

describe('BCP47_LANGUAGE_TAG_SET', () => {
  test('provides O(1) lookup for valid tags', () => {
    expect(BCP47_LANGUAGE_TAG_SET.has('ko-KR')).toBe(true);
    expect(BCP47_LANGUAGE_TAG_SET.has('xx-YY')).toBe(false);
  });

  test('has same size as BCP47_LANGUAGE_TAGS array', () => {
    expect(BCP47_LANGUAGE_TAG_SET.size).toBe(BCP47_LANGUAGE_TAGS.length);
  });
});

describe('isValidBcp47Tag', () => {
  test('returns true for valid tags', () => {
    expect(isValidBcp47Tag('ko-KR')).toBe(true);
    expect(isValidBcp47Tag('en-US')).toBe(true);
    expect(isValidBcp47Tag('zh-Hans')).toBe(true);
  });

  test('returns false for invalid tags', () => {
    expect(isValidBcp47Tag('xx-YY')).toBe(false);
    expect(isValidBcp47Tag('ko')).toBe(false);
    expect(isValidBcp47Tag('')).toBe(false);
  });
});

describe('normalizeToBcp47', () => {
  test('returns valid full tag as-is', () => {
    expect(normalizeToBcp47('ko-KR')).toBe('ko-KR');
    expect(normalizeToBcp47('en-US')).toBe('en-US');
  });

  test('maps bare language code to default region', () => {
    expect(normalizeToBcp47('ko')).toBe('ko-KR');
    expect(normalizeToBcp47('en')).toBe('en-US');
    expect(normalizeToBcp47('ja')).toBe('ja-JP');
    expect(normalizeToBcp47('zh')).toBe('zh-Hans');
  });

  test('is case-insensitive for bare codes', () => {
    expect(normalizeToBcp47('KO')).toBe('ko-KR');
    expect(normalizeToBcp47('En')).toBe('en-US');
  });

  test('returns null for unknown tags', () => {
    expect(normalizeToBcp47('xx')).toBeNull();
    expect(normalizeToBcp47('xx-YY')).toBeNull();
    expect(normalizeToBcp47('und')).toBeNull();
    expect(normalizeToBcp47('')).toBeNull();
  });
});
