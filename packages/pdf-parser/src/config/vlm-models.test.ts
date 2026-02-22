import type { VlmModelLocal } from 'docling-sdk';

import { describe, expect, test } from 'vitest';

import {
  DEFAULT_VLM_MODEL,
  VLM_MODELS,
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
