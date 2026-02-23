import type { VlmModelApi, VlmModelLocal } from 'docling-sdk';

// ── Local VLM Model Types & Presets ─────────────────────────────────────

/**
 * VLM model preset with description
 */
export interface VlmModelPreset {
  repo_id: string;
  inference_framework: 'mlx' | 'transformers';
  response_format: 'doctags' | 'markdown';
  transformers_model_type: 'automodel-vision2seq' | 'automodel';
  description: string;
}

/**
 * Available VLM model presets
 *
 * Based on Docling's official VLM model specs:
 * https://docling-project.github.io/docling/usage/vision_models/#available-local-models
 *
 * Users can select a preset key or provide a custom VlmModelLocal object.
 */
export const VLM_MODELS: Record<string, VlmModelPreset> = {
  // ── DocTags models (specialized document structure output) ──────────

  'granite-docling-258M-mlx': {
    repo_id: 'ibm-granite/granite-docling-258M-mlx',
    inference_framework: 'mlx',
    response_format: 'doctags',
    transformers_model_type: 'automodel-vision2seq',
    description:
      'Granite Docling 258M (MLX, Apple Silicon optimized, ~6s/page)',
  },
  'granite-docling-258M': {
    repo_id: 'ibm-granite/granite-docling-258M',
    inference_framework: 'transformers',
    response_format: 'doctags',
    transformers_model_type: 'automodel-vision2seq',
    description: 'Granite Docling 258M (Transformers, cross-platform)',
  },
  'smoldocling-256M-mlx': {
    repo_id: 'docling-project/SmolDocling-256M-preview-mlx-bf16',
    inference_framework: 'mlx',
    response_format: 'doctags',
    transformers_model_type: 'automodel-vision2seq',
    description: 'SmolDocling 256M (MLX, fastest option)',
  },
  'smoldocling-256M': {
    repo_id: 'docling-project/SmolDocling-256M-preview',
    inference_framework: 'transformers',
    response_format: 'doctags',
    transformers_model_type: 'automodel-vision2seq',
    description: 'SmolDocling 256M (Transformers)',
  },

  // ── Markdown models (general-purpose vision LLMs) ──────────────────

  'granite-vision-2B': {
    repo_id: 'ibm-granite/granite-vision-3.2-2b',
    inference_framework: 'transformers',
    response_format: 'markdown',
    transformers_model_type: 'automodel-vision2seq',
    description: 'Granite Vision 3.2 2B (IBM, higher accuracy)',
  },
  'qwen25-vl-3B-mlx': {
    repo_id: 'mlx-community/Qwen2.5-VL-3B-Instruct-bf16',
    inference_framework: 'mlx',
    response_format: 'markdown',
    transformers_model_type: 'automodel-vision2seq',
    description: 'Qwen 2.5 VL 3B (MLX, multilingual, good KCJ support)',
  },
  phi4: {
    repo_id: 'microsoft/Phi-4-multimodal-instruct',
    inference_framework: 'transformers',
    response_format: 'markdown',
    transformers_model_type: 'automodel',
    description: 'Phi-4 Multimodal (Microsoft, CausalLM)',
  },
  'pixtral-12B-mlx': {
    repo_id: 'mlx-community/pixtral-12b-bf16',
    inference_framework: 'mlx',
    response_format: 'markdown',
    transformers_model_type: 'automodel-vision2seq',
    description: 'Pixtral 12B (MLX, Mistral, high accuracy)',
  },
  'pixtral-12B': {
    repo_id: 'mistral-community/pixtral-12b',
    inference_framework: 'transformers',
    response_format: 'markdown',
    transformers_model_type: 'automodel-vision2seq',
    description: 'Pixtral 12B (Transformers, Mistral)',
  },
  got2: {
    repo_id: 'stepfun-ai/GOT-OCR-2.0-hf',
    inference_framework: 'transformers',
    response_format: 'markdown',
    transformers_model_type: 'automodel-vision2seq',
    description: 'GOT-OCR 2.0 (StepFun, OCR-specialized)',
  },
  'gemma3-12B-mlx': {
    repo_id: 'mlx-community/gemma-3-12b-it-bf16',
    inference_framework: 'mlx',
    response_format: 'markdown',
    transformers_model_type: 'automodel-vision2seq',
    description: 'Gemma 3 12B (MLX, Google)',
  },
  'gemma3-27B-mlx': {
    repo_id: 'mlx-community/gemma-3-27b-it-bf16',
    inference_framework: 'mlx',
    response_format: 'markdown',
    transformers_model_type: 'automodel-vision2seq',
    description: 'Gemma 3 27B (MLX, Google, highest accuracy)',
  },
  dolphin: {
    repo_id: 'ByteDance/Dolphin',
    inference_framework: 'transformers',
    response_format: 'markdown',
    transformers_model_type: 'automodel-vision2seq',
    description: 'Dolphin (ByteDance, document-oriented)',
  },
} as const;

