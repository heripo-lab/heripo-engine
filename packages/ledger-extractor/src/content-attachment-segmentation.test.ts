import type * as Shared from '@heripo/shared';

import type { ContentAttachmentSegmentationResponse } from './content-attachment-segmentation';

import { LLMCaller, createAuditedModel } from '@heripo/shared';
import { Output } from 'ai';
import { expect, test, vi } from 'vitest';

import {
  createContentAttachmentSegmentationRequest,
  identifyContentAttachmentSegments,
  inspectContentAttachmentSegmentation,
} from './content-attachment-segmentation';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

type Input = Parameters<typeof createContentAttachmentSegmentationRequest>[0];
function fixture() {
  const tuples = [
    ['E1', 'text', ['C1'], null, '범위 측량 TR7 제토.'],
    [
      'E2',
      'tableCell',
      ['C1'],
      ['T1', 1, 1],
      '도로와 수혈이 존재하며, 도로는 연결 가능성이 있다.',
    ],
    ['E3', 'text', ['C1'], null, '본문 문맥.'],
    ['E4', 'tableCell', ['C1'], ['T1', 0, 0], '번호'],
    ['E5', 'tableCell', ['C1'], ['T1', 0, 1], '작업'],
    ['E6', 'tableCell', ['C1'], ['T1', 1, 0], '7'],
    ['E7', 'tableCell', ['C1'], ['T1', 2, 0], '8'],
    ['E8', 'tableCell', ['C1'], ['T1', 2, 1], '다른 작업'],
  ];
  const input = {
    payload: {
      contexts: { C1: ['Methods'], C99: ['PRIVATE_CANDIDATE_PATH'] },
      candidates: [['PRIVATE_CANDIDATE']],
      decisions: 'PRIVATE_PRIOR_ANSWER',
      current: {
        excerpts: tuples,
        bodyBlocks: [['P1', ['E1', 'E3']]],
        readOnlyContext: [['B1', ['C1'], '앞 페이지.']],
        tables: [
          {
            ref: 'T1',
            caption: '조사 일지',
            grid: [
              [
                ['E4', null, 1, 1, true],
                ['E5', null, 1, 2, true],
                [null, 'original merged header', 1, 1, true],
              ],
              [
                ['E6', null, 1, 1, false],
                ['E2', null, 1, 1, false],
              ],
              [
                ['E7', null, 1, 1, false],
                ['E8', null, 1, 1, false],
              ],
            ],
          },
          { ref: 'T2', caption: null, grid: [] },
        ],
      },
    },
    codeMap: {
      excerpts: tuples.map((e) => ({
        ref: e[0],
        evidence: [
          {
            sourceId: 'source-' + e[0],
            resourceKey: '/source/' + e[0],
            resourceId: null,
            sourceRefs: ['#/source/' + e[0]],
            pdfPageNo: 1,
            logicalPageRange: { startPageNo: 0, endPageNo: 0 },
            charStart: 11,
            charEnd: 11 + (e[4] as string).length,
            quote: e[4],
          },
        ],
      })),
      supportingBody: [
        { ref: 'B1', resourceKey: '/prior', text: '앞 페이지.' },
      ],
    },
  } as unknown as Input;
  const request = createContentAttachmentSegmentationRequest(input, [
    'E2',
    'E1',
  ]);
  const raw: ContentAttachmentSegmentationResponse = {
    segments: {
      E1: [{ wordRanges: ['E1:W1-W2'] }, { wordRanges: ['E1:W3-W4'] }],
      E2: [{ wordRanges: ['E2:W1-W3'] }, { wordRanges: ['E2:W4-W7'] }],
    },
  };
  const audit = {
    ...request,
    rawResponse: raw,
    usage: {} as never,
    callAttempts: [],
  };
  return { input, request, raw, audit };
}

