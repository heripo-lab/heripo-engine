import type {
  DoclingBBox,
  DoclingDocument,
  ReviewAssistanceCommand,
  ReviewAssistanceDecision,
  ReviewAssistanceIssue,
  ReviewAssistanceIssueCategory,
  ReviewAssistancePageResult,
} from '@heripo/model';

import type { PageReviewContext } from './page-review-context-builder';

import { LLMCaller, LLMTokenUsageAggregator } from '@heripo/shared';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { PdfTextExtractor } from '../pdf-text-extractor';
import { ReviewAssistanceRunner } from './review-assistance-runner';

const { mockExtractText } = vi.hoisted(() => ({
  mockExtractText: vi.fn(),
}));

vi.mock('@heripo/shared', async () => {
  const actual =
    await vi.importActual<typeof import('@heripo/shared')>('@heripo/shared');
  return {
    ...actual,
    LLMCaller: {
      callVision: vi.fn(),
    },
  };
});

vi.mock('../pdf-text-extractor', () => ({
  PdfTextExtractor: vi.fn().mockImplementation(function () {
    return {
      extractText: mockExtractText,
    };
  }),
}));

const usage = {
  component: 'ReviewAssistance',
  phase: 'page-review',
  model: 'primary' as const,
  modelName: 'mock-model',
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
};

const reviewBBox: DoclingBBox = {
  l: 10,
  t: 10,
  r: 80,
  b: 40,
  coord_origin: 'TOPLEFT',
};

function makeDoc(): DoclingDocument {
  return {
    schema_name: 'DoclingDocument',
    version: '1.0',
    name: 'sample',
    origin: {
      mimetype: 'application/pdf',
      binary_hash: 1,
      filename: 'sample.pdf',
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
      children: [{ $ref: '#/texts/0' }],
      content_layer: 'body',
      name: '_root_',
      label: 'unspecified',
    },
    groups: [],
    texts: [
      {
        self_ref: '#/texts/0',
        parent: { $ref: '#/body' },
        children: [],
        content_layer: 'body',
        label: 'text',
        prov: [
          {
            page_no: 1,
            bbox: { l: 10, t: 10, r: 80, b: 40, coord_origin: 'TOPLEFT' },
            charspan: [0, 4],
          },
        ],
        orig: 'T e s t',
        text: 'T e s t',
      },
    ],
    pictures: [],
    tables: [],
    pages: {
      '1': {
        page_no: 1,
        size: { width: 100, height: 100 },
        image: {
          mimetype: 'image/png',
          dpi: 200,
          size: { width: 100, height: 100 },
          uri: 'pages/page_0.png',
        },
      },
    },
  };
}

function makePageContext(pageImagePath: string): PageReviewContext {
  return {
    pageNo: 1,
    pageSize: { width: 100, height: 100 },
    pageImagePath,
    textBlocks: [
      {
        ref: '#/texts/0',
        label: 'text',
        text: 'T e s t',
        bbox: reviewBBox,
        suspectReasons: ['ocr_noise'],
      },
    ],
    missingTextCandidates: [],
    tables: [
      {
        ref: '#/tables/0',
        bbox: reviewBBox,
        gridPreview: [['A']],
        emptyCellRatio: 0,
        suspectReasons: [],
      },
    ],
    pictures: [
      {
        ref: '#/pictures/0',
        bbox: reviewBBox,
        suspectReasons: ['image_missing_caption'],
      },
    ],
    orphanCaptions: [],
    footnotes: [
      {
        ref: '#/texts/1',
        text: '1) Footnote',
        marker: '1)',
        bbox: reviewBBox,
      },
    ],
    layout: {
      readingOrderRefs: ['#/texts/0', '#/tables/0', '#/pictures/0'],
      visualOrderRefs: ['#/texts/0', '#/tables/0', '#/pictures/0'],
      bboxWarnings: [],
    },
    domainPatterns: [],
  };
}

function makeDecision(
  id: string,
  command: ReviewAssistanceCommand | undefined,
  overrides: Partial<ReviewAssistanceDecision> = {},
): ReviewAssistanceDecision {
  return {
    id,
    pageNo: 1,
    command,
    confidence: 0.9,
    disposition: 'auto_applied',
    reasons: [id],
    ...overrides,
  };
}

