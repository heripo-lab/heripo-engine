import type { LoggerMethods } from '@heripo/logger';
import type {
  DoclingDocument,
  DoclingTableCell,
  DoclingTableItem,
  DoclingTextItem,
} from '@heripo/model';
import type { LLMCallResult } from '@heripo/shared';

import type { VlmTextCorrectionOutput } from '../types/vlm-text-correction-schema';

import { ConcurrentPool, LLMCaller } from '@heripo/shared';
import { readFileSync, writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { VlmTextCorrector } from './vlm-text-corrector';

vi.mock('@heripo/shared', () => ({
  ConcurrentPool: { run: vi.fn() },
  LLMCaller: { callVision: vi.fn() },
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:path', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
}));

const mockModel = { modelId: 'test-vlm' } as any;

function createMockLogger(): LoggerMethods {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function createTextItem(
  text: string,
  label: string,
  pageNo: number,
): DoclingTextItem {
  return {
    self_ref: `#/texts/0`,
    label,
    prov: [
      {
        page_no: pageNo,
        bbox: { l: 0, t: 0, r: 100, b: 20, coord_origin: 'BOTTOMLEFT' },
        charspan: [0, text.length],
      },
    ],
    text,
    orig: text,
    children: [],
    content_layer: 'body',
  };
}

function createTableCell(
  text: string,
  row: number,
  col: number,
): DoclingTableCell {
  return {
    bbox: { l: 0, t: 0, r: 50, b: 20, coord_origin: 'BOTTOMLEFT' },
    row_span: 1,
    col_span: 1,
    start_row_offset_idx: row,
    end_row_offset_idx: row + 1,
    start_col_offset_idx: col,
    end_col_offset_idx: col + 1,
    text,
    column_header: row === 0,
    row_header: false,
    row_section: false,
    fillable: false,
  };
}

function createGridCell(text: string): DoclingTableCell {
  return {
    bbox: { l: 0, t: 0, r: 50, b: 20, coord_origin: 'BOTTOMLEFT' },
    row_span: 1,
    col_span: 1,
    start_row_offset_idx: 0,
    end_row_offset_idx: 1,
    start_col_offset_idx: 0,
    end_col_offset_idx: 1,
    text,
    column_header: false,
    row_header: false,
    row_section: false,
    fillable: false,
  };
}

function createTableItem(
  cells: DoclingTableCell[],
  pageNo: number,
  grid?: DoclingTableCell[][],
): DoclingTableItem {
  return {
    self_ref: '#/tables/0',
    label: 'table',
    prov: [
      {
        page_no: pageNo,
        bbox: { l: 0, t: 0, r: 200, b: 100, coord_origin: 'BOTTOMLEFT' },
        charspan: [0, 0],
      },
    ],
    captions: [],
    references: [],
    footnotes: [],
    data: {
      table_cells: cells,
      num_rows: 2,
      num_cols: 2,
      grid: grid ?? [],
    },
    children: [],
    content_layer: 'body',
  };
}

function createTestDoc(
  texts: DoclingTextItem[],
  tables: DoclingTableItem[] = [],
): DoclingDocument {
  return {
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
    texts,
    pictures: [],
    tables,
    pages: {
      '1': {
        page_no: 1,
        size: { width: 595, height: 842 },
        image: {
          mimetype: 'image/png',
          dpi: 300,
          size: { width: 2480, height: 3508 },
          uri: 'pages/page_0.png',
        },
      },
    },
  };
}

function mockVlmResponse(
  output: VlmTextCorrectionOutput,
): LLMCallResult<VlmTextCorrectionOutput> {
  return {
    output,
    usage: {
      component: 'VlmTextCorrector',
      phase: 'text-correction',
      model: 'primary',
      modelName: 'test-vlm',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    },
    usedFallback: false,
  };
}

describe('VlmTextCorrector', () => {
  let logger: LoggerMethods;
  let corrector: VlmTextCorrector;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createMockLogger();
    corrector = new VlmTextCorrector(logger);

    // Default: readFileSync returns image data for page images
    vi.mocked(readFileSync).mockImplementation((path: any) => {
      if (String(path).endsWith('.png')) {
        return Buffer.from('fake-image-data');
      }
      // Will be overridden per test for result.json
      return Buffer.from('{}');
    });
  });

  describe('correctAndSave', () => {
    test('reads document, processes pages, and saves corrected document', async () => {
      const doc = createTestDoc([
        createTextItem('잘못된 遣蹟', 'text', 1),
        createTextItem('제1장 조사개요', 'section_header', 1),
      ]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      const correctionOutput: VlmTextCorrectionOutput = {
        tc: [{ i: 0, t: '잘못된 遺蹟' }],
        cc: [],
      };

      vi.mocked(ConcurrentPool.run).mockImplementation(async (items) => {
        const results = [];
        for (let i = 0; i < items.length; i++) {
          results.push(correctionOutput);
        }
        return results;
      });

      const result = await corrector.correctAndSave(
        '/output/report-1',
        mockModel,
      );

      expect(result.textCorrections).toBe(1);
      expect(result.cellCorrections).toBe(0);
      expect(result.pagesProcessed).toBe(1);
      expect(result.pagesFailed).toBe(0);

      // Should save corrected document
      expect(writeFileSync).toHaveBeenCalledWith(
        '/output/report-1/result.json',
        expect.any(String),
      );

      // Verify correction was applied
      const savedDoc = JSON.parse(
        vi.mocked(writeFileSync).mock.calls[0][1] as string,
      );
      expect(savedDoc.texts[0].text).toBe('잘못된 遺蹟');
      expect(savedDoc.texts[0].orig).toBe('잘못된 遺蹟');
    });

    test('returns zero counts when document has no pages', async () => {
      const doc: DoclingDocument = {
        ...createTestDoc([]),
        pages: {},
      };

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      const result = await corrector.correctAndSave(
        '/output/report-1',
        mockModel,
      );

      expect(result.pagesProcessed).toBe(0);
      expect(result.textCorrections).toBe(0);
      expect(logger.info).toHaveBeenCalledWith(
        '[VlmTextCorrector] No pages to process',
      );
    });

    test('counts failed pages when VLM returns null', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      vi.mocked(ConcurrentPool.run).mockResolvedValue([null]);

      const result = await corrector.correctAndSave(
        '/output/report-1',
        mockModel,
      );

      expect(result.pagesFailed).toBe(1);
      expect(result.textCorrections).toBe(0);
    });

    test('passes concurrency option to ConcurrentPool', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      vi.mocked(ConcurrentPool.run).mockResolvedValue([{ tc: [], cc: [] }]);

      await corrector.correctAndSave('/output/report-1', mockModel, {
        concurrency: 4,
      });

      expect(ConcurrentPool.run).toHaveBeenCalledWith(
        [1],
        4,
        expect.any(Function),
        expect.any(Function),
      );
    });

    test('calls onTokenUsage callback via ConcurrentPool onItemComplete', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      const mockAggregator = {
        track: vi.fn(),
        getReport: vi.fn().mockReturnValue({
          components: [{ component: 'VlmTextCorrector' }],
          total: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        }),
      };
      const onTokenUsage = vi.fn();

      vi.mocked(ConcurrentPool.run).mockImplementation(
        async (_items, _concurrency, _processFn, onItemComplete) => {
          // Simulate item completion callback
          onItemComplete?.({ tc: [], cc: [] } as any, 0);
          return [{ tc: [], cc: [] }];
        },
      );

      await corrector.correctAndSave('/output/report-1', mockModel, {
        aggregator: mockAggregator as any,
        onTokenUsage,
      });

      expect(onTokenUsage).toHaveBeenCalled();
    });

    test('does not call onTokenUsage when aggregator is missing', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      const onTokenUsage = vi.fn();

      vi.mocked(ConcurrentPool.run).mockImplementation(
        async (_items, _concurrency, _processFn, onItemComplete) => {
          onItemComplete?.({ tc: [], cc: [] } as any, 0);
          return [{ tc: [], cc: [] }];
        },
      );

      await corrector.correctAndSave('/output/report-1', mockModel, {
        onTokenUsage,
      });

      expect(onTokenUsage).not.toHaveBeenCalled();
    });

    test('applies table cell corrections and syncs grid', async () => {
      const cells = [
        createTableCell('유구명', 0, 0),
        createTableCell('잘못된 住居阯', 1, 0),
      ];
      const grid = [
        [createGridCell('유구명')],
        [createGridCell('잘못된 住居阯')],
      ];
      const doc = createTestDoc([], [createTableItem(cells, 1, grid)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      const correctionOutput: VlmTextCorrectionOutput = {
        tc: [],
        cc: [{ ti: 0, r: 1, c: 0, t: '1호 住居址' }],
      };

      vi.mocked(ConcurrentPool.run).mockResolvedValue([correctionOutput]);

      const result = await corrector.correctAndSave(
        '/output/report-1',
        mockModel,
      );

      expect(result.cellCorrections).toBe(1);

      const savedDoc = JSON.parse(
        vi.mocked(writeFileSync).mock.calls[0][1] as string,
      );
      expect(savedDoc.tables[0].data.table_cells[1].text).toBe('1호 住居址');
      expect(savedDoc.tables[0].data.grid[1][0].text).toBe('1호 住居址');
    });

    test('handles missing grid row gracefully', async () => {
      const cells = [createTableCell('text', 0, 0)];
      const doc = createTestDoc([], [createTableItem(cells, 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      const correctionOutput: VlmTextCorrectionOutput = {
        tc: [],
        cc: [{ ti: 0, r: 0, c: 0, t: 'corrected' }],
      };

      vi.mocked(ConcurrentPool.run).mockResolvedValue([correctionOutput]);

      const result = await corrector.correctAndSave(
        '/output/report-1',
        mockModel,
      );

      expect(result.cellCorrections).toBe(1);

      const savedDoc = JSON.parse(
        vi.mocked(writeFileSync).mock.calls[0][1] as string,
      );
      expect(savedDoc.tables[0].data.table_cells[0].text).toBe('corrected');
      expect(savedDoc.tables[0].data.grid).toEqual([]);
    });

    test('handles missing grid cell gracefully', async () => {
      const cells = [
        createTableCell('col0', 0, 0),
        createTableCell('col1', 0, 1),
      ];
      const grid = [[createGridCell('col0')]];
      const doc = createTestDoc([], [createTableItem(cells, 1, grid)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      const correctionOutput: VlmTextCorrectionOutput = {
        tc: [],
        cc: [{ ti: 0, r: 0, c: 1, t: 'corrected col1' }],
      };

      vi.mocked(ConcurrentPool.run).mockResolvedValue([correctionOutput]);

      const result = await corrector.correctAndSave(
        '/output/report-1',
        mockModel,
      );

      expect(result.cellCorrections).toBe(1);

      const savedDoc = JSON.parse(
        vi.mocked(writeFileSync).mock.calls[0][1] as string,
      );
      expect(savedDoc.tables[0].data.table_cells[1].text).toBe(
        'corrected col1',
      );
      expect(savedDoc.tables[0].data.grid[0]).toHaveLength(1);
    });

    test('skips corrections with out-of-range text indices', async () => {
      const doc = createTestDoc([createTextItem('original', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      const correctionOutput: VlmTextCorrectionOutput = {
        tc: [{ i: 99, t: 'should not apply' }],
        cc: [],
      };

      vi.mocked(ConcurrentPool.run).mockResolvedValue([correctionOutput]);

      await corrector.correctAndSave('/output/report-1', mockModel);

      const savedDoc = JSON.parse(
        vi.mocked(writeFileSync).mock.calls[0][1] as string,
      );
      expect(savedDoc.texts[0].text).toBe('original');
    });

    test('skips cell corrections with out-of-range table indices', async () => {
      const cells = [createTableCell('original', 0, 0)];
      const doc = createTestDoc([], [createTableItem(cells, 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      const correctionOutput: VlmTextCorrectionOutput = {
        tc: [],
        cc: [{ ti: 99, r: 0, c: 0, t: 'should not apply' }],
      };

      vi.mocked(ConcurrentPool.run).mockResolvedValue([correctionOutput]);

      await corrector.correctAndSave('/output/report-1', mockModel);

      const savedDoc = JSON.parse(
        vi.mocked(writeFileSync).mock.calls[0][1] as string,
      );
      expect(savedDoc.tables[0].data.table_cells[0].text).toBe('original');
    });
  });

  describe('correctPage (via ConcurrentPool processFn)', () => {
    test('calls LLMCaller.callVision with correct parameters', async () => {
      const doc = createTestDoc([
        createTextItem('보고서 遣蹟', 'section_header', 1),
      ]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      const vlmResponse = mockVlmResponse({ tc: [], cc: [] });

      // Capture the processFn and call it
      vi.mocked(ConcurrentPool.run).mockImplementation(
        async (items, _concurrency, processFn) => {
          const results = [];
          for (let i = 0; i < items.length; i++) {
            results.push(await processFn(items[i], i));
          }
          return results;
        },
      );

      vi.mocked(LLMCaller.callVision).mockResolvedValue(vlmResponse as any);

      await corrector.correctAndSave('/output/report-1', mockModel, {
        maxRetries: 5,
        temperature: 0.2,
      });

      expect(LLMCaller.callVision).toHaveBeenCalledWith(
        expect.objectContaining({
          primaryModel: mockModel,
          maxRetries: 5,
          temperature: 0.2,
          component: 'VlmTextCorrector',
          phase: 'text-correction',
        }),
      );
    });

    test('tracks token usage via aggregator', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      const vlmResponse = mockVlmResponse({ tc: [], cc: [] });
      const mockAggregator = { track: vi.fn(), getReport: vi.fn() };

      vi.mocked(ConcurrentPool.run).mockImplementation(
        async (items, _concurrency, processFn) => {
          const results = [];
          for (let i = 0; i < items.length; i++) {
            results.push(await processFn(items[i], i));
          }
          return results;
        },
      );

      vi.mocked(LLMCaller.callVision).mockResolvedValue(vlmResponse as any);

      await corrector.correctAndSave('/output/report-1', mockModel, {
        aggregator: mockAggregator as any,
      });

      expect(mockAggregator.track).toHaveBeenCalledWith(vlmResponse.usage);
    });

    test('returns null on VLM failure (graceful degradation)', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      vi.mocked(ConcurrentPool.run).mockImplementation(
        async (items, _concurrency, processFn) => {
          const results = [];
          for (let i = 0; i < items.length; i++) {
            results.push(await processFn(items[i], i));
          }
          return results;
        },
      );

      vi.mocked(LLMCaller.callVision).mockRejectedValue(
        new Error('VLM timeout'),
      );

      const result = await corrector.correctAndSave(
        '/output/report-1',
        mockModel,
      );

      expect(result.pagesFailed).toBe(1);
      expect(logger.warn).toHaveBeenCalledWith(
        '[VlmTextCorrector] Page 1: VLM correction failed, keeping OCR text',
        expect.any(Error),
      );
    });

    test('rethrows error when abort signal is set', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);
      const abortController = new AbortController();
      abortController.abort();

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      vi.mocked(ConcurrentPool.run).mockImplementation(
        async (items, _concurrency, processFn) => {
          const results = [];
          for (let i = 0; i < items.length; i++) {
            results.push(await processFn(items[i], i));
          }
          return results;
        },
      );

      vi.mocked(LLMCaller.callVision).mockRejectedValue(
        new Error('AbortError'),
      );

      await expect(
        corrector.correctAndSave('/output/report-1', mockModel, {
          abortSignal: abortController.signal,
        }),
      ).rejects.toThrow('AbortError');
    });

    test('skips pages with no text or table content', async () => {
      // Page 1 has no text items at all
      const doc = createTestDoc([]);
      // Add a text item on a different page
      doc.pages['2'] = {
        page_no: 2,
        size: { width: 595, height: 842 },
        image: {
          mimetype: 'image/png',
          dpi: 300,
          size: { width: 2480, height: 3508 },
          uri: 'pages/page_1.png',
        },
      };

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      vi.mocked(ConcurrentPool.run).mockImplementation(
        async (items, _concurrency, processFn) => {
          const results = [];
          for (let i = 0; i < items.length; i++) {
            results.push(await processFn(items[i], i));
          }
          return results;
        },
      );

      await corrector.correctAndSave('/output/report-1', mockModel);

      // Should not call VLM for empty pages
      expect(LLMCaller.callVision).not.toHaveBeenCalled();
    });

    test('filters out text items with non-text labels (e.g., picture)', async () => {
      const doc = createTestDoc([
        createTextItem('valid text', 'text', 1),
        createTextItem('picture caption', 'picture', 1), // not in TEXT_LABELS
      ]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      const vlmResponse = mockVlmResponse({ tc: [], cc: [] });

      vi.mocked(ConcurrentPool.run).mockImplementation(
        async (items, _concurrency, processFn) => {
          const results = [];
          for (let i = 0; i < items.length; i++) {
            results.push(await processFn(items[i], i));
          }
          return results;
        },
      );

      vi.mocked(LLMCaller.callVision).mockResolvedValue(vlmResponse as any);

      await corrector.correctAndSave('/output/report-1', mockModel);

      // VLM should be called with only the valid text item (picture filtered out)
      const callArgs = vi.mocked(LLMCaller.callVision).mock.calls[0][0];
      const promptText = (callArgs.messages[0].content as any[]).find(
        (c: any) => c.type === 'text',
      ).text;
      expect(promptText).toContain('0|tx|valid text');
      expect(promptText).not.toContain('picture caption');
    });

    test('filters text items by page number', async () => {
      const doc = createTestDoc([
        createTextItem('page 1 text', 'text', 1),
        createTextItem('page 2 text', 'text', 2),
      ]);
      doc.pages['2'] = {
        page_no: 2,
        size: { width: 595, height: 842 },
        image: {
          mimetype: 'image/png',
          dpi: 300,
          size: { width: 2480, height: 3508 },
          uri: 'pages/page_1.png',
        },
      };

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      const vlmResponse = mockVlmResponse({ tc: [], cc: [] });

      vi.mocked(ConcurrentPool.run).mockImplementation(
        async (items, _concurrency, processFn) => {
          const results = [];
          for (let i = 0; i < items.length; i++) {
            results.push(await processFn(items[i], i));
          }
          return results;
        },
      );

      vi.mocked(LLMCaller.callVision).mockResolvedValue(vlmResponse as any);

      await corrector.correctAndSave('/output/report-1', mockModel);

      // Each page should only include its own text in the prompt
      expect(LLMCaller.callVision).toHaveBeenCalledTimes(2);

      const page1Prompt = (
        vi.mocked(LLMCaller.callVision).mock.calls[0][0].messages[0]
          .content as any[]
      ).find((c: any) => c.type === 'text').text;
      expect(page1Prompt).toContain('page 1 text');
      expect(page1Prompt).not.toContain('page 2 text');

      const page2Prompt = (
        vi.mocked(LLMCaller.callVision).mock.calls[1][0].messages[0]
          .content as any[]
      ).find((c: any) => c.type === 'text').text;
      expect(page2Prompt).toContain('page 2 text');
      expect(page2Prompt).not.toContain('page 1 text');
    });

    test('filters tables by page number', async () => {
      const cells1 = [createTableCell('page1-cell', 0, 0)];
      const cells2 = [createTableCell('page2-cell', 0, 0)];
      const doc = createTestDoc(
        [],
        [createTableItem(cells1, 1), createTableItem(cells2, 2)],
      );
      doc.pages['2'] = {
        page_no: 2,
        size: { width: 595, height: 842 },
        image: {
          mimetype: 'image/png',
          dpi: 300,
          size: { width: 2480, height: 3508 },
          uri: 'pages/page_1.png',
        },
      };

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      const vlmResponse = mockVlmResponse({ tc: [], cc: [] });

      vi.mocked(ConcurrentPool.run).mockImplementation(
        async (items, _concurrency, processFn) => {
          const results = [];
          for (let i = 0; i < items.length; i++) {
            results.push(await processFn(items[i], i));
          }
          return results;
        },
      );

      vi.mocked(LLMCaller.callVision).mockResolvedValue(vlmResponse as any);

      await corrector.correctAndSave('/output/report-1', mockModel);

      expect(LLMCaller.callVision).toHaveBeenCalledTimes(2);

      const page1Prompt = (
        vi.mocked(LLMCaller.callVision).mock.calls[0][0].messages[0]
          .content as any[]
      ).find((c: any) => c.type === 'text').text;
      expect(page1Prompt).toContain('page1-cell');
      expect(page1Prompt).not.toContain('page2-cell');

      const page2Prompt = (
        vi.mocked(LLMCaller.callVision).mock.calls[1][0].messages[0]
          .content as any[]
      ).find((c: any) => c.type === 'text').text;
      expect(page2Prompt).toContain('page2-cell');
      expect(page2Prompt).not.toContain('page1-cell');
    });

    test('logs correction counts when corrections are found', async () => {
      const doc = createTestDoc([createTextItem('wrong text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      const vlmResponse = mockVlmResponse({
        tc: [{ i: 0, t: 'corrected text' }],
        cc: [],
      });

      vi.mocked(ConcurrentPool.run).mockImplementation(
        async (items, _concurrency, processFn) => {
          const results = [];
          for (let i = 0; i < items.length; i++) {
            results.push(await processFn(items[i], i));
          }
          return results;
        },
      );

      vi.mocked(LLMCaller.callVision).mockResolvedValue(vlmResponse as any);

      await corrector.correctAndSave('/output/report-1', mockModel);

      expect(logger.debug).toHaveBeenCalledWith(
        '[VlmTextCorrector] Page 1: 1 text, 0 cell corrections',
      );
    });
  });

  describe('buildUserPrompt', () => {
    test('builds prompt with text elements only', () => {
      const pageTexts = [
        {
          index: 0,
          item: createTextItem('제1장 조사개요', 'section_header', 1),
        },
        {
          index: 1,
          item: createTextItem('본 보고서는 遣蹟 보고서이다.', 'text', 1),
        },
      ];

      const result = corrector.buildUserPrompt(pageTexts, []);

      expect(result).toBe(
        'T:\n0|sh|제1장 조사개요\n1|tx|본 보고서는 遣蹟 보고서이다.',
      );
    });

    test('builds prompt with table cells only', () => {
      const cells = [
        createTableCell('유구명', 0, 0),
        createTableCell('크기(m)', 0, 1),
        createTableCell('1호 住居址', 1, 0),
      ];
      const pageTables = [{ index: 0, item: createTableItem(cells, 1) }];

      const result = corrector.buildUserPrompt([], pageTables);

      expect(result).toBe('C:\n0|0,0|유구명\n0|0,1|크기(m)\n0|1,0|1호 住居址');
    });

    test('builds prompt with both text and table cells', () => {
      const pageTexts = [
        { index: 0, item: createTextItem('표 1.', 'caption', 1) },
      ];
      const cells = [createTableCell('data', 0, 0)];
      const pageTables = [{ index: 0, item: createTableItem(cells, 1) }];

      const result = corrector.buildUserPrompt(pageTexts, pageTables);

      expect(result).toBe('T:\n0|ca|표 1.\nC:\n0|0,0|data');
    });

    test('skips empty table cells', () => {
      const cells = [
        createTableCell('data', 0, 0),
        createTableCell('', 0, 1),
        createTableCell('   ', 1, 0),
      ];
      const pageTables = [{ index: 0, item: createTableItem(cells, 1) }];

      const result = corrector.buildUserPrompt([], pageTables);

      expect(result).toBe('C:\n0|0,0|data');
    });

    test('returns empty string when no text or table content', () => {
      const result = corrector.buildUserPrompt([], []);

      expect(result).toBe('');
    });

    test('uses correct type codes for all label types', () => {
      const pageTexts = [
        { index: 0, item: createTextItem('header', 'section_header', 1) },
        { index: 1, item: createTextItem('body', 'text', 1) },
        { index: 2, item: createTextItem('caption', 'caption', 1) },
        { index: 3, item: createTextItem('note', 'footnote', 1) },
        { index: 4, item: createTextItem('item', 'list_item', 1) },
        { index: 5, item: createTextItem('top', 'page_header', 1) },
        { index: 6, item: createTextItem('bottom', 'page_footer', 1) },
      ];

      const result = corrector.buildUserPrompt(pageTexts, []);

      expect(result).toContain('0|sh|header');
      expect(result).toContain('1|tx|body');
      expect(result).toContain('2|ca|caption');
      expect(result).toContain('3|fn|note');
      expect(result).toContain('4|li|item');
      expect(result).toContain('5|ph|top');
      expect(result).toContain('6|pf|bottom');
    });

    test('falls back to tx for unknown label types', () => {
      const pageTexts = [
        { index: 0, item: createTextItem('unknown', 'custom_type', 1) },
      ];

      const result = corrector.buildUserPrompt(pageTexts, []);

      expect(result).toBe('T:\n0|tx|unknown');
    });

    test('omits C: section when all table cells are empty', () => {
      const cells = [createTableCell('', 0, 0), createTableCell('  ', 0, 1)];
      const pageTables = [{ index: 0, item: createTableItem(cells, 1) }];

      const result = corrector.buildUserPrompt([], pageTables);

      expect(result).toBe('');
    });

    test('handles multiple tables with correct indices', () => {
      const cells1 = [createTableCell('table1-cell', 0, 0)];
      const cells2 = [createTableCell('table2-cell', 0, 0)];
      const pageTables = [
        { index: 0, item: createTableItem(cells1, 1) },
        { index: 3, item: createTableItem(cells2, 1) },
      ];

      const result = corrector.buildUserPrompt([], pageTables);

      expect(result).toBe('C:\n0|0,0|table1-cell\n1|0,0|table2-cell');
    });

    test('includes ref lines when references are provided', () => {
      const pageTexts = [
        {
          index: 0,
          item: createTextItem(
            '49) (W)#X1CR003T 2008, 『아산 상성리유적』.',
            'footnote',
            1,
          ),
        },
        {
          index: 1,
          item: createTextItem('제1장 조사개요', 'section_header', 1),
        },
      ];

      const references = new Map<number, string>();
      references.set(0, '49) (財)忠淸文化財硏究院 2008,『아산 상성리유적』.');

      const result = corrector.buildUserPrompt(pageTexts, [], references);

      const lines = result.split('\n');
      expect(lines[0]).toBe('T:');
      expect(lines[1]).toBe('0|fn|49) (W)#X1CR003T 2008, 『아산 상성리유적』.');
      expect(lines[2]).toBe(
        '0|ref|49) (財)忠淸文化財硏究院 2008,『아산 상성리유적』.',
      );
      expect(lines[3]).toBe('1|sh|제1장 조사개요');
      expect(lines).toHaveLength(4);
    });

    test('omits ref lines for elements without references', () => {
      const pageTexts = [
        { index: 0, item: createTextItem('text A', 'text', 1) },
        { index: 1, item: createTextItem('text B', 'text', 1) },
      ];

      const references = new Map<number, string>();
      references.set(1, 'ref for B');

      const result = corrector.buildUserPrompt(pageTexts, [], references);

      expect(result).toBe('T:\n0|tx|text A\n1|tx|text B\n1|ref|ref for B');
    });

    test('includes C_REF section when tableContext is provided', () => {
      const cells = [
        createTableCell('#쩯및표뽰', 0, 0),
        createTableCell('조선시대', 0, 1),
      ];
      const pageTables = [{ index: 0, item: createTableItem(cells, 1) }];

      const result = corrector.buildUserPrompt(
        [],
        pageTables,
        undefined,
        '發刊日 調査機關 遺蹟名 類型 및 基數',
      );

      expect(result).toContain('C:\n');
      expect(result).toContain('C_REF:\n發刊日 調査機關 遺蹟名 類型 및 基數');
    });

    test('does not include C_REF section when tableContext is not provided', () => {
      const cells = [createTableCell('data', 0, 0)];
      const pageTables = [{ index: 0, item: createTableItem(cells, 1) }];

      const result = corrector.buildUserPrompt([], pageTables);

      expect(result).not.toContain('C_REF:');
    });

    test('does not include C_REF section when there are no table cells', () => {
      const pageTexts = [{ index: 0, item: createTextItem('text', 'text', 1) }];

      const result = corrector.buildUserPrompt(
        pageTexts,
        [],
        undefined,
        'unused reference',
      );

      expect(result).not.toContain('C_REF:');
    });
  });

  describe('page image path mapping', () => {
    test('maps page_no 1 to pages/page_0.png (0-indexed)', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      const vlmResponse = mockVlmResponse({ tc: [], cc: [] });

      vi.mocked(ConcurrentPool.run).mockImplementation(
        async (items, _concurrency, processFn) => {
          const results = [];
          for (let i = 0; i < items.length; i++) {
            results.push(await processFn(items[i], i));
          }
          return results;
        },
      );

      vi.mocked(LLMCaller.callVision).mockResolvedValue(vlmResponse as any);

      await corrector.correctAndSave('/output/report-1', mockModel);

      // Verify page image was read with 0-indexed path
      expect(readFileSync).toHaveBeenCalledWith(
        '/output/report-1/pages/page_0.png',
      );
    });
  });

  describe('language-aware system prompt', () => {
    function setupProcessFn() {
      vi.mocked(ConcurrentPool.run).mockImplementation(
        async (items, _concurrency, processFn) => {
          const results = [];
          for (let i = 0; i < items.length; i++) {
            results.push(await processFn(items[i], i));
          }
          return results;
        },
      );
    }

    function getPromptText(): string {
      const callArgs = vi.mocked(LLMCaller.callVision).mock.calls[0][0];
      return (callArgs.messages[0].content as any[]).find(
        (c: any) => c.type === 'text',
      ).text;
    }

    test('includes language context in prompt when documentLanguages is provided', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      await corrector.correctAndSave('/output/report-1', mockModel, {
        documentLanguages: ['ko-KR'],
      });

      const promptText = getPromptText();
      expect(promptText).toContain('LANGUAGE CONTEXT');
      expect(promptText).toContain('Korean (한국어)');
    });

    test('includes multiple languages in prompt when documentLanguages has multiple entries', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      await corrector.correctAndSave('/output/report-1', mockModel, {
        documentLanguages: ['ko-KR', 'en-US'],
      });

      const promptText = getPromptText();
      expect(promptText).toContain('LANGUAGE CONTEXT');
      expect(promptText).toContain('primarily written in Korean');
      expect(promptText).toContain('with English also present');
    });

    test('falls back to raw BCP 47 code for unknown secondary language', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      await corrector.correctAndSave('/output/report-1', mockModel, {
        documentLanguages: ['ko-KR', 'vi-VN'],
      });

      const promptText = getPromptText();
      expect(promptText).toContain('primarily written in Korean');
      expect(promptText).toContain('with vi-VN also present');
    });

    test('uses base prompt when documentLanguages is not provided', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      await corrector.correctAndSave('/output/report-1', mockModel);

      const promptText = getPromptText();
      expect(promptText).not.toContain('LANGUAGE CONTEXT');
      expect(promptText).toContain('You are a text correction engine');
    });

    test('uses raw language code when not in LANGUAGE_DISPLAY_NAMES', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      await corrector.correctAndSave('/output/report-1', mockModel, {
        documentLanguages: ['vi-VN'],
      });

      const promptText = getPromptText();
      expect(promptText).toContain('LANGUAGE CONTEXT');
      expect(promptText).toContain('written in vi-VN');
    });
  });

  describe('matchTextToReference', () => {
    test('matches garbled footnote to correct pdftotext line', () => {
      const pageTexts = [
        {
          index: 0,
          item: createTextItem(
            '49) (W)#X1CR003T 2008, 『아산 상성리유적』.',
            'footnote',
            1,
          ),
        },
      ];
      const pageText = '49) (財)忠淸文化財硏究院 2008,『아산 상성리유적』.';

      const result = corrector.matchTextToReference(pageTexts, pageText);

      expect(result.size).toBe(1);
      expect(result.get(0)).toBe(
        '49) (財)忠淸文化財硏究院 2008,『아산 상성리유적』.',
      );
    });

    test('matches heavily garbled text above threshold', () => {
      const pageTexts = [
        {
          index: 0,
          item: createTextItem(
            '50) (M):23x1CR03% 2008, 『아산 장재리 아골유적』.',
            'footnote',
            1,
          ),
        },
      ];
      const pageText =
        '50) (財)忠淸文化財硏究院 2008,『아산 장재리 아골유적』.';

      const result = corrector.matchTextToReference(pageTexts, pageText);

      expect(result.size).toBe(1);
      expect(result.get(0)).toBe(pageText);
    });

    test('skips identical text (no ref needed)', () => {
      const pageTexts = [
        {
          index: 0,
          item: createTextItem('제1장 조사개요', 'section_header', 1),
        },
      ];
      const pageText = '제1장 조사개요';

      const result = corrector.matchTextToReference(pageTexts, pageText);

      expect(result.size).toBe(0);
    });

    test('returns empty map when no matches above threshold', () => {
      const pageTexts = [
        {
          index: 0,
          item: createTextItem('completely different text', 'text', 1),
        },
      ];
      const pageText = 'XXXXXXXXYYYYYYZZZZZZ';

      const result = corrector.matchTextToReference(pageTexts, pageText);

      expect(result.size).toBe(0);
    });

    test('returns empty map for empty pageText', () => {
      const pageTexts = [
        { index: 0, item: createTextItem('some text', 'text', 1) },
      ];

      const result = corrector.matchTextToReference(pageTexts, '');

      expect(result.size).toBe(0);
    });

    test('handles greedy matching without double assignment', () => {
      const pageTexts = [
        { index: 0, item: createTextItem('AAA BBB', 'text', 1) },
        { index: 1, item: createTextItem('CCC DDD', 'text', 1) },
        { index: 2, item: createTextItem('EEE FFF', 'text', 1) },
      ];
      const pageText = 'AAA BBB ref\n\nCCC DDD ref\n\nEEE FFF ref';

      const result = corrector.matchTextToReference(pageTexts, pageText);

      expect(result.size).toBe(3);
      // Each element should match a unique ref block
      const refValues = new Set(result.values());
      expect(refValues.size).toBe(3);
    });

    test('handles empty OCR text element against non-empty ref line', () => {
      const pageTexts = [{ index: 0, item: createTextItem('', 'text', 1) }];
      const pageText = 'some reference text';

      const result = corrector.matchTextToReference(pageTexts, pageText);

      expect(result.size).toBe(0);
    });

    test('handles more OCR elements than reference lines', () => {
      const pageTexts = [
        { index: 0, item: createTextItem('AAA BBB', 'text', 1) },
        { index: 1, item: createTextItem('CCC DDD', 'text', 1) },
        { index: 2, item: createTextItem('EEE FFF', 'text', 1) },
      ];
      const pageText = 'AAA BBB ref';

      const result = corrector.matchTextToReference(pageTexts, pageText);

      // Only one ref block available, so at most 1 match
      expect(result.size).toBeLessThanOrEqual(1);
    });

    test('matches long OCR paragraph against merged pdftotext block', () => {
      // OCR produces one long paragraph; pdftotext splits into layout lines
      const ocrText =
        '唐은 熊津(공주), 馬韓(익산), 東明에 都督府를 설치하고 9州 5小京制를 완성하였다';
      const pageTexts = [
        { index: 0, item: createTextItem(ocrText, 'text', 1) },
      ];
      // pdftotext: same content split across multiple lines (no blank line separator)
      const pageText =
        '唐은 熊津(공주), 馬韓(익산),\n東明에 都督府를 설치하고\n9州 5小京制를 완성하였다';

      // Identical after merge → no ref needed (skips identical text)
      const identicalResult = corrector.matchTextToReference(
        pageTexts,
        pageText,
      );
      expect(identicalResult.size).toBe(0);

      // Use a garbled OCR version to verify ref is provided
      const garbledOcrText =
        '받은 M(공주), 5류(익산), 햇배에 Bbt를 설치하고 9MM 5☆를 완성하였다';
      const garbledPageTexts = [
        { index: 0, item: createTextItem(garbledOcrText, 'text', 1) },
      ];

      const garbledResult = corrector.matchTextToReference(
        garbledPageTexts,
        pageText,
      );

      expect(garbledResult.size).toBe(1);
      expect(garbledResult.get(0)).toBe(
        '唐은 熊津(공주), 馬韓(익산), 東明에 都督府를 설치하고 9州 5小京制를 완성하였다',
      );
    });

    test('separates blocks at blank lines for independent matching', () => {
      const pageTexts = [
        {
          index: 0,
          item: createTextItem(
            '본문 단락 텍스트 내용이 여기에 있습니다',
            'text',
            1,
          ),
        },
        {
          index: 1,
          item: createTextItem('49) (W)#X1 2008, 『보고서』.', 'footnote', 1),
        },
      ];
      // pdftotext: body paragraph (2 layout lines) + blank line + footnote
      const pageText =
        '본문 단락 텍스트\n내용이 여기에 있습니다\n\n49) (財)忠淸 2008, 『보고서』.';

      const result = corrector.matchTextToReference(pageTexts, pageText);

      // Body paragraph matches merged block, footnote matches separate block
      expect(result.size).toBe(1);
      expect(result.get(1)).toBe('49) (財)忠淸 2008, 『보고서』.');
    });

    test('returns empty map when pdftotext contains only blank lines', () => {
      const pageTexts = [
        { index: 0, item: createTextItem('some text', 'text', 1) },
      ];
      const pageText = '\n\n\n\n';

      const result = corrector.matchTextToReference(pageTexts, pageText);

      expect(result.size).toBe(0);
    });
  });

  describe('system prompt content', () => {
    function setupProcessFn() {
      vi.mocked(ConcurrentPool.run).mockImplementation(
        async (items, _concurrency, processFn) => {
          const results = [];
          for (let i = 0; i < items.length; i++) {
            results.push(await processFn(items[i], i));
          }
          return results;
        },
      );
    }

    function getPromptText(): string {
      const callArgs = vi.mocked(LLMCaller.callVision).mock.calls[0][0];
      return (callArgs.messages[0].content as any[]).find(
        (c: any) => c.type === 'text',
      ).text;
    }

    test('includes footnote special instructions', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      await corrector.correctAndSave('/output/report-1', mockModel);

      const promptText = getPromptText();
      expect(promptText).toContain('FOOTNOTE (fn) SPECIAL INSTRUCTIONS');
      expect(promptText).toContain('(財)');
    });

    test('includes table cell special instructions', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      await corrector.correctAndSave('/output/report-1', mockModel);

      const promptText = getPromptText();
      expect(promptText).toContain('TABLE CELL (C:) SPECIAL INSTRUCTIONS');
      expect(promptText).toContain('發刊日');
    });

    test('includes dropped Hanja pattern', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      await corrector.correctAndSave('/output/report-1', mockModel);

      const promptText = getPromptText();
      expect(promptText).toContain('Hanja dropped entirely');
      expect(promptText).toContain('(株)韓國纖維');
    });

    test('includes phonetic reading substitution pattern', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      await corrector.correctAndSave('/output/report-1', mockModel);

      const promptText = getPromptText();
      expect(promptText).toContain('Phonetic reading substitution');
      expect(promptText).toContain('충남문화재연구원');
    });

    test('includes image fallback instructions when both OCR and ref are garbled', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      await corrector.correctAndSave('/output/report-1', mockModel);

      const promptText = getPromptText();
      expect(promptText).toContain(
        'IGNORE the ref text and READ THE IMAGE directly',
      );
    });

    test('includes image fallback instructions when no ref line is present', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      await corrector.correctAndSave('/output/report-1', mockModel);

      const promptText = getPromptText();
      expect(promptText).toContain('When NO |ref| line is present');
      expect(promptText).toContain(
        'READ THE IMAGE directly to determine the correct text',
      );
    });
  });

  describe('pdftotext inline reference injection', () => {
    function setupProcessFn() {
      vi.mocked(ConcurrentPool.run).mockImplementation(
        async (items, _concurrency, processFn) => {
          const results = [];
          for (let i = 0; i < items.length; i++) {
            results.push(await processFn(items[i], i));
          }
          return results;
        },
      );
    }

    function getPromptText(callIndex = 0): string {
      const callArgs = vi.mocked(LLMCaller.callVision).mock.calls[callIndex][0];
      return (callArgs.messages[0].content as any[]).find(
        (c: any) => c.type === 'text',
      ).text;
    }

    test('injects inline ref lines when pageTexts matches OCR elements', async () => {
      const doc = createTestDoc([
        createTextItem(
          '49) (W)#X1CR003T 2008, 『아산 상성리유적』.',
          'footnote',
          1,
        ),
      ]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      const pageTexts = new Map<number, string>();
      pageTexts.set(1, '49) (財)忠淸文化財硏究院 2008,『아산 상성리유적』.');

      await corrector.correctAndSave('/output/report-1', mockModel, {
        pageTexts,
      });

      const promptText = getPromptText();
      expect(promptText).toContain('0|fn|49) (W)#X1CR003T 2008');
      expect(promptText).toContain(
        '0|ref|49) (財)忠淸文化財硏究院 2008,『아산 상성리유적』.',
      );
      // Should NOT contain old blob-style reference
      expect(promptText).not.toContain('TEXT REFERENCE');
    });

    test('does not inject ref when page text is empty', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      const pageTexts = new Map<number, string>();
      pageTexts.set(1, '   ');

      await corrector.correctAndSave('/output/report-1', mockModel, {
        pageTexts,
      });

      const promptText = getPromptText();
      expect(promptText).not.toMatch(/^\d+\|ref\|/m);
    });

    test('does not inject ref when pageTexts map has no entry for page', async () => {
      const doc = createTestDoc([createTextItem('text', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      const pageTexts = new Map<number, string>();
      pageTexts.set(2, 'page 2 text');

      await corrector.correctAndSave('/output/report-1', mockModel, {
        pageTexts,
      });

      const promptText = getPromptText();
      expect(promptText).not.toMatch(/^\d+\|ref\|/m);
    });

    test('injects ref lines per page independently', async () => {
      const doc = createTestDoc([
        createTextItem(
          '49) (W)#X1CR003T 2008, 『아산 상성리유적』.',
          'footnote',
          1,
        ),
        createTextItem('제2장 조사내용', 'section_header', 2),
      ]);
      doc.pages['2'] = {
        page_no: 2,
        size: { width: 595, height: 842 },
        image: {
          mimetype: 'image/png',
          dpi: 300,
          size: { width: 2480, height: 3508 },
          uri: 'pages/page_1.png',
        },
      };

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      const pageTexts = new Map<number, string>();
      pageTexts.set(1, '49) (財)忠淸文化財硏究院 2008,『아산 상성리유적』.');
      pageTexts.set(2, '제2장 조사내용');

      await corrector.correctAndSave('/output/report-1', mockModel, {
        pageTexts,
      });

      expect(LLMCaller.callVision).toHaveBeenCalledTimes(2);

      const page1Prompt = getPromptText(0);
      expect(page1Prompt).toContain('|ref|');

      // Page 2: OCR text identical to pdftotext → no ref data line
      const page2Prompt = getPromptText(1);
      expect(page2Prompt).not.toMatch(/^\d+\|ref\|/m);
    });
  });

  describe('C_REF table context injection via correctPage', () => {
    function setupProcessFn() {
      vi.mocked(ConcurrentPool.run).mockImplementation(
        async (items, _concurrency, processFn) => {
          const results = [];
          for (let i = 0; i < items.length; i++) {
            results.push(await processFn(items[i], i));
          }
          return results;
        },
      );
    }

    function getPromptText(callIndex = 0): string {
      const callArgs = vi.mocked(LLMCaller.callVision).mock.calls[callIndex][0];
      return (callArgs.messages[0].content as any[]).find(
        (c: any) => c.type === 'text',
      ).text;
    }

    test('injects C_REF when page has tables and unused pdftotext blocks', async () => {
      const cells = [
        createTableCell('#쩯및표뽰', 0, 0),
        createTableCell('조선시대', 0, 1),
      ];
      const doc = createTestDoc(
        [createTextItem('본문 텍스트', 'text', 1)],
        [createTableItem(cells, 1)],
      );

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      // pdftotext has body text block + table header block (separated by blank line)
      const pageTexts = new Map<number, string>();
      pageTexts.set(1, '본문 텍스트\n\n發刊日 調査機關 遺蹟名 類型 및 基數');

      await corrector.correctAndSave('/output/report-1', mockModel, {
        pageTexts,
      });

      const promptText = getPromptText();
      expect(promptText).toContain('C_REF:');
      expect(promptText).toContain('發刊日 調査機關 遺蹟名 類型 및 基數');
    });

    test('does not inject C_REF when page has no tables', async () => {
      const doc = createTestDoc([createTextItem('본문 텍스트', 'text', 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      // pdftotext has two blocks but no tables on page
      const pageTexts = new Map<number, string>();
      pageTexts.set(1, '본문 텍스트\n\n추가 블록');

      await corrector.correctAndSave('/output/report-1', mockModel, {
        pageTexts,
      });

      const promptText = getPromptText();
      // C_REF: appears in system prompt description but should not appear as a standalone section
      expect(promptText).not.toMatch(/^C_REF:\n/m);
    });

    test('injects C_REF with multiple unused blocks joined by newline', async () => {
      const cells = [createTableCell('garbled', 0, 0)];
      // No text elements, only a table → all pdftotext blocks become unused
      const doc = createTestDoc([], [createTableItem(cells, 1)]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      // pdftotext has 3 blocks (separated by blank lines), all unused since no text elements
      const pageTexts = new Map<number, string>();
      pageTexts.set(1, '發刊日\n\n調査機關\n\n遺蹟名');

      await corrector.correctAndSave('/output/report-1', mockModel, {
        pageTexts,
      });

      const promptText = getPromptText();
      expect(promptText).toMatch(/^C_REF:\n/m);
      expect(promptText).toContain('發刊日\n調査機關\n遺蹟名');
    });

    test('does not inject C_REF when all pdftotext blocks are consumed by text matching', async () => {
      const doc = createTestDoc([
        createTextItem('AAA BBB text', 'text', 1),
        createTextItem('CCC DDD text', 'text', 1),
      ]);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('result.json')) {
          return Buffer.from(JSON.stringify(doc));
        }
        return Buffer.from('fake-image');
      });

      setupProcessFn();
      vi.mocked(LLMCaller.callVision).mockResolvedValue(
        mockVlmResponse({ tc: [], cc: [] }) as any,
      );

      // Both blocks should be consumed by text matching (identical → no ref, but consumed)
      const pageTexts = new Map<number, string>();
      pageTexts.set(1, 'AAA BBB text\n\nCCC DDD text');

      await corrector.correctAndSave('/output/report-1', mockModel, {
        pageTexts,
      });

      const promptText = getPromptText();
      // C_REF: appears in system prompt description but should not appear as a standalone section
      expect(promptText).not.toMatch(/^C_REF:\n/m);
    });
  });
});
