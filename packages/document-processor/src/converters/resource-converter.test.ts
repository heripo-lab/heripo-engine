import type { LoggerMethods } from '@heripo/logger';
import type { DoclingDocument } from '@heripo/model';

import type { CaptionProcessingPipeline } from '../pipelines';
import type { IdGenerator } from '../utils';

import { describe, expect, test, vi } from 'vitest';

import { ResourceConverter } from './resource-converter';

function createMockLogger(): LoggerMethods {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as LoggerMethods;
}

function createMockIdGenerator(overrides?: Partial<IdGenerator>): IdGenerator {
  return {
    generateImageId: vi.fn(() => 'img-001'),
    generateTableId: vi.fn(() => 'tbl-001'),
    generateFootnoteId: vi.fn(() => 'ftn-001'),
    generateChapterId: vi.fn(() => 'ch-001'),
    generateTextBlockId: vi.fn(() => 'txt-001'),
    ...overrides,
  } as unknown as IdGenerator;
}

function createMockCaptionPipeline(
  overrides?: Partial<CaptionProcessingPipeline>,
): CaptionProcessingPipeline {
  return {
    extractCaptionSource: vi
      .fn()
      .mockReturnValue({ text: undefined, sourceRefs: [] }),
    processResourceCaptions: vi.fn().mockResolvedValue(new Map<number, any>()),
    ...overrides,
  } as unknown as CaptionProcessingPipeline;
}

