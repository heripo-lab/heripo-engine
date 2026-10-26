import type { CaptionReferences } from '../media/caption-references';
import type { MediaCaptionIndex } from '../media/media-captions';
import type { MediaReferences } from '../media/media-references';
import type { MediaSamePageGroup } from '../media/same-page-candidates';
import type {
  ArchaeologyLedgerResult,
  LedgerExtractionIssue,
  LedgerMediaReference,
  LedgerReviewItem,
} from './archaeology-ledger';

/**
 * Put figure and photo links into an assembled ledger (M4), deterministically and without model calls.
 * Text references come first, then caption names and series; a record–image pair is kept once with the
 * evidence of every source that linked it. The caption text and its label words are kept as written.
 *
 * Review items (`kind: 'media'`) are added for a label the record's own text cites that several images share
 * (`media_ambiguous`, which also flags the record), a caption naming several records (`media_caption_several`)
 * and uncaptioned images on a page where records are described (`media_same_page`); the last two do not flag
 * records, since they are questions about images. Cited labels no image has, unresolved caption series and
 * caption artifact numbers that do not list a text-linked artifact go to `issues`. `media_references` leaves
 * `pending`.
 */
export function applyLedgerMedia(
  result: ArchaeologyLedgerResult,
  media: {
    captions: MediaCaptionIndex;
    text: MediaReferences;
    caption?: CaptionReferences;
    samePage?: MediaSamePageGroup[];
  },
): ArchaeologyLedgerResult {
  const entryOf = new Map(media.captions.entries.map((e) => [e.imageId, e]));
  const references: LedgerMediaReference[] = [];
  const byPair = new Map<string, LedgerMediaReference>();
  const ordinals = new Map<string, number>();
  const link = (
    recordId: string,
    imageId: string,
    basis: LedgerMediaReference['basis'],
    evidence: LedgerMediaReference['evidence'][number],
  ) => {
    const existing = byPair.get(`${recordId}|${imageId}`);
    if (existing) {
      existing.evidence.push(evidence);
      return;
    }
    const entry = entryOf.get(imageId)!;
    const ordinal = ordinals.get(recordId) ?? 0;
    ordinals.set(recordId, ordinal + 1);
    const reference: LedgerMediaReference = {
      id: `media-${references.length + 1}`,
      ledgerId: result.ledger.id,
      recordId,
      imageId,
      ordinal,
      referenceLabel: entry.label,
      captionText: entry.captionText,
      captionProperties: { mediaType: entry.type, sequenceNo: entry.number },
      basis,
      evidence: [evidence],
      needsReview: false,
    };
    byPair.set(`${recordId}|${imageId}`, reference);
    references.push(reference);
  };
  for (const r of media.text.references)
    link(r.recordId, r.imageId, r.basis, {
      kind: 'excerpt',
      text: r.written,
      sourceId: r.sourceId,
      locator: r.locator,
    });
  for (const r of media.caption?.references ?? [])
    link(r.recordId, r.imageId, r.basis, {
      kind: 'caption',
      text: entryOf.get(r.imageId)!.captionText,
    });

  const added: Array<Omit<LedgerReviewItem, 'id'>> = [
    ...media.text.ambiguous.map((p) => ({
      kind: 'media' as const,
      recordIds: [p.recordId],
      confirmedRecordIds: [],
      reasons: ['media_ambiguous'],
      imageIds: p.imageIds,
      text: p.written,
      locator: p.locator,
      detail: p.label,
    })),
    ...(media.caption?.severalNamed ?? []).map((p) => ({
      kind: 'media' as const,
      recordIds: p.recordIds,
      confirmedRecordIds: [],
      reasons: ['media_caption_several'],
      imageIds: [p.imageId],
      text: entryOf.get(p.imageId)!.captionText,
    })),
    ...(media.samePage ?? []).map((g) => ({
      kind: 'media' as const,
      recordIds: g.recordIds,
      confirmedRecordIds: [],
      reasons: ['media_same_page'],
      imageIds: g.imageIds,
      pdfPageNo: g.pdfPageNo,
    })),
  ];
  const ambiguous = new Set(media.text.ambiguous.map((p) => p.recordId));
  const nameOf = new Map(
    result.records.map((r) => [
      r.id,
      r.sourceIdentifier && !r.sourceName.includes(r.sourceIdentifier)
        ? `${r.sourceIdentifier} ${r.sourceName}`
        : r.sourceName,
    ]),
  );
  const issues: LedgerExtractionIssue[] = [
    ...media.text.missing.map((p): LedgerExtractionIssue => ({
      code: 'REFERENCE_LABEL_MISMATCH',
      severity: 'warning',
      stage: 'media',
      recordId: p.recordId,
      message: `${nameOf.get(p.recordId)} cites ${p.label}, which no captioned image has`,
      locator: p.locator,
    })),
    ...(media.caption?.unresolvedRangeNumbers ?? []).map(
      (u): LedgerExtractionIssue => ({
        code: 'MEDIA_MATCH_AMBIGUOUS',
        severity: 'warning',
        stage: 'media',
        imageId: u.imageId,
        message: `${entryOf.get(u.imageId)!.label} names ${u.name}, which matches no single record`,
      }),
    ),
    ...(media.caption?.artifactNumberChecks ?? []).flatMap((c) =>
      c.disagreeing.map((id): LedgerExtractionIssue => ({
        code: 'REFERENCE_LABEL_MISMATCH',
        severity: 'warning',
        stage: 'media',
        recordId: id,
        imageId: c.imageId,
        message: `${c.label} lists ${c.captionNumbers.join(',')} but not ${nameOf.get(id)}`,
      })),
    ),
  ];
  return {
    ...result,
    records: result.records.map((r) =>
      ambiguous.has(r.id) ? { ...r, needsReview: true } : r,
    ),
    mediaReferences: [...result.mediaReferences, ...references],
    pending: result.pending.filter((p) => p !== 'media_references'),
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
