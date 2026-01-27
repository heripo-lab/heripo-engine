import { describe, expect, test } from 'vitest';

import { ImagePdfFallbackError } from './image-pdf-fallback-error';

describe('ImagePdfFallbackError', () => {
  test('should have correct name property', () => {
    const originalError = new Error('Original conversion failed');
    const fallbackError = new Error('Fallback conversion failed');
    const error = new ImagePdfFallbackError(originalError, fallbackError);

    expect(error.name).toBe('ImagePdfFallbackError');
  });

  test('should contain both original and fallback errors', () => {
    const originalError = new Error('Original conversion failed');
    const fallbackError = new Error('Fallback conversion failed');
    const error = new ImagePdfFallbackError(originalError, fallbackError);

    expect(error.originalError).toBe(originalError);
    expect(error.fallbackError).toBe(fallbackError);
  });

  test('should format message correctly with both error messages', () => {
    const originalError = new Error('Encoding issue');
    const fallbackError = new Error('ImageMagick failed');
    const error = new ImagePdfFallbackError(originalError, fallbackError);

    expect(error.message).toBe(
      'PDF conversion failed with fallback. Original: Encoding issue. Fallback: ImageMagick failed',
    );
  });

  test('should be an instance of Error', () => {
    const originalError = new Error('Original');
    const fallbackError = new Error('Fallback');
    const error = new ImagePdfFallbackError(originalError, fallbackError);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ImagePdfFallbackError);
  });
});
