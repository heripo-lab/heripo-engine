import { describe, expect, test } from 'vitest';

import { VLM_ELEMENT_TYPES, VLM_QUALITY_ISSUE_TYPES } from './vlm-page-result';

describe('vlm-page-result', () => {
  test('exposes runtime constants for type unions', () => {
    expect(VLM_ELEMENT_TYPES).toEqual([
      'text',
      'section_header',
      'caption',
      'footnote',
      'page_header',
      'page_footer',
      'list_item',
      'picture',
      'table',
    ]);
    expect(VLM_QUALITY_ISSUE_TYPES).toEqual([
      'placeholder_text',
      'script_anomaly',
      'meta_description',
      'repetitive_pattern',
    ]);
  });
});
