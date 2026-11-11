import { describe, expect, test } from 'vitest';

import {
  latinPrefixedNumbers,
  rowLeadingNumber,
  sameObjectNumber,
} from './object-numbers';

describe('sameObjectNumber', () => {
  test('matches one number in a site-coded, kind-lettered or bare form only', () => {
    expect(sameObjectNumber('M107', '99XXM107')).toBe(true);
    expect(sameObjectNumber('107', 'M107')).toBe(true);
    expect(sameObjectNumber('99X XM107', '107')).toBe(true);
    expect(sameObjectNumber('1호', '1 호')).toBe(true);
    expect(sameObjectNumber('07', 'M107')).toBe(false);
    expect(sameObjectNumber('102', '102A')).toBe(false);
    expect(sameObjectNumber('23', '마도23')).toBe(false);
    expect(sameObjectNumber('3', '13')).toBe(false);
    expect(sameObjectNumber('M107', 'M108')).toBe(false);
    expect(sameObjectNumber('', 'M107')).toBe(false);
  });
});

describe('latinPrefixedNumbers', () => {
  test('lists Latin-prefixed numbers with whitespace ignored', () => {
    expect(latinPrefixedNumbers('墓 M 107 与 99XXM102，1호')).toEqual([
      'M107',
      'XXM102',
    ]);
    expect(latinPrefixedNumbers('1호 우물')).toEqual([]);
  });
});

describe('rowLeadingNumber', () => {
  test('reads the leading digits of the first non-empty cell of the first two columns', () => {
    expect(rowLeadingNumber(['', '102A', '9'])).toBe('102');
    expect(rowLeadingNumber(['107 EXAMPLE'])).toBe('107');
    expect(rowLeadingNumber(['2호'])).toBeNull();
    expect(rowLeadingNumber(['', '', '5'])).toBeNull();
  });
});
