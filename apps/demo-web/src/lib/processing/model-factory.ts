import type { DocumentProcessorOptions } from '@heripo/document-processor';
import type { LoggerMethods } from '@heripo/logger';
import type { TokenUsageReport } from '@heripo/model';
import type { LanguageModel } from 'ai';

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createTogetherAI } from '@ai-sdk/togetherai';
import { createOllama } from 'ai-sdk-ollama';

import type { ProcessingOptions } from '~/features/upload';

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

// Lazy provider instances
let openaiProvider: ReturnType<typeof createOpenAI> | null = null;
let anthropicProvider: ReturnType<typeof createAnthropic> | null = null;
let googleProvider: ReturnType<typeof createGoogleGenerativeAI> | null = null;
let togetherProvider: ReturnType<typeof createTogetherAI> | null = null;
let ollamaProvider: ReturnType<typeof createOllama> | null = null;

function getOpenAI() {
  if (!openaiProvider) {
    openaiProvider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  }
  return openaiProvider;
}

function getAnthropic() {
  if (!anthropicProvider) {
    anthropicProvider = createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });
  }
  return anthropicProvider;
}

function getGoogle() {
  if (!googleProvider) {
    googleProvider = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY!,
    });
  }
  return googleProvider;
}

function getTogether() {
  if (!togetherProvider) {
    togetherProvider = createTogetherAI({
      apiKey: process.env.TOGETHER_AI_API_KEY!,
    });
  }
  return togetherProvider;
}

function getOllama() {
  if (!ollamaProvider) {
    ollamaProvider = createOllama({
      baseURL: process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL,
    });
  }
  return ollamaProvider;
}

/**
 * Converts model ID string to LanguageModel instance
 *
 * Model ID format: "provider/model-name"
 * Examples:
 *   - "openai/gpt-5.2"
 *   - "anthropic/claude-opus-4.6"
 *   - "google/gemini-3-flash-preview"
 *   - "together/Qwen/Qwen3-235B-A22B-Instruct-2507-tput"
 *   - "ollama/qwen3.5:9b-mlx"
 */
export function createModel(modelId: string): LanguageModel {
  const [provider, ...rest] = modelId.split('/');
  const modelName = rest.join('/');

  switch (provider) {
    case 'openai':
      return getOpenAI()(modelName);
    case 'anthropic':
      return getAnthropic()(modelName);
    case 'google':
      return getGoogle()(modelName);
    case 'together':
      return getTogether()(modelName);
    case 'ollama':
      // 기본 think:false (추론 비활성화). MLX 백엔드는 grammar 미지원이라
      // LLMCaller 가 tool-call 로 구조화한다.
      return getOllama()(modelName, { think: false });
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Creates DocumentProcessor options from frontend options
 */
export function createProcessorOptions(
  options: ProcessingOptions,
  logger: LoggerMethods,
  abortSignal?: AbortSignal,
  onTokenUsage?: (report: TokenUsageReport) => void,
): DocumentProcessorOptions {
  return {
    logger,
    fallbackModel: createModel(options.fallbackModel),
    pageRangeParserModel: createModel(options.pageRangeParserModel),
    tocExtractorModel: createModel(options.tocExtractorModel),
    validatorModel: createModel(options.validatorModel),
    visionTocExtractorModel: createModel(options.visionTocExtractorModel),
    captionParserModel: createModel(options.captionParserModel),
    textCleanerBatchSize: options.textCleanerBatchSize,
    captionParserBatchSize: options.captionParserBatchSize,
    captionValidatorBatchSize: options.captionValidatorBatchSize,
    maxRetries: options.maxRetries,
    enableFallbackRetry: options.enableFallbackRetry,
    abortSignal,
    onTokenUsage,
  };
}
