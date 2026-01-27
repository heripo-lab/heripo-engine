import type { z } from 'zod';

import { type LanguageModel, Output, generateText } from 'ai';

/**
 * Configuration for LLM API call with retry and fallback support
 */
export interface LLMCallConfig<TSchema extends z.ZodType> {
  /**
   * Zod schema for response validation
   */
  schema: TSchema;

  /**
   * System prompt for LLM
   */
  systemPrompt: string;

  /**
   * User prompt for LLM
   */
  userPrompt: string;

  /**
   * Primary model for the call (required)
   */
  primaryModel: LanguageModel;

  /**
   * Fallback model for retry after primary model exhausts maxRetries (optional)
   */
  fallbackModel?: LanguageModel;

  /**
   * Maximum retry count per model (default: 3)
   */
  maxRetries: number;

  /**
   * Temperature for generation (optional, 0-1)
   */
  temperature?: number;

  /**
   * Abort signal for cancellation support
   */
  abortSignal?: AbortSignal;

  /**
   * Component name for tracking (e.g., 'TocExtractor', 'PageRangeParser')
   */
  component: string;

  /**
   * Phase name for tracking (e.g., 'extraction', 'validation', 'sampling')
   */
  phase: string;
}

/**
 * Configuration for LLM vision call with message format
 */
export interface LLMVisionCallConfig<TSchema extends z.ZodType> {
  /**
   * Zod schema for response validation
   */
  schema: TSchema;

  /**
   * Messages array for vision LLM (instead of systemPrompt/userPrompt)
   */
  messages: Array<{ role: 'user' | 'assistant'; content: any[] | string }>;

  /**
   * Primary model for the call (required)
   */
  primaryModel: LanguageModel;

  /**
   * Fallback model for retry after primary model exhausts maxRetries (optional)
   */
  fallbackModel?: LanguageModel;

  /**
   * Maximum retry count per model (default: 3)
   */
  maxRetries: number;

  /**
   * Temperature for generation (optional, 0-1)
   */
  temperature?: number;

  /**
   * Abort signal for cancellation support
   */
  abortSignal?: AbortSignal;

  /**
   * Component name for tracking (e.g., 'TocExtractor', 'PageRangeParser')
   */
  component: string;

  /**
   * Phase name for tracking (e.g., 'extraction', 'validation', 'sampling')
   */
  phase: string;
}

/**
 * Token usage information with model tracking
 */
export interface ExtendedTokenUsage {
  component: string;
  phase: string;
  model: 'primary' | 'fallback';
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Result of LLM call including usage information
 */
export interface LLMCallResult<T> {
  output: T;
  usage: ExtendedTokenUsage;
  usedFallback: boolean;
}

/**
 * Base execution configuration for LLM calls
 */
interface ExecutionConfig {
  primaryModel: LanguageModel;
  fallbackModel?: LanguageModel;
  abortSignal?: AbortSignal;
  component: string;
  phase: string;
}

/**
 * LLMCaller - Centralized LLM API caller with retry and fallback support
 *
 * Wraps AI SDK's generateText with enhanced retry strategy:
 * 1. Try primary model with maxRetries
 * 2. If all attempts fail and fallbackModel provided, try fallback with maxRetries
 * 3. Return usage data with model type indicator
 *
 * @example
 * ```typescript
 * const result = await LLMCaller.call({
 *   schema: MyZodSchema,
 *   systemPrompt: 'You are a helpful assistant',
 *   userPrompt: 'Extract the TOC from this markdown',
 *   primaryModel: openai('gpt-5'),
 *   fallbackModel: anthropic('claude-opus-4-5'),
 *   maxRetries: 3,
 *   component: 'TocExtractor',
 *   phase: 'extraction',
 * });
 *
 * console.log(result.output);        // Parsed result
 * console.log(result.usage);         // Token usage with model info
 * console.log(result.usedFallback);  // Whether fallback was used
 * ```
 */
export class LLMCaller {
  /**
   * Extract model name from LanguageModel object
   *
   * Attempts to get model ID from various possible fields in the LanguageModel object.
   */
  private static extractModelName(model: LanguageModel): string {
    const modelObj = model as Record<string, unknown>;

    // Try common field names
    if (typeof modelObj.modelId === 'string') return modelObj.modelId;
    if (typeof modelObj.id === 'string') return modelObj.id;
    if (typeof modelObj.model === 'string') return modelObj.model;
    if (typeof modelObj.name === 'string') return modelObj.name;

    // Fallback: return object representation
    return String(model);
  }

