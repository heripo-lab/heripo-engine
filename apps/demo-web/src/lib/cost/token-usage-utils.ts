import type { ComponentUsageReport, PhaseUsageReport } from '@heripo/model';

import { calculateCost } from './model-pricing';

/**
 * Get display model name from a phase usage report.
 *
 * Shows both primary and fallback model names when applicable:
 * - Primary only: "model-name"
 * - Primary + fallback: "primary-model → fallback-model"
 * - Fallback only: "fallback-model (fallback)"
 */
export function getModelName(phase: PhaseUsageReport): string {
  if (phase.primary && phase.fallback) {
    return `${phase.primary.modelName} → ${phase.fallback.modelName}`;
  }
  if (phase.fallback) {
    return `${phase.fallback.modelName} (fallback)`;
  }
  return phase.primary?.modelName ?? '-';
}

/**
 * Calculate USD cost for a single phase (primary + fallback).
 */
export function calculatePhaseCost(phase: PhaseUsageReport): number {
  let cost = 0;
  if (phase.primary) {
    cost += calculateCost(
      phase.primary.modelName,
      phase.primary.inputTokens,
      phase.primary.outputTokens,
    );
  }
  if (phase.fallback) {
    cost += calculateCost(
      phase.fallback.modelName,
      phase.fallback.inputTokens,
      phase.fallback.outputTokens,
    );
  }
  return cost;
}

/**
 * Calculate USD cost for an entire component (sum of all phases).
 */
export function calculateComponentCost(comp: ComponentUsageReport): number {
  return comp.phases.reduce((sum, phase) => sum + calculatePhaseCost(phase), 0);
}

/**
 * Calculate total USD cost across all components.
 */
export function calculateTotalCostUsd(
  components: ComponentUsageReport[],
): number {
  return components.reduce(
    (sum, comp) => sum + calculateComponentCost(comp),
    0,
  );
}
