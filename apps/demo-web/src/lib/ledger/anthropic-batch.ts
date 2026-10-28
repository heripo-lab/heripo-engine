import type {
  MessageBatch,
  MessageBatchIndividualResponse,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/messages';
import type {
  CandidateDiscoveryAudit,
  ContentAttachmentThinProviderOptions,
  ContentAttachmentThinRequest,
} from '@heripo/ledger-extractor';
import type { LanguageModelUsage } from 'ai';
import type { z } from 'zod';

import { createAnthropic } from '@ai-sdk/anthropic';
import Anthropic from '@anthropic-ai/sdk';
import { Output, generateText, jsonSchema } from 'ai';
import { existsSync, readFileSync, writeFileSync } from 'fs';

let client: Anthropic | null = null;
const anthropic = () =>
  (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }));

/** Whether a model ID of the demo form can be sent through the Anthropic Message Batches API. */
export const isAnthropicModelId = (modelId: string) =>
  modelId.startsWith('anthropic/');

class Captured extends Error {
  constructor(readonly body: MessageCreateParamsNonStreaming) {
    super('captured');
  }
}

/**
 * The exact Messages API body the AI SDK would send for this request and model, captured without sending it,
 * so a batch item asks the same as a direct call (system, prompt, max_tokens, structured output format).
 */
export async function anthropicMessageParams(
  modelId: string,
  request: ContentAttachmentThinRequest,
  providerOptions?: ContentAttachmentThinProviderOptions,
): Promise<MessageCreateParamsNonStreaming> {
  return captureAnthropicParams(modelId, {
    providerOptions,
    instructions: request.systemPrompt,
    prompt: request.userPrompt,
    schema: jsonSchema(
      request.providerOutputSchema as Parameters<typeof jsonSchema>[0],
    ),
  });
}

/**
 * The Messages API body of a structured-output call as `LLMCaller` sends it (`Output.object` with the given
 * schema and instructions), captured without sending it.
 */
export async function captureAnthropicParams(
  modelId: string,
  call: {
    instructions: Parameters<typeof generateText>[0]['instructions'];
    prompt: string;
    schema: Parameters<typeof Output.object>[0]['schema'];
    providerOptions?: Parameters<typeof generateText>[0]['providerOptions'];
  },
): Promise<MessageCreateParamsNonStreaming> {
  const provider = createAnthropic({
    apiKey: 'not-sent',
    fetch: async (_url, init) => {
      throw new Captured(JSON.parse(String(init?.body)));
    },
  });
  try {
    await generateText({
      model: provider(modelId.replace(/^anthropic\//, '')),
      output: Output.object({ schema: call.schema }),
      instructions: call.instructions,
      prompt: call.prompt,
      maxRetries: 0,
      providerOptions: call.providerOptions,
    });
  } catch (error) {
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause)
      if (e instanceof Captured) return e.body;
    throw error;
  }
  throw new Error('The request body was not captured');
}

export const createAnthropicBatch = (
  requests: Array<{
    custom_id: string;
    params: MessageCreateParamsNonStreaming;
  }>,
): Promise<MessageBatch> => anthropic().messages.batches.create({ requests });

export const retrieveAnthropicBatch = (id: string): Promise<MessageBatch> =>
  anthropic().messages.batches.retrieve(id);

export const cancelAnthropicBatch = (id: string): Promise<MessageBatch> =>
  anthropic().messages.batches.cancel(id);

export async function anthropicBatchResults(
  id: string,
): Promise<MessageBatchIndividualResponse[]> {
  const out: MessageBatchIndividualResponse[] = [];
  for await (const item of await anthropic().messages.batches.results(id))
    out.push(item);
  return out;
}

/**
 * One batch item as the fields of a recorded call. A succeeded item's text is parsed as the structured output
 * and kept exactly as parsed; unparsable text, a truncated answer, an error, a cancellation or an expiry is a
 * failed call. Usage and the finish reason follow the AI SDK: input tokens include cache reads and writes, and
 * `end_turn` is `stop`, `max_tokens` is `length`.
 */
export function readAnthropicBatchItem(item: MessageBatchIndividualResponse): {
  rawResponse?: unknown;
  usage?: LanguageModelUsage;
  finishReason?: string;
  error?: string;
} {
  const result = item.result;
  if (result.type !== 'succeeded')
    return {
      error:
        result.type === 'errored'
          ? `batch item errored: ${result.error.error.type}: ${result.error.error.message}`
          : `batch item ${result.type}`,
    };
  const { message } = result;
  const u = message.usage;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const inputTokens = u.input_tokens + cacheRead + cacheWrite;
  const thinking = u.output_tokens_details?.thinking_tokens ?? 0;
  const usage: LanguageModelUsage = {
    inputTokens,
    inputTokenDetails: {
      noCacheTokens: u.input_tokens,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
    },
    outputTokens: u.output_tokens,
    outputTokenDetails: {
      textTokens: u.output_tokens - thinking,
      reasoningTokens: thinking,
    },
    totalTokens: inputTokens + u.output_tokens,
  };
  const finishReason =
    message.stop_reason === 'end_turn'
      ? 'stop'
      : message.stop_reason === 'max_tokens'
        ? 'length'
        : (message.stop_reason ?? undefined);
  const text = message.content
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('');
  if (message.stop_reason !== 'end_turn')
    return {
      usage,
      finishReason,
      error: `batch item stopped: ${message.stop_reason}`,
    };
  try {
    return { rawResponse: JSON.parse(text), usage, finishReason };
  } catch {
    return { usage, finishReason, error: 'batch item text is not JSON' };
  }
}

/** One structured-output call of a batch, as `LLMCaller` would send it directly. */
export interface StructuredBatchCall {
  customId: string;
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodType;
  providerOptions?: Parameters<typeof generateText>[0]['providerOptions'];
}
/** The answer to one structured batch call: the schema-checked output, or the reason it failed. */
export interface StructuredBatchAnswer {
  output?: unknown;
  usage?: LanguageModelUsage;
  finishReason?: string;
  error?: string;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Batch was aborted'));
    });
  });

