import type { VlmModelLocal } from 'docling-sdk';

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
