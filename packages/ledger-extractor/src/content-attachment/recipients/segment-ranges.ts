import type { ContentAttachmentWordEvidenceSnapshot } from './word-evidence';

import { resolveContentAttachmentWordRange } from './word-evidence';

/** Validate model-selected boundaries without interpreting action meanings or inventing recipients. */
export function resolveContentAttachmentSegmentRanges(
  snapshot: ContentAttachmentWordEvidenceSnapshot,
  excerptRef: string,
  segments: Array<{ wordRanges: string[] }>,
) {
  const source = snapshot.sources.find((s) => s.ref === excerptRef)!;
  const covered = new Set<number>();
  const seen = new Set<string>();
  const resolved = segments.map((segment) => {
    const ranges = segment.wordRanges.map((range) => {
      const evidence = resolveContentAttachmentWordRange(
        snapshot,
        range,
        excerptRef,
      );
      if (evidence.basis !== 'direct')
        throw new Error('Segment uses another source');
      for (const word of source.words)
        if (
          word.charStart >= evidence.charStart &&
          word.charEnd <= evidence.charEnd
        )
          covered.add(word.charStart);
      return evidence;
    });
    const key = [...segment.wordRanges].sort().join('|');
    if (
      new Set(segment.wordRanges).size !== segment.wordRanges.length ||
      seen.has(key)
    )
      throw new Error('Repeated segment or range');
    seen.add(key);
    return ranges;
  });
  if (covered.size !== source.words.length)
    throw new Error('Uncovered source words');
  return resolved;
}
