import type { RelationParentJudgment } from '../relations/parent-judgment';
import type { RelationParentEvidence } from '../relations/parent-judgment-request';
import type { RelationParents } from '../relations/relation-parents';
import type { RelationSignal } from '../relations/relation-signals';
import type {
  ArchaeologyLedgerResult,
  LedgerParentEvidence,
  LedgerRecordLink,
  LedgerReviewItem,
} from './archaeology-ledger';

/** A signal's evidence, followed by the alias rule that resolved its place, if any. */
const signalEvidence = (signal: RelationSignal): LedgerParentEvidence[] => [
  evidenceOf(signal),
  ...(signal.alias
    ? [
        {
          kind: 'alias_rule' as const,
          text: `${signal.alias.written} → ${signal.alias.registered}`,
          ruleId: signal.alias.ruleId,
          quote: signal.alias.quote,
        },
      ]
    : []),
];
const evidenceOf = (
  e: RelationSignal | RelationParentEvidence,
): LedgerParentEvidence => ({
  kind: e.kind,
  text: e.text,
  ...(e.locator ? { locator: e.locator } : {}),
  ...(e.chapterId ? { chapterId: e.chapterId } : {}),
  ...('pdfPageNo' in e && e.pdfPageNo !== undefined
    ? { pdfPageNo: e.pdfPageNo }
    : {}),
});

/**
 * Put decided parents and the remaining parent questions into an assembled ledger, deterministically and
 * without model calls. Code-decided parents (`resolveRelationParents`) and parents every judgment run agreed
 * on (`decideRelationParents`) set `parentRecordId` with their evidence. Everything else becomes a `parent`
 * review item with reason `unresolved_parent` and flags the record: a question not judged, a judgment the runs
 * split on, and a unanimous `none` for a stated place no record matched (the place is written but not
 * registered). A unanimous `none` for other questions leaves the record without a parent and without review.
 * Parents that would close a cycle are undone and reviewed. Parents from an injected place alias rule get
 * `parentBasis: 'alias'` and the rule with its basis quote as evidence; records registered under a written
 * form become `identity` review items (`alias_duplicate`) with their registered record, without merging, and
 * the ledger header records the applied table. Link candidates beside a chosen parent are kept as links;
 * `parent_hierarchy` leaves `pending`.
 */
export function applyLedgerParents(
  result: ArchaeologyLedgerResult,
  parents: RelationParents,
  judgments: RelationParentJudgment[] = [],
): ArchaeologyLedgerResult {
  const decided = new Map<
    string,
    {
      parentRecordId: string;
      basis: 'code' | 'alias' | 'judgment';
      evidence: LedgerParentEvidence[];
    }
  >();
  for (const p of parents.parents)
    decided.set(p.recordId, {
      parentRecordId: p.parentRecordId,
      basis: p.basis === 'alias' ? 'alias' : 'code',
      // a rule that resolved both a phrase and a table cell is listed once
      evidence: p.evidence
        .flatMap(signalEvidence)
        .filter(
          (e, i, all) =>
            e.kind !== 'alias_rule' ||
            all.findIndex((x) => x.ruleId === e.ruleId && x.text === e.text) ===
              i,
        ),
    });
  const judgmentOf = new Map(judgments.map((j) => [j.recordId, j]));
  const open: Array<{
    recordId: string;
    reasons: string[];
    candidateRecordIds: string[];
    votes?: string[];
  }> = [];
  // a record registered under a written short form is reviewed as an identity, not as an open parent
  const duplicates = new Set(
    (parents.aliasDuplicates ?? []).map((d) => d.recordId),
  );
  for (const q of parents.questions) {
    if (duplicates.has(q.recordId)) continue;
    const j = judgmentOf.get(q.recordId);
    if (j?.status === 'parent') {
      decided.set(q.recordId, {
        parentRecordId: j.parentRecordId!,
        basis: 'judgment',
        evidence: j.evidence.map(evidenceOf),
      });
      continue;
    }
    if (j?.status === 'none' && !q.reasons.includes('unmatched_place'))
      continue;
    open.push({
      recordId: q.recordId,
      reasons: [
        'unresolved_parent',
        ...q.reasons,
        !j
          ? 'not_judged'
          : j.status === 'none'
            ? 'judged_none'
            : 'judgment_split',
      ],
      candidateRecordIds: q.candidateRecordIds,
      ...(j ? { votes: j.votes } : {}),
    });
  }

  // a chain that returns to its start is not a containment; every record on it is reviewed instead
  const inCycle = new Set<string>();
  for (const start of decided.keys()) {
    const path: string[] = [];
    let current: string | undefined = start;
    while (current && !path.includes(current)) {
      path.push(current);
      current = decided.get(current)?.parentRecordId;
    }
    if (current === start) path.forEach((id) => inCycle.add(id));
  }
  for (const id of inCycle) {
    open.push({
      recordId: id,
      reasons: ['unresolved_parent', 'cycle'],
      candidateRecordIds: [decided.get(id)!.parentRecordId],
    });
    decided.delete(id);
  }

  const added: Array<Omit<LedgerReviewItem, 'id'>> = [
    ...open.map((o) => ({
      kind: 'parent' as const,
      recordIds: [o.recordId],
      confirmedRecordIds: [],
      reasons: o.reasons,
      candidateRecordIds: o.candidateRecordIds,
      ...(o.votes ? { votes: o.votes } : {}),
    })),
    // a record registered under a written short form is the same unit as its registered record
    ...(parents.aliasDuplicates ?? []).map((d) => ({
      kind: 'identity' as const,
      recordIds: [
        d.recordId,
        ...(d.registeredRecordId ? [d.registeredRecordId] : []),
      ],
      confirmedRecordIds: [],
      reasons: ['alias_duplicate'],
      detail: `${d.written} = ${d.registered} (${d.ruleId})`,
    })),
  ];
  const reviewItems: LedgerReviewItem[] = [
    ...result.reviewItems,
    ...added.map((item, i) => ({
      id: `review-${result.reviewItems.length + i + 1}`,
      ...item,
    })),
  ];
  const unresolved = new Set(added.flatMap((item) => item.recordIds));
  const links: LedgerRecordLink[] = [
    ...result.links,
    ...parents.links
      .filter((l) => decided.has(l.fromRecordId))
      .map((l, i) => ({
        id: `link-${result.links.length + i + 1}`,
        ledgerId: result.ledger.id,
        fromRecordId: l.fromRecordId,
        toRecordId: l.toRecordId,
        relationLabel: l.relationLabel,
        evidence: l.evidence.map(evidenceOf),
        needsReview: false,
      })),
  ];
  return {
    ...result,
    ledger: {
      ...result.ledger,
      ...(parents.placeAliases ? { placeAliases: parents.placeAliases } : {}),
    },
    records: result.records.map((r) => {
      const parent = decided.get(r.id);
      return {
        ...r,
        ...(parent
          ? {
              parentRecordId: parent.parentRecordId,
              parentBasis: parent.basis,
              parentEvidence: parent.evidence,
            }
          : {}),
        needsReview: r.needsReview || unresolved.has(r.id),
      };
    }),
    links,
    pending: result.pending.filter((p) => p !== 'parent_hierarchy'),
    reviewItems,
  };
}
