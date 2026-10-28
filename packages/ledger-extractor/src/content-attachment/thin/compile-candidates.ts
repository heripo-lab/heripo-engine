import type {
  AttachmentRegistryEntry,
  AttachmentUnit,
  ContentAttachmentPlan,
} from '../types';
import type { ContentAttachmentThinHandle, Words } from './compile-types';

import {
  ALWAYS_OFFERED_KINDS,
  CONTENT_ATTACHMENT_THIN_CHAPTER_MEMBER_LIMIT,
} from './compile-types';

export const norm = (s: string | null | undefined) =>
  (s ?? '').replace(/\s+/g, '');
export const titleCore = (title: string) =>
  norm(
    title.replace(/^\s*(?:[IVXⅠ-Ⅻ]+\.|[0-9]+[.)]|\([0-9]+\)|[A-Z]\.)\s*/, ''),
  );
export const wordOffsets = (text: string) =>
  [...text.matchAll(/\S+/g)].map((m) => [m.index, m.index + m[0].length]);

const TRIVIAL_NUMBER = /^[\d\s,.~\-–—()%×x:/]*\d[\d\s,.~\-–—()%×x:/]*$/;
const TRIVIAL_DATE = /^(?:\d{4}년\s*)?\d{1,2}월\s*\d{1,2}일$/;
/** A trailing weekday (`(토)`, `(토요일)`) or duration (`(60분)`, `(2시간)`) of a log entry's date or time. */
const TRIVIAL_SUFFIX =
  /\s*\(\s*(?:[월화수목금토일](?:요일)?|\d+\s*(?:분|시간))\s*\)$/;
const TRIVIAL_LABEL = /^(?:사진|도면|도판|표|그림|삽도|원색사진)\s*\d/;
const SENTENCE_END = /(?:다|음|임|함|됨)\s*[.。]?$|[.。!?]$/;
/** Longest figure, photo, plate or table label treated as a caption rather than body text. */
export const CONTENT_ATTACHMENT_THIN_TRIVIAL_LABEL_MAX_LENGTH = 120;

/**
 * Whether a segment's text describes no candidate on its face: only numbers (page numbers, table counts,
 * clock times and measurements without units), a date, either with a trailing weekday or duration as survey
 * log tables write them (`2023년8월19일(토)`, `14:30~15:30(60분)`), or a short figure, photo, plate or table
 * label that does not end like a sentence. A label sentence such as "표 3에서 보듯이 … 확인된다." is left to the model.
 */
export function isContentAttachmentThinTrivialText(text: string): boolean {
  const t = text.trim();
  const bare = t.replace(TRIVIAL_SUFFIX, '');
  if (TRIVIAL_NUMBER.test(bare) || TRIVIAL_DATE.test(bare)) return true;
  return (
    TRIVIAL_LABEL.test(t) &&
    !SENTENCE_END.test(t) &&
    t.length <= CONTENT_ATTACHMENT_THIN_TRIVIAL_LABEL_MAX_LENGTH
  );
}

/** Split words into sentences at terminal punctuation, ignoring list numbers such as "29.". */
export function sentenceSpans(words: Words): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let start = 0;
  words.forEach((w, i) => {
    if ((/[.?!]$/.test(w) && !/^[0-9]+\.$/.test(w)) || i === words.length - 1) {
      spans.push([start, i]);
      start = i + 1;
    }
  });
  return spans;
}

/**
 * Offer document-wide kinds, literal name-and-number matches, and same-chapter numbers present in the unit.
 * Under the plan's `local` layer policy a single-unit layer is offered only in its unit and in the units next to
 * it that share its evidence chapter.
 */
