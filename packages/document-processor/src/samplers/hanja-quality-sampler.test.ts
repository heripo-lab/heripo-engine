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
 * Helper to create a DoclingTextItem with KCJ characters
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
 * Helper to create a mock callVision response
 */
function createVisionResponse(
  isCorrupted: boolean,
  corruptedCharCount: number,
  totalKcjCharCount: number,
  explanation: string,
  phase: string,
) {
  return {
    output: {
      isCorrupted,
      corruptedCharCount,
      totalKcjCharCount,
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
 * Generate a string containing the specified number of KCJ characters
 */
function generateKcjText(count: number): string {
  // Use a variety of KCJ characters from the Unified Ideographs range
  const chars = '漢字測試品質評估報告';
  let result = '';
  for (let i = 0; i < count; i++) {
    result += chars[i % chars.length];
  }
  return result;
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
    test('returns severity=none when no KCJ characters are found', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(
            'This is plain English text without any KCJ chars.',
            5,
          ),
          createTextItem('한글만 있는 텍스트입니다.', 6),
        ],
        { totalPages: 20 },
      );

      const result = await sampler.assess(doc);

      expect(result).toEqual({
        needsVlmReparse: false,
        severity: 'none',
        kcjPageCount: 0,
        sampledPageCount: 0,
        corruptedRatio: 0,
        reason: 'No KCJ characters found in document',
      });
      expect(mockCallVision).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[HanjaQualitySampler] No KCJ characters found in document',
      );
    });

    test('returns severity=none when KCJ characters are below threshold per page', async () => {
      // Each page has fewer than 5 KCJ characters, so no pages qualify
      const doc = createDoclingDoc(
        [
          createTextItem('Some text with 漢字品質 only 4 chars', 5),
          createTextItem('Another text with 報告測 only 3 chars', 6),
        ],
        { totalPages: 20 },
      );

      const result = await sampler.assess(doc);

      expect(result).toEqual({
        needsVlmReparse: false,
        severity: 'none',
        kcjPageCount: 0,
        sampledPageCount: 0,
        corruptedRatio: 0,
        reason: 'No KCJ characters found in document',
      });
      expect(mockCallVision).not.toHaveBeenCalled();
    });

    test('returns severity=severe when majority of sampled pages are corrupted', async () => {
      // Create 3 pages with enough KCJ characters (>= 5 each), in middle range
      const doc = createDoclingDoc(
        [
          createTextItem(`Text with KCJ: ${generateKcjText(10)}`, 5),
          createTextItem(`More KCJ: ${generateKcjText(8)}`, 6),
          createTextItem(`Even more: ${generateKcjText(6)}`, 7),
        ],
        { totalPages: 20 },
      );

      // All 3 pages corrupted -> ratio = 3/3 = 1.0 >= 0.5 -> severe
      mockCallVision
        .mockResolvedValueOnce(
          createVisionResponse(
            true,
            8,
            10,
            'Severe corruption on page 5',
            'page-5',
          ),
        )
        .mockResolvedValueOnce(
          createVisionResponse(
            true,
            6,
            8,
            'Severe corruption on page 6',
            'page-6',
          ),
        )
        .mockResolvedValueOnce(
          createVisionResponse(true, 4, 6, 'Corruption on page 7', 'page-7'),
        );

      const result = await sampler.assess(doc);

      expect(result.needsVlmReparse).toBe(true);
      expect(result.severity).toBe('severe');
      expect(result.kcjPageCount).toBe(3);
      expect(result.sampledPageCount).toBe(3);
      expect(result.corruptedRatio).toBe(1);
      expect(result.reason).toContain('3/3');
      expect(mockCallVision).toHaveBeenCalledTimes(3);
    });

    test('returns severity=minor when some pages corrupted but below 50% threshold', async () => {
      // Create 4 pages with KCJ in middle range -> sample min(10, 4) = 4
      const doc = createDoclingDoc(
        [
          createTextItem(`KCJ text: ${generateKcjText(20)}`, 5),
          createTextItem(`KCJ text: ${generateKcjText(15)}`, 6),
          createTextItem(`KCJ text: ${generateKcjText(10)}`, 7),
          createTextItem(`KCJ text: ${generateKcjText(6)}`, 8),
        ],
        { totalPages: 20 },
      );

      // 1 out of 4 sampled corrupted -> ratio = 1/4 = 0.25 < 0.5 -> minor
      mockCallVision
        .mockResolvedValueOnce(
          createVisionResponse(true, 5, 20, 'Some corruption', 'page-5'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 15, 'Clean page', 'page-6'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 10, 'Clean page', 'page-7'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 6, 'Clean page', 'page-8'),
        );

      const result = await sampler.assess(doc);

      expect(result.needsVlmReparse).toBe(false);
      expect(result.severity).toBe('minor');
      expect(result.kcjPageCount).toBe(4);
      expect(result.sampledPageCount).toBe(4);
      expect(result.corruptedRatio).toBe(0.25);
      expect(result.reason).toContain('1/4');
    });

    test('returns severity=none when KCJ characters present but no corruption detected', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(`Clean KCJ text: ${generateKcjText(10)}`, 5),
          createTextItem(`More clean KCJ: ${generateKcjText(8)}`, 6),
          createTextItem(`Also clean: ${generateKcjText(6)}`, 7),
        ],
        { totalPages: 20 },
      );

      // All pages clean -> corruptedCount = 0 -> severity=none
      mockCallVision
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 10, 'All clean', 'page-5'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 8, 'All clean', 'page-6'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 6, 'All clean', 'page-7'),
        );

      const result = await sampler.assess(doc);

      expect(result.needsVlmReparse).toBe(false);
      expect(result.severity).toBe('none');
      expect(result.kcjPageCount).toBe(3);
      expect(result.sampledPageCount).toBe(3);
      expect(result.corruptedRatio).toBe(0);
      expect(result.reason).toBe('No KCJ character corruption detected');
    });

    test('handles image load failure by marking page as not corrupted', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(`KCJ: ${generateKcjText(10)}`, 5),
          createTextItem(`KCJ: ${generateKcjText(8)}`, 6),
          createTextItem(`KCJ: ${generateKcjText(6)}`, 7),
        ],
        { totalPages: 20 },
      );

      // Make image loading fail for first page (page 5 -> page_4.png)
      mockReadFileSync.mockImplementation((filePath: unknown) => {
        if (typeof filePath === 'string' && filePath.includes('page_4')) {
          throw new Error('File not found: page_4.png');
        }
        return Buffer.from('fake-image-data');
      });

      // Only 2 callVision calls should happen (pages 6 and 7)
      mockCallVision
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 8, 'Clean page', 'page-6'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 6, 'Clean page', 'page-7'),
        );

      const result = await sampler.assess(doc);

      expect(result.severity).toBe('none');
      expect(result.needsVlmReparse).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load page image for page'),
      );
      // callVision should NOT be called for the failed page
      expect(mockCallVision).toHaveBeenCalledTimes(2);
    });

    test('uses correct 0-based page image path (page N -> page_{N-1}.png)', async () => {
      const doc = createDoclingDoc(
        [createTextItem(`KCJ chars: ${generateKcjText(10)}`, 5)],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-5'),
      );

      await sampler.assess(doc);

      // Page 5 should load page_4.png (0-based index)
      expect(mockPathResolve).toHaveBeenCalledWith(
        '/output/path',
        'pages/page_4.png',
      );
    });

    test('defaults to page 1 when prov is missing', async () => {
      // Create text items without prov — will default to page 1
      // With no pages object, page 1 is within eligible range for 0-page doc
      const textWithoutProv = {
        text: generateKcjText(10),
        label: 'text',
        orig: generateKcjText(10),
      } as unknown as DoclingTextItem;

      // Use 0 totalPages (empty pages object) so no edge trimming applies
      const doc = createDoclingDoc([textWithoutProv], { totalPages: 0 });

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-1'),
      );

      await sampler.assess(doc);

      // Should default to page 1, so image path should be page_0.png
      expect(mockPathResolve).toHaveBeenCalledWith(
        '/output/path',
        'pages/page_0.png',
      );
    });

    test('defaults to page 1 when prov is an empty array', async () => {
      const textWithEmptyProv = {
        text: generateKcjText(10),
        prov: [],
        label: 'text',
        orig: generateKcjText(10),
      } as unknown as DoclingTextItem;

      const doc = createDoclingDoc([textWithEmptyProv], { totalPages: 0 });

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-1'),
      );

      await sampler.assess(doc);

      // prov[0] is undefined -> page_no is undefined -> defaults to 1 -> page_0.png
      expect(mockPathResolve).toHaveBeenCalledWith(
        '/output/path',
        'pages/page_0.png',
      );
    });

    test('tracks token usage for each evaluated page', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(`KCJ: ${generateKcjText(10)}`, 5),
          createTextItem(`KCJ: ${generateKcjText(8)}`, 6),
          createTextItem(`KCJ: ${generateKcjText(6)}`, 7),
        ],
        { totalPages: 20 },
      );

      mockCallVision
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 10, 'Clean', 'page-5'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 8, 'Clean', 'page-6'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 6, 'Clean', 'page-7'),
        );

      await sampler.assess(doc);

      // Each callVisionLLM call tracks usage
      expect(mockAggregator.track).toHaveBeenCalledTimes(3);
    });

    test('logs assessment start, trimming info, and completion', async () => {
      const doc = createDoclingDoc(
        [createTextItem(`KCJ: ${generateKcjText(10)}`, 5)],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-5'),
      );

      await sampler.assess(doc);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[HanjaQualitySampler] Starting KCJ quality assessment...',
      );
      // Should log trimming info: frontCutoff=2, backCutoff=18 for 20 pages
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Total pages: 20, eligible range: (2, 18]'),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Assessment complete'),
      );
    });

    test('handles exact corruption threshold boundary (corruptedRatio = 0.5 -> severe)', async () => {
      // Create 4 pages in middle range, corrupt exactly 2 -> ratio 2/4 = 0.5
      const texts: DoclingTextItem[] = [];
      for (let i = 5; i <= 8; i++) {
        texts.push(createTextItem(`KCJ: ${generateKcjText(5 + i)}`, i));
      }
      const doc = createDoclingDoc(texts, { totalPages: 20 });

      // 4 sampled pages: 2 corrupted, 2 clean -> ratio = 2/4 = 0.5 exactly
      mockCallVision
        .mockResolvedValueOnce(
          createVisionResponse(true, 5, 13, 'Corrupted', 'page-8'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(true, 4, 12, 'Corrupted', 'page-7'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 11, 'Clean', 'page-6'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 10, 'Clean', 'page-5'),
        );

      const result = await sampler.assess(doc);

      // 0.5 >= 0.5 -> severe
      expect(result.severity).toBe('severe');
      expect(result.needsVlmReparse).toBe(true);
      expect(result.corruptedRatio).toBe(0.5);
    });

    test('handles empty document with no texts', async () => {
      const doc = createDoclingDoc([], { totalPages: 0 });

      const result = await sampler.assess(doc);

      expect(result.severity).toBe('none');
      expect(result.needsVlmReparse).toBe(false);
      expect(result.kcjPageCount).toBe(0);
    });

    test('aggregates KCJ characters from multiple texts on the same page', async () => {
      // 3 KCJ chars per text item, 2 items on page 5 = 6 total -> qualifies (>= 5)
      const doc = createDoclingDoc(
        [
          createTextItem('Text with 漢字品', 5),
          createTextItem('More text 質評估', 5),
        ],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 6, 'Clean', 'page-5'),
      );

      const result = await sampler.assess(doc);

      expect(result.kcjPageCount).toBe(1);
      expect(result.sampledPageCount).toBe(1);
      expect(mockCallVision).toHaveBeenCalledTimes(1);
    });
  });

  describe('selectSamplePages', () => {
    test('selects max 10 pages when there are many KCJ pages', async () => {
      // 15 pages in the middle range of a 100-page doc
      // frontCutoff = ceil(100*0.1) = 10, backCutoff = 100 - 10 = 90
      const texts: DoclingTextItem[] = [];
      for (let i = 11; i <= 25; i++) {
        texts.push(createTextItem(`KCJ: ${generateKcjText(5 + i)}`, i));
      }
      const doc = createDoclingDoc(texts, { totalPages: 100 });

      // Should sample exactly 10 pages (the ones with highest KCJ density)
      for (let i = 0; i < 10; i++) {
        mockCallVision.mockResolvedValueOnce(
          createVisionResponse(false, 0, 20, 'Clean', `page-${25 - i}`),
        );
      }

      const result = await sampler.assess(doc);

      expect(result.sampledPageCount).toBe(10);
      expect(mockCallVision).toHaveBeenCalledTimes(10);
    });

    test('selects all pages when fewer than MAX_SAMPLE_PAGES qualify', async () => {
      // Only 2 pages with enough KCJ -> min(10, 2) = 2
      const doc = createDoclingDoc(
        [
          createTextItem(`KCJ: ${generateKcjText(10)}`, 5),
          createTextItem(`KCJ: ${generateKcjText(8)}`, 6),
        ],
        { totalPages: 20 },
      );

      mockCallVision
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 10, 'Clean', 'page-5'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 8, 'Clean', 'page-6'),
        );

      const result = await sampler.assess(doc);

      expect(result.sampledPageCount).toBe(2);
      expect(mockCallVision).toHaveBeenCalledTimes(2);
    });

    test('selects single page when only 1 page qualifies', async () => {
      const doc = createDoclingDoc(
        [createTextItem(`KCJ: ${generateKcjText(10)}`, 5)],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-5'),
      );

      const result = await sampler.assess(doc);

      expect(result.sampledPageCount).toBe(1);
      expect(mockCallVision).toHaveBeenCalledTimes(1);
    });

    test('sorts pages by KCJ density (highest first)', async () => {
      // Create pages with different KCJ densities in middle range
      const doc = createDoclingDoc(
        [
          createTextItem(`Low KCJ: ${generateKcjText(6)}`, 5),
          createTextItem(`High KCJ: ${generateKcjText(50)}`, 6),
          createTextItem(`Medium KCJ: ${generateKcjText(20)}`, 7),
        ],
        { totalPages: 20 },
      );

      const callOrder: string[] = [];
      mockCallVision.mockImplementation(async (args: unknown) => {
        const typedArgs = args as { phase: string };
        callOrder.push(typedArgs.phase);
        return createVisionResponse(false, 0, 10, 'Clean', typedArgs.phase);
      });

      await sampler.assess(doc);

      // Pages should be evaluated in order of KCJ density (highest first)
      // Page 6 (50 chars) -> Page 7 (20 chars) -> Page 5 (6 chars)
      expect(callOrder).toEqual(['page-6', 'page-7', 'page-5']);
    });

    test('uses all pages when fewer than 10 qualify (exhaustive check)', async () => {
      // 7 pages in eligible range -> min(10, 7) = 7
      const texts: DoclingTextItem[] = [];
      for (let i = 5; i <= 11; i++) {
        texts.push(createTextItem(`KCJ: ${generateKcjText(5 + i)}`, i));
      }
      const doc = createDoclingDoc(texts, { totalPages: 20 });

      for (let i = 0; i < 7; i++) {
        mockCallVision.mockResolvedValueOnce(
          createVisionResponse(false, 0, 10, 'Clean', `page-${11 - i}`),
        );
      }

      const result = await sampler.assess(doc);

      expect(result.sampledPageCount).toBe(7);
      expect(mockCallVision).toHaveBeenCalledTimes(7);
    });
  });

  describe('edge trimming', () => {
    test('excludes pages in the front 10% of the document', async () => {
      // 100-page doc: frontCutoff = ceil(100*0.1) = 10
      // Page 10 should be excluded (pageNo <= frontCutoff), page 11 should be included
      const doc = createDoclingDoc(
        [
          createTextItem(`KCJ front: ${generateKcjText(10)}`, 10),
          createTextItem(`KCJ eligible: ${generateKcjText(10)}`, 11),
        ],
        { totalPages: 100 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-11'),
      );

      const result = await sampler.assess(doc);

      // Only page 11 should qualify (page 10 is trimmed)
      expect(result.kcjPageCount).toBe(1);
      expect(mockCallVision).toHaveBeenCalledTimes(1);
    });

    test('excludes pages in the back 10% of the document', async () => {
      // 100-page doc: backCutoff = 100 - ceil(100*0.1) = 90
      // Page 91 should be excluded (pageNo > backCutoff), page 90 should be included
      const doc = createDoclingDoc(
        [
          createTextItem(`KCJ eligible: ${generateKcjText(10)}`, 90),
          createTextItem(`KCJ back: ${generateKcjText(10)}`, 91),
        ],
        { totalPages: 100 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-90'),
      );

      const result = await sampler.assess(doc);

      // Only page 90 should qualify (page 91 is trimmed)
      expect(result.kcjPageCount).toBe(1);
      expect(mockCallVision).toHaveBeenCalledTimes(1);
    });

    test('trims correctly for small documents (e.g., 5 pages)', async () => {
      // 5-page doc: frontCutoff = ceil(5*0.1) = 1, backCutoff = 5 - 1 = 4
      // Eligible pages: 2, 3, 4
      const doc = createDoclingDoc(
        [
          createTextItem(`KCJ p1: ${generateKcjText(10)}`, 1),
          createTextItem(`KCJ p2: ${generateKcjText(10)}`, 2),
          createTextItem(`KCJ p3: ${generateKcjText(10)}`, 3),
          createTextItem(`KCJ p4: ${generateKcjText(10)}`, 4),
          createTextItem(`KCJ p5: ${generateKcjText(10)}`, 5),
        ],
        { totalPages: 5 },
      );

      for (let i = 0; i < 3; i++) {
        mockCallVision.mockResolvedValueOnce(
          createVisionResponse(false, 0, 10, 'Clean', `page-${2 + i}`),
        );
      }

      const result = await sampler.assess(doc);

      // Pages 1 and 5 should be trimmed -> 3 eligible pages
      expect(result.kcjPageCount).toBe(3);
      expect(mockCallVision).toHaveBeenCalledTimes(3);
    });

    test('includes all pages when totalPages is 0 (no pages metadata)', async () => {
      // When totalPages is 0, edge trimming is skipped
      const doc = createDoclingDoc(
        [
          createTextItem(`KCJ: ${generateKcjText(10)}`, 1),
          createTextItem(`KCJ: ${generateKcjText(10)}`, 2),
        ],
        { totalPages: 0 },
      );

      mockCallVision
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 10, 'Clean', 'page-1'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 10, 'Clean', 'page-2'),
        );

      const result = await sampler.assess(doc);

      expect(result.kcjPageCount).toBe(2);
      expect(mockCallVision).toHaveBeenCalledTimes(2);
    });

    test('boundary: page exactly at frontCutoff is excluded', async () => {
      // 20-page doc: frontCutoff = ceil(20*0.1) = 2
      // Page 2 -> pageNo <= frontCutoff -> excluded
      // Page 3 -> pageNo > frontCutoff -> included
      const doc = createDoclingDoc(
        [
          createTextItem(`KCJ: ${generateKcjText(10)}`, 2),
          createTextItem(`KCJ: ${generateKcjText(10)}`, 3),
        ],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-3'),
      );

      const result = await sampler.assess(doc);

      expect(result.kcjPageCount).toBe(1);
    });

    test('boundary: page exactly at backCutoff is included', async () => {
      // 20-page doc: backCutoff = 20 - ceil(20*0.1) = 18
      // Page 18 -> pageNo <= backCutoff -> included
      // Page 19 -> pageNo > backCutoff -> excluded
      const doc = createDoclingDoc(
        [
          createTextItem(`KCJ: ${generateKcjText(10)}`, 18),
          createTextItem(`KCJ: ${generateKcjText(10)}`, 19),
        ],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-18'),
      );

      const result = await sampler.assess(doc);

      expect(result.kcjPageCount).toBe(1);
    });
  });

  describe('image-only page exclusion', () => {
    test('excludes pages with pictures and minimal text', async () => {
      // Page 5 has a picture and short text (< 50 chars) -> image-only -> excluded
      // Page 6 has KCJ text only -> included
      const doc = createDoclingDoc(
        [
          createTextItem(`${generateKcjText(10)}`, 5),
          createTextItem(`KCJ text: ${generateKcjText(10)}`, 6),
        ],
        {
          totalPages: 20,
          pictures: [createPictureItem(5)],
        },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-6'),
      );

      const result = await sampler.assess(doc);

      // Only page 6 should qualify (page 5 is image-only)
      expect(result.kcjPageCount).toBe(1);
      expect(mockCallVision).toHaveBeenCalledTimes(1);
    });

    test('includes pages with pictures but substantial text (>= 50 chars)', async () => {
      // Page 5 has a picture but also long text (>= 50 chars) -> NOT image-only -> included
      const longText = 'A'.repeat(40) + generateKcjText(10);
      const doc = createDoclingDoc([createTextItem(longText, 5)], {
        totalPages: 20,
        pictures: [createPictureItem(5)],
      });

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-5'),
      );

      const result = await sampler.assess(doc);

      expect(result.kcjPageCount).toBe(1);
      expect(mockCallVision).toHaveBeenCalledTimes(1);
    });

    test('handles pages with pictures but no text at all', async () => {
      // Page 5 has only a picture, no text items -> text length = 0 < 50 -> image-only
      // Page 6 has KCJ text
      const doc = createDoclingDoc(
        [createTextItem(`KCJ: ${generateKcjText(10)}`, 6)],
        {
          totalPages: 20,
          pictures: [createPictureItem(5)],
        },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-6'),
      );

      const result = await sampler.assess(doc);

      expect(result.kcjPageCount).toBe(1);
    });

    test('does not exclude pages without pictures', async () => {
      // No pictures at all -> imageOnlyPages should be empty
      const doc = createDoclingDoc(
        [createTextItem(`KCJ: ${generateKcjText(10)}`, 5)],
        { totalPages: 20, pictures: [] },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-5'),
      );

      const result = await sampler.assess(doc);

      expect(result.kcjPageCount).toBe(1);
    });

    test('handles picture items without prov', async () => {
      // Picture without prov should be ignored
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

      const doc = createDoclingDoc(
        [createTextItem(`KCJ: ${generateKcjText(10)}`, 5)],
        { totalPages: 20, pictures: [pictureWithoutProv] },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-5'),
      );

      const result = await sampler.assess(doc);

      expect(result.kcjPageCount).toBe(1);
    });

    test('logs the number of excluded image-only pages', async () => {
      const doc = createDoclingDoc(
        [createTextItem(`KCJ: ${generateKcjText(10)}`, 6)],
        {
          totalPages: 20,
          pictures: [createPictureItem(5), createPictureItem(7)],
        },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-6'),
      );

      await sampler.assess(doc);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('image-only pages excluded: 2'),
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

    test('buildUserPrompt returns evaluation prompt containing OCR text and criteria', () => {
      const ocrText = '漢字品質評估 test text';
      const result = (
        sampler as unknown as {
          buildUserPrompt: (text: string) => string;
        }
      ).buildUserPrompt(ocrText);

      expect(result).toContain(ocrText);
      expect(result).toContain('Evaluation Criteria');
      expect(result).toContain('KCJ');
      expect(result).toContain('corrupted');
      expect(result).toContain('OCR Text to Evaluate');
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

      const doc = createDoclingDoc(
        [createTextItem(`KCJ: ${generateKcjText(10)}`, 5)],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-5'),
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

      const doc = createDoclingDoc(
        [createTextItem(`KCJ: ${generateKcjText(10)}`, 5)],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-5'),
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

      const doc = createDoclingDoc(
        [createTextItem(`KCJ text: ${generateKcjText(10)}`, 5)],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-5'),
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

      // Verify message structure
      expect(callArgs.messages).toHaveLength(1);
      expect(callArgs.messages[0].role).toBe('user');

      const content = callArgs.messages[0].content;
      // First content should be the image
      expect(content[0].type).toBe('image');
      expect(content[0].image).toBe(`data:image/png;base64,${expectedBase64}`);

      // Second content should be the text prompt
      expect(content[1].type).toBe('text');
      expect(content[1].text).toContain('OCR Text to Evaluate');
    });

    test('passes correct phase identifier to callVisionLLM', async () => {
      const doc = createDoclingDoc(
        [createTextItem(`KCJ: ${generateKcjText(10)}`, 7)],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-7'),
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
          createTextItem(`First text ${generateKcjText(3)}`, 5),
          createTextItem(`Second text ${generateKcjText(3)}`, 5),
        ],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 6, 'Clean', 'page-5'),
      );

      await sampler.assess(doc);

      const callArgs = mockCallVision.mock.calls[0][0] as {
        messages: Array<{
          role: string;
          content: Array<{ type: string; text?: string }>;
        }>;
      };
      const textContent = callArgs.messages[0].content[1];
      // The OCR text should contain both texts joined with newline
      expect(textContent.text).toContain('First text');
      expect(textContent.text).toContain('Second text');
    });

    test('logs per-page evaluation results', async () => {
      const doc = createDoclingDoc(
        [createTextItem(`KCJ: ${generateKcjText(10)}`, 5)],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(true, 3, 10, 'Some corruption', 'page-5'),
      );

      await sampler.assess(doc);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Page 5: corrupted=true'),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('3/10 KCJ chars corrupted'),
      );
    });
  });

  describe('findKcjPages', () => {
    test('detects KCJ Unified Ideographs (U+4E00-U+9FFF)', async () => {
      const doc = createDoclingDoc(
        [createTextItem('Text with 漢字品質評 (5 unified ideographs)', 5)],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 5, 'Clean', 'page-5'),
      );

      const result = await sampler.assess(doc);

      expect(result.kcjPageCount).toBe(1);
    });

    test('detects KCJ Extension A characters (U+3400-U+4DBF)', async () => {
      // Characters from KCJ Extension A range
      const extAChars = '\u3400\u3401\u3402\u3403\u3404';
      const doc = createDoclingDoc(
        [createTextItem(`Extension A: ${extAChars}`, 5)],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 5, 'Clean', 'page-5'),
      );

      const result = await sampler.assess(doc);

      expect(result.kcjPageCount).toBe(1);
    });

    test('detects KCJ Compatibility Ideographs (U+F900-U+FAFF)', async () => {
      // Characters from KCJ Compatibility Ideographs range
      const compatChars = '\uF900\uF901\uF902\uF903\uF904';
      const doc = createDoclingDoc(
        [createTextItem(`Compatibility: ${compatChars}`, 5)],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 5, 'Clean', 'page-5'),
      );

      const result = await sampler.assess(doc);

      expect(result.kcjPageCount).toBe(1);
    });

    test('ignores text items with no KCJ characters', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem('Pure English text without any KCJ', 5),
          createTextItem(`KCJ page: ${generateKcjText(10)}`, 6),
        ],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-6'),
      );

      const result = await sampler.assess(doc);

      // Only page 6 should qualify
      expect(result.kcjPageCount).toBe(1);
    });
  });

  describe('aggregateResults edge cases', () => {
    test('severe assessment includes correct reason string', async () => {
      const doc = createDoclingDoc(
        [
          createTextItem(`KCJ: ${generateKcjText(10)}`, 5),
          createTextItem(`KCJ: ${generateKcjText(8)}`, 6),
        ],
        { totalPages: 20 },
      );

      mockCallVision
        .mockResolvedValueOnce(
          createVisionResponse(true, 8, 10, 'Corrupted', 'page-5'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(true, 6, 8, 'Corrupted', 'page-6'),
        );

      const result = await sampler.assess(doc);

      expect(result.reason).toContain('2/2');
      expect(result.reason).toContain('corrupted KCJ characters');
      expect(result.reason).toContain('ratio: 1.00');
    });

    test('clean assessment uses correct reason string', async () => {
      const doc = createDoclingDoc(
        [createTextItem(`KCJ: ${generateKcjText(10)}`, 5)],
        { totalPages: 20 },
      );

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-5'),
      );

      const result = await sampler.assess(doc);

      expect(result.reason).toBe('No KCJ character corruption detected');
    });
  });

  describe('LLM error handling', () => {
    test('propagates LLM API errors', async () => {
      const doc = createDoclingDoc(
        [createTextItem(`KCJ: ${generateKcjText(10)}`, 5)],
        { totalPages: 20 },
      );

      mockCallVision.mockRejectedValueOnce(new Error('API rate limit'));

      await expect(sampler.assess(doc)).rejects.toThrow('API rate limit');
    });
  });

  describe('aggregateResults with zero sampled pages', () => {
    test('returns corruptedRatio 0 when sampledCount is 0', () => {
      // Access the private method directly to test the sampledCount === 0 branch
      const result = (sampler as any).aggregateResults(0, 0, []);

      expect(result.corruptedRatio).toBe(0);
      expect(result.severity).toBe('none');
      expect(result.needsVlmReparse).toBe(false);
      expect(result.reason).toBe('No KCJ character corruption detected');
    });
  });
});
