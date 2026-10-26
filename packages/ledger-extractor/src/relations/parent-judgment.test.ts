import type * as Shared from '@heripo/shared';
import type * as Ai from 'ai';

import type { RelationParentJudgmentRequest } from './parent-judgment-request';

import { createAuditedModel } from '@heripo/shared';
import { generateText } from 'ai';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  decideRelationParents,
  inspectRelationParentResponse,
  judgeRelationParentBatch,
} from './parent-judgment';

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof Ai>()),
  generateText: vi.fn(),
}));
vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

const request = {
  batchId: 'parents-1',
  questions: [
    { ref: 'Q1', recordId: 'a1', candidateRefs: ['R1'], evidenceRefs: ['E1'] },
    {
      ref: 'Q2',
      recordId: 'a2',
      candidateRefs: ['R1', 'R2'],
      evidenceRefs: ['E2', 'E3'],
    },
  ],
  candidates: [
    { ref: 'R1', recordId: 'f1' },
    { ref: 'R2', recordId: 'z1' },
  ],
  evidence: [
    { ref: 'E1', questionRef: 'Q1', kind: 'phrase', text: 'p1' },
    { ref: 'E2', questionRef: 'Q2', kind: 'phrase', text: 'p2' },
    { ref: 'E3', questionRef: 'Q2', kind: 'excerpt', text: 'x2' },
  ],
  systemPrompt: 'system',
  userPrompt: 'user',
  providerOutputSchema: {},
} as unknown as RelationParentJudgmentRequest;
const answers = (q2Parent = 'none') => ({
  answers: [
    { q: 'Q1', parent: 'R1', evidence: ['E1'], reason: 'stated' },
    {
      q: 'Q2',
      parent: q2Parent,
      evidence: q2Parent === 'none' ? [] : ['E2'],
      reason: 'r',
    },
  ],
});
const model = { modelId: 'mock' } as unknown as Ai.LanguageModel;
const reply = (output: unknown) => ({
  output,
  usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
  finishReason: 'stop',
});

beforeEach(() => {
  vi.mocked(generateText).mockReset();
});

describe('inspectRelationParentResponse', () => {
  test('keeps valid answers and reports every problem without repairing', () => {
    const valid = inspectRelationParentResponse(request, answers());
    const broken = inspectRelationParentResponse(request, {
      answers: [
        { q: 'Q9', parent: 'R1', evidence: [], reason: '' },
        { q: 'Q1', parent: 'R2', evidence: ['E2'], reason: '' },
        { q: 'Q2', parent: 'R2' },
        { q: 'Q2', parent: 'none', evidence: [], reason: '' },
      ],
    });

    expect(valid.issues).toEqual([]);
    expect(valid.answers).toEqual({
      Q1: {
        questionRef: 'Q1',
        recordId: 'a1',
        parentRecordId: 'f1',
        evidence: [request.evidence[0]],
        reason: 'stated',
      },
      Q2: expect.objectContaining({ parentRecordId: null, evidence: [] }),
    });
    expect(broken.answers).toEqual({});
    expect(broken.issues).toEqual([
      'Unknown question Q9',
      'Q1: parent R2 is not a candidate',
      "Q1: evidence E2 is not this question's",
      'Q2: parent without evidence',
      'Q2: answered more than once',
    ]);
    expect(inspectRelationParentResponse(request, null).issues).toEqual([
      'Response has no answers array',
    ]);
    expect(
      inspectRelationParentResponse(request, {
        answers: [{ q: 'Q2', parent: 'none', evidence: [] }],
      }),
    ).toEqual({
      answers: { Q2: expect.objectContaining({ reason: '' }) },
      issues: ['Q1: not answered'],
    });
  });
});

describe('decideRelationParents', () => {
  test('sets a parent or none only when every run agrees validly', () => {
    const agree = inspectRelationParentResponse(request, answers());
    const other = inspectRelationParentResponse(request, answers('R2'));
    const invalid = inspectRelationParentResponse(request, { answers: [] });

    expect(decideRelationParents(request, [agree, agree, agree])).toEqual([
      {
        recordId: 'a1',
        status: 'parent',
        parentRecordId: 'f1',
        evidence: [request.evidence[0]],
        votes: ['f1', 'f1', 'f1'],
      },
      {
        recordId: 'a2',
        status: 'none',
        evidence: [],
        votes: ['none', 'none', 'none'],
      },
    ]);
    expect(
      decideRelationParents(request, [agree, other, invalid]).map((j) => [
        j.status,
        j.votes,
      ]),
    ).toEqual([
      ['review', ['f1', 'f1', 'invalid']],
      ['review', ['none', 'z1', 'invalid']],
    ]);
    expect(
      decideRelationParents(request, [invalid, invalid, invalid])[0].status,
    ).toBe('review');
  });
});

describe('judgeRelationParentBatch', () => {
  test('sends r1, then r2 and r3, and decides the batch', async () => {
    vi.mocked(generateText).mockResolvedValue(reply(answers()) as never);
    const onCall = vi.fn();
    const onAttempt = vi.fn();

    const result = await judgeRelationParentBatch(request, {
      model,
      onCall,
      onAttempt,
    });

    expect(createAuditedModel).toHaveBeenCalledWith(model, onAttempt);
    expect(vi.mocked(generateText).mock.calls[0][0]).toMatchObject({
      system: 'system',
      prompt: 'user',
      maxRetries: 0,
    });
    expect(result.status).toBe('judged');
    expect(result.calls.map((c) => c.run).sort()).toEqual(['r1', 'r2', 'r3']);
    expect(result.calls[0]).toMatchObject({
      status: 'completed',
      usage: { totalTokens: 12 },
      finishReason: 'stop',
    });
    expect(onCall).toHaveBeenCalledTimes(3);
    expect(result.judgments.map((j) => j.status)).toEqual(['parent', 'none']);
  });

  test('sends every question to review when a call fails, without re-sending it', async () => {
    vi.mocked(generateText).mockRejectedValueOnce(new Error('rate limited'));
    const first = await judgeRelationParentBatch(request, {
      model,
      maxRetries: 2,
    });
    vi.mocked(generateText)
      .mockResolvedValueOnce(reply(answers()) as never)
      .mockRejectedValueOnce('down')
      .mockResolvedValueOnce(reply(answers()) as never);
    const second = await judgeRelationParentBatch(request, { model });

    expect(first).toMatchObject({
      status: 'failed',
      calls: [{ run: 'r1', status: 'failed', error: 'rate limited' }],
    });
    expect(vi.mocked(generateText).mock.calls[0][0]).toMatchObject({
      maxRetries: 2,
    });
    expect(first.judgments).toEqual([
      { recordId: 'a1', status: 'review', evidence: [], votes: [] },
      { recordId: 'a2', status: 'review', evidence: [], votes: [] },
    ]);
    expect(second.status).toBe('failed');
    expect(second.calls.find((c) => c.status === 'failed')?.error).toBe('down');
    expect(generateText).toHaveBeenCalledTimes(4);
  });
});
