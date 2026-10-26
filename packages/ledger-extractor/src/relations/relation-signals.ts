import type {
  ContentAttachmentPlan,
  TextSource,
} from '../content-attachment/types';
import type { ArchaeologyLedgerResult } from '../ledger/archaeology-ledger';
import type {
  PlaceAliasDuplicate,
  PlaceAliasMatch,
  PlaceAliasSummary,
  PlaceAliasTable,
} from './place-aliases';
import type { AliasIndex, NameForm } from './record-names';

import { createPlaceAliasResolver } from './place-aliases';
import {
  FORMS,
  aliasesOf,
  createNearestRecords,
  createRecordNamer,
  norm,
} from './record-names';

export const RELATION_SIGNALS_VERSION = 'relation-signals.v1' as const;

/**
 * Where a parent candidate comes from, strongest first (implementation spec, parent evidence priority):
 * an explicit find-spot phrase in the record's own excerpts, another registered record in the record's own
 * table row, the record heading the record's text falls under in reading order, and a chapter title naming
 * a record. Only a finding `phrase` and a `table_row` under a find-spot or membership column can decide a
 * parent by code; the others are candidates only.
 */
export type RelationSignalKind =
  'phrase' | 'table_row' | 'heading_scope' | 'chapter_title';
export interface RelationSignal {
  kind: RelationSignalKind;
  /** Records the signal names; empty when a phrase names a place no record matches. */
  targetRecordIds: string[];
  /** The phrase, cell, heading or chapter title as written. */
  text: string;
  /** The place part of a phrase that was matched against record names. */
  place?: string;
  /** For `table_row`: the first-row cell of the column, the column's header. */
  header?: string;
  /**
   * For `table_row`: true when the column header names a find-spot or membership (출토·출수·수습·위치·소속);
   * a row cell under another header (a trench's list of features) only proposes a candidate.
   * For `phrase`: true for a finding verb (출토·출수·수습·인양·채집) or a find-spot field; false for a confirming
   * verb (확인·검출·발견), which also describes investigations and so only proposes a candidate.
   */
  finding?: boolean;
  /**
   * For a `phrase` or `table_row` whose place no record name matched: the injected place alias rule that
   * mapped it. With one record in `recordIds` it names the target; otherwise the place stays unresolved.
   */
  alias?: PlaceAliasMatch;
  /** Ledger source of the excerpt for `phrase` signals. */
  sourceId?: string;
  locator?: string;
  pdfPageNo?: number | null;
  chapterId?: string;
}
export interface RecordRelationSignals {
  recordId: string;
  signals: RelationSignal[];
}
export interface RelationSignals {
  version: typeof RELATION_SIGNALS_VERSION;
  candidateSnapshotId: string;
  records: RecordRelationSignals[];
  /** The injected place alias table, when one was applied. */
  placeAliases?: PlaceAliasSummary;
  /** Records registered under a written form of an applied rule. */
  aliasDuplicates?: PlaceAliasDuplicate[];
}

/** Verbs of finding or confirming an object at a place; a phrase ends at one of them. */
const FIND_VERBS = '출토|출수|수습|인양|채집|검출|확인|발견';
const LOCATIVE_PHRASE = new RegExp(
  `(?:에서는|에서|으로부터)\\s*(?:[가-힣]{1,4}\\s+)?(?:${FIND_VERBS})`,
  'g',
);
const BARE_PHRASE = new RegExp(
  `\\s(?:${FIND_VERBS.split('|').slice(0, 2).join('|')})(?=\\s|품|유물|$)`,
  'g',
);
const STRONG_VERB = /출토|출수|수습|인양|채집/;
const MEMBERSHIP_HEADER = /출토|출수|수습|위치|소속/;
const PARTICLE_END = /(?:에서는?|으로부터|[은는이가을를의에도와과])$/;
const FIELD_PHRASE =
  /(?:출토|출수|수습)\s*(?:위치|지점|지(?!점)|유구|층위)\s*[:：│]?\s*(?![에은는을를의이가과와도])([^|│\n]{1,30})/g;
