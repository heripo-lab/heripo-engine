/**
 * VLM model options derived from @heripo/pdf-parser.
 * Transforms the VLM_MODELS and VLM_API_MODELS records into UI-friendly array formats.
 */
import type {
  VlmApiModelPreset,
  VlmModelPreset,
} from '@heripo/pdf-parser/vlm-models';

import {
  DEFAULT_VLM_MODEL,
  VLM_API_MODELS,
  VLM_API_PROVIDERS,
  VLM_MODELS,
} from '@heripo/pdf-parser/vlm-models';

// ── Local VLM Model Options ─────────────────────────────────────────────

export interface VlmModelOption {
  key: string;
  label: string;
  responseFormat: 'doctags' | 'markdown';
  description: string;
  framework: 'mlx' | 'transformers';
  type: 'local';
}

function extractParenthesized(description: string): string {
  const match = description.match(/\(([^)]+)\)/);
  return match?.[1] ?? '';
}

function presetToOption(key: string, preset: VlmModelPreset): VlmModelOption {
  return {
    key,
    label: preset.description.split('(')[0].trim(),
    responseFormat: preset.response_format,
    description: extractParenthesized(preset.description),
    framework: preset.inference_framework,
    type: 'local',
  };
}

export const VLM_MODEL_OPTIONS: VlmModelOption[] = Object.entries(
  VLM_MODELS,
).map(([key, preset]) => presetToOption(key, preset));

// ── API VLM Model Options ───────────────────────────────────────────────

export interface VlmApiModelOption {
  key: string;
  label: string;
  responseFormat: 'doctags' | 'markdown';
  description: string;
  provider: string;
  type: 'api';
}

function apiPresetToOption(
  key: string,
  preset: VlmApiModelPreset,
): VlmApiModelOption {
  const providerConfig = VLM_API_PROVIDERS[preset.provider];
  return {
    key,
    label: preset.description.split('(')[0].trim(),
    responseFormat: preset.response_format,
    description: extractParenthesized(preset.description),
    provider: providerConfig.displayName,
    type: 'api',
  };
}

export const VLM_API_MODEL_OPTIONS: VlmApiModelOption[] = Object.entries(
  VLM_API_MODELS,
).map(([key, preset]) => apiPresetToOption(key, preset));

// ── Combined exports ────────────────────────────────────────────────────

export const DEFAULT_VLM_MODEL_KEY = DEFAULT_VLM_MODEL;

export const VLM_MODEL_KEYS = Object.keys(VLM_MODELS);
export const VLM_API_MODEL_KEYS = Object.keys(VLM_API_MODELS);
export const ALL_VLM_MODEL_KEYS = [...VLM_MODEL_KEYS, ...VLM_API_MODEL_KEYS];
