/**
 * Error thrown when the uploaded PDF does not appear to be
 * an archaeological investigation report.
 */
export class InvalidDocumentTypeError extends Error {
  public readonly name = 'InvalidDocumentTypeError';
  public readonly code = 'INVALID_DOCUMENT_TYPE';

  constructor(public readonly reason: string) {
    super(
      `The uploaded PDF does not appear to be an archaeological investigation report. Reason: ${reason}`,
    );
  }
}
