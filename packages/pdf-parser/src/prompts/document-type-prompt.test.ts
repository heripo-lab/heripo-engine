import { describe, expect, test } from 'vitest';

import { DOCUMENT_TYPE_SYSTEM_PROMPT } from './document-type-prompt';

describe('DOCUMENT_TYPE_SYSTEM_PROMPT', () => {
  test('is a non-empty string', () => {
    expect(typeof DOCUMENT_TYPE_SYSTEM_PROMPT).toBe('string');
    expect(DOCUMENT_TYPE_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  test('contains valid document types', () => {
    expect(DOCUMENT_TYPE_SYSTEM_PROMPT).toContain('Excavation report');
    expect(DOCUMENT_TYPE_SYSTEM_PROMPT).toContain('발굴조사보고서');
  });

  test('contains invalid document types', () => {
    expect(DOCUMENT_TYPE_SYSTEM_PROMPT).toContain('NOT valid');
    expect(DOCUMENT_TYPE_SYSTEM_PROMPT).toContain('수리보고서');
  });
});
