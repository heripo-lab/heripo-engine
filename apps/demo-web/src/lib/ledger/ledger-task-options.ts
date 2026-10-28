import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import type { LedgerStageModels } from '~/features/ledger/constants/ledger-run';
import {
  DEFAULT_LEDGER_MODELS,
  LEDGER_MODEL_STAGES,
} from '~/features/ledger/constants/ledger-run';
import { LLM_MODELS } from '~/features/upload/constants/llm-models';

import { readDatabase } from '../db';
import { paths } from '../paths';

export {
  DEFAULT_LEDGER_MODELS,
  LEDGER_RUN_BUDGET,
} from '~/features/ledger/constants/ledger-run';

/** Options of a ledger task: the model of each step of its automatic run and, when made from a PDF result, that task. */
export interface LedgerTaskOptions {
  models: LedgerStageModels;
  /**
   * Whether thin attachment and the duplicate review go through the Anthropic Message Batches API (half price,
   * up to 24 hours each). Absent: on for each of those steps whose model is an Anthropic model; false sends
   * direct calls.
   */
  batch?: boolean;
  budget: { maxCalls: number; maxTotalTokens: number };
  /** The completed PDF processing task whose processed document this ledger was made from. */
  sourceTaskId?: string;
}

export const ledgerOptionsFile = (taskId: string) =>
  join(paths.task(taskId).root, 'ledger-options.json');

/** Whether a model ID is one the demo offers. */
export const isLedgerModel = (modelId: string) =>
  LLM_MODELS.some((m) => m.id === modelId);

/**
 * The step models of a request: `models` may name any of the steps, and a step it leaves out uses `modelId`
 * (one model for every step) or else the default. Returns an error message for a model the demo does not offer.
 */
export function resolveLedgerStageModels(input: {
  models?: unknown;
  modelId?: string | null;
}): { models: LedgerStageModels } | { error: string } {
  const given =
    input.models && typeof input.models === 'object'
      ? (input.models as Record<string, unknown>)
      : {};
  const models = { ...DEFAULT_LEDGER_MODELS };
  for (const { id } of LEDGER_MODEL_STAGES) {
    const modelId = given[id] ?? input.modelId ?? DEFAULT_LEDGER_MODELS[id];
    if (typeof modelId !== 'string' || !isLedgerModel(modelId))
      return { error: `Unknown model for ${id}: ${String(modelId)}` };
    models[id] = modelId;
  }
  return { models };
}

/** Whether a step of a ledger run uses the Message Batches API: an Anthropic model for it, batches not turned off. */
export const usesBatch = (options: LedgerTaskOptions, modelId: string) =>
  options.batch !== false && modelId.startsWith('anthropic/');

export function readLedgerTaskOptions(
  taskId: string,
): LedgerTaskOptions | null {
  const file = ledgerOptionsFile(taskId);
  if (!existsSync(file)) return null;
  const saved = JSON.parse(readFileSync(file, 'utf8')) as LedgerTaskOptions & {
    modelId?: string;
  };
  // options saved before step models had one model for every step
  if (saved.models) return saved;
  const { modelId, ...rest } = saved;
  return {
    ...rest,
    models: Object.fromEntries(
      LEDGER_MODEL_STAGES.map(({ id }) => [id, modelId]),
    ) as LedgerStageModels,
  };
}

/** The session's ledger task made from a PDF processing task, newest first, if any. */
export function findLedgerTaskForSource(
  sourceTaskId: string,
  sessionId: string,
): { id: string; status: string } | null {
  const found = readDatabase()
    .tasks.filter((t) => t.kind === 'ledger' && t.session_id === sessionId)
    .filter((t) => readLedgerTaskOptions(t.id)?.sourceTaskId === sourceTaskId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return found ? { id: found.id, status: found.status } : null;
}
