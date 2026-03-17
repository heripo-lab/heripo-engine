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

  const initialAvailable = new Set(refBlocks.map((_, i) => i));

  const finalAvailable = pageTexts.reduce((available, entry, promptIndex) => {
    const ocrText = entry.item.text;

    const { bestScore, bestBlockIndex } = [...available].reduce(
      (best, blockIndex) => {
        const score = computeCharOverlap(ocrText, refBlocks[blockIndex]);
        return score > best.bestScore
          ? { bestScore: score, bestBlockIndex: blockIndex }
          : best;
      },
      { bestScore: 0, bestBlockIndex: -1 },
    );

    if (bestBlockIndex >= 0 && bestScore >= REFERENCE_MATCH_THRESHOLD) {
      if (refBlocks[bestBlockIndex] !== ocrText) {
        references.set(promptIndex, refBlocks[bestBlockIndex]);
      }
      const next = new Set(available);
      next.delete(bestBlockIndex);
      return next;
    }

    return available;
  }, initialAvailable);

  const unusedBlocks = [...finalAvailable]
    .sort((a, b) => a - b)
    .map((i) => refBlocks[i]);

  return { references, unusedBlocks };
}

/**
 * Merge pdftotext output into paragraph blocks separated by blank lines.
 * Consecutive non-empty lines are joined with a space.
 */
export function mergeIntoBlocks(pageText: string): string[] {
  const { blocks, currentLines } = pageText.split('\n').reduce(
    (acc, rawLine) => {
      const trimmed = rawLine.trim();
      if (trimmed.length === 0) {
        if (acc.currentLines.length > 0) {
          return {
            blocks: [...acc.blocks, acc.currentLines.join(' ')],
            currentLines: [],
          };
        }
        return acc;
      }
      return {
        blocks: acc.blocks,
        currentLines: [...acc.currentLines, trimmed],
      };
    },
    { blocks: [] as string[], currentLines: [] as string[] },
  );

  return currentLines.length > 0 ? [...blocks, currentLines.join(' ')] : blocks;
}

/**
 * Compute character multiset overlap ratio between two strings.
 * Returns a value between 0.0 and 1.0.
 */
export function computeCharOverlap(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;

  const freqA = [...a].reduce((freq, ch) => {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
    return freq;
  }, new Map<string, number>());

  const freqB = [...b].reduce((freq, ch) => {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
    return freq;
  }, new Map<string, number>());

  const overlap = [...freqA].reduce((sum, [ch, countA]) => {
    const countB = freqB.get(ch) ?? 0;
    return sum + Math.min(countA, countB);
  }, 0);

  return overlap / Math.max(a.length, b.length);
}