export function offeredCandidates(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
): Set<string> {
  const unitText = norm(
    [
      ...unit.sources.map((s) => s.resource.data.text),
      ...unit.readOnlyContext.map((c) => c.text),
      ...unit.tables.map((t) => t.data.caption?.fullText ?? ''),
    ].join('\n'),
  );
  const leaves = new Set(unit.chapters.map((c) => c.chapterId));
  const keep = (r: AttachmentRegistryEntry) =>
    ALWAYS_OFFERED_KINDS.has(r.recordKind) ||
    r.mentions.some((m) => {
      const id = norm(m.sourceIdentifier);
      const name = norm(m.sourceName);
      if (!id) return name.length >= 2 && unitText.includes(name);
      if (unitText.includes(id) && unitText.includes(name)) return true;
      return (
        unitText.includes(id) && m.chapterPath.some((c) => leaves.has(c.id))
      );
    });
  const chapterMembers = new Map<
    string,
    { title: string; refs: Set<string> }
  >();
  for (const r of plan.registry)
    for (const m of r.mentions)
      for (const c of m.chapterPath) {
        const entry = chapterMembers.get(c.id) ?? {
          title: c.originTitle,
          refs: new Set<string>(),
        };
        entry.refs.add(r.ref);
        chapterMembers.set(c.id, entry);
      }
  const offered = new Set(plan.registry.filter(keep).map((r) => r.ref));
  for (const { title, refs } of chapterMembers.values()) {
    const core = titleCore(title);
    if (
      core.length >= 2 &&
      unitText.includes(core) &&
      refs.size <= CONTENT_ATTACHMENT_THIN_CHAPTER_MEMBER_LIMIT
    )
      for (const ref of refs) offered.add(ref);
  }
  const far = new Set<string>();
  if (plan.thinPolicy?.layers === 'local') {
    const at = plan.units.findIndex((u) => u.unitId === unit.unitId);
    const paths = unit.chapters.map((c) => c.path.map((x) => x.id));
    const entries = new Map(plan.registry.map((r) => [r.ref, r]));
    for (const [ref, home] of localLayerHomes(plan))
      if (
        Math.abs(home - at) > 1 ||
        (home !== at && !layerInChapters(entries.get(ref)!, paths))
      )
        far.add(ref);
  }
  return new Set(
    plan.registry
      .filter((r) => offered.has(r.ref) && !far.has(r.ref))
      .map((r) => r.ref),
  );
}

/**
 * Whether a layer belongs to any of the given chapter paths: one of its mentions lies in a chapter on a path
 * (the chapter itself or an ancestor). A mention without a chapter, or no paths at all, matches everywhere.
 */
export function layerInChapters(
  layer: AttachmentRegistryEntry,
  paths: string[][],
): boolean {
  if (!paths.length) return true;
  return layer.mentions.some((m) => {
    const leaf = m.chapterPath.at(-1)?.id;
    return !leaf || paths.some((p) => p.includes(leaf));
  });
}

/**
 * Layers whose evidence lies in exactly one unit, with that unit's index. Layers with evidence in several
 * units, or in none, are report-wide and stay offered everywhere.
 */
export function localLayerHomes(plan: ContentAttachmentPlan) {
  const unitOf = new Map<string, number>();
  plan.units.forEach((u, i) =>
    u.sources.forEach((s) => unitOf.set(s.resource.key, i)),
  );
  const homes = new Map<string, number>();
  for (const r of plan.registry.filter((x) => x.recordKind === 'layer')) {
    const units = new Set(
      r.mentions.flatMap((m) =>
        m.evidence.flatMap((e) =>
          unitOf.has(e.resourceKey) ? [unitOf.get(e.resourceKey)!] : [],
        ),
      ),
    );
    if (units.size === 1) homes.set(r.ref, [...units][0]);
  }
  return homes;
}

/** One handle per chapter node and record kind, in registry traversal order. */
export function collectiveHandles(
  plan: ContentAttachmentPlan,
): ContentAttachmentThinHandle[] {
  const handles = new Map<
    string,
    {
      path: string[];
      kind: AttachmentRegistryEntry['recordKind'];
      members: Set<string>;
    }
  >();
  for (const r of plan.registry)
    for (const m of r.mentions)
      m.chapterPath.forEach((c, i) => {
        const key = `${c.id}|${r.recordKind}`;
        const handle = handles.get(key) ?? {
          path: m.chapterPath.slice(0, i + 1).map((x) => x.originTitle),
          kind: r.recordKind,
          members: new Set<string>(),
        };
        handle.members.add(r.ref);
        handles.set(key, handle);
      });
  return [...handles.values()].map((h, i) => ({
    ref: `H${i + 1}`,
    path: h.path,
    kind: h.kind,
    members: [...h.members],
  }));
}
