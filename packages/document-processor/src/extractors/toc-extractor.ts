import type { LoggerMethods } from '@heripo/logger';
import type { ExtendedTokenUsage } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { TocEntry } from '../types';
import type { TocValidationIssue } from './toc-extract-error';
import type { TocValidationOptions } from './toc-validator';

import { z } from 'zod';

import {
  type BaseLLMComponentOptions,
  TextLLMComponent,
} from '../core/text-llm-component';
import { TocParseError, TocValidationError } from './toc-extract-error';
import { TocValidator } from './toc-validator';

// TODO: Make configurable via TocExtractorOptions when exposing to DocumentProcessorOptions
const MAX_VALIDATION_RETRIES = 3;

/**
 * Validation error code descriptions for correction prompts
 */
const VALIDATION_CODE_DESCRIPTIONS: Record<string, string> = {
  V001: 'Page numbers must be in non-decreasing order within the same level. A decrease usually means a hierarchy or page number error.',
  V002: 'Page number is out of valid range (must be >= 1 and <= total pages).',
  V003: 'Title is empty or contains only whitespace.',
  V004: 'Title exceeds the maximum allowed length.',
  V005: 'Child page number is before parent page number. Children must start on or after the parent page.',
  V006: 'Duplicate entry detected (same title and page number).',
  V007: 'First TOC entry starts too late in the document. Earlier entries may be missing.',
};

/**
 * Zod schema for recursive TocEntry structure
 */
export const TocEntrySchema: z.ZodType<TocEntry> = z.lazy(() =>
  z.object({
    title: z.string().describe('Chapter or section title'),
    level: z.number().int().min(1).describe('Hierarchy depth (1 = top level)'),
    pageNo: z.number().int().min(1).describe('Starting page number'),
    children: z
      .array(TocEntrySchema)
      .describe('Child sections (use empty array [] if none)'),
  }),
);

/**
 * Schema for LLM response
 */
export const TocResponseSchema = z.object({
  entries: z.array(TocEntrySchema).describe('Extracted TOC entries'),
});

export type TocResponse = z.infer<typeof TocResponseSchema>;

/**
 * TocExtractor options
 */
export interface TocExtractorOptions extends BaseLLMComponentOptions {
  /**
   * Validation options (optional)
   * If not provided, validation is performed with default settings
   */
  validation?: TocValidationOptions;

  /**
   * Whether to skip validation entirely (default: false)
   */
  skipValidation?: boolean;
}

/**
 * TocExtractor
 *
 * Uses high-performance LLM to extract structured TOC from Markdown representation.
 * Extends TextLLMComponent for standardized LLM call handling.
 *
 * When validation fails, automatically retries with correction feedback
 * up to MAX_VALIDATION_RETRIES times before throwing.
 */
export class TocExtractor extends TextLLMComponent {
  private readonly validationOptions?: TocValidationOptions;
  private readonly skipValidation: boolean;

  constructor(
    logger: LoggerMethods,
    model: LanguageModel,
    options?: TocExtractorOptions,
    fallbackModel?: LanguageModel,
    abortSignal?: AbortSignal,
  ) {
    super(
      logger,
      model,
      'TocExtractor',
      { ...options, abortSignal },
      fallbackModel,
    );
    this.validationOptions = options?.validation;
    this.skipValidation = options?.skipValidation ?? false;
  }

