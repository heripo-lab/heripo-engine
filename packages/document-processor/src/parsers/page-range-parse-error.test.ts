import { describe, expect, test } from 'vitest';

import { PageRangeParseError } from './page-range-parse-error';

describe('PageRangeParseError', () => {
  describe('constructor', () => {
    test('creates error with message', () => {
      const error = new PageRangeParseError('test message');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(PageRangeParseError);
      expect(error.message).toBe('test message');
      expect(error.name).toBe('PageRangeParseError');
    });

    test('creates error with cause option', () => {
      const cause = new Error('original error');
      const error = new PageRangeParseError('wrapped message', { cause });

      expect(error.message).toBe('wrapped message');
      expect(error.cause).toBe(cause);
    });
  });

  describe('getErrorMessage', () => {
    test('returns message from Error instance', () => {
      const error = new Error('error message');
      const result = PageRangeParseError.getErrorMessage(error);

      expect(result).toBe('error message');
    });

    test('returns String() for non-Error objects', () => {
      expect(PageRangeParseError.getErrorMessage('string error')).toBe(
        'string error',
      );
      expect(PageRangeParseError.getErrorMessage(42)).toBe('42');
      expect(PageRangeParseError.getErrorMessage(null)).toBe('null');
      expect(PageRangeParseError.getErrorMessage(undefined)).toBe('undefined');
      expect(PageRangeParseError.getErrorMessage({ key: 'value' })).toBe(
        '[object Object]',
      );
    });
  });

  describe('fromError', () => {
    test('creates PageRangeParseError from Error with context', () => {
      const cause = new Error('original error');
      const error = PageRangeParseError.fromError('context message', cause);

      expect(error).toBeInstanceOf(PageRangeParseError);
      expect(error.message).toBe('context message: original error');
      expect(error.cause).toBe(cause);
    });

    test('creates PageRangeParseError from non-Error with context', () => {
      const error = PageRangeParseError.fromError(
        'context message',
        'string error',
      );

      expect(error).toBeInstanceOf(PageRangeParseError);
      expect(error.message).toBe('context message: string error');
      expect(error.cause).toBe('string error');
    });

    test('creates PageRangeParseError from number with context', () => {
      const error = PageRangeParseError.fromError('context message', 404);

      expect(error.message).toBe('context message: 404');
      expect(error.cause).toBe(404);
    });
  });
});
