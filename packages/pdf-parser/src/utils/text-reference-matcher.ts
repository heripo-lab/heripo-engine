import type { DoclingTextItem } from '@heripo/model';

/** Minimum character overlap ratio to accept a pdftotext block as reference */
export const REFERENCE_MATCH_THRESHOLD = 0.4;

/**
 * Match pdftotext paragraph blocks to OCR elements using character multiset overlap.
 * Returns a map from prompt index to the best-matching reference block.
 */
export function matchTextToReference(
  pageTexts: Array<{ index: number; item: DoclingTextItem }>,
  pageText: string,
): Map<number, string> {
  return matchTextToReferenceWithUnused(pageTexts, pageText).references;
}

/**
 * Match pdftotext paragraph blocks to OCR elements and also return unused blocks.
 * Unused blocks are those that were not consumed by any text element match.
 */
export function matchTextToReferenceWithUnused(
  pageTexts: Array<{ index: number; item: DoclingTextItem }>,
  pageText: string,
): { references: Map<number, string>; unusedBlocks: string[] } {
  const references = new Map<number, string>();

  const refBlocks = mergeIntoBlocks(pageText);

  if (refBlocks.length === 0) {
    return { references, unusedBlocks: [] };
  }

  const available = new Set(refBlocks.map((_, i) => i));

  for (let promptIndex = 0; promptIndex < pageTexts.length; promptIndex++) {
    const ocrText = pageTexts[promptIndex].item.text;

    let bestScore = 0;
    let bestBlockIndex = -1;

    for (const blockIndex of available) {
      const score = computeCharOverlap(ocrText, refBlocks[blockIndex]);
      if (score > bestScore) {
        bestScore = score;
        bestBlockIndex = blockIndex;
      }
    }

    if (bestBlockIndex >= 0 && bestScore >= REFERENCE_MATCH_THRESHOLD) {
      if (refBlocks[bestBlockIndex] !== ocrText) {
        references.set(promptIndex, refBlocks[bestBlockIndex]);
      }
      available.delete(bestBlockIndex);
    }
  }

  const unusedBlocks = [...available]
    .sort((a, b) => a - b)
    .map((i) => refBlocks[i]);

  return { references, unusedBlocks };
}

/**
 * Merge pdftotext output into paragraph blocks separated by blank lines.
 * Consecutive non-empty lines are joined with a space.
 */
export function mergeIntoBlocks(pageText: string): string[] {
  const blocks: string[] = [];
  let currentLines: string[] = [];

  for (const rawLine of pageText.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      if (currentLines.length > 0) {
        blocks.push(currentLines.join(' '));
        currentLines = [];
      }
    } else {
      currentLines.push(trimmed);
    }
  }
  if (currentLines.length > 0) {
    blocks.push(currentLines.join(' '));
  }

  return blocks;
}

/**
 * Compute character multiset overlap ratio between two strings.
 * Returns a value between 0.0 and 1.0.
 */
export function computeCharOverlap(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;

  const freqA = new Map<string, number>();
  for (const ch of a) {
    freqA.set(ch, (freqA.get(ch) ?? 0) + 1);
  }

  const freqB = new Map<string, number>();
  for (const ch of b) {
    freqB.set(ch, (freqB.get(ch) ?? 0) + 1);
  }

  let overlap = 0;
  for (const [ch, countA] of freqA) {
    const countB = freqB.get(ch) ?? 0;
    overlap += Math.min(countA, countB);
  }

  return overlap / Math.max(a.length, b.length);
}
