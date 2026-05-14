import type { LoggerMethods } from '@heripo/logger';
import type {
  DoclingDocument,
  DoclingTableCell,
  DoclingTableItem,
  ProcessedFootnote,
  ProcessedImage,
  ProcessedTable,
  ProcessedTableCell,
} from '@heripo/model';

import type { CaptionProcessingPipeline } from '../pipelines';
import type { IdGenerator } from '../utils';

import { TextCleaner } from '../utils';

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function getRowSpan(cell: DoclingTableCell): number {
  const startRow = getFiniteNumber(cell.start_row_offset_idx);
  const endRow = getFiniteNumber(cell.end_row_offset_idx);
  const offsetSpan =
    startRow !== undefined && endRow !== undefined ? endRow - startRow : 0;

  return Math.max(1, offsetSpan || getFiniteNumber(cell.row_span) || 1);
}

function getColSpan(cell: DoclingTableCell): number {
  const startCol = getFiniteNumber(cell.start_col_offset_idx);
  const endCol = getFiniteNumber(cell.end_col_offset_idx);
  const offsetSpan =
    startCol !== undefined && endCol !== undefined ? endCol - startCol : 0;

  return Math.max(1, offsetSpan || getFiniteNumber(cell.col_span) || 1);
}

function convertTableCell(cell: DoclingTableCell): ProcessedTableCell {
  return {
    text: cell.text ?? '',
    rowSpan: getRowSpan(cell),
    colSpan: getColSpan(cell),
    isHeader: cell.column_header || cell.row_header || false,
  };
}

function getAnchorColumn(
  cell: DoclingTableCell,
  rowIndex: number,
  colIndex: number,
): number | undefined {
  const startRow = getFiniteNumber(cell.start_row_offset_idx) ?? rowIndex;
  const startCol = getFiniteNumber(cell.start_col_offset_idx) ?? colIndex;

  return startRow === rowIndex ? startCol : undefined;
}

function buildGridFromRawGrid(
  rawGrid: DoclingTableCell[][],
): ProcessedTableCell[][] {
  return rawGrid.map((row, rowIndex) => {
    const cellsByColumn = new Map<number, ProcessedTableCell>();

    row.forEach((cell, colIndex) => {
      const anchorColumn = getAnchorColumn(cell, rowIndex, colIndex);
      if (anchorColumn === undefined || cellsByColumn.has(anchorColumn)) {
        return;
      }

      cellsByColumn.set(anchorColumn, convertTableCell(cell));
    });

    return Array.from(cellsByColumn.entries())
      .sort(([left], [right]) => left - right)
      .map(([, cell]) => cell);
  });
}

function buildGridFromTableCells(
  tableCells: DoclingTableCell[] | undefined,
  rowCount: number,
): ProcessedTableCell[][] {
  if (!tableCells || tableCells.length === 0) return [];

  const maxRow =
    tableCells.reduce(
      (max, cell) =>
        Math.max(max, getFiniteNumber(cell.start_row_offset_idx) ?? 0),
      rowCount - 1,
    ) + 1;
  const rows: Array<Array<{ col: number; cell: ProcessedTableCell }>> =
    Array.from({ length: Math.max(0, maxRow) }, () => []);

  for (const cell of tableCells) {
    const row = getFiniteNumber(cell.start_row_offset_idx) ?? 0;
    const col = getFiniteNumber(cell.start_col_offset_idx) ?? 0;
    if (row < 0 || row >= rows.length) continue;
    rows[row].push({ col, cell: convertTableCell(cell) });
  }

  return rows.map((row) =>
    row.sort((a, b) => a.col - b.col).map(({ cell }) => cell),
  );
}

function getGridColumnCount(grid: ProcessedTableCell[][]): number {
  return grid.reduce(
    (max, row) =>
      Math.max(
        max,
        row.reduce((sum, cell) => sum + Math.max(1, cell.colSpan), 0),
      ),
    0,
  );
}

function buildProcessedTableGrid(table: DoclingTableItem): {
  grid: ProcessedTableCell[][];
  numRows: number;
  numCols: number;
} {
  const rawGrid = table.data.grid ?? [];
  const rawNumRows = getFiniteNumber(table.data.num_rows);
  const rawNumCols = getFiniteNumber(table.data.num_cols);
  const grid =
    rawGrid.length > 0
      ? buildGridFromRawGrid(rawGrid)
      : buildGridFromTableCells(table.data.table_cells, rawNumRows ?? 0);

  return {
    grid,
    numRows:
      rawNumRows !== undefined && rawNumRows > 0 ? rawNumRows : grid.length,
    numCols:
      rawNumCols !== undefined && rawNumCols > 0
        ? rawNumCols
        : getGridColumnCount(grid),
  };
}

/**
 * ResourceConverter
 *
 * Converts DoclingDocument resources (images, tables, footnotes) to processed format.
 * Uses CaptionProcessingPipeline for caption extraction and validation.
 */