/**
 * Send structured-output calls as one Message Batch and wait for it. Each item is the body the AI SDK would
 * send with the system prompt marked for the prompt cache, with a fixed output limit. The batch ID is saved in
 * `batchFile` before waiting; a call with the same file and the same custom IDs waits for that batch instead of
 * submitting another while it is uncollected. On abort the batch is cancelled. Every answer is checked against its
 * schema; nothing is repaired.
 */
export async function runStructuredBatch(input: {
  modelId: string;
  calls: StructuredBatchCall[];
  batchFile: string;
  maxOutputTokens: number;
  pollMs?: number;
  abortSignal?: AbortSignal;
  log?: (message: string) => void;
}): Promise<Map<string, StructuredBatchAnswer>> {
  const ids = input.calls.map((c) => c.customId);
  const saved: { id: string; customIds: string[]; collected?: boolean } | null =
    existsSync(input.batchFile)
      ? JSON.parse(readFileSync(input.batchFile, 'utf8'))
      : null;
  let batchId = saved?.id;
  if (
    !saved ||
    saved.collected ||
    JSON.stringify(saved.customIds) !== JSON.stringify(ids)
  ) {
    const items = await Promise.all(
      input.calls.map(async (call) => ({
        custom_id: call.customId,
        params: {
          ...(await captureAnthropicParams(input.modelId, {
            instructions: {
              role: 'system',
              content: call.systemPrompt,
              providerOptions: {
                anthropic: { cacheControl: { type: 'ephemeral' } },
              },
            },
            prompt: call.userPrompt,
            schema: call.schema,
            providerOptions: call.providerOptions,
          })),
          max_tokens: input.maxOutputTokens,
        },
      })),
    );
    const batch = await createAnthropicBatch(items);
    batchId = batch.id;
    writeFileSync(
      input.batchFile,
      JSON.stringify({ id: batch.id, customIds: ids }),
    );
    input.log?.(`Submitted ${items.length} calls as ${batch.id}`);
  }
  for (;;) {
    const batch = await retrieveAnthropicBatch(batchId!);
    if (batch.processing_status === 'ended') break;
    if (input.abortSignal?.aborted) {
      await cancelAnthropicBatch(batchId!);
      throw new Error('Batch was cancelled');
    }
    await sleep(input.pollMs ?? 60_000, input.abortSignal).catch(
      async (error) => {
        await cancelAnthropicBatch(batchId!);
        throw error;
      },
    );
  }
  const items = new Map(
    (await anthropicBatchResults(batchId!)).map((item) => [
      item.custom_id,
      item,
    ]),
  );
  const answers = new Map<string, StructuredBatchAnswer>();
  for (const call of input.calls) {
    const item = items.get(call.customId);
    const read = item
      ? readAnthropicBatchItem(item)
      : { error: 'batch item missing' };
    if (read.error) {
      answers.set(call.customId, read);
      continue;
    }
    const parsed = call.schema.safeParse(read.rawResponse);
    answers.set(
      call.customId,
      parsed.success
        ? { ...read, output: parsed.data }
        : { ...read, error: 'response does not match the schema' },
    );
  }
  writeFileSync(
    input.batchFile,
    JSON.stringify({ id: batchId, customIds: ids, collected: true }),
  );
  return answers;
}

/** Token usage in the shape `LLMCaller` reports. */
type ExtendedTokenUsage = CandidateDiscoveryAudit['usage'];

/** A batch answer's usage in the shape `LLMCaller` reports, for audits that mix batch and direct calls. */
export function toExtendedUsage(
  usage: LanguageModelUsage,
  call: {
    component: string;
    phase: string;
    modelId: string;
    metadata?: ExtendedTokenUsage['metadata'];
  },
): ExtendedTokenUsage {
  return {
    component: call.component,
    phase: call.phase,
    model: 'primary',
    modelName: call.modelId.replace(/^anthropic\//, ''),
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
    cachedInputTokens: usage.inputTokenDetails.cacheReadTokens ?? null,
    cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? null,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? 0,
    ...(call.metadata && { metadata: call.metadata }),
  };
}
