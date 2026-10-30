import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import { LLMCaller } from './llm-caller';
import {
  SPEND_GUARD_ATTEMPT_OVERHEAD_TOKENS,
  SPEND_GUARD_DEFAULT_MAX_OUTPUT_TOKENS,
  SpendLimitError,
  createSpendGuard,
  spendInputTokenBound,
} from './spend-guard';

const usage = {
  inputTokens: { total: 40, noCache: 40, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};
function result(text = '{"value":"ok"}', u: unknown = usage) {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: u as typeof usage,
    warnings: [],
  };
}
const call = (model: unknown) =>
  LLMCaller.call({
    schema: z.object({ value: z.string() }),
    systemPrompt: 'system',
    userPrompt: 'user',
    primaryModel: model as never,
    maxRetries: 0,
    component: 'test',
    phase: 'guard',
  });

describe('createSpendGuard', () => {
  test('reserves, settles once and refuses what does not fit', () => {
    const guard = createSpendGuard({ maxCalls: 3, maxTotalTokens: 100 });
    expect(guard.refused()).toBeNull();
    const first = guard.reserve('first', { calls: 2, totalTokens: 80 });
    expect(guard.left()).toEqual({ calls: 1, totalTokens: 20 });
    expect(() =>
      guard.reserve('second', { calls: 1, totalTokens: 30 }),
    ).toThrow(SpendLimitError);
    expect(() => guard.reserve('third', { calls: 2, totalTokens: 1 })).toThrow(
      'third needs up to 2 calls and 1 tokens, but 1 calls and 20 tokens are left',
    );
    expect(guard.refused()?.label).toBe('third');
    first.settle({ calls: 1, totalTokens: 30 });
    first.settle({ calls: 5, totalTokens: 500 });
    expect(guard.used()).toEqual({ calls: 1, totalTokens: 30 });
    expect(guard.left()).toEqual({ calls: 2, totalTokens: 70 });
    expect(guard.limits).toEqual({ maxCalls: 3, maxTotalTokens: 100 });
  });

  test('counts every schema retry of a guarded model with its reported usage', async () => {
    const guard = createSpendGuard({ maxCalls: 10, maxTotalTokens: 1_000_000 });
    const base = new MockLanguageModelV4({
      provider: 'openai.responses',
      doGenerate: [result('{"value":'), result()],
    });
    const response = await call(guard.wrap(base));
    expect(response.output).toEqual({ value: 'ok' });
    expect(guard.used()).toEqual({ calls: 2, totalTokens: 100 });
    expect(base.doGenerateCalls[0].maxOutputTokens).toBe(
      SPEND_GUARD_DEFAULT_MAX_OUTPUT_TOKENS,
    );
  });

  test('adds cached input to the usage when the provider reports no input total', async () => {
    const guard = createSpendGuard({ maxCalls: 1, maxTotalTokens: 1_000_000 });
    const base = new MockLanguageModelV4({
      provider: 'openai.responses',
      doGenerate: result(undefined, {
        inputTokens: {
          total: undefined,
          noCache: 5,
          cacheRead: 7,
          cacheWrite: 11,
        },
        outputTokens: { total: undefined },
      }),
    });
    await call(guard.wrap(base, { defaultMaxOutputTokens: 100 }));
    expect(guard.used()).toEqual({ calls: 1, totalTokens: 23 });
    expect(base.doGenerateCalls[0].maxOutputTokens).toBe(100);
    const empty = createSpendGuard({ maxCalls: 1, maxTotalTokens: 1_000_000 });
    await call(
      empty.wrap(
        new MockLanguageModelV4({
          provider: 'openai.responses',
          doGenerate: result(undefined, {
            inputTokens: {
              total: undefined,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 3 },
          }),
        }),
      ),
    );
    expect(empty.used()).toEqual({ calls: 1, totalTokens: 3 });
  });

  test('refuses an attempt before it is sent when the caps are reached by concurrent callers', async () => {
    const guard = createSpendGuard({ maxCalls: 4, maxTotalTokens: 1_000_000 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const base = new MockLanguageModelV4({
      provider: 'openai.responses',
      doGenerate: async () => {
        await gate;
        return result();
      },
    });
    const model = guard.wrap(base, { defaultMaxOutputTokens: 10 });
    const calls = Array.from({ length: 6 }, () =>
      call(model).then(
        () => 'ok',
        (e: Error) => e.name,
      ),
    );
    await Promise.resolve();
    release();
    const outcomes = await Promise.all(calls);
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(4);
    expect(base.doGenerateCalls).toHaveLength(4);
    expect(guard.used()).toEqual({ calls: 4, totalTokens: 200 });
  });

  test('keeps the whole worst case of a failed attempt and an explicit output limit', async () => {
    const guard = createSpendGuard({ maxCalls: 2, maxTotalTokens: 1_000_000 });
    const base = new MockLanguageModelV4({
      provider: 'openai.responses',
      doGenerate: async () => {
        throw new Error('provider down');
      },
    });
    const model = guard.wrap(base);
    const prompt = [
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'x' }],
      },
    ];
    await expect(
      model.doGenerate({ prompt, maxOutputTokens: 77 }),
    ).rejects.toThrow('provider down');
    expect(guard.used()).toEqual({
      calls: 1,
      totalTokens:
        spendInputTokenBound(JSON.stringify([prompt, null, null])) + 77,
    });
  });

  test('bounds input by UTF-8 bytes plus the attempt overhead', () => {
    expect(spendInputTokenBound('a한')).toBe(
      4 + SPEND_GUARD_ATTEMPT_OVERHEAD_TOKENS,
    );
  });

  test('refuses every later reservation once usage passes its reservation', () => {
    const guard = createSpendGuard({ maxCalls: 10, maxTotalTokens: 1_000 });
    guard.reserve('small', { calls: 1, totalTokens: 10 }).settle({
      calls: 1,
      totalTokens: 20,
    });
    expect(guard.used()).toEqual({ calls: 1, totalTokens: 20 });
    expect(guard.refused()?.message).toBe(
      'small was refused: small used 1 calls and 20 tokens of a 1-call, 10-token reservation',
    );
    expect(() => guard.reserve('next', { calls: 1, totalTokens: 1 })).toThrow(
      'next was refused: small used',
    );
    expect(guard.refused()?.label).toBe('next');
  });

  test('refuses a file given by URL or reference under caps', async () => {
    const guard = createSpendGuard({ maxCalls: 1, maxTotalTokens: 1_000_000 });
    const base = new MockLanguageModelV4({
      provider: 'openai.responses',
      doGenerate: result(),
    });
    const model = guard.wrap(base);
    const send = (data: unknown) =>
      model.doGenerate({
        prompt: [
          { role: 'system', content: 'system' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'x' },
              { type: 'file', data: data as never, mediaType: 'image/png' },
            ],
          },
        ],
      });
    await expect(
      send({ type: 'url', url: new URL('https://example.com/a.png') }),
    ).rejects.toThrow(
      'a file given by URL or reference has no size to reserve',
    );
    await expect(
      send({ type: 'reference', reference: { openai: 'file-1' } }),
    ).rejects.toThrow(SpendLimitError);
    expect(base.doGenerateCalls).toHaveLength(0);
    expect(guard.refused()?.label).toBe('mock-model-id');
    await send({ type: 'data', data: 'aGk=' });
    expect(guard.used()).toEqual({ calls: 1, totalTokens: 50 });
  });

  test('only counts without caps and leaves output limits to each call', async () => {
    const guard = createSpendGuard();
    expect(guard.limits).toEqual({
      maxCalls: Number.MAX_SAFE_INTEGER,
      maxTotalTokens: Number.MAX_SAFE_INTEGER,
    });
    const base = new MockLanguageModelV4({
      provider: 'openai.responses',
      doGenerate: result(),
    });
    const long = new MockLanguageModelV4({
      provider: 'openai.responses',
      doGenerate: result(undefined, {
        ...usage,
        outputTokens: { total: 5_000, text: 5_000, reasoning: 0 },
      }),
    });
    await call(guard.wrap(long));
    await call(guard.wrap(base, { defaultMaxOutputTokens: 100 }));
    expect(base.doGenerateCalls[0].maxOutputTokens).toBeUndefined();
    expect(guard.used()).toEqual({ calls: 2, totalTokens: 5_090 });
    expect(guard.refused()).toBeNull();
  });

  test('requires a model instance', () => {
    expect(() =>
      createSpendGuard({ maxCalls: 1, maxTotalTokens: 1 }).wrap('model-id'),
    ).toThrow('Guarded calls require a model instance');
  });
});
