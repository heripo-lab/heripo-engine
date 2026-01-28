import type { LoggerMethods } from '@heripo/logger';
import type {
  ExtendedTokenUsage,
  LLMTokenUsageAggregator,
} from '@heripo/shared';
import type { LanguageModel } from 'ai';
import type { z } from 'zod';

import { LLMCaller } from '@heripo/shared';

import {
  type BaseLLMComponentOptions,
  TextLLMComponent,
} from '../core/text-llm-component';

/**
 * Base options for all validators
 *
 * Re-exported from BaseLLMComponentOptions for backwards compatibility.
 */
export type BaseValidatorOptions = BaseLLMComponentOptions;

/**
 * Abstract base class for LLM-based validators
 *
 * Extends TextLLMComponent to provide common functionality for validators
 * that use LLM to validate/analyze content:
 * - LLM API call wrapper with LLMCaller (via callLLM method)
 * - Standard logging patterns (via log method from base class)
 * - Retry and fallback configuration
 *
 * Token usage is tracked by LLMCaller and should be aggregated by DocumentProcessor.
 *
 * @template TSchema - Zod schema type for validation
 * @template TResult - Result type after parsing with schema
 */
export abstract class BaseValidator<
  TSchema extends z.ZodType,
  TResult = z.infer<TSchema>,
> extends TextLLMComponent {
  /**
   * Validator name for logging (kept for backwards compatibility)
   */
  protected readonly validatorName: string;

  /**
   * Constructor for BaseValidator
   *
   * @param logger - Logger instance
   * @param model - Language model to use for validation
   * @param validatorName - Name of the validator for logging (e.g., "TocContentValidator")
   * @param options - Optional configuration (maxRetries, temperature)
   * @param fallbackModel - Optional fallback model for retry on failure
   * @param aggregator - Optional token usage aggregator for tracking LLM calls
   */
  constructor(
    logger: LoggerMethods,
    model: LanguageModel,
    validatorName: string,
    options?: BaseValidatorOptions,
    fallbackModel?: LanguageModel,
    aggregator?: LLMTokenUsageAggregator,
  ) {
    super(logger, model, validatorName, options, fallbackModel, aggregator);
    this.validatorName = validatorName;
  }

  /**
   * Call LLM with LLMCaller
   *
   * This method provides backwards compatibility with existing validators.
   * It wraps the parent callTextLLM method but allows passing a custom aggregator.
   *
   * @param schema - Zod schema for response validation
   * @param systemPrompt - System prompt
   * @param userPrompt - User prompt
   * @param phase - Phase name for tracking (e.g., 'validation', 'batch-validation')
   * @param aggregator - Optional token usage aggregator for tracking this call
   * @returns Parsed and validated LLM response with usage information
   */
  protected async callLLM(
    schema: TSchema,
    systemPrompt: string,
    userPrompt: string,
    phase: string,
    aggregator?: LLMTokenUsageAggregator,
  ): Promise<{ output: TResult; usage: ExtendedTokenUsage }> {
    const result = await LLMCaller.call({
      schema,
      systemPrompt,
      userPrompt,
      primaryModel: this.model,
      fallbackModel: this.fallbackModel,
      maxRetries: this.maxRetries,
      temperature: this.temperature,
      abortSignal: this.abortSignal,
      component: this.validatorName,
      phase,
    });

    // Track to custom aggregator if provided, otherwise use base class aggregator
    if (aggregator) {
      aggregator.track(result.usage);
    } else {
      this.trackUsage(result.usage);
    }

    return {
      output: result.output as TResult,
      usage: result.usage,
    };
  }
}
