import type { ProcessedTable } from '@heripo/model';

import { Table2 } from 'lucide-react';

import { Badge } from '~/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '~/components/ui/table';
import { resolveTableIds } from '~/features/result/utils/chapter-lookup';

import { PageLink } from './page-link';

interface TableViewerProps {
  tableIds: string[];
  tableMap: Map<string, ProcessedTable>;
}

function getCellRowSpan(cell: ProcessedTable['grid'][number][number]): number {
  return Math.max(1, cell.rowSpan ?? 1);
}

function getCellColSpan(cell: ProcessedTable['grid'][number][number]): number {
  return Math.max(1, cell.colSpan ?? 1);
}

function computeShadowMap(table: ProcessedTable): boolean[][] | undefined {
  if (table.numCols <= 0) return undefined;

  const hasOverfullRows = table.grid.some((row) => {
    const logicalWidth = row.reduce(
      (sum, cell) => sum + getCellColSpan(cell),
      0,
    );
    return row.length > table.numCols || logicalWidth > table.numCols;
  });
  const hasFullWidthVerticalPlaceholders = table.grid.some((row, rowIdx) =>
    row.some((cell, colIdx) => {
      if (getCellRowSpan(cell) <= 1) return false;
      return table.grid
        .slice(rowIdx + 1, rowIdx + getCellRowSpan(cell))
        .some(
          (coveredRow) =>
            coveredRow.length >= table.numCols &&
            coveredRow[colIdx]?.text.trim() === '',
        );
    }),
  );

  if (!hasOverfullRows && !hasFullWidthVerticalPlaceholders) {
    return undefined;
  }

  const shadow: boolean[][] = table.grid.map((row) =>
    new Array(row.length).fill(false),
  );

  for (let rowIndex = 0; rowIndex < table.grid.length; rowIndex++) {
    const row = table.grid[rowIndex];
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      if (shadow[rowIndex]?.[colIndex]) continue;

      const cell = row[colIndex];
      if (!cell) continue;

      for (let rowOffset = 0; rowOffset < getCellRowSpan(cell); rowOffset++) {
        for (let colOffset = 0; colOffset < getCellColSpan(cell); colOffset++) {
          if (rowOffset === 0 && colOffset === 0) continue;

          const shadowRow = rowIndex + rowOffset;
          const shadowCol = colIndex + colOffset;
          if (
            shadowRow < table.grid.length &&
            shadowCol < table.grid[shadowRow].length
          ) {
            shadow[shadowRow][shadowCol] = true;
          }
        }
      }
    }
  }

  return shadow;
}

export function TableViewer({ tableIds, tableMap }: TableViewerProps) {
  const resolvedTables = resolveTableIds(tableIds, tableMap);

  if (resolvedTables.length === 0) return null;

  return (
    <section className="space-y-6">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Table2 className="h-4 w-4" />
        Tables
        <Badge variant="secondary">{resolvedTables.length}</Badge>
      </h3>
      {resolvedTables.map((table) => {
        const shadowMap = computeShadowMap(table);

        return (
          <div key={table.id} className="space-y-2">
            {table.caption && (
              <div className="text-sm">
                {table.caption.num && (
                  <span className="font-medium">{table.caption.num}: </span>
                )}
                <span className="text-muted-foreground">
                  {table.caption.fullText}
                </span>
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border">
              <Table className="border-collapse">
                <TableBody>
                  {table.grid.map((row, rowIdx) => (
                    <TableRow key={rowIdx}>
                      {row.map((cell, colIdx) => {
                        if (shadowMap?.[rowIdx]?.[colIdx]) return null;

                        const CellComponent = cell.isHeader
                          ? TableHead
                          : TableCell;
                        return (
                          <CellComponent
                            key={`${rowIdx}-${colIdx}`}
                            rowSpan={
                              getCellRowSpan(cell) > 1
                                ? getCellRowSpan(cell)
                                : undefined
                            }
                            colSpan={
                              getCellColSpan(cell) > 1
                                ? getCellColSpan(cell)
                                : undefined
                            }
                            className={
                              cell.isHeader
                                ? 'bg-muted/50 min-w-20 border-r align-top font-medium last:border-r-0'
                                : 'min-w-20 border-r align-top last:border-r-0'
                            }
                          >
                            {cell.text}
                          </CellComponent>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <p className="text-muted-foreground text-xs">
              {table.numRows} rows x {table.numCols} columns |{' '}
              <PageLink pageNo={table.pdfPageNo} pageType="pdf">
                PDF page {table.pdfPageNo}
              </PageLink>
            </p>
          </div>
        );
      })}
    </section>
  );
}
