import { describe, expect, test } from 'vitest';

import { TEXT_CORRECTION_SYSTEM_PROMPT } from './text-correction-prompt';

describe('TEXT_CORRECTION_SYSTEM_PROMPT', () => {
  test('is a non-empty string', () => {
    expect(typeof TEXT_CORRECTION_SYSTEM_PROMPT).toBe('string');
    expect(TEXT_CORRECTION_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  test('starts with role description', () => {
    expect(TEXT_CORRECTION_SYSTEM_PROMPT).toMatch(
      /^You are a text correction engine/,
    );
  });

  test('contains input format instructions', () => {
    expect(TEXT_CORRECTION_SYSTEM_PROMPT).toContain('Input format:');
    expect(TEXT_CORRECTION_SYSTEM_PROMPT).toContain('T: (text elements)');
    expect(TEXT_CORRECTION_SYSTEM_PROMPT).toContain('C: (table cells)');
  });

  test('contains output format instructions', () => {
    expect(TEXT_CORRECTION_SYSTEM_PROMPT).toContain(
      'Output JSON with corrections:',
    );
    expect(TEXT_CORRECTION_SYSTEM_PROMPT).toContain('{"tc":[],"cc":[]}');
  });
});
