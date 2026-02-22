/**
 * VLM model options derived from @heripo/pdf-parser.
 * Transforms the VLM_MODELS record into a UI-friendly array format.
 */
import type { VlmModelPreset } from '@heripo/pdf-parser/vlm-models';

import { DEFAULT_VLM_MODEL, VLM_MODELS } from '@heripo/pdf-parser/vlm-models';

export interface VlmModelOption {
  key: string;
  label: string;
  responseFormat: 'doctags' | 'markdown';
  description: string;
  framework: 'mlx' | 'transformers';
}

function presetToOption(key: string, preset: VlmModelPreset): VlmModelOption {
  return {
    key,
    label: preset.description.split('(')[0].trim(),
    responseFormat: preset.response_format,
    description: preset.description,
    framework: preset.inference_framework,
  };
}

export const VLM_MODEL_OPTIONS: VlmModelOption[] = Object.entries(
  VLM_MODELS,
).map(([key, preset]) => presetToOption(key, preset));

export const DEFAULT_VLM_MODEL_KEY = DEFAULT_VLM_MODEL;

export const VLM_MODEL_KEYS = Object.keys(VLM_MODELS);
