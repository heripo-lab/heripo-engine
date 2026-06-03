import type { LoggerMethods } from '@heripo/logger';

import type { ExtendedTokenUsage } from './llm-caller';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { LLMTokenUsageAggregator } from './llm-token-usage-aggregator';

describe('LLMTokenUsageAggregator', () => {
  let aggregator: LLMTokenUsageAggregator;
  let mockLogger: LoggerMethods;

  beforeEach(() => {
    aggregator = new LLMTokenUsageAggregator();
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  describe('track', () => {
    test('should track single usage', () => {
      const usage: ExtendedTokenUsage = {
        component: 'TocExtractor',
        phase: 'extraction',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };

      aggregator.track(usage);

      const byComponent = aggregator.getByComponent();
      expect(byComponent).toHaveLength(1);
      expect(byComponent[0].component).toBe('TocExtractor');
      expect(byComponent[0].total.inputTokens).toBe(100);
      expect(byComponent[0].total.outputTokens).toBe(50);
      expect(byComponent[0].total.totalTokens).toBe(150);
    });

    test('should aggregate usage from same component and phase', () => {
      const usage1: ExtendedTokenUsage = {
        component: 'TocExtractor',
        phase: 'extraction',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };

      const usage2: ExtendedTokenUsage = {
        component: 'TocExtractor',
        phase: 'extraction',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 200,
        outputTokens: 75,
        totalTokens: 275,
      };

      aggregator.track(usage1);
      aggregator.track(usage2);

      const byComponent = aggregator.getByComponent();
      expect(byComponent[0].total.inputTokens).toBe(300);
      expect(byComponent[0].total.outputTokens).toBe(125);
      expect(byComponent[0].total.totalTokens).toBe(425);
    });

    test('should separate primary and fallback models', () => {
      const primaryUsage: ExtendedTokenUsage = {
        component: 'TocExtractor',
        phase: 'extraction',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };

      const fallbackUsage: ExtendedTokenUsage = {
        component: 'TocExtractor',
        phase: 'extraction',
        model: 'fallback',
        modelName: 'claude-opus-4-5',
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
      };

      aggregator.track(primaryUsage);
      aggregator.track(fallbackUsage);

      const byComponent = aggregator.getByComponent();
      const phase = byComponent[0].phases['extraction'];

      expect(phase.primary.get('gpt-5')?.inputTokens).toBe(100);
      expect(phase.fallback.get('claude-opus-4-5')?.inputTokens).toBe(200);
      expect(phase.total.inputTokens).toBe(300);
    });

    test('should track multiple components and phases', () => {
      const usage1: ExtendedTokenUsage = {
        component: 'TocExtractor',
        phase: 'extraction',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };

      const usage2: ExtendedTokenUsage = {
        component: 'PageRangeParser',
        phase: 'sampling',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 500,
        outputTokens: 100,
        totalTokens: 600,
      };

      const usage3: ExtendedTokenUsage = {
        component: 'TocExtractor',
        phase: 'validation',
        model: 'primary',
        modelName: 'gpt-5-mini',
        inputTokens: 50,
        outputTokens: 20,
        totalTokens: 70,
      };

      aggregator.track(usage1);
      aggregator.track(usage2);
      aggregator.track(usage3);

      const byComponent = aggregator.getByComponent();
      expect(byComponent).toHaveLength(2);

      const tocComponent = byComponent.find(
        (c) => c.component === 'TocExtractor',
      );
      expect(tocComponent?.phases).toHaveProperty('extraction');
      expect(tocComponent?.phases).toHaveProperty('validation');
      expect(tocComponent?.total.inputTokens).toBe(150);

      const pageRangeComponent = byComponent.find(
        (c) => c.component === 'PageRangeParser',
      );
      expect(pageRangeComponent?.total.inputTokens).toBe(500);
    });

    test('should aggregate multiple fallback usages for the same phase', () => {
      const fallbackUsage1: ExtendedTokenUsage = {
        component: 'TocExtractor',
        phase: 'extraction',
        model: 'fallback',
        modelName: 'claude-opus-4-5',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };

      const fallbackUsage2: ExtendedTokenUsage = {
        component: 'TocExtractor',
        phase: 'extraction',
        model: 'fallback',
        modelName: 'claude-opus-4-5',
        inputTokens: 200,
        outputTokens: 75,
        totalTokens: 275,
      };

      aggregator.track(fallbackUsage1);
      aggregator.track(fallbackUsage2);

      const byComponent = aggregator.getByComponent();
      const phase = byComponent[0].phases['extraction'];

      expect(phase.fallback.get('claude-opus-4-5')?.inputTokens).toBe(300);
      expect(phase.fallback.get('claude-opus-4-5')?.outputTokens).toBe(125);
      expect(phase.fallback.get('claude-opus-4-5')?.totalTokens).toBe(425);
    });

    test('should handle unknown model type gracefully (skip primary/fallback tracking)', () => {
      const unknownModelUsage = {
        component: 'TocExtractor',
        phase: 'extraction',
        model: 'unknown' as 'primary' | 'fallback',
        modelName: 'some-model',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };

      aggregator.track(unknownModelUsage);

      const byComponent = aggregator.getByComponent();
      const phase = byComponent[0].phases['extraction'];

      // Neither primary nor fallback should hold a model
      expect(phase.primary.size).toBe(0);
      expect(phase.fallback.size).toBe(0);
      // But total should still be updated
      expect(phase.total.inputTokens).toBe(100);
      expect(phase.total.outputTokens).toBe(50);
      expect(phase.total.totalTokens).toBe(150);
    });

    test('should track metadata on phases', () => {
      aggregator.track({
        component: 'ReviewAssistance',
        phase: 'page-review',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        metadata: {
          pageNo: 3,
          commandCount: 2,
          autoAppliedCount: 1,
          proposalCount: 1,
        },
      });

      const byComponent = aggregator.getByComponent();
      expect(byComponent[0].phases['page-review'].metadata).toEqual([
        {
          pageNo: 3,
          commandCount: 2,
          autoAppliedCount: 1,
          proposalCount: 1,
        },
      ]);
    });

    test('should keep distinct primary models separate within one phase', () => {
      // Regression: review-assistance `work-item-review` mixes models — the
      // `tables` task runs on a different model from the text tasks. They must
      // not collapse onto the first model seen.
      aggregator.track({
        component: 'ReviewAssistance',
        phase: 'work-item-review',
        model: 'primary',
        modelName: 'lmstudio/gemma',
        inputTokens: 100,
        outputTokens: 40,
        totalTokens: 140,
      });
      aggregator.track({
        component: 'ReviewAssistance',
        phase: 'work-item-review',
        model: 'primary',
        modelName: 'openai/gpt-5-mini',
        inputTokens: 200,
        outputTokens: 80,
        totalTokens: 280,
      });
      aggregator.track({
        component: 'ReviewAssistance',
        phase: 'work-item-review',
        model: 'primary',
        modelName: 'lmstudio/gemma',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      });

      const phase = aggregator.getByComponent()[0].phases['work-item-review'];

      expect(phase.primary.size).toBe(2);
      expect(phase.primary.get('lmstudio/gemma')).toEqual({
        inputTokens: 110,
        outputTokens: 45,
        totalTokens: 155,
      });
      expect(phase.primary.get('openai/gpt-5-mini')).toEqual({
        inputTokens: 200,
        outputTokens: 80,
        totalTokens: 280,
      });
      expect(phase.total.totalTokens).toBe(435);
    });
  });

  describe('getTotalUsage', () => {
    test('should return zero usage when nothing tracked', () => {
      const total = aggregator.getTotalUsage();
      expect(total.inputTokens).toBe(0);
      expect(total.outputTokens).toBe(0);
      expect(total.totalTokens).toBe(0);
    });

    test('should return aggregated total usage', () => {
      aggregator.track({
        component: 'TocExtractor',
        phase: 'extraction',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });

      aggregator.track({
        component: 'PageRangeParser',
        phase: 'sampling',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 500,
        outputTokens: 100,
        totalTokens: 600,
      });

      const total = aggregator.getTotalUsage();
      expect(total.inputTokens).toBe(600);
      expect(total.outputTokens).toBe(150);
      expect(total.totalTokens).toBe(750);
    });
  });

  describe('getByComponent', () => {
    test('should return empty array when nothing tracked', () => {
      const result = aggregator.getByComponent();
      expect(result).toHaveLength(0);
    });

    test('should return components with correct structure', () => {
      aggregator.track({
        component: 'TocExtractor',
        phase: 'extraction',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });

      const result = aggregator.getByComponent();
      expect(result).toHaveLength(1);

      const component = result[0];
      expect(component.component).toBe('TocExtractor');
      expect(component.phases).toHaveProperty('extraction');
      expect(component.total.inputTokens).toBe(100);
    });
  });

  describe('logSummary', () => {
    test('should log message when nothing tracked', () => {
      aggregator.logSummary(mockLogger);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[DocumentProcessor] No token usage to report',
      );
    });

    test('should log summary with single component and phase', () => {
      aggregator.track({
        component: 'TocExtractor',
        phase: 'extraction',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });

      aggregator.logSummary(mockLogger);

      const calls = vi.mocked(mockLogger.info).mock.calls.map((c) => c[0]);

      expect(calls).toContain('[DocumentProcessor] Token usage summary:');
      expect(calls).toContain('TocExtractor:');
      expect(calls).toContain('  - extraction:');
      expect(calls).toContainEqual(
        '      primary (gpt-5): 100 input, 50 output, 150 total',
      );
      expect(calls).toContainEqual(
        '      subtotal: 100 input, 50 output, 150 total',
      );
      expect(calls).toContainEqual(
        '  TocExtractor total: 100 input, 50 output, 150 total',
      );
      expect(calls).toContain('--- Summary ---');
      expect(calls).toContainEqual(
        'Primary total: 100 input, 50 output, 150 total',
      );
      expect(calls).toContainEqual(
        'Grand total: 100 input, 50 output, 150 total',
      );
    });

    test('should log summary with primary and fallback models separately', () => {
      aggregator.track({
        component: 'PageRangeParser',
        phase: 'sampling',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 500,
        outputTokens: 100,
        totalTokens: 600,
      });

      aggregator.track({
        component: 'PageRangeParser',
        phase: 'sampling',
        model: 'fallback',
        modelName: 'claude-opus-4-5',
        inputTokens: 300,
        outputTokens: 75,
        totalTokens: 375,
      });

      aggregator.logSummary(mockLogger);

      const calls = vi.mocked(mockLogger.info).mock.calls.map((c) => c[0]);

      // Primary and fallback should be logged on separate lines
      expect(calls).toContainEqual(
        '      primary (gpt-5): 500 input, 100 output, 600 total',
      );
      expect(calls).toContainEqual(
        '      fallback (claude-opus-4-5): 300 input, 75 output, 375 total',
      );
      expect(calls).toContainEqual(
        '      subtotal: 800 input, 175 output, 975 total',
      );

      // Summary should show primary and fallback totals
      expect(calls).toContain('--- Summary ---');
      expect(calls).toContainEqual(
        'Primary total: 500 input, 100 output, 600 total',
      );
      expect(calls).toContainEqual(
        'Fallback total: 300 input, 75 output, 375 total',
      );
      expect(calls).toContainEqual(
        'Grand total: 800 input, 175 output, 975 total',
      );
    });

    test('should log summary with multiple components', () => {
      aggregator.track({
        component: 'TocExtractor',
        phase: 'extraction',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });

      aggregator.track({
        component: 'PageRangeParser',
        phase: 'sampling',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 500,
        outputTokens: 100,
        totalTokens: 600,
      });

      aggregator.logSummary(mockLogger);

      const calls = vi.mocked(mockLogger.info).mock.calls.map((c) => c[0]);

      expect(calls).toContain('TocExtractor:');
      expect(calls).toContain('PageRangeParser:');
      expect(calls).toContainEqual(
        'Grand total: 600 input, 150 output, 750 total',
      );
    });

    test('should log phase subtotal even when phase has no model data', () => {
      // Manually inject a phase without primary or fallback to test the edge case
      aggregator.track({
        component: 'TestComponent',
        phase: 'testPhase',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });

      // Clear the per-model buckets to create the no-model phase edge case
      const components = aggregator.getByComponent();
      const phaseData = components[0].phases['testPhase'];
      phaseData.primary.clear();
      phaseData.fallback.clear();

      aggregator.logSummary(mockLogger);

      const calls = vi.mocked(mockLogger.info).mock.calls.map((c) => c[0]);

      // Should have logged the phase with subtotal
      expect(calls.some((c) => c.includes('  - testPhase:'))).toBe(true);
      expect(calls).toContainEqual(
        '      subtotal: 100 input, 50 output, 150 total',
      );
    });

    test('should not log Primary total when only fallback is used', () => {
      aggregator.track({
        component: 'TestComponent',
        phase: 'testPhase',
        model: 'fallback',
        modelName: 'claude-opus',
        inputTokens: 200,
        outputTokens: 80,
        totalTokens: 280,
      });

      aggregator.logSummary(mockLogger);

      const calls = vi.mocked(mockLogger.info).mock.calls.map((c) => c[0]);

      // Should NOT contain Primary total
      expect(calls.some((c) => c.includes('Primary total:'))).toBe(false);
      // Should contain Fallback total
      expect(calls).toContainEqual(
        'Fallback total: 200 input, 80 output, 280 total',
      );
    });

    test('should log each model on its own line for a multi-model phase', () => {
      aggregator.track({
        component: 'ReviewAssistance',
        phase: 'work-item-review',
        model: 'primary',
        modelName: 'lmstudio/gemma',
        inputTokens: 100,
        outputTokens: 40,
        totalTokens: 140,
      });
      aggregator.track({
        component: 'ReviewAssistance',
        phase: 'work-item-review',
        model: 'primary',
        modelName: 'openai/gpt-5-mini',
        inputTokens: 200,
        outputTokens: 80,
        totalTokens: 280,
      });

      aggregator.logSummary(mockLogger);

      const calls = vi.mocked(mockLogger.info).mock.calls.map((c) => c[0]);

      // Each model is reported on its own primary line.
      expect(calls).toContainEqual(
        '      primary (lmstudio/gemma): 100 input, 40 output, 140 total',
      );
      expect(calls).toContainEqual(
        '      primary (openai/gpt-5-mini): 200 input, 80 output, 280 total',
      );
      // Phase subtotal still reflects the combined total.
      expect(calls).toContainEqual(
        '      subtotal: 300 input, 120 output, 420 total',
      );
      expect(calls).toContainEqual(
        'Primary total: 300 input, 120 output, 420 total',
      );
    });
  });

  describe('getReport', () => {
    test('should return empty report when nothing tracked', () => {
      const report = aggregator.getReport();

      expect(report.components).toHaveLength(0);
      expect(report.total.inputTokens).toBe(0);
      expect(report.total.outputTokens).toBe(0);
      expect(report.total.totalTokens).toBe(0);
    });

    test('should return report with single component and phase', () => {
      aggregator.track({
        component: 'TocExtractor',
        phase: 'extraction',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });

      const report = aggregator.getReport();

      expect(report.components).toHaveLength(1);
      expect(report.components[0].component).toBe('TocExtractor');
      expect(report.components[0].phases).toHaveLength(1);
      expect(report.components[0].phases[0].phase).toBe('extraction');
      expect(report.components[0].phases[0].primary?.modelName).toBe('gpt-5');
      expect(report.components[0].phases[0].total.inputTokens).toBe(100);
      expect(report.components[0].total.inputTokens).toBe(100);
      expect(report.total.inputTokens).toBe(100);
    });

    test('should return report with primary and fallback models', () => {
      aggregator.track({
        component: 'PageRangeParser',
        phase: 'sampling',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 500,
        outputTokens: 100,
        totalTokens: 600,
      });

      aggregator.track({
        component: 'PageRangeParser',
        phase: 'sampling',
        model: 'fallback',
        modelName: 'claude-opus-4-5',
        inputTokens: 300,
        outputTokens: 75,
        totalTokens: 375,
      });

      const report = aggregator.getReport();

      expect(report.components[0].phases[0].primary?.modelName).toBe('gpt-5');
      expect(report.components[0].phases[0].primary?.inputTokens).toBe(500);
      expect(report.components[0].phases[0].fallback?.modelName).toBe(
        'claude-opus-4-5',
      );
      expect(report.components[0].phases[0].fallback?.inputTokens).toBe(300);
      expect(report.components[0].phases[0].total.inputTokens).toBe(800);
      expect(report.total.inputTokens).toBe(800);
    });

    test('should return report with multiple components and phases', () => {
      aggregator.track({
        component: 'TocExtractor',
        phase: 'extraction',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });

      aggregator.track({
        component: 'TocExtractor',
        phase: 'validation',
        model: 'primary',
        modelName: 'gpt-5-mini',
        inputTokens: 50,
        outputTokens: 20,
        totalTokens: 70,
      });

      aggregator.track({
        component: 'PageRangeParser',
        phase: 'sampling',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 500,
        outputTokens: 100,
        totalTokens: 600,
      });

      const report = aggregator.getReport();

      expect(report.components).toHaveLength(2);

      const tocComponent = report.components.find(
        (c) => c.component === 'TocExtractor',
      );
      expect(tocComponent?.phases).toHaveLength(2);
      expect(tocComponent?.total.inputTokens).toBe(150);

      const pageRangeComponent = report.components.find(
        (c) => c.component === 'PageRangeParser',
      );
      expect(pageRangeComponent?.phases).toHaveLength(1);
      expect(pageRangeComponent?.total.inputTokens).toBe(500);

      expect(report.total.inputTokens).toBe(650);
      expect(report.total.outputTokens).toBe(170);
      expect(report.total.totalTokens).toBe(820);
    });

    test('should return report with only fallback model when no primary', () => {
      aggregator.track({
        component: 'TestComponent',
        phase: 'testPhase',
        model: 'fallback',
        modelName: 'claude-opus',
        inputTokens: 200,
        outputTokens: 80,
        totalTokens: 280,
      });

      const report = aggregator.getReport();

      const phase = report.components[0].phases[0];
      expect(phase.primary).toBeUndefined();
      expect(phase.fallback?.modelName).toBe('claude-opus');
      expect(phase.fallback?.inputTokens).toBe(200);
    });

    test('should include phases with both primary and fallback in report', () => {
      aggregator.track({
        component: 'TocExtractor',
        phase: 'extraction',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });

      aggregator.track({
        component: 'TocExtractor',
        phase: 'extraction',
        model: 'fallback',
        modelName: 'claude-opus-4-5',
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
      });

      const report = aggregator.getReport();

      const phase = report.components[0].phases[0];
      expect(phase.primary).toBeDefined();
      expect(phase.fallback).toBeDefined();
      expect(phase.total.inputTokens).toBe(300);
    });

    test('should include metadata in phase reports', () => {
      aggregator.track({
        component: 'ReviewAssistance',
        phase: 'page-review',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        metadata: { pageNo: 1, commandCount: 3 },
      });

      const report = aggregator.getReport();

      expect(report.components[0].phases[0].metadata).toEqual([
        { pageNo: 1, commandCount: 3 },
      ]);
    });

    test('should split a multi-model phase into one entry per model', () => {
      // Invariant relied upon by heripo-web's token-usage emitter, which keys
      // ledger rows by `${component}|${phase}|${tier}|${modelName}`: a phase
      // that mixed models must emit multiple entries sharing the phase name,
      // each carrying a single model, with every (tier, model) appearing
      // exactly once (no collision, no double count).
      aggregator.track({
        component: 'ReviewAssistance',
        phase: 'work-item-review',
        model: 'primary',
        modelName: 'lmstudio/gemma',
        inputTokens: 100,
        outputTokens: 40,
        totalTokens: 140,
      });
      aggregator.track({
        component: 'ReviewAssistance',
        phase: 'work-item-review',
        model: 'primary',
        modelName: 'openai/gpt-5-mini',
        inputTokens: 200,
        outputTokens: 80,
        totalTokens: 280,
      });
      aggregator.track({
        component: 'ReviewAssistance',
        phase: 'work-item-review',
        model: 'fallback',
        modelName: 'openai/gpt-5',
        inputTokens: 30,
        outputTokens: 10,
        totalTokens: 40,
      });

      const report = aggregator.getReport();
      const entries = report.components[0].phases;

      // All entries share the same phase name.
      expect(entries.every((p) => p.phase === 'work-item-review')).toBe(true);

      // Flatten to the 4-tuple keyset the consumer derives.
      const leaves: Array<{ key: string; totalTokens: number }> = [];
      for (const entry of entries) {
        if (entry.primary) {
          leaves.push({
            key: `primary|${entry.primary.modelName}`,
            totalTokens: entry.primary.totalTokens,
          });
        }
        if (entry.fallback) {
          leaves.push({
            key: `fallback|${entry.fallback.modelName}`,
            totalTokens: entry.fallback.totalTokens,
          });
        }
      }

      // No key collision — each (tier, model) appears exactly once.
      const keys = leaves.map((l) => l.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(new Set(keys)).toEqual(
        new Set([
          'primary|lmstudio/gemma',
          'primary|openai/gpt-5-mini',
          'fallback|openai/gpt-5',
        ]),
      );

      // Summed leaf tokens equal the phase total (no double count, no miss).
      const summed = leaves.reduce((acc, l) => acc + l.totalTokens, 0);
      expect(summed).toBe(140 + 280 + 40);
      expect(report.total.totalTokens).toBe(460);
    });

    test('should emit a total-only entry for a phase with an unknown tier', () => {
      // Unknown tier: tokens are tracked but land in neither primary nor
      // fallback. The phase must still surface as a single total-only entry.
      aggregator.track({
        component: 'TestComponent',
        phase: 'noModelPhase',
        model: 'unknown' as 'primary' | 'fallback',
        modelName: 'whatever',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });
      // Same edge, but carrying metadata, to cover the metadata branch.
      aggregator.track({
        component: 'TestComponent',
        phase: 'noModelPhaseWithMeta',
        model: 'unknown' as 'primary' | 'fallback',
        modelName: 'whatever',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        metadata: { note: 'x' },
      });

      const report = aggregator.getReport();
      const phases = report.components[0].phases;

      const noModel = phases.find((p) => p.phase === 'noModelPhase');
      expect(noModel?.primary).toBeUndefined();
      expect(noModel?.fallback).toBeUndefined();
      expect(noModel?.total.totalTokens).toBe(150);
      expect(noModel?.metadata).toBeUndefined();

      const withMeta = phases.find((p) => p.phase === 'noModelPhaseWithMeta');
      expect(withMeta?.metadata).toEqual([{ note: 'x' }]);
      expect(withMeta?.total.totalTokens).toBe(15);
    });
  });

  describe('reset', () => {
    test('should clear all tracked usage', () => {
      aggregator.track({
        component: 'TocExtractor',
        phase: 'extraction',
        model: 'primary',
        modelName: 'gpt-5',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });

      expect(aggregator.getByComponent()).toHaveLength(1);

      aggregator.reset();

      expect(aggregator.getByComponent()).toHaveLength(0);
      expect(aggregator.getTotalUsage().inputTokens).toBe(0);
    });
  });
});
