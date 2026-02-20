import type { TocEntry } from '../types';

import { beforeEach, describe, expect, test } from 'vitest';

import { TocValidationError } from './toc-extract-error';
import { TocValidator } from './toc-validator';

describe('TocValidator', () => {
  describe('constructor', () => {
    test('uses default options when none provided', () => {
      const validator = new TocValidator();
      const entries: TocEntry[] = [{ title: 'Chapter 1', level: 1, pageNo: 1 }];

      const result = validator.validate(entries);

      expect(result.valid).toBe(true);
    });

    test('merges provided options with defaults', () => {
      const validator = new TocValidator({ maxTitleLength: 10 });
      const entries: TocEntry[] = [
        { title: 'Very Long Chapter Title', level: 1, pageNo: 1 },
      ];

      const result = validator.validate(entries);

      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('V004');
    });
  });

  describe('validate', () => {
    let validator: TocValidator;

    beforeEach(() => {
      validator = new TocValidator({ totalPages: 100, maxTitleLength: 200 });
    });

    describe('V003: Empty title', () => {
      test('returns error for empty title', () => {
        const entries: TocEntry[] = [{ title: '', level: 1, pageNo: 1 }];

        const result = validator.validate(entries);

        expect(result.valid).toBe(false);
        expect(result.errorCount).toBe(1);
        expect(result.issues[0].code).toBe('V003');
        expect(result.issues[0].message).toBe(
          'Title is empty or contains only whitespace',
        );
        expect(result.issues[0].path).toBe('[0]');
      });

      test('returns error for whitespace-only title', () => {
        const entries: TocEntry[] = [
          { title: '   \t\n  ', level: 1, pageNo: 1 },
        ];

        const result = validator.validate(entries);

        expect(result.valid).toBe(false);
        expect(result.issues[0].code).toBe('V003');
      });
    });

    describe('V004: Title length', () => {
      test('returns error for title exceeding maxTitleLength', () => {
        const longTitle = 'A'.repeat(250);
        const entries: TocEntry[] = [{ title: longTitle, level: 1, pageNo: 1 }];

        const result = validator.validate(entries);

        expect(result.valid).toBe(false);
        expect(result.issues[0].code).toBe('V004');
        expect(result.issues[0].message).toContain('250');
      });

      test('passes for title at exactly maxTitleLength', () => {
        const exactTitle = 'A'.repeat(200);
        const entries: TocEntry[] = [
          { title: exactTitle, level: 1, pageNo: 1 },
        ];

        const result = validator.validate(entries);

        expect(result.valid).toBe(true);
      });

      test('respects custom maxTitleLength option', () => {
        const customValidator = new TocValidator({ maxTitleLength: 50 });
        const entries: TocEntry[] = [
          { title: 'A'.repeat(51), level: 1, pageNo: 1 },
        ];

        const result = customValidator.validate(entries);

        expect(result.valid).toBe(false);
        expect(result.issues[0].code).toBe('V004');
      });
    });

    describe('V002: Page range', () => {
      test('returns error for pageNo less than 1', () => {
        const entries: TocEntry[] = [{ title: 'Chapter', level: 1, pageNo: 0 }];

        const result = validator.validate(entries);

        expect(result.valid).toBe(false);
        expect(result.issues[0].code).toBe('V002');
        expect(result.issues[0].message).toContain('must be >= 1');
      });

      test('returns error for negative pageNo', () => {
        const entries: TocEntry[] = [
          { title: 'Chapter', level: 1, pageNo: -5 },
        ];

        const result = validator.validate(entries);

        expect(result.valid).toBe(false);
        expect(result.issues[0].code).toBe('V002');
      });

      test('returns error for pageNo exceeding totalPages', () => {
        const entries: TocEntry[] = [
          { title: 'Chapter', level: 1, pageNo: 150 },
        ];

        const result = validator.validate(entries);

        expect(result.valid).toBe(false);
        expect(result.issues[0].code).toBe('V002');
        expect(result.issues[0].message).toContain(
          'exceeds document total pages',
        );
      });

      test('skips totalPages validation when not provided', () => {
        const noTotalPagesValidator = new TocValidator();
        const entries: TocEntry[] = [
          { title: 'Chapter', level: 1, pageNo: 999999 },
        ];

        const result = noTotalPagesValidator.validate(entries);

        expect(result.valid).toBe(true);
      });
    });

    describe('V001: Page order', () => {
      test('returns error when page number decreases at same level', () => {
        const entries: TocEntry[] = [
          { title: 'Chapter 1', level: 1, pageNo: 50 },
          { title: 'Chapter 2', level: 1, pageNo: 30 },
        ];

        const result = validator.validate(entries);

        expect(result.valid).toBe(false);
        expect(result.issues[0].code).toBe('V001');
        expect(result.issues[0].message).toContain('decreased from 50 to 30');
        expect(result.issues[0].path).toBe('[1]');
      });

      test('passes when page numbers are equal', () => {
        const entries: TocEntry[] = [
          { title: 'Chapter 1', level: 1, pageNo: 10 },
          { title: 'Chapter 2', level: 1, pageNo: 10 },
        ];

        const result = validator.validate(entries);

        expect(result.valid).toBe(true);
      });

      test('passes when page numbers increase', () => {
        const entries: TocEntry[] = [
          { title: 'Chapter 1', level: 1, pageNo: 1 },
          { title: 'Chapter 2', level: 1, pageNo: 10 },
          { title: 'Chapter 3', level: 1, pageNo: 20 },
        ];

        const result = validator.validate(entries);

        expect(result.valid).toBe(true);
      });
    });

    describe('V005: Parent-child page relationship', () => {
      test('returns error when child pageNo is less than parent', () => {
        const entries: TocEntry[] = [
          {
            title: 'Chapter 1',
            level: 1,
            pageNo: 50,
            children: [{ title: 'Section 1.1', level: 2, pageNo: 30 }],
          },
        ];

        const result = validator.validate(entries);

        expect(result.valid).toBe(false);
        const v005Issue = result.issues.find((i) => i.code === 'V005');
        expect(v005Issue).toBeDefined();
        expect(v005Issue!.message).toContain(
          'Child page (30) is before parent page (50)',
        );
        expect(v005Issue!.path).toBe('[0].children[0]');
      });

      test('passes when child pageNo equals parent', () => {
        const entries: TocEntry[] = [
          {
            title: 'Chapter 1',
            level: 1,
            pageNo: 10,
            children: [{ title: 'Section 1.1', level: 2, pageNo: 10 }],
          },
        ];

        const result = validator.validate(entries);

        expect(result.valid).toBe(true);
      });

      test('passes when child pageNo is greater than parent', () => {
        const entries: TocEntry[] = [
          {
            title: 'Chapter 1',
            level: 1,
            pageNo: 10,
            children: [{ title: 'Section 1.1', level: 2, pageNo: 15 }],
          },
        ];

        const result = validator.validate(entries);

        expect(result.valid).toBe(true);
      });
    });

    describe('V006: Duplicate detection', () => {
      test('returns error for duplicate title+pageNo combination', () => {
        const entries: TocEntry[] = [
          { title: 'Chapter 1', level: 1, pageNo: 10 },
          { title: 'Chapter 1', level: 1, pageNo: 10 },
        ];

        const result = validator.validate(entries);

        expect(result.valid).toBe(false);
        expect(result.issues[0].code).toBe('V006');
        expect(result.issues[0].message).toContain('Duplicate entry');
        expect(result.issues[0].path).toBe('[1]');
      });

      test('passes for same title with different pageNo', () => {
        const entries: TocEntry[] = [
          { title: 'Introduction', level: 1, pageNo: 1 },
          { title: 'Introduction', level: 1, pageNo: 50 },
        ];

        const result = validator.validate(entries);

        expect(result.valid).toBe(true);
      });

      test('passes for same pageNo with different title', () => {
        const entries: TocEntry[] = [
          { title: 'Chapter A', level: 1, pageNo: 10 },
          { title: 'Chapter B', level: 1, pageNo: 10 },
        ];

        const result = validator.validate(entries);

        expect(result.valid).toBe(true);
      });

      test('detects duplicates across different levels', () => {
        const entries: TocEntry[] = [
          {
            title: 'Chapter 1',
            level: 1,
            pageNo: 10,
            children: [{ title: 'Chapter 1', level: 2, pageNo: 10 }],
          },
        ];

        const result = validator.validate(entries);

        expect(result.valid).toBe(false);
        expect(result.issues[0].code).toBe('V006');
      });
    });

    describe('Complex scenarios', () => {
      test('validates deeply nested entries', () => {
        const entries: TocEntry[] = [
          {
            title: 'Level 1',
            level: 1,
            pageNo: 1,
            children: [
              {
                title: 'Level 2',
                level: 2,
                pageNo: 5,
                children: [
                  {
                    title: 'Level 3',
                    level: 3,
                    pageNo: 10,
                    children: [{ title: 'Level 4', level: 4, pageNo: 15 }],
                  },
                ],
              },
            ],
          },
        ];

        const result = validator.validate(entries);

        expect(result.valid).toBe(true);
      });

      test('accumulates multiple issues from different rules', () => {
        const entries: TocEntry[] = [
          { title: '', level: 1, pageNo: 0 },
          { title: 'A'.repeat(250), level: 1, pageNo: 150 },
        ];

        const result = validator.validate(entries);

        expect(result.valid).toBe(false);
        expect(result.errorCount).toBeGreaterThan(1);
        const codes = result.issues.map((i) => i.code);
        expect(codes).toContain('V003');
        expect(codes).toContain('V002');
        expect(codes).toContain('V004');
      });

      test('returns correct error count', () => {
        const entries: TocEntry[] = [
          { title: '', level: 1, pageNo: 1 },
          { title: '', level: 1, pageNo: 2 },
          { title: '', level: 1, pageNo: 3 },
        ];

        const result = validator.validate(entries);

        expect(result.errorCount).toBe(3);
      });

      test('returns valid: true when no errors', () => {
        const entries: TocEntry[] = [
          { title: 'Chapter 1', level: 1, pageNo: 1 },
          { title: 'Chapter 2', level: 1, pageNo: 10 },
        ];

        const result = validator.validate(entries);

        expect(result.valid).toBe(true);
        expect(result.errorCount).toBe(0);
        expect(result.issues).toHaveLength(0);
      });

      test('returns valid: false when errors exist', () => {
        const entries: TocEntry[] = [{ title: '', level: 1, pageNo: 1 }];

        const result = validator.validate(entries);

        expect(result.valid).toBe(false);
      });

      test('handles empty entries array', () => {
        const entries: TocEntry[] = [];

        const result = validator.validate(entries);

        expect(result.valid).toBe(true);
        expect(result.errorCount).toBe(0);
      });

      test('clears issues between validate calls', () => {
        const invalidEntries: TocEntry[] = [{ title: '', level: 1, pageNo: 1 }];
        const validEntries: TocEntry[] = [
          { title: 'Chapter 1', level: 1, pageNo: 1 },
        ];

        validator.validate(invalidEntries);
        const result = validator.validate(validEntries);

        expect(result.valid).toBe(true);
        expect(result.errorCount).toBe(0);
      });
    });
  });

  describe('validateOrThrow', () => {
    let validator: TocValidator;

    beforeEach(() => {
      validator = new TocValidator({ totalPages: 100 });
    });

    test('throws TocValidationError when errors exist', () => {
      const entries: TocEntry[] = [{ title: '', level: 1, pageNo: 1 }];

      expect(() => validator.validateOrThrow(entries)).toThrow(
        TocValidationError,
      );
    });

    test('does not throw for valid entries', () => {
      const entries: TocEntry[] = [{ title: 'Chapter 1', level: 1, pageNo: 1 }];

      expect(() => validator.validateOrThrow(entries)).not.toThrow();
    });

    test('includes validation result in error', () => {
      const entries: TocEntry[] = [{ title: '', level: 1, pageNo: 1 }];

      try {
        validator.validateOrThrow(entries);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TocValidationError);
        const validationError = error as TocValidationError;
        expect(validationError.validationResult).toBeDefined();
        expect(validationError.validationResult.errorCount).toBe(1);
        expect(validationError.validationResult.issues[0].code).toBe('V003');
      }
    });

    test('error message contains error count', () => {
      const entries: TocEntry[] = [
        { title: '', level: 1, pageNo: 1 },
        { title: '', level: 1, pageNo: 2 },
      ];

      expect(() => validator.validateOrThrow(entries)).toThrow(/2 error\(s\)/);
    });

    test('error message contains detailed issue information', () => {
      const entries: TocEntry[] = [
        { title: '', level: 1, pageNo: 1 },
        { title: 'Chapter 2', level: 1, pageNo: 30 },
        { title: 'Chapter 1', level: 1, pageNo: 10 },
      ];

      try {
        validator.validateOrThrow(entries);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TocValidationError);
        const validationError = error as TocValidationError;
        expect(validationError.message).toContain('[V003]');
        expect(validationError.message).toContain(
          'Title is empty or contains only whitespace',
        );
        expect(validationError.message).toContain('path: [0]');
        expect(validationError.message).toContain('[V001]');
        expect(validationError.message).toContain(
          'Page number decreased from 30 to 10',
        );
        expect(validationError.message).toContain('path: [2]');
        expect(validationError.message).toContain('entry: "Chapter 1" page 10');
      }
    });
  });
});
