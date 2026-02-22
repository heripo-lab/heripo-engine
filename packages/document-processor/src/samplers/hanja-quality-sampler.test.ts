import type { LoggerMethods } from '@heripo/logger';
import type { DoclingDocument, DoclingTextItem } from '@heripo/model';
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
 * Helper to create a DoclingDocument from text items
 */
function createDoclingDoc(texts: DoclingTextItem[]): DoclingDocument {
  return {
    texts,
    pages: {},
    pictures: [],
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
      const doc = createDoclingDoc([
        createTextItem('This is plain English text without any KCJ chars.', 1),
        createTextItem('한글만 있는 텍스트입니다.', 2),
      ]);

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
      const doc = createDoclingDoc([
        createTextItem('Some text with 漢字品質 only 4 chars', 1),
        createTextItem('Another text with 報告測 only 3 chars', 2),
      ]);

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
      // Create 3 pages with enough KCJ characters (>= 5 each)
      const doc = createDoclingDoc([
        createTextItem(`Text with KCJ: ${generateKcjText(10)}`, 1),
        createTextItem(`More KCJ: ${generateKcjText(8)}`, 2),
        createTextItem(`Even more: ${generateKcjText(6)}`, 3),
      ]);

      // All 3 pages corrupted -> ratio = 3/3 = 1.0 >= 0.5 -> severe
      mockCallVision
        .mockResolvedValueOnce(
          createVisionResponse(
            true,
            8,
            10,
            'Severe corruption on page 1',
            'page-1',
          ),
        )
        .mockResolvedValueOnce(
          createVisionResponse(
            true,
            6,
            8,
            'Severe corruption on page 2',
            'page-2',
          ),
        )
        .mockResolvedValueOnce(
          createVisionResponse(true, 4, 6, 'Corruption on page 3', 'page-3'),
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
      // Create 4 pages with KCJ -> sample 3 (ceil(4*0.3)=2, max(3,2)=3, min(3,5,4)=3)
      const doc = createDoclingDoc([
        createTextItem(`KCJ text: ${generateKcjText(20)}`, 1),
        createTextItem(`KCJ text: ${generateKcjText(15)}`, 2),
        createTextItem(`KCJ text: ${generateKcjText(10)}`, 3),
        createTextItem(`KCJ text: ${generateKcjText(6)}`, 4),
      ]);

      // 1 out of 3 sampled corrupted -> ratio = 1/3 ≈ 0.33 < 0.5 -> minor
      mockCallVision
        .mockResolvedValueOnce(
          createVisionResponse(true, 5, 20, 'Some corruption', 'page-1'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 15, 'Clean page', 'page-2'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 10, 'Clean page', 'page-3'),
        );

      const result = await sampler.assess(doc);

      expect(result.needsVlmReparse).toBe(false);
      expect(result.severity).toBe('minor');
      expect(result.kcjPageCount).toBe(4);
      expect(result.sampledPageCount).toBe(3);
      expect(result.corruptedRatio).toBeCloseTo(1 / 3);
      expect(result.reason).toContain('1/3');
    });

    test('returns severity=none when KCJ characters present but no corruption detected', async () => {
      const doc = createDoclingDoc([
        createTextItem(`Clean KCJ text: ${generateKcjText(10)}`, 1),
        createTextItem(`More clean KCJ: ${generateKcjText(8)}`, 2),
        createTextItem(`Also clean: ${generateKcjText(6)}`, 3),
      ]);

      // All pages clean -> corruptedCount = 0 -> severity=none
      mockCallVision
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 10, 'All clean', 'page-1'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 8, 'All clean', 'page-2'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 6, 'All clean', 'page-3'),
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
      const doc = createDoclingDoc([
        createTextItem(`KCJ: ${generateKcjText(10)}`, 1),
        createTextItem(`KCJ: ${generateKcjText(8)}`, 2),
        createTextItem(`KCJ: ${generateKcjText(6)}`, 3),
      ]);

      // Make image loading fail for first page
      mockReadFileSync.mockImplementation((filePath: unknown) => {
        if (typeof filePath === 'string' && filePath.includes('page_0')) {
          throw new Error('File not found: page_0.png');
        }
        return Buffer.from('fake-image-data');
      });

      // Only 2 callVision calls should happen (pages 2 and 3)
      mockCallVision
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 8, 'Clean page', 'page-2'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 6, 'Clean page', 'page-3'),
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
      const doc = createDoclingDoc([
        createTextItem(`KCJ chars: ${generateKcjText(10)}`, 5),
      ]);

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
      // Create text items without prov
      const textWithoutProv = {
        text: generateKcjText(10),
        label: 'text',
        orig: generateKcjText(10),
      } as unknown as DoclingTextItem;

      const doc = createDoclingDoc([textWithoutProv]);

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

      const doc = createDoclingDoc([textWithEmptyProv]);

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
      const doc = createDoclingDoc([
        createTextItem(`KCJ: ${generateKcjText(10)}`, 1),
        createTextItem(`KCJ: ${generateKcjText(8)}`, 2),
        createTextItem(`KCJ: ${generateKcjText(6)}`, 3),
      ]);

      mockCallVision
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 10, 'Clean', 'page-1'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 8, 'Clean', 'page-2'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 6, 'Clean', 'page-3'),
        );

      await sampler.assess(doc);

      // Each callVisionLLM call tracks usage
      expect(mockAggregator.track).toHaveBeenCalledTimes(3);
    });

    test('logs assessment start and completion', async () => {
      const doc = createDoclingDoc([
        createTextItem(`KCJ: ${generateKcjText(10)}`, 1),
      ]);

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-1'),
      );

      await sampler.assess(doc);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[HanjaQualitySampler] Starting KCJ quality assessment...',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Assessment complete'),
      );
    });

    test('handles exact corruption threshold boundary (corruptedRatio = 0.5 -> severe)', async () => {
      // 4 pages -> sample 3. If 2 out of 4 pages qualify and are sampled...
      // Let's create exactly 4 qualifying pages, sample 3, corrupt exactly 2 -> ratio 2/3 ≈ 0.67 >= 0.5
      // Actually, to get exactly 0.5, we need even number of sampled pages.
      // 2 pages corrupted out of 4 sampled -> 0.5 exactly
      // To sample 4: need enough pages so min(max(3, ceil(n*0.3)), 5, n) = 4
      // ceil(n*0.3) >= 4 -> n >= 14. max(3, 4) = 4. min(4, 5, n) = 4.
      // Let's use 14 pages -> ceil(14*0.3) = ceil(4.2) = 5 -> min(max(3,5),5,14) = 5
      // For exactly 4: need ceil(n*0.3)=4, so n=12: ceil(12*0.3)=ceil(3.6)=4, max(3,4)=4, min(4,5,12)=4
      const texts: DoclingTextItem[] = [];
      for (let i = 1; i <= 12; i++) {
        texts.push(createTextItem(`KCJ: ${generateKcjText(5 + i)}`, i));
      }
      const doc = createDoclingDoc(texts);

      // 4 sampled pages: 2 corrupted, 2 clean -> ratio = 2/4 = 0.5 exactly
      mockCallVision
        .mockResolvedValueOnce(
          createVisionResponse(true, 5, 17, 'Corrupted', 'page-12'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(true, 4, 16, 'Corrupted', 'page-11'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 15, 'Clean', 'page-10'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 14, 'Clean', 'page-9'),
        );

      const result = await sampler.assess(doc);

      // 0.5 >= 0.5 -> severe
      expect(result.severity).toBe('severe');
      expect(result.needsVlmReparse).toBe(true);
      expect(result.corruptedRatio).toBe(0.5);
    });

    test('handles empty document with no texts', async () => {
      const doc = createDoclingDoc([]);

      const result = await sampler.assess(doc);

      expect(result.severity).toBe('none');
      expect(result.needsVlmReparse).toBe(false);
      expect(result.kcjPageCount).toBe(0);
    });

    test('aggregates KCJ characters from multiple texts on the same page', async () => {
      // 3 KCJ chars per text item, 2 items on page 1 = 6 total -> qualifies (>= 5)
      const doc = createDoclingDoc([
        createTextItem('Text with 漢字品', 1),
        createTextItem('More text 質評估', 1),
      ]);

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 6, 'Clean', 'page-1'),
      );

      const result = await sampler.assess(doc);

      expect(result.kcjPageCount).toBe(1);
      expect(result.sampledPageCount).toBe(1);
      expect(mockCallVision).toHaveBeenCalledTimes(1);
    });
  });

  describe('selectSamplePages', () => {
    test('selects max 5 pages when there are 10+ KCJ pages', async () => {
      // 10 pages -> ceil(10*0.3)=3, max(3,3)=3, min(3,5,10)=3
      // Wait, we need MORE pages for the max to kick in.
      // For 5: ceil(n*0.3) >= 5 -> n >= 17: ceil(17*0.3)=ceil(5.1)=6, max(3,6)=6, min(6,5,17)=5
      // With 20 pages: ceil(20*0.3)=6, max(3,6)=6, min(6,5,20)=5
      const texts: DoclingTextItem[] = [];
      for (let i = 1; i <= 20; i++) {
        texts.push(createTextItem(`KCJ: ${generateKcjText(5 + i)}`, i));
      }
      const doc = createDoclingDoc(texts);

      // Should sample exactly 5 pages (the ones with highest KCJ density)
      for (let i = 0; i < 5; i++) {
        mockCallVision.mockResolvedValueOnce(
          createVisionResponse(false, 0, 20, 'Clean', `page-${20 - i}`),
        );
      }

      const result = await sampler.assess(doc);

      expect(result.sampledPageCount).toBe(5);
      expect(mockCallVision).toHaveBeenCalledTimes(5);
    });

    test('selects minimum 3 pages when there are exactly 3 KCJ pages', async () => {
      // 3 pages -> ceil(3*0.3)=1, max(3,1)=3, min(3,5,3)=3
      const doc = createDoclingDoc([
        createTextItem(`KCJ: ${generateKcjText(10)}`, 1),
        createTextItem(`KCJ: ${generateKcjText(8)}`, 2),
        createTextItem(`KCJ: ${generateKcjText(6)}`, 3),
      ]);

      mockCallVision
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 10, 'Clean', 'page-1'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 8, 'Clean', 'page-2'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 6, 'Clean', 'page-3'),
        );

      const result = await sampler.assess(doc);

      expect(result.sampledPageCount).toBe(3);
      expect(mockCallVision).toHaveBeenCalledTimes(3);
    });

    test('selects all pages when fewer than MIN_SAMPLE_PAGES qualify', async () => {
      // Only 2 pages with enough KCJ -> min(max(3, ceil(2*0.3)), 5, 2) = min(3, 5, 2) = 2
      const doc = createDoclingDoc([
        createTextItem(`KCJ: ${generateKcjText(10)}`, 1),
        createTextItem(`KCJ: ${generateKcjText(8)}`, 2),
      ]);

      mockCallVision
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 10, 'Clean', 'page-1'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(false, 0, 8, 'Clean', 'page-2'),
        );

      const result = await sampler.assess(doc);

      expect(result.sampledPageCount).toBe(2);
      expect(mockCallVision).toHaveBeenCalledTimes(2);
    });

    test('selects single page when only 1 page qualifies', async () => {
      const doc = createDoclingDoc([
        createTextItem(`KCJ: ${generateKcjText(10)}`, 1),
      ]);

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-1'),
      );

      const result = await sampler.assess(doc);

      expect(result.sampledPageCount).toBe(1);
      expect(mockCallVision).toHaveBeenCalledTimes(1);
    });

    test('sorts pages by KCJ density (highest first)', async () => {
      // Create pages with different KCJ densities
      const doc = createDoclingDoc([
        createTextItem(`Low KCJ: ${generateKcjText(6)}`, 1),
        createTextItem(`High KCJ: ${generateKcjText(50)}`, 2),
        createTextItem(`Medium KCJ: ${generateKcjText(20)}`, 3),
      ]);

      const callOrder: string[] = [];
      mockCallVision.mockImplementation(async (args: unknown) => {
        const typedArgs = args as { phase: string };
        callOrder.push(typedArgs.phase);
        return createVisionResponse(false, 0, 10, 'Clean', typedArgs.phase);
      });

      await sampler.assess(doc);

      // Pages should be evaluated in order of KCJ density (highest first)
      // Page 2 (50 chars) -> Page 3 (20 chars) -> Page 1 (6 chars)
      expect(callOrder).toEqual(['page-2', 'page-3', 'page-1']);
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

      const doc = createDoclingDoc([
        createTextItem(`KCJ: ${generateKcjText(10)}`, 1),
      ]);

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-1'),
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

      const doc = createDoclingDoc([
        createTextItem(`KCJ: ${generateKcjText(10)}`, 1),
      ]);

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-1'),
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

      const doc = createDoclingDoc([
        createTextItem(`KCJ text: ${generateKcjText(10)}`, 3),
      ]);

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-3'),
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
      const doc = createDoclingDoc([
        createTextItem(`KCJ: ${generateKcjText(10)}`, 7),
      ]);

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
      const doc = createDoclingDoc([
        createTextItem(`First text ${generateKcjText(3)}`, 1),
        createTextItem(`Second text ${generateKcjText(3)}`, 1),
      ]);

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 6, 'Clean', 'page-1'),
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
      const doc = createDoclingDoc([
        createTextItem(`KCJ: ${generateKcjText(10)}`, 1),
      ]);

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(true, 3, 10, 'Some corruption', 'page-1'),
      );

      await sampler.assess(doc);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Page 1: corrupted=true'),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('3/10 KCJ chars corrupted'),
      );
    });
  });

  describe('findKcjPages', () => {
    test('detects KCJ Unified Ideographs (U+4E00-U+9FFF)', async () => {
      const doc = createDoclingDoc([
        createTextItem('Text with 漢字品質評 (5 unified ideographs)', 1),
      ]);

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 5, 'Clean', 'page-1'),
      );

      const result = await sampler.assess(doc);

      expect(result.kcjPageCount).toBe(1);
    });

    test('detects KCJ Extension A characters (U+3400-U+4DBF)', async () => {
      // Characters from KCJ Extension A range
      const extAChars = '\u3400\u3401\u3402\u3403\u3404';
      const doc = createDoclingDoc([
        createTextItem(`Extension A: ${extAChars}`, 1),
      ]);

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 5, 'Clean', 'page-1'),
      );

      const result = await sampler.assess(doc);

      expect(result.kcjPageCount).toBe(1);
    });

    test('detects KCJ Compatibility Ideographs (U+F900-U+FAFF)', async () => {
      // Characters from KCJ Compatibility Ideographs range
      const compatChars = '\uF900\uF901\uF902\uF903\uF904';
      const doc = createDoclingDoc([
        createTextItem(`Compatibility: ${compatChars}`, 1),
      ]);

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 5, 'Clean', 'page-1'),
      );

      const result = await sampler.assess(doc);

      expect(result.kcjPageCount).toBe(1);
    });

    test('ignores text items with no KCJ characters', async () => {
      const doc = createDoclingDoc([
        createTextItem('Pure English text without any KCJ', 1),
        createTextItem(`KCJ page: ${generateKcjText(10)}`, 2),
      ]);

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-2'),
      );

      const result = await sampler.assess(doc);

      // Only page 2 should qualify
      expect(result.kcjPageCount).toBe(1);
    });
  });

  describe('aggregateResults edge cases', () => {
    test('severe assessment includes correct reason string', async () => {
      const doc = createDoclingDoc([
        createTextItem(`KCJ: ${generateKcjText(10)}`, 1),
        createTextItem(`KCJ: ${generateKcjText(8)}`, 2),
      ]);

      mockCallVision
        .mockResolvedValueOnce(
          createVisionResponse(true, 8, 10, 'Corrupted', 'page-1'),
        )
        .mockResolvedValueOnce(
          createVisionResponse(true, 6, 8, 'Corrupted', 'page-2'),
        );

      const result = await sampler.assess(doc);

      expect(result.reason).toContain('2/2');
      expect(result.reason).toContain('corrupted KCJ characters');
      expect(result.reason).toContain('ratio: 1.00');
    });

    test('clean assessment uses correct reason string', async () => {
      const doc = createDoclingDoc([
        createTextItem(`KCJ: ${generateKcjText(10)}`, 1),
      ]);

      mockCallVision.mockResolvedValueOnce(
        createVisionResponse(false, 0, 10, 'Clean', 'page-1'),
      );

      const result = await sampler.assess(doc);

      expect(result.reason).toBe('No KCJ character corruption detected');
    });
  });

  describe('LLM error handling', () => {
    test('propagates LLM API errors', async () => {
      const doc = createDoclingDoc([
        createTextItem(`KCJ: ${generateKcjText(10)}`, 1),
      ]);

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
