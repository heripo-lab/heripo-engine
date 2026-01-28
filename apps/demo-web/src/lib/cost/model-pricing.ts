/**
 * Model pricing configuration for cost calculation
 *
 * Prices are in USD per 1 million tokens.
 * Models not in this list will default to $0.
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> =
  {
    // Together
    'deepseek-ai/DeepSeek-V3.1': { input: 0.6, output: 1.7 },
    'deepcogito/cogito-v2-1-671b': { input: 1.25, output: 1.25 },
    'Qwen/Qwen3-235B-A22B-Instruct-2507-tput': { input: 0.2, output: 0.6 },
    // OpenAI
    'openai/gpt-oss-120b': { input: 0.15, output: 0.6 },
    'gpt-5.1': { input: 1.25, output: 10 },
    'gpt-5.2': { input: 1.75, output: 14 },
    'gpt-5-mini': { input: 0.25, output: 2 },
    // Google
    'gemini-3-flash-preview': { input: 0.5, output: 3 },
    'gemini-3-pro-preview': { input: 2, output: 12 },
    // Claude
    'anthropic/claude-opus-4.5': { input: 5, output: 25 },
    'anthropic/claude-sonnet-4.5': { input: 3, output: 15 },
    'anthropic/claude-haiku-4.5': { input: 1, output: 5 },
  };

/**
 * Calculate cost for a model's token usage
 *
 * @param modelName - The model identifier
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @returns Cost in USD (0 if model not in pricing table)
 */
export function calculateCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[modelName];
  if (!pricing) return 0;
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}
