import type { LoggerMethods } from '@heripo/logger';
import type {
  DoclingDocument,
  DoclingGroupItem,
  DoclingTableItem,
  DoclingTextItem,
} from '@heripo/model';

import type { TocAreaResult } from '../types';
import type { RefResolver } from '../utils';

import { TocNotFoundError } from './toc-extract-error';

/**
 * TOC keyword patterns for different languages
 * Korean: 목차, 차례, 목 차
 * Chinese: 目录, 目 录, 内容, 內容
 * Japanese: 目次, 目 次
 * English: Contents, Table of Contents, etc.
 */
export const TOC_KEYWORDS = [
  '목차',
  '차례',
  '목 차',
  '目录',
  '目 录',
  '内容',
  '內容',
  '目次',
  '目 次',
  'Contents',
  'Table of Contents',
  'TABLE OF CONTENTS',
  'CONTENTS',
] as const;

/**
 * Continuation marker patterns for multi-page TOC
 * Korean: 목차(계속), 목차 (계속), (계속)
 * Chinese: 目录(续), 目录 (续), (续), 续表
 * Japanese: 目次(続), 目次 (続), (続)
 * English: (continued), (Continued), etc.
 */
export const CONTINUATION_MARKERS = [
  '목차(계속)',
  '목차 (계속)',
  '(계속)',
  '目录(续)',
  '目录 (续)',
  '(续)',
  '续表',
  '目次(続)',
  '目次 (続)',
  '(続)',
  '(continued)',
  '(Continued)',
  '(CONTINUED)',
  'continued',
] as const;

/**
 * Page number pattern regex for detecting TOC-like structures
 * Matches patterns like "... 123", ".... 45", ending with numbers
 */
export const PAGE_NUMBER_PATTERN = /\.{2,}\s*\d+\s*$|…+\s*\d+\s*$|\s+\d+\s*$/;

/**
 * TocFinder options
 */
export interface TocFinderOptions {
  /**
   * Maximum pages to search for TOC (default: 10)
   */
  maxSearchPages?: number;

  /**
   * Custom TOC keywords to add (optional)
   */
  additionalKeywords?: string[];
}

/**
 * TocFinder
 *
 * Finds TOC area in DoclingDocument using multi-stage search strategy:
 * 1. Keyword search in texts (section_header, list_item labels)
 * 2. Structure analysis for lists/tables with page number patterns
 * 3. Position heuristic (prioritize early pages)
 */
export class TocFinder {
  private readonly maxSearchPages: number;
  private readonly keywords: string[];

  constructor(
    private readonly logger: LoggerMethods,
    private readonly refResolver: RefResolver,
    options?: TocFinderOptions,
  ) {
    this.maxSearchPages = options?.maxSearchPages ?? 10;
    this.keywords = [...TOC_KEYWORDS, ...(options?.additionalKeywords ?? [])];
  }

  /**
   * Find TOC area in the document
   *
   * @throws {TocNotFoundError} When no TOC area is found
   */
  find(doc: DoclingDocument): TocAreaResult {
    this.logger.info('[TocFinder] Starting TOC search...');

    // Stage 1: Search by keywords
    const keywordResult = this.findByKeywords(doc);
    if (keywordResult) {
      this.logger.info(
        `[TocFinder] Found TOC by keyword search: pages ${keywordResult.startPage}-${keywordResult.endPage}`,
      );
      return keywordResult;
    }

    // Stage 2: Search by structure
    const structureResult = this.findByStructure(doc);
    if (structureResult) {
      this.logger.info(
        `[TocFinder] Found TOC by structure analysis: pages ${structureResult.startPage}-${structureResult.endPage}`,
      );
      return structureResult;
    }

    this.logger.warn('[TocFinder] No TOC found in document');
    throw new TocNotFoundError();
  }

  /**
   * Stage 1: Search by keywords in text items
   */
  private findByKeywords(doc: DoclingDocument): TocAreaResult | null {
    // Find text items containing TOC keywords
    for (const text of doc.texts) {
      if (!this.containsTocKeyword(text.text)) {
        continue;
      }

      const pageNo = text.prov[0]?.page_no;
      if (pageNo === undefined || pageNo > this.maxSearchPages) {
        continue;
      }

      this.logger.info(
        `[TocFinder] Found TOC keyword "${text.text}" on page ${pageNo}`,
      );

      // Find the parent group or table containing this text
      const parentRef = text.parent?.$ref;
      if (!parentRef) {
        // Single text item, return it directly
        return {
          itemRefs: [text.self_ref],
          startPage: pageNo,
          endPage: pageNo,
        };
      }

      // Try to find group containing TOC structure
      const result = this.findTocContainer(doc, parentRef, pageNo);
      if (result) {
        return this.expandToConsecutivePages(result, doc);
      }
    }

    return null;
  }

