import type { DocumentResourceIndex } from '../resources/document-resource-index';
import type { ReportSignals } from './report-signals';

import {
  latinPrefixedNumbers,
  rowLeadingNumber,
  sameObjectNumber,
} from '../candidates/object-numbers';

export const REPORT_SCOPE_COMPLETION_VERSION =
  'report-scope-completion.v2' as const;
/** A register table names at least this many objects in its first columns... */
export const REPORT_SCOPE_REGISTER_MIN_ROWS = 3;
/** ...and at least this share of them is written in the scope's text with a Latin prefix (`M107` for `107`). */
export const REPORT_SCOPE_REGISTER_LINKED_SHARE = 0.5;

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
  /**
   * From v2: register tables after the scope, outside its chapters, that list the scope's own objects; discovery
   * reads them as tables of their own.
   */
  tableIds: string[];
}

/**
 * Tables in chapters after the scope whose rows open (in their first two columns) with object numbers that the
 * scope's text writes with a Latin prefix: an appendix register of this investigation's objects, such as an appendix feature register listing tombs `101`, `102A` that the text calls `M101`, `99XXM102`. A table of a report
 * whose table of contents lost its appendix headings ends up in the last chapter (a closing chapter), outside the scope.
 * Numbers count by their leading digits, so the burials `102A` and `102B` both link to `M102`.
 */
function registerTables(index: DocumentResourceIndex, scope: string[]) {
  const chapters = index.resources.filter((r) => r.kind === 'chapter');
  const keyOf = new Map(chapters.map((c) => [c.resourceId!, c.key]));
  const inScope = (chapterId: string) =>
    scope.some((id) => {
      const key = keyOf.get(id)!;
      const own = keyOf.get(chapterId);
      return own === key || !!own?.startsWith(`${key}/children/`);
    });
  const order = new Map(chapters.map((c, i) => [c.resourceId!, i]));
  const last = Math.max(...scope.map((id) => order.get(id)!));
  const numbers = new Set(
    index.resources.flatMap((r) =>
      r.kind === 'text' && r.chapterIds.some(inScope)
        ? latinPrefixedNumbers(r.data.text)
        : [],
    ),
  );
  return index.resources.flatMap((r) => {
    if (r.kind !== 'table') return [];
    const chapter = r.chapterIds.at(-1);
    if (!chapter || inScope(chapter) || order.get(chapter)! < last) return [];
    const rowNumbers = r.data.grid.slice(1).flatMap((row) => {
      const digits = rowLeadingNumber(row.map((c) => c.text));
      return digits ? [digits] : [];
    });
    const linked = rowNumbers.filter((n) =>
      [...numbers].some((written) => sameObjectNumber(n, written)),
    );
    return rowNumbers.length >= REPORT_SCOPE_REGISTER_MIN_ROWS &&
      linked.length >= rowNumbers.length * REPORT_SCOPE_REGISTER_LINKED_SHARE
      ? [r.resourceId!]
      : [];
  });
}

/**
 * Complete a proposed discovery scope with every chapter the code's signals mark as investigation-like
 * (survey scope, method, contents, trial or excavation titles), keeping only the outermost chapters in document
 * order. A router can leave out a chapter that defines this investigation's areas because its parent title
 * also names equipment; the signals put it back. Nothing the proposal had is dropped except into a wider
 * chapter, background or discussion chapters are not added, and unknown chapter IDs are ignored. Which
 * chapters were added is kept so the ledger can show it. From v2 it also lists the appendix register tables of the
 * scope's objects (`tableIds`). Deterministic and without model calls.
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
    tableIds: scopeChapterIds.length
      ? registerTables(index, scopeChapterIds)
      : [],
  };
}
