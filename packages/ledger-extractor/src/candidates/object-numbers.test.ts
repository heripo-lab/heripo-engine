import { describe, expect, test } from 'vitest';

import { sameObjectNumber } from './object-numbers';

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