/**
 * Default VLM model preset key
 */
export const DEFAULT_VLM_MODEL = 'granite-docling-258M-mlx';

/**
 * Resolve a VLM model from a preset key or custom VlmModelLocal object.
 *
 * When using a preset key, only required fields are populated.
 * Optional fields (prompt, scale, extra_generation_config) use Docling defaults.
 */
export function resolveVlmModel(model: string | VlmModelLocal): VlmModelLocal {
  if (typeof model === 'string') {
    const preset = VLM_MODELS[model];
    if (!preset) {
      throw new Error(
        `Unknown VLM model preset: "${model}". Available presets: ${Object.keys(VLM_MODELS).join(', ')}`,
      );
    }
    return {
      repo_id: preset.repo_id,
      inference_framework: preset.inference_framework,
      response_format: preset.response_format,
      transformers_model_type: preset.transformers_model_type,
    } as VlmModelLocal;
  }
  return model;
}

// ── API VLM Model Types & Presets ───────────────────────────────────────

/**
 * Supported API VLM provider identifiers
 */
export type VlmApiProvider = 'openai' | 'anthropic' | 'google' | 'together';

/**
 * API VLM provider configuration
 */
export interface VlmApiProviderConfig {
  /** OpenAI-compatible chat completions endpoint URL */
  url: string;
  /** Environment variable name for the API key */
  apiKeyEnvVar: string;
  /** Display name of the provider */
  displayName: string;
}

/**
 * API VLM model preset for remote vision-capable models accessed via HTTP API.
 */
export interface VlmApiModelPreset {
  /** Model identifier passed to the API (e.g., 'gpt-5.2') */
  model_id: string;
  /** Provider key for endpoint/auth lookup */
  provider: VlmApiProvider;
  /** Response format the model should return */
  response_format: 'doctags' | 'markdown';
  /** Human-readable description */
  description: string;
}

/**
 * API VLM provider endpoint configurations.
 * All providers use OpenAI-compatible chat completions API with Bearer token auth.
 */
export const VLM_API_PROVIDERS: Record<VlmApiProvider, VlmApiProviderConfig> = {
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    displayName: 'OpenAI',
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/chat/completions',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    displayName: 'Anthropic',
  },
  google: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    apiKeyEnvVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
    displayName: 'Google',
  },
  together: {
    url: 'https://api.together.xyz/v1/chat/completions',
    apiKeyEnvVar: 'TOGETHER_AI_API_KEY',
    displayName: 'Together AI',
  },
};

/**
 * Available API VLM model presets.
 *
 * These models are accessed via OpenAI-compatible HTTP API endpoints.
 * Users can select a preset key or provide a custom VlmModelApi object.
 *
 * @see https://docling-project.github.io/docling/examples/vlm_pipeline_api_model/
 */
