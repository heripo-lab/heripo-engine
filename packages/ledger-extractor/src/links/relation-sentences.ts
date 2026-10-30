import type { TableAttributes } from '../attributes/table-attributes';
import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { ArchaeologyLedgerResult } from '../ledger/archaeology-ledger';

import {
  aliasesOf,
  createNearestRecords,
  looseKey,
  norm,
} from '../relations/record-names';

export const RELATION_SENTENCES_VERSION = 'relation-sentences.v1' as const;

/** A registered record named in a relation sentence, with the clause around the name. */
export interface RelationSentenceTarget {
  /** Records the name matched; several when the name is ambiguous. */
  recordIds: string[];
  /** The name as matched, without spaces. */
  written: string;
  /** Index of the clause (comma-separated part of the sentence) the name is in. */
  clauseIndex: number;
  /** The clause text before and after the name, without spaces. */
  before: string;
  after: string;
  /** True for a name inside a span or list of numbers (`2~4호 건물지`, `1·2호`): a co-subject, not a target. */
  inRange: boolean;
  /** True when the clause starts with the speaking record's own name as topic (`11트렌치는 B …`). */
  afterTopic: boolean;
}
/** A sentence of a record's own excerpt that names another record and carries a relation cue. */
export interface RelationSentence {
  /** The record whose excerpt the sentence is in; the subject of the relation. */
  recordId: string;
  text: string;
  sourceId: string;
  locator: string;
  pdfPageNo: number | null;
  targets: RelationSentenceTarget[];
  /** Clauses carrying a relation cue (names masked, so `교란층` is not a cue). */
  cueClauses: number[];
  /** Clauses placing something by direction (`동쪽으로 … 위치`) without a relation cue. */
  placeClauses: number[];
  /** `N호 …` names in cue clauses that no registered record has. */
  unregistered: string[];
}
/** An owned cell under a relation column (`중복관계`, `선후관계`) of a table. */
export interface RelationTableCell {
  recordId: string;
  keyText: string;
  valueText: string;
  /** Records the cell names, each with every record its name matched. */
  targets: Array<{ written: string; recordIds: string[] }>;
  unregistered: string[];
  cellKey: string;
  tableId: string;
  pdfPageNo: number | null;
}
export interface RelationSentences {
  version: typeof RELATION_SENTENCES_VERSION;
  sentences: RelationSentence[];
  tableCells: RelationTableCell[];
  /** Names left out because they are the record's own ancestor or descendant (containment, not a link). */
  containmentSkipped: number;
}

/**
 * Relation cues: overlap and cutting, adjacency and distance, connection, joining, enclosure. A bare `내부` is
 * not one (`내부조사`, `내부에서 아궁이`); `B 내부` is read by the link rules.
 */
const CUE =
  /중복|파괴|절단|선후|보다(?:늦|이르|먼저|나중)|인접|연접|맞닿|연결|이어지|이어진|떨어|거리를두|나란|사이에두|감싸|접합|동일개체|같은개체/;
/** Placing by direction: `동쪽으로 … 위치`. */
const PLACE = /(?:동|서|남|북)[가-힣]{0,3}(?:쪽|측)(?:으로|에).*위치/;
const IN_RANGE = /\d[~∼·]$/;
const RELATION_COLUMN = /중복|선후|관계/;
/** A `N호 …` name, without the particle after it. */
const NUMBERED_NAME =
  /\d+호[가-힣]{1,6}?(?=와|과|및|을|를|이|가|은|는|의|에|로|[^가-힣]|$)/g;
const SENTENCE_BREAK = /(?<=[.!?])\s+|\n/;
const CLAUSE_BREAK = /,(?!\d)|;/;
const MASK = '□';
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Names a registry can be found by in running text: every name of a numbered record, and the name of an
 * unnumbered record when it is three or more letters, belongs to that record alone and is not the bare
 * class name numbered records share (`트렌치`, `수혈`). Exact names are tried before the loose form that
 * allows `호` after a number (`96 수혈` registered, `96호 수혈` written).
 */
