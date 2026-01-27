'use client';

import type {
  ComponentUsageReport,
  PhaseUsageReport,
  TokenUsageReport,
} from '@heripo/model';

import { Fragment, useMemo } from 'react';

import { FALLBACK_RATE } from '~/lib/cost/exchange-rate';
import { calculateCost } from '~/lib/cost/model-pricing';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';

import { useExchangeRate } from '../hooks/use-exchange-rate';

interface TokenUsageChartProps {
  tokenUsage?: unknown;
}

function getModelName(phase: PhaseUsageReport): string {
  if (phase.primary && phase.fallback) {
    return `${phase.primary.modelName} → ${phase.fallback.modelName}`;
  }
  if (phase.fallback) {
    return `${phase.fallback.modelName} (fallback)`;
  }
  return phase.primary?.modelName ?? '-';
}

function calculatePhaseCost(phase: PhaseUsageReport): number {
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

function calculateComponentCost(comp: ComponentUsageReport): number {
  return comp.phases.reduce((sum, phase) => sum + calculatePhaseCost(phase), 0);
}

export function TokenUsageChart({ tokenUsage }: TokenUsageChartProps) {
  const usage = tokenUsage as TokenUsageReport | null;
  const { data: exchangeRateResult } = useExchangeRate();

  const exchangeRate = exchangeRateResult?.rate ?? FALLBACK_RATE;
  const isFallbackRate = exchangeRateResult?.isFallback ?? true;

  const totalCostUsd = useMemo(() => {
    if (!usage?.components) return 0;
    return usage.components.reduce(
      (sum, comp) => sum + calculateComponentCost(comp),
      0,
    );
  }, [usage]);

  const totalCostKrw = Math.round(totalCostUsd * exchangeRate);

  if (!usage || !usage.components || usage.components.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Token Usage Report</CardTitle>
          <CardDescription>
            LLM API usage breakdown by component
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground py-4 text-center text-sm">
            No token usage data available
          </div>
        </CardContent>
      </Card>
    );
  }

  const { components, total } = usage;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Token Usage Report</CardTitle>
        <CardDescription>LLM API usage breakdown by component</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Summary */}
          <div className="bg-muted/50 space-y-3 rounded-lg p-4">
            {/* Exchange Rate Info */}
            <div className="text-muted-foreground text-xs">
              Exchange Rate: ₩{exchangeRate.toLocaleString()}/USD
              {isFallbackRate && (
                <span className="text-yellow-600"> (default)</span>
              )}
            </div>

            {/* Token & Cost Grid */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <div>
                <p className="text-muted-foreground text-sm">Input Tokens</p>
                <p className="text-lg font-semibold">
                  {(total.inputTokens ?? 0).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Output Tokens</p>
                <p className="text-lg font-semibold">
                  {(total.outputTokens ?? 0).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Total Tokens</p>
                <p className="text-lg font-semibold">
                  {(total.totalTokens ?? 0).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Cost (USD)</p>
                <p className="text-lg font-semibold">
                  ${totalCostUsd.toFixed(4)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Cost (KRW)</p>
                <p className="text-lg font-semibold">
                  ₩{totalCostKrw.toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="px-4 py-2 text-left text-sm font-medium">
                    Component / Phase
                  </th>
                  <th className="px-4 py-2 text-left text-sm font-medium">
                    Model
                  </th>
                  <th className="px-4 py-2 text-right text-sm font-medium">
                    Input
                  </th>
                  <th className="px-4 py-2 text-right text-sm font-medium">
                    Output
                  </th>
                  <th className="px-4 py-2 text-right text-sm font-medium">
                    Total
                  </th>
                  <th className="px-4 py-2 text-right text-sm font-medium">
                    Cost (USD)
                  </th>
                  <th className="px-4 py-2 text-right text-sm font-medium">
                    Cost (KRW)
                  </th>
                </tr>
              </thead>
              <tbody>
                {components.map((comp) => {
                  const compCost = calculateComponentCost(comp);
                  const compCostKrw = Math.round(compCost * exchangeRate);
                  return (
                    <Fragment key={comp.component}>
                      {/* Component header row */}
                      <tr className="bg-muted/30 border-b">
                        <td
                          colSpan={2}
                          className="px-4 py-2 text-sm font-medium"
                        >
                          {comp.component}
                        </td>
                        <td className="px-4 py-2 text-right text-sm font-medium">
                          {comp.total.inputTokens.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right text-sm font-medium">
                          {comp.total.outputTokens.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right text-sm font-medium">
                          {comp.total.totalTokens.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right text-sm font-medium">
                          ${compCost.toFixed(4)}
                        </td>
                        <td className="px-4 py-2 text-right text-sm font-medium">
                          ₩{compCostKrw.toLocaleString()}
                        </td>
                      </tr>
                      {/* Phase detail rows */}
                      {comp.phases.map((phase) => {
                        const phaseCost = calculatePhaseCost(phase);
                        const phaseCostKrw = Math.round(
                          phaseCost * exchangeRate,
                        );
                        return (
                          <tr
                            key={`${comp.component}-${phase.phase}`}
                            className="border-b last:border-0"
                          >
                            <td className="text-muted-foreground px-4 py-2 pl-8 text-sm">
                              {phase.phase}
                            </td>
                            <td className="text-muted-foreground px-4 py-2 text-sm">
                              {getModelName(phase)}
                            </td>
                            <td className="text-muted-foreground px-4 py-2 text-right text-sm">
                              {phase.total.inputTokens.toLocaleString()}
                            </td>
                            <td className="text-muted-foreground px-4 py-2 text-right text-sm">
                              {phase.total.outputTokens.toLocaleString()}
                            </td>
                            <td className="text-muted-foreground px-4 py-2 text-right text-sm">
                              {phase.total.totalTokens.toLocaleString()}
                            </td>
                            <td className="text-muted-foreground px-4 py-2 text-right text-sm">
                              ${phaseCost.toFixed(6)}
                            </td>
                            <td className="text-muted-foreground px-4 py-2 text-right text-sm">
                              ₩{phaseCostKrw.toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
