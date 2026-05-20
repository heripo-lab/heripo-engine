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
import { PictureSplitCandidateDetector } from './picture-split-candidate-detector';
import { ReviewAssistanceCheckpointStore } from './review-assistance-checkpoint-store';
import { createReviewAssistancePageGatePendingEligibility } from './review-assistance-page-gate';
import { ReviewAssistanceRunner } from './review-assistance-runner';
import { ReviewAssistanceWorkScheduler } from './review-assistance-work-scheduler';

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

vi.mock('../pdf-text-extractor', () => {
  const PdfTextExtractor: any = vi.fn().mockImplementation(function () {
    return {
      extractText: mockExtractText,
    };
  });
  PdfTextExtractor.tryExtract = vi.fn(
    async (
      logger: { warn: (...args: unknown[]) => void },
      pdfPath: string | undefined,
      totalPages: number,
    ): Promise<Map<number, string> | undefined> => {
      if (!pdfPath) return undefined;
      try {
        return await mockExtractText(pdfPath, totalPages);
      } catch (error) {
        logger.warn(
          '[PdfTextExtractor] pdftotext extraction failed, proceeding without text reference',
          error,
        );
        return undefined;
      }
    },
  );
  return { PdfTextExtractor };
});

const usage = {
  component: 'ReviewAssistance',
  phase: 'page-review',
  model: 'primary' as const,
  modelName: 'mock-model',
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
};

function makeGateResult(
  overrides: Partial<{
    eligible: boolean;
    kind: 'toc' | 'archaeological_data' | 'non_meaningful';
    score: number;
    reasons: string[];
    exclusionReasons: string[];
  }> = {},
) {
  return {
    output: {
      eligible: true,
      kind: 'archaeological_data' as const,
      score: 90,
      reasons: ['VLM sees data-bearing content'],
      exclusionReasons: [],
      ...overrides,
    },
    usage,
    usedFallback: false,
  };
}

function makeReviewResult(commands: unknown[] = []) {
  return {
    output: {
      pageNo: 1,
      commands,
      pageNotes: [],
    },
    usage,
    usedFallback: false,
  };
}

