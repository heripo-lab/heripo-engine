import type { LoggerMethods } from '@heripo/logger';
import type {
  AsyncConversionTask,
  DoclingAPIClient,
  VlmModelApi,
  VlmModelLocal,
} from 'docling-sdk';
import type { Readable } from 'node:stream';

import { ValidationUtils } from 'docling-sdk';
import { omit } from 'es-toolkit';
import { createWriteStream, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { PDF_CONVERTER } from '../config/constants';
import { ImagePdfFallbackError } from '../errors/image-pdf-fallback-error';
import { ImageExtractor } from '../processors/image-extractor';
import { LocalFileServer } from '../utils/local-file-server';
import { VlmProxyServer } from '../utils/vlm-proxy-server';
import { ImagePdfConverter } from './image-pdf-converter';
import { PDFConverter } from './pdf-converter';

vi.mock('es-toolkit', () => ({
  omit: vi.fn(),
}));

vi.mock('./image-pdf-converter', () => ({
  ImagePdfConverter: vi.fn(),
}));

vi.mock('../utils/local-file-server', () => ({
  LocalFileServer: vi.fn(),
}));

vi.mock('../utils/vlm-proxy-server', () => ({
  VlmProxyServer: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  rmSync: vi.fn(),
  createWriteStream: vi.fn(),
}));

vi.mock('node:path', () => ({
  join: vi.fn(),
}));

vi.mock('node:stream/promises', () => ({
  pipeline: vi.fn(),
}));

vi.mock('../processors/image-extractor', () => ({
  ImageExtractor: {
    extractAndSaveDocumentsFromZip: vi.fn(),
  },
}));

describe('PDFConverter', () => {
  let logger: LoggerMethods;
  let client: DoclingAPIClient;
  let converter: PDFConverter;

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    client = {
      convertSourceAsync: vi.fn(),
      getTaskResultFile: vi.fn(),
    } as unknown as DoclingAPIClient;

    converter = new PDFConverter(logger, client);

    vi.spyOn(process, 'cwd').mockReturnValue('/test/cwd');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(Date, 'now').mockReturnValue(1000000);

    vi.mocked(omit).mockImplementation((obj, keys) => {
      const result = { ...obj };
      keys.forEach((key) => delete result[key as keyof typeof result]);
      return result;
    });

    vi.mocked(join).mockImplementation((...args) => args.join('/'));

    // Mock LocalFileServer
    vi.mocked(LocalFileServer).mockImplementation(function () {
      return {
        start: vi.fn().mockResolvedValue('http://127.0.0.1:12345/test.pdf'),
        stop: vi.fn().mockResolvedValue(undefined),
      } as unknown as LocalFileServer;
    });

    // Mock ImagePdfConverter (used by forceImagePdf and image PDF fallback)
    vi.mocked(ImagePdfConverter).mockImplementation(function () {
      return {
        convert: vi.fn().mockResolvedValue('/tmp/image.pdf'),
        cleanup: vi.fn(),
      } as any;
    });

    // Mock VlmProxyServer (default for all VLM API tests)
    vi.mocked(VlmProxyServer).mockImplementation(function () {
      return {
        start: vi
          .fn()
          .mockResolvedValue('http://127.0.0.1:9999/v1/chat/completions'),
        stop: vi.fn().mockResolvedValue(undefined),
        getAccumulatedUsage: vi.fn().mockReturnValue({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          requestCount: 0,
        }),
      } as any;
    });
  });

  describe('constructor', () => {
    test('should create an instance with logger and client', () => {
      expect(converter).toBeInstanceOf(PDFConverter);
    });

    test('should accept custom timeout parameter', () => {
      const customConverter = new PDFConverter(
        logger,
        client,
        false,
        5_000_000,
      );
      expect(customConverter).toBeInstanceOf(PDFConverter);
    });
  });

  describe('buildConversionOptions', () => {
    test('should build conversion options with default values', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        { num_threads: 4 },
      );

      expect(client.convertSourceAsync).toHaveBeenCalledWith({
        sources: [{ kind: 'http', url: 'http://test.com/doc.pdf' }],
        options: {
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
          images_scale: 2.0,
          force_ocr: true,
          accelerator_options: {
            device: 'mps',
            num_threads: 4,
          },
        },
        target: { kind: 'zip' },
      });
    });

    test('should omit num_threads from options and use in accelerator_options', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        { num_threads: 8 },
      );

      const callArgs = vi.mocked(client.convertSourceAsync).mock.calls[0][0];
      expect(callArgs.options).toEqual({
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
        images_scale: 2.0,
        force_ocr: true,
        accelerator_options: {
          device: 'mps',
          num_threads: 8,
        },
      });
    });
  });

  describe('buildVlmConversionOptions', () => {
    test('should build VLM options with default model when pipeline is vlm', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        { pipeline: 'vlm', num_threads: 4, ocr_lang: ['ko', 'en'] },
      );

      const callArgs = vi.mocked(client.convertSourceAsync).mock.calls[0][0];
      expect(callArgs.options).toMatchObject({
        to_formats: ['json', 'html'],
        image_export_mode: 'embedded',
        pipeline: 'vlm',
        generate_picture_images: true,
        images_scale: 2.0,
        accelerator_options: {
          device: 'mps',
          num_threads: 4,
        },
      });
      // VLM options should have vlm_pipeline_model_local
      expect(callArgs.options).toHaveProperty('vlm_pipeline_model_local');
      // VLM options should NOT have OCR-specific settings
      expect(callArgs.options).not.toHaveProperty('ocr_engine');
      expect(callArgs.options).not.toHaveProperty('ocr_options');
      expect(callArgs.options).not.toHaveProperty('force_ocr');
      expect(callArgs.options).not.toHaveProperty('ocr_lang');
    });

    test('should resolve VLM model preset from string key', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        { pipeline: 'vlm', vlm_model: 'granite-docling-258M' },
      );

      const callArgs = vi.mocked(client.convertSourceAsync).mock.calls[0][0];
      expect(callArgs.options!.vlm_pipeline_model_local).toMatchObject({
        repo_id: 'ibm-granite/granite-docling-258M',
        inference_framework: 'transformers',
        response_format: 'doctags',
        transformers_model_type: 'automodel-vision2seq',
      });
    });

    test('should use custom VlmModelLocal object directly', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const customModel = {
        repo_id: 'custom/model',
        inference_framework: 'transformers',
        response_format: 'markdown',
        transformers_model_type: 'automodel',
      } as unknown as VlmModelLocal;

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        { pipeline: 'vlm', vlm_model: customModel },
      );

      const callArgs = vi.mocked(client.convertSourceAsync).mock.calls[0][0];
      expect(callArgs.options!.vlm_pipeline_model_local).toEqual(customModel);
    });

    test('should log VLM pipeline usage', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        { pipeline: 'vlm' },
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Using VLM pipeline',
      );
    });

    test('should build API VLM options when vlm_api_model preset key is specified', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {
          pipeline: 'vlm',
          vlm_api_model: 'openai/gpt-5.2',
          vlm_api_options: { apiKey: 'test-api-key' },
        },
      );

      const callArgs = vi.mocked(client.convertSourceAsync).mock.calls[0][0];
      expect(callArgs.options).toHaveProperty('vlm_pipeline_model_api');
      expect(callArgs.options).not.toHaveProperty('vlm_pipeline_model_local');
      // When proxy is active, the URL is the proxy URL and headers are empty
      expect(callArgs.options!.vlm_pipeline_model_api).toMatchObject({
        url: 'http://127.0.0.1:9999/v1/chat/completions',
        headers: {},
        params: { model: 'gpt-5.2' },
        response_format: 'markdown',
      });
    });

    test('should prefer vlm_api_model over vlm_model when both are specified', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {
          pipeline: 'vlm',
          vlm_model: 'granite-docling-258M',
          vlm_api_model: 'openai/gpt-5.2',
          vlm_api_options: { apiKey: 'key' },
        },
      );

      const callArgs = vi.mocked(client.convertSourceAsync).mock.calls[0][0];
      expect(callArgs.options).toHaveProperty('vlm_pipeline_model_api');
      expect(callArgs.options).not.toHaveProperty('vlm_pipeline_model_local');
    });

    test('should use custom VlmModelApi object through proxy', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const customApiModel: VlmModelApi = {
        url: 'https://custom.api/v1',
        headers: { Authorization: 'Bearer custom' },
        timeout: 60,
        concurrency: 2,
        prompt: 'custom',
        scale: 1.0,
        response_format: 'markdown',
      };

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        { pipeline: 'vlm', vlm_api_model: customApiModel },
      );

      // VlmProxyServer should be constructed with original URL and auth
      expect(VlmProxyServer).toHaveBeenCalledWith(
        logger,
        'https://custom.api/v1',
        'Bearer custom',
      );
      // Docling receives proxy URL with empty headers
      const callArgs = vi.mocked(client.convertSourceAsync).mock.calls[0][0];
      expect(callArgs.options!.vlm_pipeline_model_api!.url).toBe(
        'http://127.0.0.1:9999/v1/chat/completions',
      );
      expect(callArgs.options!.vlm_pipeline_model_api!.headers).toEqual({});
    });

    test('should log API VLM model info', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {
          pipeline: 'vlm',
          vlm_api_model: 'openai/gpt-5.2',
          vlm_api_options: { apiKey: 'key' },
        },
      );

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('[PDFConverter] VLM API model:'),
      );
    });
  });

  describe('VLM proxy and TokenUsageReport', () => {
    test('should return TokenUsageReport when VLM API model is used', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const mockProxyInstance = {
        start: vi
          .fn()
          .mockResolvedValue('http://127.0.0.1:9999/v1/chat/completions'),
        stop: vi.fn().mockResolvedValue(undefined),
        getAccumulatedUsage: vi.fn().mockReturnValue({
          inputTokens: 500,
          outputTokens: 200,
          totalTokens: 700,
          requestCount: 5,
        }),
      };
      vi.mocked(VlmProxyServer).mockImplementation(function () {
        return mockProxyInstance as any;
      });

      const result = await converter.convert(
        'http://test.com/doc.pdf',
        'report-vlm',
        vi.fn(),
        false,
        {
          pipeline: 'vlm',
          vlm_api_model: 'openai/gpt-5.2',
          vlm_api_options: { apiKey: 'test-key' },
        },
      );

      expect(result).not.toBeNull();
      expect(result!.components).toHaveLength(1);
      expect(result!.components[0].component).toBe('VlmPipeline');
      expect(result!.components[0].phases[0].phase).toBe('page-conversion');
      expect(result!.components[0].phases[0].primary).toEqual({
        modelName: 'openai/gpt-5.2',
        inputTokens: 500,
        outputTokens: 200,
        totalTokens: 700,
      });
      expect(result!.total).toEqual({
        inputTokens: 500,
        outputTokens: 200,
        totalTokens: 700,
      });
    });

    test('should return null for standard pipeline', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await converter.convert(
        'http://test.com/doc.pdf',
        'report-std',
        vi.fn(),
        false,
        {},
      );

      expect(result).toBeNull();
    });

    test('should return null for local VLM model', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await converter.convert(
        'http://test.com/doc.pdf',
        'report-local-vlm',
        vi.fn(),
        false,
        { pipeline: 'vlm', vlm_model: 'granite-docling-258M-mlx' },
      );

      expect(result).toBeNull();
      expect(VlmProxyServer).not.toHaveBeenCalled();
    });

    test('should start and stop proxy during VLM API conversion', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const mockProxyInstance = {
        start: vi
          .fn()
          .mockResolvedValue('http://127.0.0.1:9999/v1/chat/completions'),
        stop: vi.fn().mockResolvedValue(undefined),
        getAccumulatedUsage: vi.fn().mockReturnValue({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          requestCount: 0,
        }),
      };
      vi.mocked(VlmProxyServer).mockImplementation(function () {
        return mockProxyInstance as any;
      });

      await converter.convert(
        'http://test.com/doc.pdf',
        'report-proxy',
        vi.fn(),
        false,
        {
          pipeline: 'vlm',
          vlm_api_model: 'openai/gpt-5.2',
          vlm_api_options: { apiKey: 'test-key' },
        },
      );

      expect(mockProxyInstance.start).toHaveBeenCalledTimes(1);
      expect(mockProxyInstance.stop).toHaveBeenCalledTimes(1);
    });

    test('should stop proxy even when conversion fails', async () => {
      const mockTask = createMockTask('failure');
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

      const mockProxyInstance = {
        start: vi
          .fn()
          .mockResolvedValue('http://127.0.0.1:9999/v1/chat/completions'),
        stop: vi.fn().mockResolvedValue(undefined),
        getAccumulatedUsage: vi.fn().mockReturnValue({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          requestCount: 0,
        }),
      };
      vi.mocked(VlmProxyServer).mockImplementation(function () {
        return mockProxyInstance as any;
      });

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-fail',
          vi.fn(),
          false,
          {
            pipeline: 'vlm',
            vlm_api_model: 'openai/gpt-5.2',
            vlm_api_options: { apiKey: 'test-key' },
          },
        ),
      ).rejects.toThrow();

      // Proxy should still be stopped in finally block
      expect(mockProxyInstance.stop).toHaveBeenCalledTimes(1);
    });

    test('should propagate error when image PDF conversion fails with forceImagePdf', async () => {
      vi.mocked(ImagePdfConverter).mockImplementation(function () {
        return {
          convert: vi.fn().mockRejectedValue(new Error('ImageMagick failed')),
          cleanup: vi.fn(),
        } as any;
      });

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-img-fail',
          vi.fn(),
          false,
          {
            pipeline: 'vlm',
            vlm_api_model: 'openai/gpt-5.2',
            vlm_api_options: { apiKey: 'test-key' },
            forceImagePdf: true,
          },
        ),
      ).rejects.toThrow('ImageMagick failed');
    });

    test('should pass proxy URL to docling instead of real API URL', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const mockProxyInstance = {
        start: vi
          .fn()
          .mockResolvedValue('http://127.0.0.1:9999/v1/chat/completions'),
        stop: vi.fn().mockResolvedValue(undefined),
        getAccumulatedUsage: vi.fn().mockReturnValue({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          requestCount: 0,
        }),
      };
      vi.mocked(VlmProxyServer).mockImplementation(function () {
        return mockProxyInstance as any;
      });

      await converter.convert(
        'http://test.com/doc.pdf',
        'report-proxy-url',
        vi.fn(),
        false,
        {
          pipeline: 'vlm',
          vlm_api_model: 'openai/gpt-5.2',
          vlm_api_options: { apiKey: 'test-key' },
        },
      );

      const callArgs = vi.mocked(client.convertSourceAsync).mock.calls[0][0];
      const apiModel = callArgs.options!.vlm_pipeline_model_api!;
      expect(apiModel.url).toBe('http://127.0.0.1:9999/v1/chat/completions');
      expect(apiModel.headers).toEqual({});
    });

    test('should use custom VlmModelApi model name when not a preset key', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const mockProxyInstance = {
        start: vi
          .fn()
          .mockResolvedValue('http://127.0.0.1:9999/v1/chat/completions'),
        stop: vi.fn().mockResolvedValue(undefined),
        getAccumulatedUsage: vi.fn().mockReturnValue({
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          requestCount: 1,
        }),
      };
      vi.mocked(VlmProxyServer).mockImplementation(function () {
        return mockProxyInstance as any;
      });

      const customApiModel: VlmModelApi = {
        url: 'https://custom.api/v1',
        headers: { Authorization: 'Bearer custom' },
        params: { model: 'custom-model-v1' },
        timeout: 60,
        concurrency: 1,
        prompt: 'test',
        scale: 1.0,
        response_format: 'markdown',
      };

      const result = await converter.convert(
        'http://test.com/doc.pdf',
        'report-custom',
        vi.fn(),
        false,
        { pipeline: 'vlm', vlm_api_model: customApiModel },
      );

      expect(result).not.toBeNull();
      expect(result!.components[0].phases[0].primary!.modelName).toBe(
        'custom-model-v1',
      );
    });

    test('should pass empty auth when custom VlmModelApi has no headers', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const mockProxyInstance = {
        start: vi
          .fn()
          .mockResolvedValue('http://127.0.0.1:9999/v1/chat/completions'),
        stop: vi.fn().mockResolvedValue(undefined),
        getAccumulatedUsage: vi.fn().mockReturnValue({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          requestCount: 0,
        }),
      };
      vi.mocked(VlmProxyServer).mockImplementation(function () {
        return mockProxyInstance as any;
      });

      const noHeaderModel: VlmModelApi = {
        url: 'https://custom.api/v1',
        timeout: 60,
        concurrency: 1,
        prompt: 'test',
        scale: 1.0,
        response_format: 'markdown',
      };

      await converter.convert(
        'http://test.com/doc.pdf',
        'report-no-header',
        vi.fn(),
        false,
        { pipeline: 'vlm', vlm_api_model: noHeaderModel },
      );

      // Should pass empty string for auth when headers is undefined
      expect(VlmProxyServer).toHaveBeenCalledWith(
        logger,
        'https://custom.api/v1',
        '',
      );
    });

    test('should use fallback model name when custom VlmModelApi has no params.model', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const mockProxyInstance = {
        start: vi
          .fn()
          .mockResolvedValue('http://127.0.0.1:9999/v1/chat/completions'),
        stop: vi.fn().mockResolvedValue(undefined),
        getAccumulatedUsage: vi.fn().mockReturnValue({
          inputTokens: 5,
          outputTokens: 10,
          totalTokens: 15,
          requestCount: 1,
        }),
      };
      vi.mocked(VlmProxyServer).mockImplementation(function () {
        return mockProxyInstance as any;
      });

      const noParamsModel: VlmModelApi = {
        url: 'https://custom.api/v1',
        timeout: 60,
        concurrency: 1,
        prompt: 'test',
        scale: 1.0,
        response_format: 'markdown',
      };

      const result = await converter.convert(
        'http://test.com/doc.pdf',
        'report-no-params',
        vi.fn(),
        false,
        { pipeline: 'vlm', vlm_api_model: noParamsModel },
      );

      expect(result).not.toBeNull();
      expect(result!.components[0].phases[0].primary!.modelName).toBe(
        'custom-vlm-api',
      );
    });
  });

  describe('convert', () => {
    test('should successfully convert PDF with cleanupAfterCallback=false', async () => {
      const mockTask = createMockTask();
      const onComplete = vi.fn().mockResolvedValue(undefined);
      const writeStream = { write: vi.fn(), end: vi.fn() };

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        onComplete,
        false,
        {},
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Converting:',
        'http://test.com/doc.pdf',
      );
      expect(client.convertSourceAsync).toHaveBeenCalled();
      expect(client.getTaskResultFile).toHaveBeenCalledWith('task-123');
      expect(pipeline).toHaveBeenCalled();
      expect(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).toHaveBeenCalledWith(
        logger,
        '/test/cwd/result.zip',
        '/test/cwd/result_extracted',
        '/test/cwd/output/report123',
      );
      expect(onComplete).toHaveBeenCalledWith('/test/cwd/output/report123');
      expect(rmSync).toHaveBeenCalledWith('/test/cwd/result.zip', {
        force: true,
      });
      expect(rmSync).toHaveBeenCalledWith('/test/cwd/result_extracted', {
        recursive: true,
        force: true,
      });
      expect(rmSync).not.toHaveBeenCalledWith(
        '/test/cwd/output/report123',
        expect.any(Object),
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Output preserved at:',
        '/test/cwd/output/report123',
      );
    });

    test('should successfully convert PDF with cleanupAfterCallback=true', async () => {
      const mockTask = createMockTask();
      const onComplete = vi.fn().mockResolvedValue(undefined);
      const writeStream = { write: vi.fn(), end: vi.fn() };

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(true);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report456',
        onComplete,
        true,
        {},
      );

      expect(onComplete).toHaveBeenCalledWith('/test/cwd/output/report456');
      expect(rmSync).toHaveBeenCalledWith('/test/cwd/result.zip', {
        force: true,
      });
      expect(rmSync).toHaveBeenCalledWith('/test/cwd/result_extracted', {
        recursive: true,
        force: true,
      });
      expect(rmSync).toHaveBeenCalledWith('/test/cwd/output/report456', {
        recursive: true,
        force: true,
      });
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Cleaning up output directory:',
        '/test/cwd/output/report456',
      );
    });

    test('should cleanup temporary files even if callback throws error', async () => {
      const mockTask = createMockTask();
      const onComplete = vi.fn().mockRejectedValue(new Error('Callback error'));
      const writeStream = { write: vi.fn(), end: vi.fn() };

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(true);

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report789',
          onComplete,
          false,
          {},
        ),
      ).rejects.toThrow('Callback error');

      expect(rmSync).toHaveBeenCalledWith('/test/cwd/result.zip', {
        force: true,
      });
      expect(rmSync).toHaveBeenCalledWith('/test/cwd/result_extracted', {
        recursive: true,
        force: true,
      });
    });

    test('should handle conversion task failure', async () => {
      const mockTask = createMockTask('failure');

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Task failed: Processing failed');

      expect(logger.error).toHaveBeenCalledWith(
        '[PDFConverter] Conversion failed:',
        expect.any(Error),
      );
    });

    test('should handle download failure', async () => {
      const mockTask = createMockTask();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockRejectedValue(
        new Error('Download failed'),
      );

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-download-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Download failed');

      expect(logger.error).toHaveBeenCalledWith(
        '[PDFConverter] Conversion failed:',
        expect.any(Error),
      );
    });

    test('should handle processing failure and cleanup', async () => {
      const mockTask = createMockTask();
      const writeStream = { write: vi.fn(), end: vi.fn() };

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockRejectedValue(new Error('Processing failed'));
      vi.mocked(existsSync).mockReturnValue(true);

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-process-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Processing failed');

      expect(rmSync).toHaveBeenCalledWith('/test/cwd/result.zip', {
        force: true,
      });
      expect(rmSync).toHaveBeenCalledWith('/test/cwd/result_extracted', {
        recursive: true,
        force: true,
      });
    });

    test('should handle non-existent files during cleanup', async () => {
      const mockTask = createMockTask();
      const onComplete = vi.fn().mockResolvedValue(undefined);
      const writeStream = { write: vi.fn(), end: vi.fn() };

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report-no-files',
        onComplete,
        true,
        {},
      );

      expect(rmSync).not.toHaveBeenCalled();
    });
  });

  describe('startConversionTask', () => {
    test('should start conversion task and log task ID', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Task created: task-123',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Polling for progress...',
      );
    });
  });

  describe('trackTaskProgress', () => {
    test('should track progress via poll with status and position', async () => {
      const mockTask = createMockTaskWithPollSequence([
        {
          task_id: 'task-123',
          task_status: 'started' as const,
        },
        {
          task_id: 'task-123',
          task_status: 'started' as const,
          task_position: 50,
        },
        {
          task_id: 'task-123',
          task_status: 'success' as const,
        },
      ]);

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(process.stdout.write).toHaveBeenCalledWith(
        '\r[PDFConverter] Status: started',
      );
      expect(process.stdout.write).toHaveBeenCalledWith(
        '\r[PDFConverter] Status: started | position: 50',
      );
    });

    test('should log document progress from task_meta', async () => {
      const mockTask = createMockTaskWithPollSequence([
        {
          task_id: 'task-123',
          task_status: 'started' as const,
          task_meta: {
            total_documents: 10,
            processed_documents: 3,
          },
        },
        {
          task_id: 'task-123',
          task_status: 'started' as const,
          task_position: 1,
          task_meta: {
            total_documents: 10,
            processed_documents: 7,
          },
        },
        {
          task_id: 'task-123',
          task_status: 'success' as const,
        },
      ]);

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(process.stdout.write).toHaveBeenCalledWith(
        '\r[PDFConverter] Status: started | progress: 3/10',
      );
      expect(process.stdout.write).toHaveBeenCalledWith(
        '\r[PDFConverter] Status: started | position: 1 | progress: 7/10',
      );
    });

    test('should ignore task_meta without document counts', async () => {
      const mockTask = createMockTaskWithPollSequence([
        {
          task_id: 'task-123',
          task_status: 'started' as const,
          task_meta: {},
        },
        {
          task_id: 'task-123',
          task_status: 'success' as const,
        },
      ]);

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      // Should only show status, not progress
      expect(process.stdout.write).toHaveBeenCalledWith(
        '\r[PDFConverter] Status: started',
      );
    });

    test('should deduplicate identical progress lines', async () => {
      const mockTask = createMockTaskWithPollSequence([
        {
          task_id: 'task-123',
          task_status: 'started' as const,
        },
        // Same status again — should be deduplicated
        {
          task_id: 'task-123',
          task_status: 'started' as const,
        },
        {
          task_id: 'task-123',
          task_status: 'success' as const,
        },
      ]);

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      const calls = vi
        .mocked(process.stdout.write)
        .mock.calls.filter(
          (call) => call[0] === '\r[PDFConverter] Status: started',
        );
      expect(calls).toHaveLength(1);
    });

    test('should log completion message on success', async () => {
      const mockTask = createMockTask();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(logger.info).toHaveBeenCalledWith(
        '\n[PDFConverter] Conversion completed!',
      );
    });

    test('should throw on task failure status', async () => {
      const mockTask = createMockTask('failure');

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report123',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Task failed: Processing failed');
    });

    test('should throw on task timeout', async () => {
      // Create a converter with a very short timeout
      const shortTimeoutConverter = new PDFConverter(
        logger,
        client,
        false,
        100,
      );

      // Make Date.now() advance past the timeout
      vi.spyOn(Date, 'now')
        .mockReturnValueOnce(1000000) // performConversion startTime
        .mockReturnValueOnce(1000000) // trackTaskProgress conversionStartTime
        .mockReturnValueOnce(1000200); // timeout check (200ms > 100ms timeout)

      const mockTask = createMockTaskWithPollSequence([
        {
          task_id: 'task-123',
          task_status: 'started' as const,
        },
      ]);

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

      await expect(
        shortTimeoutConverter.convert(
          'http://test.com/doc.pdf',
          'report-timeout',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Task timeout');
    });

    test('should poll with configured interval between polls', async () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      const mockTask = createMockTaskWithPollSequence([
        {
          task_id: 'task-123',
          task_status: 'started' as const,
        },
        {
          task_id: 'task-123',
          task_status: 'success' as const,
        },
      ]);

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      // setTimeout should have been called with POLL_INTERVAL_MS between polls
      expect(setTimeoutSpy).toHaveBeenCalledWith(
        expect.any(Function),
        PDF_CONVERTER.POLL_INTERVAL_MS,
      );
    });
  });

  describe('downloadResult', () => {
    test('should download result file successfully', async () => {
      const mockTask = createMockTask();
      const mockFileStream = {} as Readable;
      const writeStream = { write: vi.fn(), end: vi.fn() };

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: mockFileStream,
      });
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(logger.info).toHaveBeenCalledWith(
        '\n[PDFConverter] Task completed, downloading ZIP file...',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Saving ZIP file to:',
        '/test/cwd/result.zip',
      );
      expect(createWriteStream).toHaveBeenCalledWith('/test/cwd/result.zip');
      expect(pipeline).toHaveBeenCalledWith(mockFileStream, writeStream);
    });

    test('should throw error when success is false', async () => {
      const mockTask = createMockTask();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: false,
      } as any);

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Failed to get ZIP file result');
    });

    test('should throw error when fileStream is missing', async () => {
      const mockTask = createMockTask();

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: undefined,
      } as any);

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Failed to get ZIP file result');
    });
  });

  describe('processConvertedFiles', () => {
    test('should call ImageExtractor with correct paths', async () => {
      const mockTask = createMockTask();
      const writeStream = { write: vi.fn(), end: vi.fn() };

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).toHaveBeenCalledWith(
        logger,
        '/test/cwd/result.zip',
        '/test/cwd/result_extracted',
        '/test/cwd/output/report123',
      );
    });
  });

  describe('abort signal handling', () => {
    test('should throw AbortError when aborted after docling task completes', async () => {
      const abortController = new AbortController();

      // Abort during poll (after success)
      const mockTask = {
        taskId: 'task-123',
        poll: vi.fn(async () => {
          abortController.abort();
          return {
            task_id: 'task-123',
            task_status: 'success' as const,
          };
        }),
      } as unknown as AsyncConversionTask;

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-abort-docling',
          vi.fn(),
          false,
          {},
          abortController.signal,
        ),
      ).rejects.toThrow('PDF conversion was aborted');

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Conversion aborted after docling completion',
      );
    });

    test('should throw AbortError when aborted before callback', async () => {
      const mockTask = createMockTask();
      const abortController = new AbortController();
      const writeStream = { write: vi.fn(), end: vi.fn() };

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);

      // Abort after processConvertedFiles (ImageExtractor) completes
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockImplementation(async () => {
        abortController.abort();
      });
      vi.mocked(existsSync).mockReturnValue(true);

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-abort-callback',
          vi.fn(),
          false,
          {},
          abortController.signal,
        ),
      ).rejects.toThrow('PDF conversion was aborted');

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Conversion aborted before callback',
      );
    });

    test('should not attempt fallback when aborted during initial conversion', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const mockTask = createMockTaskWithPollSequence([
        {
          task_id: 'task-123',
          task_status: 'failure' as const,
        },
      ]);

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

      const converterWithFallback = new PDFConverter(logger, client, true);

      await expect(
        converterWithFallback.convert(
          'http://test.com/doc.pdf',
          'report-abort-fallback',
          vi.fn(),
          false,
          {},
          abortController.signal,
        ),
      ).rejects.toThrow('Task failed: Processing failed');

      // Should NOT attempt fallback when aborted
      expect(ImagePdfConverter).not.toHaveBeenCalled();
    });
  });

  describe('getTaskFailureDetails', () => {
    test('should include error messages from task result', async () => {
      const mockTask = {
        taskId: 'task-123',
        poll: vi.fn().mockResolvedValue({
          task_id: 'task-123',
          task_status: 'failure',
        }),
        getResult: vi.fn().mockResolvedValue({
          document: {},
          status: 'failure',
          processing_time: 0,
          errors: [
            { message: 'Page 3: OCR engine timeout' },
            { message: 'Page 7: Image extraction failed' },
          ],
        }),
      } as unknown as AsyncConversionTask;

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-errors',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow(
        'Task failed: Page 3: OCR engine timeout; Page 7: Image extraction failed',
      );

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Page 3: OCR engine timeout'),
      );
    });

    test('should return status when result has no errors', async () => {
      const mockTask = {
        taskId: 'task-123',
        poll: vi.fn().mockResolvedValue({
          task_id: 'task-123',
          task_status: 'failure',
        }),
        getResult: vi.fn().mockResolvedValue({
          document: {},
          status: 'failure',
          processing_time: 0,
        }),
      } as unknown as AsyncConversionTask;

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-no-errors',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Task failed: status: failure');
    });

    test('should return fallback message when getResult throws', async () => {
      const mockTask = {
        taskId: 'task-123',
        poll: vi.fn().mockResolvedValue({
          task_id: 'task-123',
          task_status: 'failure',
        }),
        getResult: vi.fn().mockRejectedValue(new Error('Network error')),
      } as unknown as AsyncConversionTask;

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-getresult-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Task failed: unable to retrieve error details');

      expect(logger.error).toHaveBeenCalledWith(
        '[PDFConverter] Failed to retrieve task result:',
        expect.any(Error),
      );
    });

    test('should log elapsed time in failure message', async () => {
      vi.spyOn(Date, 'now')
        .mockReturnValueOnce(1000000) // performConversion startTime
        .mockReturnValueOnce(1000000) // trackTaskProgress conversionStartTime
        .mockReturnValueOnce(1000000) // timeout check
        .mockReturnValueOnce(1060000); // elapsed calculation (60s later)

      const mockTask = createMockTask('failure');
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

      await expect(
        converter.convert(
          'http://test.com/doc.pdf',
          'report-elapsed',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Task failed after 60s'),
      );
    });
  });

  describe('image PDF fallback', () => {
    test('should not attempt fallback when enableImagePdfFallback is false', async () => {
      const mockTask = createMockTask('failure');

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

      const converterWithoutFallback = new PDFConverter(logger, client, false);

      await expect(
        converterWithoutFallback.convert(
          'http://test.com/doc.pdf',
          'report-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow('Task failed: Processing failed');

      expect(ImagePdfConverter).not.toHaveBeenCalled();
    });

    test('should attempt fallback when enableImagePdfFallback is true and original fails', async () => {
      const successTask = createMockTask();
      let callCount = 0;

      vi.mocked(client.convertSourceAsync).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          const failTask = createMockTask('failure');
          return Promise.resolve(failTask);
        }
        return Promise.resolve(successTask);
      });

      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });

      const mockImagePdfConverter = {
        convert: vi.fn().mockResolvedValue('/tmp/test-image.pdf'),
        cleanup: vi.fn(),
      };
      vi.mocked(ImagePdfConverter).mockImplementation(function () {
        return mockImagePdfConverter as any;
      });

      const writeStream = { write: vi.fn(), end: vi.fn() };
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(false);

      const converterWithFallback = new PDFConverter(logger, client, true);

      await converterWithFallback.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(mockImagePdfConverter.convert).toHaveBeenCalledWith(
        'http://test.com/doc.pdf',
        'report123',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Attempting image PDF fallback...',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Retrying with image PDF:',
        'file:///tmp/test-image.pdf',
      );
      expect(mockImagePdfConverter.cleanup).toHaveBeenCalledWith(
        '/tmp/test-image.pdf',
      );
    });

    test('should throw ImagePdfFallbackError when both original and fallback fail', async () => {
      const mockTask = createMockTask('failure');

      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);

      const mockImagePdfConverter = {
        convert: vi
          .fn()
          .mockRejectedValue(new Error('ImageMagick conversion failed')),
        cleanup: vi.fn(),
      };
      vi.mocked(ImagePdfConverter).mockImplementation(function () {
        return mockImagePdfConverter as any;
      });

      const converterWithFallback = new PDFConverter(logger, client, true);

      await expect(
        converterWithFallback.convert(
          'http://test.com/doc.pdf',
          'report-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow(ImagePdfFallbackError);

      expect(logger.error).toHaveBeenCalledWith(
        '[PDFConverter] Fallback conversion also failed:',
        expect.any(Error),
      );
    });

    test('should cleanup image PDF even when fallback conversion fails', async () => {
      vi.mocked(client.convertSourceAsync).mockImplementation(() => {
        const failTask = createMockTask('failure');
        return Promise.resolve(failTask);
      });

      const mockImagePdfConverter = {
        convert: vi.fn().mockResolvedValue('/tmp/test-image.pdf'),
        cleanup: vi.fn(),
      };
      vi.mocked(ImagePdfConverter).mockImplementation(function () {
        return mockImagePdfConverter as any;
      });

      const converterWithFallback = new PDFConverter(logger, client, true);

      await expect(
        converterWithFallback.convert(
          'http://test.com/doc.pdf',
          'report-fail',
          vi.fn(),
          false,
          {},
        ),
      ).rejects.toThrow(ImagePdfFallbackError);

      // Cleanup should still be called
      expect(mockImagePdfConverter.cleanup).toHaveBeenCalledWith(
        '/tmp/test-image.pdf',
      );
    });

    test('should log success message when fallback succeeds', async () => {
      const successTask = createMockTask();
      let callCount = 0;

      vi.mocked(client.convertSourceAsync).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          const failTask = createMockTask('failure');
          return Promise.resolve(failTask);
        }
        return Promise.resolve(successTask);
      });

      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });

      const mockImagePdfConverter = {
        convert: vi.fn().mockResolvedValue('/tmp/test-image.pdf'),
        cleanup: vi.fn(),
      };
      vi.mocked(ImagePdfConverter).mockImplementation(function () {
        return mockImagePdfConverter as any;
      });

      const writeStream = { write: vi.fn(), end: vi.fn() };
      vi.mocked(createWriteStream).mockReturnValue(writeStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(
        ImageExtractor.extractAndSaveDocumentsFromZip,
      ).mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReturnValue(false);

      const converterWithFallback = new PDFConverter(logger, client, true);

      await converterWithFallback.convert(
        'http://test.com/doc.pdf',
        'report123',
        vi.fn(),
        false,
        {},
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Fallback conversion succeeded',
      );
    });
  });

  describe('forceImagePdf', () => {
    test('should convert via image PDF when forceImagePdf is true', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await converter.convert(
        'http://test.com/doc.pdf',
        'report-force-img',
        vi.fn(),
        false,
        { forceImagePdf: true },
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[PDFConverter] Force image PDF mode: converting to image PDF first...',
      );
      expect(ImagePdfConverter).toHaveBeenCalled();
    });

    test('should not convert via image PDF when forceImagePdf is false with VLM pipeline', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      vi.mocked(ImagePdfConverter).mockClear();

      await converter.convert(
        'http://test.com/doc.pdf',
        'report-vlm-no-force',
        vi.fn(),
        false,
        { pipeline: 'vlm', forceImagePdf: false },
      );

      expect(ImagePdfConverter).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalledWith(
        '[PDFConverter] Force image PDF mode: converting to image PDF first...',
      );
    });

    test('should not convert via image PDF when forceImagePdf is false with standard pipeline', async () => {
      const mockTask = createMockTask();
      vi.mocked(client.convertSourceAsync).mockResolvedValue(mockTask);
      vi.mocked(client.getTaskResultFile).mockResolvedValue({
        success: true,
        fileStream: {} as Readable,
      });
      vi.mocked(existsSync).mockReturnValue(false);

      vi.mocked(ImagePdfConverter).mockClear();

      await converter.convert(
        'http://test.com/doc.pdf',
        'report-std-no-force',
        vi.fn(),
        false,
        { forceImagePdf: false },
      );

      expect(ImagePdfConverter).not.toHaveBeenCalled();
    });
  });
});