describe('ResourceConverter', () => {
  describe('convertImages', () => {
    test('handles image without prov property (defaults to page 0)', async () => {
      const logger = createMockLogger();
      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        createMockCaptionPipeline(),
      );

      const mockDoc = {
        pictures: [
          {
            self_ref: '#/pictures/0',
            label: 'picture',
            children: [],
            captions: [],
          },
        ],
      } as unknown as DoclingDocument;

      const result = await converter.convertImages(mockDoc, '/path');

      expect(result).toHaveLength(1);
      expect(result[0].pdfPageNo).toBe(0);
    });

    test('handles image with empty prov array (defaults to page 0)', async () => {
      const logger = createMockLogger();
      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        createMockCaptionPipeline(),
      );

      const mockDoc = {
        pictures: [
          {
            self_ref: '#/pictures/0',
            label: 'picture',
            prov: [],
            children: [],
            captions: [],
          },
        ],
      } as unknown as DoclingDocument;

      const result = await converter.convertImages(mockDoc, '/path');

      expect(result).toHaveLength(1);
      expect(result[0].pdfPageNo).toBe(0);
    });

    test('processes images with captions', async () => {
      const logger = createMockLogger();
      const captionPipeline = createMockCaptionPipeline({
        extractCaptionSource: vi.fn().mockReturnValue({
          text: 'Figure 1: Test image',
          sourceRefs: [],
        }),
        processResourceCaptions: vi
          .fn()
          .mockResolvedValue(
            new Map<number, any>([
              [0, { fullText: 'Figure 1: Test image', num: 'Figure 1' }],
            ]),
          ),
      });

      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        captionPipeline,
      );

      const mockDoc = {
        pictures: [
          {
            self_ref: '#/pictures/0',
            label: 'picture',
            prov: [{ page_no: 1 }],
            children: [],
            captions: ['Figure 1: Test image'],
          },
        ],
      } as unknown as DoclingDocument;

      const result = await converter.convertImages(mockDoc, '/path');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('img-001');
      expect(result[0].sourceRef).toBe('#/pictures/0');
      expect(result[0].captionSourceRefs).toEqual([]);
      expect(result[0].caption?.fullText).toBe('Figure 1: Test image');
    });

    test('preserves image caption source refs', async () => {
      const logger = createMockLogger();
      const captionPipeline = createMockCaptionPipeline({
        extractCaptionSource: vi.fn().mockReturnValue({
          text: 'Figure 1: Test image',
          sourceRefs: ['#/texts/7', '#/texts/8'],
        }),
      });

      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        captionPipeline,
      );

      const mockDoc = {
        pictures: [
          {
            self_ref: '#/pictures/0',
            label: 'picture',
            prov: [{ page_no: 1 }],
            children: [],
            captions: [{ $ref: '#/texts/7' }, { $ref: '#/texts/8' }],
          },
        ],
      } as unknown as DoclingDocument;

      const result = await converter.convertImages(mockDoc, '/path');

      expect(result[0].sourceRef).toBe('#/pictures/0');
      expect(result[0].captionSourceRefs).toEqual(['#/texts/7', '#/texts/8']);
      expect(captionPipeline.processResourceCaptions).toHaveBeenCalledWith(
        ['Figure 1: Test image'],
        'image',
      );
    });

    test('processes images without captions', async () => {
      const logger = createMockLogger();
      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        createMockCaptionPipeline(),
      );

      const mockDoc = {
        pictures: [
          {
            self_ref: '#/pictures/0',
            label: 'picture',
            prov: [{ page_no: 2 }],
            children: [],
            captions: [],
          },
        ],
      } as unknown as DoclingDocument;

      const result = await converter.convertImages(mockDoc, '/path');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('img-001');
      expect(result[0].sourceRef).toBe('#/pictures/0');
      expect(result[0].captionSourceRefs).toEqual([]);
      expect(result[0].pdfPageNo).toBe(2);
      expect(result[0].caption).toBeUndefined();
    });

    test('generates correct image paths', async () => {
      const logger = createMockLogger();
      const idGen = createMockIdGenerator({
        generateImageId: vi
          .fn()
          .mockReturnValueOnce('img-001')
          .mockReturnValueOnce('img-002'),
      });

      const converter = new ResourceConverter(
        logger,
        idGen,
        createMockCaptionPipeline(),
      );

      const mockDoc = {
        pictures: [
          {
            self_ref: '#/pictures/0',
            label: 'picture',
            prov: [{ page_no: 1 }],
            children: [],
            captions: [],
          },
          {
            self_ref: '#/pictures/1',
            label: 'picture',
            prov: [{ page_no: 2 }],
            children: [],
            captions: [],
          },
        ],
      } as unknown as DoclingDocument;

      const result = await converter.convertImages(mockDoc, '/output');

      expect(result[0].path).toBe('/output/images/image_0.png');
      expect(result[1].path).toBe('/output/images/image_1.png');
    });
  });

  describe('convertTables', () => {
    test('handles table without prov property (defaults to page 0)', async () => {
      const logger = createMockLogger();
      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        createMockCaptionPipeline(),
      );

      const mockDoc = {
        tables: [
          {
            self_ref: '#/tables/0',
            label: 'table',
            data: {
              num_rows: 1,
              num_cols: 1,
              grid: [[{ text: 'Cell' }]],
            },
          },
        ],
      } as unknown as DoclingDocument;

      const result = await converter.convertTables(mockDoc);

      expect(result).toHaveLength(1);
      expect(result[0].pdfPageNo).toBe(0);
    });

    test('handles table with empty prov array (defaults to page 0)', async () => {
      const logger = createMockLogger();
      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        createMockCaptionPipeline(),
      );

      const mockDoc = {
        tables: [
          {
            self_ref: '#/tables/0',
            label: 'table',
            prov: [],
            data: {
              num_rows: 1,
              num_cols: 1,
              grid: [[{ text: 'Cell' }]],
            },
          },
        ],
      } as unknown as DoclingDocument;

      const result = await converter.convertTables(mockDoc);

      expect(result).toHaveLength(1);
      expect(result[0].pdfPageNo).toBe(0);
    });

    test('handles table with empty grid', async () => {
      const logger = createMockLogger();
      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        createMockCaptionPipeline(),
      );

      const mockDoc = {
        tables: [
          {
            self_ref: '#/tables/0',
            label: 'table',
            prov: [{ page_no: 1 }],
            data: {
              num_rows: 0,
              num_cols: 0,
              grid: [],
            },
          },
        ],
      } as unknown as DoclingDocument;

      const result = await converter.convertTables(mockDoc);

      expect(result).toHaveLength(1);
      expect(result[0].numRows).toBe(0);
      expect(result[0].numCols).toBe(0);
    });

    test('converts grid data with rowSpan, colSpan, isHeader', async () => {
      const logger = createMockLogger();
      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        createMockCaptionPipeline(),
      );

      const mockDoc = {
        tables: [
          {
            self_ref: '#/tables/0',
            label: 'table',
            prov: [{ page_no: 2 }],
            data: {
              num_rows: 2,
              num_cols: 2,
              grid: [
                [
                  {
                    text: 'Header 1',
                    column_header: true,
                    row_span: 1,
                    col_span: 2,
                  },
                  { text: 'Header 2', column_header: true },
                ],
                [{ text: 'Data', row_header: true }, { text: 'Value' }],
              ],
            },
          },
        ],
      } as unknown as DoclingDocument;

      const result = await converter.convertTables(mockDoc);

      expect(result[0].grid[0][0]).toEqual({
        text: 'Header 1',
        rowSpan: 1,
        colSpan: 2,
        isHeader: true,
      });
      expect(result[0].grid[1][0].isHeader).toBe(true); // row_header
      expect(result[0].grid[1][1].isHeader).toBe(false);
      expect(result[0].grid[1][1].rowSpan).toBe(1); // defaults
      expect(result[0].grid[1][1].colSpan).toBe(1);
    });

    test('filters merged-cell shadow entries using Docling offsets', async () => {
      const logger = createMockLogger();
      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        createMockCaptionPipeline(),
      );

      const mockDoc = {
        tables: [
          {
            self_ref: '#/tables/0',
            label: 'table',
            prov: [{ page_no: 2 }],
            captions: [],
            data: {
              num_rows: 2,
              num_cols: 3,
              table_cells: [],
              grid: [
                [
                  {
                    text: 'Row',
                    column_header: false,
                    row_header: true,
                    start_row_offset_idx: 0,
                    end_row_offset_idx: 2,
                    start_col_offset_idx: 0,
                    end_col_offset_idx: 1,
                    row_span: 2,
                    col_span: 1,
                  },
                  {
                    text: 'Group',
                    column_header: true,
                    row_header: false,
                    start_row_offset_idx: 0,
                    end_row_offset_idx: 1,
                    start_col_offset_idx: 1,
                    end_col_offset_idx: 3,
                    row_span: 1,
                    col_span: 2,
                  },
                  {
                    text: 'shadow',
                    column_header: true,
                    row_header: false,
                    start_row_offset_idx: 0,
                    end_row_offset_idx: 1,
                    start_col_offset_idx: 1,
                    end_col_offset_idx: 3,
                    row_span: 1,
                    col_span: 2,
                  },
                ],
                [
                  {
                    text: 'covered',
                    column_header: false,
                    row_header: true,
                    start_row_offset_idx: 0,
                    end_row_offset_idx: 2,
                    start_col_offset_idx: 0,
                    end_col_offset_idx: 1,
                    row_span: 2,
                    col_span: 1,
                  },
                  {
                    text: 'B',
                    column_header: false,
                    row_header: false,
                    start_row_offset_idx: 1,
                    end_row_offset_idx: 2,
                    start_col_offset_idx: 1,
                    end_col_offset_idx: 2,
                    row_span: 1,
                    col_span: 1,
                  },
                  {
                    text: 'C',
                    column_header: false,
                    row_header: false,
                    start_row_offset_idx: 1,
                    end_row_offset_idx: 2,
                    start_col_offset_idx: 2,
                    end_col_offset_idx: 3,
                    row_span: 1,
                    col_span: 1,
                  },
                ],
              ],
            },
          },
        ],
      } as unknown as DoclingDocument;

      const result = await converter.convertTables(mockDoc);

      expect(result[0].numRows).toBe(2);
      expect(result[0].numCols).toBe(3);
      expect(result[0].grid).toEqual([
        [
          {
            text: 'Row',
            rowSpan: 2,
            colSpan: 1,
            isHeader: true,
          },
          {
            text: 'Group',
            rowSpan: 1,
            colSpan: 2,
            isHeader: true,
          },
        ],
        [
          {
            text: 'B',
            rowSpan: 1,
            colSpan: 1,
            isHeader: false,
          },
          {
            text: 'C',
            rowSpan: 1,
            colSpan: 1,
            isHeader: false,
          },
        ],
      ]);
    });

    test('keeps compact grid cells even when start offsets skip columns', async () => {
      const logger = createMockLogger();
      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        createMockCaptionPipeline(),
      );

      const mockDoc = {
        tables: [
          {
            self_ref: '#/tables/0',
            label: 'table',
            prov: [{ page_no: 2 }],
            captions: [],
            data: {
              num_rows: 1,
              num_cols: 3,
              table_cells: [],
              grid: [
                [
                  {
                    text: 'A',
                    column_header: false,
                    row_header: false,
                    start_row_offset_idx: 0,
                    end_row_offset_idx: 1,
                    start_col_offset_idx: 0,
                    end_col_offset_idx: 2,
                    row_span: 1,
                    col_span: 2,
                  },
                  {
                    text: 'B',
                    column_header: false,
                    row_header: false,
                    start_row_offset_idx: 0,
                    end_row_offset_idx: 1,
                    start_col_offset_idx: 2,
                    end_col_offset_idx: 3,
                    row_span: 1,
                    col_span: 1,
                  },
                ],
              ],
            },
          },
        ],
      } as unknown as DoclingDocument;

      const result = await converter.convertTables(mockDoc);

      expect(result[0].grid).toEqual([
        [
          { text: 'A', rowSpan: 1, colSpan: 2, isHeader: false },
          { text: 'B', rowSpan: 1, colSpan: 1, isHeader: false },
        ],
      ]);
    });

    test('derives column count from grid colSpans when num_cols is missing', async () => {
      const logger = createMockLogger();
      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        createMockCaptionPipeline(),
      );

      const mockDoc = {
        tables: [
          {
            self_ref: '#/tables/0',
            label: 'table',
            prov: [{ page_no: 2 }],
            captions: [],
            data: {
              num_rows: 1,
              grid: [
                [
                  { text: 'A', col_span: 2 },
                  { text: 'B', col_span: 1 },
                ],
              ],
            },
          },
        ],
      } as unknown as DoclingDocument;

      const result = await converter.convertTables(mockDoc);

      expect(result[0].numCols).toBe(3);
    });

    test('falls back to table_cells when Docling grid is empty', async () => {
      const logger = createMockLogger();
      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        createMockCaptionPipeline(),
      );

      const mockDoc = {
        tables: [
          {
            self_ref: '#/tables/0',
            label: 'table',
            prov: [{ page_no: 2 }],
            captions: [],
            data: {
              num_rows: 2,
              num_cols: 3,
              grid: [],
              table_cells: [
                {
                  text: 'B',
                  column_header: false,
                  row_header: false,
                  start_row_offset_idx: 1,
                  end_row_offset_idx: 2,
                  start_col_offset_idx: 1,
                  end_col_offset_idx: 2,
                },
                {
                  text: 'A',
                  column_header: true,
                  row_header: false,
                  start_row_offset_idx: 0,
                  end_row_offset_idx: 1,
                  start_col_offset_idx: 0,
                  end_col_offset_idx: 3,
                },
              ],
            },
          },
        ],
      } as unknown as DoclingDocument;

      const result = await converter.convertTables(mockDoc);

      expect(result[0].grid).toEqual([
        [{ text: 'A', rowSpan: 1, colSpan: 3, isHeader: true }],
        [{ text: 'B', rowSpan: 1, colSpan: 1, isHeader: false }],
      ]);
    });

    test('uses defensive defaults for table_cells when grid and offsets are missing', async () => {
      const logger = createMockLogger();
      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        createMockCaptionPipeline(),
      );

      const mockDoc = {
        tables: [
          {
            self_ref: '#/tables/0',
            label: 'table',
            prov: [{ page_no: 2 }],
            captions: [],
            data: {
              table_cells: [
                {
                  column_header: false,
                  row_header: false,
                },
                {
                  text: 'Second cell',
                  start_row_offset_idx: 0,
                  start_col_offset_idx: 1,
                  column_header: false,
                  row_header: false,
                },
                {
                  text: 'Ignored negative row',
                  start_row_offset_idx: -1,
                  start_col_offset_idx: 0,
                  column_header: false,
                  row_header: false,
                },
              ],
            },
          },
        ],
      } as unknown as DoclingDocument;

      const result = await converter.convertTables(mockDoc);

      expect(result[0].numRows).toBe(1);
      expect(result[0].numCols).toBe(2);
      expect(result[0].grid).toEqual([
        [
          { text: '', rowSpan: 1, colSpan: 1, isHeader: false },
          { text: 'Second cell', rowSpan: 1, colSpan: 1, isHeader: false },
        ],
      ]);
    });

    test('processes tables with captions', async () => {
      const logger = createMockLogger();
      const captionPipeline = createMockCaptionPipeline({
        extractCaptionSource: vi.fn().mockReturnValue({
          text: 'Table 1: Data summary',
          sourceRefs: [],
        }),
        processResourceCaptions: vi
          .fn()
          .mockResolvedValue(
            new Map<number, any>([
              [0, { fullText: 'Table 1: Data summary', num: 'Table 1' }],
            ]),
          ),
      });

      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        captionPipeline,
      );

      const mockDoc = {
        tables: [
          {
            self_ref: '#/tables/0',
            label: 'table',
            prov: [{ page_no: 2 }],
            captions: ['Table 1: Data summary'],
            data: {
              num_rows: 2,
              num_cols: 2,
              grid: [
                [
                  { text: 'Header 1', column_header: true },
                  { text: 'Header 2', column_header: true },
                ],
                [{ text: 'Row 1 Col 1' }, { text: 'Row 1 Col 2' }],
              ],
            },
          },
        ],
      } as unknown as DoclingDocument;

      const result = await converter.convertTables(mockDoc);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('tbl-001');
      expect(result[0].sourceRef).toBe('#/tables/0');
      expect(result[0].captionSourceRefs).toEqual([]);
      expect(result[0].numRows).toBe(2);
      expect(result[0].numCols).toBe(2);
      expect(result[0].caption?.fullText).toBe('Table 1: Data summary');
    });

    test('preserves table caption source refs', async () => {
      const logger = createMockLogger();
      const captionPipeline = createMockCaptionPipeline({
        extractCaptionSource: vi.fn().mockReturnValue({
          text: 'Table 1: Data summary',
          sourceRefs: ['#/texts/10'],
        }),
      });

      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        captionPipeline,
      );

      const mockDoc = {
        tables: [
          {
            self_ref: '#/tables/0',
            label: 'table',
            prov: [{ page_no: 2 }],
            captions: [{ $ref: '#/texts/10' }],
            data: {
              num_rows: 1,
              num_cols: 1,
              grid: [[{ text: 'Cell' }]],
            },
          },
        ],
      } as unknown as DoclingDocument;

      const result = await converter.convertTables(mockDoc);

      expect(result[0].sourceRef).toBe('#/tables/0');
      expect(result[0].captionSourceRefs).toEqual(['#/texts/10']);
      expect(captionPipeline.processResourceCaptions).toHaveBeenCalledWith(
        ['Table 1: Data summary'],
        'table',
      );
    });
  });

  describe('convertFootnotes', () => {
    test('converts valid footnotes', () => {
      const logger = createMockLogger();
      const idGen = createMockIdGenerator({
        generateFootnoteId: vi
          .fn()
          .mockReturnValueOnce('ftn-001')
          .mockReturnValueOnce('ftn-002'),
      });

      const converter = new ResourceConverter(
        logger,
        idGen,
        createMockCaptionPipeline(),
      );

      const mockDoc = {
        texts: [
          {
            self_ref: '#/texts/1',
            text: 'This is a footnote',
            label: 'footnote',
            prov: [{ page_no: 3 }],
          },
          {
            self_ref: '#/texts/2',
            text: 'Another footnote',
            label: 'footnote',
            prov: [{ page_no: 5 }],
          },
          {
            text: 'Regular text',
            label: 'text',
            prov: [{ page_no: 1 }],
          },
        ],
      } as unknown as DoclingDocument;

      const result = converter.convertFootnotes(mockDoc);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('ftn-001');
      expect(result[0].sourceRef).toBe('#/texts/1');
      expect(result[0].text).toBe('This is a footnote');
      expect(result[0].pdfPageNo).toBe(3);
      expect(result[1].sourceRef).toBe('#/texts/2');
      expect(result[1].pdfPageNo).toBe(5);
    });

    test('skips invalid footnotes (numbers only, empty)', () => {
      const logger = createMockLogger();
      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        createMockCaptionPipeline(),
      );

      const mockDoc = {
        texts: [
          {
            text: 'Valid footnote',
            label: 'footnote',
            prov: [{ page_no: 1 }],
          },
          {
            text: '123',
            label: 'footnote',
            prov: [{ page_no: 2 }],
          },
          {
            text: '',
            label: 'footnote',
            prov: [{ page_no: 3 }],
          },
        ],
      } as unknown as DoclingDocument;

      const result = converter.convertFootnotes(mockDoc);

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Valid footnote');
    });

    test('defaults to page 1 when prov is missing', () => {
      const logger = createMockLogger();
      const idGen = createMockIdGenerator({
        generateFootnoteId: vi
          .fn()
          .mockReturnValueOnce('ftn-001')
          .mockReturnValueOnce('ftn-002'),
      });

      const converter = new ResourceConverter(
        logger,
        idGen,
        createMockCaptionPipeline(),
      );

      const mockDoc = {
        texts: [
          {
            text: 'Footnote without prov',
            label: 'footnote',
          },
          {
            text: 'Footnote with empty prov',
            label: 'footnote',
            prov: [],
          },
        ],
      } as unknown as DoclingDocument;

      const result = converter.convertFootnotes(mockDoc);

      expect(result).toHaveLength(2);
      expect(result[0].pdfPageNo).toBe(1);
      expect(result[1].pdfPageNo).toBe(1);
    });

    test('returns empty array when no footnotes exist', () => {
      const logger = createMockLogger();
      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        createMockCaptionPipeline(),
      );

      const mockDoc = {
        texts: [
          {
            text: 'Regular text',
            label: 'text',
            prov: [{ page_no: 1 }],
          },
        ],
      } as unknown as DoclingDocument;

      const result = converter.convertFootnotes(mockDoc);

      expect(result).toHaveLength(0);
    });
  });

  describe('convertAll', () => {
    test('runs image and table conversions in parallel and footnotes synchronously', async () => {
      const logger = createMockLogger();
      const idGen = createMockIdGenerator({
        generateImageId: vi.fn(() => 'img-001'),
        generateTableId: vi.fn(() => 'tbl-001'),
        generateFootnoteId: vi.fn(() => 'ftn-001'),
      });

      const captionPipeline = createMockCaptionPipeline();
      const converter = new ResourceConverter(logger, idGen, captionPipeline);

      const mockDoc = {
        pictures: [
          {
            self_ref: '#/pictures/0',
            label: 'picture',
            prov: [{ page_no: 1 }],
            children: [],
            captions: [],
          },
        ],
        tables: [
          {
            self_ref: '#/tables/0',
            label: 'table',
            prov: [{ page_no: 2 }],
            data: {
              num_rows: 1,
              num_cols: 1,
              grid: [[{ text: 'Cell' }]],
            },
          },
        ],
        texts: [
          {
            text: 'A footnote',
            label: 'footnote',
            prov: [{ page_no: 3 }],
          },
        ],
      } as unknown as DoclingDocument;

      const result = await converter.convertAll(mockDoc, '/output');

      expect(result.images).toHaveLength(1);
      expect(result.tables).toHaveLength(1);
      expect(result.footnotes).toHaveLength(1);
      expect(result.images[0].id).toBe('img-001');
      expect(result.tables[0].id).toBe('tbl-001');
      expect(result.footnotes[0].id).toBe('ftn-001');
    });

    test('logs conversion summary', async () => {
      const logger = createMockLogger();
      const converter = new ResourceConverter(
        logger,
        createMockIdGenerator(),
        createMockCaptionPipeline(),
      );

      const mockDoc = {
        pictures: [],
        tables: [],
        texts: [],
      } as unknown as DoclingDocument;

      await converter.convertAll(mockDoc, '/output');

      expect(logger.info).toHaveBeenCalledWith(
        '[ResourceConverter] Converting images, tables, and footnotes...',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[ResourceConverter] Converted 0 images, 0 tables, and 0 footnotes',
      );
    });
  });
});
