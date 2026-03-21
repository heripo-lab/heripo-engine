import { describe, expect, test } from 'vitest';

import { extractMaxPageNumber } from './toc-markdown-utils';

describe('extractMaxPageNumber', () => {
  test('extracts max page number from dot-leader markdown', () => {
    const markdown = [
      '- Ⅰ. 調査概要 ...... 175',
      '- Ⅱ. 調査内容 ...... 180',
      '- Ⅲ. 考察 ........... 228',
    ].join('\n');

    expect(extractMaxPageNumber(markdown)).toBe(228);
  });

  test('extracts max page number from table cell markdown', () => {
    const markdown = [
      '| 목차 | 페이지 |',
      '| --- | --- |',
      '| I. 調査概要 | 175 |',
      '| II. 調査内容 | 180 |',
      '| III. 考察 | 228 |',
    ].join('\n');

    expect(extractMaxPageNumber(markdown)).toBe(228);
  });

  test('extracts max from mixed dot-leader and table patterns', () => {
    const markdown = [
      '- Ⅰ. 調査概要 ...... 175',
      '| II. 調査内容 | 300 |',
      '- Ⅲ. 考察 ........... 228',
    ].join('\n');

    expect(extractMaxPageNumber(markdown)).toBe(300);
  });

  test('returns 0 when no page numbers found', () => {
    const markdown = ['- Introduction', '- Chapter 1', '- Chapter 2'].join(
      '\n',
    );

    expect(extractMaxPageNumber(markdown)).toBe(0);
  });

  test('returns 0 for empty string', () => {
    expect(extractMaxPageNumber('')).toBe(0);
  });

  test('selects maximum among multiple page numbers', () => {
    const markdown = [
      '- Section A ...... 10',
      '- Section B ...... 500',
      '- Section C ...... 250',
    ].join('\n');

    expect(extractMaxPageNumber(markdown)).toBe(500);
  });
});
