import type {
  AttachmentRegistryEntry,
  AttachmentUnit,
  ContentAttachmentPlan,
} from '../content-attachment';
import type { ContentAttachmentThinRowBinding } from './row-owners';

import { createContentAttachmentGroundedInput } from '../grounding';
import {
  cellRegisteredCandidates,
  createContentAttachmentThinRowOwners,
} from './row-owners';

export const CONTENT_ATTACHMENT_THIN_COMPILE_VERSION =
  'content-attachment-thin-compile.v1' as const;

/** Maximum original words addressed by one Q window. */
export const CONTENT_ATTACHMENT_THIN_WINDOW_WORDS = 16;
/** A chapter whose title core appears in the unit contributes all its candidates up to this size. */
export const CONTENT_ATTACHMENT_THIN_CHAPTER_MEMBER_LIMIT = 30;

/** Kinds that are document-wide referents and are always offered. */
const ALWAYS_OFFERED_KINDS = new Set<AttachmentRegistryEntry['recordKind']>([
  'area',
  'trench',
  'layer',
]);

type Words = string[];
type WindowRow = [string, Words];
type CandidateRow = ReturnType<
  typeof createContentAttachmentGroundedInput
>['payload']['candidates'][number];

export interface ContentAttachmentThinWindow {
  ref: string;
  sourceRef: string;
  originalWords: string[];
}
export interface ContentAttachmentThinSegmentSpan {
  seg: string;
  key: string;
  charStart: number;
  charEnd: number;
  llm: boolean;
  owner?: string | null;
  /** Table cells only: the row owner followed by candidates registered from the cell. */
  codeTargets?: string[];
}
export interface ContentAttachmentThinHandle {
  ref: string;
  path: string[];
  kind: AttachmentRegistryEntry['recordKind'];
  members: string[];
}
export interface ContentAttachmentThinCell {
  ref: string;
  header: boolean;
  windows: WindowRow[];
  rowOwner?: string;
  registeredInCell?: string[];
  segments?: Array<[string, string[]]>;
}
export interface ContentAttachmentThinInput {
  candidateColumns: string[];
  contexts: Record<string, string[]>;
  candidates: CandidateRow[];
  uncertainties: Array<{ refs: string[]; reason: string }>;
  handleColumns: ['ref', 'chapterPath', 'kind', 'memberCount'];
  handles: Array<[string, string, string, number]>;
  chapters: string[];
  bodyBlocks: Array<{
    ref: string;
    windows: WindowRow[];
    segments: Array<[string, string[]]>;
  }>;
  bodySequences: string[][];
  tableLocations: Array<{
    ref: string;
    pdfPage: number;
    rowCount: number;
    captionRef: string | null;
  }>;
  tables: Array<{
    ref: string;
    rows: Array<{ index: number; cells: ContentAttachmentThinCell[] }>;
  }>;
  readOnlyContext: Array<{ ref: string; windows: WindowRow[] }>;
}
export interface ContentAttachmentThinCodeMap {
  unitId: string;
  /** Segments the model must judge, in input order. */
  segments: string[];
  /** Candidate refs offered to the model after prefiltering. */
  candidateRefs: string[];
  windows: ContentAttachmentThinWindow[];
  /** [segment, row owner, ...candidates registered from the cell] */
  codeAssigned: Array<[string, ...string[]]>;
  segSpans: ContentAttachmentThinSegmentSpan[];
  rowBindings: ContentAttachmentThinRowBinding[];
  handles: Array<{ ref: string; members: string[] }>;
}
export interface ContentAttachmentThinCompilation {
  version: typeof CONTENT_ATTACHMENT_THIN_COMPILE_VERSION;
  input: ContentAttachmentThinInput;
  codeMap: ContentAttachmentThinCodeMap;
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '');
const titleCore = (title: string) =>
  norm(
    title.replace(/^\s*(?:[IVXⅠ-Ⅻ]+\.|[0-9]+[.)]|\([0-9]+\)|[A-Z]\.)\s*/, ''),
  );
const wordOffsets = (text: string) =>
  [...text.matchAll(/\S+/g)].map((m) => [m.index, m.index + m[0].length]);

