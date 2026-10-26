import type { ArchaeologyLedgerResult } from '../ledger/archaeology-ledger';
import type { DocumentResourceIndex } from '../resources/document-resource-index';

/**
 * Uncaptioned images on a page where records are described (M3): candidates only. Without a caption or a
 * layout position, code cannot tell which image shows which record (a catalogue page with two artifacts and
 * six images), so the page becomes one review group.
 */
export interface MediaSamePageGroup {
  pdfPageNo: number;
  imageIds: string[];
  /** Records with an excerpt on the page, in ledger order. */
  recordIds: string[];
}

/**
 * Group uncaptioned images with the records whose excerpts are on the same PDF page, deterministically and
 * without model calls. Pages without such records are left out; nothing is linked.
 */
export function collectSamePageCandidates(
  index: DocumentResourceIndex,
  ledger: ArchaeologyLedgerResult,
): MediaSamePageGroup[] {
  const imagesByPage = new Map<number, string[]>();
  for (const r of index.resources)
    if (r.kind === 'image' && !r.data.caption && r.pdfPageNo !== null)
      imagesByPage.set(r.pdfPageNo, [
        ...(imagesByPage.get(r.pdfPageNo) ?? []),
        r.data.id,
      ]);
  const order = new Map(ledger.records.map((r) => [r.id, r.ordinal]));
  const recordsByPage = new Map<number, Set<string>>();
  for (const s of ledger.sources)
    if (s.pdfPageNo !== null && imagesByPage.has(s.pdfPageNo))
      recordsByPage.set(
        s.pdfPageNo,
        (recordsByPage.get(s.pdfPageNo) ?? new Set()).add(s.recordId),
      );
  return [...recordsByPage]
    .sort(([a], [b]) => a - b)
    .map(([pdfPageNo, records]) => ({
      pdfPageNo,
      imageIds: imagesByPage.get(pdfPageNo)!,
      recordIds: [...records].sort((a, b) => order.get(a)! - order.get(b)!),
    }));
}
