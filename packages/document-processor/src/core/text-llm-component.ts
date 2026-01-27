import type { LoggerMethods } from '@heripo/logger';
import type {
  ExtendedTokenUsage,
  LLMTokenUsageAggregator,
} from '@heripo/shared';
import type { LanguageModel } from 'ai';
import type { z } from 'zod';

import { LLMCaller } from '@heripo/shared';

import {
  BaseLLMComponent,
  type BaseLLMComponentOptions,
} from './base-llm-component';

export type { BaseLLMComponentOptions } from './base-llm-component';

/**
 * Abstract base class for text-based LLM components
 *
 * Extends BaseLLMComponent with helper method for text-based LLM calls
 * using LLMCaller.call() (non-vision).
 *
 * Subclasses: TocExtractor, CaptionParser, BaseValidator
 */
export abstract class TextLLMComponent extends BaseLLMComponent {
  constructor(
    logger: LoggerMethods,
    model: LanguageModel,
    componentName: string,
    options?: BaseLLMComponentOptions,
    fallbackModel?: LanguageModel,
    aggregator?: LLMTokenUsageAggregator,
  ) {
    super(logger, model, componentName, options, fallbackModel, aggregator);
  }

  /**
   * Call LLM with text-based prompts using LLMCaller.call()
   *
   * @template TSchema - Zod schema type for response validation
   * @param schema - Zod schema for response validation
   * @param systemPrompt - System prompt for LLM
   * @param userPrompt - User prompt for LLM
   * @param phase - Phase name for tracking (e.g., 'extraction', 'validation')
   * @returns Promise with parsed object and usage information
   */
  protected async callTextLLM<TSchema extends z.ZodType>(
    schema: TSchema,
    systemPrompt: string,
    userPrompt: string,
    phase: string,
  ): Promise<{ output: z.infer<TSchema>; usage: ExtendedTokenUsage }> {
    const result = await LLMCaller.call({
      schema,
      systemPrompt,
      userPrompt,
      primaryModel: this.model,
      fallbackModel: this.fallbackModel,
      maxRetries: this.maxRetries,
      temperature: this.temperature,
      abortSignal: this.abortSignal,
      component: this.componentName,
      phase,
    });

    this.trackUsage(result.usage);

    return {
      output: result.output as z.infer<TSchema>,
      usage: result.usage,
    };
  }
}
