import { describe, expect, test } from 'vitest';

import {
  PAGE_ANALYSIS_PROMPT,
  TEXT_REFERENCE_PROMPT,
} from './page-analysis-prompt';

describe('PAGE_ANALYSIS_PROMPT', () => {
  test('is a non-empty string', () => {
    expect(typeof PAGE_ANALYSIS_PROMPT).toBe('string');
    expect(PAGE_ANALYSIS_PROMPT.length).toBeGreaterThan(0);
  });

  test('starts with analysis instruction', () => {
    expect(PAGE_ANALYSIS_PROMPT).toMatch(
      /^Analyze the page image and extract all content elements/,
    );
  });

  test('contains element type codes', () => {
    for (const code of ['tx', 'sh', 'ca', 'fn', 'ph', 'pf', 'li', 'pi', 'tb']) {
      expect(PAGE_ANALYSIS_PROMPT).toContain(`"${code}"`);
    }
  });

  test('contains example output section', () => {
    expect(PAGE_ANALYSIS_PROMPT).toContain('## Example Output');
  });

  test('contains rules section', () => {
    expect(PAGE_ANALYSIS_PROMPT).toContain('## Rules');
  });

  test('이미지 내부 텍스트는 추출하지 않고 외부 캡션만 추출하도록 안내한다', () => {
    expect(PAGE_ANALYSIS_PROMPT).toContain(
      'Treat photos, maps, drawings, diagrams, plates',
    );
    expect(PAGE_ANALYSIS_PROMPT).toContain(
      'Do NOT extract labels, legends, handwriting, signs',
    );
    expect(PAGE_ANALYSIS_PROMPT).toContain(
      'Only text outside or directly adjacent to a picture',
    );
  });
});

describe('TEXT_REFERENCE_PROMPT', () => {
  test('is a non-empty string', () => {
    expect(typeof TEXT_REFERENCE_PROMPT).toBe('string');
    expect(TEXT_REFERENCE_PROMPT.length).toBeGreaterThan(0);
  });

  test('starts with TEXT REFERENCE label', () => {
    expect(TEXT_REFERENCE_PROMPT).toMatch(/^TEXT REFERENCE:/);
  });

  test('contains usage guidance', () => {
    expect(TEXT_REFERENCE_PROMPT).toContain('use it as-is');
    expect(TEXT_REFERENCE_PROMPT).toContain('IGNORE it entirely');
    expect(TEXT_REFERENCE_PROMPT).toContain('Do NOT blindly trust');
    expect(TEXT_REFERENCE_PROMPT).toContain(
      'Ignore text-layer snippets that belong inside picture regions',
    );
  });
});