function makeOptions() {
  return {
    enabled: true,
    concurrency: 1,
    autoApplyThreshold: 0.85,
    proposalThreshold: 0.5,
    maxRetries: 3,
    temperature: 0,
    outputLanguage: 'en-US',
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('ReviewAssistanceRunner', () => {
  let outputDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    outputDir = mkdtempSync(join(tmpdir(), 'review-assistance-'));
    mkdirSync(join(outputDir, 'pages'), { recursive: true });
    writeFileSync(join(outputDir, 'result.json'), JSON.stringify(makeDoc()));
    writeFileSync(
      join(outputDir, 'pages', 'page_0.png'),
      Buffer.from([1, 2, 3]),
    );
    vi.mocked(PdfTextExtractor).mockImplementation(function () {
      return { extractText: mockExtractText } as any;
    });
    mockExtractText.mockResolvedValue(new Map([[1, 'Test']]));
    vi.mocked(LLMCaller.callVision).mockResolvedValue({
      output: {
        pageNo: 1,
        commands: [
          {
            op: 'replaceText',
            targetRef: '#/texts/0',
            payload: { text: 'Test' },
            confidence: 0.95,
            rationale: 'Spacing OCR noise',
            evidence: 'Image reads Test',
          },
        ],
        pageNotes: ['Text corrected'],
      },
      usage,
      usedFallback: false,
    });
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  test('runs page review and writes review_assistance sidecar', async () => {
    const aggregator = new LLMTokenUsageAggregator();
    const onTokenUsage = vi.fn();
    const onProgress = vi.fn();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const report = await new ReviewAssistanceRunner(logger).analyzeAndSave(
      outputDir,
      'report-1',
      { modelId: 'mock-model' } as any,
      {
        enabled: true,
        concurrency: 1,
        autoApplyThreshold: 0.85,
        proposalThreshold: 0.5,
        maxRetries: 3,
        temperature: 0,
        outputLanguage: 'en-US',
        aggregator,
        onTokenUsage,
        onProgress,
        pageTexts: new Map([[1, 'Test\n\nMissing line']]),
      },
    );

    expect(report.summary).toMatchObject({
      pageCount: 1,
      pagesSucceeded: 1,
      autoAppliedCount: 1,
      proposalCount: 0,
      skippedCount: 0,
    });
    expect(LLMCaller.callVision).toHaveBeenCalledTimes(6);
    expect(LLMCaller.callVision).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'ReviewAssistance',
        phase: 'page-review',
        metadata: {
          pageNo: 1,
          pageCount: 1,
          task: 'text_ocr_hanja',
        },
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[ReviewAssistanceRunner] Page 1/1: review started',
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[ReviewAssistanceRunner] Page 1/1: review completed (1 decisions from 6/6 tasks)',
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        substage: 'review-assistance:page',
        status: 'started',
        pageNo: 1,
        pageCount: 1,
      }),
    );
    expect(onTokenUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        total: expect.objectContaining({ totalTokens: 90 }),
      }),
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        substage: 'review-assistance:write-report',
        status: 'completed',
        reportId: 'report-1',
      }),
    );

    const sidecar = JSON.parse(
      readFileSync(join(outputDir, 'review_assistance.json'), 'utf-8'),
    );
    expect(sidecar.source.originSnapshot).toBe('result_review_origin.json');
    expect(sidecar.source.ocrOriginSnapshot).toBe('result_ocr_origin.json');
    expect(sidecar.pages[0].decisions[0].command).toEqual({
      op: 'replaceText',
      textRef: '#/texts/0',
      text: 'Test',
    });
    expect(sidecar.pages[0].decisions[0].disposition).toBe('auto_applied');
    expect(sidecar.pages[0].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'text_integrity',
          type: 'unmatched_text_layer_block',
          description:
            'Text layer block is missing from Docling text: Missing line',
          reasons: ['unmatched_text_layer_block'],
        }),
      ]),
    );
    const patchedDoc = JSON.parse(
      readFileSync(join(outputDir, 'result.json'), 'utf-8'),
    );
    const originDoc = JSON.parse(
      readFileSync(join(outputDir, 'result_review_origin.json'), 'utf-8'),
    );
    const ocrOriginDoc = JSON.parse(
      readFileSync(join(outputDir, 'result_ocr_origin.json'), 'utf-8'),
    );
    expect(patchedDoc.texts[0].text).toBe('Test');
    expect(originDoc.texts[0].text).toBe('T e s t');
    expect(ocrOriginDoc.texts[0].text).toBe('T e s t');
    expect(existsSync(join(outputDir, 'result_review_origin.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'result_ocr_origin.json'))).toBe(true);
  });

  test('extracts text reference when pdfPath is provided', async () => {
    await new ReviewAssistanceRunner({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }).analyzeAndSave(outputDir, 'report-1', { modelId: 'mock-model' } as any, {
      enabled: true,
      concurrency: 1,
      autoApplyThreshold: 0.85,
      proposalThreshold: 0.5,
      maxRetries: 3,
      temperature: 0,
      outputLanguage: 'en-US',
      pdfPath: '/tmp/input.pdf',
    });

    expect(mockExtractText).toHaveBeenCalledWith('/tmp/input.pdf', 1);
  });

  test('같은 ref를 건드리는 task 충돌은 자동 반영하지 않고 proposal로 낮춘다', async () => {
    vi.mocked(LLMCaller.callVision).mockImplementation(async (input: any) => {
      const task = input.metadata.task;
      if (task === 'text_ocr_hanja') {
        return {
          output: {
            pageNo: 1,
            commands: [
              {
                op: 'replaceText',
                targetRef: '#/texts/0',
                payload: { text: 'Test' },
                confidence: 0.95,
                rationale: 'Correct OCR spacing',
                evidence: 'Test',
              },
            ],
            pageNotes: [],
          },
          usage,
          usedFallback: false,
        };
      }
      if (task === 'layout_bbox_order') {
        return {
          output: {
            pageNo: 1,
            commands: [
              {
                op: 'updateBbox',
                targetRef: '#/texts/0',
                payload: {
                  bbox: {
                    l: 12,
                    t: 12,
                    r: 82,
                    b: 42,
                    coord_origin: 'TOPLEFT',
                  },
                },
                confidence: 0.95,
                rationale: 'Bbox aligns better with visual text',
                evidence: 'Text box shifted',
              },
            ],
            pageNotes: [],
          },
          usage,
          usedFallback: false,
        };
      }
      return {
        output: { pageNo: 1, commands: [], pageNotes: [] },
        usage,
        usedFallback: false,
      };
    });

    const report = await new ReviewAssistanceRunner({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }).analyzeAndSave(outputDir, 'report-1', { modelId: 'mock-model' } as any, {
      enabled: true,
      concurrency: 1,
      autoApplyThreshold: 0.85,
      proposalThreshold: 0.5,
      maxRetries: 3,
      temperature: 0,
      outputLanguage: 'en-US',
    });

    expect(report.summary.autoAppliedCount).toBe(0);
    expect(report.summary.proposalCount).toBe(2);
    expect(report.pages[0].decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disposition: 'proposal',
          reasons: expect.arrayContaining(['task_conflict_same_target_ref']),
          metadata: expect.objectContaining({ reviewTask: 'text_ocr_hanja' }),
        }),
        expect.objectContaining({
          disposition: 'proposal',
          reasons: expect.arrayContaining(['task_conflict_same_target_ref']),
          metadata: expect.objectContaining({
            reviewTask: 'layout_bbox_order',
          }),
        }),
      ]),
    );
  });

  test('keeps existing origin snapshots when rerun in the same output directory', async () => {
    const reviewOrigin = makeDoc();
    reviewOrigin.texts[0].text = 'Existing review origin';
    const ocrOrigin = makeDoc();
    ocrOrigin.texts[0].text = 'Existing OCR origin';
    writeFileSync(
      join(outputDir, 'result_review_origin.json'),
      JSON.stringify(reviewOrigin),
    );
    writeFileSync(
      join(outputDir, 'result_ocr_origin.json'),
      JSON.stringify(ocrOrigin),
    );
    vi.mocked(LLMCaller.callVision).mockResolvedValue({
      output: { pageNo: 1, commands: [], pageNotes: [] },
      usage,
      usedFallback: false,
    });

    await new ReviewAssistanceRunner({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }).analyzeAndSave(outputDir, 'report-1', { modelId: 'mock-model' } as any, {
      enabled: true,
      concurrency: 1,
      autoApplyThreshold: 0.85,
      proposalThreshold: 0.5,
      maxRetries: 3,
      temperature: 0,
      outputLanguage: 'en-US',
    });

    expect(
      JSON.parse(
        readFileSync(join(outputDir, 'result_review_origin.json'), 'utf-8'),
      ).texts[0].text,
    ).toBe('Existing review origin');
    expect(
      JSON.parse(
        readFileSync(join(outputDir, 'result_ocr_origin.json'), 'utf-8'),
      ).texts[0].text,
    ).toBe('Existing OCR origin');
  });

  test('continues without text reference when pdftotext extraction fails', async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    mockExtractText.mockRejectedValue(new Error('pdftotext failed'));

    const report = await new ReviewAssistanceRunner(logger).analyzeAndSave(
      outputDir,
      'report-1',
      { modelId: 'mock-model' } as any,
      {
        enabled: true,
        concurrency: 1,
        autoApplyThreshold: 0.85,
        proposalThreshold: 0.5,
        maxRetries: 3,
        temperature: 0,
        outputLanguage: 'en-US',
        pdfPath: '/tmp/input.pdf',
      },
    );

    expect(report.summary.pagesSucceeded).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[ReviewAssistanceRunner] pdftotext extraction failed, proceeding without text reference',
      expect.any(Error),
    );
  });

  test('records page failure for non-abort VLM errors', async () => {
    vi.mocked(LLMCaller.callVision).mockRejectedValue('vlm failed');
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const report = await new ReviewAssistanceRunner(logger).analyzeAndSave(
      outputDir,
      'report-1',
      { modelId: 'mock-model' } as any,
      {
        enabled: true,
        concurrency: 1,
        autoApplyThreshold: 0.85,
        proposalThreshold: 0.5,
        maxRetries: 3,
        temperature: 0,
        outputLanguage: 'en-US',
      },
    );

    expect(report.summary.pagesFailed).toBe(1);
    expect(report.pages[0].error?.message).toContain(
      'text_ocr_hanja: vlm failed',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      '[ReviewAssistanceRunner] Page 1/1: all review tasks failed',
      {
        err: expect.objectContaining({
          type: 'ReviewAssistanceTaskFailure',
          message: expect.stringContaining('text_ocr_hanja: vlm failed'),
        }),
      },
    );
  });

  test('records Error instances from failed page review', async () => {
    vi.mocked(LLMCaller.callVision).mockRejectedValue(
      new Error('model failed'),
    );

    const report = await new ReviewAssistanceRunner({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }).analyzeAndSave(outputDir, 'report-1', { modelId: 'mock-model' } as any, {
      enabled: true,
      concurrency: 1,
      autoApplyThreshold: 0.85,
      proposalThreshold: 0.5,
      maxRetries: 3,
      temperature: 0,
      outputLanguage: 'en-US',
    });

    expect(report.pages[0].error?.message).toContain(
      'text_ocr_hanja: model failed',
    );
  });

  test('리뷰 실패 로그와 리포트 에러에서 긴 base64성 데이터를 제거한다', async () => {
    const base64Like = 'a'.repeat(260);
    vi.mocked(LLMCaller.callVision).mockRejectedValue(
      new Error(`Headers Timeout ${base64Like}`),
    );
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const report = await new ReviewAssistanceRunner(logger).analyzeAndSave(
      outputDir,
      'report-1',
      { modelId: 'mock-model' } as any,
      {
        enabled: true,
        concurrency: 1,
        autoApplyThreshold: 0.85,
        proposalThreshold: 0.5,
        maxRetries: 3,
        temperature: 0,
        outputLanguage: 'en-US',
      },
    );

    expect(report.pages[0].error?.message).toContain(
      'text_ocr_hanja: Headers Timeout [redacted-large-data]',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      '[ReviewAssistanceRunner] Page 1/1: text_ocr_hanja task failed',
      {
        err: expect.objectContaining({
          message: 'Headers Timeout [redacted-large-data]',
          stack: expect.not.stringContaining(base64Like),
        }),
      },
    );
  });

  test('treats no structured output as no-op review result with issue hint', async () => {
    vi.mocked(LLMCaller.callVision).mockRejectedValue(
      new Error('No output generated.'),
    );
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const report = await new ReviewAssistanceRunner(logger).analyzeAndSave(
      outputDir,
      'report-1',
      { modelId: 'mock-model' } as any,
      {
        enabled: true,
        concurrency: 1,
        autoApplyThreshold: 0.85,
        proposalThreshold: 0.5,
        maxRetries: 3,
        temperature: 0,
        outputLanguage: 'en-US',
      },
    );

    expect(report.summary.pagesSucceeded).toBe(1);
    expect(report.summary.pagesFailed).toBe(0);
    expect(report.pages[0].status).toBe('succeeded');
    expect(report.pages[0].decisions).toEqual([]);
    expect(report.pages[0].error).toBeUndefined();
    expect(report.pages[0].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'review_execution',
          type: 'empty_model_output',
          severity: 'warning',
          reasons: expect.arrayContaining(['no_output_generated']),
        }),
      ]),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      '[ReviewAssistanceRunner] Page 1/1: text_ocr_hanja task produced no structured output; recording no-op result',
      {
        err: expect.objectContaining({
          type: 'Error',
          message: 'No output generated.',
        }),
      },
    );
  });

  test('한자 후보와 이미지 내부 텍스트 후보는 별도 확인 이슈로 남기지 않는다', () => {
    const context: PageReviewContext = {
      pageNo: 1,
      pageSize: { width: 100, height: 100 },
      pageImagePath: '/tmp/page_0.png',
      textBlocks: [
        {
          ref: '#/texts/0',
          label: 'text',
          text: 'ALL)*',
          bbox: { l: 10, t: 10, r: 80, b: 40, coord_origin: 'TOPLEFT' },
          suspectReasons: ['hanja_ocr_candidate'],
        },
        {
          ref: '#/texts/1',
          label: 'text',
          text: 'image label',
          bbox: { l: 12, t: 12, r: 50, b: 30, coord_origin: 'TOPLEFT' },
          suspectReasons: ['picture_internal_text', 'ocr_noise'],
        },
        {
          ref: '#/texts/2',
          label: 'text',
          text: 'T e s t',
          bbox: { l: 10, t: 50, r: 80, b: 70, coord_origin: 'TOPLEFT' },
          suspectReasons: ['ocr_noise'],
        },
      ],
      missingTextCandidates: [],
      tables: [],
      pictures: [],
      orphanCaptions: [],
      footnotes: [],
      layout: {
        readingOrderRefs: [],
        visualOrderRefs: [],
        bboxWarnings: [],
      },
      domainPatterns: [
        { targetRef: '#/texts/0', pattern: 'hanja_term', value: '山' },
        { targetRef: '#/texts/2', pattern: 'unit', value: '10 cm' },
      ],
    };

    const issues = (
      new ReviewAssistanceRunner({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }) as unknown as {
        buildIssues(context: PageReviewContext): Array<{ type: string }>;
      }
    ).buildIssues(context);

    expect(issues.map((issue) => issue.type)).toEqual(['ocr_noise', 'unit']);
  });

  test('rethrows abort errors from page review', async () => {
    const abortController = new AbortController();
    abortController.abort();
    vi.mocked(LLMCaller.callVision).mockRejectedValue(new Error('aborted'));

    await expect(
      new ReviewAssistanceRunner({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }).analyzeAndSave(
        outputDir,
        'report-1',
        { modelId: 'mock-model' } as any,
        {
          enabled: true,
          concurrency: 1,
          autoApplyThreshold: 0.85,
          proposalThreshold: 0.5,
          maxRetries: 3,
          temperature: 0,
          outputLanguage: 'en-US',
          abortSignal: abortController.signal,
        },
      ),
    ).rejects.toThrow('aborted');
  });

  test('summarizes issue categories from deterministic context hints', async () => {
    const doc = makeDoc();
    doc.pages['2'] = {
      page_no: 2,
      size: { width: 100, height: 100 },
      image: {
        mimetype: 'image/png',
        dpi: 200,
        size: { width: 100, height: 100 },
        uri: 'pages/page_1.png',
      },
    };
    doc.body.children = [
      { $ref: '#/texts/0' },
      { $ref: '#/texts/1' },
      { $ref: '#/texts/2' },
      { $ref: '#/texts/3' },
      { $ref: '#/pictures/0' },
      { $ref: '#/tables/0' },
    ];
    doc.texts = [
      {
        ...doc.texts[0],
        text: 'Figure 1',
        orig: 'Figure 1',
      },
      {
        ...doc.texts[0],
        self_ref: '#/texts/1',
        label: 'text',
        text: '1) Footnote',
        orig: '1) Footnote',
      },
      {
        ...doc.texts[0],
        self_ref: '#/texts/2',
        label: 'section_header',
        text: 'A'.repeat(81),
        orig: 'A'.repeat(81),
      },
      {
        ...doc.texts[0],
        self_ref: '#/texts/3',
        text: 'Repeated 10 cm',
        orig: 'Repeated 10 cm',
        prov: [
          doc.texts[0].prov[0],
          {
            page_no: 2,
            bbox: {
              l: 10,
              t: 10,
              r: 10,
              b: 10,
              coord_origin: 'TOPLEFT',
            },
            charspan: [0, 14],
          },
        ],
      },
    ];
    doc.pictures = [
      {
        self_ref: '#/pictures/0',
        parent: { $ref: '#/body' },
        children: [],
        content_layer: 'body',
        label: 'picture',
        prov: [doc.texts[0].prov[0]],
        captions: [],
        references: [],
        footnotes: [],
        annotations: [],
      },
    ];
    doc.tables = [
      {
        self_ref: '#/tables/0',
        parent: { $ref: '#/body' },
        children: [],
        content_layer: 'body',
        label: 'table',
        prov: [doc.texts[0].prov[0]],
        captions: [],
        references: [],
        footnotes: [],
        data: {
          num_rows: 1,
          num_cols: 1,
          table_cells: [],
          grid: [
            [
              {
                bbox: doc.texts[0].prov[0].bbox,
                row_span: 1,
                col_span: 1,
                start_row_offset_idx: 0,
                end_row_offset_idx: 1,
                start_col_offset_idx: 0,
                end_col_offset_idx: 1,
                text: '',
                column_header: false,
                row_header: false,
                row_section: false,
                fillable: false,
              },
            ],
          ],
        },
      },
      {
        self_ref: '#/tables/1',
        parent: { $ref: '#/body' },
        children: [],
        content_layer: 'body',
        label: 'table',
        prov: [
          {
            page_no: 2,
            bbox: {
              l: 10,
              t: 10,
              r: 80,
              b: 40,
              coord_origin: 'TOPLEFT',
            },
            charspan: [0, 0],
          },
        ],
        captions: [],
        references: [],
        footnotes: [],
        data: {
          num_rows: 1,
          num_cols: 1,
          table_cells: [],
          grid: [
            [
              {
                bbox: doc.texts[0].prov[0].bbox,
                row_span: 1,
                col_span: 1,
                start_row_offset_idx: 0,
                end_row_offset_idx: 1,
                start_col_offset_idx: 0,
                end_col_offset_idx: 1,
                text: 'continued',
                column_header: false,
                row_header: false,
                row_section: false,
                fillable: false,
              },
            ],
          ],
        },
      },
    ];
    writeFileSync(join(outputDir, 'result.json'), JSON.stringify(doc));
    writeFileSync(
      join(outputDir, 'pages', 'page_1.png'),
      Buffer.from([4, 5, 6]),
    );
    vi.mocked(LLMCaller.callVision).mockResolvedValue({
      output: { pageNo: 1, commands: [], pageNotes: [] },
      usage,
      usedFallback: false,
    });

    const report = await new ReviewAssistanceRunner({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }).analyzeAndSave(outputDir, 'report-1', { modelId: 'mock-model' } as any, {
      enabled: true,
      concurrency: 1,
      autoApplyThreshold: 0.85,
      proposalThreshold: 0.5,
      maxRetries: 3,
      temperature: 0,
      outputLanguage: 'en-US',
    });
    const categories = report.pages.flatMap((page) =>
      page.issues.map((issue) => issue.category),
    );

    expect(categories).toEqual(
      expect.arrayContaining([
        'caption',
        'text_integrity',
        'picture',
        'table',
        'bbox',
        'domain_pattern',
      ]),
    );
  });

  test('covers page-level review fallback paths', async () => {
    const pagePath = join(outputDir, 'pages', 'page_0.png');
    const noOutputLogger = makeLogger();
    const noOutputRunner = new ReviewAssistanceRunner(noOutputLogger) as any;
    noOutputRunner.reviewPageTask = vi
      .fn()
      .mockRejectedValue(new Error('No output generated.'));

    const noOutputResult = (await noOutputRunner.reviewPage(
      makePageContext(pagePath),
      'report-1',
      { modelId: 'mock-model' } as any,
      makeOptions(),
      1,
    )) as ReviewAssistancePageResult;

    expect(noOutputResult.status).toBe('succeeded');
    expect(noOutputResult.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'empty_model_output' }),
      ]),
    );
    expect(noOutputLogger.warn).toHaveBeenCalledWith(
      '[ReviewAssistanceRunner] Page 1/1: review produced no structured output; recording no-op result',
      expect.any(Object),
    );

    const genericLogger = makeLogger();
    const genericRunner = new ReviewAssistanceRunner(genericLogger) as any;
    const genericFailure = (await genericRunner.reviewPage(
      makePageContext(join(outputDir, 'pages', 'missing.png')),
      'report-1',
      { modelId: 'mock-model' } as any,
      makeOptions(),
      1,
    )) as ReviewAssistancePageResult;

    expect(genericFailure.status).toBe('failed');
    expect(genericFailure.error?.message).toContain('ENOENT');
    expect(genericLogger.warn).toHaveBeenCalledWith(
      '[ReviewAssistanceRunner] Page 1/1: review failed',
      expect.any(Object),
    );

    const failedTasksLogger = makeLogger();
    const failedTasksRunner = new ReviewAssistanceRunner(
      failedTasksLogger,
    ) as any;
    failedTasksRunner.reviewPageTask = vi.fn(async (_context, task) => ({
      task,
      status: 'failed',
      decisions: [],
    }));

    const failedTasksResult = (await failedTasksRunner.reviewPage(
      makePageContext(pagePath),
      'report-1',
      { modelId: 'mock-model' } as any,
      makeOptions(),
      1,
    )) as ReviewAssistancePageResult;

    expect(failedTasksResult.status).toBe('failed');
    expect(failedTasksResult.error?.message).toContain(': failed');
    expect(failedTasksResult.issues.every((issue) => issue.type !== '')).toBe(
      true,
    );
  });

  test('covers task decision merge helpers and touched ref extraction', () => {
    const runner = new ReviewAssistanceRunner(makeLogger()) as any;
    const task = {
      id: 'text_ocr_hanja',
      label: 'Text OCR',
      allowedOps: ['replaceText'],
    };
    const noOpDecision = makeDecision('noop', undefined);
    const invalidDecision = makeDecision('invalid', undefined, {
      invalidOp: 'addPicture',
      disposition: 'proposal',
    });

    expect(runner.enforceTaskAllowedOps(noOpDecision, task)).toBe(noOpDecision);
    expect(runner.enforceTaskAllowedOps(invalidDecision, task)).toMatchObject({
      disposition: 'skipped',
      metadata: {
        taskOpNotAllowed: {
          task: 'text_ocr_hanja',
          op: 'addPicture',
        },
      },
    });

    const mergeCommand: ReviewAssistanceCommand = {
      op: 'mergeTexts',
      keepRef: '#/texts/0',
      textRefs: ['#/texts/0', '#/texts/1'],
      text: 'Merged',
    };
    const merged = runner.mergeTaskDecisions([
      makeDecision('skipped', undefined, {
        invalidOp: 'badOp',
        disposition: 'skipped',
      }),
      makeDecision('low', mergeCommand, {
        confidence: 0.2,
        metadata: {},
      }),
      makeDecision('high', mergeCommand, {
        confidence: 0.9,
        metadata: { reviewTask: 'layout_bbox_order' },
        reasons: ['high'],
      }),
    ]) as ReviewAssistanceDecision[];

    expect(merged).toHaveLength(2);
    expect(merged[0].invalidOp).toBe('badOp');
    expect(merged[1]).toMatchObject({
      id: 'high',
      confidence: 0.9,
      metadata: {
        duplicateReviewTasks: ['layout_bbox_order'],
      },
    });
    expect(merged[1].reasons).toContain('duplicate_review_task:unknown');

    const commands: ReviewAssistanceCommand[] = [
      { op: 'replaceText', textRef: '#/texts/0', text: 'A' },
      { op: 'updateTextRole', textRef: '#/texts/0', label: 'caption' },
      { op: 'removeText', textRef: '#/texts/0' },
      {
        op: 'splitText',
        textRef: '#/texts/0',
        parts: [{ text: 'A' }, { text: 'B' }],
      },
      mergeCommand,
      {
        op: 'updateTableCell',
        tableRef: '#/tables/0',
        row: 0,
        col: 0,
        text: 'A',
      },
      { op: 'replaceTable', tableRef: '#/tables/0', grid: [[{ text: 'A' }]] },
      {
        op: 'linkContinuedTable',
        sourceTableRef: '#/tables/0',
        continuedTableRef: '#/tables/1',
        relation: 'continues_on_next_page',
      },
      {
        op: 'updatePictureCaption',
        pictureRef: '#/pictures/0',
        caption: 'Fig',
      },
      {
        op: 'splitPicture',
        pictureRef: '#/pictures/0',
        regions: [{ bbox: reviewBBox }],
      },
      { op: 'hidePicture', pictureRef: '#/pictures/0', reason: 'duplicate' },
      { op: 'updateBbox', targetRef: '#/texts/0', bbox: reviewBBox },
      {
        op: 'linkFootnote',
        markerTextRef: '#/texts/0',
        footnoteTextRef: '#/texts/1',
      },
      {
        op: 'moveNode',
        sourceRef: '#/texts/0',
        targetRef: '#/tables/0',
        position: 'after',
      },
      {
        op: 'addText',
        pageNo: 1,
        bbox: reviewBBox,
        text: 'Missing',
        label: 'text',
      },
      {
        op: 'addPicture',
        pageNo: 1,
        bbox: reviewBBox,
        imageUri: 'images/new.png',
      },
    ];

    expect(commands.map((command) => runner.getTouchedRefs(command))).toEqual([
      ['#/texts/0'],
      ['#/texts/0'],
      ['#/texts/0'],
      ['#/texts/0'],
      ['#/texts/0', '#/texts/1'],
      ['#/tables/0'],
      ['#/tables/0'],
      ['#/tables/0'],
      ['#/pictures/0'],
      ['#/pictures/0'],
      ['#/pictures/0'],
      ['#/texts/0'],
      ['#/texts/0', '#/texts/1'],
      ['#/texts/0'],
      [],
      [],
    ]);
  });

  test('covers runner issue and error helper branches', () => {
    const runner = new ReviewAssistanceRunner(makeLogger()) as any;
    const context = makePageContext('/tmp/page_0.png');
    const categoryCases: Array<[string, ReviewAssistanceIssueCategory]> = [
      ['caption_like_body_text', 'caption'],
      ['footnote_like_body_text', 'footnote'],
      ['repeated_across_pages', 'text_integrity'],
      ['picture_internal_text', 'picture'],
      ['hanja_ocr_candidate', 'domain_pattern'],
      ['heading_too_long', 'role'],
      ['empty_text', 'text'],
    ];
    const descriptionReasons = [
      'empty_text',
      'ocr_noise',
      'hanja_ocr_candidate',
      'heading_too_long',
      'repeated_across_pages',
      'caption_like_body_text',
      'picture_internal_text',
      'footnote_like_body_text',
      'orphan_caption',
      'table_missing_caption',
      'table_many_empty_cells',
      'multi_page_table_candidate',
      'image_missing_caption',
      'large_picture_split_candidate',
      'hanja_term',
      'institution_name',
      'roman_numeral',
      'layer_code',
      'unit',
      'feature_number',
    ];

    for (const [reason, category] of categoryCases) {
      expect(runner.issueCategoryForReason(reason)).toBe(category);
    }
    for (const reason of descriptionReasons) {
      expect(runner.issueDescriptionForReason(reason, ' value ')).toContain(
        'value',
      );
    }
    expect(runner.issueDescriptionForReason('custom_reason')).toBe(
      'custom_reason',
    );
    expect(runner.buildNoOutputIssue(context).reasons).toEqual([
      'no_output_generated',
    ]);
    expect(
      runner.isNoOutputGeneratedError({
        name: 'NoOutputGeneratedError',
      }),
    ).toBe(true);
    expect(runner.isNoOutputGeneratedError({ name: undefined })).toBe(false);

    const blankNameError = new Error('plain failure');
    blankNameError.name = '';
    expect(runner.errorLogBinding(blankNameError).err.type).toBe('Error');
    expect(runner.errorLogBinding('plain failure').err).toEqual({
      type: 'string',
      message: 'plain failure',
      stack: undefined,
    });

    const taskIssue = runner.buildTaskFailureIssue(
      context,
      {
        id: 'text_ocr_hanja',
        label: 'Text OCR',
        allowedOps: ['replaceText'],
      },
      'plain failure',
    ) as ReviewAssistanceIssue;
    expect(taskIssue.reasons).toEqual([
      'review_task:text_ocr_hanja',
      'plain failure',
    ]);
  });
});