describe('ValidationUtils monkey-patch', () => {
  test('should strip pipeline field before delegating to original validation', () => {
    const options = {
      pipeline: 'vlm',
      to_formats: ['json'],
    } as unknown as Parameters<
      typeof ValidationUtils.assertValidConversionOptions
    >[0];

    // The patched assertValidConversionOptions should not throw
    // even though "vlm" is not in the original ProcessingPipelineSchema
    expect(() =>
      ValidationUtils.assertValidConversionOptions(options),
    ).not.toThrow();
  });

  test('should still validate other fields normally', () => {
    const options = {
      to_formats: ['json'],
    } as unknown as Parameters<
      typeof ValidationUtils.assertValidConversionOptions
    >[0];

    expect(() =>
      ValidationUtils.assertValidConversionOptions(options),
    ).not.toThrow();
  });
});

/**
 * Create a mock task that returns success (or specified status) on first poll.
 */
function createMockTask(
  finalStatus: 'success' | 'failure' = 'success',
): AsyncConversionTask {
  const task = {
    taskId: 'task-123',
    poll: vi.fn().mockResolvedValue({
      task_id: 'task-123',
      task_status: finalStatus,
    }),
    getResult: vi.fn().mockResolvedValue({
      document: {},
      status: finalStatus,
      processing_time: 0,
      errors:
        finalStatus === 'failure'
          ? [{ message: 'Processing failed' }]
          : undefined,
    }),
  };
  return task as unknown as AsyncConversionTask;
}

/**
 * Create a mock task with a sequence of poll responses.
 * Each call to poll() returns the next response in the sequence.
 */
function createMockTaskWithPollSequence(
  responses: Array<{
    task_id: string;
    task_status: 'pending' | 'started' | 'success' | 'failure';
    task_position?: number;
    task_meta?: { total_documents?: number; processed_documents?: number };
  }>,
): AsyncConversionTask {
  const pollMock = vi.fn();
  responses.forEach((response) => {
    pollMock.mockResolvedValueOnce(response);
  });

  const lastStatus = responses[responses.length - 1]?.task_status ?? 'success';

  const task = {
    taskId: 'task-123',
    poll: pollMock,
    getResult: vi.fn().mockResolvedValue({
      document: {},
      status: lastStatus,
      processing_time: 0,
      errors:
        lastStatus === 'failure'
          ? [{ message: 'Processing failed' }]
          : undefined,
    }),
  };
  return task as unknown as AsyncConversionTask;
}
