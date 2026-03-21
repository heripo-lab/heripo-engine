import type { LoggerMethods } from '@heripo/logger';
import type {
  DoclingDocument,
  ProcessedFootnote,
  ProcessedImage,
  ProcessedTable,
  ProcessedTableCell,
} from '@heripo/model';

import type { CaptionProcessingPipeline } from '../pipelines';
import type { IdGenerator } from '../utils';

import { TextCleaner } from '../utils';

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
    outputPath: string,
  ): Promise<{
    images: ProcessedImage[];
    tables: ProcessedTable[];
    footnotes: ProcessedFootnote[];
  }> {
    this.logger.info(
      '[ResourceConverter] Converting images, tables, and footnotes...',
    );

    const [images, tables] = await Promise.all([
      this.convertImages(doclingDoc, outputPath),
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
    outputPath: string,
  ): Promise<ProcessedImage[]> {
    this.logger.info(
      `[ResourceConverter] Converting ${doclingDoc.pictures.length} images...`,
    );

    const images: ProcessedImage[] = [];
    const captionTexts: Array<string | undefined> = [];

    for (const picture of doclingDoc.pictures) {
      const pdfPageNo = picture.prov?.[0]?.page_no ?? 0;
      const imageId = this.idGenerator.generateImageId();

      const captionText = this.captionProcessingPipeline.extractCaptionText(
        picture.captions,
      );
      captionTexts.push(captionText);

      images.push({
        id: imageId,
        path: `${outputPath}/images/image_${images.length}.png`,
        pdfPageNo,
      });
    }

    const captionsByIndex =
      await this.captionProcessingPipeline.processResourceCaptions(
        captionTexts,
        'image',
      );

    for (let i = 0; i < images.length; i++) {
      if (captionsByIndex.has(i)) {
        images[i].caption = captionsByIndex.get(i);
      }
    }

    return images;
  }

  /**
   * Convert tables from DoclingDocument to ProcessedTable[]
   */
  async convertTables(doclingDoc: DoclingDocument): Promise<ProcessedTable[]> {
    this.logger.info(
      `[ResourceConverter] Converting ${doclingDoc.tables.length} tables...`,
    );

    const tables: ProcessedTable[] = [];
    const captionTexts: Array<string | undefined> = [];

    for (const table of doclingDoc.tables) {
      const pdfPageNo = table.prov?.[0]?.page_no ?? 0;
      const tableId = this.idGenerator.generateTableId();

      const grid: ProcessedTableCell[][] = table.data.grid.map((row) =>
        row.map((cell) => ({
          text: cell.text,
          rowSpan: cell.row_span ?? 1,
          colSpan: cell.col_span ?? 1,
          isHeader: cell.column_header || cell.row_header || false,
        })),
      );

      const captionText = this.captionProcessingPipeline.extractCaptionText(
        table.captions,
      );
      captionTexts.push(captionText);

      tables.push({
        id: tableId,
        pdfPageNo,
        numRows: grid.length,
        numCols: grid[0]?.length ?? 0,
        grid,
      });
    }

    const captionsByIndex =
      await this.captionProcessingPipeline.processResourceCaptions(
        captionTexts,
        'table',
      );

    for (let i = 0; i < tables.length; i++) {
      if (captionsByIndex.has(i)) {
        tables[i].caption = captionsByIndex.get(i);
      }
    }

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

    const footnotes: ProcessedFootnote[] = [];

    for (const item of footnoteItems) {
      if (!TextCleaner.isValidText(item.text)) {
        continue;
      }

      const pdfPageNo = item.prov?.[0]?.page_no ?? 1;
      const footnoteId = this.idGenerator.generateFootnoteId();

      footnotes.push({
        id: footnoteId,
        text: TextCleaner.normalize(item.text),
        pdfPageNo,
      });
    }

    this.logger.info(
      `[ResourceConverter] Converted ${footnotes.length} valid footnotes`,
    );

    return footnotes;
  }
}
