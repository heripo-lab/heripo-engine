import type { CandidateEvidence } from '../../candidates/candidate-discovery';
import type {
  AttachmentUnit,
  ContentAttachmentPlan,
} from '../content-attachment';

import { createContentAttachmentDecisionInput } from '../decisions';

/** Link original candidate cells to current table rows without inferring ownership. */
export function createContentAttachmentTableAnchorInput(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
) {
  const previous = createContentAttachmentDecisionInput(plan, unit);
  const sources = new Map(
    unit.sources.map((s) => [s.resource.key, s.resource]),
  );
  const tables = new Map(
    previous.codeMap.tables.map((t) => [t.table.data.id, t.ref]),
  );
  const pending: Array<{
    candidateRef: string;
    candidateId: string;
    evidence: CandidateEvidence;
    tableRef: string;
    rowIndex: number;
    columnIndex: number;
    excerptRef: string;
  }> = [];
  for (const candidate of previous.codeMap.candidateRows) {
    for (const evidence of candidate.evidence) {
      const source = sources.get(evidence.resourceKey);
      if (source?.kind !== 'tableCell') continue;
      if (
        !Number.isInteger(evidence.charStart) ||
        !Number.isInteger(evidence.charEnd) ||
        evidence.charStart < 0 ||
        evidence.charEnd <= evidence.charStart ||
        evidence.charEnd > source.data.text.length ||
        source.data.text.slice(evidence.charStart, evidence.charEnd) !==
          evidence.quote
      )
        throw new Error('Candidate table anchor differs from original cell');
      const matches = previous.codeMap.excerpts.filter((excerpt) =>
        excerpt.evidence.some((f) => f.resourceKey === evidence.resourceKey),
      );
      if (matches.length !== 1)
        throw new Error('Candidate table anchor must fit one selectable cell');
      pending.push({
        candidateRef: candidate.ref,
        candidateId: candidate.candidateId,
        evidence,
        tableRef: tables.get(source.tableId)!,
        rowIndex: source.rowIndex,
        columnIndex: source.columnIndex,
        excerptRef: matches[0].ref,
      });
    }
  }
  const rows: Array<readonly [string, string, number, string[]]> = [];
  const rowBindings: Array<{
    ref: string;
    tableRef: string;
    tableKey: string;
    rowIndex: number;
    excerptRefs: string[];
  }> = [];
  for (const { ref: tableRef, table } of previous.codeMap.tables) {
    table.data.grid.forEach((_, rowIndex) => {
      if (
        !pending.some((p) => p.tableRef === tableRef && p.rowIndex === rowIndex)
      )
        return;
      const ref = `A${rows.length + 1}`;
      const excerptRefs = previous.payload.current.excerpts
        .filter((e) => e[3]?.[0] === tableRef && e[3][1] === rowIndex)
        .map((e) => e[0]);
      rows.push([ref, tableRef, rowIndex, excerptRefs]);
      rowBindings.push({
        ref,
        tableRef,
        tableKey: table.key,
        rowIndex,
        excerptRefs,
      });
    });
  }
  const bindings = pending.map((p) => ({
    ...p,
    rowRef: rowBindings.find(
      (r) => r.tableRef === p.tableRef && r.rowIndex === p.rowIndex,
    )!.ref,
  }));
  const anchors: Array<readonly [string, string, number, string]> = [];
  const seen = new Set<string>();
  for (const b of bindings) {
    const anchor = [
      b.candidateRef,
      b.rowRef,
      b.columnIndex,
      b.excerptRef,
    ] as const;
    const key = JSON.stringify(anchor);
    if (seen.has(key)) continue;
    seen.add(key);
    anchors.push(anchor);
  }
  return {
    payload: {
      ...previous.payload,
      candidateTableRowColumns: ['ref', 'table', 'row', 'excerpts'],
      candidateTableRows: rows,
      candidateTableAnchorColumns: ['candidate', 'row', 'column', 'excerpt'],
      candidateTableAnchors: anchors,
    },
    codeMap: {
      ...previous.codeMap,
      candidateTableRows: rowBindings,
      candidateTableAnchors: bindings,
    },
  };
}