function createNameFinder(plan: ContentAttachmentPlan) {
  const numbered = (e: ContentAttachmentPlan['registry'][number]) =>
    e.mentions.some((m) => m.sourceIdentifier);
  const classNames = new Set(
    plan.registry
      .filter(numbered)
      .flatMap((e) => e.mentions.map((m) => norm(m.sourceName))),
  );
  const owners = new Map<string, Set<string>>();
  for (const e of plan.registry)
    for (const alias of aliasesOf(e, norm))
      owners.set(
        alias,
        (owners.get(alias) ?? new Set()).add(`record-${e.groupId}`),
      );
  const usable = (e: ContentAttachmentPlan['registry'][number]) =>
    aliasesOf(e, norm).filter(
      (alias) =>
        numbered(e) ||
        (alias.length >= 3 &&
          owners.get(alias)!.size === 1 &&
          !classNames.has(alias)),
    );
  const exact = new Map<string, Set<string>>();
  const loose = new Map<string, Set<string>>();
  for (const e of plan.registry)
    for (const alias of usable(e)) {
      exact.set(
        alias,
        (exact.get(alias) ?? new Set()).add(`record-${e.groupId}`),
      );
      if (/\d/.test(alias))
        loose.set(
          looseKey(alias),
          (loose.get(looseKey(alias)) ?? new Set()).add(`record-${e.groupId}`),
        );
    }
  const patterns = [
    ...[...exact.keys()].map((alias) => ({ source: esc(alias), alias })),
    ...[...loose.keys()].map((alias) => ({
      source: esc(alias).replace(/(\d)(?=\D)/g, '$1(?:호)?'),
      alias,
    })),
  ]
    .sort((a, b) => b.alias.length - a.alias.length)
    .map((p) => ({
      re: new RegExp(`(?<![\\d-])${p.source}(?!\\d)`, 'g'),
    }));
  const nearest = createNearestRecords(plan);
  /**
   * Names in text without spaces, longest first, never overlapping. A name's records are those of its exact
   * and loose forms (`29호 수혈` and `29 수혈`), narrowed to the nearest by chapter path to `near` (the speaking
   * record), then to the exact form among those still tied.
   */
  return (text: string, near: string) => {
    const taken = new Array<boolean>(text.length).fill(false);
    const found: Array<{ at: number; written: string; recordIds: string[] }> =
      [];
    for (const p of patterns)
      for (const m of text.matchAll(p.re)) {
        const end = m.index + m[0].length;
        if (taken.slice(m.index, end).some(Boolean)) continue;
        taken.fill(true, m.index, end);
        const formOf = new Map<string, number>();
        for (const id of exact.get(m[0]) ?? []) formOf.set(id, 0);
        for (const id of loose.get(looseKey(m[0])) ?? [])
          if (!formOf.has(id)) formOf.set(id, 1);
        const nearby = nearest([...formOf.keys()], near);
        const first = Math.min(...nearby.map((id) => formOf.get(id)!));
        found.push({
          at: m.index,
          written: m[0],
          recordIds: nearby.filter((id) => formOf.get(id) === first),
        });
      }
    return found.sort((a, b) => a.at - b.at);
  };
}

/**
 * Collect relation sentences (L0), deterministically and without model calls. A sentence of a record's own
 * excerpt is kept when it names another registered record and one of its clauses carries a relation cue once
 * names are masked. A name that is the record's ancestor or descendant is containment the parent hierarchy
 * already holds and is left out. Generic class names never name a record. Owned cells of a table column whose
 * header names a relation (`중복관계`) are kept with the records they name. Layer order (`차례로`) is not a cue.
 */