  /**
   * Stage 2: Search by structure (lists/tables with page numbers)
   */
  private findByStructure(doc: DoclingDocument): TocAreaResult | null {
    const candidates: Array<{
      result: TocAreaResult;
      score: number;
    }> = [];

    // Check groups for TOC-like structure
    for (const group of doc.groups) {
      const pageNo = this.getGroupFirstPage(group);
      if (pageNo === undefined || pageNo > this.maxSearchPages) {
        continue;
      }

      if (this.isGroupTocLike(group, doc)) {
        const score = this.calculateScore(group, pageNo);
        candidates.push({
          result: {
            itemRefs: [group.self_ref],
            startPage: pageNo,
            endPage: pageNo,
          },
          score,
        });
      }
    }

    // Check tables for TOC-like structure
    for (const table of doc.tables) {
      const pageNo = table.prov[0]?.page_no;
      if (pageNo === undefined || pageNo > this.maxSearchPages) {
        continue;
      }

      if (this.isTableTocLike(table)) {
        const score = this.calculateTableScore(table, pageNo);
        candidates.push({
          result: {
            itemRefs: [table.self_ref],
            startPage: pageNo,
            endPage: pageNo,
          },
          score,
        });
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Sort by score (higher is better) and return best match
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    return this.expandToConsecutivePages(best.result, doc);
  }

  /**
   * Find the TOC container (group or table) from a parent reference
   */
  private findTocContainer(
    doc: DoclingDocument,
    parentRef: string,
    pageNo: number,
  ): TocAreaResult | null {
    // Check if parent is a group
    const group = this.refResolver.resolveGroup(parentRef);
    if (group) {
      return {
        itemRefs: [group.self_ref],
        startPage: pageNo,
        endPage: pageNo,
      };
    }

    // Check if parent is a table
    const table = this.refResolver.resolveTable(parentRef);
    if (table) {
      return {
        itemRefs: [table.self_ref],
        startPage: pageNo,
        endPage: pageNo,
      };
    }

    // Try parent's parent (navigate up hierarchy)
    const item = this.refResolver.resolve(parentRef);
    if (item && item.parent?.$ref) {
      return this.findTocContainer(doc, item.parent.$ref, pageNo);
    }

    return null;
  }

  /**
   * Check if a group contains TOC-like structure
   */
  private isGroupTocLike(
    group: DoclingGroupItem,
    _doc: DoclingDocument,
  ): boolean {
    if (group.name !== 'list' && group.name !== 'group') {
      return false;
    }

    // Count children with page number patterns
    let pageNumberCount = 0;
    const children = this.refResolver.resolveMany(group.children);

    for (const child of children) {
      if (!child) continue;

      // Check if it's a text item with page number pattern
      if ('text' in child && 'orig' in child) {
        const textItem = child as DoclingTextItem;
        if (PAGE_NUMBER_PATTERN.test(textItem.text)) {
          pageNumberCount++;
        }
      }
    }

    // Consider TOC-like if at least 3 items have page numbers
    // or if more than 50% of items have page numbers
    const total = children.filter((c) => c !== null).length;
    return pageNumberCount >= 3 || (total > 0 && pageNumberCount / total > 0.5);
  }

  /**
   * Check if a table contains TOC-like structure
   */
  private isTableTocLike(table: DoclingTableItem): boolean {
    // Check for document_index label (Docling specific)
    if (table.label === 'document_index') {
      return true;
    }

    const { grid, num_rows, num_cols } = table.data;

    // Need at least 3 rows and 2 columns typically
    if (num_rows < 3 || num_cols < 2) {
      return false;
    }

    // Check if last column contains mostly numbers (page numbers)
    let numberCount = 0;
    for (let row = 1; row < grid.length; row++) {
      const lastCell = grid[row]?.[num_cols - 1];
      if (lastCell && /^\d+$/.test(lastCell.text.trim())) {
        numberCount++;
      }
    }

    // More than 50% of data rows have numeric last column
    return numberCount > 0 && numberCount / (num_rows - 1) > 0.5;
  }

  /**
   * Expand TOC area to consecutive pages (both backward and forward)
   */
  private expandToConsecutivePages(
    initial: TocAreaResult,
    doc: DoclingDocument,
  ): TocAreaResult {
    const itemRefs = [...initial.itemRefs];
    const seenRefs = new Set<string>(itemRefs);
    let startPage = initial.startPage;
    let endPage = initial.endPage;

    // Backward expansion (preceding pages)
    for (let pageNo = initial.startPage - 1; pageNo >= 1; pageNo--) {
      const continuationItems = this.findContinuationOnPage(doc, pageNo);
      if (continuationItems.length === 0) {
        break;
      }

      const newItems = continuationItems.filter((ref) => !seenRefs.has(ref));
      for (const ref of newItems) {
        seenRefs.add(ref);
      }
      itemRefs.unshift(...newItems);
      startPage = pageNo;
      this.logger.info(`[TocFinder] Expanded TOC backward to page ${pageNo}`);
    }

    // Forward expansion (subsequent pages)
    for (
      let pageNo = initial.endPage + 1;
      pageNo <= this.maxSearchPages;
      pageNo++
    ) {
      const continuationItems = this.findContinuationOnPage(doc, pageNo);
      if (continuationItems.length === 0) {
        break;
      }

      const newItems = continuationItems.filter((ref) => !seenRefs.has(ref));
      for (const ref of newItems) {
        seenRefs.add(ref);
      }
      itemRefs.push(...newItems);
      endPage = pageNo;
      this.logger.info(`[TocFinder] Expanded TOC forward to page ${pageNo}`);
    }

    return {
      itemRefs,
      startPage,
      endPage,
    };
  }

  /**
   * Find TOC continuation items on a specific page
   */
  private findContinuationOnPage(
    doc: DoclingDocument,
    pageNo: number,
  ): string[] {
    const refs: string[] = [];

    // Check for continuation markers in texts
    for (const text of doc.texts) {
      if (text.prov[0]?.page_no !== pageNo) {
        continue;
      }

      if (this.hasContinuationMarker(text.text)) {
        const parentRef = text.parent?.$ref;
        if (parentRef) {
          const group = this.refResolver.resolveGroup(parentRef);
          if (group) {
            refs.push(group.self_ref);
          }
        }
      }
    }

    // Check for TOC-like groups on this page
    for (const group of doc.groups) {
      const groupPage = this.getGroupFirstPage(group);
      if (groupPage !== pageNo) {
        continue;
      }

      if (this.isGroupTocLike(group, doc) && !refs.includes(group.self_ref)) {
        refs.push(group.self_ref);
      }
    }

    // Check for TOC-like tables on this page
    for (const table of doc.tables) {
      if (table.prov[0]?.page_no !== pageNo) {
        continue;
      }

      if (this.isTableTocLike(table) && !refs.includes(table.self_ref)) {
        refs.push(table.self_ref);
      }
    }

    return refs;
  }

  /**
   * Check if text contains TOC keyword
   */
  private containsTocKeyword(text: string): boolean {
    const normalizedText = text.trim().toLowerCase();
    return this.keywords.some((keyword) =>
      normalizedText.includes(keyword.toLowerCase()),
    );
  }

  /**
   * Check for continuation markers
   */
  private hasContinuationMarker(text: string): boolean {
    const normalizedText = text.trim().toLowerCase();
    return CONTINUATION_MARKERS.some((marker) =>
      normalizedText.includes(marker.toLowerCase()),
    );
  }

  /**
   * Get first page number of a group by checking its children
   */
  private getGroupFirstPage(group: DoclingGroupItem): number | undefined {
    for (const childRef of group.children) {
      const child = this.refResolver.resolve(childRef.$ref);
      if (child && 'prov' in child) {
        const prov = (child as DoclingTextItem).prov;
        if (prov && prov[0]?.page_no !== undefined) {
          return prov[0].page_no;
        }
      }
    }
    return undefined;
  }

  /**
   * Calculate score for a group candidate
   * Higher score = better match
   */
  private calculateScore(group: DoclingGroupItem, pageNo: number): number {
    let score = 0;

    // Earlier pages get higher score
    score += (this.maxSearchPages - pageNo + 1) * 10;

    // More children (TOC entries) = higher score
    score += group.children.length * 2;

    // Count items with page numbers
    const children = this.refResolver.resolveMany(group.children);
    for (const child of children) {
      if (child && 'text' in child) {
        const textItem = child as DoclingTextItem;
        if (PAGE_NUMBER_PATTERN.test(textItem.text)) {
          score += 5;
        }
      }
    }

    return score;
  }

  /**
   * Calculate score for a table candidate
   */
  private calculateTableScore(table: DoclingTableItem, pageNo: number): number {
    let score = 0;

    // Earlier pages get higher score
    score += (this.maxSearchPages - pageNo + 1) * 10;

    // More rows = higher score
    score += table.data.num_rows * 2;

    // document_index label is a strong indicator
    if (table.label === 'document_index') {
      score += 50;
    }

    return score;
  }
}
