import type { VlmPageOutput } from './vlm-page-schema';

import { describe, expect, test } from 'vitest';

import {
  TYPE_ABBREVIATIONS,
  TYPE_TO_ABBREVIATION,
  abbreviateType,
  expandTypeAbbreviation,
  toVlmPageResult,
  vlmPageOutputSchema,
} from './vlm-page-schema';

describe('vlmPageOutputSchema', () => {
  test('parses valid output with all element types', () => {
    const input = {
      e: [
        { t: 'sh', c: 'I. Introduction', l: 1, m: null, o: 0, b: null },
        { t: 'tx', c: 'This is body text.', l: null, m: null, o: 1, b: null },
        {
          t: 'pi',
          c: '',
          l: null,
          m: null,
          o: 2,
          b: { l: 0.1, t: 0.3, r: 0.9, b: 0.7 },
        },
        {
          t: 'ca',
          c: 'Figure 1. Site overview',
          l: null,
          m: null,
          o: 3,
          b: null,
        },
        { t: 'li', c: 'First item', l: null, m: '1)', o: 4, b: null },
        { t: 'fn', c: 'See appendix A', l: null, m: null, o: 5, b: null },
        { t: 'ph', c: 'Report Title', l: null, m: null, o: 6, b: null },
        { t: 'pf', c: 'Page 1', l: null, m: null, o: 7, b: null },
        { t: 'tb', c: '| A | B |', l: null, m: null, o: 8, b: null },
      ],
    };

    const result = vlmPageOutputSchema.parse(input);
    expect(result.e).toHaveLength(9);
  });

  test('parses element with all nullable fields set to null', () => {
    const input = {
      e: [{ t: 'tx', c: 'Hello', l: null, m: null, o: 0, b: null }],
    };

    const result = vlmPageOutputSchema.parse(input);
    expect(result.e[0]).toEqual({
      t: 'tx',
      c: 'Hello',
      l: null,
      m: null,
      o: 0,
      b: null,
    });
  });

  test('parses empty element array', () => {
    const input = { e: [] };
    const result = vlmPageOutputSchema.parse(input);
    expect(result.e).toHaveLength(0);
  });

  test('rejects unknown type abbreviation', () => {
    const input = {
      e: [{ t: 'xx', c: 'test', l: null, m: null, o: 0, b: null }],
    };

    expect(() => vlmPageOutputSchema.parse(input)).toThrow();
  });

  test('rejects bbox values outside 0-1 range', () => {
    const input = {
      e: [
        {
          t: 'pi',
          c: '',
          l: null,
          m: null,
          o: 0,
          b: { l: -0.1, t: 0.3, r: 0.9, b: 0.7 },
        },
      ],
    };

    expect(() => vlmPageOutputSchema.parse(input)).toThrow();
  });

  test('rejects bbox values above 1.0', () => {
    const input = {
      e: [
        {
          t: 'pi',
          c: '',
          l: null,
          m: null,
          o: 0,
          b: { l: 0.1, t: 0.3, r: 1.1, b: 0.7 },
        },
      ],
    };

    expect(() => vlmPageOutputSchema.parse(input)).toThrow();
  });

  test('rejects negative order', () => {
    const input = {
      e: [{ t: 'tx', c: 'test', l: null, m: null, o: -1, b: null }],
    };

    expect(() => vlmPageOutputSchema.parse(input)).toThrow();
  });

  test('rejects non-positive level', () => {
    const input = {
      e: [{ t: 'sh', c: 'Header', l: 0, m: null, o: 0, b: null }],
    };

    expect(() => vlmPageOutputSchema.parse(input)).toThrow();
  });

  test('rejects non-integer level', () => {
    const input = {
      e: [{ t: 'sh', c: 'Header', l: 1.5, m: null, o: 0, b: null }],
    };

    expect(() => vlmPageOutputSchema.parse(input)).toThrow();
  });
});

