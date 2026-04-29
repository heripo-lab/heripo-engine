import type { DoclingDocument } from '@heripo/model';

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
      aggregator,
      onTokenUsage,
      onProgress,
      pageTexts: new Map([[1, 'Test\n\nMissing line']]),
    });

    expect(report.summary).toMatchObject({
      pageCount: 1,
      pagesSucceeded: 1,
      autoAppliedCount: 1,
      proposalCount: 0,
      skippedCount: 0,
    });
    expect(LLMCaller.callVision).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'ReviewAssistance',
        phase: 'page-review',
        metadata: { pageNo: 1 },
      }),
    );
    expect(onTokenUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        total: expect.objectContaining({ totalTokens: 15 }),
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
      pdfPath: '/tmp/input.pdf',
    });

    expect(mockExtractText).toHaveBeenCalledWith('/tmp/input.pdf', 1);
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
    });

    expect(report.summary.pagesFailed).toBe(1);
    expect(report.pages[0].error?.message).toBe('vlm failed');
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
    });

    expect(report.pages[0].error?.message).toBe('model failed');
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
    });
    const categories = report.pages.flatMap((page) =>
      page.issues.map((issue) => issue.category),
    );

    expect(categories).toEqual(
      expect.arrayContaining([
        'caption',
        'footnote',
        'role',
        'text_integrity',
        'picture',
        'table',
        'bbox',
        'domain_pattern',
      ]),
    );
  });
});
