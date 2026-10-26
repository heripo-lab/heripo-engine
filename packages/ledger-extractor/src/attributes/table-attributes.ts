import type { ProcessedTable } from '@heripo/model';

import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { DocumentResourceIndex } from '../resources/document-resource-index';

import { originalIdentifierCellOwners } from '../content-attachment/tables/owners';

export const TABLE_ATTRIBUTES_VERSION = 'table-attributes.v2' as const;

/** One table cell kept as a record attribute, its key from the column header or the row label. */
export interface TableAttribute {
  recordId: string;
  /** The header path (`규모(cm) / 길이`) or, in a key–value table, the row's label cell. */
  keyText: string;
  /** The cell text exactly as preprocessed. */
  valueText: string;
  /** A unit written in parentheses in the key (`(cm)`), as written. */
  unitText?: string;
  sourceText: string;
  extractionMethod: 'table_mapping';
  metadata: {
    tableId: string;
    cellKey: string;
    rowIndex: number;
    /** Column in the logical grid, after merged cells are accounted for. */
    logicalColumn: number;
    layout: 'columns' | 'key_value';
    pdfPageNo: number | null;
  };
}
export interface TableAttributeTable {
  tableKey: string;
  tableId: string;
  layout: 'columns' | 'key_value';
  /** Rows used as column headers, above the first row a record owns. */
  headerRows: number[];
  /** Records the table gives attributes to. */
  recordIds: string[];
}
export interface TableAttributes {
  version: typeof TABLE_ATTRIBUTES_VERSION;
  attributes: TableAttribute[];
  tables: TableAttributeTable[];
  /** Owned cells with text but no header above them; not kept. */
  cellsWithoutHeader: Array<{
    recordId: string;
    cellKey: string;
    text: string;
  }>;
}

interface LogicalCell {
  key: string;
  row: number;
  /** Index in the stored grid row. */
  storedColumn: number;
  /** Column in the logical grid. */
  column: number;
  span: number;
  text: string;
}
const NUMERIC_ONLY = /^[\d\s.,~∼()\-+/]*$/;
/** A header part names something only with a Hangul letter or a word of two Latin letters. */
const NAMES_SOMETHING = /[가-힣]|[A-Za-z]{2,}/;
const UNIT = /\(([A-Za-z㎝㎜㎡㎥²³]+)\)/g;

/**
 * Place every stored cell in the logical grid. Processed grids leave out the cells a merge covers, so a
 * cell's array index can differ from its column; rows and columns are walked with their spans.
 */
export function logicalTableCells(
  tableKey: string,
  table: ProcessedTable,
): LogicalCell[] {
  const occupied = new Set<string>();
  const cells: LogicalCell[] = [];
  table.grid.forEach((row, r) => {
    let column = 0;
    row.forEach((cell, c) => {
      while (occupied.has(`${r}|${column}`)) column++;
      const span = Math.max(1, cell.colSpan ?? 1);
      const rows = Math.max(1, cell.rowSpan ?? 1);
      for (let dr = 0; dr < rows; dr++)
        for (let dc = 0; dc < span; dc++)
          occupied.add(`${r + dr}|${column + dc}`);
      cells.push({
        key: `${tableKey}/grid/${r}/${c}`,
        row: r,
        storedColumn: c,
        column,
        span,
        text: (cell.text ?? '').trim(),
      });
      column += span;
    });
  });
  return cells;
}

/**
 * Header text of empty header cells whose horizontal merge was lost in preprocessing: an empty cell right of a
 * header that names something, with only empty cells between, takes that header when the next header row names
 * something in its column (`크기(cm)` over `길이/높이 · 입지름/너비 · …`, stored as one cell and empty cells).
 */
function lostMergeHeaders(cells: LogicalCell[], headerRows: number[]) {
  const text = new Map<string, string>();
  headerRows.slice(0, -1).forEach((row, i) => {
    const below = (column: number) =>
      cells.find(
        (c) =>
          c.row === headerRows[i + 1] &&
          c.column <= column &&
          column < c.column + c.span,
      );
    let left = '';
    for (const cell of cells
      .filter((c) => c.row === row)
      .sort((a, b) => a.column - b.column)) {
      if (cell.text) left = NAMES_SOMETHING.test(cell.text) ? cell.text : '';
      else if (
        left &&
        cell.span === 1 &&
        NAMES_SOMETHING.test(below(cell.column)?.text ?? '')
      )
        text.set(cell.key, left);
      else left = '';
    }
  });
  return text;
}

/**
 * Turn the table rows records own into attributes (A1), deterministically and without model calls.
 *
 * - A record owns a row segment from its original identifier cell to the right (the content-attachment row
 *   owner rule), so a trench row's `도로유구 1기` cell stays the trench's attribute.
 * - Column keys come from the rows above the first owned row, through the logical grid; header flags in the
 *   input are not relied on. A header whose horizontal merge was lost (one cell, then empty cells over named
 *   sub-headers) is carried right over those cells. Rows of numbers only are not headers, and a header part counts only when it
 *   names something (a Hangul letter or a two-letter word), so numbers of a table fused alongside give no key.
 * - A two-column table of text labels with no owned rows is a key–value table: when exactly one record is
 *   registered in it, every other row gives that record an attribute keyed by the row's label.
 * - A record's own registration cells and empty cells are not attributes; values and units stay as written.
 */
