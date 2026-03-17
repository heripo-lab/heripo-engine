import type { DoclingTextItem } from '@heripo/model';

import { describe, expect, test } from 'vitest';

import {
  REFERENCE_MATCH_THRESHOLD,
  computeCharOverlap,
  matchTextToReference,
  matchTextToReferenceWithUnused,
  mergeIntoBlocks,
} from './text-reference-matcher';

function createTextItem(
  text: string,
  label: string,
  pageNo: number,
): DoclingTextItem {
  return {
    self_ref: `#/texts/0`,
    label,
    prov: [
      {
        page_no: pageNo,
        bbox: { l: 0, t: 0, r: 100, b: 20, coord_origin: 'BOTTOMLEFT' },
        charspan: [0, text.length],
      },
    ],
    text,
    orig: text,
    children: [],
    content_layer: 'body',
  };
}

describe('text-reference-matcher', () => {
  describe('REFERENCE_MATCH_THRESHOLD', () => {
    test('is 0.4', () => {
      expect(REFERENCE_MATCH_THRESHOLD).toBe(0.4);
    });
  });

  describe('computeCharOverlap', () => {
    test('returns 0 when either string is empty', () => {
      expect(computeCharOverlap('', 'abc')).toBe(0);
      expect(computeCharOverlap('abc', '')).toBe(0);
      expect(computeCharOverlap('', '')).toBe(0);
    });

    test('returns 1 for identical strings', () => {
      expect(computeCharOverlap('abc', 'abc')).toBe(1);
    });

    test('returns correct overlap ratio for partially matching strings', () => {
      // 'abc' vs 'abd' → overlap: a(1), b(1) = 2, max length = 3
      expect(computeCharOverlap('abc', 'abd')).toBeCloseTo(2 / 3);
    });

    test('returns correct overlap for strings of different lengths', () => {
      // 'ab' vs 'abcd' → overlap: a(1), b(1) = 2, max length = 4
      expect(computeCharOverlap('ab', 'abcd')).toBeCloseTo(2 / 4);
    });

    test('handles repeated characters correctly', () => {
      // 'aab' vs 'ab' → freqA: a=2,b=1; freqB: a=1,b=1; overlap: min(2,1)+min(1,1) = 2, max = 3
      expect(computeCharOverlap('aab', 'ab')).toBeCloseTo(2 / 3);
    });
  });

  describe('mergeIntoBlocks', () => {
    test('returns empty array for empty string', () => {
      expect(mergeIntoBlocks('')).toEqual([]);
    });

    test('returns empty array for whitespace-only string', () => {
      expect(mergeIntoBlocks('\n\n\n\n')).toEqual([]);
    });

    test('merges consecutive lines into a single block', () => {
      expect(mergeIntoBlocks('line1\nline2\nline3')).toEqual([
        'line1 line2 line3',
      ]);
    });

    test('splits at blank lines into separate blocks', () => {
      expect(mergeIntoBlocks('block1\n\nblock2')).toEqual(['block1', 'block2']);
    });

    test('handles multiple blank lines as a single separator', () => {
      expect(mergeIntoBlocks('block1\n\n\nblock2')).toEqual([
        'block1',
        'block2',
      ]);
    });

    test('trims whitespace from each line', () => {
      expect(mergeIntoBlocks('  line1  \n  line2  ')).toEqual(['line1 line2']);
    });

    test('handles mixed content with blank lines', () => {
      expect(mergeIntoBlocks('a\nb\n\nc\nd\ne\n\nf')).toEqual([
        'a b',
        'c d e',
        'f',
      ]);
    });
  });

  describe('matchTextToReference', () => {
    test('matches garbled footnote to correct pdftotext line', () => {
      const pageTexts = [
        {
          index: 0,
          item: createTextItem(
            '49) (W)#X1CR003T 2008, 『아산 상성리유적』.',
            'footnote',
            1,
          ),
        },
      ];
      const pageText = '49) (財)忠淸文化財硏究院 2008,『아산 상성리유적』.';

      const result = matchTextToReference(pageTexts, pageText);

      expect(result.size).toBe(1);
      expect(result.get(0)).toBe(
        '49) (財)忠淸文化財硏究院 2008,『아산 상성리유적』.',
      );
    });

    test('matches heavily garbled text above threshold', () => {
      const pageTexts = [
        {
          index: 0,
          item: createTextItem(
            '50) (M):23x1CR03% 2008, 『아산 장재리 아골유적』.',
            'footnote',
            1,
          ),
        },
      ];
      const pageText =
        '50) (財)忠淸文化財硏究院 2008,『아산 장재리 아골유적』.';

      const result = matchTextToReference(pageTexts, pageText);

      expect(result.size).toBe(1);
      expect(result.get(0)).toBe(pageText);
    });

    test('skips identical text (no ref needed)', () => {
      const pageTexts = [
        {
          index: 0,
          item: createTextItem('제1장 조사개요', 'section_header', 1),
        },
      ];
      const pageText = '제1장 조사개요';

      const result = matchTextToReference(pageTexts, pageText);

      expect(result.size).toBe(0);
    });

    test('returns empty map when no matches above threshold', () => {
      const pageTexts = [
        {
          index: 0,
          item: createTextItem('completely different text', 'text', 1),
        },
      ];
      const pageText = 'XXXXXXXXYYYYYYZZZZZZ';

      const result = matchTextToReference(pageTexts, pageText);

      expect(result.size).toBe(0);
    });

    test('returns empty map for empty pageText', () => {
      const pageTexts = [
        { index: 0, item: createTextItem('some text', 'text', 1) },
      ];

      const result = matchTextToReference(pageTexts, '');

      expect(result.size).toBe(0);
    });

    test('handles greedy matching without double assignment', () => {
      const pageTexts = [
        { index: 0, item: createTextItem('AAA BBB', 'text', 1) },
        { index: 1, item: createTextItem('CCC DDD', 'text', 1) },
        { index: 2, item: createTextItem('EEE FFF', 'text', 1) },
      ];
      const pageText = 'AAA BBB ref\n\nCCC DDD ref\n\nEEE FFF ref';

      const result = matchTextToReference(pageTexts, pageText);

      expect(result.size).toBe(3);
      // Each element should match a unique ref block
      const refValues = new Set(result.values());
      expect(refValues.size).toBe(3);
    });

    test('handles empty OCR text element against non-empty ref line', () => {
      const pageTexts = [{ index: 0, item: createTextItem('', 'text', 1) }];
      const pageText = 'some reference text';

      const result = matchTextToReference(pageTexts, pageText);

      expect(result.size).toBe(0);
    });

    test('handles more OCR elements than reference lines', () => {
      const pageTexts = [
        { index: 0, item: createTextItem('AAA BBB', 'text', 1) },
        { index: 1, item: createTextItem('CCC DDD', 'text', 1) },
        { index: 2, item: createTextItem('EEE FFF', 'text', 1) },
      ];
      const pageText = 'AAA BBB ref';

      const result = matchTextToReference(pageTexts, pageText);

      // Only one ref block available, so at most 1 match
      expect(result.size).toBeLessThanOrEqual(1);
    });

    test('matches long OCR paragraph against merged pdftotext block', () => {
      // OCR produces one long paragraph; pdftotext splits into layout lines
      const ocrText =
        '唐은 熊津(공주), 馬韓(익산), 東明에 都督府를 설치하고 9州 5小京制를 완성하였다';
      const pageTexts = [
        { index: 0, item: createTextItem(ocrText, 'text', 1) },
      ];
      // pdftotext: same content split across multiple lines (no blank line separator)
      const pageText =
        '唐은 熊津(공주), 馬韓(익산),\n東明에 都督府를 설치하고\n9州 5小京制를 완성하였다';

      // Identical after merge → no ref needed (skips identical text)
      const identicalResult = matchTextToReference(pageTexts, pageText);
      expect(identicalResult.size).toBe(0);

      // Use a garbled OCR version to verify ref is provided
      const garbledOcrText =
        '받은 M(공주), 5류(익산), 햇배에 Bbt를 설치하고 9MM 5☆를 완성하였다';
      const garbledPageTexts = [
        { index: 0, item: createTextItem(garbledOcrText, 'text', 1) },
      ];

      const garbledResult = matchTextToReference(garbledPageTexts, pageText);

      expect(garbledResult.size).toBe(1);
      expect(garbledResult.get(0)).toBe(
        '唐은 熊津(공주), 馬韓(익산), 東明에 都督府를 설치하고 9州 5小京制를 완성하였다',
      );
    });

    test('separates blocks at blank lines for independent matching', () => {
      const pageTexts = [
        {
          index: 0,
          item: createTextItem(
            '본문 단락 텍스트 내용이 여기에 있습니다',
            'text',
            1,
          ),
        },
        {
          index: 1,
          item: createTextItem('49) (W)#X1 2008, 『보고서』.', 'footnote', 1),
        },
      ];
      // pdftotext: body paragraph (2 layout lines) + blank line + footnote
      const pageText =
        '본문 단락 텍스트\n내용이 여기에 있습니다\n\n49) (財)忠淸 2008, 『보고서』.';

      const result = matchTextToReference(pageTexts, pageText);

      // Body paragraph matches merged block, footnote matches separate block
      expect(result.size).toBe(1);
      expect(result.get(1)).toBe('49) (財)忠淸 2008, 『보고서』.');
    });

    test('returns empty map when pdftotext contains only blank lines', () => {
      const pageTexts = [
        { index: 0, item: createTextItem('some text', 'text', 1) },
      ];
      const pageText = '\n\n\n\n';

      const result = matchTextToReference(pageTexts, pageText);

      expect(result.size).toBe(0);
    });
  });

  describe('matchTextToReferenceWithUnused', () => {
    test('returns unused blocks that were not matched to any OCR element', () => {
      const pageTexts = [
        { index: 0, item: createTextItem('본문 텍스트', 'text', 1) },
      ];
      // pdftotext has 2 blocks; only one will match the OCR element
      const pageText = '본문 텍스트\n\n추가 블록';

      const { references, unusedBlocks } = matchTextToReferenceWithUnused(
        pageTexts,
        pageText,
      );

      // '본문 텍스트' is identical → consumed but no ref entry
      expect(references.size).toBe(0);
      expect(unusedBlocks).toEqual(['추가 블록']);
    });

    test('returns all blocks as unused when no OCR elements', () => {
      const pageTexts: Array<{ index: number; item: DoclingTextItem }> = [];
      const pageText = 'block1\n\nblock2\n\nblock3';

      const { references, unusedBlocks } = matchTextToReferenceWithUnused(
        pageTexts,
        pageText,
      );

      expect(references.size).toBe(0);
      expect(unusedBlocks).toEqual(['block1', 'block2', 'block3']);
    });

    test('returns empty unusedBlocks when all blocks are consumed', () => {
      const pageTexts = [
        { index: 0, item: createTextItem('AAA BBB ref', 'text', 1) },
        { index: 1, item: createTextItem('CCC DDD ref', 'text', 1) },
      ];
      const pageText = 'AAA BBB ref\n\nCCC DDD ref';

      const { unusedBlocks } = matchTextToReferenceWithUnused(
        pageTexts,
        pageText,
      );

      expect(unusedBlocks).toEqual([]);
    });
  });
});