export const VLM_API_MODELS: Record<string, VlmApiModelPreset> = {
  // ── OpenAI ────────────────────────────────────────────────────────────

  'openai/gpt-5.2': {
    model_id: 'gpt-5.2',
    provider: 'openai',
    response_format: 'markdown',
    description: 'GPT-5.2 (OpenAI, highest accuracy)',
  },
  'openai/gpt-5.1': {
    model_id: 'gpt-5.1',
    provider: 'openai',
    response_format: 'markdown',
    description: 'GPT-5.1 (OpenAI, balanced)',
  },
  'openai/gpt-5-mini': {
    model_id: 'gpt-5-mini',
    provider: 'openai',
    response_format: 'markdown',
    description: 'GPT-5 Mini (OpenAI, fast & cost-effective)',
  },

  // ── Anthropic ─────────────────────────────────────────────────────────

  'anthropic/claude-opus-4.6': {
    model_id: 'claude-opus-4.6',
    provider: 'anthropic',
    response_format: 'markdown',
    description: 'Claude Opus 4.6 (Anthropic, highest accuracy)',
  },
  'anthropic/claude-sonnet-4.6': {
    model_id: 'claude-sonnet-4.6',
    provider: 'anthropic',
    response_format: 'markdown',
    description: 'Claude Sonnet 4.6 (Anthropic, balanced)',
  },
  'anthropic/claude-haiku-4.6': {
    model_id: 'claude-haiku-4.6',
    provider: 'anthropic',
    response_format: 'markdown',
    description: 'Claude Haiku 4.6 (Anthropic, fast & cost-effective)',
  },

  // ── Google ────────────────────────────────────────────────────────────

  'google/gemini-3.1-pro-preview': {
    model_id: 'gemini-3.1-pro-preview',
    provider: 'google',
    response_format: 'markdown',
    description: 'Gemini 3.1 Pro Preview (Google, high accuracy)',
  },
  'google/gemini-3-flash-preview': {
    model_id: 'gemini-3-flash-preview',
    provider: 'google',
    response_format: 'markdown',
    description: 'Gemini 3 Flash Preview (Google, fast & cost-effective)',
  },

  // Together AI vision models will be added here
} as const;

/**
 * Default prompt templates for API VLM models.
 * These instruct the VLM on how to convert the document page image.
 */
export const VLM_API_PROMPTS = {
  markdown:
    'Convert the provided document page image into clean Markdown format. ' +
    'Extract all text content preserving the document structure including headings, ' +
    'tables, lists, and paragraphs. For tables, use proper Markdown table syntax. ' +
    'Do not include any explanations, only output the Markdown content.',
  doctags:
    'Convert the provided document page image into DocTags XML format. ' +
    'Extract all text content preserving the document structure using DocTags elements. ' +
    'Do not include any explanations, only output the DocTags content.',
} as const;

/**
 * Default configuration values for API VLM
 */
export const VLM_API_DEFAULTS = {
  timeout: 120,
  concurrency: 1,
  scale: 2.0,
} as const;

/**
 * Default API VLM model preset key (null = no default, must be explicitly selected)
 */
export const DEFAULT_VLM_API_MODEL: string | null = null;

/**
 * Options for resolving an API VLM model.
 * API key can be provided directly or read from environment variables.
 */
export interface ResolveVlmApiOptions {
  /** API key for authentication. Falls back to provider's env var if not provided. */
  apiKey?: string;
  /** Override the default timeout (seconds) */
  timeout?: number;
  /** Override the default concurrency */
  concurrency?: number;
  /** Override the default prompt template */
  prompt?: string;
  /** Override the default image scale */
  scale?: number;
}

/**
 * Resolve an API VLM model from a preset key or custom VlmModelApi object.
 *
 * When using a preset key:
 * - Looks up the provider endpoint and model configuration
 * - Resolves API key from options or environment variable
 * - Applies default prompt, timeout, concurrency, and scale values
 *
 * When using a custom VlmModelApi object:
 * - Returns the object as-is
 *
 * @throws Error if preset key is unknown
 * @throws Error if API key is not provided and env var is not set
 */
export function resolveVlmApiModel(
  model: string | VlmModelApi,
  options: ResolveVlmApiOptions = {},
): VlmModelApi {
  if (typeof model !== 'string') {
    return model;
  }

  const preset = VLM_API_MODELS[model];
  if (!preset) {
    throw new Error(
      `Unknown API VLM model preset: "${model}". Available presets: ${Object.keys(VLM_API_MODELS).join(', ')}`,
    );
  }

  const provider = VLM_API_PROVIDERS[preset.provider];

  const apiKey = options.apiKey ?? process.env[provider.apiKeyEnvVar];
  if (!apiKey) {
    throw new Error(
      `API key not found for provider "${provider.displayName}". ` +
        `Provide it via options.apiKey or set the ${provider.apiKeyEnvVar} environment variable.`,
    );
  }

  const responseFormat = preset.response_format;

  return {
    url: provider.url,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    params: {
      model: preset.model_id,
    },
    timeout: options.timeout ?? VLM_API_DEFAULTS.timeout,
    concurrency: options.concurrency ?? VLM_API_DEFAULTS.concurrency,
    prompt: options.prompt ?? VLM_API_PROMPTS[responseFormat],
    scale: options.scale ?? VLM_API_DEFAULTS.scale,
    response_format: responseFormat,
  };
}
