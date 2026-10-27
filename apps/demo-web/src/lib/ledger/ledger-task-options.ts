import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { LLM_MODELS } from '~/features/upload/constants/llm-models';

import { readDatabase } from '../db';
import { paths } from '../paths';

export {
  DEFAULT_LEDGER_MODEL,
  LEDGER_RUN_BUDGET,
} from '~/features/ledger/constants/ledger-run';

/** Options of a ledger task: the model for its automatic run and, when made from a PDF result, that task. */
export interface LedgerTaskOptions {
  modelId: string;
  budget: { maxCalls: number; maxTotalTokens: number };
  /** The completed PDF processing task whose processed document this ledger was made from. */
  sourceTaskId?: string;
}

export const ledgerOptionsFile = (taskId: string) =>
  join(paths.task(taskId).root, 'ledger-options.json');

/** Whether a model ID is one the demo offers. */
export const isLedgerModel = (modelId: string) =>
  LLM_MODELS.some((m) => m.id === modelId);

export function readLedgerTaskOptions(
  taskId: string,
): LedgerTaskOptions | null {
  const file = ledgerOptionsFile(taskId);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
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
