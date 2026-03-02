import type { z } from 'zod';

import {
  type LanguageModel,
  NoObjectGeneratedError,
  Output,
  generateText,
  hasToolCall,
  tool,
} from 'ai';

import { detectProvider } from './provider-detector';

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
   * Maximum number of retries when structured output generation fails.
   * Total attempts = MAX_STRUCTURED_OUTPUT_RETRIES + 1.
   *
   * Applied to both:
   * - `Output.object()` path: retries on NoObjectGeneratedError (schema mismatch)
   * - Tool call path: retries when model does not produce a tool call
   */
  private static readonly MAX_STRUCTURED_OUTPUT_RETRIES = 10;

  /**
   * Generate structured output via forced tool call.
   *
   * Used for providers (Together AI, unknown) that do not reliably support
   * `Output.object()`. Forces the model to call a tool whose inputSchema
   * is the target Zod schema, then extracts the parsed input.
   *
   * Retries up to MAX_STRUCTURED_OUTPUT_RETRIES times when the model does not
   * produce a tool call, for a total of MAX_STRUCTURED_OUTPUT_RETRIES + 1 attempts.
   *
   * @throws NoObjectGeneratedError when all attempts fail to produce a tool call
   */
  private static async generateViaToolCall<TOutput>(
    model: LanguageModel,
    schema: z.ZodType<TOutput>,
    promptParams: Record<string, unknown>,
  ): Promise<{
    output: TOutput;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  }> {
    const submitTool = tool({
      description: 'Submit the structured result',
      inputSchema: schema,
    });

    let lastResult: any;

    for (
      let attempt = 0;
      attempt <= this.MAX_STRUCTURED_OUTPUT_RETRIES;
      attempt++
    ) {
      lastResult = await (generateText as any)({
        ...promptParams,
        model,
        tools: { submitResult: submitTool },
        toolChoice: { type: 'tool', toolName: 'submitResult' },
        stopWhen: hasToolCall('submitResult'),
      });

      const toolCall = lastResult.toolCalls?.[0] as
        | { input: unknown }
        | undefined;
      if (toolCall) {
        return {
          output: toolCall.input as TOutput,
          usage: lastResult.usage,
        };
      }
    }

    throw new NoObjectGeneratedError({
      message: 'Model did not produce a tool call for structured output',
      text: lastResult.text ?? '',
      response: lastResult.response,
      usage: lastResult.usage,
      finishReason: lastResult.finishReason,
    });
  }

  /**
   * Generate structured output with provider-aware strategy.
   *
   * Strategy per provider:
   * - OpenAI / Anthropic / Google Gemini: `Output.object()` with schema retry
   * - Together AI / unknown: forced tool call pattern
   *
   * Retries up to MAX_STRUCTURED_OUTPUT_RETRIES times on NoObjectGeneratedError
   * (schema mismatch), re-throwing the last error if all attempts fail.
   */
  private static async generateStructuredOutput<TOutput>(
    model: LanguageModel,
    schema: z.ZodType<TOutput>,
    promptParams: Record<string, unknown>,
  ): Promise<{
    output: TOutput;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  }> {
    const providerType = detectProvider(model);

    if (providerType === 'togetherai' || providerType === 'unknown') {
      return this.generateViaToolCall(model, schema, promptParams);
    }

    let lastError: unknown;

    for (
      let attempt = 0;
      attempt <= this.MAX_STRUCTURED_OUTPUT_RETRIES;
      attempt++
    ) {
      try {
        return await (generateText as any)({
          model,
          output: Output.object({ schema }),
          ...promptParams,
        });
      } catch (error) {
        if (NoObjectGeneratedError.isInstance(error)) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Execute LLM call with fallback support
   *
   * Common execution logic for both text and vision calls.
   * Logs additional details when NoObjectGeneratedError occurs.
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
   * Provider-aware strategy is automatically applied based on the model's provider field.
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
      this.generateStructuredOutput(model, config.schema, {
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
   * Provider-aware strategy is automatically applied based on the model's provider field.
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
      this.generateStructuredOutput(model, config.schema, {
        messages: config.messages,
        temperature: config.temperature,
        maxRetries: config.maxRetries,
        abortSignal: config.abortSignal,
      }),
    );
  }
}
