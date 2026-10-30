import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { ArchaeologyLedgerResult } from '../ledger/archaeology-ledger';
import type { MediaCaptionEntry, MediaCaptionIndex } from './media-captions';
import type { MediaTextReference } from './media-references';

import { FORMS, aliasesOf } from '../relations/record-names';

export const CAPTION_REFERENCES_VERSION = 'caption-references.v1' as const;

/** Numbers a caption range may span; a wider span is ignored. */
const MAX_RANGE_SPAN = 60;
/** `11~20호 수혈`, `2-10호 수혈`: a numbered series of one kind of record. */
const NUMBER_RANGE = /(\d+)\s*[~∼-]\s*(\d+)\s*호\s*([가-힣]+)/g;
/** Words that follow a record name in a caption without being part of it. */
const CAPTION_TAIL =
  /(?:평면도|단면도|층위도|입면도|실측도|출토유물|유물|전경|근경|세부|토층|조사|및).*$/;
/** A particle ending the series noun: `1~4호 건물지와 주변` names `건물지`. */
const PARTICLE_END = /(?:와|과|의|에서|및)$/;
/** Parenthesized artifact numbers: `출토유물(24~28)`, `(46-50)`, `(32,33)`, `(20)`. */
const NUMBER_LIST = /\(\s*(\d+(?:\s*[~∼,·-]\s*\d+)*)\s*\)/g;

/** A caption naming a numbered record, or a numbered series of records, linking the record to the image. */
export interface MediaCaptionReference {
  recordId: string;
  imageId: string;
  /** The image's label, such as `도면 43`. */
  label: string;
  /** The caption text that names the record, as matched (spaces removed). */
  written: string;
  basis: 'caption_name' | 'caption_range';
}
/** How the artifact numbers a caption lists agree with the artifacts text references linked to it. */
export interface MediaArtifactNumberCheck {
  imageId: string;
  label: string;
  /** Numbers the caption lists in parentheses. */
  captionNumbers: string[];
  /** Artifacts linked by text references whose number the caption lists. */
  agreeing: string[];
  /** Artifacts linked by text references whose number the caption does not list. */
  disagreeing: string[];
}
export interface CaptionReferences {
  version: typeof CAPTION_REFERENCES_VERSION;
  references: MediaCaptionReference[];
  /** Captions naming several numbered records at once; not linked. */
  severalNamed: Array<{ imageId: string; recordIds: string[] }>;
  /** Series numbers that matched no record or several. */
  unresolvedRangeNumbers: Array<{ imageId: string; name: string }>;
  /** Only images with a number list and at least one artifact linked by text. */
  artifactNumberChecks: MediaArtifactNumberCheck[];
}

const norm = (text: string) => text.replace(/\s+/g, '');
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function expandList(list: string): string[] {
  const tokens = list.split(/\s*([~∼,·-])\s*/);
  const numbers: string[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const from = Number(numbers.at(-1));
    const to = Number(tokens[i]);
    if (
      /[~∼-]/.test(tokens[i - 1] ?? '') &&
      to > from &&
      to - from <= MAX_RANGE_SPAN
    )
      for (let n = from + 1; n < to; n++) numbers.push(String(n));
    numbers.push(tokens[i]);
  }
  return numbers;
}

/**
 * Link records to images through their captions (M2), deterministically and without model calls.
 * - A caption naming exactly one numbered record that is not an artifact (`도면 41 … 1호 수혈 평면도`) links
 *   it (`caption_name`). Names are matched exact form first, longest first, never right after a number or a
 *   range sign (`10호 수혈` inside `2-10호 수혈` is the series below). Unnumbered names such as `지점` or
 *   `도로유구` are not used: they name kinds as often as records.
 * - A numbered series (`11~20호 수혈`) links each numbered record of that name (`caption_range`).
 * - A record is out of a caption's section when the caption, before the name, uses a chapter-title word its own chapter titles
 *   lack while other records of its kind have it (`조선시대` against a 삼국 pit); numbering restarts across
 *   sections. Among the rest the exact name form, then the image's chapter, decides; otherwise the name stays
 *   unresolved.
 * - Parenthesized artifact numbers (`출토유물(24~28)`) create no links; they check the artifacts text
 *   references linked to the same image.
 */