/** Words naming a part of a place that may follow its name before the locative ending. */
const PLACE_PARTS = [
  '내부토',
  '바닥면',
  '내부',
  '바닥',
  '상면',
  '하면',
  '상부',
  '하부',
  '노면',
  '주변',
  '벽면',
  '모서리',
  '어깨',
  '매립토',
  '내',
  '안',
];
const GENERIC_HEADING =
  /^\s*(?:\d+[.)]|\(\d+\)|[①-⑳]|[가-하][.)]|\([가-하]\)|[IVXⅠ-Ⅻ]+[.)]|[A-Z][.)])\s*\S/;
const HEADING_MAX_CHARS = 40;
const LEADING_NUMBERING =
  /^\s*(?:\d+[.)]|\(\d+\)|[①-⑳]|[가-하][.)]|\([가-하]\)|[IVXⅠ-Ⅻ]+[.)]|[A-Z][.)])\s*/;

/** A heading's title without its numbering and trailing figure or plate references. */
const headingTitle = (text: string) =>
  text.replace(LEADING_NUMBERING, '').replace(/\([^)]*\)\s*$/, '');
const SENTENCE_BREAK = /(?<=[.!?])\s+|\n|\|/;

/**
 * Records whose name ends exactly the place text, allowing a trailing place part (`1호 수혈 내부`). The
 * longest name wins in each name form; records found in either form (`29호 수혈` and `29 수혈`) are narrowed
 * to the ones nearest the speaking record by chapter path, then to the exact form among those still tied; a
 * name several records share in the same form and chapter stays an ambiguous target.
 */
function matchPlace(
  place: string,
  indexes: Array<[NameForm, AliasIndex]>,
  self: string,
  nearest: (ids: string[], near: string) => string[],
): string[] | null {
  // the first name form each record was found in: exact before loose
  const formOf = new Map<string, number>();
  indexes.forEach(([form, aliasIndex], i) => {
    for (const id of matchPlaceIn(form(place), aliasIndex) ?? [])
      if (!formOf.has(id)) formOf.set(id, i);
  });
  const near = nearest([...formOf.keys()], self);
  const first = Math.min(...near.map((id) => formOf.get(id)!));
  const ids = near.filter((id) => formOf.get(id) === first);
  // a place naming the record itself is no find-spot
  return ids.includes(self) ? null : ids;
}
function matchPlaceIn(text: string, aliasIndex: AliasIndex) {
  const variants = [text];
  for (const part of PLACE_PARTS)
    if (text.endsWith(part) && text.length > part.length)
      variants.push(text.slice(0, -part.length));
  let best = '';
  for (const variant of variants)
    for (const alias of aliasIndex.keys()) {
      if (alias.length <= best.length || !variant.endsWith(alias)) continue;
      const before = variant.at(-alias.length - 1) ?? '';
      // a name starting with a number must not be the tail of a longer number (1호 inside 11호)
      if (/^[0-9A-Za-z]/.test(alias) && /[0-9A-Za-z-]/.test(before)) continue;
      // a numbered place (98호 수혈) is not the record bearing only the bare name
      if (/\d(?:호|기|번|차)?$/.test(variant.slice(0, -alias.length))) continue;
      best = alias;
    }
  return best ? aliasIndex.get(best)! : null;
}

/**
 * Find-spot phrases of one excerpt. A field value (`출수위치 발굴 1구역`) or a locative phrase with a finding
 * verb is kept even when its place matches no record; a bare `X 출토` or a `확인·검출·발견` phrase is kept only
 * when it names a record, since such words also occur without naming a place.
 */
