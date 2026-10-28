import type {
  CandidateDeduplicationBlockAudit,
  CandidateDiscoveryPlan,
  CandidateDiscoveryResult,
} from '@heripo/ledger-extractor';

import {
  CANDIDATE_DEDUPLICATION_BLOCK_PROMPT_VERSION,
  CANDIDATE_DEDUPLICATION_BLOCK_PROVIDER_OPTIONS,
  createCandidateDeduplicationBlockRequest,
  createCandidateDeduplicationBlockSchema,
  planCandidateDeduplication,
} from '@heripo/ledger-extractor';
import { writeFileSync } from 'fs';
import { join } from 'path';

import { runStructuredBatch, toExtendedUsage } from './anthropic-batch';

/** Output limit of a block item; the largest saved block answer was about 4,300 tokens. */
const BATCH_MAX_OUTPUT_TOKENS = 32_000;

/**
 * Answer the duplicate review blocks that have no saved audit through one Anthropic Message Batch, at half the
 * price, with the same prompt-cache mark and reasoning effort as a direct block call (`runStructuredBatch`). Each
 * valid answer is saved as a block audit; after every valid answer is saved, an errored, expired, truncated or
 * invalid item throws, and the next call submits only those blocks in a new batch.
 */
export async function answerDeduplicationBlocksByBatch(input: {
  plan: CandidateDiscoveryPlan;
  discovery: CandidateDiscoveryResult;
  modelId: string;
  blockDir: string;
  batchFile: string;
  completed: CandidateDeduplicationBlockAudit[];
  abortSignal?: AbortSignal;
  log?: (message: string) => void;
}): Promise<CandidateDeduplicationBlockAudit[]> {
  const { plan, discovery, modelId } = input;
  const done = new Set(input.completed.map((a) => a.blockId));
  const open = planCandidateDeduplication(plan, discovery).blocks.filter(
    (b) => !done.has(b.blockId),
  );
  if (!open.length) return [];
  const requests = new Map(
    open.map((block) => [
      block.blockId,
      createCandidateDeduplicationBlockRequest(plan, discovery, block),
    ]),
  );
  const answers = await runStructuredBatch({
    modelId,
    batchFile: input.batchFile,
    maxOutputTokens: BATCH_MAX_OUTPUT_TOKENS,
    abortSignal: input.abortSignal,
    log: input.log,
    calls: open.map((block) => ({
      customId: block.blockId,
      systemPrompt: requests.get(block.blockId)!.systemPrompt,
      userPrompt: requests.get(block.blockId)!.userPrompt,
      schema: createCandidateDeduplicationBlockSchema(discovery, block),
      providerOptions: CANDIDATE_DEDUPLICATION_BLOCK_PROVIDER_OPTIONS,
    })),
  });
  const answered: CandidateDeduplicationBlockAudit[] = [];
  const failures: string[] = [];
  for (const block of open) {
    const answer = answers.get(block.blockId)!;
    if (answer.error) {
      failures.push(`${block.blockId}: ${answer.error}`);
      continue;
    }
    const request = requests.get(block.blockId)!;
    const audit: CandidateDeduplicationBlockAudit = {
      ...request,
      promptVersion: CANDIDATE_DEDUPLICATION_BLOCK_PROMPT_VERSION,
      response: answer.output as CandidateDeduplicationBlockAudit['response'],
      usage: toExtendedUsage(answer.usage!, {
        component: 'LedgerCandidateDeduplication',
        phase: 'candidate-deduplication-block',
        modelId,
        metadata: {
          promptVersion: request.promptVersion,
          blockId: block.blockId,
        },
      }),
    };
    writeFileSync(
      join(input.blockDir, `${block.blockId}.json`),
      JSON.stringify(audit, null, 2),
    );
    answered.push(audit);
  }
  // every valid answer is saved first, so a later call submits only the failed blocks
  if (failures.length)
    throw new Error(`Duplicate review blocks failed: ${failures.join('; ')}`);
  return answered;
}
