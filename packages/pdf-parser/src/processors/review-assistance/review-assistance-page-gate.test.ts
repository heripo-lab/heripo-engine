import { LLMCaller } from '@heripo/shared';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  ReviewAssistancePageGate,
  type ReviewAssistancePageGateContext,
  createReviewAssistancePageGateFailOpenEligibility,
  createReviewAssistancePageGatePendingEligibility,
  isReviewAssistancePageGatePending,
  readReviewAssistancePageGateReport,
  writeReviewAssistancePageGateReport,
} from './review-assistance-page-gate';

vi.mock('@heripo/shared', () => ({
  LLMCaller: { callVision: vi.fn() },
}));

const usage = {
  component: 'ReviewAssistancePageGate',
  phase: 'page-eligibility',
  model: 'primary' as const,
  modelName: 'mock-model',
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
};

function makeContext(
  overrides: Partial<ReviewAssistancePageGateContext> = {},
): ReviewAssistancePageGateContext {
  return {
    pageNo: 1,
    textBlocks: [
      {
        label: 'text',
        text: 'Informe de excavación con tabla y lámina',
        suspectReasons: ['ocr_noise'],
      },
    ],
    missingTextCandidates: [],
    tables: [{ suspectReasons: ['table_many_empty_cells'] }],
    pictures: [{ caption: 'Lámina 1', suspectReasons: [] }],
    orphanCaptions: [],
    layout: { bboxWarnings: [] },
    domainPatterns: [],
    ...overrides,
  };
}

describe('ReviewAssistancePageGate', () => {
  let outputDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    outputDir = mkdtempSync(join(tmpdir(), 'review-page-gate-'));
    vi.mocked(LLMCaller.callVision).mockResolvedValue({
      output: {
        eligible: true,
        kind: 'archaeological_data',
        score: 88,
        reasons: ['data table and caption visible'],
        exclusionReasons: ['ignored when eligible'],
      },
      usage,
      usedFallback: false,
    });
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  test('asks the VLM for language-independent page eligibility', async () => {
    const aggregator = { track: vi.fn() };

    const eligibility = await new ReviewAssistancePageGate().evaluate(
      makeContext(),
      new Uint8Array([1, 2, 3]),
      { modelId: 'mock-model' } as any,
      {
        maxRetries: 4,
        temperature: 0.1,
        aggregator: aggregator as any,
        outputLanguage: 'ko-KR',
      },
    );

    expect(eligibility).toEqual({
      pageNo: 1,
      eligible: true,
      kind: 'archaeological_data',
      score: 88,
      reasons: ['data table and caption visible'],
      exclusionReasons: [],
    });
    expect(LLMCaller.callVision).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryModel: { modelId: 'mock-model' },
        maxRetries: 4,
        temperature: 0.1,
        component: 'ReviewAssistancePageGate',
        phase: 'page-eligibility',
        metadata: { pageNo: 1 },
      }),
    );
    const prompt = (
      vi.mocked(LLMCaller.callVision).mock.calls[0][0].messages[0]
        .content as any[]
    ).find((entry: any) => entry.type === 'text').text as string;
    expect(prompt).toContain('Reports may be in any language');
    expect(prompt).toContain('Do not use locale');
    expect(prompt).toContain('Informe de excavación');
    expect(prompt).toContain('Write reasons and exclusionReasons in ko-KR');
    expect(aggregator.track).toHaveBeenCalledWith(usage);
  });

  test('normalizes inconsistent eligible non-meaningful output', async () => {
    vi.mocked(LLMCaller.callVision).mockResolvedValue({
      output: {
        eligible: true,
        kind: 'non_meaningful',
        score: 55.4,
        reasons: ['uncertain page'],
        exclusionReasons: ['not used'],
      },
      usage,
      usedFallback: false,
    });

    const eligibility = await new ReviewAssistancePageGate().evaluate(
      makeContext(),
      new Uint8Array([1]),
      { modelId: 'mock-model' } as any,
    );

    expect(eligibility).toMatchObject({
      eligible: true,
      kind: 'archaeological_data',
      score: 55,
      exclusionReasons: [],
    });
  });

  test('truncates long text blocks in the page gate prompt', async () => {
    const longText = `${'A'.repeat(1_900)}TAIL`;

    await new ReviewAssistancePageGate().evaluate(
      makeContext({
        textBlocks: [
          {
            label: 'text',
            text: longText,
            suspectReasons: [],
          },
        ],
      }),
      new Uint8Array([1]),
      { modelId: 'mock-model' } as any,
    );

    const prompt = (
      vi.mocked(LLMCaller.callVision).mock.calls[0][0].messages[0]
        .content as any[]
    ).find((entry: any) => entry.type === 'text').text as string;
    expect(prompt).toContain('A'.repeat(1_800));
    expect(prompt).not.toContain('TAIL');
  });

  test('keeps VLM skip reasons for non-meaningful pages', async () => {
    vi.mocked(LLMCaller.callVision).mockResolvedValue({
      output: {
        eligible: false,
        kind: 'toc',
        score: 12,
        reasons: ['cover only'],
        exclusionReasons: ['cover page without body structure'],
      },
      usage,
      usedFallback: false,
    });

    const eligibility = await new ReviewAssistancePageGate().evaluate(
      makeContext({ textBlocks: [] }),
      new Uint8Array([1]),
      { modelId: 'mock-model' } as any,
    );

    expect(eligibility).toEqual({
      pageNo: 1,
      eligible: false,
      kind: 'non_meaningful',
      score: 12,
      reasons: ['cover only'],
      exclusionReasons: ['cover page without body structure'],
    });
  });

  test('creates pending and fail-open eligibility records', () => {
    expect(isReviewAssistancePageGatePending({} as any)).toBe(false);
    expect(
      isReviewAssistancePageGatePending(
        createReviewAssistancePageGatePendingEligibility(3),
      ),
    ).toBe(true);
    expect(createReviewAssistancePageGateFailOpenEligibility(4, 'timeout'))
      .toMatchInlineSnapshot(`
        {
          "eligible": true,
          "exclusionReasons": [],
          "kind": "archaeological_data",
          "pageNo": 4,
          "reasons": [
            "page_gate_failed_open",
            "timeout",
          ],
          "score": 100,
        }
      `);
  });

  test('writes and reads page gate reports', () => {
    const pages = [
      createReviewAssistancePageGateFailOpenEligibility(2, 'timeout'),
      {
        pageNo: 1,
        eligible: false,
        kind: 'non_meaningful' as const,
        score: 20,
        reasons: ['cover'],
        exclusionReasons: ['cover page'],
      },
    ];

    writeReviewAssistancePageGateReport(outputDir, pages);

    const raw = JSON.parse(
      readFileSync(
        join(outputDir, 'review_assistance_page_gate.json'),
        'utf-8',
      ),
    );
    expect(raw.pages.map((page: { pageNo: number }) => page.pageNo)).toEqual([
      1, 2,
    ]);
    expect(readReviewAssistancePageGateReport(outputDir)?.get(2)).toMatchObject(
      {
        pageNo: 2,
        eligible: true,
      },
    );
  });

  test('returns undefined when no page gate report exists', () => {
    expect(readReviewAssistancePageGateReport(outputDir)).toBeUndefined();
  });

  test('propagates malformed page gate reports to callers', () => {
    writeFileSync(
      join(outputDir, 'review_assistance_page_gate.json'),
      '{not-json',
    );

    expect(() => readReviewAssistancePageGateReport(outputDir)).toThrow();
  });
});