  /**
   * Extract TOC structure from Markdown
   *
   * When validation fails, retries with correction feedback up to MAX_VALIDATION_RETRIES times.
   *
   * @param markdown - Markdown representation of TOC area
   * @param validationOverrides - Optional overrides for validation options (merged with constructor options)
   * @returns Object with entries array and token usage array (initial extraction + any corrections)
   * @throws {TocParseError} When LLM fails to parse structure
   * @throws {TocValidationError} When validation fails after all retries
   */
  async extract(
    markdown: string,
    validationOverrides?: Partial<TocValidationOptions>,
  ): Promise<{ entries: TocEntry[]; usages: ExtendedTokenUsage[] }> {
    this.log('info', `Starting TOC extraction (${markdown.length} chars)`);

    if (!markdown.trim()) {
      this.log('error', 'Cannot extract TOC from empty markdown content');
      throw new TocParseError(
        'TOC extraction failed: provided markdown content is empty',
      );
    }

    try {
      // Initial extraction
      const result = await this.callTextLLM(
        TocResponseSchema,
        this.buildSystemPrompt(),
        this.buildUserPrompt(markdown),
        'extraction',
      );

      const usages: ExtendedTokenUsage[] = [result.usage];
      let entries = this.normalizeEntries(result.output.entries);

      // Validate and retry if needed
      if (!this.skipValidation) {
        let validationError = this.tryValidateEntries(
          entries,
          validationOverrides,
        );

        // Retry loop with correction feedback
        for (
          let attempt = 1;
          attempt <= MAX_VALIDATION_RETRIES && validationError !== null;
          attempt++
        ) {
          this.log(
            'warn',
            `Validation failed (attempt ${attempt}/${MAX_VALIDATION_RETRIES}), retrying with correction feedback`,
          );

          const correctionPrompt = this.buildCorrectionPrompt(
            markdown,
            entries,
            validationError.validationResult.issues,
          );

          const correctionResult = await this.callTextLLM(
            TocResponseSchema,
            this.buildSystemPrompt(),
            correctionPrompt,
            `correction-${attempt}`,
          );

          usages.push(correctionResult.usage);
          entries = this.normalizeEntries(correctionResult.output.entries);
          validationError = this.tryValidateEntries(
            entries,
            validationOverrides,
          );
        }

        // If still failing after all retries, throw the last error
        if (validationError !== null) {
          this.log(
            'error',
            `Validation failed after ${MAX_VALIDATION_RETRIES} retries:\n${validationError.getSummary()}`,
          );
          throw validationError;
        }
      }

      this.log(
        'info',
        `Extraction completed: ${entries.length} top-level entries (${usages.length} LLM call(s))`,
      );

      return { entries, usages };
    } catch (error) {
      // Re-throw TocValidationError as-is
      if (error instanceof TocValidationError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.log('error', `Extraction failed: ${message}`);
      throw new TocParseError(`Failed to extract TOC structure: ${message}`, {
        cause: error,
      });
    }
  }

  /**
   * Validate extracted entries and return error or null
   *
   * Unlike validateOrThrow, this returns the error instead of throwing,
   * allowing the retry loop to handle it.
   *
   * @returns TocValidationError if validation fails, null if valid
   */
  private tryValidateEntries(
    entries: TocEntry[],
    overrides?: Partial<TocValidationOptions>,
  ): TocValidationError | null {
    if (entries.length === 0) {
      return null;
    }

    const options = { ...this.validationOptions, ...overrides };
    const validator = new TocValidator(options);
    const result = validator.validate(entries);

    if (!result.valid) {
      const details = result.issues
        .map(
          (issue) =>
            `  [${issue.code}] ${issue.message} (path: ${issue.path}, entry: "${issue.entry.title}" page ${issue.entry.pageNo})`,
        )
        .join('\n');
      return new TocValidationError(
        `TOC validation failed with ${result.errorCount} error(s):\n${details}`,
        result,
      );
    }

    return null;
  }

  /**
   * Build correction prompt with validation error feedback
   *
   * Includes the original markdown, previous extraction result,
   * validation errors, and guidance for fixing common mistakes.
   */
  protected buildCorrectionPrompt(
    markdown: string,
    previousEntries: TocEntry[],
    issues: TocValidationIssue[],
  ): string {
    const errorLines = issues.map((issue) => {
      const desc =
        VALIDATION_CODE_DESCRIPTIONS[issue.code] ?? 'Unknown validation error.';
      return `- [${issue.code}] ${issue.message}\n  Path: ${issue.path}\n  Entry: "${issue.entry.title}" (page ${issue.entry.pageNo})\n  Rule: ${desc}`;
    });

    return `Your previous TOC extraction had validation errors. Please fix them and re-extract.

## Validation Errors

${errorLines.join('\n\n')}

## Common Mistakes to Avoid

1. **Hierarchy confusion**: Entries with the same numbering prefix (e.g., "4)") can belong to different hierarchy levels depending on context. Use indentation and surrounding entries to determine the correct parent-child relationship.
2. **Page number misread**: Carefully distinguish Roman numerals (VI=6) from Arabic numerals. "VI. 고찰" at page 277 is NOT "V. 고찰" at page 27.
3. **Page order**: Within the same parent, sibling entries must have non-decreasing page numbers. If a page number decreases, the entry likely belongs to a different hierarchy level.

## Original Markdown

${markdown}

## Your Previous Extraction (with errors)

${JSON.stringify(previousEntries, null, 2)}

## Instructions

Re-extract the TOC structure from the original markdown above. Fix all validation errors listed above. Return the corrected entries.`;
  }

  /**
   * Build system prompt for TOC extraction
   */
  protected buildSystemPrompt(): string {
    return `You are a document structure extraction assistant. Your task is to parse a table of contents (TOC) from markdown format and extract structured entries.

## Instructions

1. **Title**: Extract the exact chapter/section title from each line. Remove page number indicators like "..... 10" or "... 5" at the end.

2. **Level**: Determine the hierarchy depth:
   - Level 1: Top-level chapters (e.g., "제1장", "Chapter 1", "I.", "Part 1")
   - Level 2: Main sections within chapters (e.g., "1.", "1.1", "A.")
   - Level 3: Subsections (e.g., "1.1.1", "a.", "(1)")
   - Use indentation and numbering patterns to infer level

3. **Page Number**: Extract the page number from each entry. Use only Arabic numerals for page numbers.

4. **Children**: Nest child entries under parent entries based on their hierarchy level.

5. **IMPORTANT - Extract Main TOC Only**: Only extract the main document table of contents. EXCLUDE the following:
   - **Front matter with Roman numeral pages**: Entries whose page numbers are Roman numerals (i, ii, xxi, etc.) such as 일러두기, 발간사, 서문, 범례, Preface, Foreword, Editorial Notes. These use a separate page numbering system and are not part of the main content.
   - Photo/image indices (사진 목차, 사진목차, 화보 목차, 寫眞 目次, 寫眞目次, Photo Index, List of Photos, List of Figures)
   - Drawing/diagram indices (도면 목차, 도면목차, 삽도 목차, 圖面 目次, 圖面目次, Drawing Index, List of Drawings)
   - Table indices (표 목차, 표목차, 表 目次, 表目次, Table Index, List of Tables)
   - Appendix indices (부록 목차, Appendix Index)
   - Any other supplementary material indices

## Output Format

Return a flat array of top-level entries. Each entry at level 1 should contain its children (level 2+) nested properly.

## Example

Input:
- 제1장 서론 ..... 1
  - 1. 연구 배경 ..... 3
  - 2. 연구 목적 ..... 5
- 제2장 방법론 ..... 10

Output:
{
  "entries": [
    {
      "title": "제1장 서론",
      "level": 1,
      "pageNo": 1,
      "children": [
        { "title": "1. 연구 배경", "level": 2, "pageNo": 3, "children": [] },
        { "title": "2. 연구 목적", "level": 2, "pageNo": 5, "children": [] }
      ]
    },
    { "title": "제2장 방법론", "level": 1, "pageNo": 10, "children": [] }
  ]
}`;
  }

  /**
   * Build user prompt with Markdown content
   */
  protected buildUserPrompt(markdown: string): string {
    return `Extract the table of contents structure from the following markdown:

${markdown}`;
  }

  /**
   * Normalize and validate extracted entries
   */
  private normalizeEntries(entries: TocEntry[]): TocEntry[] {
    if (entries.length === 0) {
      return [];
    }

    // Normalize level consistency starting from level 1
    return this.normalizeLevel(entries, 1);
  }

  /**
   * Recursively ensure level consistency
   *
   * Children must have level = parent.level + 1
   */
  private normalizeLevel(
    entries: TocEntry[],
    expectedLevel: number,
  ): TocEntry[] {
    return entries.map((entry) => {
      const normalizedEntry: TocEntry = {
        title: entry.title.trim(),
        level: expectedLevel,
        pageNo: entry.pageNo,
      };

      if (entry.children && entry.children.length > 0) {
        normalizedEntry.children = this.normalizeLevel(
          entry.children,
          expectedLevel + 1,
        );
      }

      return normalizedEntry;
    });
  }
}
