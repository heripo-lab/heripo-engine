/**
 * PageRangeParseError
 *
 * Custom error thrown when page range parsing fails.
 */
export class PageRangeParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PageRangeParseError';
  }

  /**
   * Extract error message from unknown error type
   */
  static getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Create PageRangeParseError from unknown error with context
   */
  static fromError(context: string, error: unknown): PageRangeParseError {
    return new PageRangeParseError(
      `${context}: ${PageRangeParseError.getErrorMessage(error)}`,
      { cause: error },
    );
  }
}
