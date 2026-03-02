import type { LanguageModel } from 'ai';

import { describe, expect, test } from 'vitest';

import { detectProvider } from './provider-detector';

function createModelWithProvider(provider: string): LanguageModel {
  return { provider } as unknown as LanguageModel;
}

describe('detectProvider', () => {
  test('detects OpenAI provider', () => {
    expect(detectProvider(createModelWithProvider('openai.chat'))).toBe(
      'openai',
    );
  });

  test('detects Google provider', () => {
    expect(
      detectProvider(createModelWithProvider('google.generative-ai')),
    ).toBe('google');
  });

  test('detects Anthropic provider', () => {
    expect(detectProvider(createModelWithProvider('anthropic.messages'))).toBe(
      'anthropic',
    );
  });

  test('detects Together AI provider', () => {
    expect(detectProvider(createModelWithProvider('togetherai.chat'))).toBe(
      'togetherai',
    );
  });

  test('returns unknown for unrecognized provider string', () => {
    expect(
      detectProvider(createModelWithProvider('some-custom-provider')),
    ).toBe('unknown');
  });

  test('returns unknown when provider field is missing', () => {
    expect(detectProvider({} as LanguageModel)).toBe('unknown');
  });

  test('returns unknown when provider field is not a string', () => {
    expect(detectProvider({ provider: 123 } as unknown as LanguageModel)).toBe(
      'unknown',
    );
  });

  test('returns unknown when provider field is empty string', () => {
    expect(detectProvider(createModelWithProvider(''))).toBe('unknown');
  });

  test('detects provider with partial match (e.g., openai-compatible)', () => {
    expect(detectProvider(createModelWithProvider('openai-compatible'))).toBe(
      'openai',
    );
  });

  test('detects together when embedded in longer string', () => {
    expect(detectProvider(createModelWithProvider('together.xyz'))).toBe(
      'togetherai',
    );
  });
});
