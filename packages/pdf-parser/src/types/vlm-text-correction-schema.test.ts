import { describe, expect, test } from 'vitest';

import { vlmTextCorrectionSchema } from './vlm-text-correction-schema';

describe('vlmTextCorrectionSchema', () => {
  test('parses valid correction output with both text and cell corrections', () => {
    const input = {
      tc: [
        { i: 1, s: [{ f: '遣蹟', r: '遺蹟' }] },
        {
          i: 3,
          s: [
            { f: '發뻘', r: '發掘' },
            { f: '調사', r: '調査' },
          ],
        },
      ],
      cc: [{ ti: 0, r: 1, c: 0, t: '住居址' }],
    };

    const result = vlmTextCorrectionSchema.parse(input);

    expect(result.tc).toHaveLength(2);
    expect(result.tc[0]).toEqual({ i: 1, s: [{ f: '遣蹟', r: '遺蹟' }] });
    expect(result.tc[1].s).toHaveLength(2);
    expect(result.cc).toHaveLength(1);
    expect(result.cc[0]).toEqual({ ti: 0, r: 1, c: 0, t: '住居址' });
  });

  test('parses empty corrections (all text correct)', () => {
    const input = { tc: [], cc: [] };

    const result = vlmTextCorrectionSchema.parse(input);

    expect(result.tc).toHaveLength(0);
    expect(result.cc).toHaveLength(0);
  });

  test('parses output with only text corrections', () => {
    const input = {
      tc: [{ i: 0, s: [{ f: '漢宇', r: '漢字' }] }],
      cc: [],
    };

    const result = vlmTextCorrectionSchema.parse(input);

    expect(result.tc).toHaveLength(1);
    expect(result.cc).toHaveLength(0);
  });

  test('parses output with only cell corrections', () => {
    const input = {
      tc: [],
      cc: [{ ti: 2, r: 0, c: 3, t: '出土遺物' }],
    };

    const result = vlmTextCorrectionSchema.parse(input);

    expect(result.tc).toHaveLength(0);
    expect(result.cc).toHaveLength(1);
  });

  test('allows empty substitutions array', () => {
    const input = {
      tc: [{ i: 0, s: [] }],
      cc: [],
    };

    const result = vlmTextCorrectionSchema.parse(input);

    expect(result.tc[0].s).toHaveLength(0);
  });

  test('allows empty find/replace strings (deletion/insertion)', () => {
    const input = {
      tc: [
        {
          i: 0,
          s: [
            { f: 'extra', r: '' },
            { f: '', r: 'inserted' },
          ],
        },
      ],
      cc: [],
    };

    const result = vlmTextCorrectionSchema.parse(input);

    expect(result.tc[0].s[0]).toEqual({ f: 'extra', r: '' });
    expect(result.tc[0].s[1]).toEqual({ f: '', r: 'inserted' });
  });

  test('rejects missing tc field', () => {
    const input = { cc: [] };

    expect(() => vlmTextCorrectionSchema.parse(input)).toThrow();
  });

  test('rejects missing cc field', () => {
    const input = { tc: [] };

    expect(() => vlmTextCorrectionSchema.parse(input)).toThrow();
  });

  test('rejects negative text element index', () => {
    const input = {
      tc: [{ i: -1, s: [{ f: 'a', r: 'b' }] }],
      cc: [],
    };

    expect(() => vlmTextCorrectionSchema.parse(input)).toThrow();
  });

  test('rejects non-integer text element index', () => {
    const input = {
      tc: [{ i: 1.5, s: [{ f: 'a', r: 'b' }] }],
      cc: [],
    };

    expect(() => vlmTextCorrectionSchema.parse(input)).toThrow();
  });

  test('rejects negative cell row index', () => {
    const input = {
      tc: [],
      cc: [{ ti: 0, r: -1, c: 0, t: 'text' }],
    };

    expect(() => vlmTextCorrectionSchema.parse(input)).toThrow();
  });

  test('rejects negative cell column index', () => {
    const input = {
      tc: [],
      cc: [{ ti: 0, r: 0, c: -1, t: 'text' }],
    };

    expect(() => vlmTextCorrectionSchema.parse(input)).toThrow();
  });

  test('rejects negative table index', () => {
    const input = {
      tc: [],
      cc: [{ ti: -1, r: 0, c: 0, t: 'text' }],
    };

    expect(() => vlmTextCorrectionSchema.parse(input)).toThrow();
  });

  test('accepts zero indices', () => {
    const input = {
      tc: [{ i: 0, s: [{ f: 'old', r: 'new' }] }],
      cc: [{ ti: 0, r: 0, c: 0, t: 'cell' }],
    };

    const result = vlmTextCorrectionSchema.parse(input);

    expect(result.tc[0].i).toBe(0);
    expect(result.cc[0].ti).toBe(0);
    expect(result.cc[0].r).toBe(0);
    expect(result.cc[0].c).toBe(0);
  });
});
