import type { LanguageModel } from 'ai';

import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import { LLMCaller } from './llm-caller';
import {
  supportsOpenAICacheBreakpoints,
  withRepeatedRequestCache,
  withSystemPromptCache,
} from './prompt-cache';

function model(provider: string, modelId?: string): LanguageModel {
  return { provider, modelId } as unknown as LanguageModel;
}

describe('withSystemPromptCache', () => {
  test('places an Anthropic breakpoint only at the end of the system prompt', () => {
    const providerOptions = { anthropic: { effort: 'low' } };
    expect(
      withSystemPromptCache(
        model('anthropic.messages', 'claude-haiku-5-5'),
        'System prompt',
        providerOptions,
      ),
    ).toEqual({
      instructions: {
        role: 'system',
        content: 'System prompt',
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      },
      // request-wide automatic caching stays off, so per-call user content is never written
      providerOptions,
    });
  });

  test('uses explicit mode for GPT 5.6+ and keeps existing options', () => {
    expect(
      withSystemPromptCache(
        model('openai.responses', 'gpt-6-luna'),
        'System prompt',
        { openai: { reasoningEffort: 'low' } },
      ),
    ).toEqual({
      instructions: {
        role: 'system',
        content: 'System prompt',
        providerOptions: {
          openai: { promptCacheBreakpoint: { mode: 'explicit' } },
        },
      },
      providerOptions: {
        openai: {
          reasoningEffort: 'low',
          promptCacheOptions: { mode: 'explicit' },
        },
      },
    });
  });

  test('makes no cache write for GPT 5.6+ calls without a system prompt', () => {
    expect(
      withSystemPromptCache(
        model('openai.chat', 'gpt-5.6-terra'),
        undefined,
        undefined,
      ),
    ).toEqual({
      providerOptions: { openai: { promptCacheOptions: { mode: 'explicit' } } },
    });
  });

  test.each([
    ['openai.responses', 'gpt-4.1', 'System prompt'],
    ['openai.responses', undefined, 'System prompt'],
    // Gemini caches the request prefix implicitly without settings
    ['google.generative-ai', 'gemini-3.8-flash', 'System prompt'],
    ['lmstudio.chat', 'gemma-4-26b-a4b-it-mlx', 'System prompt'],
    ['byok.chat', 'gpt-6-luna', 'System prompt'],
    ['anthropic.messages', 'claude-haiku-5-5', undefined],
  ])('leaves %s %s unchanged', (provider, modelId, systemPrompt) => {
    expect(
      withSystemPromptCache(model(provider, modelId), systemPrompt, undefined),
    ).toEqual(systemPrompt === undefined ? {} : { instructions: systemPrompt });
  });

  test('never overwrites an OpenAI cache mode chosen by the caller', () => {
    const providerOptions = {
      openai: { promptCacheOptions: { mode: 'implicit' as const } },
    };
    expect(
      withSystemPromptCache(
        model('openai.responses', 'gpt-6-luna'),
        'System prompt',
        providerOptions,
      ),
    ).toEqual({ instructions: 'System prompt', providerOptions });
  });
});

describe('withRepeatedRequestCache', () => {
  test('places Anthropic breakpoints at the end of the system and user prompts', () => {
    const breakpoint = { anthropic: { cacheControl: { type: 'ephemeral' } } };
    const providerOptions = { anthropic: { effort: 'low' } };
    expect(
      withRepeatedRequestCache(
        model('anthropic.messages', 'claude-haiku-5-5'),
        'System prompt',
        'User prompt',
        providerOptions,
      ),
    ).toEqual({
      instructions: {
        role: 'system',
        content: 'System prompt',
        providerOptions: breakpoint,
      },
      messages: [
        { role: 'user', content: 'User prompt', providerOptions: breakpoint },
      ],
      providerOptions,
    });
  });

  test('sends no provider options to Anthropic when none are given', () => {
    expect(
      withRepeatedRequestCache(
        model('anthropic.messages', 'claude-haiku-5-5'),
        'System prompt',
        'User prompt',
        undefined,
      ),
    ).not.toHaveProperty('providerOptions');
  });

  test.each([
    // the implicit mode already caches up to the end of the last user message
    ['openai.responses', 'gpt-6-luna'],
    ['google.generative-ai', 'gemini-3.8-flash'],
  ])('leaves %s %s unchanged', (provider, modelId) => {
    expect(
      withRepeatedRequestCache(
        model(provider, modelId),
        'System prompt',
        'User prompt',
        undefined,
      ),
    ).toEqual({ instructions: 'System prompt', prompt: 'User prompt' });
  });

  test('keeps provider options for other providers', () => {
    const providerOptions = { openai: { reasoningEffort: 'low' } };
    expect(
      withRepeatedRequestCache(
        model('openai.responses', 'gpt-6-luna'),
        'System prompt',
        'User prompt',
        providerOptions,
      ),
    ).toEqual({
      instructions: 'System prompt',
      prompt: 'User prompt',
      providerOptions,
    });
  });
});

test.each([
  ['gpt-5.6-terra', true],
  ['openai/gpt-6.1-sol', true],
  ['gpt-6-luna', true],
  ['gpt-5.5', false],
  ['gpt-5', false],
  ['gpt-4.1', false],
  ['o3-mini', false],
])('cache breakpoint support of %s is %s', (modelId, expected) => {
  expect(supportsOpenAICacheBreakpoints(modelId)).toBe(expected);
});

function mockModel(provider: string, modelId: string) {
  return new MockLanguageModelV4({
    provider,
    modelId,
    doGenerate: async () => ({
      content: [{ type: 'text', text: '{"value":"ok"}' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: {
          total: 8,
          noCache: undefined,
          cacheRead: 0,
          cacheWrite: 0,
        },
        outputTokens: { total: 2, text: undefined, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

test('LLMCaller sends the cache breakpoint on the system message of the actual request', async () => {
  const anthropic = mockModel('anthropic.messages', 'claude-haiku-5-5');
  await LLMCaller.call({
    schema: z.object({ value: z.string() }),
    systemPrompt: 'System prompt',
    userPrompt: 'User content',
    primaryModel: anthropic,
    maxRetries: 0,
    component: 'Test',
    phase: 'test',
  });
  const prompt = anthropic.doGenerateCalls[0].prompt;
  expect(prompt[0]).toMatchObject({
    role: 'system',
    content: 'System prompt',
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
  });
  // the per-call user content carries no breakpoint
  expect(prompt[1].providerOptions).toBeUndefined();

  const openai = mockModel('openai.responses', 'gpt-6-luna');
  await LLMCaller.callVision({
    schema: z.object({ value: z.string() }),
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Page' }] }],
    primaryModel: openai,
    maxRetries: 0,
    component: 'Test',
    phase: 'test',
  });
  expect(openai.doGenerateCalls[0].providerOptions).toEqual({
    openai: { promptCacheOptions: { mode: 'explicit' } },
  });
});
