import type { LoggerMethods } from '@heripo/logger';
import type {
  ExtendedTokenUsage,
  LLMTokenUsageAggregator,
} from '@heripo/shared';
import type { LanguageModel } from 'ai';

/**
 * Base options for all LLM-based components
 */
export interface BaseLLMComponentOptions {
  /**
   * Maximum retry count for LLM API (default: 3)
   */
  maxRetries?: number;

  /**
   * Temperature for LLM generation (default: 0)
   */
  temperature?: number;

  /**
   * Abort signal for cancellation support
   */
  abortSignal?: AbortSignal;
}

/**
 * Abstract base class for all LLM-based components
 *
 * Provides common functionality:
 * - Consistent logging with component name prefix
 * - Token usage tracking via optional aggregator
 * - Standard configuration (model, fallback, retries, temperature)
 *
 * Subclasses must implement buildSystemPrompt() and buildUserPrompt().
 */
export abstract class BaseLLMComponent {
  protected readonly logger: LoggerMethods;
  protected readonly model: LanguageModel;
  protected readonly fallbackModel?: LanguageModel;
  protected readonly maxRetries: number;
  protected readonly temperature: number;
  protected readonly componentName: string;
  protected readonly aggregator?: LLMTokenUsageAggregator;
  protected readonly abortSignal?: AbortSignal;

  /**
   * Constructor for BaseLLMComponent
   *
   * @param logger - Logger instance for logging
   * @param model - Primary language model for LLM calls
   * @param componentName - Name of the component for logging (e.g., "TocExtractor")
   * @param options - Optional configuration (maxRetries, temperature)
   * @param fallbackModel - Optional fallback model for retry on failure
   * @param aggregator - Optional token usage aggregator for tracking LLM calls
   */
  constructor(
    logger: LoggerMethods,
    model: LanguageModel,
    componentName: string,
    options?: BaseLLMComponentOptions,
    fallbackModel?: LanguageModel,
    aggregator?: LLMTokenUsageAggregator,
  ) {
    this.logger = logger;
    this.model = model;
    this.componentName = componentName;
    this.maxRetries = options?.maxRetries ?? 3;
    this.temperature = options?.temperature ?? 0;
    this.fallbackModel = fallbackModel;
    this.aggregator = aggregator;
    this.abortSignal = options?.abortSignal;
  }

  /**
   * Log a message with consistent component name prefix
   *
   * @param level - Log level ('info', 'warn', 'error')
   * @param message - Message to log (without prefix)
   * @param args - Additional arguments to pass to logger
   */
  protected log(
    level: 'info' | 'warn' | 'error',
    message: string,
    ...args: unknown[]
  ): void {
    const formattedMessage = `[${this.componentName}] ${message}`;
    this.logger[level](formattedMessage, ...args);
  }

  /**
   * Track token usage to aggregator if available
   *
   * @param usage - Token usage information to track
   */
  protected trackUsage(usage: ExtendedTokenUsage): void {
    if (this.aggregator) {
      this.aggregator.track(usage);
    }
  }

  /**
   * Create an empty usage record for edge cases (e.g., empty input)
   *
   * @param phase - Phase name for the usage record
   * @returns Empty ExtendedTokenUsage object
   */
  protected createEmptyUsage(phase: string): ExtendedTokenUsage {
    return {
      component: this.componentName,
      phase,
      model: 'primary',
      modelName: 'none',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
  }

  /**
   * Build system prompt for LLM call
   *
   * Subclasses must implement this to provide component-specific system prompts.
   */
  protected abstract buildSystemPrompt(...args: unknown[]): string;

  /**
   * Build user prompt for LLM call
   *
   * Subclasses must implement this to construct prompts from input data.
   */
  protected abstract buildUserPrompt(...args: unknown[]): string;
}
