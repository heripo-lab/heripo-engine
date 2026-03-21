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

    const lines: string[] = refs
      .map((ref) => refResolver.resolve(ref))
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .map((item) => {
        // Check if it's a group item
        if ('name' in item && (item.name === 'list' || item.name === 'group')) {
          return MarkdownConverter.groupToMarkdown(
            item as DoclingGroupItem,
            refResolver,
            0,
          );
        }
        // Check if it's a table item
        if ('data' in item && 'grid' in (item as DoclingTableItem).data) {
          return MarkdownConverter.tableToMarkdown(item as DoclingTableItem);
        }
        // Check if it's a text item
        if ('text' in item && 'orig' in item) {
          return MarkdownConverter.textToMarkdown(item as DoclingTextItem, 0);
        }
        return '';
      })
      .filter((line) => line !== '');

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
    const lines: string[] = group.children
      .map((childRef) => refResolver.resolve(childRef.$ref))
      .filter((child): child is NonNullable<typeof child> => child !== null)
      .map((child) => {
        // Handle nested group
        if (
          'name' in child &&
          (child.name === 'list' || child.name === 'group')
        ) {
          return MarkdownConverter.groupToMarkdown(
            child as DoclingGroupItem,
            refResolver,
            indentLevel + 1,
          );
        }
        // Handle text item
        if ('text' in child && 'orig' in child) {
          return MarkdownConverter.textToMarkdown(
            child as DoclingTextItem,
            indentLevel,
          );
        }
        return '';
      })
      .filter((line) => line !== '');

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

    const lines: string[] = grid
      .filter((row) => row && row.length > 0)
      .flatMap((row, rowIdx) => {
        const cells = row.map((cell) =>
          MarkdownConverter.escapeTableCell(cell.text),
        );
        const rowLine = `| ${cells.join(' | ')} |`;

        // Add separator after header row (first row)
        if (rowIdx === 0) {
          const separator = row.map(() => '---').join(' | ');
          return [rowLine, `| ${separator} |`];
        }
        return [rowLine];
      });

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
