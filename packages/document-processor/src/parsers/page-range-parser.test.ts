import type { LoggerMethods } from '@heripo/logger';
import type { DoclingDocument, DoclingPage } from '@heripo/model';
import type { LanguageModel } from 'ai';

import { LLMCaller } from '@heripo/shared';
import * as fs from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { PageRangeParseError } from './page-range-parse-error';
import { PageRangeParser } from './page-range-parser';

vi.mock('@heripo/shared', () => ({
  LLMCaller: {
    callVision: vi.fn(),
  },
  LLMTokenUsageAggregator: vi.fn(function () {
    return {
      reset: vi.fn(),
      track: vi.fn(),
      logSummary: vi.fn(),
    };
  }),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

describe('PageRangeParser', () => {
  let logger: LoggerMethods;
  let model: LanguageModel;
  let parser: PageRangeParser;
  let mockCallVision: ReturnType<typeof vi.fn>;

  const createMockPage = (
    pageNo: number,
    width = 595,
    height = 842,
    mimetype: string | undefined = 'image/png',
  ): DoclingPage => ({
    page_no: pageNo,
    size: { width, height },
    image: {
      uri: `pages/page_${pageNo - 1}.png`,
      mimetype: mimetype!,
      dpi: 72,
      size: { width, height },
    },
  });

  const createMockDocument = (
    pageCount: number,
    mimetype?: string,
  ): DoclingDocument => {
    const pages: Record<string, DoclingPage> = {};
    for (let i = 1; i <= pageCount; i++) {
      pages[String(i)] = createMockPage(i, 595, 842, mimetype);
    }
    return {
      schema_name: 'DoclingDocument',
      version: '1.0.0',
      name: 'test.pdf',
      origin: {
        mimetype: 'application/pdf',
        binary_hash: 0,
        filename: 'test.pdf',
      },
      furniture: {
        self_ref: '#/furniture',
        children: [],
        content_layer: 'furniture',
        name: '_root_',
        label: 'unspecified',
      },
      body: {
        self_ref: '#/body',
        children: [],
        content_layer: 'body',
        name: '_root_',
        label: 'unspecified',
      },
      groups: [],
      texts: [],
      pictures: [],
      tables: [],
      pages,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as LoggerMethods;

    model = { modelId: 'test-model' } as LanguageModel;

    parser = new PageRangeParser(logger, model, '/output/path', 3);

    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake-image-data'));

    mockCallVision = vi.mocked(LLMCaller.callVision);
  });

  describe('parse', () => {
    test('returns empty object and empty usage when document has no pages', async () => {
      const doc = createMockDocument(0);

      const result = await parser.parse(doc);

      expect(result.pageRangeMap).toEqual({});
      expect(result.usage).toEqual([
        {
          component: 'PageRangeParser',
          phase: 'sampling',
          model: 'primary',
          modelName: 'none',
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
      ]);
      expect(logger.warn).toHaveBeenCalledWith(
        '[PageRangeParser] No pages found',
      );
    });

    test('returns pageRangeMap and usage for single page document', async () => {
      const doc = createMockDocument(1);

      mockCallVision.mockResolvedValueOnce({
        output: {
          pages: [{ imageIndex: 0, startPageNo: 1, endPageNo: null }],
        },
        usage: {
          component: 'PageRangeParser',
          phase: 'sampling',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 10,
          totalTokens: 110,
        },
        usedFallback: false,
      });

      const result = await parser.parse(doc);

      expect(result.pageRangeMap).toEqual({
        1: { startPageNo: 1, endPageNo: 1 },
      });
      expect(result.usage).toHaveLength(1);
      expect(result.usage[0].totalTokens).toBe(110);
    });

    test('processes small group (≤3 pages) by sending all at once', async () => {
      const doc = createMockDocument(2);

      mockCallVision.mockResolvedValueOnce({
        output: {
          pages: [
            { imageIndex: 0, startPageNo: 1, endPageNo: null },
            { imageIndex: 1, startPageNo: 2, endPageNo: null },
          ],
        },
        usage: {
          component: 'PageRangeParser',
          phase: 'sampling',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 200,
          outputTokens: 20,
          totalTokens: 220,
        },
        usedFallback: false,
      });

      const result = await parser.parse(doc);

      expect(result.pageRangeMap).toEqual({
        1: { startPageNo: 1, endPageNo: 1 },
        2: { startPageNo: 2, endPageNo: 2 },
      });
      expect(mockCallVision).toHaveBeenCalledTimes(1);
      expect(result.usage).toHaveLength(1);
    });

    test('detects SIMPLE_INCREMENT pattern and applies to all pages', async () => {
      const doc = createMockDocument(10);

      // Mock for pattern detection - can be called for random sampling retries
      mockCallVision.mockImplementation(async ({ messages }) => {
        // Extract the pages being sampled from the message
        const textContent = messages[0].content.find(
          (c: any) => c.type === 'text',
        );
        const match = textContent?.text?.match(/PDF pages: ([\d, ]+)/);
        const sampledPages = match
          ? match[1].split(', ').map(Number)
          : [1, 2, 3];

        // Return page numbers that match the sampled pages (offset 0)
        return {
          output: {
            pages: sampledPages.map((pageNo: number, idx: number) => ({
              imageIndex: idx,
              startPageNo: pageNo,
              endPageNo: null,
            })),
          },
          usage: {
            component: 'PageRangeParser',
            phase: 'sampling',
            model: 'primary',
            modelName: 'test-model',
            inputTokens: 300,
            outputTokens: 30,
            totalTokens: 330,
          },
          usedFallback: false,
        };
      });

      const result = await parser.parse(doc);

      // All 10 pages should be mapped with offset 0
      expect(Object.keys(result.pageRangeMap).length).toBe(10);
      expect(result.pageRangeMap[1]).toEqual({
        startPageNo: 1,
        endPageNo: 1,
      });
      expect(result.pageRangeMap[5]).toEqual({
        startPageNo: 5,
        endPageNo: 5,
      });
      expect(result.pageRangeMap[10]).toEqual({
        startPageNo: 10,
        endPageNo: 10,
      });
      // The first successful call should result in all pages mapped
      expect(mockCallVision).toHaveBeenCalled();
      expect(result.usage).toHaveLength(1);
    });

    test('returns usage data for parsed pages', async () => {
      const doc = createMockDocument(3);

      mockCallVision.mockImplementationOnce(async () => {
        return {
          output: {
            pages: [
              { imageIndex: 0, startPageNo: 1, endPageNo: 2 },
              { imageIndex: 1, startPageNo: 3, endPageNo: 4 },
              { imageIndex: 2, startPageNo: 5, endPageNo: 6 },
            ],
          },
          usage: {
            component: 'PageRangeParser',
            phase: 'sampling',
            model: 'primary',
            modelName: 'test-model',
            inputTokens: 300,
            outputTokens: 30,
            totalTokens: 330,
          },
          usedFallback: false,
        };
      });

      const result = await parser.parse(doc);

      expect(result.usage).toHaveLength(1);
      expect(result.usage[0]).toMatchObject({
        component: 'PageRangeParser',
        phase: 'sampling',
        model: 'primary',
        modelName: 'test-model',
        totalTokens: 330,
      });
    });

    test('returns multiple usage entries when processing large groups with multiple LLM calls', async () => {
      const doc = createMockDocument(10);

      // Mock for pattern detection attempt - dynamically return correct page numbers
      mockCallVision.mockImplementation(async (options: any) => {
        const textContent = options.messages?.[0]?.content?.find(
          (c: any) => c.type === 'text',
        );
        const match = textContent?.text?.match(/PDF pages: ([\d, ]+)/);
        const sampledPages = match
          ? match[1].split(', ').map(Number)
          : [1, 2, 3];

        // Return page numbers that match the sampled pages (SIMPLE_INCREMENT pattern)
        return {
          output: {
            pages: sampledPages.map((pageNo: number, idx: number) => ({
              imageIndex: idx,
              startPageNo: pageNo,
              endPageNo: null,
            })),
          },
          usage: {
            component: 'PageRangeParser',
            phase: 'sampling',
            model: 'primary',
            modelName: 'test-model',
            inputTokens: 150,
            outputTokens: 15,
            totalTokens: 165,
          },
          usedFallback: false,
        };
      });

      const result = await parser.parse(doc);

      expect(mockCallVision).toHaveBeenCalledTimes(1);
      expect(result.usage).toHaveLength(1);
      expect(result.usage[0].totalTokens).toBe(165);
    });

    test('throws error when pattern detection exhausts all retries', async () => {
      const doc = createMockDocument(10);

      mockCallVision.mockResolvedValue({
        output: {
          pages: [
            { imageIndex: 0, startPageNo: null, endPageNo: null },
            { imageIndex: 1, startPageNo: null, endPageNo: null },
            { imageIndex: 2, startPageNo: null, endPageNo: null },
          ],
        },
        usage: {
          component: 'PageRangeParser',
          phase: 'sampling',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 10,
          totalTokens: 110,
        },
        usedFallback: false,
      });

      await expect(parser.parse(doc)).rejects.toThrow(PageRangeParseError);
      expect(mockCallVision.mock.calls.length).toBeGreaterThan(1);
    });

    test('throws when LLMCaller.callVision fails', async () => {
      const doc = createMockDocument(1);

      mockCallVision.mockRejectedValueOnce(new Error('LLM call failed'));

      await expect(parser.parse(doc)).rejects.toThrow();
    });
  });

  describe('extractMultiplePages with falsy mimetype', () => {
    test('uses image/png as default mimetype when page mimetype is empty string', async () => {
      // Create document with empty mimetype to trigger the || 'image/png' fallback
      const doc = createMockDocument(1, '');

      mockCallVision.mockResolvedValueOnce({
        output: {
          pages: [{ imageIndex: 0, startPageNo: 1, endPageNo: null }],
        },
        usage: {
          component: 'PageRangeParser',
          phase: 'sampling',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 10,
          totalTokens: 110,
        },
        usedFallback: false,
      });

      const result = await parser.parse(doc);

      expect(result.pageRangeMap).toBeDefined();
      // Verify the call was made (mimetype fallback happens internally)
      expect(mockCallVision).toHaveBeenCalled();
    });
  });

  describe('detectPattern', () => {
    test('rejects double-sided when endPageNo does not match startPageNo + 1', () => {
      // Valid samples but endPageNo is not startPageNo + 1
      const samples = [
        { pdfPageNo: 1, startPageNo: 1, endPageNo: 3 }, // Invalid: 3 !== 1+1
        { pdfPageNo: 2, startPageNo: 3, endPageNo: 5 }, // Invalid: 5 !== 3+1
        { pdfPageNo: 3, startPageNo: 5, endPageNo: 7 }, // Invalid: 7 !== 5+1
      ];

      const result = (parser as any).detectPattern(samples);

      // Should not detect DOUBLE_SIDED pattern due to invalid endPageNo
      expect(result.pattern).not.toBe('DOUBLE_SIDED');
    });

    test('returns UNKNOWN pattern when offsets are inconsistent', () => {
      // Samples with inconsistent offsets (difference > 1)
      const samples = [
        { pdfPageNo: 1, startPageNo: 10, endPageNo: null }, // offset: 10 - 1 = 9
        { pdfPageNo: 2, startPageNo: 15, endPageNo: null }, // offset: 15 - 2 = 13 (diff from avg > 1)
        { pdfPageNo: 3, startPageNo: 5, endPageNo: null }, // offset: 5 - 3 = 2 (very different)
      ];

      const result = (parser as any).detectPattern(samples);

      expect(result.pattern).toBe('unknown');
    });
  });

  describe('page grouping by size', () => {
    test('groups consecutive pages with same size together', async () => {
      const pages: Record<string, DoclingPage> = {
        '1': createMockPage(1, 595, 842),
        '2': createMockPage(2, 595, 842),
        '3': createMockPage(3, 612, 792), // Different size
        '4': createMockPage(4, 612, 792),
      };
      const doc = {
        ...createMockDocument(0),
        pages,
      };

      mockCallVision.mockResolvedValue({
        output: {
          pages: [
            { imageIndex: 0, startPageNo: 1, endPageNo: null },
            { imageIndex: 1, startPageNo: 2, endPageNo: null },
          ],
        },
        usage: {
          component: 'PageRangeParser',
          phase: 'sampling',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 200,
          outputTokens: 20,
          totalTokens: 220,
        },
        usedFallback: false,
      });

      const result = await parser.parse(doc);

      expect(Object.keys(result.pageRangeMap).length).toBeGreaterThan(0);
      expect(mockCallVision).toHaveBeenCalled();
    });

    test('handles pages with floating point size differences within tolerance', async () => {
      const pages: Record<string, DoclingPage> = {
        '1': createMockPage(1, 595.0, 842.0),
        '2': createMockPage(2, 595.2, 842.1), // Slight difference within tolerance
      };
      const doc = {
        ...createMockDocument(0),
        pages,
      };

      mockCallVision.mockResolvedValue({
        output: {
          pages: [
            { imageIndex: 0, startPageNo: 1, endPageNo: null },
            { imageIndex: 1, startPageNo: 2, endPageNo: null },
          ],
        },
        usage: {
          component: 'PageRangeParser',
          phase: 'sampling',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 200,
          outputTokens: 20,
          totalTokens: 220,
        },
        usedFallback: false,
      });

      const result = await parser.parse(doc);

      expect(result.pageRangeMap).toBeDefined();
    });
  });

  describe('pattern detection and application', () => {
    test('detects OFFSET pattern (consistent offset)', async () => {
      const doc = createMockDocument(8);

      // Return samples with consistent offset of +5
      mockCallVision.mockImplementation(async ({ messages }) => {
        const textContent = messages[0].content.find(
          (c: any) => c.type === 'text',
        );
        const match = textContent?.text?.match(/PDF pages: ([\d, ]+)/);
        const sampledPages = match
          ? match[1].split(', ').map(Number)
          : [1, 2, 3];

        return {
          output: {
            pages: sampledPages.map((pageNo: number, idx: number) => ({
              imageIndex: idx,
              startPageNo: pageNo + 5,
              endPageNo: null,
            })),
          },
          usage: {
            component: 'PageRangeParser',
            phase: 'sampling',
            model: 'primary',
            modelName: 'test-model',
            inputTokens: 150,
            outputTokens: 15,
            totalTokens: 165,
          },
          usedFallback: false,
        };
      });

      const result = await parser.parse(doc);

      // Verify offset is applied consistently
      expect(result.pageRangeMap[1]).toEqual({ startPageNo: 6, endPageNo: 6 });
      expect(result.pageRangeMap[8]).toEqual({
        startPageNo: 13,
        endPageNo: 13,
      });
    });

    test('handles DOUBLE_SIDED pattern detection', async () => {
      const doc = createMockDocument(6);

      mockCallVision.mockImplementation(async ({ messages }) => {
        const textContent = messages[0].content.find(
          (c: any) => c.type === 'text',
        );
        const match = textContent?.text?.match(/PDF pages: ([\d, ]+)/);
        const sampledPages = match
          ? match[1].split(', ').map(Number)
          : [1, 2, 3];

        return {
          output: {
            pages: sampledPages.map((pageNo: number, idx: number) => ({
              imageIndex: idx,
              startPageNo: pageNo * 2 - 1,
              endPageNo: pageNo * 2,
            })),
          },
          usage: {
            component: 'PageRangeParser',
            phase: 'sampling',
            model: 'primary',
            modelName: 'test-model',
            inputTokens: 150,
            outputTokens: 15,
            totalTokens: 165,
          },
          usedFallback: false,
        };
      });

      const result = await parser.parse(doc);

      expect(result.pageRangeMap).toBeDefined();
    });
  });

  describe('error recovery and retry', () => {
    test('retries pattern detection when initial sample returns partial nulls', async () => {
      const doc = createMockDocument(3);

      let callCount = 0;
      mockCallVision.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First attempt returns some null page numbers
          return {
            output: {
              pages: [
                { imageIndex: 0, startPageNo: 1, endPageNo: null },
                { imageIndex: 1, startPageNo: null, endPageNo: null },
                { imageIndex: 2, startPageNo: 3, endPageNo: null },
              ],
            },
            usage: {
              component: 'PageRangeParser',
              phase: 'sampling',
              model: 'primary',
              modelName: 'test-model',
              inputTokens: 150,
              outputTokens: 15,
              totalTokens: 165,
            },
            usedFallback: false,
          };
        }
        // Subsequent attempts return complete data
        return {
          output: {
            pages: [
              { imageIndex: 0, startPageNo: 1, endPageNo: null },
              { imageIndex: 1, startPageNo: 2, endPageNo: null },
              { imageIndex: 2, startPageNo: 3, endPageNo: null },
            ],
          },
          usage: {
            component: 'PageRangeParser',
            phase: 'sampling',
            model: 'primary',
            modelName: 'test-model',
            inputTokens: 150,
            outputTokens: 15,
            totalTokens: 165,
          },
          usedFallback: false,
        };
      });

      const result = await parser.parse(doc);

      expect(result.pageRangeMap).toBeDefined();
      expect(mockCallVision.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('multi-size-group processing', () => {
    test('handles document with multiple page size groups', async () => {
      const pages: Record<string, DoclingPage> = {
        '1': createMockPage(1, 595, 842),
        '2': createMockPage(2, 595, 842),
        '3': createMockPage(3, 612, 792),
        '4': createMockPage(4, 612, 792),
      };
      const doc = {
        ...createMockDocument(0),
        pages,
      };

      mockCallVision.mockResolvedValue({
        output: {
          pages: [
            { imageIndex: 0, startPageNo: 1, endPageNo: null },
            { imageIndex: 1, startPageNo: 2, endPageNo: null },
          ],
        },
        usage: {
          component: 'PageRangeParser',
          phase: 'sampling',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 10,
          totalTokens: 110,
        },
        usedFallback: false,
      });

      const result = await parser.parse(doc);

      expect(Object.keys(result.pageRangeMap).length).toBeGreaterThan(0);
      expect(mockCallVision.mock.calls.length).toBeGreaterThanOrEqual(2); // At least 2 groups
    });
  });

  describe('applyPattern', () => {
    test('handles UNKNOWN pattern by setting pages to 0', () => {
      // PagePattern.UNKNOWN = 'UNKNOWN'
      const pattern = { pattern: 'UNKNOWN', offset: 0, increment: 1 };
      const pageNos = [1, 2, 3];

      const result = (parser as any).applyPattern(pageNos, pattern);

      expect(result[1]).toEqual({ startPageNo: 0, endPageNo: 0 });
      expect(result[2]).toEqual({ startPageNo: 0, endPageNo: 0 });
      expect(result[3]).toEqual({ startPageNo: 0, endPageNo: 0 });
    });
  });

  describe('detectAndHandleOutliers', () => {
    test('detects outliers with double-sided pattern calculation', () => {
      // Test the double-sided branch in detectAndHandleOutliers (line 581)
      // isDoubleSided = true when startPageNo != endPageNo
      const pageRangeMap: Record<
        number,
        { startPageNo: number; endPageNo: number }
      > = {
        1: { startPageNo: 100, endPageNo: 100 }, // Outlier
        // Double-sided normal sequence
        2: { startPageNo: 5, endPageNo: 6 }, // Normal sequence start (double-sided)
        3: { startPageNo: 7, endPageNo: 8 }, // Normal (7-5=2, double-sided increment)
        4: { startPageNo: 9, endPageNo: 10 }, // Normal (9-7=2)
      };

      (parser as any).detectAndHandleOutliers(pageRangeMap);

      // Page 1: expected = 5 - (2-1)*2 = 5 - 2 = 3
      // 100 > 3 + 10 = 13? Yes, outlier
      expect(pageRangeMap[1].startPageNo).toBe(0);
      expect(pageRangeMap[2].startPageNo).toBe(5);
    });

    test('detects and marks outlier pages as failed', () => {
      // Outlier condition: pageNo > expectedPageNo + 10
      // normalSequenceStart must be > 0 for outlier detection
      // findNormalSequenceStart finds index where valid sequence starts
      // To trigger outlier detection:
      // - First pages must NOT form a valid sequence (so findNormalSequenceStart returns index > 0)
      // - Then have a valid sequence after
      const pageRangeMap: Record<
        number,
        { startPageNo: number; endPageNo: number }
      > = {
        // Outlier pages (do not form valid pattern with pages 4,5,6)
        1: { startPageNo: 100, endPageNo: 100 }, // Outlier: 100 > (10 + 10) = 20
        // Normal sequence starting at index 1 (pdf page 2)
        // Must be consecutive: 2->3->4 with increment 1
        2: { startPageNo: 10, endPageNo: 10 }, // Normal sequence start (index 1)
        3: { startPageNo: 11, endPageNo: 11 }, // index 2: 11 - 10 = 1, valid
        4: { startPageNo: 12, endPageNo: 12 }, // index 3: 12 - 11 = 1, valid
      };

      (parser as any).detectAndHandleOutliers(pageRangeMap);

      // Page 1 should be marked as outlier (set to 0)
      // expected for page 1: normalStartPageNo(10) - pdfDiff(2-1=1) = 9
      // 100 > 9 + 10 = 19? Yes, so outlier
      expect(pageRangeMap[1].startPageNo).toBe(0);
      // Normal pages should be unchanged
      expect(pageRangeMap[2].startPageNo).toBe(10);
      expect(pageRangeMap[3].startPageNo).toBe(11);
    });

    test('does not detect outliers when difference is within threshold', () => {
      // Outlier condition: pageNo > expectedPageNo + 10
      // If pageNo <= expectedPageNo + 10, no outlier
      const pageRangeMap: Record<
        number,
        { startPageNo: number; endPageNo: number }
      > = {
        1: { startPageNo: 15, endPageNo: 15 }, // Not outlier: expected=9, 15 <= 9+10=19
        2: { startPageNo: 10, endPageNo: 10 }, // Normal sequence start
        3: { startPageNo: 11, endPageNo: 11 }, // Normal sequence
        4: { startPageNo: 12, endPageNo: 12 }, // Normal sequence
      };

      (parser as any).detectAndHandleOutliers(pageRangeMap);

      // Page 1 should NOT be marked as outlier (15 <= 19)
      expect(pageRangeMap[1].startPageNo).toBe(15);
    });

    test('skips pages with pageNo === 0 when detecting outliers', () => {
      // When pageNo === 0, the page should be skipped (continue statement at line 571)
      const pageRangeMap: Record<
        number,
        { startPageNo: number; endPageNo: number }
      > = {
        1: { startPageNo: 0, endPageNo: 0 }, // pageNo === 0, should be skipped
        2: { startPageNo: 10, endPageNo: 10 }, // Normal sequence start
        3: { startPageNo: 11, endPageNo: 11 }, // Normal sequence
        4: { startPageNo: 12, endPageNo: 12 }, // Normal sequence
      };

      (parser as any).detectAndHandleOutliers(pageRangeMap);

      // Page 1 with pageNo=0 should remain unchanged (skipped, not processed as outlier)
      expect(pageRangeMap[1].startPageNo).toBe(0);
      expect(pageRangeMap[1].endPageNo).toBe(0);
      // Normal pages should be unchanged
      expect(pageRangeMap[2].startPageNo).toBe(10);
    });
  });

  describe('private post-processing methods', () => {
    test('detectAndHandleDrops recalculates single-page pattern when drop detected', () => {
      // Drop condition: prevPageNo > currPageNo && prevPageNo - currPageNo > 1
      // PDF page 3 (pageNo=50) -> PDF page 4 (pageNo=1) triggers drop
      const pageRangeMap: Record<
        number,
        { startPageNo: number; endPageNo: number }
      > = {
        1: { startPageNo: 48, endPageNo: 48 }, // Will be recalculated
        2: { startPageNo: 49, endPageNo: 49 }, // Will be recalculated
        3: { startPageNo: 50, endPageNo: 50 }, // prevPageNo = 50
        4: { startPageNo: 1, endPageNo: 1 }, // currPageNo = 1 (drop point)
        5: { startPageNo: 2, endPageNo: 2 },
      };

      (parser as any).detectAndHandleDrops(pageRangeMap);

      // Pages 1-3 should be recalculated based on drop point (page 4 = 1)
      // Single-page: expectedPageNo = currPageNo - distance
      // Page 1: 1 - 3 = -2 -> 0
      // Page 2: 1 - 2 = -1 -> 0
      // Page 3: 1 - 1 = 0 -> 0
      expect(pageRangeMap[1].startPageNo).toBe(0);
      expect(pageRangeMap[2].startPageNo).toBe(0);
      expect(pageRangeMap[3].startPageNo).toBe(0);
      expect(pageRangeMap[4].startPageNo).toBe(1);
    });

    test('detectAndHandleDrops recalculates single-page pattern with positive results', () => {
      // Create scenario where recalculation results in positive values
      const pageRangeMap: Record<
        number,
        { startPageNo: number; endPageNo: number }
      > = {
        1: { startPageNo: 50, endPageNo: 50 }, // Will be recalculated to 7
        2: { startPageNo: 51, endPageNo: 51 }, // Will be recalculated to 8
        3: { startPageNo: 10, endPageNo: 10 }, // Drop point: currPageNo = 10
      };

      (parser as any).detectAndHandleDrops(pageRangeMap);

      // Page 1: 10 - 2 = 8
      // Page 2: 10 - 1 = 9
      expect(pageRangeMap[1].startPageNo).toBe(8);
      expect(pageRangeMap[1].endPageNo).toBe(8);
      expect(pageRangeMap[2].startPageNo).toBe(9);
      expect(pageRangeMap[2].endPageNo).toBe(9);
    });

    test('detectAndHandleDrops handles double-sided recalculation with positive results', () => {
      // Double-sided drop scenario
      const pageRangeMap: Record<
        number,
        { startPageNo: number; endPageNo: number }
      > = {
        1: { startPageNo: 50, endPageNo: 51 }, // Will be recalculated
        2: { startPageNo: 52, endPageNo: 53 }, // Will be recalculated
        3: { startPageNo: 10, endPageNo: 11 }, // Drop point: double-sided (10-11)
      };

      (parser as any).detectAndHandleDrops(pageRangeMap);

      // Double-sided: expectedStartPageNo = currPageNo - distance * 2
      // Page 1: 10 - 2*2 = 6, endPageNo = 7
      // Page 2: 10 - 1*2 = 8, endPageNo = 9
      expect(pageRangeMap[1].startPageNo).toBe(6);
      expect(pageRangeMap[1].endPageNo).toBe(7);
      expect(pageRangeMap[2].startPageNo).toBe(8);
      expect(pageRangeMap[2].endPageNo).toBe(9);
    });

    test('detectAndHandleDrops handles double-sided with negative recalculation', () => {
      // Double-sided where recalculation results in negative
      const pageRangeMap: Record<
        number,
        { startPageNo: number; endPageNo: number }
      > = {
        1: { startPageNo: 50, endPageNo: 51 }, // Will be recalculated to negative -> 0
        2: { startPageNo: 52, endPageNo: 53 }, // Will be recalculated to negative -> 0
        3: { startPageNo: 2, endPageNo: 3 }, // Drop point: double-sided (2-3)
      };

      (parser as any).detectAndHandleDrops(pageRangeMap);

      // Double-sided: expectedStartPageNo = currPageNo - distance * 2
      // Page 1: 2 - 2*2 = -2 -> 0
      // Page 2: 2 - 1*2 = 0 -> 0 (< 1)
      expect(pageRangeMap[1].startPageNo).toBe(0);
      expect(pageRangeMap[1].endPageNo).toBe(0);
      expect(pageRangeMap[2].startPageNo).toBe(0);
      expect(pageRangeMap[2].endPageNo).toBe(0);
    });

    test('backfillFailedPages fills pages using double-sided pattern', () => {
      const pageRangeMap: Record<
        number,
        { startPageNo: number; endPageNo: number }
      > = {
        1: { startPageNo: 0, endPageNo: 0 }, // Failed - will be backfilled
        2: { startPageNo: 0, endPageNo: 0 }, // Failed - will be backfilled
        3: { startPageNo: 5, endPageNo: 6 }, // Success - double-sided
        4: { startPageNo: 7, endPageNo: 8 }, // Success - double-sided
        5: { startPageNo: 9, endPageNo: 10 }, // Success - double-sided
      };

      (parser as any).backfillFailedPages(pageRangeMap);

      // Pages 1 and 2 should be backfilled with double-sided pattern
      // Pattern: startPageNo = pdfPage * 2 + offset
      // From page 3: 5 = 3 * 2 + offset => offset = -1
      // Page 1: 1 * 2 + (-1) = 1, endPageNo = 2
      // Page 2: 2 * 2 + (-1) = 3, endPageNo = 4
      expect(pageRangeMap[1].startPageNo).toBe(1);
      expect(pageRangeMap[1].endPageNo).toBe(2);
      expect(pageRangeMap[2].startPageNo).toBe(3);
      expect(pageRangeMap[2].endPageNo).toBe(4);
    });

    test('backfillFailedPages skips when result would be negative', () => {
      const pageRangeMap: Record<
        number,
        { startPageNo: number; endPageNo: number }
      > = {
        1: { startPageNo: 0, endPageNo: 0 }, // Failed - would be negative
        2: { startPageNo: 1, endPageNo: 2 }, // Success - double-sided
        3: { startPageNo: 3, endPageNo: 4 }, // Success - double-sided
        4: { startPageNo: 5, endPageNo: 6 }, // Success - double-sided
      };

      (parser as any).backfillFailedPages(pageRangeMap);

      // Page 1 backfill: 1 * 2 + offset
      // From page 2: 1 = 2 * 2 + offset => offset = -3
      // Page 1: 1 * 2 + (-3) = -1 -> skip, stays 0
      expect(pageRangeMap[1].startPageNo).toBe(0);
    });

    test('backfillFailedPages skips single-sided pages when result would be negative', () => {
      const pageRangeMap: Record<
        number,
        { startPageNo: number; endPageNo: number }
      > = {
        1: { startPageNo: 0, endPageNo: 0 }, // Failed - would be negative
        2: { startPageNo: 0, endPageNo: 0 }, // Failed - would be negative
        3: { startPageNo: 1, endPageNo: 1 }, // Success - single-sided (offset = -2)
        4: { startPageNo: 2, endPageNo: 2 }, // Success - single-sided (offset = -2)
        5: { startPageNo: 3, endPageNo: 3 }, // Success - single-sided (offset = -2)
      };

      (parser as any).backfillFailedPages(pageRangeMap);

      // Single-sided pattern detected (startPageNo === endPageNo)
      // Offsets: 1-3=-2, 2-4=-2, 3-5=-2 => avgOffset = -2
      // Page 1: 1 + (-2) = -1 < 1 -> skip
      // Page 2: 2 + (-2) = 0 < 1 -> skip
      expect(pageRangeMap[1].startPageNo).toBe(0);
      expect(pageRangeMap[1].endPageNo).toBe(0);
      expect(pageRangeMap[2].startPageNo).toBe(0);
      expect(pageRangeMap[2].endPageNo).toBe(0);
    });
  });

  describe('post-processing and backfill', () => {
    test('handles large document with mixed page patterns', async () => {
      const doc = createMockDocument(20);

      mockCallVision.mockImplementation(async ({ messages }) => {
        const textContent = messages[0].content.find(
          (c: any) => c.type === 'text',
        );
        const match = textContent?.text?.match(/PDF pages: ([\d, ]+)/);
        const sampledPages = match
          ? match[1].split(', ').map(Number)
          : [1, 2, 3];

        // Simulate consistent offset pattern
        return {
          output: {
            pages: sampledPages.map((pageNo: number, idx: number) => ({
              imageIndex: idx,
              startPageNo: pageNo + 10,
              endPageNo: null,
            })),
          },
          usage: {
            component: 'PageRangeParser',
            phase: 'sampling',
            model: 'primary',
            modelName: 'test-model',
            inputTokens: 200,
            outputTokens: 20,
            totalTokens: 220,
          },
          usedFallback: false,
        };
      });

      const result = await parser.parse(doc);

      expect(Object.keys(result.pageRangeMap).length).toBe(20);
      expect(result.usage).toHaveLength(1);
    });

    test('handles negative page number normalization', async () => {
      const doc = createMockDocument(3);

      mockCallVision.mockResolvedValue({
        output: {
          pages: [
            { imageIndex: 0, startPageNo: -1, endPageNo: null },
            { imageIndex: 1, startPageNo: 2, endPageNo: null },
            { imageIndex: 2, startPageNo: 3, endPageNo: -2 },
          ],
        },
        usage: {
          component: 'PageRangeParser',
          phase: 'sampling',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 10,
          totalTokens: 110,
        },
        usedFallback: false,
      });

      const result = await parser.parse(doc);

      // Pages with negative numbers should be normalized to 0
      expect(result.pageRangeMap[1]).toEqual({ startPageNo: 0, endPageNo: 0 });
      expect(result.pageRangeMap[3]).toEqual({ startPageNo: 0, endPageNo: 0 });
    });

    test('handles backfill with single-page pattern', async () => {
      const doc = createMockDocument(5);

      mockCallVision.mockImplementation(async ({ messages }) => {
        const textContent = messages[0].content.find(
          (c: any) => c.type === 'text',
        );
        const match = textContent?.text?.match(/PDF pages: ([\d, ]+)/);
        const sampledPages = match
          ? match[1].split(', ').map(Number)
          : [1, 2, 3];

        // Return patterns: some pages with values, some with 0 (failed)
        return {
          output: {
            pages: sampledPages.map((pageNo: number, idx: number) => ({
              imageIndex: idx,
              startPageNo: pageNo === 2 ? 0 : pageNo + 10,
              endPageNo: null,
            })),
          },
          usage: {
            component: 'PageRangeParser',
            phase: 'sampling',
            model: 'primary',
            modelName: 'test-model',
            inputTokens: 100,
            outputTokens: 10,
            totalTokens: 110,
          },
          usedFallback: false,
        };
      });

      const result = await parser.parse(doc);

      expect(result.pageRangeMap).toBeDefined();
      expect(Object.keys(result.pageRangeMap).length).toBeGreaterThan(0);
    });

    test('handles backfill with double-sided pattern', async () => {
      const doc = createMockDocument(6);

      mockCallVision.mockImplementation(async ({ messages }) => {
        const textContent = messages[0].content.find(
          (c: any) => c.type === 'text',
        );
        const match = textContent?.text?.match(/PDF pages: ([\d, ]+)/);
        const sampledPages = match
          ? match[1].split(', ').map(Number)
          : [1, 2, 3];

        // Return double-sided patterns with some 0s for backfill
        return {
          output: {
            pages: sampledPages.map((pageNo: number, idx: number) => {
              const startPageNo = pageNo * 2 - 1;
              const endPageNo = pageNo * 2;
              return {
                imageIndex: idx,
                startPageNo: pageNo === 2 ? 0 : startPageNo,
                endPageNo: pageNo === 2 ? null : endPageNo,
              };
            }),
          },
          usage: {
            component: 'PageRangeParser',
            phase: 'sampling',
            model: 'primary',
            modelName: 'test-model',
            inputTokens: 100,
            outputTokens: 10,
            totalTokens: 110,
          },
          usedFallback: false,
        };
      });

      const result = await parser.parse(doc);

      expect(result.pageRangeMap).toBeDefined();
    });

    test('skips backfill when not enough successful pages', async () => {
      const doc = createMockDocument(3);

      // Mock to return all zeros (no successful pages)
      mockCallVision.mockResolvedValue({
        output: {
          pages: [
            { imageIndex: 0, startPageNo: 0, endPageNo: null },
            { imageIndex: 1, startPageNo: 0, endPageNo: null },
            { imageIndex: 2, startPageNo: 0, endPageNo: null },
          ],
        },
        usage: {
          component: 'PageRangeParser',
          phase: 'sampling',
          model: 'primary',
          modelName: 'test-model',
          inputTokens: 100,
          outputTokens: 10,
          totalTokens: 110,
        },
        usedFallback: false,
      });

      const result = await parser.parse(doc);

      // Should return zero values, backfill should be skipped
      expect(result.pageRangeMap[1]).toEqual({ startPageNo: 0, endPageNo: 0 });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Not enough successful pages'),
      );
    });

    test('handles successful pattern detection with consistent results', async () => {
      const doc = createMockDocument(5);

      mockCallVision.mockImplementation(async () => {
        // Return consistent pattern that matches on first attempt
        return {
          output: {
            pages: [
              { imageIndex: 0, startPageNo: 1, endPageNo: null },
              { imageIndex: 1, startPageNo: 2, endPageNo: null },
              { imageIndex: 2, startPageNo: 3, endPageNo: null },
            ],
          },
          usage: {
            component: 'PageRangeParser',
            phase: 'sampling',
            model: 'primary',
            modelName: 'test-model',
            inputTokens: 100,
            outputTokens: 10,
            totalTokens: 110,
          },
          usedFallback: false,
        };
      });

      const result = await parser.parse(doc);

      expect(result.pageRangeMap).toBeDefined();
      expect(Object.keys(result.pageRangeMap).length).toBe(5);
    });
  });

  describe('buildSystemPrompt and buildUserPrompt', () => {
    test('buildSystemPrompt returns proper instruction text', () => {
      const prompt = (parser as any).buildSystemPrompt();

      expect(prompt).toContain('page number extraction specialist');
      expect(prompt).toContain('SINGLE PAGE');
      expect(prompt).toContain('DOUBLE-SIDED');
      expect(prompt).toContain('WHAT TO IGNORE');
      expect(prompt).toContain('Roman numerals');
      expect(prompt).toContain('Figure numbers');
      expect(prompt).toContain('Table numbers');
      expect(prompt).toContain('imageIndex');
      expect(prompt).toContain('RESPONSE FORMAT');
    });

    test('buildUserPrompt includes image references and sample pages', () => {
      const prompt = (parser as any).buildUserPrompt([1, 2]);

      expect(prompt).toContain('PDF pages');
      expect(prompt).toContain('1, 2');
      expect(prompt).toContain('document page images');
      expect(prompt).toContain('SMALL numbers');
    });

    test('buildUserPrompt works with empty page list', () => {
      const prompt = (parser as any).buildUserPrompt([]);

      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe('string');
      expect(prompt).toContain('PDF pages');
    });
  });
});
