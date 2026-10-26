import type {
  RelationSentence,
  RelationSentenceTarget,
  RelationSentences,
} from './relation-sentences';

export const RECORD_LINKS_VERSION = 'record-links.v1' as const;

/** Where a link or question comes from: a sentence of the speaking record's excerpt, or a table cell. */
export interface RecordLinkEvidence {
  /** The record whose excerpt or table row states the relation. */
  recordId: string;
  quote: string;
  sourceId?: string;
  locator?: string;
  tableId?: string;
  cellKey?: string;
  pdfPageNo: number | null;
}
export interface RecordLinkDecision {
  fromRecordId: string;
  toRecordId: string;
  /** A short label from the source's own word (`중복`, `인접`, `파괴`), or `위치` for distance and direction. */
  relationLabel: string;
  /** True when the label reads the same both ways; one link then holds the pair's evidence from both sides. */
  symmetric: boolean;
  basis: 'rule' | 'table_column';
  evidence: RecordLinkEvidence[];
}
export type RecordLinkQuestionReason =
  'link_enclosure' | 'link_several_targets' | 'link_unclear';
export interface RecordLinkQuestion {
  recordId: string;
  candidateRecordIds: string[];
  reason: RecordLinkQuestionReason;
  evidence: RecordLinkEvidence;
}
/** A relation whose target is a name several records share, or a `N호 …` name no record has. */
export interface RecordLinkUnresolved {
  recordId: string;
  written: string;
  candidateRecordIds: string[];
  evidence: RecordLinkEvidence;
}
export interface RecordLinks {
  version: typeof RECORD_LINKS_VERSION;
  links: RecordLinkDecision[];
  questions: RecordLinkQuestion[];
  unresolved: RecordLinkUnresolved[];
  /** Names written as a place the record is in (`사등성지 내`, `사등성지 중앙부`): containment, not a link. */
  locatedInSkipped: number;
  /** Names in a span or list with the record (`2~4호 건물지`): co-subjects, not targets. */
  inRangeSkipped: number;
  /** Names in a clause with no relation cue and no direction right before them. */
  withoutCueSkipped: number;
}

type Rule =
  | { kind: 'link'; label: string; reverse?: boolean; symmetric: boolean }
  | { kind: 'question'; reason: RecordLinkQuestionReason }
  | { kind: 'located_in' }
  | { kind: 'in_range' }
  | { kind: 'without_cue' };

const DISTANCE = '(?:약)?[\\d.,~]+(?:m|cm|km|㎝)(?:정도|가량|내외)?';
const DIRECTION = '(?:동|서|남|북)[가-힣]{0,3}(?:쪽|측)';
/** Rules on the clause text right after a name (and before it, for `위치`); first match wins. */
const RULES: Array<{ after?: RegExp; before?: RegExp; rule: Rule }> = [
  {
    after: new RegExp(
      `^(?:의[가-힣]{0,6}?)?(?:와|과|에서|로부터|가|이)?(?:${DIRECTION}(?:으로)?)?${DISTANCE}(?:떨어|거리를두)`,
    ),
    rule: { kind: 'link', label: '위치', symmetric: true },
  },
  {
    after: /^(?:을|를)[가-힣]{0,6}?(?:파괴|절단)/,
    rule: { kind: 'link', label: '파괴', symmetric: false },
  },
  {
    after: /^에의(?:해|하여)[가-힣]{0,4}?(?:파괴|절단)/,
    rule: { kind: 'link', label: '파괴', reverse: true, symmetric: false },
  },
  {
    after: /^(?:와|과)[가-힣]{0,4}?중복/,
    rule: { kind: 'link', label: '중복', symmetric: true },
  },
  {
    after: /^(?:와|과)[가-힣]{0,4}?접합/,
    rule: { kind: 'link', label: '접합', symmetric: true },
  },
  {
    after: /^(?:와|과)[가-힣]{0,4}?연결될가능성/,
    rule: { kind: 'link', label: '연결 가능성', symmetric: true },
  },
  {
    after: /^(?:와|과)[가-힣]{0,4}?연결/,
    rule: { kind: 'link', label: '연결', symmetric: true },
  },
  {
    after: /^(?:와|과|에|가|이)[가-힣]{0,6}?(?:인접|연접|맞닿)/,
    rule: { kind: 'link', label: '인접', symmetric: true },
  },
  {
    after: new RegExp(`^(?:가|이)${DIRECTION}(?:으로|에)?위치`),
    rule: { kind: 'link', label: '위치', symmetric: true },
  },
  {
    before: new RegExp(
      `(?:떨어진(?:지점|곳)에|${DIRECTION}(?:으로|에)[가-힣()]{0,12})$`,
    ),
    after: /^(?:가|이)[가-힣]{0,6}?위치/,
    rule: { kind: 'link', label: '위치', symmetric: true },
  },
];
/** A place the record is in, read before any cue: `B 내`, `B 일대`, `B 중앙부`, `B 내부에 해당`. */
const LOCATED_IN =
  /^(?:의)?(?:내(?!부)|안에|일대|일원|중앙부|성내부|내부에해당)/;
