import type { LanguageModel } from 'ai';

export type ProviderType =
  | 'openai'
  | 'google'
  | 'anthropic'
  | 'togetherai'
  | 'unknown';

/**
 * Detect the provider type from a LanguageModel instance.
 *
 * Reads the `provider` field of the model object and matches it against
 * known provider identifiers. Falls back to 'unknown' if unrecognized.
 */
export function detectProvider(model: LanguageModel): ProviderType {
  const providerId = (model as { provider?: string }).provider;
  if (!providerId || typeof providerId !== 'string') return 'unknown';

  if (providerId.includes('openai')) return 'openai';
  if (providerId.includes('google')) return 'google';
  if (providerId.includes('anthropic')) return 'anthropic';
  if (providerId.includes('together')) return 'togetherai';

  return 'unknown';
}
