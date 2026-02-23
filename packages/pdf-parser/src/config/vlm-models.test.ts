import type { VlmModelApi, VlmModelLocal } from 'docling-sdk';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  DEFAULT_VLM_API_MODEL,
  DEFAULT_VLM_MODEL,
  VLM_API_DEFAULTS,
  VLM_API_MODELS,
  VLM_API_PROMPTS,
  VLM_API_PROVIDERS,
  VLM_MODELS,
  resolveVlmApiModel,
  resolveVlmModel,
} from './vlm-models.js';

describe('VLM_MODELS', () => {
  test('should contain exactly 13 presets', () => {
    expect(Object.keys(VLM_MODELS)).toHaveLength(13);
  });

  test('all presets should have required properties', () => {
    for (const [key, preset] of Object.entries(VLM_MODELS)) {
      expect(preset, `${key} missing repo_id`).toHaveProperty('repo_id');
      expect(preset, `${key} missing inference_framework`).toHaveProperty(
        'inference_framework',
      );
      expect(preset, `${key} missing response_format`).toHaveProperty(
        'response_format',
      );
      expect(preset, `${key} missing transformers_model_type`).toHaveProperty(
        'transformers_model_type',
      );
      expect(preset, `${key} missing description`).toHaveProperty(
        'description',
      );
    }
  });

  test('should have correct doctags presets', () => {
    const doctagsModels = Object.entries(VLM_MODELS).filter(
      ([, p]) => p.response_format === 'doctags',
    );
    expect(doctagsModels.map(([k]) => k)).toEqual([
      'granite-docling-258M-mlx',
      'granite-docling-258M',
      'smoldocling-256M-mlx',
      'smoldocling-256M',
    ]);
  });

  test('should have correct markdown presets', () => {
    const markdownModels = Object.entries(VLM_MODELS).filter(
      ([, p]) => p.response_format === 'markdown',
    );
    expect(markdownModels.map(([k]) => k)).toEqual([
      'granite-vision-2B',
      'qwen25-vl-3B-mlx',
      'phi4',
      'pixtral-12B-mlx',
      'pixtral-12B',
      'got2',
      'gemma3-12B-mlx',
      'gemma3-27B-mlx',
      'dolphin',
    ]);
    expect(markdownModels).toHaveLength(9);
  });

  test('phi4 should use automodel (CausalLM) type', () => {
    expect(VLM_MODELS['phi4'].transformers_model_type).toBe('automodel');
  });

  test('mlx presets should use mlx inference framework', () => {
    const mlxModels = Object.entries(VLM_MODELS).filter(([k]) =>
      k.includes('mlx'),
    );
    for (const [key, preset] of mlxModels) {
      expect(preset.inference_framework, `${key} should be mlx`).toBe('mlx');
    }
  });

  test('should have correct repo_ids for key models', () => {
    expect(VLM_MODELS['qwen25-vl-3B-mlx'].repo_id).toBe(
      'mlx-community/Qwen2.5-VL-3B-Instruct-bf16',
    );
    expect(VLM_MODELS['pixtral-12B'].repo_id).toBe(
      'mistral-community/pixtral-12b',
    );
    expect(VLM_MODELS['got2'].repo_id).toBe('stepfun-ai/GOT-OCR-2.0-hf');
    expect(VLM_MODELS['dolphin'].repo_id).toBe('ByteDance/Dolphin');
    expect(VLM_MODELS['gemma3-27B-mlx'].repo_id).toBe(
      'mlx-community/gemma-3-27b-it-bf16',
    );
    expect(VLM_MODELS['phi4'].repo_id).toBe(
      'microsoft/Phi-4-multimodal-instruct',
    );
  });
});

describe('DEFAULT_VLM_MODEL', () => {
  test('should be a valid key in VLM_MODELS', () => {
    expect(VLM_MODELS).toHaveProperty(DEFAULT_VLM_MODEL);
  });

  test('should be granite-docling-258M-mlx', () => {
    expect(DEFAULT_VLM_MODEL).toBe('granite-docling-258M-mlx');
  });
});

