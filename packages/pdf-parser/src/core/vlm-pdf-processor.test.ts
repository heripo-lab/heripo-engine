import type { DoclingDocument } from '@heripo/model';

import type { VlmPageResult } from '../types/vlm-page-result';

import { spawnAsync } from '@heripo/shared';
import { type Mock, beforeEach, describe, expect, test, vi } from 'vitest';

import { VlmPdfProcessor } from './vlm-pdf-processor';

vi.mock('@heripo/shared', () => ({
  spawnAsync: vi.fn(),
}));

const mockSpawnAsync = spawnAsync as Mock;

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockModel = { modelId: 'test-model' } as any;

/** Create a mock PageRenderer */
function createMockPageRenderer(pageCount: number = 2, pageFiles?: string[]) {
  const files =
    pageFiles ??
    Array.from(
      { length: pageCount },
      (_, i) => `/tmp/output/pages/page_${i}.png`,
    );
  return {
    renderPages: vi.fn().mockResolvedValue({
      pageCount,
      pagesDir: '/tmp/output/pages',
      pageFiles: files,
    }),
  };
}

/** Create a mock VlmPageProcessor */
function createMockVlmPageProcessor(results?: VlmPageResult[]) {
  return {
    processPages: vi.fn().mockResolvedValue(
      results ?? [
        {
          pageNo: 1,
          elements: [{ type: 'text', content: 'Hello', order: 0 }],
        },
      ],
    ),
  };
}

/** Create a mock DoclingDocumentAssembler */
function createMockAssembler(doc?: Partial<DoclingDocument>) {
  const defaultDoc: DoclingDocument = {
    schema_name: 'DoclingDocument',
    version: '1.0.0',
    name: 'test',
    origin: {
      mimetype: 'application/pdf',
      binary_hash: 0,
      filename: 'test.pdf',
    },
    furniture: {
      self_ref: '#/furniture',
      name: '_root_',
      label: 'unspecified',
      children: [],
      content_layer: 'furniture',
    },
    body: {
      self_ref: '#/body',
      name: '_root_',
      label: 'unspecified',
      children: [],
      content_layer: 'body',
    },
    groups: [],
    texts: [],
    pictures: [],
    tables: [],
    pages: {},
  };
  return {
    assemble: vi.fn().mockReturnValue({ ...defaultDoc, ...doc }),
  };
}

/** Create a mock VlmImageExtractor */
function createMockImageExtractor(imageFiles?: string[]) {
  return {
    extractImages: vi
      .fn()
      .mockResolvedValue(imageFiles ?? ['/tmp/output/images/image_0.png']),
  };
}

/** Create a mock VlmDocumentBuilder */
function createMockDocumentBuilder(doc?: Partial<DoclingDocument>) {
  const defaultDoc: DoclingDocument = {
    schema_name: 'DoclingDocument',
    version: '1.0.0',
    name: 'test',
    origin: {
      mimetype: 'application/pdf',
      binary_hash: 0,
      filename: 'test.pdf',
    },
    furniture: {
      self_ref: '#/furniture',
      name: '_root_',
      label: 'unspecified',
      children: [],
      content_layer: 'furniture',
    },
    body: {
      self_ref: '#/body',
      name: '_root_',
      label: 'unspecified',
      children: [],
      content_layer: 'body',
    },
    groups: [],
    texts: [],
    pictures: [],
    tables: [],
    pages: {},
  };
  return {
    build: vi.fn().mockReturnValue({ ...defaultDoc, ...doc }),
  };
}

/** Helper to set up magick identify responses for page dimensions */
function mockPageDimensions(dimensions: [number, number][]) {
  for (const [width, height] of dimensions) {
    mockSpawnAsync.mockResolvedValueOnce({
      code: 0,
      stdout: `${width} ${height}`,
      stderr: '',
    });
  }
}

