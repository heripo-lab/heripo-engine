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
      {resolvedTables.map((table) => (
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
            <Table>
              <TableBody>
                {table.grid.map((row, rowIdx) => (
                  <TableRow key={rowIdx}>
                    {row.map((cell, colIdx) => {
                      const CellComponent = cell.isHeader
                        ? TableHead
                        : TableCell;
                      return (
                        <CellComponent
                          key={`${rowIdx}-${colIdx}`}
                          rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                          colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                          className={
                            cell.isHeader ? 'bg-muted/50 font-medium' : ''
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
      ))}
    </section>
  );
}
