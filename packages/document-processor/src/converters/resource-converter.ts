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
      const grid: ProcessedTableCell[][] = table.data.grid.map((row) =>
        row.map((cell) => ({
          text: cell.text,
          rowSpan: cell.row_span ?? 1,
          colSpan: cell.col_span ?? 1,
          isHeader: cell.column_header || cell.row_header || false,
        })),
      );

      return {
        id: this.idGenerator.generateTableId(),
        sourceRef: table.self_ref,
        captionSourceRefs: captionSources[index].sourceRefs,
        pdfPageNo: table.prov?.[0]?.page_no ?? 0,
        numRows: grid.length,
        numCols: grid[0]?.length ?? 0,
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
