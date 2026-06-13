import type { TokenUsageReport } from '@heripo/model';

import { publicModeConfig } from '~/lib/config/public-mode';
import { calculateTotalCostUsd } from '~/lib/cost/token-usage-utils';
import type { Task } from '~/lib/db/repositories/task-repository';

export interface TokenCostApiFields {
  tokenCostUSD: number | null;
}

export type TaskApiResponse = Task & TokenCostApiFields;

function isTokenUsageReport(value: unknown): value is TokenUsageReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as TokenUsageReport).components)
  );
}

export function resolveTokenCostUSD(tokenUsage: unknown | null): number | null {
  if (publicModeConfig.isOfficialDemo || !isTokenUsageReport(tokenUsage)) {
    return null;
  }

  return calculateTotalCostUsd(tokenUsage.components);
}

export function toTaskApiResponse(task: Task): TaskApiResponse {
  return {
    ...task,
    tokenCostUSD: resolveTokenCostUSD(task.tokenUsage),
  };
}
