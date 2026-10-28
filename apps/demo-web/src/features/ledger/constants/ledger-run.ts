/** The model a ledger step uses unless another is chosen. */
export const DEFAULT_LEDGER_MODEL = 'anthropic/claude-haiku-5-5';
/** The model steps of an automatic ledger run, in run order, each with its own model. */
export const LEDGER_MODEL_STAGES = [
  { id: 'router', label: '보고서 유형 분류' },
  { id: 'discovery', label: '객체 후보 탐색' },
  { id: 'deduplication', label: '후보 중복 검토' },
  { id: 'attachment', label: '원문 배정' },
] as const;
export type LedgerModelStage = (typeof LEDGER_MODEL_STAGES)[number]['id'];
export type LedgerStageModels = Record<LedgerModelStage, string>;
/**
 * Every step defaults to Claude Haiku 5.5: on the evaluated reports, local Gemma 4 did not reach Haiku on any
 * step of the automatic run, and no step needed a larger model.
 */
export const DEFAULT_LEDGER_MODELS: LedgerStageModels = {
  router: DEFAULT_LEDGER_MODEL,
  discovery: DEFAULT_LEDGER_MODEL,
  deduplication: DEFAULT_LEDGER_MODEL,
  attachment: DEFAULT_LEDGER_MODEL,
};
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