function mockDefaultCallVision(): void {
  vi.mocked(LLMCaller.callVision).mockImplementation(async (input: any) => {
    if (input.component === 'ReviewAssistancePageGate') {
      return makeGateResult();
    }
    if (input.metadata?.task === 'text_ocr_hanja') {
      return makeReviewResult([
        {
          op: 'replaceText',
          targetRef: '#/texts/0',
          payload: { text: 'Test' },
          confidence: 0.95,
          rationale: 'Spacing OCR noise',
          evidence: 'Image reads Test',
        },
      ]);
    }
    return makeReviewResult();
  });
}

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
    tables: [
      {
        self_ref: '#/tables/0',
        parent: { $ref: '#/body' },
        children: [],
        content_layer: 'body',
        label: 'table',
        prov: [
          {
            page_no: 1,
            bbox: {
              l: 10,
              t: 50,
              r: 80,
              b: 80,
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
          table_cells: [
            {
              bbox: reviewBBox,
              row_span: 1,
              col_span: 1,
              start_row_offset_idx: 0,
              end_row_offset_idx: 1,
              start_col_offset_idx: 0,
              end_col_offset_idx: 1,
              text: '유구',
              column_header: false,
              row_header: false,
              row_section: false,
              fillable: false,
            },
          ],
          grid: [
            [
              {
                bbox: reviewBBox,
                row_span: 1,
                col_span: 1,
                start_row_offset_idx: 0,
                end_row_offset_idx: 1,
                start_col_offset_idx: 0,
                end_col_offset_idx: 1,
                text: '유구',
                column_header: false,
                row_header: false,
                row_section: false,
                fillable: false,
              },
            ],
          ],
        },
      },
    ],
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
    reviewAssistanceEligibility: {
      pageNo: 1,
      eligible: true,
      kind: 'archaeological_data',
      score: 50,
      reasons: ['table_present'],
      exclusionReasons: [],
    },
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
  const pageGateModel = { modelId: 'page-gate-model' } as any;
  return {
    pageGateModel,
    pageGateMaxRetries: 3,
    pageGateTemperature: 0,
    pageConcurrency: 1,
    taskConcurrency: 6,
    localModelConcurrency: 1,
    workItemTimeoutMs: 1_800_000,
    autoApplyThreshold: 0.85,
    proposalThreshold: 0.5,
    maxRetries: 3,
    tableMaxRetries: 3,
    temperature: 0,
    outputLanguage: 'en-US',
  };
}

function makeModelResolver() {
  const model = { modelId: 'mock-model' } as any;
  return vi.fn(() => model);
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
    mockDefaultCallVision();
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
      makeModelResolver(),
      {
        ...makeOptions(),
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
    expect(LLMCaller.callVision).toHaveBeenCalled();
    expect(LLMCaller.callVision).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'ReviewAssistancePageGate',
        phase: 'page-eligibility',
        metadata: { pageNo: 1 },
      }),
    );
    expect(LLMCaller.callVision).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'ReviewAssistance',
        phase: 'work-item-review',
        metadata: expect.objectContaining({
          pageNo: 1,
          pageCount: 1,
          task: 'text_ocr_hanja',
          workItemKind: 'text_ocr_hanja',
        }),
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[ReviewAssistanceRunner] Page 1/1: review started',
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        '[ReviewAssistanceRunner] Page 1/1: review completed (1 decisions from',
      ),
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
        total: expect.objectContaining({ totalTokens: expect.any(Number) }),
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
    expect(sidecar.callTraces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workItemId: expect.stringContaining('text_ocr_hanja'),
          kind: 'text_ocr_hanja',
          attempts: 1,
          validation: 'passed',
        }),
      ]),
    );
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

  test('uses table-specific retry limit only for the tables task', async () => {
    await new ReviewAssistanceRunner(makeLogger()).analyzeAndSave(
      outputDir,
      'report-1',
      makeModelResolver(),
      {
        ...makeOptions(),
        maxRetries: 4,
        tableMaxRetries: 7,
      },
    );

    const reviewCalls = vi
      .mocked(LLMCaller.callVision)
      .mock.calls.map(([input]) => input as any)
      .filter((input) => input.component === 'ReviewAssistance');
    const tableCall = reviewCalls.find(
      (input) => input.metadata.task === 'tables',
    );
    const textCall = reviewCalls.find(
      (input) => input.metadata.task === 'text_ocr_hanja',
    );

    expect(tableCall).toEqual(expect.objectContaining({ maxRetries: 7 }));
    expect(textCall).toEqual(expect.objectContaining({ maxRetries: 4 }));
  });

  test('routes table work items through TableCorrectionRunner with re-ask feedback', async () => {
    let tableAttempts = 0;
    vi.mocked(LLMCaller.callVision).mockImplementation(async (input: any) => {
      if (input.component === 'ReviewAssistancePageGate') {
        return makeGateResult();
      }
      if (input.metadata?.task !== 'tables') {
        return makeReviewResult();
      }
      tableAttempts += 1;
      // First attempt targets a non-existent table so the table-specific
      // validator rejects it and forces a re-ask with validation feedback.
      if (tableAttempts === 1) {
        return makeReviewResult([
          {
            op: 'updateTableCell',
            targetRef: '#/tables/9',
            payload: { tableRef: '#/tables/9', row: 0, col: 0, text: 'X' },
            confidence: 0.95,
            rationale: 'Wrong target table',
            evidence: 'X',
          },
        ]);
      }
      return makeReviewResult([
        {
          op: 'updateTableCell',
          targetRef: '#/tables/0',
          payload: { tableRef: '#/tables/0', row: 0, col: 0, text: '유물' },
          confidence: 0.95,
          rationale: 'Cell OCR correction',
          evidence: '유물',
        },
      ]);
    });

    const report = await new ReviewAssistanceRunner(
      makeLogger(),
    ).analyzeAndSave(outputDir, 'report-1', makeModelResolver(), {
      ...makeOptions(),
      tableMaxRetries: 3,
    });

    const tableCalls = vi
      .mocked(LLMCaller.callVision)
      .mock.calls.map(([input]) => input as any)
      .filter(
        (input) =>
          input.component === 'ReviewAssistance' &&
          input.metadata?.task === 'tables',
      );

    expect(tableCalls).toHaveLength(2);
    const firstPrompt = tableCalls[0].messages[0].content[0].text as string;
    const secondPrompt = tableCalls[1].messages[0].content[0].text as string;
    expect(firstPrompt).toContain('TABLE CORRECTION CONTEXT JSON');
    expect(firstPrompt).toContain('"targetTable"');
    expect(secondPrompt).toContain('VALIDATION FEEDBACK FOR ATTEMPT 2');
    expect(secondPrompt).toContain('table_correction_target_ref_mismatch');

    const tableDecisions = report.pages[0].decisions.filter(
      (decision) => decision.metadata?.tableCorrection,
    );
    expect(tableDecisions).toHaveLength(1);
    expect(tableDecisions[0].command?.op).toBe('updateTableCell');
    expect(tableDecisions[0].metadata?.tableCorrection).toMatchObject({
      targetRef: '#/tables/0',
    });

    const sidecar = JSON.parse(
      readFileSync(join(outputDir, 'review_assistance.json'), 'utf-8'),
    );
    const tableTrace = sidecar.callTraces.find(
      (trace: { kind: string }) => trace.kind === 'table',
    );
    expect(tableTrace).toMatchObject({
      kind: 'table',
      attempts: 2,
      validation: 'reasked',
    });
  });

  test('skips non-eligible pages without structural model calls', async () => {
    vi.mocked(LLMCaller.callVision).mockImplementation(async (input: any) => {
      if (input.component === 'ReviewAssistancePageGate') {
        return makeGateResult({
          eligible: false,
          kind: 'non_meaningful',
          score: 10,
          reasons: ['VLM sees cover-only page'],
          exclusionReasons: ['cover page without body structure'],
        });
      }
      return makeReviewResult();
    });
    const coverDoc = makeDoc();
    coverDoc.texts[0].text = '아산 상성리유적 발굴조사보고서\n대한문화재연구원';
    coverDoc.texts[0].orig = coverDoc.texts[0].text;
    coverDoc.tables = [];
    coverDoc.body.children = [{ $ref: '#/texts/0' }];
    writeFileSync(join(outputDir, 'result.json'), JSON.stringify(coverDoc));

    const report = await new ReviewAssistanceRunner(
      makeLogger(),
    ).analyzeAndSave(outputDir, 'report-1', makeModelResolver(), {
      ...makeOptions(),
    });

    expect(LLMCaller.callVision).toHaveBeenCalledTimes(1);
    expect(LLMCaller.callVision).not.toHaveBeenCalledWith(
      expect.objectContaining({ component: 'ReviewAssistance' }),
    );
    expect(report.summary).toMatchObject({
      pagesSucceeded: 1,
      pagesFailed: 0,
      autoAppliedCount: 0,
      proposalCount: 0,
    });
    expect(report.pages[0]).toMatchObject({
      status: 'succeeded',
      decisions: [],
      issues: [
        expect.objectContaining({
          category: 'review_execution',
          type: 'page_skipped_by_correction_gate',
          severity: 'info',
          reasons: expect.arrayContaining([
            'cover page without body structure',
          ]),
        }),
      ],
    });
  });

  test('fails open and keeps structural review running when page gate VLM fails', async () => {
    const logger = makeLogger();
    vi.mocked(LLMCaller.callVision).mockImplementation(async (input: any) => {
      if (input.component === 'ReviewAssistancePageGate') {
        throw new Error('gate timeout');
      }
      return makeReviewResult();
    });

    const report = await new ReviewAssistanceRunner(logger).analyzeAndSave(
      outputDir,
      'report-1',
      makeModelResolver(),
      makeOptions(),
    );

    const components = vi
      .mocked(LLMCaller.callVision)
      .mock.calls.map(([input]) => input.component);
    expect(components).toContain('ReviewAssistancePageGate');
    expect(components).toContain('ReviewAssistance');
    expect(report.summary.pagesSucceeded).toBe(1);
    expect(report.summary.pagesFailed).toBe(0);
    expect(report.pages[0].status).toBe('succeeded');
    expect(report.pages[0].error).toBeUndefined();

    const gateSidecar = JSON.parse(
      readFileSync(
        join(outputDir, 'review_assistance_page_gate.json'),
        'utf-8',
      ),
    );
    expect(gateSidecar.pages[0]).toMatchObject({
      pageNo: 1,
      eligible: true,
      kind: 'archaeological_data',
      reasons: ['page_gate_failed_open', 'gate timeout'],
      exclusionReasons: [],
    });
    expect(logger.warn).toHaveBeenCalledWith(
      '[ReviewAssistanceRunner] Page 1: page gate failed open',
      {
        err: expect.objectContaining({
          type: 'Error',
          message: 'gate timeout',
        }),
      },
    );
  });

  test('records a no-op result when the page image is unavailable before gate evaluation', async () => {
    const logger = makeLogger();
    rmSync(join(outputDir, 'pages', 'page_0.png'), { force: true });

    const report = await new ReviewAssistanceRunner(logger).analyzeAndSave(
      outputDir,
      'report-1',
      makeModelResolver(),
      makeOptions(),
    );

    expect(LLMCaller.callVision).not.toHaveBeenCalled();
    expect(report.summary.pagesSucceeded).toBe(1);
    expect(report.summary.pagesFailed).toBe(0);
    expect(report.pages[0]).toMatchObject({
      status: 'succeeded',
      decisions: [],
      issues: expect.arrayContaining([
        expect.objectContaining({
          category: 'review_execution',
          type: 'page_image_not_available',
          severity: 'warning',
          reasons: expect.arrayContaining([
            'page_gate_failed_open',
            'page_image_not_available',
          ]),
        }),
      ]),
    });

    const gateSidecar = JSON.parse(
      readFileSync(
        join(outputDir, 'review_assistance_page_gate.json'),
        'utf-8',
      ),
    );
    expect(gateSidecar.pages[0]).toMatchObject({
      pageNo: 1,
      eligible: true,
      kind: 'archaeological_data',
      reasons: ['page_gate_failed_open', 'page_image_not_available'],
      exclusionReasons: [],
    });
    expect(logger.warn).toHaveBeenCalledWith(
      '[ReviewAssistanceRunner] Page 1: page image unavailable for page gate',
      expect.any(Object),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      '[ReviewAssistanceRunner] Page 1/1: structural review skipped because page image is not available',
    );
  });

  test('propagates page gate image read errors when aborted', async () => {
    const logger = makeLogger();
    const abortController = new AbortController();
    abortController.abort();
    rmSync(join(outputDir, 'pages', 'page_0.png'), { force: true });

    await expect(
      new ReviewAssistanceRunner(logger).analyzeAndSave(
        outputDir,
        'report-1',
        makeModelResolver(),
        {
          ...makeOptions(),
          abortSignal: abortController.signal,
        },
      ),
    ).rejects.toThrow('ENOENT');
    expect(logger.warn).not.toHaveBeenCalledWith(
      '[ReviewAssistanceRunner] Page 1: page image unavailable for page gate',
      expect.any(Object),
    );
  });

  test('keeps non-pending contexts unchanged while evaluating pending page gates', async () => {
    const runner = new ReviewAssistanceRunner(makeLogger()) as any;
    const pageOneContext = makePageContext(
      join(outputDir, 'pages', 'page_0.png'),
    );
    const pageTwoContext = {
      ...makePageContext(join(outputDir, 'pages', 'page_1.png')),
      pageNo: 2,
      reviewAssistanceEligibility:
        createReviewAssistancePageGatePendingEligibility(2),
    };
    writeFileSync(
      join(outputDir, 'pages', 'page_1.png'),
      Buffer.from([4, 5, 6]),
    );
    vi.mocked(LLMCaller.callVision).mockResolvedValue(makeGateResult());

    const updated = (await runner.ensurePageEligibility(
      [pageOneContext, pageTwoContext],
      makeOptions(),
      outputDir,
    )) as PageReviewContext[];

    expect(updated[0]).toBe(pageOneContext);
    expect(updated[1].reviewAssistanceEligibility).toMatchObject({
      pageNo: 2,
      eligible: true,
      reasons: ['VLM sees data-bearing content'],
    });
    expect(LLMCaller.callVision).toHaveBeenCalledTimes(1);
  });

  test('reuses an existing page gate sidecar without re-evaluating eligibility', async () => {
    writeFileSync(
      join(outputDir, 'review_assistance_page_gate.json'),
      JSON.stringify({
        schemaName: 'HeripoReviewAssistancePageGateReport',
        version: '1.0',
        pages: [
          {
            pageNo: 1,
            eligible: true,
            kind: 'archaeological_data',
            score: 88,
            reasons: ['data table and caption visible'],
            exclusionReasons: [],
          },
        ],
      }),
    );

    const report = await new ReviewAssistanceRunner(
      makeLogger(),
    ).analyzeAndSave(outputDir, 'report-1', makeModelResolver(), makeOptions());

    const components = vi
      .mocked(LLMCaller.callVision)
      .mock.calls.map(([input]) => input.component);
    expect(components).not.toContain('ReviewAssistancePageGate');
    expect(components).toContain('ReviewAssistance');
    expect(report.summary.pagesSucceeded).toBe(1);
    expect(report.pages[0].status).toBe('succeeded');
  });

  test('reuses a page-image-unavailable gate sidecar without structural model calls', async () => {
    rmSync(join(outputDir, 'pages', 'page_0.png'), { force: true });
    writeFileSync(
      join(outputDir, 'review_assistance_page_gate.json'),
      JSON.stringify({
        schemaName: 'HeripoReviewAssistancePageGateReport',
        version: '1.0',
        pages: [
          {
            pageNo: 1,
            eligible: true,
            kind: 'archaeological_data',
            score: 100,
            reasons: ['page_gate_failed_open', 'page_image_not_available'],
            exclusionReasons: [],
          },
        ],
      }),
    );

    const report = await new ReviewAssistanceRunner(
      makeLogger(),
    ).analyzeAndSave(outputDir, 'report-1', makeModelResolver(), makeOptions());

    expect(LLMCaller.callVision).not.toHaveBeenCalled();
    expect(report.summary.pagesSucceeded).toBe(1);
    expect(report.summary.pagesFailed).toBe(0);
    expect(report.pages[0]).toMatchObject({
      status: 'succeeded',
      decisions: [],
      issues: expect.arrayContaining([
        expect.objectContaining({
          category: 'review_execution',
          type: 'page_image_not_available',
          severity: 'warning',
          reasons: expect.arrayContaining(['page_image_not_available']),
        }),
      ]),
    });
  });

  test('extracts text reference when pdfPath is provided', async () => {
    await new ReviewAssistanceRunner({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }).analyzeAndSave(outputDir, 'report-1', makeModelResolver(), {
      ...makeOptions(),
      pdfPath: '/tmp/input.pdf',
    });

    expect(mockExtractText).toHaveBeenCalledWith('/tmp/input.pdf', 1);
  });

  test('같은 ref 충돌은 LLM 머지 호출로 단일 winner 로 수렴된다', async () => {
    const doc = makeDoc();
    doc.texts[0].prov[0].bbox = {
      l: 10,
      t: 10,
      r: 150,
      b: 40,
      coord_origin: 'TOPLEFT',
    };
    writeFileSync(join(outputDir, 'result.json'), JSON.stringify(doc));

    let mergeCalls = 0;
    vi.mocked(LLMCaller.callVision).mockImplementation(async (input: any) => {
      if (input.component === 'ReviewAssistancePageGate') {
        return makeGateResult();
      }
      if (input.phase === 'merge-conflicts') {
        mergeCalls += 1;
        return {
          output: {
            decision: 'pick' as const,
            chosenIndex: 0,
            confidence: 0.9,
            rationale: 'OCR replacement aligns with image text',
          },
          usage,
          usedFallback: false,
        };
      }
      const task = input.metadata.task;
      if (task === 'text_ocr_hanja') {
        return {
          output: {
            pageNo: 1,
            commands: [
              {
                op: 'replaceText',
                textRef: '#/texts/0',
                text: 'Test',
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
                bbox: { l: 12, t: 12, r: 82, b: 42 },
                confidence: 0.94,
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
    }).analyzeAndSave(outputDir, 'report-1', makeModelResolver(), {
      ...makeOptions(),
    });

    expect(mergeCalls).toBe(1);
    expect(report.pages[0].decisions).toHaveLength(1);
    const winner = report.pages[0].decisions[0];
    expect(winner.metadata).toMatchObject({
      mergeChosen: expect.objectContaining({
        method: 'llm',
        groupSize: 2,
        droppedDecisionIds: expect.any(Array),
      }),
    });
    expect(winner.reasons).toEqual(
      expect.arrayContaining(['merge_chosen_by:llm']),
    );
    expect(winner.reasons).not.toEqual(
      expect.arrayContaining(['task_conflict_same_target_ref']),
    );
  });

  test('confidence gap > 0.3 면 LLM 호출 없이 결정론적으로 winner 를 선택한다', async () => {
    const doc = makeDoc();
    doc.texts[0].prov[0].bbox = {
      l: 10,
      t: 10,
      r: 150,
      b: 40,
      coord_origin: 'TOPLEFT',
    };
    writeFileSync(join(outputDir, 'result.json'), JSON.stringify(doc));

    let mergeCalls = 0;
    vi.mocked(LLMCaller.callVision).mockImplementation(async (input: any) => {
      if (input.component === 'ReviewAssistancePageGate') {
        return makeGateResult();
      }
      if (input.phase === 'merge-conflicts') {
        mergeCalls += 1;
        return {
          output: {
            decision: 'pick' as const,
            chosenIndex: 0,
            confidence: 0.5,
            rationale: 'unused',
          },
          usage,
          usedFallback: false,
        };
      }
      const task = input.metadata.task;
      if (task === 'text_ocr_hanja') {
        return {
          output: {
            pageNo: 1,
            commands: [
              {
                op: 'replaceText',
                textRef: '#/texts/0',
                text: 'Test',
                confidence: 0.95,
                rationale: 'High confidence OCR',
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
                bbox: { l: 12, t: 12, r: 82, b: 42 },
                confidence: 0.5,
                rationale: 'Low confidence bbox shift',
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
    }).analyzeAndSave(outputDir, 'report-1', makeModelResolver(), {
      ...makeOptions(),
    });

    expect(mergeCalls).toBe(0);
    expect(report.pages[0].decisions).toHaveLength(1);
    expect(report.pages[0].decisions[0].metadata).toMatchObject({
      mergeChosen: expect.objectContaining({ method: 'deterministic_gap' }),
    });
  });

  test('머지 LLM 이 drop 을 반환하면 그룹 전체가 결정에서 제거된다', async () => {
    const doc = makeDoc();
    doc.texts[0].prov[0].bbox = {
      l: 10,
      t: 10,
      r: 150,
      b: 40,
      coord_origin: 'TOPLEFT',
    };
    writeFileSync(join(outputDir, 'result.json'), JSON.stringify(doc));

    vi.mocked(LLMCaller.callVision).mockImplementation(async (input: any) => {
      if (input.component === 'ReviewAssistancePageGate') {
        return makeGateResult();
      }
      if (input.phase === 'merge-conflicts') {
        return {
          output: {
            decision: 'drop' as const,
            rationale: 'Both candidates would degrade the page',
          },
          usage,
          usedFallback: false,
        };
      }
      const task = input.metadata.task;
      if (task === 'text_ocr_hanja') {
        return {
          output: {
            pageNo: 1,
            commands: [
              {
                op: 'replaceText',
                textRef: '#/texts/0',
                text: 'Test',
                confidence: 0.7,
                rationale: 'Mid confidence OCR',
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
                bbox: { l: 12, t: 12, r: 82, b: 42 },
                confidence: 0.7,
                rationale: 'Mid confidence bbox shift',
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
    }).analyzeAndSave(outputDir, 'report-1', makeModelResolver(), {
      ...makeOptions(),
    });

    expect(report.pages[0].decisions).toHaveLength(1);
    const audited = report.pages[0].decisions[0];
    expect(audited.disposition).toBe('skipped');
    expect(audited.reasons).toEqual(
      expect.arrayContaining(['merge_dropped_all']),
    );
    expect(audited.metadata).toMatchObject({
      mergeDropped: expect.objectContaining({
        method: 'llm',
        groupSize: 2,
      }),
    });
  });

  test('머지 pick 인데 chosenIndex 가 누락되면 top-1 로 폴백한다', async () => {
    const doc = makeDoc();
    doc.texts[0].prov[0].bbox = {
      l: 10,
      t: 10,
      r: 150,
      b: 40,
      coord_origin: 'TOPLEFT',
    };
    writeFileSync(join(outputDir, 'result.json'), JSON.stringify(doc));

    vi.mocked(LLMCaller.callVision).mockImplementation(async (input: any) => {
      if (input.component === 'ReviewAssistancePageGate') {
        return makeGateResult();
      }
      if (input.phase === 'merge-conflicts') {
        // flat schema: pick with no chosenIndex (model omitted it)
        return {
          output: { decision: 'pick', rationale: '인덱스 누락' },
          usage,
          usedFallback: false,
        };
      }
      const task = input.metadata.task;
      if (task === 'text_ocr_hanja') {
        return {
          output: {
            pageNo: 1,
            commands: [
              {
                op: 'replaceText',
                textRef: '#/texts/0',
                text: 'Test',
                confidence: 0.8,
                rationale: 'OCR',
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
                bbox: { l: 12, t: 12, r: 82, b: 42 },
                confidence: 0.75,
                rationale: 'bbox',
                evidence: 'shift',
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
    }).analyzeAndSave(outputDir, 'report-1', makeModelResolver(), {
      ...makeOptions(),
    });

    expect(report.pages[0].decisions).toHaveLength(1);
    expect(report.pages[0].decisions[0].metadata).toMatchObject({
      mergeChosen: expect.objectContaining({ method: 'llm_fallback' }),
    });
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
    vi.mocked(LLMCaller.callVision).mockImplementation(async (input: any) => {
      if (input.component === 'ReviewAssistancePageGate') {
        return makeGateResult();
      }
      return makeReviewResult();
    });

    await new ReviewAssistanceRunner({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }).analyzeAndSave(outputDir, 'report-1', makeModelResolver(), {
      ...makeOptions(),
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
      makeModelResolver(),
      {
        ...makeOptions(),
        pdfPath: '/tmp/input.pdf',
      },
    );

    expect(report.summary.pagesSucceeded).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[PdfTextExtractor] pdftotext extraction failed, proceeding without text reference',
      expect.any(Error),
    );
  });

  test('re-evaluates page gates when the existing gate sidecar is malformed', async () => {
    const logger = makeLogger();
    writeFileSync(
      join(outputDir, 'review_assistance_page_gate.json'),
      '{not-json',
    );

    const report = await new ReviewAssistanceRunner(logger).analyzeAndSave(
      outputDir,
      'report-1',
      makeModelResolver(),
      makeOptions(),
    );

    const components = vi
      .mocked(LLMCaller.callVision)
      .mock.calls.map(([input]) => input.component);
    expect(components).toContain('ReviewAssistancePageGate');
    expect(report.pages[0].status).toBe('succeeded');
    expect(logger.warn).toHaveBeenCalledWith(
      '[ReviewAssistanceRunner] Failed to read page gate report, re-evaluating pages',
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
      makeModelResolver(),
      {
        ...makeOptions(),
      },
    );

    expect(report.summary.pagesFailed).toBe(1);
    expect(report.pages[0].error?.message).toContain('vlm failed');
    expect(logger.warn).toHaveBeenCalledWith(
      '[ReviewAssistanceRunner] Page 1/1: all review work items failed',
      {
        err: expect.objectContaining({
          type: 'ReviewAssistanceTaskFailure',
          message: expect.stringContaining('vlm failed'),
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
    }).analyzeAndSave(outputDir, 'report-1', makeModelResolver(), {
      ...makeOptions(),
    });

    expect(report.pages[0].error?.message).toContain('model failed');
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
      makeModelResolver(),
      {
        ...makeOptions(),
      },
    );

    expect(report.pages[0].error?.message).toContain(
      'Headers Timeout [redacted-large-data]',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '[ReviewAssistanceRunner] Page 1/1: page-1:text_ocr_hanja',
      ),
      {
        err: expect.objectContaining({
          message: 'Headers Timeout [redacted-large-data]',
          stack: expect.not.stringContaining(base64Like),
        }),
      },
    );
  });

  test('treats no structured output as no-op review result with info hint', async () => {
    vi.mocked(LLMCaller.callVision).mockImplementation(async (input: any) => {
      if (input.component === 'ReviewAssistancePageGate') {
        return makeGateResult();
      }
      throw new Error('No object generated: response did not match schema.');
    });
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const report = await new ReviewAssistanceRunner(logger).analyzeAndSave(
      outputDir,
      'report-1',
      makeModelResolver(),
      {
        ...makeOptions(),
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
          severity: 'info',
          reasons: expect.arrayContaining(['no_output_generated']),
        }),
      ]),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'work item produced no structured output; recording no-op result',
      ),
      {
        err: expect.objectContaining({
          type: 'Error',
          message: 'No object generated: response did not match schema.',
        }),
      },
    );
  });

  test('한자 후보와 이미지 내부 텍스트 후보는 별도 확인 이슈로 남기지 않는다', () => {
    const context: PageReviewContext = {
      pageNo: 1,
      reviewAssistanceEligibility: {
        pageNo: 1,
        eligible: true,
        kind: 'archaeological_data',
        score: 50,
        reasons: ['domain_pattern_present'],
        exclusionReasons: [],
      },
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
      }).analyzeAndSave(outputDir, 'report-1', makeModelResolver(), {
        ...makeOptions(),
        abortSignal: abortController.signal,
      }),
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
    vi.mocked(LLMCaller.callVision).mockImplementation(async (input: any) => {
      if (input.component === 'ReviewAssistancePageGate') {
        return makeGateResult();
      }
      return makeReviewResult();
    });

    const report = await new ReviewAssistanceRunner({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }).analyzeAndSave(outputDir, 'report-1', makeModelResolver(), {
      ...makeOptions(),
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
    noOutputRunner.reviewWorkItem = vi
      .fn()
      .mockRejectedValue(new Error('No output generated.'));

    const noOutputResult = (await noOutputRunner.reviewPage(
      makePageContext(pagePath),
      'report-1',
      makeModelResolver(),
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
      makeModelResolver(),
      makeOptions(),
      1,
    )) as ReviewAssistancePageResult;

    expect(genericFailure.status).toBe('failed');
    expect(genericFailure.error?.message).toContain('ENOENT');
    expect(genericLogger.warn).toHaveBeenCalledWith(
      '[ReviewAssistanceRunner] Page 1/1: review failed',
      expect.any(Object),
    );

    const abortLogger = makeLogger();
    const abortRunner = new ReviewAssistanceRunner(abortLogger) as any;
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      abortRunner.reviewPage(
        makePageContext(join(outputDir, 'pages', 'missing.png')),
        'report-1',
        makeModelResolver(),
        {
          ...makeOptions(),
          abortSignal: abortController.signal,
        },
        1,
      ),
    ).rejects.toThrow('ENOENT');

    const failedTasksLogger = makeLogger();
    const failedTasksRunner = new ReviewAssistanceRunner(
      failedTasksLogger,
    ) as any;
    failedTasksRunner.reviewWorkItem = vi.fn(async (_context, workItem) => ({
      workItem,
      status: 'failed',
      decisions: [],
      callTrace: {
        workItemId: workItem.id,
        kind: workItem.kind,
        pageNo: 1,
        targetRefs: workItem.targetRefs,
        attempts: 1,
        startedAt: '2026-01-01T00:00:00.000Z',
        durationMs: 1,
        validation: 'failed',
      },
    }));

    const failedTasksResult = (await failedTasksRunner.reviewPage(
      makePageContext(pagePath),
      'report-1',
      makeModelResolver(),
      makeOptions(),
      1,
      ReviewAssistanceCheckpointStore.open(outputDir, 'report-1'),
    )) as ReviewAssistancePageResult;

    expect(failedTasksResult.status).toBe('failed');
    expect(failedTasksResult.error?.message).toContain(': failed');
    expect(failedTasksResult.issues.every((issue) => issue.type !== '')).toBe(
      true,
    );

    const abortTaskRunner = new ReviewAssistanceRunner(makeLogger()) as any;
    const abortTaskController = new AbortController();
    abortTaskController.abort();
    vi.mocked(LLMCaller.callVision).mockRejectedValue(
      new Error('task aborted'),
    );

    await expect(
      abortTaskRunner.reviewWorkItem(
        makePageContext(pagePath),
        {
          id: 'work-item',
          kind: 'text_ocr_hanja',
          pageNo: 1,
          targetRefs: ['#/texts/0'],
          priority: 'required',
          contextBudget: 'tiny',
          eligibility: makePageContext(pagePath).reviewAssistanceEligibility,
          task: {
            id: 'text_ocr_hanja',
            label: 'Text OCR and Hanja correction',
            allowedOps: ['replaceText'],
            focus: 'Abort branch coverage',
          },
        },
        new Uint8Array([1]),
        1,
        makeModelResolver(),
        {
          ...makeOptions(),
          abortSignal: abortTaskController.signal,
        },
      ),
    ).rejects.toThrow('task aborted');
  });

  test('resumes page review from completed work item checkpoint', async () => {
    const pagePath = join(outputDir, 'pages', 'page_0.png');
    const context = makePageContext(pagePath);
    const checkpointStore = ReviewAssistanceCheckpointStore.open(
      outputDir,
      'report-1',
    );
    const workItems = new ReviewAssistanceWorkScheduler().build(context);
    const page: ReviewAssistancePageResult = {
      pageNo: 1,
      status: 'succeeded',
      decisions: [
        makeDecision('checkpoint-decision', {
          op: 'replaceText',
          textRef: '#/texts/0',
          text: 'Checkpoint',
        }),
      ],
      issues: [],
    };
    for (const [index, workItem] of workItems.entries()) {
      checkpointStore.recordWorkItem({
        workItemId: workItem.id,
        page,
        trace: {
          workItemId: workItem.id,
          kind: workItem.kind,
          pageNo: 1,
          targetRefs: workItem.targetRefs,
          attempts: 1,
          startedAt: '2026-01-01T00:00:00.000Z',
          durationMs: 1,
          validation: 'passed',
        },
        failed:
          index === 0
            ? { reason: 'previous validation failed', attempts: 2 }
            : undefined,
      });
    }

    const result = (await (
      new ReviewAssistanceRunner(makeLogger()) as any
    ).reviewPage(
      context,
      'report-1',
      makeModelResolver(),
      makeOptions(),
      1,
      checkpointStore,
      [],
    )) as ReviewAssistancePageResult;

    expect(result.decisions[0].id).toBe('checkpoint-decision');
    expect(LLMCaller.callVision).not.toHaveBeenCalledWith(
      expect.objectContaining({ component: 'ReviewAssistance' }),
    );
  });

  test('returns a no-op page result when scheduling finds no work items', async () => {
    const pagePath = join(outputDir, 'pages', 'page_0.png');
    const context: PageReviewContext = {
      ...makePageContext(pagePath),
      textBlocks: [],
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
      domainPatterns: [],
    };

    const result = (await (
      new ReviewAssistanceRunner(makeLogger()) as any
    ).reviewPage(
      context,
      'report-1',
      makeModelResolver(),
      makeOptions(),
      1,
    )) as ReviewAssistancePageResult;

    expect(result).toMatchObject({
      pageNo: 1,
      status: 'succeeded',
      decisions: [],
      issues: [],
    });
  });

  test('re-asks and then records validation failure for invalid work item output', async () => {
    const pagePath = join(outputDir, 'pages', 'page_0.png');
    const context = makePageContext(pagePath);
    const workItem = new ReviewAssistanceWorkScheduler()
      .build(context)
      .find((item) => item.kind === 'text_ocr_hanja')!;
    vi.mocked(LLMCaller.callVision).mockResolvedValue(
      makeReviewResult([
        {
          op: 'replaceText',
          targetRef: '#/texts/missing',
          payload: { text: 'Missing' },
          confidence: 0.95,
          rationale: 'Invalid target',
          evidence: 'Missing',
        },
      ]),
    );

    const result = await (
      new ReviewAssistanceRunner(makeLogger()) as any
    ).reviewWorkItem(
      context,
      workItem,
      new Uint8Array([1]),
      1,
      makeModelResolver(),
      {
        ...makeOptions(),
        maxRetries: 2,
      },
    );

    expect(result.status).toBe('failed');
    expect(result.issue).toMatchObject({
      type: 'work_item_validation_failed',
      reasons: expect.arrayContaining(['target_ref_not_found']),
    });
    expect(result.callTrace).toMatchObject({
      attempts: 2,
      validation: 'failed',
      failureReasons: expect.arrayContaining(['target_ref_not_found']),
    });
    expect(LLMCaller.callVision).toHaveBeenCalledTimes(2);
  });

  test('records reasked validation when a later work item attempt passes', async () => {
    const pagePath = join(outputDir, 'pages', 'page_0.png');
    const context = makePageContext(pagePath);
    const workItem = new ReviewAssistanceWorkScheduler()
      .build(context)
      .find((item) => item.kind === 'text_ocr_hanja')!;
    vi.mocked(LLMCaller.callVision)
      .mockResolvedValueOnce(
        makeReviewResult([
          {
            op: 'replaceText',
            targetRef: '#/texts/missing',
            payload: { text: 'Missing' },
            confidence: 0.95,
            rationale: 'Invalid target',
            evidence: 'Missing',
          },
        ]),
      )
      .mockResolvedValueOnce(
        makeReviewResult([
          {
            op: 'replaceText',
            targetRef: '#/texts/0',
            payload: { text: 'Test' },
            confidence: 0.95,
            rationale: 'Valid target after re-ask',
            evidence: 'Test',
          },
        ]),
      );

    const result = await (
      new ReviewAssistanceRunner(makeLogger()) as any
    ).reviewWorkItem(
      context,
      workItem,
      new Uint8Array([1]),
      1,
      makeModelResolver(),
      {
        ...makeOptions(),
        maxRetries: 2,
      },
    );

    expect(result.status).toBe('succeeded');
    expect(result.callTrace).toMatchObject({
      attempts: 2,
      validation: 'reasked',
      failureReasons: ['target_ref_not_found'],
    });
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

    const existingKeepsDuplicate = runner.mergeTaskDecisions([
      makeDecision('existing-high', mergeCommand, {
        confidence: 0.9,
        metadata: { reviewTask: 'text_integrity' },
      }),
      makeDecision('duplicate-low', mergeCommand, {
        confidence: 0.2,
        metadata: { reviewTask: 'layout_bbox_order' },
      }),
    ]) as ReviewAssistanceDecision[];
    expect(existingKeepsDuplicate[0]).toMatchObject({
      id: 'existing-high',
      confidence: 0.9,
    });
    expect(
      runner.markTaskConflict(
        makeDecision('proposal', mergeCommand, { disposition: 'proposal' }),
        ['other'],
      ).disposition,
    ).toBe('proposal');

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

  test('adds split candidates only for pictures with supported detector evidence', async () => {
    const detectorSpy = vi
      .spyOn(PictureSplitCandidateDetector.prototype, 'detect')
      .mockResolvedValueOnce({
        score: 0.9,
        orientation: 'vertical',
        reasons: ['vertical_gutter_with_content_on_both_sides'],
      });
    const runner = new ReviewAssistanceRunner(makeLogger()) as unknown as {
      addPictureSplitCandidates: (
        contexts: PageReviewContext[],
        concurrency: number,
      ) => Promise<PageReviewContext[]>;
    };

    const [context] = await runner.addPictureSplitCandidates(
      [makePageContext('/tmp/page_0.png')],
      1,
    );

    expect(detectorSpy).toHaveBeenCalledWith({
      pageImagePath: '/tmp/page_0.png',
      pageSize: { width: 100, height: 100 },
      pictureBbox: reviewBBox,
    });
    expect(context.pictures[0].splitCandidate).toMatchObject({
      orientation: 'vertical',
      score: 0.9,
    });
    expect(context.pictures[0].suspectReasons).toContain(
      'picture_split_boundary_candidate',
    );
    detectorSpy.mockRestore();
  });

  test('keeps pictures without bbox out of split candidate detection', async () => {
    const detectorSpy = vi.spyOn(
      PictureSplitCandidateDetector.prototype,
      'detect',
    );
    const runner = new ReviewAssistanceRunner(makeLogger()) as unknown as {
      addPictureSplitCandidates: (
        contexts: PageReviewContext[],
        concurrency: number,
      ) => Promise<PageReviewContext[]>;
    };
    const context = makePageContext('/tmp/page_0.png');
    context.pictures[0].bbox = undefined;

    const [result] = await runner.addPictureSplitCandidates([context], 1);

    expect(detectorSpy).not.toHaveBeenCalled();
    expect(result.pictures[0].splitCandidate).toBeUndefined();
    detectorSpy.mockRestore();
  });

  test('covers runner issue and error helper branches', async () => {
    const runner = new ReviewAssistanceRunner(makeLogger()) as any;
    const context = makePageContext('/tmp/page_0.png');
    const workItem = {
      id: 'work-item',
      kind: 'text_ocr_hanja',
      pageNo: 1,
      targetRefs: ['#/texts/0'],
      priority: 'required',
      contextBudget: 'tiny',
      eligibility: context.reviewAssistanceEligibility,
      task: {
        id: 'text_ocr_hanja',
        label: 'Text OCR',
        allowedOps: ['replaceText'],
        focus: 'Text OCR',
      },
    };
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
      'picture_split_boundary_candidate',
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
    expect(runner.buildNoOutputIssue(context).severity).toBe('warning');
    expect(runner.buildNoOutputIssue(context, undefined, 'info').severity).toBe(
      'info',
    );
    expect(
      runner.isNoOutputGeneratedError({
        name: 'NoOutputGeneratedError',
      }),
    ).toBe(true);
    expect(
      runner.isNoOutputGeneratedError({
        name: 'AI_NoObjectGeneratedError',
      }),
    ).toBe(true);
    expect(
      runner.isNoOutputGeneratedError(
        new Error('No object generated: response did not match schema.'),
      ),
    ).toBe(true);
    expect(
      runner.isNoOutputGeneratedError(new Error('No output generated.')),
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

    const taskIssue = runner.buildWorkItemFailureIssue(
      context,
      workItem,
      'plain failure',
    ) as ReviewAssistanceIssue;
    expect(taskIssue.reasons).toEqual([
      'review_task:text_ocr_hanja',
      'review_work_item:work-item',
      'review_work_item_kind:text_ocr_hanja',
      'plain failure',
    ]);
    expect(
      runner.buildWorkItemValidationIssue(context, workItem, [
        'target_ref_not_found',
      ]),
    ).toMatchObject({
      type: 'work_item_validation_failed',
      reasons: expect.arrayContaining(['target_ref_not_found']),
    });

    const traces = [
      {
        workItemId: 'work-item',
        kind: 'text_ocr_hanja',
        pageNo: 1,
        targetRefs: ['#/texts/0'],
        attempts: 1,
        startedAt: '2026-01-01T00:00:00.000Z',
        durationMs: 1,
        validation: 'passed',
      },
    ];
    runner.upsertCallTrace(traces, { ...traces[0], durationMs: 2 });
    expect(traces[0].durationMs).toBe(2);
    expect(runner.getModelId({ id: 'fallback-id' })).toBe('fallback-id');
    expect(runner.getModelId({ modelId: 123 })).toBeUndefined();
    expect(
      runner.dedupeIssues([
        {
          id: 'issue-1',
          pageNo: 1,
          category: 'text',
          type: 'a',
          severity: 'warning',
          description: 'a',
        },
        {
          id: 'issue-1',
          pageNo: 1,
          category: 'text',
          type: 'a',
          severity: 'warning',
          description: 'a',
        },
      ]),
    ).toHaveLength(1);

    vi.useFakeTimers();
    try {
      const timeout = runner.withWorkItemTimeout(
        new Promise(() => undefined),
        5,
        workItem,
      );
      const timeoutAssertion = expect(timeout).rejects.toThrow(
        'Review assistance work item timeout after 5ms: work-item',
      );
      await vi.advanceTimersByTimeAsync(5);
      await timeoutAssertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