describe('resolveVlmModel', () => {
  test('should return VlmModelLocal with correct fields when given a preset string key', () => {
    const result = resolveVlmModel('granite-docling-258M');

    expect(result).toEqual({
      repo_id: 'ibm-granite/granite-docling-258M',
      inference_framework: 'transformers',
      response_format: 'doctags',
      transformers_model_type: 'automodel-vision2seq',
    });
  });

  test('should not include description field in the resolved VlmModelLocal', () => {
    const result = resolveVlmModel('granite-docling-258M-mlx');

    expect(result).not.toHaveProperty('description');
  });

  test('should throw error with available presets when given an unknown string key', () => {
    expect(() => resolveVlmModel('unknown-model')).toThrow(
      /Unknown VLM model preset: "unknown-model"\. Available presets:/,
    );
  });

  test('should return the custom VlmModelLocal object as-is when given an object', () => {
    const customModel: VlmModelLocal = {
      repo_id: 'custom/model',
      prompt: 'custom prompt',
      scale: 1.0,
      response_format: 'markdown',
      inference_framework: 'transformers',
      transformers_model_type: 'automodel',
      extra_generation_config: { temperature: 0.5 },
    };

    const result = resolveVlmModel(customModel);

    expect(result).toBe(customModel);
  });

  test('should resolve the default model successfully', () => {
    const result = resolveVlmModel(DEFAULT_VLM_MODEL);

    expect(result).toEqual({
      repo_id: 'ibm-granite/granite-docling-258M-mlx',
      inference_framework: 'mlx',
      response_format: 'doctags',
      transformers_model_type: 'automodel-vision2seq',
    });
  });

  test('should resolve all preset keys without throwing', () => {
    for (const key of Object.keys(VLM_MODELS)) {
      expect(() => resolveVlmModel(key)).not.toThrow();
    }
  });
});

// ── API VLM Tests ─────────────────────────────────────────────────────────

describe('VLM_API_PROVIDERS', () => {
  test('should contain 4 providers', () => {
    expect(Object.keys(VLM_API_PROVIDERS)).toEqual([
      'openai',
      'anthropic',
      'google',
      'together',
    ]);
  });

  test('openai provider should have correct configuration', () => {
    expect(VLM_API_PROVIDERS.openai).toEqual({
      url: 'https://api.openai.com/v1/chat/completions',
      apiKeyEnvVar: 'OPENAI_API_KEY',
      displayName: 'OpenAI',
    });
  });

  test('anthropic provider should have correct configuration', () => {
    expect(VLM_API_PROVIDERS.anthropic).toEqual({
      url: 'https://api.anthropic.com/v1/chat/completions',
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      displayName: 'Anthropic',
    });
  });

  test('google provider should have correct configuration', () => {
    expect(VLM_API_PROVIDERS.google).toEqual({
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      apiKeyEnvVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
      displayName: 'Google',
    });
  });

  test('together provider should have correct configuration', () => {
    expect(VLM_API_PROVIDERS.together).toEqual({
      url: 'https://api.together.xyz/v1/chat/completions',
      apiKeyEnvVar: 'TOGETHER_AI_API_KEY',
      displayName: 'Together AI',
    });
  });

  test('all providers should use Bearer token auth pattern', () => {
    for (const provider of Object.values(VLM_API_PROVIDERS)) {
      expect(provider.url).toContain('chat/completions');
      expect(provider.apiKeyEnvVar).toBeTruthy();
    }
  });
});

describe('VLM_API_MODELS', () => {
  test('should contain exactly 8 presets', () => {
    expect(Object.keys(VLM_API_MODELS)).toHaveLength(8);
  });

  test('all presets should have required properties', () => {
    for (const [key, preset] of Object.entries(VLM_API_MODELS)) {
      expect(preset, `${key} missing model_id`).toHaveProperty('model_id');
      expect(preset, `${key} missing provider`).toHaveProperty('provider');
      expect(preset, `${key} missing response_format`).toHaveProperty(
        'response_format',
      );
      expect(preset, `${key} missing description`).toHaveProperty(
        'description',
      );
    }
  });

  test('all presets should use markdown response format', () => {
    for (const [, preset] of Object.entries(VLM_API_MODELS)) {
      expect(preset.response_format).toBe('markdown');
    }
  });

  test('should have correct OpenAI presets', () => {
    const openaiModels = Object.entries(VLM_API_MODELS).filter(
      ([, p]) => p.provider === 'openai',
    );
    expect(openaiModels.map(([k]) => k)).toEqual([
      'openai/gpt-5.2',
      'openai/gpt-5.1',
      'openai/gpt-5-mini',
    ]);
  });

  test('should have correct Anthropic presets', () => {
    const anthropicModels = Object.entries(VLM_API_MODELS).filter(
      ([, p]) => p.provider === 'anthropic',
    );
    expect(anthropicModels.map(([k]) => k)).toEqual([
      'anthropic/claude-opus-4.6',
      'anthropic/claude-sonnet-4.6',
      'anthropic/claude-haiku-4.6',
    ]);
  });

  test('should have correct Google presets', () => {
    const googleModels = Object.entries(VLM_API_MODELS).filter(
      ([, p]) => p.provider === 'google',
    );
    expect(googleModels.map(([k]) => k)).toEqual([
      'google/gemini-3.1-pro-preview',
      'google/gemini-3-flash-preview',
    ]);
  });

  test('all provider keys should reference valid providers', () => {
    for (const [, preset] of Object.entries(VLM_API_MODELS)) {
      expect(VLM_API_PROVIDERS).toHaveProperty(preset.provider);
    }
  });
});

