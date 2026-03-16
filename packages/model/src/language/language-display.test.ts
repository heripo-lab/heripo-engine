import { describe, expect, test } from 'vitest';

import {
  LANGUAGE_DISPLAY_NAMES,
  buildLanguageDescription,
  getLanguageDisplayName,
} from './language-display';

describe('LANGUAGE_DISPLAY_NAMES', () => {
  test('contains expected language entries', () => {
    expect(LANGUAGE_DISPLAY_NAMES['ko']).toBe('Korean (한국어)');
    expect(LANGUAGE_DISPLAY_NAMES['en']).toBe('English');
    expect(LANGUAGE_DISPLAY_NAMES['ja']).toBe('Japanese (日本語)');
  });
});

describe('getLanguageDisplayName', () => {
  test('returns display name for known ISO 639-1 code', () => {
    expect(getLanguageDisplayName('ko')).toBe('Korean (한국어)');
    expect(getLanguageDisplayName('en')).toBe('English');
  });

  test('extracts base code from BCP 47 tag', () => {
    expect(getLanguageDisplayName('ko-KR')).toBe('Korean (한국어)');
    expect(getLanguageDisplayName('en-US')).toBe('English');
  });

  test('returns raw code for unknown language', () => {
    expect(getLanguageDisplayName('xx')).toBe('xx');
    expect(getLanguageDisplayName('xx-YY')).toBe('xx-YY');
  });

  test('returns "unknown" for undefined input', () => {
    expect(getLanguageDisplayName(undefined)).toBe('unknown');
  });

  test('returns "unknown" for empty string', () => {
    expect(getLanguageDisplayName('')).toBe('unknown');
  });
});

describe('buildLanguageDescription', () => {
  test('returns single-language description', () => {
    expect(buildLanguageDescription(['ko-KR'])).toBe(
      'written in Korean (한국어)',
    );
  });

  test('returns multi-language description', () => {
    expect(buildLanguageDescription(['ko-KR', 'en-US'])).toBe(
      'primarily written in Korean (한국어), with English also present',
    );
  });

  test('handles three or more languages', () => {
    expect(buildLanguageDescription(['ko-KR', 'en-US', 'ja'])).toBe(
      'primarily written in Korean (한국어), with English, Japanese (日本語) also present',
    );
  });

  test('handles unknown language codes', () => {
    expect(buildLanguageDescription(['xx'])).toBe('written in xx');
  });
});
