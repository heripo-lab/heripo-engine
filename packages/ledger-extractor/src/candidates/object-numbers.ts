/**
 * Whether two written object numbers name one object under a report's own numbering, when a report writes
 * one tomb as `99XXM107` (site code and kind letter) in its account, `M107` in item numbers (`M107:10`) and `107` in
 * the appendix register. Two numbers match when, without whitespace, one ends the other right after a Latin letter
 * (`M107` in `99XXM107`), or one is only digits and the other ends in exactly those digits right after a Latin
 * letter (`107` and `M107`); a Hangul or Han prefix (`마도23`) does not count as a kind letter. Numbers that differ in a trailing letter (`102A`, a burial of tomb 102) or in their digits do
 * not match, and neither do two numbers made only of digits unless they are equal.
 */
export function sameObjectNumber(a: string, b: string) {
  const x = a.replace(/\s+/gu, '');
  const y = b.replace(/\s+/gu, '');
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  if (!/^[A-Za-z]*\d+$/u.test(short) || !long.endsWith(short)) return false;
  return /[A-Za-z]$/u.test(long.slice(0, long.length - short.length));
}
