import { describe, expect, test } from 'vitest';

import { InvalidDocumentTypeError } from './invalid-document-type-error';

describe('InvalidDocumentTypeError', () => {
  test('should set name to InvalidDocumentTypeError', () => {
    const error = new InvalidDocumentTypeError('test reason');
    expect(error.name).toBe('InvalidDocumentTypeError');
  });

  test('should set code to INVALID_DOCUMENT_TYPE', () => {
    const error = new InvalidDocumentTypeError('test reason');
    expect(error.code).toBe('INVALID_DOCUMENT_TYPE');
  });

  test('should include reason in message', () => {
    const error = new InvalidDocumentTypeError('not an archaeological report');
    expect(error.message).toBe(
      'The uploaded PDF does not appear to be an archaeological investigation report. Reason: not an' +
        ' archaeological report',
    );
  });

  test('should store the reason', () => {
    const error = new InvalidDocumentTypeError('some reason');
    expect(error.reason).toBe('some reason');
  });

  test('should be an instance of Error', () => {
    const error = new InvalidDocumentTypeError('test');
    expect(error).toBeInstanceOf(Error);
  });
});
