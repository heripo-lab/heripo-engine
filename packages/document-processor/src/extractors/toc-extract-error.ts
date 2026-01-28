import type { TocEntry } from '../types';

/**
 * Single validation issue detected during TOC validation
 */
export interface TocValidationIssue {
  /**
   * Issue code (V001, V002, etc.)
   */
  code: string;

  /**
   * Human-readable error message
   */
  message: string;

  /**
   * Path to the problematic entry (e.g., "[0].children[2]")
   */
  path: string;

  /**
   * The problematic entry
   */
  entry: TocEntry;
}

/**
 * Result of TOC validation
 */
export interface TocValidationResult {
  /**
   * Whether validation passed (no errors)
   */
  valid: boolean;

  /**
   * List of validation issues
   */
  issues: TocValidationIssue[];

  /**
   * Error count
   */
  errorCount: number;
}

/**
 * TocExtractError
 *
 * Base error class for TOC extraction failures.
 */
export class TocExtractError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TocExtractError';
  }

  /**
   * Extract error message from unknown error type
   */
  static getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Create TocExtractError from unknown error with context
   */
  static fromError(context: string, error: unknown): TocExtractError {
    return new TocExtractError(
      `${context}: ${TocExtractError.getErrorMessage(error)}`,
      { cause: error },
    );
  }
}

/**
 * TocNotFoundError
 *
 * Error thrown when TOC area cannot be found in the document.
 */
export class TocNotFoundError extends TocExtractError {
  constructor(message = 'Table of contents not found in the document') {
    super(message);
    this.name = 'TocNotFoundError';
  }
}

/**
 * TocParseError
 *
 * Error thrown when LLM fails to parse TOC structure.
 */
export class TocParseError extends TocExtractError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TocParseError';
  }
}

/**
 * TocValidationError
 *
 * Error thrown when TOC validation fails.
 * Contains detailed information about validation issues.
 */
export class TocValidationError extends TocExtractError {
  /**
   * Validation result with detailed issues
   */
  readonly validationResult: TocValidationResult;

  constructor(message: string, validationResult: TocValidationResult) {
    super(message);
    this.name = 'TocValidationError';
    this.validationResult = validationResult;
  }

  /**
   * Get formatted error summary
   */
  getSummary(): string {
    const { errorCount, issues } = this.validationResult;
    const lines = [
      `TOC validation failed: ${errorCount} error(s)`,
      '',
      'Issues:',
    ];

    for (const issue of issues) {
      lines.push(`  [${issue.code}] ${issue.message}`);
      lines.push(`    Path: ${issue.path}`);
      lines.push(
        `    Entry: "${issue.entry.title}" (page ${issue.entry.pageNo})`,
      );
    }

    return lines.join('\n');
  }
}