describe('VLM_API_PROMPTS', () => {
  test('should have markdown and doctags prompts', () => {
    expect(VLM_API_PROMPTS).toHaveProperty('markdown');
    expect(VLM_API_PROMPTS).toHaveProperty('doctags');
  });

  test('prompts should be non-empty strings', () => {
    expect(VLM_API_PROMPTS.markdown.length).toBeGreaterThan(0);
    expect(VLM_API_PROMPTS.doctags.length).toBeGreaterThan(0);
  });
});

describe('VLM_API_DEFAULTS', () => {
  test('should have correct default values', () => {
    expect(VLM_API_DEFAULTS.timeout).toBe(120);
    expect(VLM_API_DEFAULTS.concurrency).toBe(1);
    expect(VLM_API_DEFAULTS.scale).toBe(2.0);
  });
});

describe('DEFAULT_VLM_API_MODEL', () => {
  test('should be null (no default API model)', () => {
    expect(DEFAULT_VLM_API_MODEL).toBeNull();
  });
});

describe('resolveVlmApiModel', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('should return VlmModelApi with correct fields when given a preset key and explicit API key', () => {
    const result = resolveVlmApiModel('openai/gpt-5.2', {
      apiKey: 'test-key-123',
    });

    expect(result).toEqual({
      url: 'https://api.openai.com/v1/chat/completions',
      headers: { Authorization: 'Bearer test-key-123' },
      params: { model: 'gpt-5.2' },
      timeout: 120,
      concurrency: 1,
      prompt: VLM_API_PROMPTS.markdown,
      scale: 2.0,
      response_format: 'markdown',
    });
  });

  test('should resolve Anthropic preset correctly', () => {
    const result = resolveVlmApiModel('anthropic/claude-sonnet-4.6', {
      apiKey: 'anthropic-key',
    });

    expect(result.url).toBe('https://api.anthropic.com/v1/chat/completions');
    expect(result.params).toEqual({ model: 'claude-sonnet-4.6' });
    expect(result.headers).toEqual({
      Authorization: 'Bearer anthropic-key',
    });
  });

  test('should resolve Google preset correctly', () => {
    const result = resolveVlmApiModel('google/gemini-3-flash-preview', {
      apiKey: 'google-key',
    });

    expect(result.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    );
    expect(result.params).toEqual({ model: 'gemini-3-flash-preview' });
  });

  test('should resolve API key from environment variable when not provided explicitly', () => {
    process.env.OPENAI_API_KEY = 'env-key-456';

    const result = resolveVlmApiModel('openai/gpt-5.1');

    expect(result.headers).toEqual({ Authorization: 'Bearer env-key-456' });
  });

  test('should prefer explicit API key over environment variable', () => {
    process.env.OPENAI_API_KEY = 'env-key';

    const result = resolveVlmApiModel('openai/gpt-5.2', {
      apiKey: 'explicit-key',
    });

    expect(result.headers).toEqual({
      Authorization: 'Bearer explicit-key',
    });
  });

  test('should throw error when API key is not found', () => {
    delete process.env.OPENAI_API_KEY;

    expect(() => resolveVlmApiModel('openai/gpt-5.2')).toThrow(
      /API key not found for provider "OpenAI"/,
    );
  });

  test('should throw error with available presets when given unknown key', () => {
    expect(() =>
      resolveVlmApiModel('unknown/model', { apiKey: 'key' }),
    ).toThrow(
      /Unknown API VLM model preset: "unknown\/model"\. Available presets:/,
    );
  });

  test('should return custom VlmModelApi object as-is', () => {
    const customModel: VlmModelApi = {
      url: 'https://custom.api/v1/chat',
      headers: { Authorization: 'Bearer custom' },
      timeout: 60,
      concurrency: 2,
      prompt: 'custom prompt',
      scale: 1.5,
      response_format: 'markdown',
    };

    const result = resolveVlmApiModel(customModel);
    expect(result).toBe(customModel);
  });

  test('should apply custom timeout override', () => {
    const result = resolveVlmApiModel('openai/gpt-5.2', {
      apiKey: 'key',
      timeout: 300,
    });

    expect(result.timeout).toBe(300);
  });

  test('should apply custom concurrency override', () => {
    const result = resolveVlmApiModel('openai/gpt-5.2', {
      apiKey: 'key',
      concurrency: 4,
    });

    expect(result.concurrency).toBe(4);
  });

  test('should apply custom prompt override', () => {
    const result = resolveVlmApiModel('openai/gpt-5.2', {
      apiKey: 'key',
      prompt: 'Extract text as markdown',
    });

    expect(result.prompt).toBe('Extract text as markdown');
  });

  test('should apply custom scale override', () => {
    const result = resolveVlmApiModel('openai/gpt-5.2', {
      apiKey: 'key',
      scale: 3.0,
    });

    expect(result.scale).toBe(3.0);
  });

  test('should resolve all preset keys without throwing when API key is provided', () => {
    for (const key of Object.keys(VLM_API_MODELS)) {
      expect(() => resolveVlmApiModel(key, { apiKey: 'key' })).not.toThrow();
    }
  });
});