test('projects only bounded original sources, preserving table spans, whole text and UTF-16 locations without candidates or earlier answers', () => {
  const { input, request, audit } = fixture();
  const before = structuredClone(input);
  const p = JSON.parse(request.userPrompt);
  expect(request.excerptRefs).toEqual(['E1', 'E2']);
  expect(p.current[0].text).toBe('범위 측량 TR7 제토.');
  expect(p.current[0].words).toEqual([
    ['W1', '범위'],
    ['W2', '측량'],
    ['W3', 'TR7'],
    ['W4', '제토.'],
  ]);
  expect(p.tables[0].rows.map((r: { index: number }) => r.index)).toEqual([
    0, 1,
  ]);
  expect(p.tables[0].rows[0].cells[1][3]).toBe(2);
  expect(p.tables[0].rows[0].cells[2][1]).toBe('original merged header');
  expect(p.readOnlyContext.map((s: { ref: string }) => s.ref)).toEqual([
    'E3',
    'E4',
    'E5',
    'E6',
    'X1',
  ]);
  expect(request.userPrompt).not.toContain('PRIVATE_');
  expect(p).not.toHaveProperty('candidates');
  expect(p).not.toHaveProperty('decisions');
  expect(p.bodyBlocks).toEqual([['P1', ['E1', 'E3']]]);
  const inspected = inspectContentAttachmentSegmentation(input, audit);
  expect(inspected.issues).toEqual([]);
  expect(inspected.segments.map((s) => [s.ref, s.evidence[0].text])).toEqual([
    ['E1:S1', '범위 측량'],
    ['E1:S2', 'TR7 제토.'],
    ['E2:S1', '도로와 수혈이 존재하며,'],
    ['E2:S2', '도로는 연결 가능성이 있다.'],
  ]);
  expect(inspected.segments[1].evidence[0].evidence[0]).toMatchObject({
    quote: 'TR7 제토.',
    charStart: 17,
    charEnd: 24,
  });
  expect(input).toEqual(before);
});

test('requires exact current keys and nonempty ranges, using provider-compatible references without semantic labels or recipients', async () => {
  const { request, raw } = fixture();
  expect(request.schema.safeParse(raw).success).toBe(true);
  for (const invalid of [
    { segments: { E1: raw.segments.E1 } },
    { segments: { ...raw.segments, E3: [] } },
    { segments: { ...raw.segments, E1: [] } },
    { segments: { ...raw.segments, E1: [{ wordRanges: [] }] } },
    { segments: { ...raw.segments, E1: [{ wordRanges: ['rewritten text'] }] } },
    {
      segments: {
        ...raw.segments,
        E1: [{ wordRanges: ['E1:W1-W4'], kind: 'substantive' }],
      },
    },
    { ...raw, recipients: ['invented'] },
  ])
    expect(request.schema.safeParse(invalid).success).toBe(false);
  const format = await Output.object({ schema: request.schema }).responseFormat;
  expect(format?.type).toBe('json');
  const inspectRefs = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ('$ref' in node) expect(Object.keys(node)).toEqual(['$ref']);
    Object.values(node).forEach(inspectRefs);
  };
  inspectRefs(format);
});

test('rejects missing coverage, cross-excerpt/context ranges, reversed endpoints, duplicate segments and forged audit data without repair', () => {
  const { input, audit } = fixture();
  for (const segments of [
    [{ wordRanges: ['E1:W1-W2'] }],
    [{ wordRanges: ['E2:W1-W7'] }],
    [{ wordRanges: ['X1:W1-W2'] }],
    [{ wordRanges: ['E1:W3-W2'] }],
    [{ wordRanges: ['E1:W1-W99'] }],
    [{ wordRanges: ['E1:W1-W4'] }, { wordRanges: ['E1:W1-W4'] }],
  ]) {
    const bad = structuredClone(audit);
    bad.rawResponse.segments.E1 = segments;
    const before = structuredClone(bad);
    expect(inspectContentAttachmentSegmentation(input, bad).issues).toEqual([
      'Invalid segmentation ranges or coverage: E1',
    ]);
    expect(bad).toEqual(before);
  }
  const variants = [
    structuredClone(audit),
    structuredClone(audit),
    structuredClone(audit),
    structuredClone(audit),
    structuredClone(audit),
  ];
  variants[0].version = 'changed' as never;
  variants[1].systemPrompt = 'changed';
  variants[2].userPrompt = 'changed';
  variants[3].wordEvidence.sources[0].words[0].charEnd++;
  variants[4].rawResponse = { segments: {} };
  for (const bad of variants)
    expect(
      inspectContentAttachmentSegmentation(input, bad).issues,
    ).toHaveLength(1);
  expect(
    inspectContentAttachmentSegmentation(input, {
      ...audit,
      excerptRefs: ['unknown'],
    }).issues,
  ).toEqual(['Invalid segmentation excerpt selection']);
});

