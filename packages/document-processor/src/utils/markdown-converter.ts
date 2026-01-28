import type {
  DoclingGroupItem,
  DoclingTableItem,
  DoclingTextItem,
} from '@heripo/model';

import type { RefResolver } from './ref-resolver';

/**
 * MarkdownConverter
 *
 * Converts TOC-related groups and tables to Markdown format for LLM processing.
 * Provides static utility methods for conversion.
 */
export class MarkdownConverter {
  /**
   * Convert TOC items (groups/tables) to Markdown string
   *
   * @param refs - Array of item references from TocAreaResult
   * @param refResolver - RefResolver for resolving references
   * @returns Markdown string representation of TOC
   */
  static convert(refs: string[], refResolver: RefResolver): string {
    if (refs.length === 0) {
      return '';
    }

    const lines: string[] = [];

    for (const ref of refs) {
      const item = refResolver.resolve(ref);
      if (!item) {
        continue;
      }

      // Check if it's a group item
      if ('name' in item && (item.name === 'list' || item.name === 'group')) {
        const groupMarkdown = MarkdownConverter.groupToMarkdown(
          item as DoclingGroupItem,
          refResolver,
          0,
        );
        if (groupMarkdown) {
          lines.push(groupMarkdown);
        }
      }
      // Check if it's a table item
      else if ('data' in item && 'grid' in (item as DoclingTableItem).data) {
        const tableMarkdown = MarkdownConverter.tableToMarkdown(
          item as DoclingTableItem,
        );
        if (tableMarkdown) {
          lines.push(tableMarkdown);
        }
      }
      // Check if it's a text item
      else if ('text' in item && 'orig' in item) {
        const textMarkdown = MarkdownConverter.textToMarkdown(
          item as DoclingTextItem,
          0,
        );
        if (textMarkdown) {
          lines.push(textMarkdown);
        }
      }
    }

    return lines.join('\n\n');
  }

  /**
   * Convert a group item to Markdown list format
   *
   * Handles nested lists and preserves hierarchy.
   *
   * @example
   * Output:
   * - Chapter 1 Introduction ..... 1
   *   - 1.1 Background ..... 3
   *   - 1.2 Objectives ..... 5
   * - Chapter 2 Methodology ..... 10
   */
  static groupToMarkdown(
    group: DoclingGroupItem,
    refResolver: RefResolver,
    indentLevel = 0,
  ): string {
    const lines: string[] = [];

    for (const childRef of group.children) {
      const child = refResolver.resolve(childRef.$ref);
      if (!child) {
        continue;
      }

      // Handle nested group
      if (
        'name' in child &&
        (child.name === 'list' || child.name === 'group')
      ) {
        const nestedMarkdown = MarkdownConverter.groupToMarkdown(
          child as DoclingGroupItem,
          refResolver,
          indentLevel + 1,
        );
        if (nestedMarkdown) {
          lines.push(nestedMarkdown);
        }
      }
      // Handle text item
      else if ('text' in child && 'orig' in child) {
        const textMarkdown = MarkdownConverter.textToMarkdown(
          child as DoclingTextItem,
          indentLevel,
        );
        if (textMarkdown) {
          lines.push(textMarkdown);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Convert a table item to Markdown table format
   *
   * @example
   * Output:
   * | Chapter | Page |
   * |---------|------|
   * | Chapter 1 Introduction | 1 |
   * | Chapter 2 Methodology | 10 |
   */
  static tableToMarkdown(table: DoclingTableItem): string {
    const { grid } = table.data;
    if (!grid || grid.length === 0) {
      return '';
    }

    const lines: string[] = [];

    // Build rows from grid
    for (let rowIdx = 0; rowIdx < grid.length; rowIdx++) {
      const row = grid[rowIdx];
      if (!row || row.length === 0) {
        continue;
      }

      const cells = row.map((cell) =>
        MarkdownConverter.escapeTableCell(cell.text),
      );
      lines.push(`| ${cells.join(' | ')} |`);

      // Add separator after header row (first row)
      if (rowIdx === 0) {
        const separator = row.map(() => '---').join(' | ');
        lines.push(`| ${separator} |`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Convert a text item to Markdown line
   */
  static textToMarkdown(text: DoclingTextItem, indentLevel = 0): string {
    const content = text.text.trim();
    if (!content) {
      return '';
    }

    const indent = MarkdownConverter.getIndent(indentLevel);
    const marker = MarkdownConverter.getListMarker(
      text.enumerated,
      text.marker,
    );

    return `${indent}${marker}${content}`;
  }

  /**
   * Generate list marker based on enumeration and marker
   */
  private static getListMarker(enumerated?: boolean, marker?: string): string {
    if (marker) {
      return `${marker} `;
    }
    if (enumerated === true) {
      return '1. ';
    }
    if (enumerated === false) {
      return '- ';
    }
    return '- ';
  }

  /**
   * Generate indent string (2 spaces per level)
   */
  private static getIndent(level: number): string {
    return '  '.repeat(level);
  }

  /**
   * Escape special characters in table cell content
   */
  private static escapeTableCell(text: string): string {
    return text.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
  }
}
