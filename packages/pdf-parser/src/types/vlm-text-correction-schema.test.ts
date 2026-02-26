import { describe, expect, test } from 'vitest';

import { vlmTextCorrectionSchema } from './vlm-text-correction-schema';

describe('vlmTextCorrectionSchema', () => {
  test('parses valid correction output with both text and cell corrections', () => {
    const input = {
      tc: [
        { i: 1, t: '遺蹟' },
        { i: 3, t: '發掘調査' },
      ],
      cc: [{ ti: 0, r: 1, c: 0, t: '住居址' }],
    };

    const result = vlmTextCorrectionSchema.parse(input);

    expect(result.tc).toHaveLength(2);
    expect(result.tc[0]).toEqual({ i: 1, t: '遺蹟' });
    expect(result.tc[1]).toEqual({ i: 3, t: '發掘調査' });
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
      tc: [{ i: 0, t: '漢字' }],
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
      tc: [{ i: -1, t: 'text' }],
      cc: [],
    };

    expect(() => vlmTextCorrectionSchema.parse(input)).toThrow();
  });

  test('rejects non-integer text element index', () => {
    const input = {
      tc: [{ i: 1.5, t: 'text' }],
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
      tc: [{ i: 0, t: 'first' }],
      cc: [{ ti: 0, r: 0, c: 0, t: 'cell' }],
    };

    const result = vlmTextCorrectionSchema.parse(input);

    expect(result.tc[0].i).toBe(0);
    expect(result.cc[0].ti).toBe(0);
    expect(result.cc[0].r).toBe(0);
    expect(result.cc[0].c).toBe(0);
  });
});
