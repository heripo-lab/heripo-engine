import type { DocumentResourceIndex } from '../resources/document-resource-index';
import type { ReportSignals } from './report-signals';

export const REPORT_SCOPE_COMPLETION_VERSION =
  'report-scope-completion.v1' as const;

/** A discovery scope completed from a proposal and the code's investigation-chapter signals. */
export interface ReportScopeCompletion {
  version: typeof REPORT_SCOPE_COMPLETION_VERSION;
  /** The chapters to discover in: outermost only, in document order. */
  scopeChapterIds: string[];
  /** The chapters proposed (by the report router), as given. */
  proposedChapterIds: string[];
  /** Chapters of the scope that the proposal did not have: investigation chapters the code found by title. */
  addedChapterIds: string[];
  /** Proposed chapters now inside a wider chapter of the scope. */
  absorbedChapterIds: string[];
}

/**
 * Complete a proposed discovery scope with every chapter the code's signals mark as investigation-like
 * (survey scope, method, contents, trial or excavation titles), keeping only the outermost chapters in document
 * order. A router can leave out a chapter that defines this investigation's areas because its parent title
 * also names equipment; the signals put it back. Nothing the proposal had is dropped except into a wider
 * chapter, background or discussion chapters are not added, and unknown chapter IDs are ignored. Which
 * chapters were added is kept so the ledger can show it. Deterministic and without model calls.
 */
export function completeReportScope(
  index: DocumentResourceIndex,
  signals: ReportSignals,
  proposedChapterIds: string[],
): ReportScopeCompletion {
  const chapters = index.resources.filter((r) => r.kind === 'chapter');
  const order = new Map(chapters.map((c, i) => [c.resourceId!, i]));
  const keyOf = new Map(chapters.map((c) => [c.resourceId!, c.key]));
  const candidates = [
    ...new Set([
      ...proposedChapterIds,
      ...signals.signals.investigationLikeChapters.map((c) => c.chapterId),
    ]),
  ].filter((id) => keyOf.has(id));
  const inside = (id: string, outer: string) =>
    keyOf.get(id)!.startsWith(`${keyOf.get(outer)}/children/`);
  const scopeChapterIds = candidates
    .filter((id) => !candidates.some((o) => o !== id && inside(id, o)))
    .sort((a, b) => order.get(a)! - order.get(b)!);
  return {
    version: REPORT_SCOPE_COMPLETION_VERSION,
    scopeChapterIds,
    proposedChapterIds: [...proposedChapterIds],
    addedChapterIds: scopeChapterIds.filter(
      (id) => !proposedChapterIds.includes(id),
    ),
    absorbedChapterIds: proposedChapterIds.filter(
      (id) => keyOf.has(id) && !scopeChapterIds.includes(id),
    ),
  };
}
