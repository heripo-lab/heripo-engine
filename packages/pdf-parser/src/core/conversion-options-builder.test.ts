import { describe, expect, test } from 'vitest';

import { buildConversionOptions } from './conversion-options-builder';

describe('buildConversionOptions', () => {
  test('should build default conversion options', () => {
    const result = buildConversionOptions({});

    expect(result).toEqual({
      to_formats: ['json', 'html'],
      image_export_mode: 'embedded',
      ocr_engine: 'ocrmac',
      ocr_options: {
        kind: 'ocrmac',
        lang: ['ko-KR', 'en-US'],
        recognition: 'accurate',
        framework: 'livetext',
      },
      generate_picture_images: true,
      do_picture_classification: true,
      do_picture_description: true,
      generate_page_images: false,
      images_scale: 2.0,
      force_ocr: true,
      accelerator_options: {
        device: 'mps',
        num_threads: undefined,
      },
    });
  });

  test('should use custom ocr_lang when provided', () => {
    const result = buildConversionOptions({
      ocr_lang: ['ja-JP', 'en-US'],
    });

    expect(result.ocr_options).toEqual({
      kind: 'ocrmac',
      lang: ['ja-JP', 'en-US'],
      recognition: 'accurate',
      framework: 'livetext',
    });
  });

  test('should place num_threads in accelerator_options', () => {
    const result = buildConversionOptions({ num_threads: 8 });

    expect(result.accelerator_options).toEqual({
      device: 'mps',
      num_threads: 8,
    });
    expect(result).not.toHaveProperty('num_threads');
  });

  test('should include document_timeout when provided', () => {
    const result = buildConversionOptions({ document_timeout: 600 });

    expect(result.document_timeout).toBe(600);
  });

  test('should not include document_timeout when not provided', () => {
    const result = buildConversionOptions({});

    expect(result).not.toHaveProperty('document_timeout');
  });

  test('should include document_timeout when value is 0', () => {
    const result = buildConversionOptions({ document_timeout: 0 });

    expect(result.document_timeout).toBe(0);
  });

  test('should omit all pdf-parser-specific fields', () => {
    const result = buildConversionOptions({
      num_threads: 4,
      document_timeout: 300,
      forceImagePdf: true,
      strategySamplerModel: {} as any,
      vlmProcessorModel: {} as any,
      skipSampling: true,
      forcedMethod: 'vlm' as any,
      aggregator: {} as any,
      onTokenUsage: (() => {}) as any,
      chunkedConversion: true,
      chunkSize: 20,
      chunkMaxRetries: 5,
      documentValidationModel: {} as any,
    });

    expect(result).not.toHaveProperty('forceImagePdf');
    expect(result).not.toHaveProperty('strategySamplerModel');
    expect(result).not.toHaveProperty('vlmProcessorModel');
    expect(result).not.toHaveProperty('skipSampling');
    expect(result).not.toHaveProperty('forcedMethod');
    expect(result).not.toHaveProperty('aggregator');
    expect(result).not.toHaveProperty('onTokenUsage');
    expect(result).not.toHaveProperty('chunkedConversion');
    expect(result).not.toHaveProperty('chunkSize');
    expect(result).not.toHaveProperty('chunkMaxRetries');
    expect(result).not.toHaveProperty('documentValidationModel');
  });

  test('should pass through unknown options via spread', () => {
    const result = buildConversionOptions({
      ocr_lang: ['ko-KR'],
      page_range: [1, 10],
    } as any);

    expect(result.page_range).toEqual([1, 10]);
  });
});
