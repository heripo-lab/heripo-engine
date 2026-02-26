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
    // Together - Vision
    'moonshotai/Kimi-K2.5': { input: 0.5, output: 2.8 },
    'Qwen/Qwen3.5-397B-A17B': { input: 0.6, output: 3.6 },
    'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8': {
      input: 0.27,
      output: 0.85,
    },
    'Qwen/Qwen2.5-VL-72B-Instruct': { input: 1.95, output: 8 },
    'Qwen/Qwen3-VL-32B-Instruct': { input: 0.5, output: 1.5 },
    'mistralai/Ministral-3-14B-Instruct-2512': { input: 0.2, output: 0.2 },
    'Qwen/Qwen3-VL-8B-Instruct': { input: 0.18, output: 0.68 },
    'google/gemma-3n-E4B-it': { input: 0.02, output: 0.04 },
    // Together - Non-Vision
    'deepseek-ai/DeepSeek-V3-0324': { input: 1.25, output: 1.25 },
    'deepseek-ai/DeepSeek-R1': { input: 3, output: 7 },
    'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8': { input: 2, output: 2 },
    'zai-org/GLM-5': { input: 1, output: 3.2 },
    'zai-org/GLM-4.7': { input: 0.45, output: 2 },
    'Qwen/Qwen3-235B-A22B-Thinking-2507': { input: 0.65, output: 3 },
    'MiniMaxAI/MiniMax-M2.5': { input: 0.3, output: 1.2 },
    'zai-org/GLM-4.5-Air-FP8': { input: 0.2, output: 1.1 },
    'Qwen/Qwen3-Next-80B-A3B-Thinking': { input: 0.15, output: 1.5 },
    'Qwen/Qwen3-Coder-Next-FP8': { input: 0.5, output: 1.2 },
    'meta-llama/Llama-3.3-70B-Instruct-Turbo': { input: 0.88, output: 0.88 },
    'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo': {
      input: 0.88,
      output: 0.88,
    },
    'arcee-ai/trinity-mini': { input: 0.045, output: 0.15 },
    'LiquidAI/LFM2-24B-A2B': { input: 0.03, output: 0.12 },
    'openai/gpt-oss-20b': { input: 0.05, output: 0.2 },
    'nvidia/NVIDIA-Nemotron-Nano-9B-v2': { input: 0.06, output: 0.25 },
    'essentialai/rnj-1-instruct': { input: 0.15, output: 0.15 },
    'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo': {
      input: 0.18,
      output: 0.18,
    },
    'meta-llama/Llama-3.2-3B-Instruct-Turbo': { input: 0.06, output: 0.06 },
    // OpenAI
    'openai/gpt-oss-120b': { input: 0.15, output: 0.6 },
    'gpt-5.1': { input: 1.25, output: 10 },
    'gpt-5.2': { input: 1.75, output: 14 },
    'gpt-5-mini': { input: 0.25, output: 2 },
    // Google
    'gemini-3-flash-preview': { input: 0.5, output: 3 },
    'gemini-3.1-pro-preview': { input: 2, output: 12 },
    // Claude
    'anthropic/claude-opus-4-6': { input: 5, output: 25 },
    'anthropic/claude-sonnet-4-6': { input: 3, output: 15 },
    'anthropic/claude-haiku-4-5': { input: 1, output: 5 },
    // VLM strategy models (provider-prefixed keys from TokenUsageReport)
    'openai/gpt-5.2': { input: 1.75, output: 14 },
    'openai/gpt-5.1': { input: 1.25, output: 10 },
    'openai/gpt-5-mini': { input: 0.25, output: 2 },
    'google/gemini-3.1-pro-preview': { input: 2, output: 12 },
    'google/gemini-3-flash-preview': { input: 0.5, output: 3 },
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
