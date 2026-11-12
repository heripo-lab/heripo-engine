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
 * The column blocks of a side-by-side table: those the plan found from its number columns, or else the first header row, spread over its colSpans, repeats one sequence of
 * labels two or more times. Header cell indexes are compressed by merged cells, so the labels, not the indexes, are
 * compared. Null for a body unit or an ordinary table.
 */
export function columnBlocks(
  unit: CandidateDiscoveryUnit,
): CandidateDiscoveryColumnBlocks | null {
  // blocks the plan found from a register table's number columns (v18) stand for its header
  if (unit.table?.columnBlocks) return unit.table.columnBlocks;
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

/** Share of a number column's numbers that must differ, and run down it or rightward across a row, in order. */
const NUMBER_COLUMN_SHARE = 0.8;

/** The largest ratio between the median numbers of two number columns of one register. */
const NUMBER_COLUMN_MEDIAN_RATIO = 10;

/** The object number a cell holds alone: up to four digits and an optional capital letter (`321B`). */
const cellNumber = (text: string) =>
  /^(\d{1,4})[A-Z]?$/u.exec(text.replace(/\s+/gu, ''))?.[1] ?? null;

/**
 * The column blocks of a register whose data rows list several numbered objects side by side, found from its number
 * columns when OCR leaves its header too uneven to compare: the columns where at least three cells, and at least half
 * of the non-empty rows, hold a number alone start at column 0 and recur every `columnsPerBlock` (two or more)
 * columns, at least twice, within the table width. Each number column must hold mostly distinct numbers ascending
 * downwards, their median numbers must lie within a factor of ten of each other, and rows with several numbers must
 * mostly ascend rightwards, so count columns (1, 2) and year columns beside a serial number do not count. Null for
 * any other table.
 */
export function dataColumnBlocks(
  grid: ReadonlyArray<ReadonlyArray<{ text: string }>>,
): CandidateDiscoveryColumnBlocks | null {
  const width = Math.max(0, ...grid.map((row) => row.length));
  const rows = grid.filter((row) => row.some((c) => c.text.trim() !== ''));
  const numberAt = (row: ReadonlyArray<{ text: string }>, column: number) =>
    row[column] ? cellNumber(row[column].text) : null;
  const columns = [...Array(width).keys()].filter((column) => {
    const count = rows.filter((row) => numberAt(row, column)).length;
    return count >= 3 && count * 2 >= rows.length;
  });
  const step = columns[1];
  if (
    columns[0] !== 0 ||
    !(step >= 2) ||
    columns.some((column, i) => column !== i * step) ||
    columns.length * step > width
  )
    return null;
  const mostly = (count: number, of: number) =>
    count >= of * NUMBER_COLUMN_SHARE;
  // the blocks continue one list of numbers, so their numbers are of one size, unlike serials beside years
  const medians = columns.map((column) => {
    const values = rows
      .flatMap((row) => {
        const number = numberAt(row, column);
        return number ? [Number(number)] : [];
      })
      .sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  });
  if (
    Math.max(...medians) >
    Math.max(1, Math.min(...medians)) * NUMBER_COLUMN_MEDIAN_RATIO
  )
    return null;
  const ascending = (values: number[]) =>
    values.slice(1).filter((v, i) => v >= values[i]).length;
  for (const column of columns) {
    const cells = rows.filter((row) => numberAt(row, column));
    const values = cells.map((row) => Number(numberAt(row, column)));
    if (
      !mostly(
        new Set(cells.map((row) => row[column].text.replace(/\s+/gu, ''))).size,
        cells.length,
      ) ||
      !mostly(ascending(values), values.length - 1)
    )
      return null;
  }
  const across = rows
    .map((row) =>
      columns.flatMap((column) => {
        const number = numberAt(row, column);
        return number ? [Number(number)] : [];
      }),
    )
    .filter((values) => values.length > 1);
  const rising = across.filter((values) =>
    values.every((v, i) => i === 0 || v > values[i - 1]),
  ).length;
  return mostly(rising, across.length)
    ? { count: columns.length, columnsPerBlock: step }
    : null;
}
