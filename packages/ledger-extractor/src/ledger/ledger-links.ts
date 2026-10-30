import type { RecordLinkEvidence, RecordLinks } from '../links/record-links';
import type {
  ArchaeologyLedgerResult,
  LedgerExtractionIssue,
  LedgerParentEvidence,
  LedgerRecordLink,
  LedgerReviewItem,
} from './archaeology-ledger';

const evidenceOf = (e: RecordLinkEvidence): LedgerParentEvidence =>
  e.cellKey
    ? {
        kind: 'table_cell',
        text: e.quote,
        quote: e.quote,
        locator: e.cellKey,
        pdfPageNo: e.pdfPageNo,
      }
    : {
        kind: 'excerpt',
        text: e.quote,
        quote: e.quote,
        locator: e.locator,
        pdfPageNo: e.pdfPageNo,
      };

/**
 * Put code-decided record links into an assembled ledger (L3), deterministically and without model calls.
 * Each decided link is kept with its label, direction (or symmetry), basis and every source sentence or cell
 * that states it; a link equal to one kept beside a parent (same label and pair) adds its evidence there.
 * Questions become `link` review items (`link_enclosure`, `link_several_targets`, `link_unclear`) with the
 * candidate records and the sentence, and flag the speaking record. A target that names several records or no
 * registered record makes no link and is reported in `issues` as `UNRESOLVED_LINK_TARGET`. `links` leaves
 * `pending`.
 */
export function applyLedgerLinks(
  result: ArchaeologyLedgerResult,
  links: RecordLinks,
): ArchaeologyLedgerResult {
  const merged: LedgerRecordLink[] = result.links.map((l) => ({
    ...l,
    evidence: [...l.evidence],
  }));
  for (const d of links.links) {
    const same = merged.find(
      (l) =>
        l.relationLabel === d.relationLabel &&
        ((l.fromRecordId === d.fromRecordId && l.toRecordId === d.toRecordId) ||
          (d.symmetric &&
            l.fromRecordId === d.toRecordId &&
            l.toRecordId === d.fromRecordId)),
    );
    const evidence = d.evidence.map(evidenceOf);
    if (same) same.evidence.push(...evidence);
    else
      merged.push({
        id: `link-${merged.length + 1}`,
        ledgerId: result.ledger.id,
        fromRecordId: d.fromRecordId,
        toRecordId: d.toRecordId,
        relationLabel: d.relationLabel,
        evidence,
        needsReview: false,
        basis: d.basis,
        symmetric: d.symmetric,
      });
  }

  const added: Array<Omit<LedgerReviewItem, 'id'>> = links.questions.map(
    (q) => ({
      kind: 'link',
      recordIds: [q.recordId],
      confirmedRecordIds: [],
      reasons: [q.reason],
      candidateRecordIds: q.candidateRecordIds,
      text: q.evidence.quote,
      locator: q.evidence.locator ?? q.evidence.cellKey,
      pdfPageNo: q.evidence.pdfPageNo,
    }),
  );
  const nameOf = new Map(
    result.records.map((r) => [
      r.id,
      r.sourceIdentifier && !r.sourceName.includes(r.sourceIdentifier)
        ? `${r.sourceIdentifier} ${r.sourceName}`
        : r.sourceName,
    ]),
  );
  const issues = links.unresolved.map((u): LedgerExtractionIssue => ({
    code: 'UNRESOLVED_LINK_TARGET',
    severity: 'warning',
    stage: 'links',
    recordId: u.recordId,
    message: `${nameOf.get(u.recordId)} names "${u.written}", ${
      u.candidateRecordIds.length
        ? `which ${u.candidateRecordIds.map((id) => nameOf.get(id)).join(', ')} share`
        : 'which no registered record has'
    }`,
    locator: u.evidence.locator ?? u.evidence.cellKey,
  }));
  const flagged = new Set(links.questions.map((q) => q.recordId));
  return {
    ...result,
    records: result.records.map((r) =>
      flagged.has(r.id) ? { ...r, needsReview: true } : r,
    ),
    links: merged,
    pending: result.pending.filter((p) => p !== 'links'),
    reviewItems: [
      ...result.reviewItems,
      ...added.map((item, i) => ({
        id: `review-${result.reviewItems.length + i + 1}`,
        ...item,
      })),
    ],
    issues: [...result.issues, ...issues],
  };
}