function phrasesOf(text: string) {
  const found: Array<{
    text: string;
    place: string;
    finding: boolean;
    keepUnmatched: boolean;
  }> = [];
  for (const sentence of text.split(SENTENCE_BREAK)) {
    for (const m of sentence.matchAll(FIELD_PHRASE))
      found.push({
        text: m[0].trim(),
        place: m[1].trim(),
        finding: true,
        keepUnmatched: true,
      });
    for (const m of sentence.matchAll(LOCATIVE_PHRASE)) {
      const place = sentence.slice(0, m.index).trim();
      if (place)
        found.push({
          text: sentence.slice(0, m.index + m[0].length).trim(),
          place,
          finding: STRONG_VERB.test(m[0]),
          keepUnmatched: STRONG_VERB.test(m[0]),
        });
    }
    for (const m of sentence.matchAll(BARE_PHRASE)) {
      const place = sentence.slice(0, m.index).trim();
      // `...에서 출토` is the locative phrase above
      if (place && !PARTICLE_END.test(place))
        found.push({
          text: sentence.slice(0, m.index + m[0].length).trim(),
          place,
          finding: true,
          keepUnmatched: false,
        });
    }
  }
  return found;
}

/**
 * Collect parent candidates for every ledger record from the attachment plan and the assembled ledger,
 * deterministically and without model calls (`relation-signals.v1`). Names are matched exactly (identifier
 * with name, longest name first), never by a kind hierarchy. A phrase whose place matches no record is kept
 * with no target, so it can be asked about rather than dropped. With an injected place alias table (validated
 * here; errors throw `PlaceAliasValidationError`), such a place, or a table cell, is retried through the
 * table's rules: one matching record becomes the target and the signal keeps the rule as `alias`. Records
 * registered under a written form get no parent from the rules and are listed in `aliasDuplicates`.
 */
