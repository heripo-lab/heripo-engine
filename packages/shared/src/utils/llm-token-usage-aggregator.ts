import type { LoggerMethods } from '@heripo/logger';

import type { ExtendedTokenUsage } from './llm-caller';

/**
 * Token usage totals
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Format token usage as a human-readable string
 *
 * @param usage - Token usage object with input, output, and total counts
 * @returns Formatted string like "1500 input, 300 output, 1800 total"
 */
function formatTokens(usage: TokenUsage): string {
  return `${usage.inputTokens} input, ${usage.outputTokens} output, ${usage.totalTokens} total`;
}

/**
 * Aggregated token usage for a specific component
 */
interface ComponentAggregate {
  component: string;
  phases: Record<
    string,
    {
      primary?: {
        modelName: string;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
      fallback?: {
        modelName: string;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
      total: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    }
  >;
  total: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

/**
 * LLMTokenUsageAggregator - Aggregates token usage across all LLM calls
 *
 * Unlike LLMTokenUsageTracker which logs immediately after each component,
 * this aggregator collects usage data from all components and logs a comprehensive
 * summary at the end of document processing.
 *
 * Tracks usage by:
 * - Component (TocExtractor, PageRangeParser, etc.)
 * - Phase (extraction, validation, sampling, etc.)
 * - Model (primary vs fallback)
 *
 * @example
 * ```typescript
 * const aggregator = new LLMTokenUsageAggregator();
 *
 * // Track usage from each LLM call
 * aggregator.track({
 *   component: 'TocExtractor',
 *   phase: 'extraction',
 *   model: 'primary',
 *   modelName: 'gpt-5',
 *   inputTokens: 1500,
 *   outputTokens: 300,
 *   totalTokens: 1800,
 * });
 *
 * aggregator.track({
 *   component: 'PageRangeParser',
 *   phase: 'sampling',
 *   model: 'fallback',
 *   modelName: 'claude-opus-4-5',
 *   inputTokens: 2000,
 *   outputTokens: 100,
 *   totalTokens: 2100,
 * });
 *
 * // Log comprehensive summary
 * aggregator.logSummary(logger);
 * // Outputs:
 * // [DocumentProcessor] Token usage summary:
 * // TocExtractor:
 * //   - extraction (primary: gpt-5): 1500 input, 300 output, 1800 total
 * //   TocExtractor total: 1500 input, 300 output, 1800 total
 * // PageRangeParser:
 * //   - sampling (fallback: claude-opus-4-5): 2000 input, 100 output, 2100 total
 * //   PageRangeParser total: 2000 input, 100 output, 2100 total
 * // Grand total: 3500 input, 400 output, 3900 total
 * ```
 */
export class LLMTokenUsageAggregator {
  private usage: Record<string, ComponentAggregate> = {};

  /**
   * Track token usage from an LLM call
   *
   * @param usage - Extended token usage with component/phase/model information
   */
  track(usage: ExtendedTokenUsage): void {
    // Initialize component if not seen before
    if (!this.usage[usage.component]) {
      this.usage[usage.component] = {
        component: usage.component,
        phases: {},
        total: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
      };
    }

    const component = this.usage[usage.component];

    // Initialize phase if not seen before
    if (!component.phases[usage.phase]) {
      component.phases[usage.phase] = {
        total: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
      };
    }

    const phase = component.phases[usage.phase];

    // Track by model type
    if (usage.model === 'primary') {
      if (!phase.primary) {
        phase.primary = {
          modelName: usage.modelName,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        };
      }

      phase.primary.inputTokens += usage.inputTokens;
      phase.primary.outputTokens += usage.outputTokens;
      phase.primary.totalTokens += usage.totalTokens;
    } else if (usage.model === 'fallback') {
      if (!phase.fallback) {
        phase.fallback = {
          modelName: usage.modelName,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        };
      }

      phase.fallback.inputTokens += usage.inputTokens;
      phase.fallback.outputTokens += usage.outputTokens;
      phase.fallback.totalTokens += usage.totalTokens;
    }

    // Update phase total
    phase.total.inputTokens += usage.inputTokens;
    phase.total.outputTokens += usage.outputTokens;
    phase.total.totalTokens += usage.totalTokens;

    // Update component total
    component.total.inputTokens += usage.inputTokens;
    component.total.outputTokens += usage.outputTokens;
    component.total.totalTokens += usage.totalTokens;
  }

  /**
   * Get aggregated usage grouped by component
   *
   * @returns Array of component aggregates with phase breakdown
   */
  getByComponent(): ComponentAggregate[] {
    return Object.values(this.usage);
  }

  /**
   * Get token usage report in structured JSON format
   *
   * Converts internal usage data to external TokenUsageReport format suitable
   * for serialization and reporting. The report includes component breakdown,
   * phase-level details, and both primary and fallback model usage.
   *
   * @returns Structured token usage report with components and total
   */
  getReport(): {
    components: Array<{
      component: string;
      phases: Array<{
        phase: string;
        primary?: {
          modelName: string;
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
        };
        fallback?: {
          modelName: string;
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
        };
        total: {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
        };
      }>;
      total: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    }>;
    total: TokenUsage;
  } {
    const components: Array<{
      component: string;
      phases: Array<{
        phase: string;
        primary?: {
          modelName: string;
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
        };
        fallback?: {
          modelName: string;
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
        };
        total: {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
        };
      }>;
      total: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    }> = [];

    for (const component of Object.values(this.usage)) {
      const phases: Array<{
        phase: string;
        primary?: {
          modelName: string;
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
        };
        fallback?: {
          modelName: string;
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
        };
        total: {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
        };
      }> = [];

      for (const [phaseName, phaseData] of Object.entries(component.phases)) {
        const phaseReport: {
          phase: string;
          primary?: {
            modelName: string;
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
          };
          fallback?: {
            modelName: string;
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
          };
          total: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
          };
        } = {
          phase: phaseName,
          total: {
            inputTokens: phaseData.total.inputTokens,
            outputTokens: phaseData.total.outputTokens,
            totalTokens: phaseData.total.totalTokens,
          },
        };

        if (phaseData.primary) {
          phaseReport.primary = {
            modelName: phaseData.primary.modelName,
            inputTokens: phaseData.primary.inputTokens,
            outputTokens: phaseData.primary.outputTokens,
            totalTokens: phaseData.primary.totalTokens,
          };
        }

        if (phaseData.fallback) {
          phaseReport.fallback = {
            modelName: phaseData.fallback.modelName,
            inputTokens: phaseData.fallback.inputTokens,
            outputTokens: phaseData.fallback.outputTokens,
            totalTokens: phaseData.fallback.totalTokens,
          };
        }

        phases.push(phaseReport);
      }

      components.push({
        component: component.component,
        phases,
        total: {
          inputTokens: component.total.inputTokens,
          outputTokens: component.total.outputTokens,
          totalTokens: component.total.totalTokens,
        },
      });
    }

    const totalUsage = this.getTotalUsage();

    return {
      components,
      total: {
        inputTokens: totalUsage.inputTokens,
        outputTokens: totalUsage.outputTokens,
        totalTokens: totalUsage.totalTokens,
      },
    };
  }

  /**
   * Get total usage across all components and phases
   *
   * @returns Aggregated token usage totals
   */
  getTotalUsage(): TokenUsage {
    let totalInput = 0;
    let totalOutput = 0;
    let totalTokens = 0;

    for (const component of Object.values(this.usage)) {
      totalInput += component.total.inputTokens;
      totalOutput += component.total.outputTokens;
      totalTokens += component.total.totalTokens;
    }

    return {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      totalTokens: totalTokens,
    };
  }

  /**
   * Log comprehensive token usage summary
   *
   * Outputs usage grouped by component, with phase and model breakdown.
   * Shows primary and fallback token usage separately for each phase.
   * Call this once at the end of document processing.
   *
   * @param logger - Logger instance for output
   */
  logSummary(logger: LoggerMethods): void {
    const components = this.getByComponent();

    if (components.length === 0) {
      logger.info('[DocumentProcessor] No token usage to report');
      return;
    }

    logger.info('[DocumentProcessor] Token usage summary:');
    logger.info('');

    let grandInputTokens = 0;
    let grandOutputTokens = 0;
    let grandTotalTokens = 0;
    let grandPrimaryInputTokens = 0;
    let grandPrimaryOutputTokens = 0;
    let grandPrimaryTotalTokens = 0;
    let grandFallbackInputTokens = 0;
    let grandFallbackOutputTokens = 0;
    let grandFallbackTotalTokens = 0;

    for (const component of components) {
      logger.info(`${component.component}:`);

      for (const [phase, phaseData] of Object.entries(component.phases)) {
        logger.info(`  - ${phase}:`);

        // Show primary model usage
        if (phaseData.primary) {
          logger.info(
            `      primary (${phaseData.primary.modelName}): ${formatTokens(phaseData.primary)}`,
          );
          grandPrimaryInputTokens += phaseData.primary.inputTokens;
          grandPrimaryOutputTokens += phaseData.primary.outputTokens;
          grandPrimaryTotalTokens += phaseData.primary.totalTokens;
        }

        // Show fallback model usage
        if (phaseData.fallback) {
          logger.info(
            `      fallback (${phaseData.fallback.modelName}): ${formatTokens(phaseData.fallback)}`,
          );
          grandFallbackInputTokens += phaseData.fallback.inputTokens;
          grandFallbackOutputTokens += phaseData.fallback.outputTokens;
          grandFallbackTotalTokens += phaseData.fallback.totalTokens;
        }

        // Show phase subtotal
        logger.info(`      subtotal: ${formatTokens(phaseData.total)}`);
      }

      logger.info(
        `  ${component.component} total: ${formatTokens(component.total)}`,
      );
      logger.info('');

      grandInputTokens += component.total.inputTokens;
      grandOutputTokens += component.total.outputTokens;
      grandTotalTokens += component.total.totalTokens;
    }

    // Show grand total with primary/fallback breakdown
    logger.info('--- Summary ---');
    if (grandPrimaryTotalTokens > 0) {
      logger.info(
        `Primary total: ${formatTokens({
          inputTokens: grandPrimaryInputTokens,
          outputTokens: grandPrimaryOutputTokens,
          totalTokens: grandPrimaryTotalTokens,
        })}`,
      );
    }
    if (grandFallbackTotalTokens > 0) {
      logger.info(
        `Fallback total: ${formatTokens({
          inputTokens: grandFallbackInputTokens,
          outputTokens: grandFallbackOutputTokens,
          totalTokens: grandFallbackTotalTokens,
        })}`,
      );
    }
    logger.info(
      `Grand total: ${formatTokens({
        inputTokens: grandInputTokens,
        outputTokens: grandOutputTokens,
        totalTokens: grandTotalTokens,
      })}`,
    );
  }

  /**
   * Reset all tracked usage
   *
   * Call this at the start of a new document processing run.
   */
  reset(): void {
    this.usage = {};
  }
}
