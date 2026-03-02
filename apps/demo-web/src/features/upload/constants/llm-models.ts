export interface LLMModel {
  id: string;
  label: string;
  provider: string;
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
  },
  {
    id: 'openai/gpt-5.1',
    label: 'GPT-5.1',
    provider: 'OpenAI',
  },
  {
    id: 'openai/gpt-5-mini',
    label: 'GPT-5 Mini',
    provider: 'OpenAI',
  },

  // Anthropic
  {
    id: 'anthropic/claude-opus-4-6',
    label: 'Claude Opus 4.6',
    provider: 'Anthropic',
  },
  {
    id: 'anthropic/claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
  },
  {
    id: 'anthropic/claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    provider: 'Anthropic',
  },

  // Google
  {
    id: 'google/gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview',
    provider: 'Google',
  },
  {
    id: 'google/gemini-3-flash-preview',
    label: 'Gemini 3 Flash Preview',
    provider: 'Google',
  },

  // Together (sorted by params descending)
  {
    id: 'together/meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
    label: 'Llama 4 Maverick',
    provider: 'Together',
  },
  {
    id: 'together/Qwen/Qwen3-VL-32B-Instruct',
    label: 'Qwen3-VL-32B',
    provider: 'Together',
  },
  {
    id: 'together/mistralai/Ministral-3-14B-Instruct-2512',
    label: 'Ministral 3 14B',
    provider: 'Together',
  },
  {
    id: 'together/Qwen/Qwen3-VL-8B-Instruct',
    label: 'Qwen3-VL-8B',
    provider: 'Together',
  },
  {
    id: 'together/deepseek-ai/DeepSeek-V3-0324',
    label: 'DeepSeek V3 0324',
    provider: 'Together',
  },
  {
    id: 'together/deepseek-ai/DeepSeek-R1',
    label: 'DeepSeek R1',
    provider: 'Together',
  },
  {
    id: 'together/deepseek-ai/DeepSeek-V3.1',
    label: 'DeepSeek V3.1',
    provider: 'Together',
  },
  {
    id: 'together/deepcogito/cogito-v2-1-671b',
    label: 'Cogito v2.1 671B',
    provider: 'Together',
  },
  {
    id: 'together/Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8',
    label: 'Qwen3 Coder 480B',
    provider: 'Together',
  },
  {
    id: 'together/zai-org/GLM-5',
    label: 'GLM-5 FP4',
    provider: 'Together',
  },
  {
    id: 'together/zai-org/GLM-4.7',
    label: 'GLM 4.7 FP8',
    provider: 'Together',
  },
  {
    id: 'together/Qwen/Qwen3-235B-A22B-Instruct-2507-tput',
    label: 'Qwen3-235B Instruct',
    provider: 'Together',
  },
  {
    id: 'together/Qwen/Qwen3-235B-A22B-Thinking-2507',
    label: 'Qwen3-235B Thinking',
    provider: 'Together',
  },
  {
    id: 'together/MiniMaxAI/MiniMax-M2.5',
    label: 'MiniMax M2.5 FP4',
    provider: 'Together',
  },
  {
    id: 'together/openai/gpt-oss-120b',
    label: 'OpenAI GPT-OSS 120B',
    provider: 'Together',
  },
  {
    id: 'together/zai-org/GLM-4.5-Air-FP8',
    label: 'GLM 4.5 Air FP8',
    provider: 'Together',
  },
  {
    id: 'together/Qwen/Qwen3-Next-80B-A3B-Thinking',
    label: 'Qwen3 Next 80B Thinking',
    provider: 'Together',
  },
  {
    id: 'together/Qwen/Qwen3-Coder-Next-FP8',
    label: 'Qwen3 Coder Next FP8',
    provider: 'Together',
  },
  {
    id: 'together/meta-llama/Llama-3.3-70B-Instruct-Turbo',
    label: 'Llama 3.3 70B',
    provider: 'Together',
  },
  {
    id: 'together/meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    label: 'Llama 3.1 70B',
    provider: 'Together',
  },
  {
    id: 'together/arcee-ai/trinity-mini',
    label: 'Trinity Mini',
    provider: 'Together',
  },
  {
    id: 'together/LiquidAI/LFM2-24B-A2B',
    label: 'LFM2-24B',
    provider: 'Together',
  },
  {
    id: 'together/openai/gpt-oss-20b',
    label: 'GPT-OSS 20B',
    provider: 'Together',
  },
  {
    id: 'together/nvidia/NVIDIA-Nemotron-Nano-9B-v2',
    label: 'Nemotron Nano 9B',
    provider: 'Together',
  },
  {
    id: 'together/essentialai/rnj-1-instruct',
    label: 'Rnj-1 Instruct',
    provider: 'Together',
  },
  {
    id: 'together/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    label: 'Llama 3.1 8B',
    provider: 'Together',
  },
  {
    id: 'together/meta-llama/Llama-3.2-3B-Instruct-Turbo',
    label: 'Llama 3.2 3B',
    provider: 'Together',
  },
];
