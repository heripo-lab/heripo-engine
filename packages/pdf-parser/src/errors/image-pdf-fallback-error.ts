/**
 * Error thrown when both original PDF conversion and image PDF fallback fail.
 * Contains both errors for debugging purposes.
 */
export class ImagePdfFallbackError extends Error {
  public readonly name = 'ImagePdfFallbackError';

  constructor(
    public readonly originalError: Error,
    public readonly fallbackError: Error,
  ) {
    super(
      `PDF conversion failed with fallback. ` +
        `Original: ${originalError.message}. ` +
        `Fallback: ${fallbackError.message}`,
    );
  }
}
