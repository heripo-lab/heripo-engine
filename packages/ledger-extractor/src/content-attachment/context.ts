import type { CandidateEvidence } from '../candidates/candidate-discovery';
import type {
  AttachmentSource,
  AttachmentUnit,
  ContentAttachmentPlan,
} from './content-attachment';

import { createContentAttachmentTableAnchorInput } from './tables/anchors';

type TextResource = Extract<AttachmentSource['resource'], { kind: 'text' }>;

/** Find actual body boundaries even when a batch starts or ends with table cells. */
export function adjacentAttachmentBody(
  texts: TextResource[],
  sources: AttachmentSource[],
  pdfPageNo: number,
) {
  const ordered = [...texts].sort((a, b) => a.pdfPageNo! - b.pdfPageNo!);
  const selected = new Set(sources.map((s) => s.resource.key));
  const positions = ordered.flatMap((r, i) => (selected.has(r.key) ? [i] : []));
  const first = positions[0];
  const last = positions.at(-1);
  const boundary = ordered.reduce(
    (last, r, i) => (r.pdfPageNo! <= pdfPageNo ? i : last),
    -1,
  );
  const adjacent =
    first === undefined
      ? [
          ...ordered.slice(Math.max(0, boundary - 1), boundary + 1),
          ...ordered.slice(boundary + 1, boundary + 3),
        ]
      : [
          ...ordered.slice(Math.max(0, first - 2), first),
          ...ordered.slice(last! + 1, last! + 3),
        ];
  return adjacent.map((r) => ({ resourceKey: r.key, text: r.data.text }));
}

/** Supply source context, never infer a collective, parent, table continuation or semantic target. */
export function createContentAttachmentContextInput(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
) {
  const base = createContentAttachmentTableAnchorInput(plan, unit);
  const resources = new Map(
    plan.units
      .flatMap((u) => u.sources)
      .map((s) => [s.resource.key, s.resource]),
  );
  const texts = [...resources.values()].filter(
    (r): r is TextResource => r.kind === 'text',
  );
  const body = new Map(
    [
      ...adjacentAttachmentBody(texts, unit.sources, unit.pdfPageNo),
      ...unit.readOnlyContext,
    ].map((c) => [c.resourceKey, c]),
  );
  const contextRefs = (ids: string[]) =>
    Object.entries(base.codeMap.contextPaths)
      .filter(([, path]) => ids.includes(path.at(-1)?.id ?? ''))
      .map(([ref]) => ref);
  const bodyBindings = [...body.values()].map((source, i) => ({
    ref: `B${i + 1}`,
    ...source,
  }));
  const bodyRows = bodyBindings.map(
    (b) =>
      [
        b.ref,
        contextRefs(resources.get(b.resourceKey)?.chapterIds ?? []),
        b.text,
      ] as const,
  );
  const currentKeys = new Set(unit.sources.map((s) => s.resource.key));
  const pending: Array<{
    candidateRef: string;
    candidateId: string;
    evidence: CandidateEvidence;
    source: Extract<AttachmentSource['resource'], { kind: 'tableCell' }>;
  }> = [];
  for (const c of plan.registry)
    for (const m of c.mentions) {
      if (
        !unit.chapters.some(
          (ch) => JSON.stringify(ch.path) === JSON.stringify(m.chapterPath),
        )
      )
        continue;
      for (const evidence of m.evidence) {
        const source = resources.get(evidence.resourceKey);
        if (
          !source ||
          source.kind !== 'tableCell' ||
          currentKeys.has(source.key)
        )
          continue;
        if (
          !Number.isInteger(evidence.charStart) ||
          !Number.isInteger(evidence.charEnd) ||
          evidence.charStart < 0 ||
          evidence.charEnd <= evidence.charStart ||
          evidence.charEnd > source.data.text.length ||
          source.data.text.slice(evidence.charStart, evidence.charEnd) !==
            evidence.quote
        )
          throw new Error('Supporting table anchor differs from original cell');
        pending.push({
          candidateRef: c.ref,
          candidateId: m.candidateId,
          evidence,
          source,
        });
      }
    }
  const allTables = new Map(
    plan.units.flatMap((u) => u.tables).map((t) => [t.data.id, t]),
  );
  const tableBindings = [...allTables.values()]
    .filter((t) => pending.some((p) => p.source.tableId === t.data.id))
    .map((table, i) => ({ ref: `Q${i + 1}`, table }));
  const tableRows = tableBindings.map(({ ref, table }) => ({
    ref,
    contexts: contextRefs([
      ...new Set(
        pending
          .filter((p) => p.source.tableId === table.data.id)
          .flatMap((p) => p.source.chapterIds),
      ),
    ]),
    caption: table.data.caption?.fullText ?? null,
    headers: table.data.grid.flatMap((row, r) =>
      row.some((cell) => cell.isHeader)
        ? row.map(
            (cell, col) =>
              [
                r,
                col,
                cell.text,
                cell.rowSpan,
                cell.colSpan,
                cell.isHeader,
              ] as const,
          )
        : [],
    ),
  }));
  const rowBindings = tableBindings
    .flatMap(({ ref: tableRef, table }) =>
      table.data.grid.flatMap((row, rowIndex) => {
        const rowPending = pending.filter(
          (p) =>
            p.source.tableId === table.data.id &&
            p.source.rowIndex === rowIndex,
        );
        if (!rowPending.length) return [];
        return [
          {
            tableRef,
            tableKey: table.key,
            rowIndex,
            cells: row.flatMap((cell, columnIndex) =>
              rowPending.some((p) => p.source.columnIndex === columnIndex)
                ? [[columnIndex, cell.text] as const]
                : [],
            ),
          },
        ];
      }),
    )
    .map((row, i) => ({ ref: `M${i + 1}`, ...row }));
  const bindings = pending.map((p) => ({
    candidateRef: p.candidateRef,
    candidateId: p.candidateId,
    evidence: p.evidence,
    rowRef: rowBindings.find(
      (r) =>
        r.tableKey === allTables.get(p.source.tableId)!.key &&
        r.rowIndex === p.source.rowIndex,
    )!.ref,
    column: p.source.columnIndex,
  }));
  const anchors = [
    ...new Map(
      bindings.map((b) => {
        const a = [b.candidateRef, b.rowRef, b.column] as const;
        return [JSON.stringify(a), a];
      }),
    ).values(),
  ];
  return {
    payload: {
      ...base.payload,
      current: {
        ...base.payload.current,
        readOnlyContext: bodyRows,
        readOnlyContextColumns: ['ref', 'contexts', 'text'],
      },
      supportingTables: tableRows,
      supportingRowColumns: ['ref', 'table', 'row', 'cells'],
      supportingRows: rowBindings.map(
        (r) => [r.ref, r.tableRef, r.rowIndex, r.cells] as const,
      ),
      supportingAnchorColumns: ['candidate', 'row', 'column'],
      supportingAnchors: anchors,
    },
    codeMap: {
      ...base.codeMap,
      supportingBody: bodyBindings,
      supportingTables: tableBindings,
      supportingRows: rowBindings,
      supportingAnchors: bindings,
    },
  };
}
