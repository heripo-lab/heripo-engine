import { describe, expect, test } from 'vitest';

import { TextCleaner } from './text-cleaner';

describe('TextCleaner', () => {
  describe('normalize', () => {
    test('normal text unchanged', () => {
      const text = '이것은 정상적인 텍스트입니다.';
      expect(TextCleaner.normalize(text)).toBe(text);
    });

    test('convert consecutive spaces to single space', () => {
      const text = '공백이    많이    있습니다';
      expect(TextCleaner.normalize(text)).toBe('공백이 많이 있습니다');
    });

    test('convert line breaks to space', () => {
      const text = '첫번째\n두번째\r\n세번째';
      expect(TextCleaner.normalize(text)).toBe('첫번째 두번째 세번째');
    });

    test('convert tab characters to space', () => {
      const text = '탭\t문자\t테스트';
      expect(TextCleaner.normalize(text)).toBe('탭 문자 테스트');
    });

    test('convert non-breaking space to space', () => {
      const text = '비중단\u00A0공백';
      expect(TextCleaner.normalize(text)).toBe('비중단 공백');
    });

    test('convert unicode space characters to space', () => {
      const text = '유니코드\u2000공백\u2001테스트';
      expect(TextCleaner.normalize(text)).toBe('유니코드 공백 테스트');
    });

    test('remove leading and trailing spaces', () => {
      const text = '  양쪽 공백 있음  ';
      expect(TextCleaner.normalize(text)).toBe('양쪽 공백 있음');
    });

    test('empty string returns empty string', () => {
      expect(TextCleaner.normalize('')).toBe('');
    });

    test('only spaces returns empty string', () => {
      expect(TextCleaner.normalize('   \n\t  ')).toBe('');
    });

    test('unicode normalization (NFC)', () => {
      // Decomposed form: é (e + ◌́)
      const decomposed = 'café'.normalize('NFD');
      // When normalized, becomes composed form: é
      expect(TextCleaner.normalize(decomposed)).toBe('café');
    });

    test('clean mixed spaces/line breaks/tabs', () => {
      const text = '  여러\n  종류의   \t\n  공백  ';
      expect(TextCleaner.normalize(text)).toBe('여러 종류의 공백');
    });
  });

  describe('cleanPunctuation', () => {
    test('remove leading comma', () => {
      const text = ', 쉼표로 시작';
      expect(TextCleaner.cleanPunctuation(text)).toBe('쉼표로 시작');
    });

    test('remove leading period', () => {
      const text = '. 마침표로 시작';
      expect(TextCleaner.cleanPunctuation(text)).toBe('마침표로 시작');
    });

    test('remove multiple leading punctuation marks', () => {
      const text = ',:;!? 여러 구두점으로 시작';
      expect(TextCleaner.cleanPunctuation(text)).toBe('여러 구두점으로 시작');
    });

    test('remove trailing spaces and punctuation', () => {
      const text = '끝에 공백과 구두점  .,';
      expect(TextCleaner.cleanPunctuation(text)).toBe('끝에 공백과 구두점');
    });

    test('normal text unchanged', () => {
      const text = '정상적인 텍스트입니다.';
      expect(TextCleaner.cleanPunctuation(text)).toBe('정상적인 텍스트입니다.');
    });

    test('empty string returns empty string', () => {
      expect(TextCleaner.cleanPunctuation('')).toBe('');
    });
  });

  describe('isValidText', () => {
    test('normal text is valid', () => {
      expect(TextCleaner.isValidText('이것은 유효한 텍스트입니다')).toBe(true);
    });

    test('English text is also valid', () => {
      expect(TextCleaner.isValidText('Valid text')).toBe(true);
    });

    test('only numbers is invalid', () => {
      expect(TextCleaner.isValidText('123456')).toBe(false);
    });

    test('only spaces is invalid', () => {
      expect(TextCleaner.isValidText('   ')).toBe(false);
    });

    test('only numbers and spaces is invalid', () => {
      expect(TextCleaner.isValidText('123  456  789')).toBe(false);
    });

    test('mixed numbers and text is valid', () => {
      expect(TextCleaner.isValidText('123 숫자와 텍스트')).toBe(true);
    });

    test('empty string is invalid', () => {
      expect(TextCleaner.isValidText('')).toBe(false);
    });

    test('validate after normalization (consecutive spaces removed)', () => {
      expect(TextCleaner.isValidText('  텍스트  ')).toBe(true);
    });
  });

  describe('normalizeBatch', () => {
    test('normalize multiple texts in batch', () => {
      const texts = ['  첫번째  ', '두번째\n', '\t세번째\t'];
      const result = TextCleaner.normalizeBatch(texts);
      expect(result).toEqual(['첫번째', '두번째', '세번째']);
    });

    test('process empty array', () => {
      expect(TextCleaner.normalizeBatch([])).toEqual([]);
    });

    test('single element array', () => {
      expect(TextCleaner.normalizeBatch(['  텍스트  '])).toEqual(['텍스트']);
    });

    test('process large batch', () => {
      const texts = Array.from({ length: 100 }, (_, i) => `  텍스트 ${i}  `);
      const result = TextCleaner.normalizeBatch(texts);
      expect(result).toHaveLength(100);
      expect(result[0]).toBe('텍스트 0');
      expect(result[99]).toBe('텍스트 99');
    });
  });

  describe('filterValidTexts', () => {
    test('filter only valid texts', () => {
      const texts = ['유효한', '123', '텍스트', '456', '입니다'];
      const result = TextCleaner.filterValidTexts(texts);
      expect(result).toEqual(['유효한', '텍스트', '입니다']);
    });

    test('all valid case', () => {
      const texts = ['첫번째', '두번째', '세번째'];
      const result = TextCleaner.filterValidTexts(texts);
      expect(result).toEqual(['첫번째', '두번째', '세번째']);
    });

    test('all invalid case', () => {
      const texts = ['123', '456', '789'];
      const result = TextCleaner.filterValidTexts(texts);
      expect(result).toEqual([]);
    });

    test('filter empty array', () => {
      expect(TextCleaner.filterValidTexts([])).toEqual([]);
    });

    test('filter mixed batch', () => {
      const texts = ['  유효한  ', '123', '', '  또 유효함  ', 'text 456'];
      const result = TextCleaner.filterValidTexts(texts);
      expect(result).toEqual(['  유효한  ', '  또 유효함  ', 'text 456']);
    });
  });

  describe('normalizeAndFilterBatch', () => {
    test('batch processing with batchSize > 0', () => {
      const texts = ['  유효한\n', '\t123\t', '  또 유효함  ', '456'];
      const result = TextCleaner.normalizeAndFilterBatch(texts, 2);
      expect(result).toEqual(['유효한', '또 유효함']);
    });

    test('sequential processing with batchSize = 0', () => {
      const texts = ['  유효한\n', '\t123\t', '  또 유효함  ', '456'];
      const result = TextCleaner.normalizeAndFilterBatch(texts, 0);
      expect(result).toEqual(['유효한', '또 유효함']);
    });

    test('batchSize = 0 with empty array', () => {
      const result = TextCleaner.normalizeAndFilterBatch([], 0);
      expect(result).toEqual([]);
    });

    test('batchSize = 0 with single element', () => {
      const result = TextCleaner.normalizeAndFilterBatch(['  텍스트  '], 0);
      expect(result).toEqual(['텍스트']);
    });

    test('batchSize = 0 with all invalid texts', () => {
      const texts = ['123', '456', '789'];
      const result = TextCleaner.normalizeAndFilterBatch(texts, 0);
      expect(result).toEqual([]);
    });

    test('batchSize = 0 produces same result as batchSize > 0', () => {
      const texts = [
        '  첫번째  ',
        '\t123\t',
        '\n두번째\n',
        '456',
        '  세번째  ',
      ];
      const sequentialResult = TextCleaner.normalizeAndFilterBatch(texts, 0);
      const batchResult = TextCleaner.normalizeAndFilterBatch(texts, 2);
      expect(sequentialResult).toEqual(batchResult);
    });
  });

  describe('integration tests', () => {
    test('normalize then filter', () => {
      const texts = ['  유효한\n', '\t123\t', '  또 유효함  '];
      const normalized = TextCleaner.normalizeBatch(texts);
      const filtered = TextCleaner.filterValidTexts(normalized);
      expect(filtered).toEqual(['유효한', '또 유효함']);
    });

    test('simulate real document text', () => {
      const docTexts = [
        '고고학   조사   보고서\n\n',
        '   ', // only spaces
        '1장. 서론\n',
        '123456789', // only numbers
        '이 보고서는  여러   문자로   이루어져   있습니다.\n',
        '   ', // only spaces
        '456', // only numbers
        '1.1 조사 배경',
      ];

      const normalized = TextCleaner.normalizeBatch(docTexts);
      const filtered = TextCleaner.filterValidTexts(normalized);

      expect(filtered).toEqual([
        '고고학 조사 보고서',
        '1장. 서론',
        '이 보고서는 여러 문자로 이루어져 있습니다.',
        '1.1 조사 배경',
      ]);
    });
  });
});
