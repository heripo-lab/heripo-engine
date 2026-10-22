import type { CandidateEvidence } from '../candidates/candidate-discovery';
import type {
  AttachmentSource,
  AttachmentUnit,
  ContentAttachmentPlan,
} from './content-attachment';

import { createContentAttachmentBodyBlockInput } from './body-blocks';

type Cell = Extract<AttachmentSource['resource'], { kind: 'tableCell' }>;

/** Bind every available registration cell to its original row, never infer a quantity or target. */
export function createContentAttachmentOriginInput(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
) {
  const base = createContentAttachmentBodyBlockInput(plan, unit);
  const resources = new Map(
    plan.units
      .flatMap((u) => u.sources)
      .map((s) => [s.resource.key, s.resource]),
  );
  const tables = new Map(
    plan.units.flatMap((u) => u.tables).map((t) => [t.data.id, t]),
  );
  const pending: Array<{
    candidateRef: string;
    candidateId: string;
    contextRef: string;
    evidence: CandidateEvidence;
    source: Cell;
  }> = [];
  for (const candidate of plan.registry)
    for (const mention of candidate.mentions)
      for (const evidence of mention.evidence) {
        const source = resources.get(evidence.resourceKey);
        if (source?.kind !== 'tableCell') continue;
        const table = tables.get(source.tableId);
        if (!table)
          throw new Error('Candidate origin table missing from fixed plan');
        if (
          table.data.grid[source.rowIndex]?.[source.columnIndex]?.text !==
            source.data.text ||
          !Number.isInteger(evidence.charStart) ||
          !Number.isInteger(evidence.charEnd) ||
          evidence.charStart < 0 ||
          evidence.charEnd <= evidence.charStart ||
          evidence.charEnd > source.data.text.length ||
          source.data.text.slice(evidence.charStart, evidence.charEnd) !==
            evidence.quote
        )
          throw new Error('Candidate origin differs from original cell');
        pending.push({
          candidateRef: candidate.ref,
          candidateId: mention.candidateId,
          contextRef: Object.entries(base.codeMap.contextPaths).find(
            ([, path]) =>
              JSON.stringify(path) === JSON.stringify(mention.chapterPath),
          )![0],
          evidence,
          source,
        });
      }
  const tableBindings = [...tables.values()]
    .filter((table) => pending.some((p) => p.source.tableId === table.data.id))
    .map((table, i) => ({ ref: `U${i + 1}`, table }));
  const rowBindings = tableBindings
    .flatMap(({ ref: tableRef, table }) =>
      table.data.grid.flatMap((cells, rowIndex) =>
        pending.some(
          (p) =>
            p.source.tableId === table.data.id &&
            p.source.rowIndex === rowIndex,
        )
          ? [
              {
                tableRef,
                tableKey: table.key,
                rowIndex,
                cells: cells.map(
                  (cell, column) =>
                    [
                      column,
                      cell.text,
                      cell.rowSpan,
                      cell.colSpan,
                      cell.isHeader,
                    ] as const,
                ),
              },
            ]
          : [],
      ),
    )
    .map((row, i) => ({ ref: `O${i + 1}`, ...row }));
  const bindings = pending.map((p) => ({
    candidateRef: p.candidateRef,
    candidateId: p.candidateId,
    contextRef: p.contextRef,
    evidence: p.evidence,
    rowRef: rowBindings.find(
      (r) =>
        r.tableKey === tables.get(p.source.tableId)!.key &&
        r.rowIndex === p.source.rowIndex,
    )!.ref,
    column: p.source.columnIndex,
    quantityScope: 'cell_and_row' as const,
  }));
  const anchors = [
    ...new Map(
      bindings.map((b) => {
        const anchor = [b.candidateRef, b.rowRef, b.column] as const;
        return [JSON.stringify(anchor), anchor];
      }),
    ).values(),
  ];
  return {
    payload: {
      ...base.payload,
      originQuantityScope: 'cell_and_row',
      originTables: tableBindings.map(({ ref, table }) => ({
        ref,
        contexts: [
          ...new Set(
            pending
              .filter((p) => p.source.tableId === table.data.id)
              .map((p) => p.contextRef),
          ),
        ],
        caption: table.data.caption?.fullText ?? null,
        headers: table.data.grid.flatMap((row, rowIndex) =>
          row.some((cell) => cell.isHeader)
            ? row.map(
                (cell, column) =>
                  [
                    rowIndex,
                    column,
                    cell.text,
                    cell.rowSpan,
                    cell.colSpan,
                    cell.isHeader,
                  ] as const,
              )
            : [],
        ),
      })),
      originRowColumns: ['ref', 'table', 'row', 'cells'],
      originCellColumns: ['column', 'text', 'rowSpan', 'colSpan', 'isHeader'],
      originRows: rowBindings.map(
        (r) => [r.ref, r.tableRef, r.rowIndex, r.cells] as const,
      ),
      originAnchorColumns: ['candidate', 'row', 'column'],
      originAnchors: anchors,
    },
    codeMap: {
      ...base.codeMap,
      originTables: tableBindings,
      originRows: rowBindings,
      originAnchors: bindings,
    },
  };
}
