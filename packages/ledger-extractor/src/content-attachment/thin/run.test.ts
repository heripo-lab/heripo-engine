import type { ProcessedDocument } from '@heripo/model';
import type * as Shared from '@heripo/shared';
import type * as Ai from 'ai';

import type { DocumentResource } from '../../resources/document-resource-index';
import type { AttachmentUnit, ContentAttachmentPlan } from '../types';

import { createAuditedModel } from '@heripo/shared';
import { NoObjectGeneratedError, generateText } from 'ai';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { buildDocumentResourceIndex } from '../../resources/document-resource-index';
import { createContentAttachmentThinInput } from './compile';
import { createContentAttachmentThinRequest } from './prompt';
import { isContentAttachmentThinTiebreakable } from './routing';
import {
  CONTENT_ATTACHMENT_THIN_DEFAULT_RUNS,
  CONTENT_ATTACHMENT_THIN_PROVIDER_OPTIONS,
  attachContentThinUnit,
  contentAttachmentThinNextRun,
  createContentAttachmentThinUnitRequest,
  isContentAttachmentThinDegenerate,
  recordContentAttachmentThinCall,
  routeContentAttachmentThinTwoRuns,
} from './run';

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
      runs: 3,
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
      providerOptions: CONTENT_ATTACHMENT_THIN_PROVIDER_OPTIONS,
    });
    expect(CONTENT_ATTACHMENT_THIN_PROVIDER_OPTIONS).toEqual({
      anthropic: { effort: 'low' },
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

  test('sends r1 then r2 by default and confirms only the segments both runs agree on', async () => {
    const { plan, unit } = fixture();
    const events: string[] = [];
    let n = 0;
    const outputs = [agreed(), outlier()];
    vi.mocked(generateText).mockImplementation((async () => {
      const i = ++n;
      events.push(`start ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
      events.push(`end ${i}`);
      return reply(outputs[i - 1]);
    }) as unknown as typeof generateText);
    const onCall = vi.fn();

    const result = await attachContentThinUnit(plan, unit, {
      model,
      onCall,
      tiebreak: false,
    });

    expect(CONTENT_ATTACHMENT_THIN_DEFAULT_RUNS).toBe(2);
    expect(events).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
    expect(onCall).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('routed');
    expect(result.calls.map((c) => c.run)).toEqual(['r1', 'r2']);
    expect(result.outliers).toEqual({
      finalRuns: ['r1', 'r2'],
      wholeUnitReview: false,
    });
    expect(result.segments.map((s) => [s.segment, s.status])).toEqual([
      ['E1:S1', 'review'],
      ['E2:S1', 'review'],
      ['E3:S1', 'review'],
      ['E4:S1', 'auto'],
    ]);

    respond(agreed(), new Error('timeout'));
    const r2Failed = await attachContentThinUnit(plan, unit, {
      model,
      providerOptions: {},
    });

    expect(r2Failed).toMatchObject({ status: 'failed', segments: [] });
    expect(r2Failed.calls[1].providerOptions).toEqual({});
    expect(
      (
        vi.mocked(generateText).mock.calls.at(-1)![0] as unknown as {
          providerOptions: unknown;
        }
      ).providerOptions,
    ).toEqual({});
    expect(r2Failed.calls.map((c) => [c.run, c.status])).toEqual([
      ['r1', 'completed'],
      ['r2', 'failed'],
    ]);
  });

  test('sends a tie-breaking r3 when r1 and r2 disagree and decides those segments by majority', async () => {
    const { plan, unit } = fixture();
    // r3 agrees with r1 on E1 and E2, leaves E3 out (invalid) and agrees with both on E4
    const third = items({ 'E1:S1': attachR1, 'E2:S1': none, 'E4:S1': none });
    respond(agreed(), outlier(), third);
    const onCall = vi.fn();

    const result = await attachContentThinUnit(plan, unit, { model, onCall });

    expect(result.calls.map((c) => c.run)).toEqual(['r1', 'r2', 'r3']);
    expect(onCall).toHaveBeenCalledTimes(3);
    expect(result.outliers?.finalRuns).toEqual(['r1', 'r2', 'r3']);
    expect(
      result.segments.map((s) => [
        s.segment,
        s.status,
        s.confirmed,
        s.decidedBy,
      ]),
    ).toEqual([
      ['E1:S1', 'auto', ['R1'], 'majority'],
      ['E2:S1', 'auto', [], 'majority'],
      ['E3:S1', 'review', [], undefined],
      ['E4:S1', 'auto', [], undefined],
    ]);
    expect(result.segments[2].reasons).toContain('invalid_run');
    expect(contentAttachmentThinNextRun(plan, unit, result.calls)).toBeNull();

    respond(agreed(), outlier(), new Error('overloaded'));
    const failedTiebreak = await attachContentThinUnit(plan, unit, { model });

    expect(failedTiebreak.calls.map((c) => [c.run, c.status])).toEqual([
      ['r1', 'completed'],
      ['r2', 'completed'],
      ['r3', 'failed'],
    ]);
    expect(failedTiebreak.outliers?.finalRuns).toEqual(['r1', 'r2']);
    expect(failedTiebreak.segments[0].status).toBe('review');

    respond(agreed(), agreed());
    const agreeing = await attachContentThinUnit(plan, unit, { model });
    expect(agreeing.calls).toHaveLength(2);
    expect(contentAttachmentThinNextRun(plan, unit, agreeing.calls)).toBeNull();
    expect(
      contentAttachmentThinNextRun(plan, unit, failedTiebreak.calls),
    ).toBeNull();
    expect(
      contentAttachmentThinNextRun(plan, unit, [failedTiebreak.calls[0]]),
    ).toBeNull();
  });

  test('replaces degenerate runs that leave most segments undecided, up to r4', async () => {
    const { plan, unit } = fixture();
    const empty = items({});
    respond(empty, agreed(), agreed());

    const replaced = await attachContentThinUnit(plan, unit, { model });

    expect(replaced.calls.map((c) => c.run)).toEqual(['r1', 'r2', 'r3']);
    expect(isContentAttachmentThinDegenerate(replaced.calls[0], 4)).toBe(true);
    expect(isContentAttachmentThinDegenerate(replaced.calls[1], 4)).toBe(false);
    expect(replaced.outliers?.finalRuns).toEqual(['r2', 'r3']);
    expect(replaced.segments.every((s) => s.status === 'auto')).toBe(true);

    respond(empty, agreed(), empty, agreed());
    const twice = await attachContentThinUnit(plan, unit, { model });

    expect(twice.calls.map((c) => c.run)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(twice.outliers?.finalRuns).toEqual(['r2', 'r4']);

    respond(empty, agreed(), empty, empty);
    const exhausted = await attachContentThinUnit(plan, unit, { model });

    expect(exhausted.calls).toHaveLength(4);
    expect(exhausted.outliers?.finalRuns).toEqual(['r1', 'r2']);
    expect(exhausted.segments.every((s) => s.status === 'review')).toBe(true);
    expect(
      isContentAttachmentThinDegenerate(
        { ...exhausted.calls[0], status: 'failed', inspection: undefined },
        4,
      ),
    ).toBe(false);
  });

  test('settles by majority only segments in review for disagreement alone', () => {
    const segment = {
      segment: 'E1:S1',
      status: 'review' as const,
      reasons: ['contested_targets' as const],
      confirmed: [],
      contested: [],
      areaSuggestions: [],
      layerSuggestions: [],
      layerMentions: [],
      recipientIdentityAlternatives: [],
      relationshipSubjectAlternatives: [],
    };

    expect(isContentAttachmentThinTiebreakable(segment)).toBe(true);
    expect(
      isContentAttachmentThinTiebreakable({
        ...segment,
        reasons: ['contested_targets', 'area'],
      }),
    ).toBe(false);
    expect(
      isContentAttachmentThinTiebreakable({
        ...segment,
        status: 'auto',
        reasons: [],
      }),
    ).toBe(false);
  });

  test('replaces a single outlier with r4 and keeps the two agreeing runs', async () => {
    const { plan, unit } = fixture();
    respond(agreed(), outlier(), agreed(), agreed());

    const result = await attachContentThinUnit(plan, unit, {
      model,
      runs: 3,
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
    expect(result.outliers?.first?.flagged).toEqual([1]);
    expect(result.outliers?.replacement?.flagged).toEqual([]);
    expect(result.outliers?.finalRuns).toEqual(['r1', 'r3', 'r4']);
    expect(result.outliers?.wholeUnitReview).toBe(false);
    expect(result.segments.every((s) => s.status === 'auto')).toBe(true);
  });

  test('routes with all four runs when the replacement is again an outlier, and reviews the unit when it fails', async () => {
    const { plan, unit } = fixture();
    respond(agreed(), outlier(), agreed(), outlier());

    const again = await attachContentThinUnit(plan, unit, {
      model,
      runs: 3,
    });

    expect(again.outliers?.wholeUnitReview).toBe(false);
    expect(again.outliers?.replacement?.flagged).toEqual([2]);
    expect(again.outliers?.finalRuns).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(again.segments.map((s) => [s.status, s.reasons])).toEqual([
      ['review', ['contested_targets']],
      ['review', ['contested_targets']],
      ['review', ['contested_targets']],
      ['auto', []],
    ]);
    expect(again.segments[0].contested).toEqual([{ ref: 'R1', votes: 2 }]);

    respond(agreed(), outlier(), agreed(), new Error('rate limited'));
    const failedReplacement = await attachContentThinUnit(plan, unit, {
      model,
      runs: 3,
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

  test('sends the v14 catalog request when the plan policy asks for catalog fields', async () => {
    const { plan, unit } = fixture();
    plan.thinPolicy = { layers: 'all', catalog: 'fields' };
    respond(agreed(), agreed(), agreed());

    const result = await attachContentThinUnit(plan, unit, { model });

    expect(result.calls[0].request.version).toBe('content-attachment-thin.v14');
    expect(result.calls[0].request.systemPrompt).toContain('CATALOG ENTRIES:');
    expect(result.status).toBe('routed');
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

    vi.mocked(generateText).mockRejectedValueOnce(
      new NoObjectGeneratedError({
        message: 'No object generated: response was cut off.',
        text: '{"decisions":[',
        response: {} as never,
        usage: { totalTokens: 32_500 } as never,
        finishReason: 'length',
      }),
    );
    const cutOff = await attachContentThinUnit(plan, unit, { model });

    expect(cutOff.calls[0]).toMatchObject({
      status: 'failed',
      usage: { totalTokens: 32_500 },
      finishReason: 'length',
    });

    respond(agreed(), new Error('timeout'), agreed());
    const r2Failed = await attachContentThinUnit(plan, unit, {
      model,
      runs: 3,
    });

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

  test('records externally obtained calls and routes two runs without calling a model', () => {
    const { plan, unit } = fixture();
    const request = createContentAttachmentThinUnitRequest(plan, unit)!;
    const usage = { inputTokens: 10, outputTokens: 2, totalTokens: 12 };

    const r1 = recordContentAttachmentThinCall(plan, unit, {
      run: 'r1',
      request,
      rawResponse: agreed(),
      usage: usage as never,
      finishReason: 'stop',
    });
    const r2 = recordContentAttachmentThinCall(plan, unit, {
      run: 'r2',
      request,
      rawResponse: agreed(),
    });
    const failed = recordContentAttachmentThinCall(plan, unit, {
      run: 'r2',
      request,
      error: 'batch item expired',
    });
    const truncated = recordContentAttachmentThinCall(plan, unit, {
      run: 'r2',
      request,
      usage: {
        inputTokens: 900,
        outputTokens: 32_000,
        totalTokens: 32_900,
      } as never,
      finishReason: 'length',
      error: 'batch item stopped: max_tokens',
    });

    expect(request).toEqual(
      createContentAttachmentThinRequest(
        createContentAttachmentThinInput(plan, unit),
      ),
    );
    expect(r1).toMatchObject({
      run: 'r1',
      status: 'completed',
      rawResponse: agreed(),
      usage,
      finishReason: 'stop',
      callAttempts: [],
    });
    expect(r1.inspection?.issues).toEqual([]);
    expect(r2).not.toHaveProperty('usage');
    expect(r2).not.toHaveProperty('finishReason');
    expect(failed).toEqual({
      run: 'r2',
      status: 'failed',
      request,
      error: 'batch item expired',
      callAttempts: [],
    });
    expect(truncated).toMatchObject({
      status: 'failed',
      usage: { totalTokens: 32_900 },
      finishReason: 'length',
    });
    expect(truncated).not.toHaveProperty('inspection');
    const routed = routeContentAttachmentThinTwoRuns(plan, unit, [r1, r2]);
    expect(routed).toMatchObject({
      status: 'routed',
      outliers: { finalRuns: ['r1', 'r2'], wholeUnitReview: false },
    });
    expect(routed.segments.every((x) => x.status === 'auto')).toBe(true);
    expect(routeContentAttachmentThinTwoRuns(plan, unit, [r1])).toMatchObject({
      status: 'failed',
      segments: [],
    });
    expect(
      routeContentAttachmentThinTwoRuns(plan, unit, [r1, failed]).status,
    ).toBe('failed');
    expect(() =>
      routeContentAttachmentThinTwoRuns(plan, unit, [
        r1,
        { ...r2, request: { ...request, userPrompt: 'other' } },
      ]),
    ).toThrow("Call r2 does not answer this unit's request");
    expect(() =>
      routeContentAttachmentThinTwoRuns(plan, unit, [
        { ...r1, request: { ...request, systemPrompt: 'other' } },
      ]),
    ).toThrow("Call r1 does not answer this unit's request");
    expect(() =>
      routeContentAttachmentThinTwoRuns(plan, unit, [
        { ...r1, request: { ...request, version: 'other' as never } },
      ]),
    ).toThrow("Call r1 does not answer this unit's request");

    const empty = fixture(['']);
    expect(createContentAttachmentThinUnitRequest(empty.plan, empty.unit)).toBe(
      null,
    );
    expect(
      routeContentAttachmentThinTwoRuns(empty.plan, empty.unit, []),
    ).toEqual({
      unitId: 'page-1',
      codeAssigned: [],
      status: 'no_llm_segments',
      calls: [],
      segments: [],
    });
    expect(generateText).not.toHaveBeenCalled();
  });

  test('uses the segments compiled for the fixture', () => {
    const { plan, unit } = fixture();

    expect(
      createContentAttachmentThinInput(plan, unit).codeMap.segments,
    ).toEqual(SEGMENTS);
  });
});