/** `A는 B 북쪽 하수관로…`: right after the record's own topic, a part of B by direction is where A is. */
const LOCATED_IN_PART = /^(?:동|서|남|북)[가-힣]{0,2}(?:쪽|측|편)(?!으로|에)/;
/** Enclosure, a question: `B로 감싸여진`, `B 내부에서`, `B를 사이에 두고`. */
const ENCLOSURE = /^(?:(?:으로|로)감싸|내부|(?:을|를)사이에두)/;
const DIRECTION_BEFORE = new RegExp(`${DIRECTION}(?:으로|에)[가-힣()]{0,12}$`);
const CONNECTOR = /^(?:및|와|과|·)$/;

/**
 * The text that governs a name: in a coordinated phrase (`72호 수혈 및 96호 수혈과 중복`) every name takes the
 * predicate after the last name of the phrase.
 */
function governing(
  target: RelationSentenceTarget,
  all: RelationSentenceTarget[],
) {
  const inClause = all.filter((t) => t.clauseIndex === target.clauseIndex);
  let current = target;
  for (;;) {
    const next = inClause.find(
      (t) =>
        t.before.length > current.before.length &&
        t.before.startsWith(current.before + current.written) &&
        CONNECTOR.test(
          t.before.slice(current.before.length + current.written.length),
        ),
    );
    if (!next) return { before: target.before, after: current.after };
    current = next;
  }
}

function ruleFor(
  target: RelationSentenceTarget,
  sentence: RelationSentence,
): Rule {
  if (target.inRange) return { kind: 'in_range' };
  const { before, after } = governing(target, sentence.targets);
  if (LOCATED_IN.test(after)) return { kind: 'located_in' };
  const cue = sentence.cueClauses.includes(target.clauseIndex);
  const place = sentence.placeClauses.includes(target.clauseIndex);
  const rule =
    cue || place
      ? RULES.find(
          (r) =>
            (!r.after || r.after.test(after)) &&
            (!r.before || r.before.test(before)),
        )?.rule
      : undefined;
  if (rule) return rule;
  if (target.afterTopic && LOCATED_IN_PART.test(after))
    return { kind: 'located_in' };
  // a list item placed by direction (`서측으로 2호 건물지, …이 인접한다`) is asked about though its clause has no cue
  if (!cue && !place)
    return DIRECTION_BEFORE.test(before)
      ? { kind: 'question', reason: 'link_unclear' }
      : { kind: 'without_cue' };
  if (cue && ENCLOSURE.test(after))
    return { kind: 'question', reason: 'link_enclosure' };
  // a name with no predicate is asked about only in a cue clause or right after a direction
  return cue || DIRECTION_BEFORE.test(before)
    ? { kind: 'question', reason: 'link_unclear' }
    : { kind: 'without_cue' };
}

/**
 * Decide links by code (L1), deterministically and without model calls. A link is made only when, inside one
 * clause, the predicate follows the name with its particle (`B와 중복`, `B를 파괴`, `B에 의해 파괴`, `B와 인접`,
 * `B가 4.3m 떨어져`, `동쪽으로 B가 위치`), or a relation column's cell names one record. Coordinated names share
 * the phrase's predicate. A pair with a symmetric label is one link carrying the evidence from both records.
 * Enclosure (`B로 감싸여진`, `B 내부`, `B를 사이에 두고`) and names without such a predicate in their clause
 * become questions for review; a name several records share or an unregistered `N호 …` name in a relation
 * clause is unresolved; a place the record is in (`B 내`) is containment and skipped.
 */
