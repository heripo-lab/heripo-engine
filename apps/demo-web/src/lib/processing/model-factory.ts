import type { DocumentProcessorOptions } from '@heripo/document-processor';
import type { LoggerMethods } from '@heripo/logger';
import type { TokenUsageReport } from '@heripo/model';
import type { LanguageModel } from 'ai';

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createTogetherAI } from '@ai-sdk/togetherai';

import type { ProcessingOptions } from '~/features/upload';

// Lazy provider instances
let openaiProvider: ReturnType<typeof createOpenAI> | null = null;
let anthropicProvider: ReturnType<typeof createAnthropic> | null = null;
let googleProvider: ReturnType<typeof createGoogleGenerativeAI> | null = null;
let togetherProvider: ReturnType<typeof createTogetherAI> | null = null;

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

/**
 * Converts model ID string to LanguageModel instance
 *
 * Model ID format: "provider/model-name"
 * Examples:
 *   - "openai/gpt-5.2"
 *   - "anthropic/claude-opus-4.6"
 *   - "google/gemini-3-flash-preview"
 *   - "together/Qwen/Qwen3-235B-A22B-Instruct-2507-tput"
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
