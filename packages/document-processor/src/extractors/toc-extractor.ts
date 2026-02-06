import type { LoggerMethods } from '@heripo/logger';
import type { ExtendedTokenUsage } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { TocEntry } from '../types';
import type { TocValidationOptions } from './toc-validator';

import { z } from 'zod';

import {
  type BaseLLMComponentOptions,
  TextLLMComponent,
} from '../core/text-llm-component';
import { TocParseError, TocValidationError } from './toc-extract-error';
import { TocValidator } from './toc-validator';

/**
 * Zod schema for recursive TocEntry structure
 */
export const TocEntrySchema: z.ZodType<TocEntry> = z.lazy(() =>
  z.object({
    title: z.string().describe('Chapter or section title'),
    level: z.number().int().min(1).describe('Hierarchy depth (1 = top level)'),
    pageNo: z.number().int().min(1).describe('Starting page number'),
    children: z.array(TocEntrySchema).optional().describe('Child sections'),
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
   * @param markdown - Markdown representation of TOC area
   * @returns Object with entries array and token usage information
   * @throws {TocParseError} When LLM fails to parse structure
   * @throws {TocValidationError} When validation fails
   */
  async extract(
    markdown: string,
  ): Promise<{ entries: TocEntry[]; usage: ExtendedTokenUsage }> {
    this.log('info', `Starting TOC extraction (${markdown.length} chars)`);

    if (!markdown.trim()) {
      this.log('error', 'Cannot extract TOC from empty markdown content');
      throw new TocParseError(
        'TOC extraction failed: provided markdown content is empty',
      );
    }

    try {
      const result = await this.callTextLLM(
        TocResponseSchema,
        this.buildSystemPrompt(),
        this.buildUserPrompt(markdown),
        'extraction',
      );

      const entries = this.normalizeEntries(result.output.entries);

      // Validate entries
      if (!this.skipValidation) {
        this.validateEntries(entries);
      }

      this.log(
        'info',
        `Extraction completed: ${entries.length} top-level entries`,
      );

      return { entries, usage: result.usage };
    } catch (error) {
      // Re-throw TocValidationError as-is
      if (error instanceof TocValidationError) {
        this.log('error', `Validation failed: ${error.message}`);
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
   * Validate extracted entries
   *
   * @throws {TocValidationError} When validation fails
   */
  private validateEntries(entries: TocEntry[]): void {
    if (entries.length === 0) {
      return;
    }

    const validator = new TocValidator(this.validationOptions);
    validator.validateOrThrow(entries);
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

3. **Page Number**: Extract the page number from each entry. Convert Roman numerals to Arabic numerals if present (e.g., "iv" → 4).

4. **Children**: Nest child entries under parent entries based on their hierarchy level.

5. **IMPORTANT - Extract Main TOC Only**: Only extract the main document table of contents. EXCLUDE the following supplementary indices:
   - Photo/image indices (사진 목차, 사진목차, 화보 목차, Photo Index, List of Photos, List of Figures)
   - Drawing/diagram indices (도면 목차, 도면목차, 삽도 목차, Drawing Index, List of Drawings)
   - Table indices (표 목차, 표목차, Table Index, List of Tables)
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
        { "title": "1. 연구 배경", "level": 2, "pageNo": 3 },
        { "title": "2. 연구 목적", "level": 2, "pageNo": 5 }
      ]
    },
    { "title": "제2장 방법론", "level": 1, "pageNo": 10 }
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