export function collectTableAttributes(
  index: DocumentResourceIndex,
  plan: ContentAttachmentPlan,
): TableAttributes {
  const recordOf = new Map(
    plan.registry.map((e) => [e.ref, `record-${e.groupId}`]),
  );
  const registeredBy = new Map<string, Set<string>>();
  for (const e of plan.registry)
    for (const m of e.mentions)
      for (const x of m.evidence)
        registeredBy.set(
          x.resourceKey,
          (registeredBy.get(x.resourceKey) ?? new Set()).add(
            `record-${e.groupId}`,
          ),
        );
  const attributes: TableAttribute[] = [];
  const tables: TableAttributeTable[] = [];
  const cellsWithoutHeader: TableAttributes['cellsWithoutHeader'] = [];

  for (const resource of index.resources) {
    if (resource.kind !== 'table') continue;
    const table = resource.data;
    const cells = logicalTableCells(resource.key, table);
    const owners = originalIdentifierCellOwners(plan, {
      key: resource.key,
      data: table,
    });
    const ownerOf = (cell: LogicalCell) => {
      const ref = owners[cell.row][cell.storedColumn];
      return ref ? recordOf.get(ref)! : null;
    };
    const attribute = (
      recordId: string,
      cell: LogicalCell,
      keyText: string,
      layout: TableAttribute['metadata']['layout'],
    ): TableAttribute => {
      const units = [...keyText.matchAll(UNIT)];
      return {
        recordId,
        keyText,
        valueText: cell.text,
        ...(units.length ? { unitText: units.at(-1)![1] } : {}),
        sourceText: cell.text,
        extractionMethod: 'table_mapping',
        metadata: {
          tableId: table.id,
          cellKey: cell.key,
          rowIndex: cell.row,
          logicalColumn: cell.column,
          layout,
          pdfPageNo: resource.pdfPageNo,
        },
      };
    };

    const owned = cells.filter((c) => ownerOf(c));
    if (owned.length) {
      const firstRow = Math.min(...owned.map((c) => c.row));
      const headerRows = [
        ...new Set(cells.filter((c) => c.row < firstRow).map((c) => c.row)),
      ].filter((r) =>
        cells.some((c) => c.row === r && c.text && !NUMERIC_ONLY.test(c.text)),
      );
      const headerText = lostMergeHeaders(cells, headerRows);
      const headerFor = (column: number) =>
        cells
          .filter(
            (c) =>
              headerRows.includes(c.row) &&
              c.column <= column &&
              column < c.column + c.span &&
              NAMES_SOMETHING.test(headerText.get(c.key) ?? c.text),
          )
          .map((c) => headerText.get(c.key) ?? c.text)
          .join(' / ');
      const recordIds = new Set<string>();
      for (const cell of owned) {
        const recordId = ownerOf(cell)!;
        if (!cell.text || registeredBy.get(cell.key)?.has(recordId)) continue;
        const key = headerFor(cell.column);
        if (!key) {
          cellsWithoutHeader.push({
            recordId,
            cellKey: cell.key,
            text: cell.text,
          });
          continue;
        }
        attributes.push(attribute(recordId, cell, key, 'columns'));
        recordIds.add(recordId);
      }
      tables.push({
        tableKey: resource.key,
        tableId: table.id,
        layout: 'columns',
        headerRows,
        recordIds: [...recordIds],
      });
      continue;
    }

    // key–value table: two logical columns, text labels on the left, one record registered in it
    const rows = [...new Set(cells.map((c) => c.row))];
    const pairs = rows.map((r) => cells.filter((c) => c.row === r));
    const isKeyValue =
      rows.length >= 2 &&
      pairs.every(
        (p) =>
          p.length === 2 &&
          p[0].column === 0 &&
          p[1].column === 1 &&
          !NUMERIC_ONLY.test(p[0].text),
      );
    const registered = [
      ...new Set(cells.flatMap((c) => [...(registeredBy.get(c.key) ?? [])])),
    ];
    if (!isKeyValue || registered.length !== 1) continue;
    const [recordId] = registered;
    for (const [label, value] of pairs)
      if (
        value.text &&
        !registeredBy.has(label.key) &&
        !registeredBy.has(value.key)
      )
        attributes.push(attribute(recordId, value, label.text, 'key_value'));
    tables.push({
      tableKey: resource.key,
      tableId: table.id,
      layout: 'key_value',
      headerRows: [],
      recordIds: [recordId],
    });
  }
  return {
    version: TABLE_ATTRIBUTES_VERSION,
    attributes,
    tables,
    cellsWithoutHeader,
  };
}
