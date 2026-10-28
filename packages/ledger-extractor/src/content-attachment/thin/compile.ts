import type { AttachmentUnit, ContentAttachmentPlan } from '../types';
import type {
  ContentAttachmentThinCell,
  ContentAttachmentThinCompilation,
  ContentAttachmentThinInput,
  ContentAttachmentThinSegmentSpan,
  ContentAttachmentThinWindow,
  WindowRow,
} from './compile-types';

import { createContentAttachmentGroundedInput } from '../grounding';
import {
  collectiveHandles,
  isContentAttachmentThinTrivialText,
  offeredCandidates,
  sentenceSpans,
  wordOffsets,
} from './compile-candidates';
import {
  CONTENT_ATTACHMENT_THIN_COMPILE_VERSION,
  CONTENT_ATTACHMENT_THIN_LINKED_COMPILE_VERSION,
  CONTENT_ATTACHMENT_THIN_LOCAL_COMPILE_VERSION,
  CONTENT_ATTACHMENT_THIN_LOCAL_LINKED_COMPILE_VERSION,
  CONTENT_ATTACHMENT_THIN_WINDOW_WORDS,
} from './compile-types';
import {
  cellRegisteredCandidates,
  createContentAttachmentThinRowOwners,
} from './row-owners';

/**
 * Compile one attachment unit into the thin per-unit model input and its code-only map.
 * Deterministic and offline: prefiltered candidates, collective handles, Q/L word windows,
 * sentence segments in Q/L, original reading order, captions and code-assigned table rows. Under the plan's
 * `trivial: 'code'` policy, trivial segments stay readable in their windows but are decided by code as
 * describing no candidate and are not listed for the model.
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

  const trivialByCode = plan.thinPolicy?.trivial === 'code';
  const segments: string[] = [];
  const codeNone: string[] = [];
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
      const spans = sentenceSpans(words).flatMap(([a, b], i) => {
        const seg = `${ref}:S${i + 1}`;
        const charStart = off[a][0];
        const charEnd = off[b][1];
        const trivial =
          trivialByCode &&
          isContentAttachmentThinTrivialText(
            r.data.text.slice(charStart, charEnd),
          );
        segSpans.push({ seg, key: r.key, charStart, charEnd, llm: !trivial });
        if (trivial) {
          codeNone.push(seg);
          return [];
        }
        segments.push(seg);
        return [
          [seg, wordSpanToRanges(ref, a + 1, b + 1)] as [string, string[]],
        ];
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
      const trivial =
        !owner && trivialByCode && isContentAttachmentThinTrivialText(text);
      segSpans.push({
        seg,
        key: r.key,
        charStart: off[0][0],
        charEnd: off.at(-1)![1],
        llm: !owner && !trivial,
        owner,
        codeTargets,
      });
      if (owner) {
        cell.rowOwner = owner;
        if (registered.length) cell.registeredInCell = registered;
        codeAssigned.push([seg, ...codeTargets] as [string, ...string[]]);
      } else if (trivial) codeNone.push(seg);
      else {
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

  const readOnly: Array<{
    ref: string;
    key: string;
    windows: WindowRow[];
    evidenceOf?: string[];
  }> = unit.readOnlyContext.map((c, i) => ({
    ref: `X${i + 1}`,
    key: c.resourceKey,
    windows: toWindows(`X${i + 1}`, c.text).rows,
  }));
  const linked = plan.thinPolicy?.continuity === 'linked';
  const preceding = linked ? precedingContext(plan, unit, readOnly) : [];
  for (const block of preceding) {
    const refs = plan.registry
      .filter(
        (r) =>
          offered.has(r.ref) &&
          r.mentions.some((m) =>
            m.evidence.some((e) => e.resourceKey === block.key),
          ),
      )
      .map((r) => r.ref);
    if (refs.length) block.evidenceOf = refs;
  }
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

  let bodySequences = [...sequences.values()].map((items) =>
    items.sort((a, b) => a.index - b.index).map((x) => x.ref),
  );
  const sequenceOf = (key: string) => key.replace(/\/textBlocks\/\d+$/, '');
  // a page break can fall where the source document starts a new chapter: keep reading order across it
  if (
    preceding.length &&
    sequenceOf(preceding.at(-1)!.key) !==
      sequenceOf(unit.sources[0].resource.key)
  ) {
    const moved = new Set(preceding.map((b) => b.ref));
    bodySequences = bodySequences
      .map((refs) => refs.filter((ref) => !moved.has(ref)))
      .filter((refs) => refs.length)
      .map((refs) =>
        refs.includes('E1') ? [...preceding.map((b) => b.ref), ...refs] : refs,
      );
  }
  const local = plan.thinPolicy?.layers === 'local';

  return {
    version: linked
      ? local
        ? CONTENT_ATTACHMENT_THIN_LOCAL_LINKED_COMPILE_VERSION
        : CONTENT_ATTACHMENT_THIN_LINKED_COMPILE_VERSION
      : local
        ? CONTENT_ATTACHMENT_THIN_LOCAL_COMPILE_VERSION
        : CONTENT_ATTACHMENT_THIN_COMPILE_VERSION,
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
      bodySequences,
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
      readOnlyContext: readOnly.map(({ ref, windows: w, evidenceOf }) => ({
        ref,
        windows: w,
        ...(evidenceOf ? { evidenceOf } : {}),
      })),
    },
    codeMap: {
      unitId: unit.unitId,
      segments,
      candidateRefs: [...offered],
      windows,
      codeAssigned,
      ...(trivialByCode ? { codeNone } : {}),
      segSpans,
      rowBindings,
      handles: handles.map((h) => ({ ref: h.ref, members: h.members })),
    },
  };
}

/**
 * Read-only blocks that directly precede the unit's first body block in document order: the last text sources
 * of earlier units, as far back as the context runs without a gap. Empty when the unit does not start with a
 * text block or its immediate predecessor is not in the context.
 */
function precedingContext<T extends { key: string }>(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
  readOnly: T[],
): T[] {
  if (unit.sources[0]?.resource.kind !== 'text') return [];
  const at = plan.units.findIndex((u) => u.unitId === unit.unitId);
  const earlier = plan.units
    .slice(0, at)
    .flatMap((u) =>
      u.sources.flatMap((s) =>
        s.resource.kind === 'text' ? [s.resource.key] : [],
      ),
    );
  const byKey = new Map(readOnly.map((b) => [b.key, b]));
  const run: T[] = [];
  for (let i = earlier.length - 1; i >= 0 && byKey.has(earlier[i]); i--)
    run.unshift(byKey.get(earlier[i])!);
  return run;
}
