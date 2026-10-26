import type { ProcessedDocument } from '@heripo/model';

import type { ArchaeologyLedgerResult } from './archaeology-ledger';

import { buildDocumentResourceIndex } from '../resources/document-resource-index';

const compare = (a: string | number, b: string | number) =>
  a < b ? -1 : a > b ? 1 : 0;
/** Compare tuples element by element; the first difference decides. */
const byKeys =
  <T>(key: (x: T) => Array<string | number>) =>
  (a: T, b: T) => {
    const y = key(b);
    return key(a).reduce<number>((c, x, i) => c || compare(x, y[i]), 0);
  };

/**
 * Order every list of an assembled ledger deterministically (implementation spec §23), without changing any
 * ID, value or evidence:
 *
 * - records by parent depth, parent ID, ordinal, ID; `ordinal` keeps the reading order for display;
 * - each record's excerpts by the document order of their first source, its character offset, ID;
 * - attributes by record order, the document position of their cell or source, key, ID;
 * - sources by record order, PDF page (unknown last), locator, ID;
 * - media references by record order, ordinal, image ID;
 * - links by the order of their from and to records, label, ID.
 *
 * Document order is the storage traversal order of the processed document's resources. Review items and
 * issues keep the order the steps produced.
 */
export function sortArchaeologyLedger(
  result: ArchaeologyLedgerResult,
  document: ProcessedDocument,
): ArchaeologyLedgerResult {
  const position = new Map(
    buildDocumentResourceIndex(document).resources.map((r, i) => [r.key, i]),
  );
  const at = (locator: string | undefined) => {
    const [key, span = ''] = (locator ?? '').split('#');
    return [
      position.get(key) ?? Number.MAX_SAFE_INTEGER,
      Number(span.split('-')[0]) || 0,
    ];
  };
  const parentOf = new Map(result.records.map((r) => [r.id, r.parentRecordId]));
  const depth = (id: string) => {
    const seen = new Set([id]);
    let n = 0;
    for (let p = parentOf.get(id); p && !seen.has(p); p = parentOf.get(p)) {
      seen.add(p);
      n++;
    }
    return n;
  };
  const sources = new Map(result.sources.map((s) => [s.id, s]));
  const records = [...result.records]
    .sort(byKeys((r) => [depth(r.id), r.parentRecordId ?? '', r.ordinal, r.id]))
    .map((r) => ({
      ...r,
      content: [...r.content].sort(
        byKeys((c) => [...at(sources.get(c.sourceIds[0])?.locator), c.id]),
      ),
    }));
  const order = new Map(records.map((r, i) => [r.id, i]));
  const rank = (id: string) => order.get(id) ?? Number.MAX_SAFE_INTEGER;
  return {
    ...result,
    records,
    sources: [...result.sources].sort(
      byKeys((s) => [
        rank(s.recordId),
        s.pdfPageNo ?? Number.MAX_SAFE_INTEGER,
        s.locator,
        s.id,
      ]),
    ),
    attributes: [...result.attributes].sort(
      byKeys((a) => [
        rank(a.recordId),
        ...at(a.metadata.cellKey ?? sources.get(a.metadata.sourceId!)?.locator),
        a.keyText,
        a.id,
      ]),
    ),
    mediaReferences: [...result.mediaReferences].sort(
      byKeys((m) => [rank(m.recordId), m.ordinal, m.imageId]),
    ),
    links: [...result.links].sort(
      byKeys((l) => [
        rank(l.fromRecordId),
        rank(l.toRecordId),
        l.relationLabel,
        l.id,
      ]),
    ),
  };
}