export function collectRelationSignals(
  plan: ContentAttachmentPlan,
  ledger: ArchaeologyLedgerResult,
  options: { placeAliases?: PlaceAliasTable; placeAliasesSha256?: string } = {},
): RelationSignals {
  const aliases = options.placeAliases
    ? createPlaceAliasResolver(plan, ledger, options.placeAliases, {
        sha256: options.placeAliasesSha256,
      })
    : null;
  const recordOf = (groupId: string) => `record-${groupId}`;
  const kindOf = new Map(
    plan.registry.map((e) => [recordOf(e.groupId), e.recordKind]),
  );
  const { indexes, named } = createRecordNamer(plan);
  const nearest = createNearestRecords(plan);

  // reading order of every text and table cell in the plan, with its chapter
  const order = new Map<string, { index: number; chapterId?: string }>();
  const resources = new Map<string, TextSource>();
  for (const unit of plan.units)
    for (const { resource } of unit.sources)
      if (!order.has(resource.key)) {
        order.set(resource.key, {
          index: order.size,
          chapterId: resource.chapterIds.at(-1),
        });
        resources.set(resource.key, resource);
      }
  // headings: short non-sentence blocks; a heading belongs to a record when the record is registered by it
  // and it names the record, or when it is a numbered heading whose title is exactly one record's name
  const isShort = (text: string) =>
    norm(text).length <= HEADING_MAX_CHARS && !/다\.?$/.test(text.trim());
  const headingOwner = new Map<string, string>();
  for (const entry of plan.registry)
    for (const m of entry.mentions)
      for (const e of m.evidence) {
        const r = resources.get(e.resourceKey);
        if (
          r?.kind === 'text' &&
          isShort(r.data.text) &&
          norm(e.quote).length * 2 >= norm(r.data.text).length &&
          FORMS.some((form) =>
            aliasesOf(entry, form).some((a) => form(r.data.text).includes(a)),
          )
        )
          headingOwner.set(r.key, recordOf(entry.groupId));
      }
  for (const r of resources.values()) {
    if (r.kind !== 'text' || headingOwner.has(r.key)) continue;
    if (!isShort(r.data.text) || !GENERIC_HEADING.test(r.data.text)) continue;
    const owners = named(headingTitle(r.data.text));
    if (owners.length === 1) headingOwner.set(r.key, owners[0]);
  }
  const headings = [...resources.values()]
    .filter(
      (r) =>
        r.kind === 'text' &&
        (headingOwner.has(r.key) ||
          (isShort(r.data.text) && GENERIC_HEADING.test(r.data.text))),
    )
    .map((r) => ({
      key: r.key,
      text: r.data.text,
      ...order.get(r.key)!,
      pdfPageNo: r.pdfPageNo,
      owner: headingOwner.get(r.key),
    }));

  const records = plan.registry.map((entry) => {
    const recordId = recordOf(entry.groupId);
    const kind = entry.recordKind;
    const signals: RelationSignal[] = [];
    const seen = new Set<string>();
    for (const source of ledger.sources) {
      if (source.recordId !== recordId) continue;
      for (const p of phrasesOf(source.excerpt)) {
        const key = `${source.locator}|${p.text}`;
        const matched = matchPlace(p.place, indexes, recordId, nearest);
        if (!matched) continue;
        let targets = matched;
        // a person-decided correspondence is tried only for a place no record name matched
        const alias = targets.length
          ? null
          : (aliases?.resolve(p.place, recordId) ?? null);
        if (alias?.recordIds.length === 1) targets = alias.recordIds;
        if (seen.has(key) || (!targets.length && !p.keepUnmatched && !alias))
          continue;
        seen.add(key);
        signals.push({
          kind: 'phrase',
          targetRecordIds: targets,
          text: p.text,
          place: p.place,
          finding: p.finding,
          ...(alias ? { alias } : {}),
          sourceId: source.id,
          locator: source.locator,
          pdfPageNo: source.pdfPageNo,
        });
      }
    }
    const evidence = entry.mentions.flatMap((m) => m.evidence);
    for (const e of evidence) {
      const r = resources.get(e.resourceKey);
      if (r?.kind !== 'tableCell') continue;
      const rowPrefix = e.resourceKey.replace(/\/\d+$/, '/');
      for (const [key, cell] of resources) {
        if (!key.startsWith(rowPrefix) || key === e.resourceKey) continue;
        // a same-kind record in the row is a sibling or the same object, not a container
        let targets = named(cell.data.text).filter(
          (id) => id !== recordId && kindOf.get(id) !== kind,
        );
        const alias = targets.length
          ? null
          : (aliases?.resolve(cell.data.text, recordId) ?? null);
        if (alias?.recordIds.length === 1)
          targets = alias.recordIds.filter((id) => kindOf.get(id) !== kind);
        if (targets.length && !seen.has(key)) {
          seen.add(key);
          const header = resources.get(
            key.replace(/\/grid\/\d+\/(\d+)$/, '/grid/0/$1'),
          )?.data.text;
          signals.push({
            kind: 'table_row',
            targetRecordIds: targets,
            text: cell.data.text,
            locator: key,
            pdfPageNo: cell.pdfPageNo,
            ...(header ? { header } : {}),
            finding: MEMBERSHIP_HEADER.test(header ?? ''),
            ...(alias ? { alias } : {}),
          });
        }
      }
    }
    // the heading the record's first text falls under, skipping its own and same-kind sibling headings
    const positions = evidence.flatMap((e) => order.get(e.resourceKey) ?? []);
    if (positions.length) {
      const first = positions.reduce((a, b) => (b.index < a.index ? b : a));
      const governing = headings
        .filter(
          (h) =>
            h.index < first.index &&
            h.chapterId === first.chapterId &&
            h.owner !== recordId &&
            !(h.owner && kindOf.get(h.owner) === kind),
        )
        .at(-1);
      if (governing?.owner)
        signals.push({
          kind: 'heading_scope',
          targetRecordIds: [governing.owner],
          text: governing.text,
          locator: governing.key,
          pdfPageNo: governing.pdfPageNo,
        });
    }
    // only the record's own chapter; a chapter named after the record's own kind is a classification
    // heading (4) 수혈), not a container
    const chapter = entry.mentions[0].chapterPath.at(-1);
    const targets = chapter
      ? named(headingTitle(chapter.originTitle)).filter(
          (id) => id !== recordId && kindOf.get(id) !== kind,
        )
      : [];
    if (targets.length)
      signals.push({
        kind: 'chapter_title',
        targetRecordIds: targets,
        text: chapter!.originTitle,
        chapterId: chapter!.id,
      });
    return { recordId, signals };
  });
  return {
    version: RELATION_SIGNALS_VERSION,
    candidateSnapshotId: plan.candidateSnapshotId,
    records,
    ...(aliases
      ? { placeAliases: aliases.summary, aliasDuplicates: aliases.duplicates }
      : {}),
  };
}
