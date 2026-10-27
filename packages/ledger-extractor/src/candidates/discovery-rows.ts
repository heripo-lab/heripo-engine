import type {
  CandidateDiscoveryColumnBlocks,
  CandidateDiscoveryResponse,
  CandidateDiscoveryRowBlock,
  CandidateDiscoveryUnit,
} from './discovery-types';

import { getCandidateSources } from './discovery-request';

/** Exclusion categories that answer a whole table row; a passing mention does not. */
const ROW_EXCLUSION_CATEGORIES = new Set<string | undefined>([
  'previous_or_external',
  'summary_row',
  'header_row',
  'non_item_table',
  // responses without categories keep the earlier rule that any exclusion answers its row
  undefined,
]);

/**
 * Data rows of an item-table unit that no candidate references and no row-level exclusion answers (prompt v9 on).
 * A unit is an item table when the response says so, or, without a tableRole, when it proposes a table item.
 * Rows with a header cell or only empty cells are not data rows, nor are the leading grid rows the request
 * presents as headerRows.
 */
export function unansweredItemTableRows(
  unit: CandidateDiscoveryUnit,
  response: CandidateDiscoveryResponse,
): number[] {
  if (
    !unit.table ||
    !(
      response.tableRole === 'item_table' ||
      (response.tableRole === undefined &&
        response.candidates.some((c) => c.eligibilityBasis === 'table_item'))
    )
  )
    return [];
  const rows = new Map<number, { header: boolean; text: boolean }>();
  const rowOf = new Map<string, number>();
  for (const { sourceId, resource } of getCandidateSources(unit)) {
    if (resource.kind !== 'tableCell') continue;
    rowOf.set(sourceId, resource.rowIndex);
    const row = rows.get(resource.rowIndex) ?? { header: false, text: false };
    row.header ||= resource.data.isHeader;
    row.text ||= resource.data.text.trim() !== '';
    rows.set(resource.rowIndex, row);
  }
  const answered = new Set(
    [
      ...response.candidates.flatMap((c) => [
        c.identifierSourceId,
        c.nameSourceId,
        ...c.evidence.map((e) => e.sourceId),
      ]),
      ...response.exclusions
        .filter((e) => ROW_EXCLUSION_CATEGORIES.has(e.category))
        .map((e) => e.sourceId),
    ].flatMap((id) =>
      typeof id === 'string' && rowOf.has(id) ? [rowOf.get(id)!] : [],
    ),
  );
  const headerRowCount = unit.table.headerRows.length;
  return [...rows]
    .filter(
      ([index, row]) =>
        index >= headerRowCount &&
        row.text &&
        !row.header &&
        !answered.has(index),
    )
    .map(([index]) => index)
    .sort((a, b) => a - b);
}

/**
 * The column blocks of a side-by-side table: the first header row, spread over its colSpans, repeats one sequence of
 * labels two or more times. Header cell indexes are compressed by merged cells, so the labels, not the indexes, are
 * compared. Null for a body unit or an ordinary table.
 */
export function columnBlocks(
  unit: CandidateDiscoveryUnit,
): CandidateDiscoveryColumnBlocks | null {
  const head = unit.table?.headerRows[0];
  if (!head) return null;
  const labels = head.flatMap((cell) => {
    const { text, colSpan } =
      typeof cell === 'string' ? { text: cell, colSpan: 1 } : cell;
    const label = text.replace(/\s+/gu, '');
    return Array.from({ length: colSpan }, (_, part) => `${label}#${part}`);
  });
  for (let width = 2; width <= labels.length / 2; width++)
    if (
      labels.length % width === 0 &&
      labels.every((label, i) => label === labels[i % width])
    )
      return { count: labels.length / width, columnsPerBlock: width };
  return null;
}

/**
 * Blocks of data rows of a side-by-side item table (prompt v11 on) that no candidate anchors and no row-level
 * exclusion answers. A block counts as answered only by a candidate's identifier cell or first evidence, since models
 * often quote a whole row as evidence of one of its items. Empty only when the unit is not such a table.
 */
export function unansweredItemTableBlocks(
  unit: CandidateDiscoveryUnit,
  response: CandidateDiscoveryResponse,
): CandidateDiscoveryRowBlock[] {
  const blocks = columnBlocks(unit);
  if (!blocks || response.tableRole !== 'item_table') return [];
  const blockOf = new Map<string, string>();
  const text = new Set<string>();
  const headerRows = new Set<number>();
  for (const { sourceId, resource } of getCandidateSources(unit)) {
    if (resource.kind !== 'tableCell') continue;
    if (resource.data.isHeader) headerRows.add(resource.rowIndex);
    const key = JSON.stringify([
      resource.rowIndex,
      Math.floor(resource.columnIndex / blocks.columnsPerBlock),
    ]);
    blockOf.set(sourceId, key);
    if (resource.data.text.trim() !== '') text.add(key);
  }
  const answered = new Set(
    [
      ...response.candidates.flatMap((c) => [
        c.identifierSourceId,
        c.evidence[0].sourceId,
      ]),
      ...response.exclusions
        .filter((e) => ROW_EXCLUSION_CATEGORIES.has(e.category))
        .map((e) => e.sourceId),
    ].flatMap((id) =>
      typeof id === 'string' && blockOf.has(id) ? [blockOf.get(id)!] : [],
    ),
  );
  return [...text]
    .map((key) => JSON.parse(key) as [number, number])
    .filter(
      ([rowIndex]) =>
        rowIndex >= unit.table!.headerRows.length && !headerRows.has(rowIndex),
    )
    .filter(
      ([rowIndex, block]) => !answered.has(JSON.stringify([rowIndex, block])),
    )
    .map(([rowIndex, block]) => ({ rowIndex, block }))
    .sort((a, b) => a.rowIndex - b.rowIndex || a.block - b.block);
}

/**
 * The unit narrowed to the given table rows, keeping its table header, chapter path and context. With row blocks of
 * a side-by-side table, only the cells of those blocks remain.
 */
export function createFollowUpUnit(
  unit: CandidateDiscoveryUnit,
  rowIndexes: number[],
  rowBlocks: CandidateDiscoveryRowBlock[] = [],
): CandidateDiscoveryUnit {
  // row blocks exist only for a side-by-side table
  const width = rowBlocks.length ? columnBlocks(unit)!.columnsPerBlock : 0;
  return {
    ...unit,
    resources: unit.resources.filter(
      (r) =>
        r.kind === 'tableCell' &&
        (width
          ? rowBlocks.some(
              (b) =>
                b.rowIndex === r.rowIndex &&
                b.block === Math.floor(r.columnIndex / width),
            )
          : rowIndexes.includes(r.rowIndex)),
    ),
  };
}
