import type { LoggerMethods } from '@heripo/logger';
import type {
  DoclingDocument,
  DoclingPictureItem,
  DoclingTextItem,
} from '@heripo/model';
import type { LanguageModel } from 'ai';

import { LLMCaller, LLMTokenUsageAggregator } from '@heripo/shared';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { HanjaQualitySampler } from './hanja-quality-sampler';

vi.mock('@heripo/shared', () => ({
  LLMCaller: {
    callVision: vi.fn(),
  },
  LLMTokenUsageAggregator: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('node:path', () => ({
  resolve: vi.fn((...args: string[]) => args.join('/')),
  isAbsolute: vi.fn(() => false),
}));

const mockCallVision = vi.mocked(LLMCaller.callVision);
const mockLLMTokenUsageAggregator = vi.mocked(LLMTokenUsageAggregator);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockPathResolve = vi.mocked(path.resolve);

/**
 * Helper to create a DoclingTextItem
 */
function createTextItem(text: string, pageNo: number): DoclingTextItem {
  return {
    text,
    prov: [{ page_no: pageNo }],
    label: 'text',
    orig: text,
  } as DoclingTextItem;
}

/**
 * Helper to create a DoclingPictureItem on a given page
 */
function createPictureItem(pageNo: number): DoclingPictureItem {
  return {
    self_ref: `#/pictures/${pageNo}`,
    children: [],
    content_layer: 'body',
    label: 'picture',
    prov: [{ page_no: pageNo }],
    captions: [],
    references: [],
    footnotes: [],
    annotations: [],
  } as unknown as DoclingPictureItem;
}

/**
 * Helper to generate a pages record for a given total page count
 */
function generatePages(totalPages: number): Record<string, unknown> {
  const pages: Record<string, unknown> = {};
  for (let i = 1; i <= totalPages; i++) {
    pages[String(i)] = {
      size: { width: 595, height: 842 },
      image: {
        mimetype: 'image/png',
        dpi: 72,
        size: { width: 595, height: 842 },
        uri: '',
      },
      page_no: i,
    };
  }
  return pages;
}

/**
 * Helper to create a DoclingDocument from text items with optional totalPages and pictures
 */
function createDoclingDoc(
  texts: DoclingTextItem[],
  options?: { totalPages?: number; pictures?: DoclingPictureItem[] },
): DoclingDocument {
  const maxPage = texts.reduce((max, t) => {
    const p = t.prov?.[0]?.page_no ?? 1;
    return Math.max(max, p);
  }, 0);
  const totalPages = options?.totalPages ?? maxPage;
  return {
    texts,
    pages: generatePages(totalPages),
    pictures: options?.pictures ?? [],
    tables: [],
  } as unknown as DoclingDocument;
}

/**
 * Helper to create a mock callVision response for Hanja role assessment
 */
function createRoleResponse(
  hasHanja: boolean,
  hanjaRole: 'none' | 'supplementary' | 'essential',
  explanation: string,
  phase: string,
) {
  return {
    output: {
      hasHanja,
      hanjaRole,
      explanation,
    },
    usage: {
      component: 'HanjaQualitySampler',
      phase,
      model: 'primary' as const,
      modelName: 'test-model',
      inputTokens: 500,
      outputTokens: 50,
      totalTokens: 550,
    },
    usedFallback: false,
  };
}

/**
 * Generate a string of the specified length
 */
function generateText(length: number): string {
  return 'A'.repeat(length);
}

describe('HanjaQualitySampler', () => {
  let mockModel: LanguageModel;
  let mockLogger: LoggerMethods;
  let sampler: HanjaQualitySampler;
  let mockAggregator: {
    reset: ReturnType<typeof vi.fn>;
    track: ReturnType<typeof vi.fn>;
    logSummary: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockCallVision.mockClear();
    mockLLMTokenUsageAggregator.mockClear();
    mockReadFileSync.mockClear();
    mockPathResolve.mockClear();

    mockAggregator = {
      reset: vi.fn(),
      track: vi.fn(),
      logSummary: vi.fn(),
    };
    mockLLMTokenUsageAggregator.mockImplementation(function () {
      return mockAggregator as unknown as LLMTokenUsageAggregator;
    });

    mockModel = { modelId: 'test-model' } as LanguageModel;
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // Default path.resolve behavior
    mockPathResolve.mockImplementation((...args: string[]) => args.join('/'));

    // Default file read behavior - return fake image buffer
    mockReadFileSync.mockReturnValue(Buffer.from('fake-image-data'));

    sampler = new HanjaQualitySampler(
      mockLogger,
      mockModel,
      '/output/path',
      undefined,
      undefined,
      mockAggregator as unknown as LLMTokenUsageAggregator,
    );
  });

  describe('assess', () => {
    test('returns hanjaRole=none when no text pages found (short texts only)', async () => {
      const doc = createDoclingDoc(
        [createTextItem('Short text', 5), createTextItem('Another short', 6)],
        { totalPages: 20 },
      );

      const result = await sampler.assess(doc);

      expect(result).toEqual({
        needsVlmReparse: false,
        hanjaRole: 'none',
        hanjaPageCount: 0,
        sampledPageCount: 0,
        reason: 'No text pages found for assessment',
      });
      expect(mockCallVision).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[HanjaQualitySampler] No text pages found for assessment',
      );
    });

    test('returns hanjaRole=none when pages have text below MIN_TEXT_LENGTH threshold', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(50), 5),
          createTextItem(generateText(99), 6),
        ],
        { totalPages: 20 },
      );

      const result = await sampler.assess(doc);

      expect(result).toEqual({
        needsVlmReparse: false,
        hanjaRole: 'none',
        hanjaPageCount: 0,
        sampledPageCount: 0,
        reason: 'No text pages found for assessment',
      });
      expect(mockCallVision).not.toHaveBeenCalled();
    });

    test('returns hanjaRole=essential when any sampled page has essential Hanja', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(300), 5),
          createTextItem(generateText(200), 6),
          createTextItem(generateText(150), 7),
        ],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(
          true,
          'essential',
          'Mixed Korean-Hanja text on page 5',
          'page-5',
        ),
      );

      const result = await sampler.assess(doc);

      expect(result.needsVlmReparse).toBe(true);
      expect(result.hanjaRole).toBe('essential');
      expect(result.hanjaPageCount).toBe(3);
      expect(result.sampledPageCount).toBe(3);
      expect(result.reason).toContain('essential Hanja');
      // Early break: only 1 call since essential was found on first page
      expect(mockCallVision).toHaveBeenCalledTimes(1);
    });

    test('returns hanjaRole=supplementary when Hanja appears only as annotations', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(400), 5),
          createTextItem(generateText(300), 6),
          createTextItem(generateText(200), 7),
          createTextItem(generateText(150), 8),
        ],
        { totalPages: 20 },
      );

      mockCallVision
        .mockResolvedValueOnce(
          createRoleResponse(
            true,
            'supplementary',
            'Parenthetical Hanja annotations',
            'page-5',
          ),
        )
        .mockResolvedValueOnce(
          createRoleResponse(
            true,
            'supplementary',
            'Parenthetical Hanja annotations',
            'page-6',
          ),
        )
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-7'),
        )
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-8'),
        );

      const result = await sampler.assess(doc);

      expect(result.needsVlmReparse).toBe(false);
      expect(result.hanjaRole).toBe('supplementary');
      expect(result.hanjaPageCount).toBe(4);
      expect(result.sampledPageCount).toBe(4);
      expect(result.reason).toContain('parenthetical annotations');
      expect(result.reason).toContain('2/4');
    });

    test('returns hanjaRole=none when text pages present but no Hanja found', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(300), 5),
          createTextItem(generateText(200), 6),
          createTextItem(generateText(150), 7),
        ],
        { totalPages: 20 },
      );

      mockCallVision
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-5'),
        )
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-6'),
        )
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-7'),
        );

      const result = await sampler.assess(doc);

      expect(result.needsVlmReparse).toBe(false);
      expect(result.hanjaRole).toBe('none');
      expect(result.hanjaPageCount).toBe(3);
      expect(result.sampledPageCount).toBe(3);
      expect(result.reason).toBe('No Hanja characters found in sampled pages');
    });

    test('early breaks when essential Hanja detected mid-evaluation', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(400), 5),
          createTextItem(generateText(300), 6),
          createTextItem(generateText(200), 7),
          createTextItem(generateText(150), 8),
        ],
        { totalPages: 20 },
      );

      mockCallVision
        .mockResolvedValueOnce(
          createRoleResponse(
            true,
            'supplementary',
            'Parenthetical annotations',
            'page-5',
          ),
        )
        .mockResolvedValueOnce(
          createRoleResponse(
            true,
            'essential',
            'Mixed Korean-Hanja text',
            'page-6',
          ),
        );

      const result = await sampler.assess(doc);

      expect(result.needsVlmReparse).toBe(true);
      expect(result.hanjaRole).toBe('essential');
      // Only 2 VLM calls: stopped after essential found on page 6
      expect(mockCallVision).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Essential Hanja detected on page 6'),
      );
    });

    test('evaluates all pages when no essential Hanja is found', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(300), 5),
          createTextItem(generateText(200), 6),
          createTextItem(generateText(150), 7),
        ],
        { totalPages: 20 },
      );

      mockCallVision
        .mockResolvedValueOnce(
          createRoleResponse(
            true,
            'supplementary',
            'Parenthetical annotations',
            'page-5',
          ),
        )
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-6'),
        )
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-7'),
        );

      await sampler.assess(doc);

      // All 3 pages evaluated since no essential was found
      expect(mockCallVision).toHaveBeenCalledTimes(3);
    });

    test('handles image load failure by marking page as no Hanja', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(300), 5),
          createTextItem(generateText(200), 6),
          createTextItem(generateText(150), 7),
        ],
        { totalPages: 20 },
      );

      mockReadFileSync.mockImplementation((filePath: unknown) => {
        if (typeof filePath === 'string' && filePath.includes('page_4')) {
          throw new Error('File not found: page_4.png');
        }
        return Buffer.from('fake-image-data');
      });

      mockCallVision
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-6'),
        )
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-7'),
        );

      const result = await sampler.assess(doc);

      expect(result.hanjaRole).toBe('none');
      expect(result.needsVlmReparse).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load page image for page'),
      );
      expect(mockCallVision).toHaveBeenCalledTimes(2);
    });

    test('uses correct 0-based page image path (page N -> page_{N-1}.png)', async () => {
      const doc = createDoclingDoc([createTextItem(generateText(200), 5)], {
        totalPages: 20,
      });

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-5'),
      );

      await sampler.assess(doc);

      expect(mockPathResolve).toHaveBeenCalledWith(
        '/output/path',
        'pages/page_4.png',
      );
    });

    test('defaults to page 1 when prov is missing', async () => {
      const textWithoutProv = {
        text: generateText(200),
        label: 'text',
        orig: generateText(200),
      } as unknown as DoclingTextItem;

      const doc = createDoclingDoc([textWithoutProv], { totalPages: 0 });

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-1'),
      );

      await sampler.assess(doc);

      expect(mockPathResolve).toHaveBeenCalledWith(
        '/output/path',
        'pages/page_0.png',
      );
    });

    test('defaults to page 1 when prov is an empty array', async () => {
      const textWithEmptyProv = {
        text: generateText(200),
        prov: [],
        label: 'text',
        orig: generateText(200),
      } as unknown as DoclingTextItem;

      const doc = createDoclingDoc([textWithEmptyProv], { totalPages: 0 });

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-1'),
      );

      await sampler.assess(doc);

      expect(mockPathResolve).toHaveBeenCalledWith(
        '/output/path',
        'pages/page_0.png',
      );
    });

    test('tracks token usage for each evaluated page', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(300), 5),
          createTextItem(generateText(200), 6),
          createTextItem(generateText(150), 7),
        ],
        { totalPages: 20 },
      );

      mockCallVision
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-5'),
        )
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-6'),
        )
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-7'),
        );

      await sampler.assess(doc);

      expect(mockAggregator.track).toHaveBeenCalledTimes(3);
    });

    test('tracks fewer token usages when early break occurs', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(300), 5),
          createTextItem(generateText(200), 6),
          createTextItem(generateText(150), 7),
        ],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(
          true,
          'essential',
          'Mixed Korean-Hanja text',
          'page-5',
        ),
      );

      await sampler.assess(doc);

      expect(mockAggregator.track).toHaveBeenCalledTimes(1);
    });

    test('logs assessment start, page info, and completion', async () => {
      const doc = createDoclingDoc([createTextItem(generateText(200), 5)], {
        totalPages: 20,
      });

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-5'),
      );

      await sampler.assess(doc);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[HanjaQualitySampler] Starting Hanja role assessment...',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Total pages: 20, eligible range: (2, 18]'),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Assessment complete'),
      );
    });

    test('handles empty document with no texts', async () => {
      const doc = createDoclingDoc([], { totalPages: 0 });

      const result = await sampler.assess(doc);

      expect(result.hanjaRole).toBe('none');
      expect(result.needsVlmReparse).toBe(false);
      expect(result.hanjaPageCount).toBe(0);
    });

    test('aggregates texts from multiple items on the same page for text length', async () => {
      // Two items on page 5: 60 + 60 = 120 >= 100 threshold
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(60), 5),
          createTextItem(generateText(60), 5),
        ],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-5'),
      );

      const result = await sampler.assess(doc);

      expect(result.hanjaPageCount).toBe(1);
      expect(result.sampledPageCount).toBe(1);
      expect(mockCallVision).toHaveBeenCalledTimes(1);
    });

    test('excludes pages where aggregated text is still below threshold', async () => {
      // Two items on page 5: 30 + 30 = 60 < 100 threshold -> excluded
      // Page 6: 150 >= 100 -> included
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(30), 5),
          createTextItem(generateText(30), 5),
          createTextItem(generateText(150), 6),
        ],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-6'),
      );

      const result = await sampler.assess(doc);

      expect(result.hanjaPageCount).toBe(1);
      expect(result.sampledPageCount).toBe(1);
    });
  });

  describe('selectSamplePages', () => {
    test('selects max 10 pages when there are many text pages', async () => {
      const texts: DoclingTextItem[] = [];
      for (let i = 11; i <= 25; i++) {
        texts.push(createTextItem(generateText(100 + i * 10), i));
      }
      const doc = createDoclingDoc(texts, { totalPages: 100 });

      for (let i = 0; i < 10; i++) {
        mockCallVision.mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', `page-${25 - i}`),
        );
      }

      const result = await sampler.assess(doc);

      expect(result.sampledPageCount).toBe(10);
      expect(mockCallVision).toHaveBeenCalledTimes(10);
    });

    test('selects all pages when fewer than MAX_SAMPLE_PAGES qualify', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(300), 5),
          createTextItem(generateText(200), 6),
        ],
        { totalPages: 20 },
      );

      mockCallVision
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-5'),
        )
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-6'),
        );

      const result = await sampler.assess(doc);

      expect(result.sampledPageCount).toBe(2);
      expect(mockCallVision).toHaveBeenCalledTimes(2);
    });

    test('selects single page when only 1 page qualifies', async () => {
      const doc = createDoclingDoc([createTextItem(generateText(200), 5)], {
        totalPages: 20,
      });

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-5'),
      );

      const result = await sampler.assess(doc);

      expect(result.sampledPageCount).toBe(1);
      expect(mockCallVision).toHaveBeenCalledTimes(1);
    });

    test('sorts pages by text length (longest first)', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(120), 5),
          createTextItem(generateText(500), 6),
          createTextItem(generateText(250), 7),
        ],
        { totalPages: 20 },
      );

      const callOrder: string[] = [];
      mockCallVision.mockImplementation(async (args: unknown) => {
        const typedArgs = args as { phase: string };
        callOrder.push(typedArgs.phase);
        return createRoleResponse(false, 'none', 'No Hanja', typedArgs.phase);
      });

      await sampler.assess(doc);

      expect(callOrder).toEqual(['page-6', 'page-7', 'page-5']);
    });

    test('uses all pages when fewer than 10 qualify (exhaustive check)', async () => {
      const texts: DoclingTextItem[] = [];
      for (let i = 5; i <= 11; i++) {
        texts.push(createTextItem(generateText(100 + i * 10), i));
      }
      const doc = createDoclingDoc(texts, { totalPages: 20 });

      for (let i = 0; i < 7; i++) {
        mockCallVision.mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', `page-${11 - i}`),
        );
      }

      const result = await sampler.assess(doc);

      expect(result.sampledPageCount).toBe(7);
      expect(mockCallVision).toHaveBeenCalledTimes(7);
    });
  });

  describe('edge trimming', () => {
    test('prefers pages in the middle range over edge pages for sampling', async () => {
      // 100-page doc: frontCutoff=10, backCutoff=90
      // Page 5 (edge) and page 50 (middle) both have text
      // Should prefer page 50; page 5 is filtered out from sampling
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(200), 5),
          createTextItem(generateText(200), 50),
        ],
        { totalPages: 100 },
      );

      const callOrder: string[] = [];
      mockCallVision.mockImplementation(async (args: unknown) => {
        const typedArgs = args as { phase: string };
        callOrder.push(typedArgs.phase);
        return createRoleResponse(false, 'none', 'No Hanja', typedArgs.phase);
      });

      const result = await sampler.assess(doc);

      // Both pages found as text pages
      expect(result.hanjaPageCount).toBe(2);
      // Only middle page sampled (edge page filtered from sampling)
      expect(result.sampledPageCount).toBe(1);
      expect(callOrder).toEqual(['page-50']);
    });

    test('excludes edge pages from sampling when enough middle pages exist', async () => {
      // 100-page doc: frontCutoff=10, backCutoff=90
      // 12 pages total: 2 edge + 10 middle -> should sample 10 middle pages only
      const texts: DoclingTextItem[] = [
        createTextItem(generateText(200), 5),
        createTextItem(generateText(200), 95),
      ];
      for (let i = 20; i <= 29; i++) {
        texts.push(createTextItem(generateText(200), i));
      }
      const doc = createDoclingDoc(texts, { totalPages: 100 });

      const calledPages: number[] = [];
      mockCallVision.mockImplementation(async (args: unknown) => {
        const typedArgs = args as { phase: string };
        const pageNo = parseInt(typedArgs.phase.replace('page-', ''));
        calledPages.push(pageNo);
        return createRoleResponse(false, 'none', 'No Hanja', typedArgs.phase);
      });

      const result = await sampler.assess(doc);

      // All 12 pages have text
      expect(result.hanjaPageCount).toBe(12);
      // Only 10 sampled (the middle ones)
      expect(result.sampledPageCount).toBe(10);
      // Edge pages (5, 95) should NOT be in sampled pages
      expect(calledPages).not.toContain(5);
      expect(calledPages).not.toContain(95);
    });

    test('falls back to all text pages when filtering removes everything', async () => {
      // All text pages are in the edge range
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(200), 2),
          createTextItem(generateText(200), 99),
        ],
        { totalPages: 100 },
      );

      mockCallVision
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-2'),
        )
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-99'),
        );

      const result = await sampler.assess(doc);

      // Should still find and sample both pages (fallback)
      expect(result.hanjaPageCount).toBe(2);
      expect(result.sampledPageCount).toBe(2);
      expect(mockCallVision).toHaveBeenCalledTimes(2);
      // Should log the fallback warning
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Falling back to all'),
      );
    });

    test('includes all pages when totalPages is 0 (no pages metadata)', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(200), 1),
          createTextItem(generateText(200), 2),
        ],
        { totalPages: 0 },
      );

      mockCallVision
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-1'),
        )
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-2'),
        );

      const result = await sampler.assess(doc);

      expect(result.hanjaPageCount).toBe(2);
      expect(mockCallVision).toHaveBeenCalledTimes(2);
    });

    test('trims correctly for small documents (e.g., 5 pages)', async () => {
      // 5-page doc: frontCutoff=1, backCutoff=4
      // Eligible: pages 2,3,4
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(200), 1),
          createTextItem(generateText(200), 2),
          createTextItem(generateText(200), 3),
          createTextItem(generateText(200), 4),
          createTextItem(generateText(200), 5),
        ],
        { totalPages: 5 },
      );

      const calledPages: number[] = [];
      mockCallVision.mockImplementation(async (args: unknown) => {
        const typedArgs = args as { phase: string };
        calledPages.push(parseInt(typedArgs.phase.replace('page-', '')));
        return createRoleResponse(false, 'none', 'No Hanja', typedArgs.phase);
      });

      const result = await sampler.assess(doc);

      // All 5 pages have text
      expect(result.hanjaPageCount).toBe(5);
      // Only 3 middle pages sampled (2,3,4)
      expect(result.sampledPageCount).toBe(3);
      expect(calledPages).not.toContain(1);
      expect(calledPages).not.toContain(5);
    });
  });

  describe('image-only page exclusion', () => {
    test('does not exclude picture pages with substantial text from sampling', async () => {
      // Page 5 has a picture but 200 chars text (>= IMAGE_PAGE_TEXT_THRESHOLD 50) -> NOT image-only
      // Page 6 has text only
      // Both should be sampled since page 5 is not image-only
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(200), 5),
          createTextItem(generateText(200), 6),
        ],
        {
          totalPages: 20,
          pictures: [createPictureItem(5)],
        },
      );

      mockCallVision
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-5'),
        )
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-6'),
        );

      const result = await sampler.assess(doc);

      expect(result.hanjaPageCount).toBe(2);
      expect(result.sampledPageCount).toBe(2);
      expect(mockCallVision).toHaveBeenCalledTimes(2);
    });

    test('excludes pages with pictures and minimal text from sampling', async () => {
      // Page 5: picture + 30 chars (< 50 IMAGE_PAGE_TEXT_THRESHOLD) -> image-only
      // Page 6: 200 chars, no picture -> normal text page
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(30), 5),
          createTextItem(generateText(200), 6),
        ],
        {
          totalPages: 20,
          pictures: [createPictureItem(5)],
        },
      );

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-6'),
      );

      const result = await sampler.assess(doc);

      // Only page 6 qualifies as a text page (page 5 has only 30 chars < MIN_TEXT_LENGTH)
      expect(result.hanjaPageCount).toBe(1);
      expect(result.sampledPageCount).toBe(1);
    });

    test('includes pages with pictures but substantial text (>= 50 chars)', async () => {
      const doc = createDoclingDoc([createTextItem(generateText(200), 5)], {
        totalPages: 20,
        pictures: [createPictureItem(5)],
      });

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-5'),
      );

      const result = await sampler.assess(doc);

      expect(result.hanjaPageCount).toBe(1);
      expect(result.sampledPageCount).toBe(1);
      expect(mockCallVision).toHaveBeenCalledTimes(1);
    });

    test('handles pages with pictures but no text at all', async () => {
      const doc = createDoclingDoc([createTextItem(generateText(200), 6)], {
        totalPages: 20,
        pictures: [createPictureItem(5)],
      });

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-6'),
      );

      const result = await sampler.assess(doc);

      expect(result.hanjaPageCount).toBe(1);
    });

    test('does not exclude pages without pictures', async () => {
      const doc = createDoclingDoc([createTextItem(generateText(200), 5)], {
        totalPages: 20,
        pictures: [],
      });

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-5'),
      );

      const result = await sampler.assess(doc);

      expect(result.hanjaPageCount).toBe(1);
    });

    test('handles picture items without prov', async () => {
      const pictureWithoutProv = {
        self_ref: '#/pictures/0',
        children: [],
        content_layer: 'body',
        label: 'picture',
        captions: [],
        references: [],
        footnotes: [],
        annotations: [],
      } as unknown as DoclingPictureItem;

      const doc = createDoclingDoc([createTextItem(generateText(200), 5)], {
        totalPages: 20,
        pictures: [pictureWithoutProv],
      });

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-5'),
      );

      const result = await sampler.assess(doc);

      expect(result.hanjaPageCount).toBe(1);
    });

    test('logs the number of excluded image-only pages', async () => {
      const doc = createDoclingDoc([createTextItem(generateText(200), 6)], {
        totalPages: 20,
        pictures: [createPictureItem(5), createPictureItem(7)],
      });

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-6'),
      );

      await sampler.assess(doc);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('image-only pages excluded: 2'),
      );
    });

    test('falls back when all text pages are filtered by edge/image exclusion', async () => {
      // All text pages are in the edge range
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(200), 2),
          createTextItem(generateText(200), 99),
        ],
        {
          totalPages: 100,
        },
      );

      mockCallVision
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-2'),
        )
        .mockResolvedValueOnce(
          createRoleResponse(false, 'none', 'No Hanja', 'page-99'),
        );

      const result = await sampler.assess(doc);

      // Both pages found
      expect(result.hanjaPageCount).toBe(2);
      // Both sampled via fallback
      expect(result.sampledPageCount).toBe(2);
      expect(mockCallVision).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Falling back to all'),
      );
    });
  });

  describe('abstract method implementations', () => {
    test('buildSystemPrompt returns empty string', () => {
      const result = (
        sampler as unknown as { buildSystemPrompt: () => string }
      ).buildSystemPrompt();

      expect(result).toBe('');
    });

    test('buildUserPrompt contains role classification criteria', () => {
      const ocrText = '매우 고운 그으로 류한 test text';
      const result = (
        sampler as unknown as {
          buildUserPrompt: (text: string) => string;
        }
      ).buildUserPrompt(ocrText);

      expect(result).toContain(ocrText);
      expect(result).toContain('Classification');
      expect(result).toContain('Hanja');
      expect(result).toContain('supplementary');
      expect(result).toContain('essential');
    });

    test('buildUserPrompt mentions parenthetical pattern, footnotes, and mixed Korean-Hanja text', () => {
      const result = (
        sampler as unknown as {
          buildUserPrompt: (text: string) => string;
        }
      ).buildUserPrompt('sample text');

      expect(result).toContain('page image');
      expect(result).toContain('Parenthetical annotations');
      expect(result).toContain('Footnotes');
      expect(result).toContain('국한문 혼용체');
    });
  });

  describe('constructor options', () => {
    test('passes maxRetries and fallback model to base class', async () => {
      const fallbackModel = { modelId: 'fallback-model' } as LanguageModel;
      const customSampler = new HanjaQualitySampler(
        mockLogger,
        mockModel,
        '/output/path',
        5,
        fallbackModel,
        mockAggregator as unknown as LLMTokenUsageAggregator,
      );

      const doc = createDoclingDoc([createTextItem(generateText(200), 5)], {
        totalPages: 20,
      });

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-5'),
      );

      await customSampler.assess(doc);

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          maxRetries: 5,
          fallbackModel,
          primaryModel: mockModel,
        }),
      );
    });

    test('passes abort signal to base class', async () => {
      const abortController = new AbortController();
      const customSampler = new HanjaQualitySampler(
        mockLogger,
        mockModel,
        '/output/path',
        undefined,
        undefined,
        mockAggregator as unknown as LLMTokenUsageAggregator,
        abortController.signal,
      );

      const doc = createDoclingDoc([createTextItem(generateText(200), 5)], {
        totalPages: 20,
      });

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-5'),
      );

      await customSampler.assess(doc);

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          abortSignal: abortController.signal,
        }),
      );
    });
  });

  describe('evaluateSinglePage', () => {
    test('sends correct messages to callVisionLLM with image and prompt', async () => {
      const fakeImageBuffer = Buffer.from('test-image-content');
      mockReadFileSync.mockReturnValue(fakeImageBuffer);

      const doc = createDoclingDoc([createTextItem(generateText(200), 5)], {
        totalPages: 20,
      });

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-5'),
      );

      await sampler.assess(doc);

      const expectedBase64 = fakeImageBuffer.toString('base64');
      const callArgs = mockCallVision.mock.calls[0][0] as {
        messages: Array<{
          role: string;
          content: Array<{ type: string; image?: string; text?: string }>;
        }>;
        schema: unknown;
        component: string;
        phase: string;
      };

      expect(callArgs.messages).toHaveLength(1);
      expect(callArgs.messages[0].role).toBe('user');

      const content = callArgs.messages[0].content;
      expect(content[0].type).toBe('image');
      expect(content[0].image).toBe(`data:image/png;base64,${expectedBase64}`);

      expect(content[1].type).toBe('text');
      expect(content[1].text).toContain('OCR Text');
    });

    test('passes correct phase identifier to callVisionLLM', async () => {
      const doc = createDoclingDoc([createTextItem(generateText(200), 7)], {
        totalPages: 20,
      });

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-7'),
      );

      await sampler.assess(doc);

      expect(mockCallVision).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'page-7',
          component: 'HanjaQualitySampler',
        }),
      );
    });

    test('joins multiple texts from the same page with newline for OCR text', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(`First text ${generateText(60)}`, 5),
          createTextItem(`Second text ${generateText(60)}`, 5),
        ],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-5'),
      );

      await sampler.assess(doc);

      const callArgs = mockCallVision.mock.calls[0][0] as {
        messages: Array<{
          role: string;
          content: Array<{ type: string; text?: string }>;
        }>;
      };
      const textContent = callArgs.messages[0].content[1];
      expect(textContent.text).toContain('First text');
      expect(textContent.text).toContain('Second text');
    });

    test('logs per-page evaluation results', async () => {
      const doc = createDoclingDoc([createTextItem(generateText(200), 5)], {
        totalPages: 20,
      });

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(
          true,
          'supplementary',
          'Parenthetical annotations',
          'page-5',
        ),
      );

      await sampler.assess(doc);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Page 5: hasHanja=true, role=supplementary'),
      );
    });
  });

  describe('getTextPages', () => {
    test('includes pages with text length >= 100', async () => {
      const doc = createDoclingDoc([createTextItem(generateText(100), 5)], {
        totalPages: 20,
      });

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-5'),
      );

      const result = await sampler.assess(doc);

      expect(result.hanjaPageCount).toBe(1);
    });

    test('excludes pages with text length < 100', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(99), 5),
          createTextItem(generateText(200), 6),
        ],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-6'),
      );

      const result = await sampler.assess(doc);

      expect(result.hanjaPageCount).toBe(1);
    });

    test('finds text pages regardless of edge position (discovery is unfiltered)', async () => {
      // Pages in edge range still get discovered
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(200), 1),
          createTextItem(generateText(200), 100),
          createTextItem(generateText(200), 50),
        ],
        { totalPages: 100 },
      );

      mockCallVision.mockImplementation(async (args: unknown) => {
        const typedArgs = args as { phase: string };
        return createRoleResponse(false, 'none', 'No Hanja', typedArgs.phase);
      });

      const result = await sampler.assess(doc);

      // All 3 pages should be found as text pages
      expect(result.hanjaPageCount).toBe(3);
    });

    test('aggregates text from multiple items on the same page', async () => {
      // Each item has 60 chars, but same page -> 120 total >= 100
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(60), 5),
          createTextItem(generateText(60), 5),
        ],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-5'),
      );

      const result = await sampler.assess(doc);

      expect(result.hanjaPageCount).toBe(1);
      expect(mockCallVision).toHaveBeenCalledTimes(1);
    });
  });

  describe('aggregateResults edge cases', () => {
    test('essential assessment includes correct reason string', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(generateText(300), 5),
          createTextItem(generateText(200), 6),
        ],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(
          true,
          'essential',
          'Mixed Korean-Hanja text',
          'page-5',
        ),
      );

      const result = await sampler.assess(doc);

      expect(result.reason).toContain('1/1');
      expect(result.reason).toContain('essential Hanja');
    });

    test('none assessment uses correct reason string', async () => {
      const doc = createDoclingDoc([createTextItem(generateText(200), 5)], {
        totalPages: 20,
      });

      mockCallVision.mockResolvedValueOnce(
        createRoleResponse(false, 'none', 'No Hanja', 'page-5'),
      );

      const result = await sampler.assess(doc);

      expect(result.reason).toBe('No Hanja characters found in sampled pages');
    });
  });

  describe('LLM error handling', () => {
    test('propagates LLM API errors', async () => {
      const doc = createDoclingDoc([createTextItem(generateText(200), 5)], {
        totalPages: 20,
      });

      mockCallVision.mockRejectedValueOnce(new Error('API rate limit'));

      await expect(sampler.assess(doc)).rejects.toThrow('API rate limit');
    });
  });

  describe('aggregateResults with zero sampled pages', () => {
    test('returns hanjaRole none when sampledCount is 0', () => {
      const result = (sampler as any).aggregateResults(0, 0, []);

      expect(result.hanjaRole).toBe('none');
      expect(result.needsVlmReparse).toBe(false);
      expect(result.reason).toBe('No Hanja characters found in sampled pages');
    });
  });
});
