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

  // Together
  {
    id: 'together/Qwen/Qwen3-235B-A22B-Instruct-2507-tput',
    label: 'Qwen3-235B',
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
];

export const VISION_MODELS = LLM_MODELS.filter((m) => m.hasVision);
