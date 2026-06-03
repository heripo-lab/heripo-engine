import type { LoggerMethods } from '@heripo/logger';

import type { ExtendedTokenUsage, TokenUsageMetadata } from './llm-caller';

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

interface MutableUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

function emptyUsage(): MutableUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function addInto(target: MutableUsage, src: TokenUsage): void {
  target.inputTokens += src.inputTokens;
  target.outputTokens += src.outputTokens;
  target.totalTokens += src.totalTokens;
}

function sumUsage(a?: MutableUsage, b?: MutableUsage): MutableUsage {
  return {
    inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0),
    outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
    totalTokens: (a?.totalTokens ?? 0) + (b?.totalTokens ?? 0),
  };
}

/**
 * Accumulate a single LLM call's usage into a per-model bucket.
 *
 * Buckets are keyed by `modelName` so that a single (phase, tier) that mixes
 * several models (e.g. review-assistance `work-item-review` where the `tables`
 * task uses a different model from the text tasks) keeps each model's tokens —
 * and therefore each model's cost — distinct instead of collapsing onto the
 * first model seen.
 */
function accumulateModel(
  bucket: Map<string, MutableUsage>,
  modelName: string,
  usage: TokenUsage,
): void {
  let entry = bucket.get(modelName);
  if (!entry) {
    entry = emptyUsage();
    bucket.set(modelName, entry);
  }
  addInto(entry, usage);
}

/**
 * Aggregated token usage for a specific phase.
 *
 * `primary` / `fallback` map each model used in this (phase, tier) to its own
 * accumulated usage. JS `Map` preserves insertion order, so the first model
 * seen stays first — but every model keeps its own totals.
 */
interface PhaseAggregate {
  primary: Map<string, MutableUsage>;
  fallback: Map<string, MutableUsage>;
  total: MutableUsage;
  metadata: TokenUsageMetadata[];
}

/**
 * Aggregated token usage for a specific component
 */
interface ComponentAggregate {
  component: string;
  phases: Record<string, PhaseAggregate>;
  total: MutableUsage;
}

interface ModelUsageReport {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface PhaseReport {
  phase: string;
  primary?: ModelUsageReport;
  fallback?: ModelUsageReport;
  total: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  metadata?: TokenUsageMetadata[];
}

interface ComponentReport {
  component: string;
  phases: PhaseReport[];
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
 * - Model tier (primary vs fallback) AND model name
 *
 * A single (phase, tier) may legitimately span multiple model names — e.g.
 * review-assistance `work-item-review`, where the `tables` work item runs on a
 * different model from the text work items. Usage is therefore kept per model
 * so that token totals and downstream cost attribution stay correct for each.
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
 * //   - extraction:
 * //       primary (gpt-5): 1500 input, 300 output, 1800 total
 * //       subtotal: 1500 input, 300 output, 1800 total
 * //   TocExtractor total: 1500 input, 300 output, 1800 total
 * // ...
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
        total: emptyUsage(),
      };
    }

    const component = this.usage[usage.component];

    // Initialize phase if not seen before
    if (!component.phases[usage.phase]) {
      component.phases[usage.phase] = {
        primary: new Map(),
        fallback: new Map(),
        total: emptyUsage(),
        metadata: [],
      };
    }

    const phase = component.phases[usage.phase];
    if (usage.metadata) {
      phase.metadata.push(usage.metadata);
    }

    // Track by model tier, keyed per model name (set-once misattribution fix)
    if (usage.model === 'primary') {
      accumulateModel(phase.primary, usage.modelName, usage);
    } else if (usage.model === 'fallback') {
      accumulateModel(phase.fallback, usage.modelName, usage);
    }

    // Update phase total
    addInto(phase.total, usage);

    // Update component total
    addInto(component.total, usage);
  }

  /**
   * Get aggregated usage grouped by component
   *
   * @returns Array of component aggregates with per-model phase breakdown
   */
  getByComponent(): ComponentAggregate[] {
    return Object.values(this.usage);
  }

  /**
   * Get token usage report in structured JSON format
   *
   * Converts internal usage data to external TokenUsageReport format suitable
   * for serialization and reporting.
   *
   * Each (phase, model) pair becomes its own PhaseUsageReport entry. A phase
   * that used a single primary (and/or a single fallback) model yields exactly
   * one entry — identical to the legacy shape — while a phase that mixed models
   * yields one entry per model, all sharing the same `phase` name. Every
   * (phase, tier, modelName) combination appears in exactly one entry, so
   * consumers that key by `${component}|${phase}|${tier}|${modelName}`
   * (heripo-web's token-usage emitter / ledger recorder) attribute each model's
   * tokens — and cost — correctly without double counting.
   *
   * @returns Structured token usage report with components and total
   */
  getReport(): {
    components: ComponentReport[];
    total: TokenUsage;
  } {
    const components: ComponentReport[] = [];

    for (const component of Object.values(this.usage)) {
      const phases: PhaseReport[] = [];

      for (const [phaseName, phaseData] of Object.entries(component.phases)) {
        const primaryEntries = [...phaseData.primary.entries()];
        const fallbackEntries = [...phaseData.fallback.entries()];
        const entryCount = Math.max(
          primaryEntries.length,
          fallbackEntries.length,
        );

        // Phase tracked tokens but no primary/fallback model (e.g. an unknown
        // tier). Preserve a single total-only entry so the phase still appears.
        if (entryCount === 0) {
          const phaseReport: PhaseReport = {
            phase: phaseName,
            total: { ...phaseData.total },
          };
          if (phaseData.metadata.length > 0) {
            phaseReport.metadata = [...phaseData.metadata];
          }
          phases.push(phaseReport);
          continue;
        }

        for (let i = 0; i < entryCount; i++) {
          const primary = primaryEntries[i];
          const fallback = fallbackEntries[i];

          const phaseReport: PhaseReport = {
            phase: phaseName,
            total: sumUsage(primary?.[1], fallback?.[1]),
          };

          if (primary) {
            phaseReport.primary = { modelName: primary[0], ...primary[1] };
          }
          if (fallback) {
            phaseReport.fallback = { modelName: fallback[0], ...fallback[1] };
          }
          // Phase-level metadata is not model-specific; attach it once to the
          // first entry to avoid duplicating it across split entries.
          if (i === 0 && phaseData.metadata.length > 0) {
            phaseReport.metadata = [...phaseData.metadata];
          }

          phases.push(phaseReport);
        }
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
   * Outputs usage grouped by component, with phase and per-model breakdown.
   * Shows each primary and fallback model on its own line for each phase.
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
    const grandPrimary = emptyUsage();
    const grandFallback = emptyUsage();

    for (const component of components) {
      logger.info(`${component.component}:`);

      for (const [phaseName, phaseData] of Object.entries(component.phases)) {
        logger.info(`  - ${phaseName}:`);

        // Show primary model usage (one line per model)
        for (const [modelName, modelUsage] of phaseData.primary) {
          logger.info(
            `      primary (${modelName}): ${formatTokens(modelUsage)}`,
          );
          addInto(grandPrimary, modelUsage);
        }

        // Show fallback model usage (one line per model)
        for (const [modelName, modelUsage] of phaseData.fallback) {
          logger.info(
            `      fallback (${modelName}): ${formatTokens(modelUsage)}`,
          );
          addInto(grandFallback, modelUsage);
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
    if (grandPrimary.totalTokens > 0) {
      logger.info(`Primary total: ${formatTokens(grandPrimary)}`);
    }
    if (grandFallback.totalTokens > 0) {
      logger.info(`Fallback total: ${formatTokens(grandFallback)}`);
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