export function collectCaptionReferences(
  captions: MediaCaptionIndex,
  plan: ContentAttachmentPlan,
  ledger: ArchaeologyLedgerResult,
  textReferences: MediaTextReference[] = [],
): CaptionReferences {
  const kindOf = new Map(ledger.records.map((r) => [r.id, r.recordKind]));
  const identifierOf = new Map(
    ledger.records.map((r) => [r.id, r.sourceIdentifier]),
  );
  const chaptersOf = new Map(
    plan.registry.map((e) => [
      `record-${e.groupId}`,
      new Set(e.mentions.flatMap((m) => m.chapterPath.map((c) => c.id))),
    ]),
  );
  // names of numbered records, by form, exact first
  const numbered = plan.registry.filter((e) =>
    e.mentions.some((m) => m.sourceIdentifier),
  );
  const names = FORMS.map((form) => {
    const index = new Map<string, string[]>();
    for (const entry of numbered)
      for (const alias of aliasesOf(entry, form))
        index.set(alias, [
          ...(index.get(alias) ?? []),
          `record-${entry.groupId}`,
        ]);
    return { form, index };
  });
  // chapter-title words per record, and the kinds whose records have each word in their chapter titles
  const pathOf = new Map(
    plan.registry.map((e) => [
      `record-${e.groupId}`,
      norm(
        e.mentions
          .flatMap((m) => m.chapterPath.map((c) => c.originTitle))
          .join('|'),
      ),
    ]),
  );
  // words naming records of a kind (수혈, 건물지 for features) are names there, not section qualifiers
  const nameWords = new Map<string, Set<string>>();
  for (const e of plan.registry)
    for (const m of e.mentions)
      for (const word of m.sourceName.match(/[가-힣]{2,}/g) ?? [])
        nameWords.set(
          e.recordKind,
          (nameWords.get(e.recordKind) ?? new Set()).add(word),
        );
  const termKinds = new Map<string, Set<string>>();
  for (const e of plan.registry)
    for (const m of e.mentions)
      for (const c of m.chapterPath)
        for (const term of c.originTitle.match(/[가-힣]{2,}/g) ?? [])
          termKinds.set(
            term,
            (termKinds.get(term) ?? new Set()).add(e.recordKind),
          );
  /**
   * A record whose chapter titles lack a chapter-title word the caption uses before the name, while other
   * records of its kind have that word, belongs to another section: `조선시대 1~5호 수혈` is not the 삼국 1호
   * 수혈. Words after the name (`… 건물지와 주변 구상유구`) describe other things in the image.
   */
  const outOfSection = (id: string, caption: string) =>
    [...termKinds].some(
      ([term, kinds]) =>
        caption.includes(term) &&
        !pathOf.get(id)!.includes(term) &&
        kinds.has(kindOf.get(id)!) &&
        !nameWords.get(kindOf.get(id)!)!.has(term),
    );
  /**
   * Records a caption name means: both name forms, minus records of another section; then the exact form,
   * then the image's chapter, when several remain.
   */
  const named = (name: string, image: MediaCaptionEntry, caption: string) => {
    const byForm = names.map(({ form, index }) => index.get(form(name)) ?? []);
    let ids = [...new Set(byForm.flat())].filter(
      (id) => !outOfSection(id, caption),
    );
    const exact = ids.filter((id) => byForm[0].includes(id));
    if (ids.length > 1 && exact.length) ids = exact;
    const inChapter = ids.filter((id) =>
      image.chapterIds.some((c) => chaptersOf.get(id)?.has(c)),
    );
    return ids.length > 1 && inChapter.length ? inChapter : ids;
  };

  const references: MediaCaptionReference[] = [];
  const severalNamed: CaptionReferences['severalNamed'] = [];
  const unresolvedRangeNumbers: CaptionReferences['unresolvedRangeNumbers'] =
    [];
  const artifactNumberChecks: MediaArtifactNumberCheck[] = [];
  const linked = new Set<string>();
  const add = (
    recordId: string,
    image: MediaCaptionEntry,
    written: string,
    basis: MediaCaptionReference['basis'],
  ) => {
    if (linked.has(`${recordId}|${image.imageId}`)) return;
    linked.add(`${recordId}|${image.imageId}`);
    references.push({
      recordId,
      imageId: image.imageId,
      label: image.label,
      written,
      basis,
    });
  };

  for (const image of captions.entries) {
    const caption = image.captionText;
    // the caption without its own label, so `도면 1` is not read as part of a name
    const body = caption.replace(
      new RegExp(`^\\s*${escape(image.type)}\\s*${escape(image.number)}`),
      '',
    );
    for (const m of body.matchAll(NUMBER_RANGE)) {
      const from = Number(m[1]);
      const to = Number(m[2]);
      if (to <= from || to - from > MAX_RANGE_SPAN) continue;
      const noun =
        m[3].replace(CAPTION_TAIL, '').replace(PARTICLE_END, '') || m[3];
      for (let n = from; n <= to; n++) {
        const ids = named(`${n}호${noun}`, image, norm(body.slice(0, m.index)));
        if (ids.length === 1) add(ids[0], image, norm(m[0]), 'caption_range');
        else
          unresolvedRangeNumbers.push({
            imageId: image.imageId,
            name: `${n}호 ${noun}`,
          });
      }
    }
    for (const { form, index } of names) {
      const text = form(body);
      const hits: Array<{ alias: string; at: number; ids: string[] }> = [];
      for (const [alias, all] of index) {
        if (all.some((id) => kindOf.get(id) === 'artifact')) continue;
        for (
          let at = text.indexOf(alias);
          at >= 0;
          at = text.indexOf(alias, at + 1)
        ) {
          // a number or range sign before a numbered name makes it part of another number or a series
          if (/^\d/.test(alias) && /[\d~∼\-·,]/.test(text[at - 1] ?? ''))
            continue;
          const ids = all.filter(
            (id) => !outOfSection(id, norm(text.slice(0, at))),
          );
          if (ids.length) hits.push({ alias, at, ids });
        }
      }
      const longest = hits.filter(
        (h) =>
          !hits.some(
            (o) =>
              o !== h &&
              o.alias.length > h.alias.length &&
              o.at <= h.at &&
              o.at + o.alias.length >= h.at + h.alias.length,
          ),
      );
      if (!longest.length) continue;
      const ids = [...new Set(longest.flatMap((h) => h.ids))];
      if (ids.length === 1)
        add(ids[0], image, longest[0].alias, 'caption_name');
      else severalNamed.push({ imageId: image.imageId, recordIds: ids });
      break;
    }

    const listed = [...body.matchAll(NUMBER_LIST)].flatMap((m) =>
      expandList(m[1]),
    );
    const artifacts = [
      ...new Set(
        textReferences
          .filter(
            (r) =>
              r.imageId === image.imageId &&
              kindOf.get(r.recordId) === 'artifact',
          )
          .map((r) => r.recordId),
      ),
    ];
    if (listed.length && artifacts.length)
      artifactNumberChecks.push({
        imageId: image.imageId,
        label: image.label,
        captionNumbers: listed,
        agreeing: artifacts.filter((id) =>
          listed.includes(identifierOf.get(id) ?? ''),
        ),
        disagreeing: artifacts.filter(
          (id) => !listed.includes(identifierOf.get(id) ?? ''),
        ),
      });
  }
  return {
    version: CAPTION_REFERENCES_VERSION,
    references,
    severalNamed,
    unresolvedRangeNumbers,
    artifactNumberChecks,
  };
}
