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

      expect(phase.primary?.inputTokens).toBe(100);
      expect(phase.primary?.modelName).toBe('gpt-5');
      expect(phase.fallback?.inputTokens).toBe(200);
      expect(phase.fallback?.modelName).toBe('claude-opus-4-5');
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

      expect(phase.fallback?.inputTokens).toBe(300);
      expect(phase.fallback?.outputTokens).toBe(125);
      expect(phase.fallback?.totalTokens).toBe(425);
      expect(phase.fallback?.modelName).toBe('claude-opus-4-5');
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

      // Neither primary nor fallback should be set
      expect(phase.primary).toBeUndefined();
      expect(phase.fallback).toBeUndefined();
      // But total should still be updated
      expect(phase.total.inputTokens).toBe(100);
      expect(phase.total.outputTokens).toBe(50);
      expect(phase.total.totalTokens).toBe(150);
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

      // Get the internal component and remove primary/fallback to create edge case
      const components = aggregator.getByComponent();
      const phaseData = components[0].phases['testPhase'];
      delete (phaseData as any).primary;
      delete (phaseData as any).fallback;

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