describe('VlmPdfProcessor', () => {
  let mockPageRenderer: ReturnType<typeof createMockPageRenderer>;
  let mockVlmPageProcessor: ReturnType<typeof createMockVlmPageProcessor>;
  let mockAssembler: ReturnType<typeof createMockAssembler>;
  let mockImageExtractor: ReturnType<typeof createMockImageExtractor>;
  let mockDocumentBuilder: ReturnType<typeof createMockDocumentBuilder>;
  let processor: VlmPdfProcessor;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPageRenderer = createMockPageRenderer();
    mockVlmPageProcessor = createMockVlmPageProcessor();
    mockAssembler = createMockAssembler();
    mockImageExtractor = createMockImageExtractor();
    mockDocumentBuilder = createMockDocumentBuilder();

    // Default: magick identify returns 1000x1500 for all pages
    mockSpawnAsync.mockResolvedValue({
      code: 0,
      stdout: '1000 1500',
      stderr: '',
    });

    processor = new VlmPdfProcessor(
      mockLogger,
      mockPageRenderer as any,
      mockVlmPageProcessor as any,
      mockAssembler as any,
      mockImageExtractor as any,
      mockDocumentBuilder as any,
    );
  });

  describe('process', () => {
    test('executes all pipeline steps in correct order', async () => {
      const callOrder: string[] = [];
      mockPageRenderer.renderPages.mockImplementation(async () => {
        callOrder.push('renderPages');
        return {
          pageCount: 1,
          pagesDir: '/tmp/output/pages',
          pageFiles: ['/tmp/output/pages/page_0.png'],
        };
      });
      mockVlmPageProcessor.processPages.mockImplementation(async () => {
        callOrder.push('processPages');
        return [{ pageNo: 1, elements: [] }];
      });
      mockSpawnAsync.mockImplementation(async () => {
        callOrder.push('getPageDimensions');
        return { code: 0, stdout: '1000 1500', stderr: '' };
      });
      mockAssembler.assemble.mockImplementation(() => {
        callOrder.push('assemble');
        return createMockAssembler().assemble();
      });
      mockImageExtractor.extractImages.mockImplementation(async () => {
        callOrder.push('extractImages');
        return [];
      });
      mockDocumentBuilder.build.mockImplementation(() => {
        callOrder.push('build');
        return createMockDocumentBuilder().build();
      });

      await processor.process(
        '/tmp/test.pdf',
        '/tmp/output',
        'test.pdf',
        mockModel,
      );

      expect(callOrder).toEqual([
        'renderPages',
        'processPages',
        'getPageDimensions',
        'assemble',
        'extractImages',
        'build',
      ]);
    });

    test('passes pdfPath and outputDir to PageRenderer', async () => {
      await processor.process(
        '/tmp/test.pdf',
        '/tmp/output',
        'test.pdf',
        mockModel,
      );

      expect(mockPageRenderer.renderPages).toHaveBeenCalledWith(
        '/tmp/test.pdf',
        '/tmp/output',
        { dpi: undefined },
      );
    });

    test('passes custom renderDpi to PageRenderer', async () => {
      await processor.process(
        '/tmp/test.pdf',
        '/tmp/output',
        'test.pdf',
        mockModel,
        { renderDpi: 300 },
      );

      expect(mockPageRenderer.renderPages).toHaveBeenCalledWith(
        '/tmp/test.pdf',
        '/tmp/output',
        { dpi: 300 },
      );
    });

    test('passes pageFiles and model to VlmPageProcessor', async () => {
      await processor.process(
        '/tmp/test.pdf',
        '/tmp/output',
        'test.pdf',
        mockModel,
      );

      expect(mockVlmPageProcessor.processPages).toHaveBeenCalledWith(
        ['/tmp/output/pages/page_0.png', '/tmp/output/pages/page_1.png'],
        mockModel,
        expect.objectContaining({
          concurrency: undefined,
          maxRetries: undefined,
          temperature: undefined,
        }),
      );
    });

    test('passes processing options to VlmPageProcessor', async () => {
      const abortController = new AbortController();
      const fallbackModel = { modelId: 'fallback' } as any;
      const aggregator = { track: vi.fn() } as any;

      await processor.process(
        '/tmp/test.pdf',
        '/tmp/output',
        'test.pdf',
        mockModel,
        {
          concurrency: 3,
          maxRetries: 5,
          temperature: 0.5,
          abortSignal: abortController.signal,
          fallbackModel,
          aggregator,
        },
      );

      expect(mockVlmPageProcessor.processPages).toHaveBeenCalledWith(
        expect.any(Array),
        mockModel,
        {
          concurrency: 3,
          maxRetries: 5,
          temperature: 0.5,
          abortSignal: abortController.signal,
          fallbackModel,
          aggregator,
        },
      );
    });

    test('strips file extension for document name', async () => {
      await processor.process(
        '/tmp/test.pdf',
        '/tmp/output',
        'my-report.pdf',
        mockModel,
      );

      expect(mockAssembler.assemble).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          name: 'my-report',
          filename: 'my-report.pdf',
        }),
      );
    });

    test('passes page dimensions to assembler metadata', async () => {
      mockPageRenderer = createMockPageRenderer(2);
      processor = new VlmPdfProcessor(
        mockLogger,
        mockPageRenderer as any,
        mockVlmPageProcessor as any,
        mockAssembler as any,
        mockImageExtractor as any,
        mockDocumentBuilder as any,
      );

      mockSpawnAsync
        .mockResolvedValueOnce({ code: 0, stdout: '800 1200', stderr: '' })
        .mockResolvedValueOnce({ code: 0, stdout: '1000 1500', stderr: '' });

      await processor.process(
        '/tmp/test.pdf',
        '/tmp/output',
        'test.pdf',
        mockModel,
      );

      const metadata = mockAssembler.assemble.mock.calls[0][1];
      expect(metadata.pageDimensions.get(1)).toEqual({
        width: 800,
        height: 1200,
      });
      expect(metadata.pageDimensions.get(2)).toEqual({
        width: 1000,
        height: 1500,
      });
    });

    test('passes page results to assembler', async () => {
      const pageResults: VlmPageResult[] = [
        { pageNo: 1, elements: [{ type: 'text', content: 'Hello', order: 0 }] },
        { pageNo: 2, elements: [{ type: 'text', content: 'World', order: 0 }] },
      ];
      mockVlmPageProcessor.processPages.mockResolvedValue(pageResults);

      await processor.process(
        '/tmp/test.pdf',
        '/tmp/output',
        'test.pdf',
        mockModel,
      );

      expect(mockAssembler.assemble).toHaveBeenCalledWith(
        pageResults,
        expect.any(Object),
      );
    });

    test('passes picture locations to image extractor', async () => {
      const pageResults: VlmPageResult[] = [
        {
          pageNo: 1,
          elements: [
            {
              type: 'picture',
              content: '',
              order: 0,
              bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 },
            },
          ],
        },
      ];
      mockVlmPageProcessor.processPages.mockResolvedValue(pageResults);

      await processor.process(
        '/tmp/test.pdf',
        '/tmp/output',
        'test.pdf',
        mockModel,
      );

      expect(mockImageExtractor.extractImages).toHaveBeenCalledWith(
        expect.any(Array),
        [{ pageNo: 1, bbox: { l: 0.1, t: 0.2, r: 0.9, b: 0.8 } }],
        '/tmp/output',
      );
    });

    test('passes assembled doc, pageFiles and imageFiles to document builder', async () => {
      const assembledDoc = createMockAssembler().assemble();
      mockAssembler.assemble.mockReturnValue(assembledDoc);
      mockImageExtractor.extractImages.mockResolvedValue([
        '/tmp/output/images/image_0.png',
      ]);

      await processor.process(
        '/tmp/test.pdf',
        '/tmp/output',
        'test.pdf',
        mockModel,
      );

      expect(mockDocumentBuilder.build).toHaveBeenCalledWith(
        assembledDoc,
        ['/tmp/output/pages/page_0.png', '/tmp/output/pages/page_1.png'],
        ['/tmp/output/images/image_0.png'],
      );
    });

    test('returns the final document from document builder', async () => {
      const finalDoc = createMockDocumentBuilder({ name: 'final' }).build();
      mockDocumentBuilder.build.mockReturnValue(finalDoc);

      const result = await processor.process(
        '/tmp/test.pdf',
        '/tmp/output',
        'test.pdf',
        mockModel,
      );

      expect(result.document).toBe(finalDoc);
    });

    test('logs start and completion messages', async () => {
      await processor.process(
        '/tmp/test.pdf',
        '/tmp/output',
        'test.pdf',
        mockModel,
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VlmPdfProcessor] Starting VLM-based PDF processing...',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VlmPdfProcessor] Rendered 2 pages',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[VlmPdfProcessor] VLM processing complete',
      );
    });

    test('propagates PageRenderer errors', async () => {
      mockPageRenderer.renderPages.mockRejectedValue(
        new Error('Render failed'),
      );

      await expect(
        processor.process(
          '/tmp/test.pdf',
          '/tmp/output',
          'test.pdf',
          mockModel,
        ),
      ).rejects.toThrow('Render failed');
    });

    test('propagates VlmPageProcessor errors', async () => {
      mockVlmPageProcessor.processPages.mockRejectedValue(
        new Error('VLM failed'),
      );

      await expect(
        processor.process(
          '/tmp/test.pdf',
          '/tmp/output',
          'test.pdf',
          mockModel,
        ),
      ).rejects.toThrow('VLM failed');
    });

    test('propagates image extractor errors', async () => {
      mockImageExtractor.extractImages.mockRejectedValue(
        new Error('Extract failed'),
      );

      await expect(
        processor.process(
          '/tmp/test.pdf',
          '/tmp/output',
          'test.pdf',
          mockModel,
        ),
      ).rejects.toThrow('Extract failed');
    });
  });

  describe('extractPictureLocations', () => {
    test('returns empty array for no pages', () => {
      const result = processor.extractPictureLocations([]);
      expect(result).toEqual([]);
    });

    test('returns empty array when no picture elements', () => {
      const result = processor.extractPictureLocations([
        {
          pageNo: 1,
          elements: [
            { type: 'text', content: 'Hello', order: 0 },
            { type: 'section_header', content: 'Title', order: 1, level: 1 },
          ],
        },
      ]);
      expect(result).toEqual([]);
    });

    test('collects picture elements with bounding boxes', () => {
      const bbox = { l: 0.1, t: 0.2, r: 0.9, b: 0.8 };
      const result = processor.extractPictureLocations([
        {
          pageNo: 1,
          elements: [
            { type: 'picture', content: '', order: 0, bbox },
            { type: 'text', content: 'Caption', order: 1 },
          ],
        },
      ]);

      expect(result).toEqual([{ pageNo: 1, bbox }]);
    });

    test('skips picture elements without bounding boxes', () => {
      const result = processor.extractPictureLocations([
        {
          pageNo: 1,
          elements: [{ type: 'picture', content: '', order: 0 }],
        },
      ]);

      expect(result).toEqual([]);
    });

    test('collects pictures from multiple pages', () => {
      const bbox1 = { l: 0.1, t: 0.1, r: 0.5, b: 0.5 };
      const bbox2 = { l: 0.2, t: 0.3, r: 0.8, b: 0.9 };

      const result = processor.extractPictureLocations([
        {
          pageNo: 1,
          elements: [{ type: 'picture', content: '', order: 0, bbox: bbox1 }],
        },
        {
          pageNo: 2,
          elements: [{ type: 'picture', content: '', order: 0, bbox: bbox2 }],
        },
      ]);

      expect(result).toEqual([
        { pageNo: 1, bbox: bbox1 },
        { pageNo: 2, bbox: bbox2 },
      ]);
    });

    test('collects multiple pictures from same page', () => {
      const bbox1 = { l: 0.1, t: 0.1, r: 0.5, b: 0.4 };
      const bbox2 = { l: 0.1, t: 0.5, r: 0.5, b: 0.9 };

      const result = processor.extractPictureLocations([
        {
          pageNo: 1,
          elements: [
            { type: 'picture', content: '', order: 0, bbox: bbox1 },
            { type: 'text', content: 'Between', order: 1 },
            { type: 'picture', content: '', order: 2, bbox: bbox2 },
          ],
        },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ pageNo: 1, bbox: bbox1 });
      expect(result[1]).toEqual({ pageNo: 1, bbox: bbox2 });
    });
  });

  describe('getPageDimensions (via process)', () => {
    test('calls magick identify for each page file', async () => {
      mockPageRenderer = createMockPageRenderer(3);
      processor = new VlmPdfProcessor(
        mockLogger,
        mockPageRenderer as any,
        mockVlmPageProcessor as any,
        mockAssembler as any,
        mockImageExtractor as any,
        mockDocumentBuilder as any,
      );

      mockPageDimensions([
        [800, 1200],
        [1000, 1500],
        [900, 1350],
      ]);

      await processor.process(
        '/tmp/test.pdf',
        '/tmp/output',
        'test.pdf',
        mockModel,
      );

      expect(mockSpawnAsync).toHaveBeenCalledTimes(3);
      expect(mockSpawnAsync).toHaveBeenCalledWith('magick', [
        'identify',
        '-format',
        '%w %h',
        '/tmp/output/pages/page_0.png',
      ]);
      expect(mockSpawnAsync).toHaveBeenCalledWith('magick', [
        'identify',
        '-format',
        '%w %h',
        '/tmp/output/pages/page_1.png',
      ]);
      expect(mockSpawnAsync).toHaveBeenCalledWith('magick', [
        'identify',
        '-format',
        '%w %h',
        '/tmp/output/pages/page_2.png',
      ]);
    });

    test('skips page dimension when magick fails', async () => {
      mockPageRenderer = createMockPageRenderer(2);
      processor = new VlmPdfProcessor(
        mockLogger,
        mockPageRenderer as any,
        mockVlmPageProcessor as any,
        mockAssembler as any,
        mockImageExtractor as any,
        mockDocumentBuilder as any,
      );

      mockSpawnAsync
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'error' })
        .mockResolvedValueOnce({ code: 0, stdout: '1000 1500', stderr: '' });

      await processor.process(
        '/tmp/test.pdf',
        '/tmp/output',
        'test.pdf',
        mockModel,
      );

      const metadata = mockAssembler.assemble.mock.calls[0][1];
      expect(metadata.pageDimensions.has(1)).toBe(false);
      expect(metadata.pageDimensions.get(2)).toEqual({
        width: 1000,
        height: 1500,
      });
    });

    test('skips page dimension when stdout is empty', async () => {
      mockPageRenderer = createMockPageRenderer(1);
      processor = new VlmPdfProcessor(
        mockLogger,
        mockPageRenderer as any,
        mockVlmPageProcessor as any,
        mockAssembler as any,
        mockImageExtractor as any,
        mockDocumentBuilder as any,
      );

      mockSpawnAsync.mockResolvedValueOnce({
        code: 0,
        stdout: '',
        stderr: '',
      });

      await processor.process(
        '/tmp/test.pdf',
        '/tmp/output',
        'test.pdf',
        mockModel,
      );

      const metadata = mockAssembler.assemble.mock.calls[0][1];
      expect(metadata.pageDimensions.size).toBe(0);
    });

    test('skips page dimension when parsed values are NaN', async () => {
      mockPageRenderer = createMockPageRenderer(1);
      processor = new VlmPdfProcessor(
        mockLogger,
        mockPageRenderer as any,
        mockVlmPageProcessor as any,
        mockAssembler as any,
        mockImageExtractor as any,
        mockDocumentBuilder as any,
      );

      mockSpawnAsync.mockResolvedValueOnce({
        code: 0,
        stdout: 'invalid data',
        stderr: '',
      });

      await processor.process(
        '/tmp/test.pdf',
        '/tmp/output',
        'test.pdf',
        mockModel,
      );

      const metadata = mockAssembler.assemble.mock.calls[0][1];
      expect(metadata.pageDimensions.size).toBe(0);
    });

    test('handles no pages (empty pageFiles)', async () => {
      mockPageRenderer = createMockPageRenderer(0);
      mockVlmPageProcessor = createMockVlmPageProcessor([]);
      processor = new VlmPdfProcessor(
        mockLogger,
        mockPageRenderer as any,
        mockVlmPageProcessor as any,
        mockAssembler as any,
        mockImageExtractor as any,
        mockDocumentBuilder as any,
      );

      await processor.process(
        '/tmp/test.pdf',
        '/tmp/output',
        'test.pdf',
        mockModel,
      );

      expect(mockSpawnAsync).not.toHaveBeenCalled();
      const metadata = mockAssembler.assemble.mock.calls[0][1];
      expect(metadata.pageDimensions.size).toBe(0);
    });
  });

  describe('create', () => {
    test('creates VlmPdfProcessor with default sub-components', () => {
      const instance = VlmPdfProcessor.create(mockLogger);
      expect(instance).toBeInstanceOf(VlmPdfProcessor);
    });
  });
});