  /**
   * Build usage information from response
   */
  private static buildUsage(
    config: ExecutionConfig,
    modelName: string,
    response: {
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
    },
    usedFallback: boolean,
  ): ExtendedTokenUsage {
    return {
      component: config.component,
      phase: config.phase,
      model: usedFallback ? 'fallback' : 'primary',
      modelName,
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
      totalTokens: response.usage?.totalTokens ?? 0,
    };
  }

  /**
   * Execute LLM call with fallback support
   *
   * Common execution logic for both text and vision calls.
   */
  private static async executeWithFallback<TOutput>(
    config: ExecutionConfig,
    generateFn: (model: LanguageModel) => Promise<{
      output: TOutput;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
    }>,
  ): Promise<LLMCallResult<TOutput>> {
    const primaryModelName = this.extractModelName(config.primaryModel);

    // Attempt 1: Try primary model
    try {
      const response = await generateFn(config.primaryModel);

      return {
        output: response.output,
        usage: this.buildUsage(config, primaryModelName, response, false),
        usedFallback: false,
      };
    } catch (primaryError) {
      // If aborted, don't try fallback - re-throw immediately
      if (config.abortSignal?.aborted) {
        throw primaryError;
      }

      // If no fallback model, throw immediately
      if (!config.fallbackModel) {
        throw primaryError;
      }

      // Attempt 2: Try fallback model
      const fallbackModelName = this.extractModelName(config.fallbackModel);
      const response = await generateFn(config.fallbackModel);

      return {
        output: response.output,
        usage: this.buildUsage(config, fallbackModelName, response, true),
        usedFallback: true,
      };
    }
  }

  /**
   * Call LLM with retry and fallback support
   *
   * Retry Strategy:
   * 1. Try primary model up to maxRetries times
   * 2. If all fail and fallbackModel provided, try fallback up to maxRetries times
   * 3. Throw error if all attempts exhausted
   *
   * @template TOutput - Output type from schema validation
   * @param config - LLM call configuration
   * @returns Result with parsed object and usage information
   * @throws Error if all retry attempts fail
   */
  static async call<TOutput = unknown>(
    config: LLMCallConfig<z.ZodType<TOutput>>,
  ): Promise<LLMCallResult<TOutput>> {
    return this.executeWithFallback(config, (model) =>
      generateText({
        model,
        output: Output.object({
          schema: config.schema,
        }),
        system: config.systemPrompt,
        prompt: config.userPrompt,
        temperature: config.temperature,
        maxRetries: config.maxRetries,
        abortSignal: config.abortSignal,
      }),
    );
  }

  /**
   * Call LLM for vision tasks with message format support
   *
   * Same retry and fallback logic as call(), but using message format instead of system/user prompts.
   *
   * @template TOutput - Output type from schema validation
   * @param config - LLM vision call configuration
   * @returns Result with parsed object and usage information
   * @throws Error if all retry attempts fail
   */
  static async callVision<TOutput = unknown>(
    config: LLMVisionCallConfig<z.ZodType<TOutput>>,
  ): Promise<LLMCallResult<TOutput>> {
    return this.executeWithFallback(config, (model) =>
      generateText({
        model,
        output: Output.object({
          schema: config.schema,
        }),
        messages: config.messages,
        temperature: config.temperature,
        maxRetries: config.maxRetries,
        abortSignal: config.abortSignal,
      }),
    );
  }
}
