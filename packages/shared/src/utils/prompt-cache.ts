import type {
  LanguageModel,
  ModelMessage,
  SystemModelMessage,
  generateText,
} from 'ai';

import { detectProvider } from './provider-detector';

type ProviderOptions = Parameters<typeof generateText>[0]['providerOptions'];

/**
 * Place the prompt-cache breakpoint only at the end of the system prompt.
 *
 * Caching the per-call user content as well pays the cache-write premium for writes that are never read.
 * - Anthropic: nothing is cached by default, so the system prompt gets a breakpoint. A prompt below the
 *   provider's minimum length is not cached and is not charged as a write.
 * - OpenAI GPT 5.6 and later: the default implicit mode places the breakpoint at the end of the last user
 *   message and writes the whole input at 1.25x on every call. Explicit mode places it only at the end of the
 *   system prompt; without a system prompt, no cache write is made.
 * - Google Gemini (2.5 and later): caches the request prefix implicitly without settings or write charges.
 *   The system prompt comes first in the request, so it is left as is. Explicit caching (cachedContents)
 *   charges storage per hour, needs cache objects to be managed and suits large fixed content above a
 *   per-model minimum (1,024–4,096 tokens), not short system prompts.
 * - Other providers are left as is. An OpenAI cache mode chosen by the caller is never overwritten.
 */
export function withSystemPromptCache(
  model: LanguageModel,
  systemPrompt: string | undefined,
  providerOptions: ProviderOptions,
): {
  instructions?: string | SystemModelMessage;
  providerOptions?: ProviderOptions;
} {
  const unchanged = {
    ...(systemPrompt === undefined ? {} : { instructions: systemPrompt }),
    ...(providerOptions === undefined ? {} : { providerOptions }),
  };
  const provider = detectProvider(model);
  if (provider === 'anthropic')
    return systemPrompt
      ? {
          ...unchanged,
          instructions: cachedSystem(systemPrompt, {
            anthropic: { cacheControl: { type: 'ephemeral' } },
          }),
        }
      : unchanged;
  if (
    provider !== 'openai' ||
    !supportsOpenAICacheBreakpoints(modelIdOf(model)) ||
    providerOptions?.openai?.promptCacheOptions !== undefined
  )
    return unchanged;
  return {
    ...(systemPrompt
      ? {
          instructions: cachedSystem(systemPrompt, {
            openai: { promptCacheBreakpoint: { mode: 'explicit' } },
          }),
        }
      : unchanged),
    providerOptions: {
      ...providerOptions,
      openai: {
        ...providerOptions?.openai,
        promptCacheOptions: { mode: 'explicit' },
      },
    },
  };
}

/**
 * Cache the whole request, for a request sent again unchanged once an earlier answer has returned (such as r2
 * after r1). Use `withSystemPromptCache` when the user prompt changes per call or the copies are sent together:
 * then nothing could read the user prompt from the cache.
 * - Anthropic: breakpoints at the end of the system prompt, which other requests sharing it can read, and at the
 *   end of the user prompt, which the repeated request reads.
 * - Other providers are left as is. OpenAI's default implicit mode already places the breakpoint at the end of
 *   the last user message.
 */
export function withRepeatedRequestCache(
  model: LanguageModel,
  systemPrompt: string,
  userPrompt: string,
  providerOptions: ProviderOptions,
): {
  instructions: string | SystemModelMessage;
  providerOptions?: ProviderOptions;
} & ({ prompt: string } | { messages: ModelMessage[] }) {
  const anthropicBreakpoint = {
    anthropic: { cacheControl: { type: 'ephemeral' } },
  };
  if (detectProvider(model) === 'anthropic')
    return {
      ...(providerOptions === undefined ? {} : { providerOptions }),
      instructions: cachedSystem(systemPrompt, anthropicBreakpoint),
      messages: [
        {
          role: 'user',
          content: userPrompt,
          providerOptions: anthropicBreakpoint,
        },
      ],
    };
  return {
    instructions: systemPrompt,
    prompt: userPrompt,
    ...(providerOptions === undefined ? {} : { providerOptions }),
  };
}

function cachedSystem(
  content: string,
  providerOptions: SystemModelMessage['providerOptions'],
): SystemModelMessage {
  return { role: 'system', content, providerOptions };
}

function modelIdOf(model: LanguageModel): string {
  const modelId = (model as { modelId?: unknown }).modelId;
  return typeof modelId === 'string' ? modelId : '';
}

/**
 * GPT 5.6 and later support explicit cache breakpoints. Major and minor versions are compared as numbers, so
 * new models need no allow-list update.
 * https://developers.openai.com/api/docs/guides/prompt-caching
 */
export function supportsOpenAICacheBreakpoints(modelId: string): boolean {
  const version = /^(?:openai\/)?gpt-(\d+)(?:\.(\d+))?(?:-.+)?$/u.exec(modelId);
  if (!version) return false;
  const major = Number(version[1]);
  const minor = Number(version[2] ?? 0);
  return major > 5 || (major === 5 && minor >= 6);
}
