/** The model a ledger run uses for every model step unless another is chosen. */
export const DEFAULT_LEDGER_MODEL = 'anthropic/claude-haiku-5-5';
/**
 * Hard caps for one automatic ledger run over all model steps (report router, candidate discovery and
 * duplicate review, thin content attachment). A step that would exceed what is left is not started.
 */
export const LEDGER_RUN_BUDGET = { maxCalls: 600, maxTotalTokens: 13_000_000 };
/**
 * Characters per body unit of candidate discovery. Local models (LM Studio, Ollama) stop early on long inputs, so
 * their body units are smaller; this changes only how the text is split, not the prompt.
 */
export const DISCOVERY_MAX_TEXT_CHARS = { default: 8000, local: 2500 };

/** The body-unit size of candidate discovery for a model ID such as "lmstudio/gemma-4-26b-a4b-it-mlx". */
export function discoveryMaxTextChars(modelId: string) {
  return /^(?:lmstudio|ollama)\//.test(modelId)
    ? DISCOVERY_MAX_TEXT_CHARS.local
    : DISCOVERY_MAX_TEXT_CHARS.default;
}
