import type { TocValidationResult } from './toc-extract-error';

import { describe, expect, test } from 'vitest';

import {
  TocExtractError,
  TocNotFoundError,
  TocParseError,
  TocValidationError,
} from './toc-extract-error';

describe('TocExtractError', () => {
  describe('constructor', () => {
    test('creates error with message', () => {
      const error = new TocExtractError('test message');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(TocExtractError);
      expect(error.message).toBe('test message');
      expect(error.name).toBe('TocExtractError');
    });

    test('creates error with cause option', () => {
      const cause = new Error('original error');
      const error = new TocExtractError('wrapped message', { cause });

      expect(error.message).toBe('wrapped message');
      expect(error.cause).toBe(cause);
    });
  });

  describe('getErrorMessage', () => {
    test('returns message from Error instance', () => {
      const error = new Error('error message');
      const result = TocExtractError.getErrorMessage(error);

      expect(result).toBe('error message');
    });

    test('returns String() for non-Error objects', () => {
      expect(TocExtractError.getErrorMessage('string error')).toBe(
        'string error',
      );
      expect(TocExtractError.getErrorMessage(42)).toBe('42');
      expect(TocExtractError.getErrorMessage(null)).toBe('null');
      expect(TocExtractError.getErrorMessage(undefined)).toBe('undefined');
      expect(TocExtractError.getErrorMessage({ key: 'value' })).toBe(
        '[object Object]',
      );
    });
  });

  describe('fromError', () => {
    test('creates TocExtractError from Error with context', () => {
      const cause = new Error('original error');
      const error = TocExtractError.fromError('context message', cause);

      expect(error).toBeInstanceOf(TocExtractError);
      expect(error.message).toBe('context message: original error');
      expect(error.cause).toBe(cause);
    });

    test('creates TocExtractError from non-Error with context', () => {
      const error = TocExtractError.fromError(
        'context message',
        'string error',
      );

      expect(error).toBeInstanceOf(TocExtractError);
      expect(error.message).toBe('context message: string error');
      expect(error.cause).toBe('string error');
    });

    test('creates TocExtractError from number with context', () => {
      const error = TocExtractError.fromError('context message', 404);

      expect(error.message).toBe('context message: 404');
      expect(error.cause).toBe(404);
    });
  });
});

describe('TocNotFoundError', () => {
  test('creates error with default message', () => {
    const error = new TocNotFoundError();

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(TocExtractError);
    expect(error).toBeInstanceOf(TocNotFoundError);
    expect(error.message).toBe('Table of contents not found in the document');
    expect(error.name).toBe('TocNotFoundError');
  });

  test('creates error with custom message', () => {
    const error = new TocNotFoundError('Custom not found message');

    expect(error.message).toBe('Custom not found message');
    expect(error.name).toBe('TocNotFoundError');
  });
});

describe('TocParseError', () => {
  test('creates error with message', () => {
    const error = new TocParseError('failed to parse TOC');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(TocExtractError);
    expect(error).toBeInstanceOf(TocParseError);
    expect(error.message).toBe('failed to parse TOC');
    expect(error.name).toBe('TocParseError');
  });

  test('creates error with cause option', () => {
    const cause = new Error('LLM API error');
    const error = new TocParseError('parse failed', { cause });

    expect(error.message).toBe('parse failed');
    expect(error.cause).toBe(cause);
  });
});

describe('TocValidationError', () => {
  const createValidationResult = (
    errorCount: number,
    issues: TocValidationResult['issues'] = [],
  ): TocValidationResult => ({
    valid: errorCount === 0,
    issues,
    errorCount,
  });

  test('creates error with message and validation result', () => {
    const validationResult = createValidationResult(1, [
      {
        code: 'V003',
        message: 'Title is empty',
        path: '[0]',
        entry: { title: '', level: 1, pageNo: 1 },
      },
    ]);
    const error = new TocValidationError('validation failed', validationResult);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(TocExtractError);
    expect(error).toBeInstanceOf(TocValidationError);
    expect(error.message).toBe('validation failed');
    expect(error.name).toBe('TocValidationError');
  });

  test('stores validation result', () => {
    const validationResult = createValidationResult(2, [
      {
        code: 'V003',
        message: 'Title is empty',
        path: '[0]',
        entry: { title: '', level: 1, pageNo: 1 },
      },
      {
        code: 'V001',
        message: 'Page order violation',
        path: '[1]',
        entry: { title: 'Chapter', level: 1, pageNo: 5 },
      },
    ]);
    const error = new TocValidationError('validation failed', validationResult);

    expect(error.validationResult).toBe(validationResult);
    expect(error.validationResult.errorCount).toBe(2);
    expect(error.validationResult.issues).toHaveLength(2);
  });

  describe('getSummary', () => {
    test('formats summary with error count', () => {
      const validationResult = createValidationResult(1, [
        {
          code: 'V003',
          message: 'Title is empty or contains only whitespace',
          path: '[0]',
          entry: { title: '', level: 1, pageNo: 1 },
        },
      ]);
      const error = new TocValidationError(
        'validation failed',
        validationResult,
      );

      const summary = error.getSummary();

      expect(summary).toContain('TOC validation failed: 1 error(s)');
      expect(summary).toContain('Issues:');
    });

    test('includes all issues with codes and messages', () => {
      const validationResult = createValidationResult(2, [
        {
          code: 'V003',
          message: 'Title is empty',
          path: '[0]',
          entry: { title: '', level: 1, pageNo: 1 },
        },
        {
          code: 'V001',
          message: 'Page order violation',
          path: '[1]',
          entry: { title: 'Chapter 2', level: 1, pageNo: 5 },
        },
      ]);
      const error = new TocValidationError(
        'validation failed',
        validationResult,
      );

      const summary = error.getSummary();

      expect(summary).toContain('[V003] Title is empty');
      expect(summary).toContain('[V001] Page order violation');
    });

    test('includes paths in summary', () => {
      const validationResult = createValidationResult(1, [
        {
          code: 'V005',
          message: 'Child before parent',
          path: '[0].children[2]',
          entry: { title: 'Section', level: 2, pageNo: 3 },
        },
      ]);
      const error = new TocValidationError(
        'validation failed',
        validationResult,
      );

      const summary = error.getSummary();

      expect(summary).toContain('Path: [0].children[2]');
    });

    test('includes entry details in summary', () => {
      const validationResult = createValidationResult(1, [
        {
          code: 'V002',
          message: 'Page exceeds total',
          path: '[0]',
          entry: { title: 'Final Chapter', level: 1, pageNo: 999 },
        },
      ]);
      const error = new TocValidationError(
        'validation failed',
        validationResult,
      );

      const summary = error.getSummary();

      expect(summary).toContain('Entry: "Final Chapter" (page 999)');
    });
  });
});
