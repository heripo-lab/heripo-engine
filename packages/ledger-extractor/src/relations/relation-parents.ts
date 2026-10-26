import type { ArchaeologyLedgerResult } from '../ledger/archaeology-ledger';
import type { RelationSignal, RelationSignals } from './relation-signals';

export const RELATION_PARENTS_VERSION = 'relation-parents.v1' as const;

/**
 * A parent set by code: exactly one record named by a find-spot phrase or the record's own table row, or by
 * an injected place alias rule (`alias`) when no record name named it directly.
 */
export interface RelationParentDecision {
  recordId: string;
  parentRecordId: string;
  basis: 'phrase' | 'table_row' | 'alias';
  /** Strong signals naming the parent. */
  evidence: RelationSignal[];
  /** Heading or chapter signals naming another record; kept for review, they do not override the parent. */
  otherSignals: RelationSignal[];
}
export type RelationParentQuestionReason =
  | 'ambiguous_target'
  | 'confirming_phrase'
  | 'row_only'
  | 'alias_unresolved'
  | 'conflicting_targets'
  | 'unmatched_place'
  | 'scope_only'
  | 'title_only'
  | 'cycle';
/** A record whose parent code cannot decide; a later judgment or a person decides it. */
export interface RelationParentQuestion {
  recordId: string;
  reasons: RelationParentQuestionReason[];
  candidateRecordIds: string[];
  signals: RelationSignal[];
}
/** A relation with source evidence that is not the chosen parent. */
export interface RelationLinkCandidate {
  fromRecordId: string;
  toRecordId: string;
  /** A short name taken from the phrase verb or the table row; not an ontology predicate. */
  relationLabel: string;
  evidence: RelationSignal[];
}
export interface RelationParents {
  version: typeof RELATION_PARENTS_VERSION;
  parents: RelationParentDecision[];
  questions: RelationParentQuestion[];
  links: RelationLinkCandidate[];
  /** Carried from the signals: the applied place alias table and records registered under a written form. */
  placeAliases?: RelationSignals['placeAliases'];
  aliasDuplicates?: RelationSignals['aliasDuplicates'];
}

/** A finding phrase or find-spot field, or a table row under a find-spot or membership column, can decide a parent. */
const isStrong = (s: RelationSignal) =>
  (s.kind === 'phrase' || s.kind === 'table_row') && s.finding === true;
const VERB = /출토|출수|수습|인양|채집|검출|확인|발견/;
const unique = (ids: string[]) => [...new Set(ids)];
const labelOf = (signal: RelationSignal) =>
  signal.kind === 'phrase' ? signal.text.match(VERB)![0] : '같은 표 행';

/**
 * Decide parents by code from relation signals (`relation-parents.v1`), deterministically. A parent is set only
 * when every finding phrase and membership-column table row names exactly one and the same record; when they name one feature
 * and records of other kinds, the feature is chosen (the spec's feature priority) and the others become link
 * candidates. Heading-scope and chapter-title signals never set a parent: alone, or with a phrase naming no
 * record, they become questions; so does a confirming phrase (`X에서 확인`), which also describes
 * investigations. A parent that would close a cycle is turned back into a question.
 */
export function resolveRelationParents(
  signals: RelationSignals,
  ledger: ArchaeologyLedgerResult,
): RelationParents {
  const kindOf = new Map(ledger.records.map((r) => [r.id, r.recordKind]));
  const parents: RelationParentDecision[] = [];
  const questions: RelationParentQuestion[] = [];
  const links: RelationLinkCandidate[] = [];
  const ask = (
    recordId: string,
    reasons: RelationParentQuestionReason[],
    list: RelationSignal[],
  ) =>
    questions.push({
      recordId,
      reasons,
      candidateRecordIds: unique(list.flatMap((s) => s.targetRecordIds)),
      signals: list,
    });

  for (const { recordId, signals: list } of signals.records) {
    const strong = list.filter((s) => isStrong(s) && s.targetRecordIds.length);
    const weak = list.filter((s) => !isStrong(s));
    if (!strong.length) {
      const reasons: RelationParentQuestionReason[] = [];
      if (list.some(isStrong)) reasons.push('unmatched_place');
      if (weak.some((s) => s.kind === 'phrase'))
        reasons.push('confirming_phrase');
      if (weak.some((s) => s.kind === 'table_row')) reasons.push('row_only');
      if (list.some((s) => s.alias && !s.targetRecordIds.length))
        reasons.push('alias_unresolved');
      if (weak.some((s) => s.kind === 'heading_scope'))
        reasons.push('scope_only');
      if (weak.some((s) => s.kind === 'chapter_title'))
        reasons.push('title_only');
      if (reasons.length) ask(recordId, reasons, list);
      continue;
    }
    if (strong.some((s) => s.targetRecordIds.length > 1)) {
      ask(recordId, ['ambiguous_target'], list);
      continue;
    }
    const targets = unique(strong.map((s) => s.targetRecordIds[0]));
    const features = targets.filter((id) => kindOf.get(id) === 'feature');
    const parent =
      targets.length === 1
        ? targets[0]
        : features.length === 1
          ? features[0]
          : null;
    if (!parent) {
      ask(recordId, ['conflicting_targets'], list);
      continue;
    }
    const evidence = strong.filter((s) => s.targetRecordIds[0] === parent);
    parents.push({
      recordId,
      parentRecordId: parent,
      basis: evidence.every((s) => s.alias)
        ? 'alias'
        : evidence.some((s) => s.kind === 'phrase' && !s.alias)
          ? 'phrase'
          : 'table_row',
      evidence,
      otherSignals: weak.filter((s) => !s.targetRecordIds.includes(parent)),
    });
    for (const other of targets.filter((id) => id !== parent)) {
      const support = strong.filter((s) => s.targetRecordIds[0] === other);
      links.push({
        fromRecordId: recordId,
        toRecordId: other,
        relationLabel: labelOf(support[0]),
        evidence: support,
      });
    }
  }

  // a chain that returns to its start is not a containment; every record on it is asked instead
  const parentOf = new Map(parents.map((p) => [p.recordId, p.parentRecordId]));
  const inCycle = new Set<string>();
  for (const start of parentOf.keys()) {
    const path: string[] = [];
    let current: string | undefined = start;
    while (current && !path.includes(current)) {
      path.push(current);
      current = parentOf.get(current);
    }
    if (current === start) path.forEach((id) => inCycle.add(id));
  }
  for (const id of inCycle) {
    const decision = parents.find((p) => p.recordId === id)!;
    ask(id, ['cycle'], [...decision.evidence, ...decision.otherSignals]);
  }
  return {
    version: RELATION_PARENTS_VERSION,
    parents: parents.filter((p) => !inCycle.has(p.recordId)),
    questions,
    links: links.filter((l) => !inCycle.has(l.fromRecordId)),
    ...(signals.placeAliases
      ? {
          placeAliases: signals.placeAliases,
          aliasDuplicates: signals.aliasDuplicates,
        }
      : {}),
  };
}
