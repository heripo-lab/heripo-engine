import type { ProcessedDocument } from '@heripo/model';

import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { ArchaeologyLedgerResult } from './archaeology-ledger';

const norm = (text: string) => text.replace(/\s+/g, '');

/**
 * Where a record's name and identifier may be written, without spaces: its registration excerpts and name
 * anchors, the captions of its registration tables, its chapter titles and its candidate evidence quotes.
 */
export function createRecordEvidenceText(
  result: ArchaeologyLedgerResult,
  plan: ContentAttachmentPlan,
  document: ProcessedDocument,
) {
  const tables = new Map(document.tables.map((t) => [t.id, t]));
  const entryOf = new Map(plan.registry.map((e) => [`record-${e.groupId}`, e]));
  const sourcesOf = new Map<string, typeof result.sources>();
  for (const s of result.sources)
    if (s.basis === 'registration' || s.basis === 'name_anchor')
      sourcesOf.set(s.recordId, [...(sourcesOf.get(s.recordId) ?? []), s]);
  return (recordId: string) => {
    const sources = sourcesOf.get(recordId) ?? [];
    const entry = entryOf.get(recordId);
    return [
      ...sources.map((s) => s.excerpt),
      ...sources.map(
        (s) => (s.tableId && tables.get(s.tableId)?.caption?.fullText) || '',
      ),
      ...(entry?.mentions ?? []).flatMap((m) => [
        ...m.chapterPath.map((c) => c.originTitle),
        ...m.evidence.map((e) => e.quote),
      ]),
    ]
      .map(norm)
      .join('|');
  };
}
