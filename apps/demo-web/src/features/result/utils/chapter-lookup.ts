import type {
  Chapter,
  ProcessedFootnote,
  ProcessedImage,
  ProcessedTable,
} from '@heripo/model';

/**
 * Recursively finds a chapter by ID in a hierarchical chapter tree.
 * Returns null if not found.
 */
export function findChapterById(
  chapters: Chapter[],
  id: string | null,
): Chapter | null {
  if (!id) return null;

  for (const chapter of chapters) {
    if (chapter.id === id) return chapter;

    if (chapter.children?.length) {
      const found = findChapterById(chapter.children, id);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Creates a lookup map from an array of items with ID property.
 * Provides O(1) lookup by ID.
 */
export function createImageLookupMap(
  items: ProcessedImage[],
): Map<string, ProcessedImage> {
  return new Map(items.map((item) => [item.id, item]));
}

/**
 * Creates a lookup map from an array of tables with ID property.
 */
export function createTableLookupMap(
  items: ProcessedTable[],
): Map<string, ProcessedTable> {
  return new Map(items.map((item) => [item.id, item]));
}

/**
 * Creates a lookup map from an array of footnotes with ID property.
 */
export function createFootnoteLookupMap(
  items: ProcessedFootnote[],
): Map<string, ProcessedFootnote> {
  return new Map(items.map((item) => [item.id, item]));
}

/**
 * Checks if a chapter has any content (text blocks, images, tables, or footnotes).
 */
export function isChapterEmpty(chapter: Chapter): boolean {
  return (
    chapter.textBlocks.length === 0 &&
    chapter.imageIds.length === 0 &&
    chapter.tableIds.length === 0 &&
    chapter.footnoteIds.length === 0
  );
}

/**
 * Finds a chapter by ID and returns it along with its sibling list.
 */
function findChapterWithSiblings(
  chapters: Chapter[],
  id: string,
): { chapter: Chapter; siblings: Chapter[] } | null {
  for (const chapter of chapters) {
    if (chapter.id === id) return { chapter, siblings: chapters };

    if (chapter.children?.length) {
      const found = findChapterWithSiblings(chapter.children, id);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Depth-first search for the first chapter with content on the target page.
 */
function findContentOnSamePage(
  chapters: Chapter[],
  targetPage: number,
): Chapter | null {
  for (const chapter of chapters) {
    if (chapter.pageNo !== targetPage) continue;

    if (!isChapterEmpty(chapter)) return chapter;

    if (chapter.children?.length) {
      const found = findContentOnSamePage(chapter.children, targetPage);
      if (found) return found;
    }
  }

  return null;
}

/**
 * For an empty chapter, finds the first chapter with content on the same page.
 * Searches descendants first, then next siblings (and their descendants).
 * Returns null if the chapter has content or no redirect target is found.
 */
export function findContentRedirectTarget(
  chapters: Chapter[],
  chapterId: string,
): Chapter | null {
  const context = findChapterWithSiblings(chapters, chapterId);
  if (!context) return null;

  const { chapter, siblings } = context;

  if (!isChapterEmpty(chapter)) return null;

  const targetPage = chapter.pageNo;

  // Search descendants
  if (chapter.children?.length) {
    const descendant = findContentOnSamePage(chapter.children, targetPage);
    if (descendant) return descendant;
  }

  // Search next siblings and their descendants
  const index = siblings.indexOf(chapter);
  for (let i = index + 1; i < siblings.length; i++) {
    const sibling = siblings[i]!;
    if (sibling.pageNo !== targetPage) continue;

    if (!isChapterEmpty(sibling)) return sibling;

    if (sibling.children?.length) {
      const descendant = findContentOnSamePage(sibling.children, targetPage);
      if (descendant) return descendant;
    }
  }

  return null;
}

/**
 * Resolves image IDs to actual items using a lookup map.
 * Filters out any IDs that don't exist in the map.
 */
export function resolveImageIds(
  ids: string[],
  lookupMap: Map<string, ProcessedImage>,
): ProcessedImage[] {
  return ids
    .map((id) => lookupMap.get(id))
    .filter((item): item is ProcessedImage => item !== undefined);
}

/**
 * Resolves table IDs to actual items using a lookup map.
 */
export function resolveTableIds(
  ids: string[],
  lookupMap: Map<string, ProcessedTable>,
): ProcessedTable[] {
  return ids
    .map((id) => lookupMap.get(id))
    .filter((item): item is ProcessedTable => item !== undefined);
}

/**
 * Resolves footnote IDs to actual items using a lookup map.
 */
export function resolveFootnoteIds(
  ids: string[],
  lookupMap: Map<string, ProcessedFootnote>,
): ProcessedFootnote[] {
  return ids
    .map((id) => lookupMap.get(id))
    .filter((item): item is ProcessedFootnote => item !== undefined);
}
