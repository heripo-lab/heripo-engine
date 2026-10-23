import type { ProcessedDocument } from '@heripo/model';
import type * as Shared from '@heripo/shared';
import type * as Ai from 'ai';

import type { DocumentResource } from '../../resources/document-resource-index';
import type { AttachmentUnit, ContentAttachmentPlan } from '../types';

import { createAuditedModel } from '@heripo/shared';
import { generateText } from 'ai';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { buildDocumentResourceIndex } from '../../resources/document-resource-index';
import { createContentAttachmentThinInput } from './compile';
import { createContentAttachmentThinRequest } from './prompt';
import { attachContentThinUnit } from './run';

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof Ai>()),
  generateText: vi.fn(),
}));
vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

const SEGMENTS = ['E1:S1', 'E2:S1', 'E3:S1', 'E4:S1'];
const model = { modelId: 'mock' } as unknown as Ai.LanguageModel;

function fixture(
  texts = ['수혈 1호 조사.', '날씨 맑음.', '도면 작성.', '사진 촬영.'],
) {
  const document: ProcessedDocument = {
    reportId: 'report',
    pageRangeMap: {},
    images: [],
    footnotes: [],
    tables: [],
    chapters: [
      {
        id: 'c',
        title: '조사',
        originTitle: '조사',
        level: 1,
        pageNo: 1,
        imageIds: [],
        footnoteIds: [],
        tableIds: [],
        textBlocks: texts.map((text, i) => ({
          id: `b${i}`,
          pdfPageNo: 1,
          text,
        })),
      },
    ],
  };
  const sources = buildDocumentResourceIndex(document)
    .resources.filter(
      (r): r is Extract<DocumentResource, { kind: 'text' }> =>
        r.kind === 'text',
    )
    .map((resource) => ({ sourceId: `s:${resource.key}`, resource }));
  const unit: AttachmentUnit = {
    unitId: 'page-1',
    pdfPageNo: 1,
    sources,
    chapters: [],
    tables: [],
    readOnlyContext: [],
  };
  const plan: ContentAttachmentPlan = {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: 'input',
    candidateSnapshotId: 'snapshot',
    registrySha256: 'registry',
    registryUncertainties: [],
    registry: [
      {
        ref: 'R1',
        groupId: 'g1',
        recordKind: 'feature',
        mentions: [
          {
            candidateId: 'c1',
            sourceName: '수혈',
            sourceIdentifier: '1호',
            chapterPath: [],
            evidence: [],
          },
        ],
      },
    ],
    pages: [],
    units: [unit],
  };
  return { plan, unit };
}

const none = { k: 'n' };
const attachR1 = {
  k: 'a',
  r: ['R1'],
  h: [],
  x: [],
  ia: [],
  sa: [],
  e: ['Q1:L1-L2'],
};
const items = (d: Record<string, object>) => ({
  d: Object.entries(d).map(([s, decision]) => ({ s, ...decision })),
});
const agreed = () =>
  items({ 'E1:S1': attachR1, 'E2:S1': none, 'E3:S1': none, 'E4:S1': none });
const outlier = () =>
  items({ 'E1:S1': none, 'E2:S1': attachR1, 'E3:S1': attachR1, 'E4:S1': none });
const reply = (output: unknown) => ({
  output,
  usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
  finishReason: 'stop',
});
function respond(...outputs: Array<unknown | Error>) {
  const queue = [...outputs];
  vi.mocked(generateText).mockImplementation((async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return reply(next);
  }) as unknown as typeof generateText);
}

beforeEach(() => {
  vi.mocked(generateText).mockReset();
});

