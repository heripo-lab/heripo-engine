'use client';

import type { TokenUsageReport } from '@heripo/model';

import { Fragment, useMemo } from 'react';

import { FALLBACK_RATE } from '~/lib/cost/exchange-rate';
import {
  calculateComponentCost,
  calculatePhaseCost,
  calculateTotalCostUsd,
  getModelName,
} from '~/lib/cost/token-usage-utils';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { useExchangeRate } from '~/features/result/hooks/use-exchange-rate';

interface LiveTokenUsageCardProps {
  tokenUsage?: TokenUsageReport;
}

export function LiveTokenUsageCard({ tokenUsage }: LiveTokenUsageCardProps) {
  const { data: exchangeRateResult } = useExchangeRate();

  const exchangeRate = exchangeRateResult?.rate ?? FALLBACK_RATE;
  const isFallbackRate = exchangeRateResult?.isFallback ?? true;

  const totalCostUsd = useMemo(() => {
    if (!tokenUsage?.components) return 0;
    return calculateTotalCostUsd(tokenUsage.components);
  }, [tokenUsage]);

  const totalCostKrw = Math.round(totalCostUsd * exchangeRate);

  // Don't render if no token usage data yet
  if (
    !tokenUsage ||
    !tokenUsage.components ||
    tokenUsage.components.length === 0
  ) {
    return null;
  }

  const { components, total } = tokenUsage;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Token Usage</CardTitle>
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          </span>
        </div>
        <CardDescription>
          Real-time LLM API usage during processing
        </CardDescription>
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