test('rejects empty duplicate or unknown target selections and preserves whitespace-only fragments without forcing semantic splits', () => {
  const { input } = fixture();
  for (const refs of [[], ['E1', 'E1'], ['E99']])
    expect(() =>
      createContentAttachmentSegmentationRequest(input, refs),
    ).toThrow('unique existing');
  input.payload.current.excerpts = input.payload.current.excerpts.map((e) =>
    e[0] === 'E1' ? [e[0], e[1], e[2], e[3], ' \n'] : e,
  );
  const binding = input.codeMap.excerpts.find((e) => e.ref === 'E1')!;
  binding.evidence[0].quote = ' \n';
  binding.evidence[0].charEnd = 13;
  const request = createContentAttachmentSegmentationRequest(input, ['E1']);
  expect(request.schema.safeParse({ segments: { E1: [] } }).success).toBe(true);
  expect(
    inspectContentAttachmentSegmentation(input, {
      ...request,
      rawResponse: { segments: { E1: [] } },
      usage: {} as never,
      callAttempts: [],
    }).segments,
  ).toEqual([]);
});

test('runs exactly the standalone segmentation call and retains the unmodified returned object, attempts and usage', async () => {
  const { input, raw } = fixture();
  const model = {} as never,
    onAttempt = vi.fn(),
    abortSignal = new AbortController().signal;
  const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 } as never;
  vi.mocked(LLMCaller.call).mockResolvedValue({
    output: raw,
    usage,
    usedFallback: false,
  });
  const audit = await identifyContentAttachmentSegments(input, ['E2', 'E1'], {
    model,
    maxRetries: 0,
    onAttempt,
    abortSignal,
  });
  expect(createAuditedModel).toHaveBeenCalledWith(model, onAttempt);
  expect(LLMCaller.call).toHaveBeenCalledTimes(1);
  expect(LLMCaller.call).toHaveBeenCalledWith(
    expect.objectContaining({
      phase: 'content-segmentation',
      maxRetries: 0,
      abortSignal,
    }),
  );
  expect(audit.rawResponse).toBe(raw);
  expect(audit.usage).toBe(usage);
  expect(audit.callAttempts).toEqual([]);
  expect(inspectContentAttachmentSegmentation(input, audit).issues).toEqual([]);
});

test('replays the historical prompt separately from the current shared-scope policy without changing input or schema', () => {
  const { input, raw } = fixture();
  const old = createContentAttachmentSegmentationRequest(
    input,
    ['E1', 'E2'],
    'content-segmentation.v1',
  );
  const current = createContentAttachmentSegmentationRequest(input, [
    'E1',
    'E2',
  ]);
  expect(current.version).toBe('content-segmentation.v2');
  expect(current.systemPrompt.startsWith(old.systemPrompt + '\n')).toBe(true);
  expect(old.systemPrompt).not.toContain('do not isolate it');
  expect(current.userPrompt).toBe(old.userPrompt);
  expect(current.wordEvidence).toEqual(old.wordEvidence);
  const historical = {
    ...old,
    rawResponse: raw,
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentSegmentation(input, historical).issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentSegmentation(input, {
      ...historical,
      version: current.version,
    }).issues,
  ).toHaveLength(1);
  expect(() =>
    createContentAttachmentSegmentationRequest(
      input,
      ['E1'],
      'unknown' as never,
    ),
  ).toThrow('Unsupported segmentation version');
});

test('resolves shared original subjects across overlapping segments without supplying missing semantic scope', () => {
  const { input, audit } = fixture();
  audit.rawResponse.segments.E1 = [
    { wordRanges: ['E1:W1-W2'] },
    { wordRanges: ['E1:W1-W1', 'E1:W3-W4'] },
  ];
  const before = structuredClone(audit);
  const result = inspectContentAttachmentSegmentation(input, audit);
  expect(result.issues).toEqual([]);
  expect(
    result.segments
      .filter((s) => s.excerptRef === 'E1')
      .map((s) => s.evidence.map((e) => e.text)),
  ).toEqual([['범위 측량'], ['범위', 'TR7 제토.']]);
  expect(audit).toEqual(before);
});
