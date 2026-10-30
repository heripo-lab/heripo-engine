import type { ArchaeologyLedgerResult } from '../ledger/archaeology-ledger';
import type { MediaCaptionIndex } from './media-captions';

import { MEDIA_LABEL_TYPES, mediaLabel } from './media-captions';

export const MEDIA_REFERENCES_VERSION = 'media-references.v1' as const;

/** Numbers a range may span; a wider span is read as its two written numbers only. */
const MAX_RANGE_SPAN = 60;
const TYPES = MEDIA_LABEL_TYPES.join('|');
const NUMBER = '\\d+(?:-\\d+)?';
/** `도면 34`, `사진 45~49`, `도판 10· 11`, `사진 45, 46`; never after a Hangul letter (`마도23-1`). */
const REFERENCE = new RegExp(
  `(?<![가-힣])(${TYPES})\\s*(${NUMBER}(?:\\s*[~∼·,、]\\s*${NUMBER})*)`,
  'g',
);

/** One label a record's own text refers to, resolved to exactly one captioned image. */
export interface MediaTextReference {
  recordId: string;
  imageId: string;
  /** The expanded label, such as `사진 47` from `사진 45~49`. */
  label: string;
  /** The reference as written in the excerpt. */
  written: string;
  /** The ledger source of the excerpt. */
  sourceId: string;
  locator: string;
  pdfPageNo: number | null;
  basis: 'text_reference';
}
/** A label a record refers to that no captioned image has, or that several images have. */
export interface MediaReferenceProblem {
  recordId: string;
  label: string;
  written: string;
  sourceId: string;
  locator: string;
  /** Empty when no image has the label. */
  imageIds: string[];
}
export interface MediaReferences {
  version: typeof MEDIA_REFERENCES_VERSION;
  references: MediaTextReference[];
  /** Labels no captioned image has: a figure the report cites but the document lacks or did not caption. */
  missing: MediaReferenceProblem[];
  /** Labels several images share; left for review. */
  ambiguous: MediaReferenceProblem[];
}

/** Expand a written number list: `45~49` to 45…49, `10· 11` and `45, 46` to each number. */
function expandNumbers(list: string): string[] {
  const tokens = list.split(/\s*([~∼·,、])\s*/);
  const numbers: string[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const current = tokens[i];
    const previous = numbers.at(-1);
    const isRange = tokens[i - 1] === '~' || tokens[i - 1] === '∼';
    if (
      isRange &&
      /^\d+$/.test(current) &&
      /^\d+$/.test(previous ?? '') &&
      Number(current) > Number(previous) &&
      Number(current) - Number(previous) <= MAX_RANGE_SPAN
    )
      for (let n = Number(previous) + 1; n < Number(current); n++)
        numbers.push(String(n));
    numbers.push(current);
  }
  return numbers;
}

/**
 * Find the figure and photo labels each record's own excerpts refer to (M1), deterministically and without
 * model calls: `(도면 31, 사진 143)` in an artifact heading, `(도면 39, 사진 57~59)` in a feature heading.
 * Ranges and lists are expanded. A label one captioned image has links the record to that image; a label no
 * image has is reported as missing, and a label several images share as ambiguous. Each record–image pair is
 * kept once, with the first excerpt that cites it.
 */
export function collectMediaReferences(
  captions: MediaCaptionIndex,
  ledger: ArchaeologyLedgerResult,
): MediaReferences {
  const references: MediaTextReference[] = [];
  const missing: MediaReferenceProblem[] = [];
  const ambiguous: MediaReferenceProblem[] = [];
  const seen = new Set<string>();
  for (const source of ledger.sources)
    for (const m of source.excerpt.matchAll(REFERENCE))
      for (const number of expandNumbers(m[2])) {
        const label = mediaLabel(m[1], number);
        const key = `${source.recordId}|${label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const imageIds = captions.byLabel[label] ?? [];
        const at = {
          recordId: source.recordId,
          label,
          written: m[0],
          sourceId: source.id,
          locator: source.locator,
        };
        if (imageIds.length === 1)
          references.push({
            ...at,
            imageId: imageIds[0],
            pdfPageNo: source.pdfPageNo,
            basis: 'text_reference',
          });
        else (imageIds.length ? ambiguous : missing).push({ ...at, imageIds });
      }
  return { version: MEDIA_REFERENCES_VERSION, references, missing, ambiguous };
}
