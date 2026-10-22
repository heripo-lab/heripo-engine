import type { CandidateEvidence } from '../../candidates/candidate-discovery';
import type { ContentAttachmentSegmentationAudit } from '../recipients/segmentation';
import type {
  ContentAttachmentWordEvidenceSnapshot,
  ContentAttachmentWordSource,
} from '../recipients/word-evidence';
import type { AttachmentUnit, ContentAttachmentPlan } from '../types';

import { createContentAttachmentGroundedInput } from '../grounding';
import { createContentAttachmentRecipientRequest } from '../recipients/request';
import {
  contentAttachmentWordRows,
  resolveContentAttachmentWordRange,
} from '../recipients/word-evidence';

export const CONTENT_ATTACHMENT_SOURCE_CONTEXT_VERSION =
  'content-source-context.v1' as const;

export interface ContentAttachmentTableContextPair {
  precedingTableKey: string;
  followingTableKey: string;
  /** Native grid cell indexes to expose at the page boundary, never expanded columns. */
  boundaryCellIndexes: number[];
}
export interface ContentAttachmentSourceContextOptions {
  /** Explicit source selection only; supplying a pair does not establish continuation. */
  tablePairs?: ContentAttachmentTableContextPair[];
}
export interface ContentAttachmentSourceContextBinding {
  ref: string;
  resourceKey: string;
  field: 'text' | 'fullText';
  sourceRefs: string[];
  resourceId: string | null;
  pdfPageNo: number | null;
  logicalPageRange: CandidateEvidence['logicalPageRange'];
  charStart: number;
  charEnd: number;
  text: string;
}
interface SourceView {
  ref: string;
  text: string;
  words: string[][];
  kind: 'body' | 'tableCell' | 'tableCaption';
  contexts: string[];
  pdfPage: number | null;
  blockIndex?: number;
  tableCell?: [string, number, number];
  tableRef?: string;
}
interface TableView {
  ref: string;
  caption: string | null;
  rows: Array<{
    index: number;
    cells: Array<
      readonly [string | null, string | null, number, number, boolean]
    >;
  }>;
}

export type ContentAttachmentSourceContextRequest = ReturnType<
  typeof createContentAttachmentRecipientRequest
> & {
  contextVersion: typeof CONTENT_ATTACHMENT_SOURCE_CONTEXT_VERSION;
  wordEvidence: ContentAttachmentWordEvidenceSnapshot;
  contextBindings: {
    sources: ContentAttachmentSourceContextBinding[];
    tables: ReturnType<
      typeof createContentAttachmentGroundedInput
    >['codeMap']['tables'];
    headers: Array<{
      tableRef: string;
      resourceKey: string;
      rowIndex: number;
      cellIndex: number;
      text: string;
      rowSpan: number;
      colSpan: number;
      isHeader: boolean;
    }>;
  };
};