export function resolveRecordLinks(sentences: RelationSentences): RecordLinks {
  const links = new Map<string, RecordLinkDecision>();
  const questions: RecordLinkQuestion[] = [];
  const unresolved: RecordLinkUnresolved[] = [];
  let locatedInSkipped = 0;
  let inRangeSkipped = 0;
  let withoutCueSkipped = 0;
  const add = (
    from: string,
    to: string,
    label: string,
    symmetric: boolean,
    basis: RecordLinkDecision['basis'],
    evidence: RecordLinkEvidence,
  ) => {
    const key = symmetric
      ? `${label}|${[from, to].sort().join('|')}`
      : `${label}|${from}|${to}`;
    const link = links.get(key);
    if (!link)
      links.set(key, {
        fromRecordId: from,
        toRecordId: to,
        relationLabel: label,
        symmetric,
        basis,
        evidence: [evidence],
      });
    else if (
      !link.evidence.some(
        (e) =>
          e.quote === evidence.quote &&
          e.sourceId === evidence.sourceId &&
          e.cellKey === evidence.cellKey,
      )
    )
      link.evidence.push(evidence);
  };

  for (const s of sentences.sentences) {
    const evidence: RecordLinkEvidence = {
      recordId: s.recordId,
      quote: s.text,
      sourceId: s.sourceId,
      locator: s.locator,
      pdfPageNo: s.pdfPageNo,
    };
    const asked = new Map<RecordLinkQuestionReason, string[]>();
    const open: string[] = [];
    for (const target of s.targets) {
      if (target.recordIds.length > 1) {
        unresolved.push({
          recordId: s.recordId,
          written: target.written,
          candidateRecordIds: target.recordIds,
          evidence,
        });
        continue;
      }
      const [other] = target.recordIds;
      const rule = ruleFor(target, s);
      if (rule.kind === 'located_in') locatedInSkipped++;
      else if (rule.kind === 'in_range') inRangeSkipped++;
      else if (rule.kind === 'without_cue') withoutCueSkipped++;
      else if (rule.kind === 'link')
        add(
          rule.reverse ? other : s.recordId,
          rule.reverse ? s.recordId : other,
          rule.label,
          rule.symmetric,
          'rule',
          evidence,
        );
      else if (rule.reason === 'link_unclear') open.push(other);
      else asked.set(rule.reason, [...(asked.get(rule.reason) ?? []), other]);
    }
    if (open.length)
      asked.set(
        new Set(s.targets.flatMap((t) => t.recordIds)).size > 1
          ? 'link_several_targets'
          : 'link_unclear',
        open,
      );
    for (const [reason, ids] of asked)
      questions.push({
        recordId: s.recordId,
        candidateRecordIds: [...new Set(ids)],
        reason,
        evidence,
      });
    for (const written of s.unregistered)
      unresolved.push({
        recordId: s.recordId,
        written,
        candidateRecordIds: [],
        evidence,
      });
  }

  for (const c of sentences.tableCells) {
    const evidence: RecordLinkEvidence = {
      recordId: c.recordId,
      quote: `${c.keyText}: ${c.valueText}`,
      tableId: c.tableId,
      cellKey: c.cellKey,
      pdfPageNo: c.pdfPageNo,
    };
    const label = c.keyText.split(' / ').at(-1)!;
    for (const t of c.targets)
      if (t.recordIds.length === 1)
        add(c.recordId, t.recordIds[0], label, true, 'table_column', evidence);
      else
        unresolved.push({
          recordId: c.recordId,
          written: t.written,
          candidateRecordIds: t.recordIds,
          evidence,
        });
    for (const written of c.unregistered)
      unresolved.push({
        recordId: c.recordId,
        written,
        candidateRecordIds: [],
        evidence,
      });
  }
  return {
    version: RECORD_LINKS_VERSION,
    links: [...links.values()],
    questions,
    unresolved,
    locatedInSkipped,
    inRangeSkipped,
    withoutCueSkipped,
  };
}
