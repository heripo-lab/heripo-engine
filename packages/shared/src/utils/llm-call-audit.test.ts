import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';

import { createAuditedModel } from './llm-call-audit';
import { LLMCaller } from './llm-caller';

const usage = {
  inputTokens: { total: 4, noCache: 4, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 3, text: 3, reasoning: 0 },
};
function result(body: unknown = { id: 'resp-1', status: 'completed' }) {
  return {
    content: [{ type: 'text' as const, text: '{"value":"ok"}' }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage,
    warnings: [],
    request: { body: '{"prompt":"original"}' },
    response: { id: 'sdk-id', body },
  };
}

describe('provider attempt auditing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  test('preserves API envelopes and records every schema retry before parsing', async () => {
    const first = result({
      id: 'incomplete',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    });
    first.content[0].text = '{"value":';
    first.finishReason = {
      unified: 'length',
      raw: 'max_output_tokens',
    } as never;
    const second = result(
      '{"id":"complete","status":"completed","output":["unchanged"]}',
    );
    const before = structuredClone([first, second]);
    const base = new MockLanguageModelV4({
      provider: 'openai.responses',
      doGenerate: [first, second],
    });
    const persisted: unknown[] = [];
    const audited = createAuditedModel(base, (attempt) => {
      persisted.push(structuredClone(attempt));
    });
    const response = await LLMCaller.call({
      schema: z.object({ value: z.string() }),
      systemPrompt: 'original instructions',
      userPrompt: 'original input',
      primaryModel: audited.model,
      maxRetries: 0,
      component: 'test',
      phase: 'audit',
    });
    expect(response.output).toEqual({ value: 'ok' });
    expect(base.doGenerateCalls).toHaveLength(2);
    expect(audited.attempts).toHaveLength(2);
    expect(audited.attempts[0]).toMatchObject({
      sequence: 1,
      outcome: 'returned',
      finishReason: first.finishReason,
      apiStatus: 'incomplete',
      incompleteDetails: { reason: 'max_output_tokens' },
      responseId: 'incomplete',
      responseBody: first.response.body,
      requestBody: first.request.body,
      content: first.content,
      usage,
      error: null,
    });
    expect(audited.attempts[1]).toMatchObject({
      sequence: 2,
      apiStatus: 'completed',
      responseId: 'complete',
      responseBody: second.response.body,
      incompleteDetails: null,
    });
    expect(persisted).toEqual(audited.attempts);
    expect([first, second]).toEqual(before);
    expect(base.doGenerateCalls[0].maxOutputTokens).toBeUndefined();
    expect(base.doGenerateCalls[0].prompt).toEqual(
      base.doGenerateCalls[1].prompt,
    );
  });

  test('retains invalid and non-object bodies without inventing API metadata', async () => {
    for (const body of ['not json', '[]', [], { status: 1, id: false }, true]) {
      const raw = result(body);
      const audited = createAuditedModel(
        new MockLanguageModelV4({ doGenerate: raw }),
      );
      expect(await audited.model.doGenerate({ prompt: [] })).toBe(raw);
      expect(audited.attempts[0]).toMatchObject({
        apiStatus: null,
        responseId: 'sdk-id',
        responseBody: body,
      });
    }
    const audited = createAuditedModel(
      new MockLanguageModelV4({
        doGenerate: { ...result(), response: undefined, request: undefined },
      }),
    );
    await audited.model.doGenerate({ prompt: [] });
    expect(audited.attempts[0]).toMatchObject({
      apiStatus: null,
      responseId: null,
      responseBody: null,
      requestBody: null,
    });
  });

  test('keeps provider errors and cancellation records before rethrowing the original failure', async () => {
    const error = Object.assign(new Error('provider failed'), {
      responseBody:
        '{"id":"failed-id","status":"failed","error":{"message":"original"}}',
      requestBodyValues: { input: 'unchanged' },
      statusCode: 429,
    });
    const persisted = vi.fn();
    const audited = createAuditedModel(
      new MockLanguageModelV4({
        doGenerate: async () => {
          throw error;
        },
      }),
      persisted,
    );
    await expect(audited.model.doGenerate({ prompt: [] })).rejects.toBe(error);
    expect(audited.attempts[0]).toMatchObject({
      outcome: 'error',
      apiStatus: 'failed',
      responseId: 'failed-id',
      requestBody: error.requestBodyValues,
      responseBody: error.responseBody,
      finishReason: null,
      content: null,
      usage: null,
      error: { name: 'Error', message: 'provider failed', statusCode: 429 },
    });
    expect(persisted).toHaveBeenCalledWith(audited.attempts[0]);
    const network = createAuditedModel(
      new MockLanguageModelV4({
        doGenerate: async () => {
          throw 'cancelled';
        },
      }),
    );
    await expect(network.model.doGenerate({ prompt: [] })).rejects.toBe(
      'cancelled',
    );
    expect(network.attempts[0]).toMatchObject({
      outcome: 'error',
      apiStatus: null,
      incompleteDetails: null,
      requestBody: null,
      responseBody: null,
      error: { name: 'Error', message: 'cancelled', statusCode: null },
    });
  });

  test('requires an explicit model instance to observe its provider boundary', () => {
    expect(() => createAuditedModel('openai/model')).toThrow(
      'Audited calls require a model instance',
    );
  });
});