/** Compile an opt-in context view; preserve the v25 prompt/schema and historical request path. */
export function createContentAttachmentSourceContextRequest(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
  segmentation: ContentAttachmentSegmentationAudit,
  options: ContentAttachmentSourceContextOptions = {},
  recipientVersion:
    | 'segment-recipients.v25'
    | 'segment-recipients.v26' = 'segment-recipients.v25',
): ContentAttachmentSourceContextRequest {
  const input = createContentAttachmentGroundedInput(plan, unit);
  const legacy = createContentAttachmentRecipientRequest(
    input,
    segmentation,
    recipientVersion,
  );
  const payload = JSON.parse(legacy.userPrompt);
  const resources = new Map(
    plan.units
      .flatMap((u) => u.sources)
      .map((s) => [s.resource.key, s.resource]),
  );
  const allTables = new Map(
    plan.units.flatMap((u) => u.tables).map((t) => [t.key, t]),
  );
  const tableBindings = input.codeMap.tables.map((t) => ({ ...t }));
  const tables = payload.sourceContext.tables as TableView[];
  const bindings: ContentAttachmentSourceContextBinding[] = [];
  const wordSources = [...segmentation.wordEvidence.sources];
  const sources: SourceView[] = [];
  const contextRefs = (ids: string[]) =>
    Object.entries(input.codeMap.contextPaths)
      .filter(([, path]) => ids.includes(path.at(-1)!.id))
      .map(([ref]) => ref);
  const owners = (tableId: string) => [
    ...new Set(
      [...resources.values()]
        .filter((r) => r.kind === 'tableCell' && r.tableId === tableId)
        .flatMap((r) => r.chapterIds),
    ),
  ];
  const tableRef = (key: string) => {
    const table = allTables.get(key);
    if (!table) throw new Error('Unknown original context table');
    let binding = tableBindings.find((b) => b.table.key === key);
    if (!binding) {
      binding = { ref: `T${tableBindings.length + 1}`, table };
      tableBindings.push(binding);
    }
    if (!tables.some((t) => t.ref === binding!.ref)) {
      tables.push({
        ref: binding.ref,
        caption: table.data.caption?.fullText ?? null,
        rows: table.data.grid.flatMap((row, index) =>
          row.some((c) => c.isHeader)
            ? [
                {
                  index,
                  cells: row.map(
                    (c) =>
                      [null, c.text, c.rowSpan, c.colSpan, c.isHeader] as const,
                  ),
                },
              ]
            : [],
        ),
      });
    }
    return binding.ref;
  };
  const bodyGroups = new Map<
    string,
    Array<{ ref: string; index: number; contexts: string[] }>
  >();
  for (const source of wordSources) {
    const resource = resources.get(source.resourceKey);
    if (!resource) throw new Error('Unknown original context source');
    const evidence = source.evidence[0];
    const start = source.kind === 'excerpt' ? evidence.charStart : 0;
    const end =
      source.kind === 'excerpt' ? evidence.charEnd : resource.data.text.length;
    if (resource.data.text.slice(start, end) !== source.text)
      throw new Error('Context source differs from original text');
    bindings.push({
      ref: source.ref,
      resourceKey: resource.key,
      field: 'text',
      sourceRefs: resource.sourceRefs,
      resourceId: resource.resourceId,
      pdfPageNo: resource.pdfPageNo,
      logicalPageRange: resource.logicalPageRange,
      charStart: start,
      charEnd: end,
      text: source.text,
    });
    const originalTable =
      resource.kind === 'tableCell'
        ? [...allTables.values()].find((t) => t.data.id === resource.tableId)
        : undefined;
    if (
      resource.kind === 'tableCell' &&
      (!originalTable ||
        originalTable.data.grid[resource.rowIndex]?.[resource.columnIndex]
          ?.text !== resource.data.text)
    )
      throw new Error('Context cell differs from original table');
    if (segmentation.excerptRefs.includes(source.ref)) continue;
    const view: SourceView = {
      ref: source.ref,
      text: source.text,
      words: contentAttachmentWordRows(source),
      kind: resource.kind === 'text' ? 'body' : 'tableCell',
      contexts: contextRefs(resource.chapterIds),
      pdfPage: resource.pdfPageNo,
    };
    if (resource.kind === 'text') {
      const match = /^(.*)\/textBlocks\/(0|[1-9]\d*)$/.exec(resource.key);
      if (!match) throw new Error('Invalid original body array position');
      view.blockIndex = Number(match[2]);
      const group = bodyGroups.get(match[1]) ?? [];
      group.push({
        ref: source.ref,
        index: view.blockIndex,
        contexts: view.contexts,
      });
      bodyGroups.set(match[1], group);
    } else {
      view.tableCell = [
        tableRef(originalTable!.key),
        resource.rowIndex,
        resource.columnIndex,
      ];
    }
    sources.push(view);
  }
  let nextX =
    Math.max(
      0,
      ...wordSources
        .filter((s) => s.ref.startsWith('X'))
        .map((s) => Number(s.ref.slice(1))),
    ) + 1;
  const addSource = (tableKey: string, cell?: [number, number]) => {
    const table = allTables.get(tableKey)!;
    const data = cell
      ? table.data.grid[cell[0]]?.[cell[1]]
      : table.data.caption;
    if (!data) throw new Error('Missing original boundary cell or caption');
    const text = 'text' in data ? data.text : data.fullText;
    const key = cell
      ? `${table.key}/grid/${cell[0]}/${cell[1]}`
      : `${table.key}/caption`;
    const existing = wordSources.find(
      (s) => s.resourceKey === key && s.text === text,
    );
    if (existing) return existing.ref;
    const ref = `X${nextX++}`;
    const source: ContentAttachmentWordSource = {
      ref,
      originalRef: ref,
      kind: 'read_only',
      resourceKey: key,
      text,
      words: [...text.matchAll(/\S+/gu)].map((match, index) => ({
        ref: `W${index + 1}`,
        charStart: match.index,
        charEnd: match.index + match[0].length,
      })),
      evidence: [],
    };
    wordSources.push(source);
    sources.push({
      ref,
      text,
      words: contentAttachmentWordRows(source),
      kind: cell ? 'tableCell' : 'tableCaption',
      contexts: contextRefs(owners(table.data.id)),
      pdfPage: table.data.pdfPageNo,
      ...(cell
        ? {
            tableCell: [tableRef(tableKey), ...cell] as [
              string,
              number,
              number,
            ],
          }
        : { tableRef: tableRef(tableKey) }),
    });
    bindings.push({
      ref,
      resourceKey: key,
      field: cell ? 'text' : 'fullText',
      sourceRefs: cell
        ? table.data.sourceRef
          ? [table.data.sourceRef]
          : []
        : (table.data.captionSourceRefs ?? []),
      resourceId: cell ? null : table.data.id,
      pdfPageNo: table.data.pdfPageNo,
      logicalPageRange:
        [...resources.values()].find(
          (r) => r.kind === 'tableCell' && r.tableId === table.data.id,
        )?.logicalPageRange ?? null,
      charStart: 0,
      charEnd: text.length,
      text,
    });
    return ref;
  };
  const captions = new Map<string, string>();
  const seenPairs = new Set<string>();
  const tableContinuationCandidates = (options.tablePairs ?? []).map(
    (pair, index) => {
      if (
        pair.precedingTableKey === pair.followingTableKey ||
        seenPairs.has(
          JSON.stringify([pair.precedingTableKey, pair.followingTableKey]),
        ) ||
        new Set(pair.boundaryCellIndexes).size !==
          pair.boundaryCellIndexes.length ||
        pair.boundaryCellIndexes.some((c) => !Number.isInteger(c) || c < 0)
      )
        throw new Error('Invalid or duplicate table context pair');
      seenPairs.add(
        JSON.stringify([pair.precedingTableKey, pair.followingTableKey]),
      );
      const refs = [pair.precedingTableKey, pair.followingTableKey].map(
        tableRef,
      );
      const [preceding, following] = [
        pair.precedingTableKey,
        pair.followingTableKey,
      ].map((key) => allTables.get(key)!);
      for (const t of [preceding, following])
        if (t.data.caption) captions.set(t.key, addSource(t.key));
      const boundary = (table: typeof preceding, last: boolean) => {
        const rows = table.data.grid.flatMap((row, i) =>
          row.length && !row.some((c) => c.isHeader) ? [i] : [],
        );
        const row = last ? rows.at(-1) : rows[0];
        if (row === undefined) return [];
        return pair.boundaryCellIndexes.map((column) =>
          addSource(table.key, [row, column]),
        );
      };
      const headers = (table: typeof preceding) =>
        table.data.grid
          .filter((row) => row.some((c) => c.isHeader))
          .map((row) =>
            row.map((c) => [c.text, c.rowSpan, c.colSpan, c.isHeader]),
          );
      return {
        ref: `L${index + 1}`,
        tables: refs,
        judgment: 'not_evaluated' as const,
        facts: {
          adjacentPdfPages:
            preceding.data.pdfPageNo + 1 === following.data.pdfPageNo,
          sameOriginalChapter: owners(preceding.data.id).some((id) =>
            owners(following.data.id).includes(id),
          ),
          headerCellsAndSpansEqual:
            headers(preceding).length > 0 &&
            JSON.stringify(headers(preceding)) ===
              JSON.stringify(headers(following)),
        },
        boundaryCells: {
          preceding: boundary(preceding, true),
          following: boundary(following, false),
        },
        sourceDeclaredContinuation: false,
      };
    },
  );
  const bodySequences = [...bodyGroups.values()].map((group) => ({
    contexts: group[0].contexts,
    complete: false,
    sources: [...group].sort((a, b) => a.index - b.index).map((s) => s.ref),
  }));
  const headerBindings = tableBindings.flatMap(({ ref, table }) =>
    table.data.grid.flatMap((row, rowIndex) =>
      row.some((c) => c.isHeader)
        ? row.map((cell, cellIndex) => ({
            tableRef: ref,
            resourceKey: `${table.key}/grid/${rowIndex}/${cellIndex}`,
            rowIndex,
            cellIndex,
            ...cell,
          }))
        : [],
    ),
  );
  payload.sourceContext = {
    ...payload.sourceContext,
    sources,
    bodySequences,
    tableLocations: tableBindings
      .filter((b) => tables.some((t) => t.ref === b.ref))
      .map(({ ref, table }) => ({
        ref,
        contexts: contextRefs(owners(table.data.id)),
        pdfPage: table.data.pdfPageNo,
        rowCount: table.data.grid.length,
        captionRef: captions.get(table.key) ?? null,
      })),
    tableContinuationCandidates,
  };
  return {
    ...legacy,
    contextVersion: CONTENT_ATTACHMENT_SOURCE_CONTEXT_VERSION,
    userPrompt: JSON.stringify(payload),
    wordEvidence: { ...segmentation.wordEvidence, sources: wordSources },
    contextBindings: {
      sources: bindings,
      tables: tableBindings,
      headers: headerBindings,
    },
  };
}

/** Resolve against the separate context snapshot, retaining exact original field and offsets. */
export function resolveContentAttachmentSourceContextRange(
  request: ContentAttachmentSourceContextRequest,
  range: string,
  currentExcerptRef: string,
) {
  const resolved = resolveContentAttachmentWordRange(
    request.wordEvidence,
    range,
    currentExcerptRef,
  );
  const binding = request.contextBindings.sources.find(
    (s) => s.ref === resolved.sourceRef,
  );
  if (
    !binding ||
    binding.resourceKey !== resolved.resourceKey ||
    binding.text.slice(resolved.charStart, resolved.charEnd) !== resolved.text
  )
    throw new Error('Context word range differs from original binding');
  return {
    ...resolved,
    field: binding.field,
    charStart: binding.charStart + resolved.charStart,
    charEnd: binding.charStart + resolved.charEnd,
  };
}
