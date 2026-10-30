import type { ProcessedDocument } from '@heripo/model';

import type { ContentAttachmentPlan } from '../content-attachment/types';
import type {
  ArchaeologyLedgerResult,
  LedgerRecordSource,
} from './archaeology-ledger';

import { buildDocumentResourceIndex } from '../resources/document-resource-index';
import { createRecordEvidenceText } from './record-evidence';

/** How many blocks before and after a registration block are searched. */
export const NAME_ANCHOR_DISTANCE = 3;
/** Blocks this short (without spaces) read as headings or catalog name lines and are preferred. */
const HEADING_MAX_CHARS = 40;
const TEXT_BLOCK = /^(.*\/textBlocks\/)(\d+)$/;
const norm = (text: string) => text.replace(/\s+/g, '');
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Add where a record's name is written when its evidence does not show it (D4), deterministically and without
 * model calls. Catalogs print `번호 / 이름(한자) / 영문명 / …` as separate blocks and headings print a scope's
 * name a block above its text, so registration evidence can miss the name line. For a record whose name is in
 * none of its registration excerpts, table captions, chapter titles or candidate evidence, the blocks within
 * `NAME_ANCHOR_DISTANCE` of a registration text block in the same chapter are searched for the name, spaces
 * ignored; a short heading-like block wins over a longer one, then the nearest, then the earlier. The name's
 * span is added as a `name_anchor` source with its exact original text. Names, excerpts and other sources are
 * not changed, and the anchor is not added to the record's `content`.
 */
export function applyLedgerNameAnchors(
  result: ArchaeologyLedgerResult,
  plan: ContentAttachmentPlan,
  document: ProcessedDocument,
): ArchaeologyLedgerResult {
  const evidenceText = createRecordEvidenceText(result, plan, document);
  const resources = new Map(
    buildDocumentResourceIndex(document)
      .resources.filter(
        (r): r is Extract<typeof r, { kind: 'text' }> => r.kind === 'text',
      )
      .map((r) => [r.key, r]),
  );
  const anchors: Array<Omit<LedgerRecordSource, 'id'>> = [];
  for (const record of result.records) {
    const name = norm(record.sourceName);
    if (evidenceText(record.id).includes(name)) continue;
    const pattern = new RegExp([...name].map(escape).join('\\s*'));
    const candidates = result.sources
      .filter((s) => s.recordId === record.id && s.basis === 'registration')
      .flatMap((s) => {
        const m = s.locator.split('#')[0].match(TEXT_BLOCK);
        if (!m) return [];
        const at = Number(m[2]);
        return Array.from({ length: NAME_ANCHOR_DISTANCE * 2 + 1 }, (_, i) => {
          const index = at - NAME_ANCHOR_DISTANCE + i;
          const resource = resources.get(`${m[1]}${index}`);
          const found = resource && resource.data.text.match(pattern);
          return found
            ? [
                {
                  resource,
                  found,
                  short: norm(resource.data.text).length <= HEADING_MAX_CHARS,
                  distance: Math.abs(index - at),
                  index,
                },
              ]
            : [];
        }).flat();
      })
      .sort(
        (a, b) =>
          Number(b.short) - Number(a.short) ||
          a.distance - b.distance ||
          a.index - b.index,
      );
    if (!candidates.length) continue;
    const { resource, found } = candidates[0];
    const charStart = found.index!;
    const charEnd = charStart + found[0].length;
    anchors.push({
      recordId: record.id,
      // a text block always belongs to its chapter
      chapterId: resource.chapterIds.at(-1)!,
      ...(resource.resourceId ? { textBlockId: resource.resourceId } : {}),
      ...(resource.sourceRefs[0] ? { sourceRef: resource.sourceRefs[0] } : {}),
      pdfPageNo: resource.pdfPageNo,
      locator: `${resource.key}#${charStart}-${charEnd}`,
      excerpt: found[0],
      charStart,
      charEnd,
      basis: 'name_anchor',
    });
  }
  return {
    ...result,
    sources: [
      ...result.sources,
      ...anchors.map((a, i) => ({
        id: `source-${result.sources.length + i + 1}`,
        ...a,
      })),
    ],
  };
}
