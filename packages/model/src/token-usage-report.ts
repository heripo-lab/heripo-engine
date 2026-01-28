/**
 * Token usage report types for document processing
 *
 * Provides structured types for tracking and reporting LLM token consumption
 * across document processing pipeline, with detailed breakdown by component,
 * phase, and model type (primary vs fallback).
 */

/**
 * Detailed token usage report for document processing
 *
 * Contains comprehensive breakdown of token usage across all components
 * and phases of the processing pipeline.
 */
export interface TokenUsageReport {
  /**
   * Breakdown by component
   *
   * Array of ComponentUsageReport for each component that performed LLM calls.
   * Components are ordered by the order they appear in the processing pipeline.
   */
  components: ComponentUsageReport[];

  /**
   * Grand total across all components and phases
   *
   * Sum of all input tokens, output tokens, and total tokens from all components.
   */
  total: TokenUsageSummary;
}

/**
 * Token usage for a specific component
 *
 * Examples: PageRangeParser, TocExtractor, CaptionParser, CaptionValidator, etc.
 */
export interface ComponentUsageReport {
  /**
   * Component name
   *
   * Examples: 'PageRangeParser', 'TocExtractor', 'TocContentValidator',
   *           'CaptionParser', 'CaptionValidator', 'VisionTocExtractor'
   */
  component: string;

  /**
   * Breakdown by phase within this component
   *
   * Array of PhaseUsageReport for each phase executed by this component.
   * A component may have multiple phases (e.g., extraction, validation, sampling).
   */
  phases: PhaseUsageReport[];

  /**
   * Total usage for this component
   *
   * Sum of all phases within this component.
   */
  total: TokenUsageSummary;
}

/**
 * Token usage for a specific phase
 *
 * Examples: extraction, validation, sampling, caption-extraction
 *
 * A phase may use both primary and fallback models if primary fails and fallback retry is configured.
 */
export interface PhaseUsageReport {
  /**
   * Phase name
   *
   * Examples: 'extraction', 'validation', 'sampling', 'caption-extraction'
   *
   * Phase names are set by the component performing the LLM call.
   */
  phase: string;

  /**
   * Usage by primary model (if any)
   *
   * Present if the primary model was attempted and succeeded.
   * Absent if primary model was never attempted or failed.
   *
   * When fallback retry is enabled and primary fails, primary usage data
   * is not recorded (only the successful fallback attempt is recorded).
   */
  primary?: ModelUsageDetail;

  /**
   * Usage by fallback model (if any)
   *
   * Present if the fallback model was used after primary failure.
   * Only present when primaryModel failed and fallbackModel was available.
   */
  fallback?: ModelUsageDetail;

  /**
   * Total usage for this phase
   *
   * Sum of primary usage and fallback usage if both are present.
   * If only primary or only fallback is present, equals that model's usage.
   */
  total: TokenUsageSummary;
}

/**
 * Detailed usage for a specific model
 *
 * Contains the exact token counts for a model used in a specific phase.
 */
export interface ModelUsageDetail {
  /**
   * Model identifier
   *
   * Examples: 'gpt-5', 'gpt-5-mini', 'claude-opus-4-5-20251101',
   *           'claude-opus-4-5', 'claude-sonnet-4-20250514'
   */
  modelName: string;

  /**
   * Number of input tokens consumed
   *
   * Tokens in the prompt (system + user input).
   */
  inputTokens: number;

  /**
   * Number of output tokens consumed
   *
   * Tokens in the model's response.
   */
  outputTokens: number;

  /**
   * Total tokens
   *
   * Always equals inputTokens + outputTokens.
   */
  totalTokens: number;
}

/**
 * Summary of token usage
 *
 * Minimal representation of token counts for aggregation and reporting.
 */
export interface TokenUsageSummary {
  /**
   * Total input tokens
   */
  inputTokens: number;

  /**
   * Total output tokens
   */
  outputTokens: number;

  /**
   * Total tokens (input + output)
   */
  totalTokens: number;
}