export function collectRelationSentences(
  plan: ContentAttachmentPlan,
  ledger: ArchaeologyLedgerResult,
  table?: TableAttributes,
): RelationSentences {
  const find = createNameFinder(plan);
  const topicOf = new Map(
    plan.registry.map((e) => [
      `record-${e.groupId}`,
      new RegExp(
        `^[^\\d가-힣A-Za-z]*(?:${aliasesOf(e, norm).map(esc).join('|')})(?:은|는)$`,
      ),
    ]),
  );
  const parentOf = new Map(ledger.records.map((r) => [r.id, r.parentRecordId]));
  const ancestors = (id: string) => {
    const found = new Set<string>();
    for (let p = parentOf.get(id); p && !found.has(p); p = parentOf.get(p))
      found.add(p);
    return found;
  };
  const contains = (a: string, b: string) =>
    ancestors(a).has(b) || ancestors(b).has(a);
  let containmentSkipped = 0;
  const unregisteredIn = (text: string, names: string[]) =>
    [...text.matchAll(NUMBERED_NAME)]
      .map((m) => m[0])
      .filter((n) => !names.some((x) => x.includes(n) || n.includes(x)));

  const sentences: RelationSentence[] = [];
  const seen = new Set<string>();
  for (const source of ledger.sources)
    for (const raw of source.excerpt.split(SENTENCE_BREAK)) {
      const text = raw.trim();
      const key = `${source.recordId}|${norm(text)}`;
      if (!text || seen.has(key)) continue;
      seen.add(key);
      const clauses = text.split(CLAUSE_BREAK).map(norm);
      const targets: RelationSentenceTarget[] = [];
      const cueClauses: number[] = [];
      const placeClauses: number[] = [];
      const unregistered: string[] = [];
      clauses.forEach((clause, clauseIndex) => {
        const names = find(clause, source.recordId);
        let masked = clause;
        for (const n of names)
          masked =
            masked.slice(0, n.at) +
            MASK.repeat(n.written.length) +
            masked.slice(n.at + n.written.length);
        if (PLACE.test(masked) && !CUE.test(masked))
          placeClauses.push(clauseIndex);
        if (CUE.test(masked) || PLACE.test(masked)) {
          if (CUE.test(masked)) cueClauses.push(clauseIndex);
          unregistered.push(
            ...unregisteredIn(
              clause,
              names.map((n) => n.written),
            ),
          );
        }
        for (const n of names) {
          // the speaking record's own name
          if (n.recordIds.includes(source.recordId)) continue;
          const { recordIds } = n;
          if (
            recordIds.length === 1 &&
            contains(source.recordId, recordIds[0])
          ) {
            containmentSkipped++;
            continue;
          }
          targets.push({
            recordIds,
            written: n.written,
            clauseIndex,
            before: clause.slice(0, n.at),
            after: clause.slice(n.at + n.written.length),
            inRange: IN_RANGE.test(clause.slice(0, n.at)),
            afterTopic: topicOf
              .get(source.recordId)!
              .test(clause.slice(0, n.at)),
          });
        }
      });
      if (!targets.length || cueClauses.length + placeClauses.length === 0)
        continue;
      sentences.push({
        recordId: source.recordId,
        text,
        sourceId: source.id,
        locator: source.locator,
        pdfPageNo: source.pdfPageNo,
        targets,
        cueClauses,
        placeClauses,
        unregistered,
      });
    }

  const tableCells: RelationTableCell[] = [];
  for (const a of table?.attributes ?? []) {
    if (!RELATION_COLUMN.test(a.keyText)) continue;
    const value = norm(a.valueText);
    const names = find(value, a.recordId);
    const targets = names
      .filter((n) => !n.recordIds.includes(a.recordId))
      .map((n) => ({ written: n.written, recordIds: n.recordIds }));
    const unregistered = unregisteredIn(
      value,
      names.map((n) => n.written),
    );
    if (!targets.length && !unregistered.length) continue;
    tableCells.push({
      recordId: a.recordId,
      keyText: a.keyText,
      valueText: a.valueText,
      targets,
      unregistered,
      cellKey: a.metadata.cellKey,
      tableId: a.metadata.tableId,
      pdfPageNo: a.metadata.pdfPageNo,
    });
  }
  return {
    version: RELATION_SENTENCES_VERSION,
    sentences,
    tableCells,
    containmentSkipped,
  };
}
