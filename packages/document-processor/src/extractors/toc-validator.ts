import type { TocEntry } from '../types';
import type {
  TocValidationIssue,
  TocValidationResult,
} from './toc-extract-error';

import { TocValidationError } from './toc-extract-error';

/**
 * Validation options for TocValidator
 */
export interface TocValidationOptions {
  /**
   * Total page count of the document (for range validation)
   * If not provided, page range upper bound validation is skipped
   */
  totalPages?: number;

  /**
   * Maximum allowed title length (default: 200)
   */
  maxTitleLength?: number;
}

/**
 * Default validation options
 */
const DEFAULT_OPTIONS: Required<TocValidationOptions> = {
  totalPages: Infinity,
  maxTitleLength: 200,
};

/**
 * TocValidator
 *
 * Validates TocEntry[] structure for consistency and correctness.
 * Performs hierarchical validation including parent-child relationships.
 */
export class TocValidator {
  private readonly options: Required<TocValidationOptions>;
  private issues: TocValidationIssue[];

  constructor(options?: TocValidationOptions) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
    this.issues = [];
  }

  /**
   * Validate TocEntry array
   *
   * @param entries - TOC entries to validate
   * @returns Validation result
   */
  validate(entries: TocEntry[]): TocValidationResult {
    this.issues = [];

    // Validate all entries recursively
    this.validateEntries(entries, '', null, new Set<string>());

    const errorCount = this.issues.length;

    return {
      valid: errorCount === 0,
      issues: [...this.issues],
      errorCount,
    };
  }

  /**
   * Validate and throw if invalid
   *
   * @param entries - TOC entries to validate
   * @throws {TocValidationError} When validation fails
   */
  validateOrThrow(entries: TocEntry[]): void {
    const result = this.validate(entries);

    if (!result.valid) {
      throw new TocValidationError(
        `TOC validation failed with ${result.errorCount} error(s)`,
        result,
      );
    }
  }

  /**
   * Recursively validate entries
   */
  private validateEntries(
    entries: TocEntry[],
    parentPath: string,
    parentEntry: TocEntry | null,
    seenKeys: Set<string>,
  ): void {
    let prevPageNo = parentEntry?.pageNo ?? 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const path = parentPath ? `${parentPath}.children[${i}]` : `[${i}]`;

      // V003: Empty title
      this.validateTitle(entry, path);

      // V004: Title length
      this.validateTitleLength(entry, path);

      // V002: Page range
      this.validatePageRange(entry, path);

      // V001: Page order (within same level)
      this.validatePageOrder(entry, path, prevPageNo);
      prevPageNo = entry.pageNo;

      // V005: Parent-child page relationship
      if (parentEntry) {
        this.validateParentChildPage(entry, path, parentEntry);
      }

      // V006: Duplicate detection
      const key = `${entry.title}:${entry.pageNo}`;
      this.validateDuplicate(entry, path, key, seenKeys);
      seenKeys.add(key);

      // Recursive validation for children
      if (entry.children && entry.children.length > 0) {
        this.validateEntries(entry.children, path, entry, seenKeys);
      }
    }
  }

  /**
   * V003: Validate title is not empty
   */
  private validateTitle(entry: TocEntry, path: string): void {
    if (!entry.title || entry.title.trim() === '') {
      this.addIssue({
        code: 'V003',
        message: 'Title is empty or contains only whitespace',
        path,
        entry,
      });
    }
  }

  /**
   * V004: Validate title length
   */
  private validateTitleLength(entry: TocEntry, path: string): void {
    if (entry.title.length > this.options.maxTitleLength) {
      this.addIssue({
        code: 'V004',
        message: `Title exceeds ${this.options.maxTitleLength} characters (${entry.title.length})`,
        path,
        entry,
      });
    }
  }

  /**
   * V002: Validate page number range
   */
  private validatePageRange(entry: TocEntry, path: string): void {
    if (entry.pageNo < 1) {
      this.addIssue({
        code: 'V002',
        message: `Page number must be >= 1, got ${entry.pageNo}`,
        path,
        entry,
      });
    }

    if (entry.pageNo > this.options.totalPages) {
      this.addIssue({
        code: 'V002',
        message: `Page number ${entry.pageNo} exceeds document total pages (${this.options.totalPages})`,
        path,
        entry,
      });
    }
  }

  /**
   * V001: Validate page order within same level
   */
  private validatePageOrder(
    entry: TocEntry,
    path: string,
    prevPageNo: number,
  ): void {
    if (entry.pageNo < prevPageNo) {
      this.addIssue({
        code: 'V001',
        message: `Page number decreased from ${prevPageNo} to ${entry.pageNo}`,
        path,
        entry,
      });
    }
  }

  /**
   * V005: Validate parent-child page relationship
   */
  private validateParentChildPage(
    entry: TocEntry,
    path: string,
    parent: TocEntry,
  ): void {
    if (entry.pageNo < parent.pageNo) {
      this.addIssue({
        code: 'V005',
        message: `Child page (${entry.pageNo}) is before parent page (${parent.pageNo})`,
        path,
        entry,
      });
    }
  }

  /**
   * V006: Validate no duplicates
   */
  private validateDuplicate(
    entry: TocEntry,
    path: string,
    key: string,
    seenKeys: Set<string>,
  ): void {
    if (seenKeys.has(key)) {
      this.addIssue({
        code: 'V006',
        message: `Duplicate entry: "${entry.title}" at page ${entry.pageNo}`,
        path,
        entry,
      });
    }
  }

  /**
   * Add issue to the list
   */
  private addIssue(issue: TocValidationIssue): void {
    this.issues.push(issue);
  }
}
