export interface LLMModel {
  id: string;
  label: string;
  provider: string;
  hasVision: boolean;
}

/**
 * LLM Models tested for this project.
 * These are models that have been directly tested and found to be reasonably capable.
 */
export const LLM_MODELS: LLMModel[] = [
  // OpenAI
  {
    id: 'openai/gpt-5.2',
    label: 'GPT-5.2',
    provider: 'OpenAI',
    hasVision: true,
  },
  {
    id: 'openai/gpt-5.1',
    label: 'GPT-5.1',
    provider: 'OpenAI',
    hasVision: true,
  },
  {
    id: 'openai/gpt-5-mini',
    label: 'GPT-5 Mini',
    provider: 'OpenAI',
    hasVision: true,
  },

  // Anthropic
  {
    id: 'anthropic/claude-opus-4.6',
    label: 'Claude Opus 4.6',
    provider: 'Anthropic',
    hasVision: true,
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    label: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    hasVision: true,
  },
  {
    id: 'anthropic/claude-haiku-4.6',
    label: 'Claude Haiku 4.6',
    provider: 'Anthropic',
    hasVision: true,
  },

  // Google
  {
    id: 'google/gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview',
    provider: 'Google',
    hasVision: true,
  },
  {
    id: 'google/gemini-3-flash-preview',
    label: 'Gemini 3 Flash Preview',
    provider: 'Google',
    hasVision: true,
  },

  // Together — Vision models (sorted by params descending)
  {
    id: 'together/moonshotai/Kimi-K2.5',
    label: 'Kimi K2.5 (Vision)',
    provider: 'Together',
    hasVision: true,
  },
  {
    id: 'together/Qwen/Qwen3.5-397B-A17B',
    label: 'Qwen3.5-397B (Vision)',
    provider: 'Together',
    hasVision: true,
  },
  {
    id: 'together/meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
    label: 'Llama 4 Maverick (Vision)',
    provider: 'Together',
    hasVision: true,
  },
  {
    id: 'together/Qwen/Qwen2.5-VL-72B-Instruct',
    label: 'Qwen2.5-VL-72B (Vision)',
    provider: 'Together',
    hasVision: true,
  },
  {
    id: 'together/Qwen/Qwen3-VL-32B-Instruct',
    label: 'Qwen3-VL-32B (Vision)',
    provider: 'Together',
    hasVision: true,
  },
  {
    id: 'together/mistralai/Ministral-3-14B-Instruct-2512',
    label: 'Ministral 3 14B (Vision)',
    provider: 'Together',
    hasVision: true,
  },
  {
    id: 'together/Qwen/Qwen3-VL-8B-Instruct',
    label: 'Qwen3-VL-8B (Vision)',
    provider: 'Together',
    hasVision: true,
  },
  {
    id: 'together/google/gemma-3n-E4B-it',
    label: 'Gemma 3N E4B (Vision)',
    provider: 'Together',
    hasVision: true,
  },

  // Together — Non-Vision models (sorted by params descending)
  {
    id: 'together/deepseek-ai/DeepSeek-V3-0324',
    label: 'DeepSeek V3 0324',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/deepseek-ai/DeepSeek-R1',
    label: 'DeepSeek R1',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/deepseek-ai/DeepSeek-V3.1',
    label: 'DeepSeek V3.1',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/deepcogito/cogito-v2-1-671b',
    label: 'Cogito v2.1 671B',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8',
    label: 'Qwen3 Coder 480B',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/zai-org/GLM-5',
    label: 'GLM-5 FP4',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/zai-org/GLM-4.7',
    label: 'GLM 4.7 FP8',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/Qwen/Qwen3-235B-A22B-Instruct-2507-tput',
    label: 'Qwen3-235B Instruct',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/Qwen/Qwen3-235B-A22B-Thinking-2507',
    label: 'Qwen3-235B Thinking',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/MiniMaxAI/MiniMax-M2.5',
    label: 'MiniMax M2.5 FP4',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/openai/gpt-oss-120b',
    label: 'OpenAI GPT-OSS 120B',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/zai-org/GLM-4.5-Air-FP8',
    label: 'GLM 4.5 Air FP8',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/Qwen/Qwen3-Next-80B-A3B-Thinking',
    label: 'Qwen3 Next 80B Thinking',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/Qwen/Qwen3-Coder-Next-FP8',
    label: 'Qwen3 Coder Next FP8',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/meta-llama/Llama-3.3-70B-Instruct-Turbo',
    label: 'Llama 3.3 70B',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    label: 'Llama 3.1 70B',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/arcee-ai/trinity-mini',
    label: 'Trinity Mini',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/LiquidAI/LFM2-24B-A2B',
    label: 'LFM2-24B',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/openai/gpt-oss-20b',
    label: 'GPT-OSS 20B',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/nvidia/NVIDIA-Nemotron-Nano-9B-v2',
    label: 'Nemotron Nano 9B',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/essentialai/rnj-1-instruct',
    label: 'Rnj-1 Instruct',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    label: 'Llama 3.1 8B',
    provider: 'Together',
    hasVision: false,
  },
  {
    id: 'together/meta-llama/Llama-3.2-3B-Instruct-Turbo',
    label: 'Llama 3.2 3B',
    provider: 'Together',
    hasVision: false,
  },
];

export const VISION_MODELS = LLM_MODELS.filter((m) => m.hasVision);