export class ResourceConverter {
  private readonly logger: LoggerMethods;
  private readonly idGenerator: IdGenerator;
  private readonly captionProcessingPipeline: CaptionProcessingPipeline;

  constructor(
    logger: LoggerMethods,
    idGenerator: IdGenerator,
    captionProcessingPipeline: CaptionProcessingPipeline,
  ) {
    this.logger = logger;
    this.idGenerator = idGenerator;
    this.captionProcessingPipeline = captionProcessingPipeline;
  }

  /**
   * Convert all resources (images, tables, footnotes)
   *
   * Runs image and table conversions in parallel, then footnotes synchronously.
   */
  async convertAll(
    doclingDoc: DoclingDocument,
    artifactDir: string,
  ): Promise<{
    images: ProcessedImage[];
    tables: ProcessedTable[];
    footnotes: ProcessedFootnote[];
  }> {
    this.logger.info(
      '[ResourceConverter] Converting images, tables, and footnotes...',
    );

    const [images, tables] = await Promise.all([
      this.convertImages(doclingDoc, artifactDir),
      this.convertTables(doclingDoc),
    ]);

    const footnotes = this.convertFootnotes(doclingDoc);

    this.logger.info(
      `[ResourceConverter] Converted ${images.length} images, ${tables.length} tables, and ${footnotes.length} footnotes`,
    );

    return { images, tables, footnotes };
  }

  /**
   * Convert images from DoclingDocument to ProcessedImage[]
   */
  async convertImages(
    doclingDoc: DoclingDocument,
    artifactDir: string,
  ): Promise<ProcessedImage[]> {
    this.logger.info(
      `[ResourceConverter] Converting ${doclingDoc.pictures.length} images...`,
    );

    const captionSources = doclingDoc.pictures.map((picture) =>
      this.captionProcessingPipeline.extractCaptionSource(picture.captions),
    );
    const captionTexts = captionSources.map(
      (captionSource) => captionSource.text,
    );

    const images: ProcessedImage[] = doclingDoc.pictures.map(
      (picture, index) => ({
        id: this.idGenerator.generateImageId(),
        sourceRef: picture.self_ref,
        captionSourceRefs: captionSources[index].sourceRefs,
        path: `${artifactDir}/images/image_${index}.png`,
        pdfPageNo: picture.prov?.[0]?.page_no ?? 0,
      }),
    );

    const captionsByIndex =
      await this.captionProcessingPipeline.processResourceCaptions(
        captionTexts,
        'image',
      );

    images.forEach((image, i) => {
      if (captionsByIndex.has(i)) {
        image.caption = captionsByIndex.get(i);
      }
    });

    return images;
  }

  /**
   * Convert tables from DoclingDocument to ProcessedTable[]
   */
  async convertTables(doclingDoc: DoclingDocument): Promise<ProcessedTable[]> {
    this.logger.info(
      `[ResourceConverter] Converting ${doclingDoc.tables.length} tables...`,
    );

    const captionSources = doclingDoc.tables.map((table) =>
      this.captionProcessingPipeline.extractCaptionSource(table.captions),
    );
    const captionTexts = captionSources.map(
      (captionSource) => captionSource.text,
    );

    const tables: ProcessedTable[] = doclingDoc.tables.map((table, index) => {
      const { grid, numRows, numCols } = buildProcessedTableGrid(table);

      return {
        id: this.idGenerator.generateTableId(),
        sourceRef: table.self_ref,
        captionSourceRefs: captionSources[index].sourceRefs,
        pdfPageNo: table.prov?.[0]?.page_no ?? 0,
        numRows,
        numCols,
        grid,
      };
    });

    const captionsByIndex =
      await this.captionProcessingPipeline.processResourceCaptions(
        captionTexts,
        'table',
      );

    tables.forEach((table, i) => {
      if (captionsByIndex.has(i)) {
        table.caption = captionsByIndex.get(i);
      }
    });

    return tables;
  }

  /**
   * Convert footnotes from DoclingDocument text items
   */
  convertFootnotes(doclingDoc: DoclingDocument): ProcessedFootnote[] {
    const footnoteItems = doclingDoc.texts.filter(
      (item) => item.label === 'footnote',
    );
    this.logger.info(
      `[ResourceConverter] Converting ${footnoteItems.length} footnotes...`,
    );

    const footnotes: ProcessedFootnote[] = footnoteItems
      .filter((item) => TextCleaner.isValidText(item.text))
      .map((item) => ({
        id: this.idGenerator.generateFootnoteId(),
        sourceRef: item.self_ref,
        text: TextCleaner.normalize(item.text),
        pdfPageNo: item.prov?.[0]?.page_no ?? 1,
      }));

    this.logger.info(
      `[ResourceConverter] Converted ${footnotes.length} valid footnotes`,
    );

    return footnotes;
  }
}