describe('attachContentThinUnit', () => {
  test('sends r1 before r2 and r3 with the frozen request and no retries, then routes agreeing runs', async () => {
    const { plan, unit } = fixture();
    const request = createContentAttachmentThinRequest(
      createContentAttachmentThinInput(plan, unit),
    );
    const events: string[] = [];
    let n = 0;
    vi.mocked(generateText).mockImplementation((async () => {
      const i = ++n;
      events.push(`start ${i}`);
      await new Promise((resolve) => setTimeout(resolve, i === 1 ? 5 : 1));
      events.push(`end ${i}`);
      return reply(agreed());
    }) as unknown as typeof generateText);
    const onCall = vi.fn();
    const onAttempt = vi.fn();
    const abortSignal = new AbortController().signal;

    const result = await attachContentThinUnit(plan, unit, {
      model,
      onCall,
      onAttempt,
      abortSignal,
    });

    expect(events.slice(0, 3)).toEqual(['start 1', 'end 1', 'start 2']);
    expect(events[3]).toBe('start 3');
    const args = vi.mocked(generateText).mock.calls[0][0] as unknown as Record<
      string,
      unknown
    >;
    expect(args).toMatchObject({
      model,
      system: request.systemPrompt,
      prompt: request.userPrompt,
      maxRetries: 0,
      abortSignal,
    });
    expect(createAuditedModel).toHaveBeenCalledWith(model, onAttempt);
    expect(result.status).toBe('routed');
    expect(result.calls.map((c) => [c.run, c.status])).toEqual([
      ['r1', 'completed'],
      ['r2', 'completed'],
      ['r3', 'completed'],
    ]);
    expect(result.calls[0]).toMatchObject({
      request,
      rawResponse: agreed(),
      usage: { totalTokens: 12 },
      finishReason: 'stop',
      callAttempts: [],
    });
    expect(result.calls[0].inspection?.issues).toEqual([]);
    expect(onCall).toHaveBeenCalledTimes(3);
    expect(result.outliers).toEqual({
      first: {
        rates: [0, 0, 0].map((rate) => ({ rate, count: 0 })),
        flagged: [],
      },
      finalRuns: ['r1', 'r2', 'r3'],
      wholeUnitReview: false,
    });
    expect(
      result.segments.map((s) => [s.segment, s.status, s.confirmed]),
    ).toEqual([
      ['E1:S1', 'auto', ['R1']],
      ['E2:S1', 'auto', []],
      ['E3:S1', 'auto', []],
      ['E4:S1', 'auto', []],
    ]);
  });

  test('replaces a single outlier with r4 and keeps the two agreeing runs', async () => {
    const { plan, unit } = fixture();
    respond(agreed(), outlier(), agreed(), agreed());

    const result = await attachContentThinUnit(plan, unit, {
      model,
      maxRetries: 2,
    });

    expect(
      (
        vi.mocked(generateText).mock.calls[0][0] as unknown as {
          maxRetries: number;
        }
      ).maxRetries,
    ).toBe(2);
    expect(result.calls.map((c) => c.run)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(result.outliers?.first.flagged).toEqual([1]);
    expect(result.outliers?.replacement?.flagged).toEqual([]);
    expect(result.outliers?.finalRuns).toEqual(['r1', 'r3', 'r4']);
    expect(result.outliers?.wholeUnitReview).toBe(false);
    expect(result.segments.every((s) => s.status === 'auto')).toBe(true);
  });

  test('sends the unit to review when the replacement is again an outlier or fails', async () => {
    const { plan, unit } = fixture();
    respond(agreed(), outlier(), agreed(), outlier());

    const again = await attachContentThinUnit(plan, unit, { model });

    expect(again.outliers?.wholeUnitReview).toBe(true);
    expect(again.outliers?.finalRuns).toEqual(['r1', 'r3', 'r4']);
    expect(again.segments.every((s) => s.reasons.includes('whole_unit'))).toBe(
      true,
    );

    respond(agreed(), outlier(), agreed(), new Error('rate limited'));
    const failedReplacement = await attachContentThinUnit(plan, unit, {
      model,
    });

    expect(failedReplacement.calls.at(-1)).toMatchObject({
      run: 'r4',
      status: 'failed',
      error: 'rate limited',
    });
    expect(failedReplacement.outliers).toMatchObject({
      finalRuns: ['r1', 'r2', 'r3'],
      wholeUnitReview: true,
    });
    expect(failedReplacement.outliers?.replacement).toBeUndefined();
  });

  test('stops without retrying when r1 or a parallel call fails', async () => {
    const { plan, unit } = fixture();
    vi.mocked(generateText).mockRejectedValueOnce('provider down');

    const r1Failed = await attachContentThinUnit(plan, unit, { model });

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(r1Failed).toMatchObject({
      status: 'failed',
      segments: [],
      calls: [{ run: 'r1', status: 'failed', error: 'provider down' }],
    });

    respond(agreed(), new Error('timeout'), agreed());
    const r2Failed = await attachContentThinUnit(plan, unit, { model });

    expect(r2Failed.status).toBe('failed');
    expect(r2Failed.calls.map((c) => c.status).sort()).toEqual([
      'completed',
      'completed',
      'failed',
    ]);
  });

  test('makes no calls for a unit without model-judged segments', async () => {
    const { plan, unit } = fixture(['']);

    const result = await attachContentThinUnit(plan, unit, { model });

    expect(generateText).not.toHaveBeenCalled();
    expect(result).toEqual({
      unitId: 'page-1',
      codeAssigned: [],
      status: 'no_llm_segments',
      calls: [],
      segments: [],
    });
  });

  test('uses the segments compiled for the fixture', () => {
    const { plan, unit } = fixture();

    expect(
      createContentAttachmentThinInput(plan, unit).codeMap.segments,
    ).toEqual(SEGMENTS);
  });
});
