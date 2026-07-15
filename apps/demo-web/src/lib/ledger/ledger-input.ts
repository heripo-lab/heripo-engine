import type { ProcessedDocument } from '@heripo/model';

import {
  ProcessedDocumentValidationError,
  parseProcessedDocument,
} from '@heripo/ledger-extractor';

/**
 * Maximum accepted size for a processed-document.json upload.
 * Processed documents for large reports stay well below this; the limit
 * only exists to prevent unbounded uploads.
 */
export const LEDGER_INPUT_MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

/**
 * MIME types accepted for the ledger JSON upload. Browsers may send an
 * empty type or application/octet-stream, so the file extension is checked
 * as well (see isAllowedLedgerInputFile).
 */
const ALLOWED_MIME_TYPES = new Set([
  'application/json',
  'text/json',
  'application/octet-stream',
  '',
]);

export const LEDGER_ERROR_CODES = {
  INVALID_LEDGER_INPUT_TYPE: 'INVALID_LEDGER_INPUT_TYPE',
  LEDGER_INPUT_TOO_LARGE: 'LEDGER_INPUT_TOO_LARGE',
  INVALID_JSON: 'INVALID_JSON',
  INVALID_PROCESSED_DOCUMENT: 'INVALID_PROCESSED_DOCUMENT',
  LEDGER_EXTRACTION_ERROR: 'LEDGER_EXTRACTION_ERROR',
} as const;

export type LedgerErrorCode =
  (typeof LEDGER_ERROR_CODES)[keyof typeof LEDGER_ERROR_CODES];

/**
 * Error with a stable code so API routes and workers can map failures to
 * distinct responses without leaking internals.
 */
export class LedgerInputError extends Error {
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.name = 'LedgerInputError';
    this.code = code;
  }
}

/**
 * Checks the upload file's extension and MIME type.
 * ZIP archives, manifests, and image bundles are rejected — the ledger
 * stage accepts a single JSON file only.
 */
export function isAllowedLedgerInputFile(file: {
  name: string;
  type: string;
}): boolean {
  const hasJsonExtension = file.name.toLowerCase().endsWith('.json');
  return hasJsonExtension && ALLOWED_MIME_TYPES.has(file.type.toLowerCase());
}

interface ParseLedgerInputHooks {
  /**
   * Called after JSON.parse succeeds and before document validation.
   * Used by the worker to advance the progress step.
   */
  onJsonParsed?: () => void;
}

/**
 * Parses UTF-8 JSON text into a validated ProcessedDocument.
 *
 * @throws {LedgerInputError} INVALID_JSON when the text is not valid JSON,
 *   INVALID_PROCESSED_DOCUMENT when the value fails runtime validation
 */
export function parseLedgerInputText(
  text: string,
  hooks: ParseLedgerInputHooks = {},
): ProcessedDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LedgerInputError(
      LEDGER_ERROR_CODES.INVALID_JSON,
      'The uploaded file is not valid JSON',
    );
  }

  hooks.onJsonParsed?.();

  try {
    return parseProcessedDocument(parsed);
  } catch (error) {
    const detail =
      error instanceof ProcessedDocumentValidationError
        ? error.message
        : 'The uploaded JSON is not a valid ProcessedDocument';
    throw new LedgerInputError(
      LEDGER_ERROR_CODES.INVALID_PROCESSED_DOCUMENT,
      detail,
    );
  }
}