/** Split words into sentences at terminal punctuation, ignoring list numbers such as "29.". */
function sentenceSpans(words: Words): Array<[number, number]> {
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

/** Offer document-wide kinds, literal name-and-number matches, and same-chapter numbers present in the unit. */
function offeredCandidates(
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
  return new Set(
    plan.registry.filter((r) => offered.has(r.ref)).map((r) => r.ref),
  );
}

/** One handle per chapter node and record kind, in registry traversal order. */
function collectiveHandles(
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

/**
 * Compile one attachment unit into the thin per-unit model input and its code-only map.
 * Deterministic and offline: prefiltered candidates, collective handles, Q/L word windows,
 * sentence segments in Q/L, original reading order, captions and code-assigned table rows.
 */
export function createContentAttachmentThinInput(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
): ContentAttachmentThinCompilation {
  const grounded = createContentAttachmentGroundedInput(plan, unit).payload;
  const offered = offeredCandidates(plan, unit);
  const candidates = grounded.candidates.filter((row) =>
    offered.has(row[0] as string),
  );
  const usedContexts = new Set(candidates.map((row) => row[2] as string));
  const contexts = Object.fromEntries(
    Object.entries(grounded.contexts).filter(([ref]) => usedContexts.has(ref)),
  );
  const uncertainties = grounded.uncertainties.filter((u) =>
    u.refs.some((r) => offered.has(r)),
  );
  const handles = collectiveHandles(plan);

  const windows: ContentAttachmentThinWindow[] = [];
  const toWindows = (sourceRef: string, text: string) => {
    const words = text.split(/\s+/).filter(Boolean);
    const rows: WindowRow[] = [];
    for (
      let i = 0;
      i < words.length;
      i += CONTENT_ATTACHMENT_THIN_WINDOW_WORDS
    ) {
      const ref = `Q${windows.length + 1}`;
      const slice = words.slice(i, i + CONTENT_ATTACHMENT_THIN_WINDOW_WORDS);
      windows.push({
        ref,
        sourceRef,
        originalWords: slice.map((_, j) => `W${i + j + 1}`),
      });
      rows.push([ref, slice]);
    }
    return { words, rows };
  };
  const wordSpanToRanges = (sourceRef: string, a: number, b: number) => {
    const ranges: string[] = [];
    let offset = 0;
    for (const w of windows.filter((x) => x.sourceRef === sourceRef)) {
      const lo = offset + 1;
      const hi = offset + w.originalWords.length;
      const s0 = Math.max(a, lo);
      const s1 = Math.min(b, hi);
      if (s0 <= s1) ranges.push(`${w.ref}:L${s0 - offset}-L${s1 - offset}`);
      offset = hi;
    }
    return ranges;
  };

  const { owners, rowBindings } = createContentAttachmentThinRowOwners(
    plan,
    unit,
  );

  const segments: string[] = [];
  const codeAssigned: Array<[string, ...string[]]> = [];
  const segSpans: ContentAttachmentThinSegmentSpan[] = [];
  const bodyBlocks: ContentAttachmentThinInput['bodyBlocks'] = [];
  const tableRows = new Map<string, Map<number, ContentAttachmentThinCell[]>>();
  unit.sources.forEach((s, idx) => {
    const ref = `E${idx + 1}`;
    const r = s.resource;
    const text = r.data.text.trim();
    if (r.kind === 'text') {
      const { words, rows } = toWindows(ref, text);
      const off = wordOffsets(r.data.text);
      const spans = sentenceSpans(words).map(([a, b], i) => {
        const seg = `${ref}:S${i + 1}`;
        segments.push(seg);
        segSpans.push({
          seg,
          key: r.key,
          charStart: off[a][0],
          charEnd: off[b][1],
          llm: true,
        });
        return [seg, wordSpanToRanges(ref, a + 1, b + 1)] as [string, string[]];
      });
      bodyBlocks.push({ ref, windows: rows, segments: spans });
      return;
    }
    const table = unit.tables.find((t) => t.data.id === r.tableId)!;
    const tableRef = `T${unit.tables.indexOf(table) + 1}`;
    const rows = tableRows.get(tableRef) ?? new Map();
    tableRows.set(tableRef, rows);
    const { rows: cellWindows } = toWindows(ref, text);
    const owner = owners.get(r.key) ?? null;
    const registered = owner
      ? cellRegisteredCandidates(plan, r.key, owner)
      : [];
    const codeTargets = owner ? [owner, ...registered] : [];
    const cell: ContentAttachmentThinCell = {
      ref,
      header: r.data.isHeader,
      windows: cellWindows,
    };
    if (!r.data.isHeader && text) {
      const off = wordOffsets(r.data.text);
      const seg = `${ref}:S1`;
      segSpans.push({
        seg,
        key: r.key,
        charStart: off[0][0],
        charEnd: off.at(-1)![1],
        llm: !owner,
        owner,
        codeTargets,
      });
      if (owner) {
        cell.rowOwner = owner;
        if (registered.length) cell.registeredInCell = registered;
        codeAssigned.push([seg, ...codeTargets] as [string, ...string[]]);
      } else {
        segments.push(seg);
        cell.segments = [
          [seg, cellWindows.map(([q, ws]) => `${q}:L1-L${ws.length}`)],
        ];
      }
    }
    const cells = rows.get(r.rowIndex) ?? [];
    cells.push(cell);
    rows.set(r.rowIndex, cells);
  });

  const readOnly = unit.readOnlyContext.map((c, i) => ({
    ref: `X${i + 1}`,
    key: c.resourceKey,
    windows: toWindows(`X${i + 1}`, c.text).rows,
  }));
  const captionRefs = new Map<string, string>();
  for (const t of unit.tables) {
    const caption = t.data.caption?.fullText;
    if (!caption) continue;
    const ref = `X${readOnly.length + 1}`;
    readOnly.push({
      ref,
      key: `${t.key}/caption`,
      windows: toWindows(ref, caption).rows,
    });
    captionRefs.set(t.key, ref);
  }

  const sequences = new Map<string, Array<{ ref: string; index: number }>>();
  const blocks = [
    ...unit.sources.flatMap((s, i) =>
      s.resource.kind === 'text'
        ? [{ ref: `E${i + 1}`, key: s.resource.key }]
        : [],
    ),
    ...readOnly,
  ];
  for (const b of blocks) {
    const match = b.key.match(/^(.*)\/textBlocks\/(\d+)$/);
    if (!match) continue;
    const items = sequences.get(match[1]) ?? [];
    items.push({ ref: b.ref, index: Number(match[2]) });
    sequences.set(match[1], items);
  }

  return {
    version: CONTENT_ATTACHMENT_THIN_COMPILE_VERSION,
    input: {
      candidateColumns: grounded.columns,
      contexts,
      candidates,
      uncertainties,
      handleColumns: ['ref', 'chapterPath', 'kind', 'memberCount'],
      handles: handles.map((h) => [
        h.ref,
        h.path.join(' > '),
        h.kind,
        h.members.length,
      ]),
      chapters: unit.chapters.map((c) =>
        c.path.map((p) => p.originTitle).join(' > '),
      ),
      bodyBlocks,
      bodySequences: [...sequences.values()].map((items) =>
        items.sort((a, b) => a.index - b.index).map((x) => x.ref),
      ),
      tableLocations: unit.tables.map((t, i) => ({
        ref: `T${i + 1}`,
        pdfPage: t.data.pdfPageNo,
        rowCount: t.data.grid.length,
        captionRef: captionRefs.get(t.key) ?? null,
      })),
      tables: [...tableRows].map(([ref, rows]) => ({
        ref,
        rows: [...rows].map(([index, cells]) => ({ index, cells })),
      })),
      readOnlyContext: readOnly.map(({ ref, windows: w }) => ({
        ref,
        windows: w,
      })),
    },
    codeMap: {
      unitId: unit.unitId,
      segments,
      candidateRefs: [...offered],
      windows,
      codeAssigned,
      segSpans,
      rowBindings,
      handles: handles.map((h) => ({ ref: h.ref, members: h.members })),
    },
  };
}