describe('expandTypeAbbreviation', () => {
  test('maps all short codes to full types', () => {
    expect(expandTypeAbbreviation('tx')).toBe('text');
    expect(expandTypeAbbreviation('sh')).toBe('section_header');
    expect(expandTypeAbbreviation('ca')).toBe('caption');
    expect(expandTypeAbbreviation('fn')).toBe('footnote');
    expect(expandTypeAbbreviation('ph')).toBe('page_header');
    expect(expandTypeAbbreviation('pf')).toBe('page_footer');
    expect(expandTypeAbbreviation('li')).toBe('list_item');
    expect(expandTypeAbbreviation('pi')).toBe('picture');
    expect(expandTypeAbbreviation('tb')).toBe('table');
  });

  test('throws on unknown abbreviation', () => {
    expect(() => expandTypeAbbreviation('xx')).toThrow(
      'Unknown element type abbreviation: "xx"',
    );
  });
});

describe('abbreviateType', () => {
  test('maps all full types to short codes', () => {
    expect(abbreviateType('text')).toBe('tx');
    expect(abbreviateType('section_header')).toBe('sh');
    expect(abbreviateType('caption')).toBe('ca');
    expect(abbreviateType('footnote')).toBe('fn');
    expect(abbreviateType('page_header')).toBe('ph');
    expect(abbreviateType('page_footer')).toBe('pf');
    expect(abbreviateType('list_item')).toBe('li');
    expect(abbreviateType('picture')).toBe('pi');
    expect(abbreviateType('table')).toBe('tb');
  });
});

describe('TYPE_ABBREVIATIONS and TYPE_TO_ABBREVIATION', () => {
  test('are consistent bidirectional mappings', () => {
    for (const [short, full] of Object.entries(TYPE_ABBREVIATIONS)) {
      expect(TYPE_TO_ABBREVIATION[full]).toBe(short);
    }
  });

  test('cover all 9 element types', () => {
    expect(Object.keys(TYPE_ABBREVIATIONS)).toHaveLength(9);
    expect(Object.keys(TYPE_TO_ABBREVIATION)).toHaveLength(9);
  });
});

describe('toVlmPageResult', () => {
  test('converts short-field output to full VlmPageResult', () => {
    const output: VlmPageOutput = {
      e: [
        { t: 'sh', c: 'I. Overview', l: 1, m: null, o: 0, b: null },
        { t: 'tx', c: 'Body text here.', l: null, m: null, o: 1, b: null },
        {
          t: 'pi',
          c: '',
          l: null,
          m: null,
          o: 2,
          b: { l: 0.1, t: 0.2, r: 0.8, b: 0.6 },
        },
      ],
    };

    const result = toVlmPageResult(1, output);

    expect(result.pageNo).toBe(1);
    expect(result.elements).toHaveLength(3);

    expect(result.elements[0]).toEqual({
      type: 'section_header',
      content: 'I. Overview',
      level: 1,
      order: 0,
    });

    expect(result.elements[1]).toEqual({
      type: 'text',
      content: 'Body text here.',
      order: 1,
    });

    expect(result.elements[2]).toEqual({
      type: 'picture',
      content: '',
      order: 2,
      bbox: { l: 0.1, t: 0.2, r: 0.8, b: 0.6 },
    });
  });

  test('converts list item with marker', () => {
    const output: VlmPageOutput = {
      e: [{ t: 'li', c: 'First item', l: null, m: '1)', o: 0, b: null }],
    };

    const result = toVlmPageResult(5, output);

    expect(result.elements[0]).toEqual({
      type: 'list_item',
      content: 'First item',
      marker: '1)',
      order: 0,
    });
  });

  test('handles empty elements array', () => {
    const output: VlmPageOutput = { e: [] };
    const result = toVlmPageResult(1, output);

    expect(result.pageNo).toBe(1);
    expect(result.elements).toHaveLength(0);
  });

  test('omits null fields from result elements', () => {
    const output: VlmPageOutput = {
      e: [{ t: 'tx', c: 'Simple text', l: null, m: null, o: 0, b: null }],
    };

    const result = toVlmPageResult(1, output);
    const element = result.elements[0];

    expect(element).toEqual({
      type: 'text',
      content: 'Simple text',
      order: 0,
    });
    expect('level' in element).toBe(false);
    expect('marker' in element).toBe(false);
    expect('bbox' in element).toBe(false);
  });

  test('preserves page number for various values', () => {
    const output: VlmPageOutput = { e: [] };

    expect(toVlmPageResult(1, output).pageNo).toBe(1);
    expect(toVlmPageResult(100, output).pageNo).toBe(100);
    expect(toVlmPageResult(116, output).pageNo).toBe(116);
  });
});
