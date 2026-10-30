import type { LanguageModel } from 'ai';

import { wrapLanguageModel } from 'ai';

/** Hard caps on model calls and tokens. */
export interface SpendLimits {
  maxCalls: number;
  maxTotalTokens: number;
}

/** Calls and tokens, settled or reserved. */
export interface SpendAmount {
  calls: number;
  totalTokens: number;
}

/**
 * Thrown, without calling the provider, when a reservation would cross a cap, or when an earlier attempt used more
 * than it reserved (`reason`), since the caps can then no longer be held.
 */
export class SpendLimitError extends Error {
  constructor(
    readonly label: string,
    readonly requested: SpendAmount,
    readonly left: SpendAmount,
    readonly reason?: string,
  ) {
    super(
      reason
        ? `${label} was refused: ${reason}`
        : `${label} needs up to ${requested.calls} calls and ${requested.totalTokens} tokens, but ${left.calls} calls and ${left.totalTokens} tokens are left`,
    );
    this.name = 'SpendLimitError';
  }
}

/** A worst case held against the caps until it is settled with what was actually used. */
export interface SpendReservation {
  /**
   * Replace the reservation with the actual usage. Later calls do nothing. Usage above the reservation is still
   * counted, and a guard with caps refuses every later reservation, since its worst cases proved too small.
   */
  settle(actual: SpendAmount): void;
}

export interface SpendGuard {
  readonly limits: SpendLimits;
  /** Settled usage. */
  used(): SpendAmount;
  /** What the caps leave after settled usage and open reservations. */
  left(): SpendAmount;
  /** Hold a worst case synchronously, or throw `SpendLimitError` when it does not fit or after an overrun. */
  reserve(label: string, amount: SpendAmount): SpendReservation;
  /**
   * The latest refusal, or null. Callers that turn a failed call into a result can check it after a step, so a run
   * that reached a cap stops instead of continuing with what it could not ask.
   */
  refused(): SpendLimitError | null;
  /**
   * A model whose every provider attempt is reserved before it is sent and settled with the reported usage, so
   * schema retries and concurrent callers are counted too. The worst case of an attempt is
   * `spendInputTokenBound` of its serialized prompt, schema and tools plus its output limit; under caps, an
   * attempt without an output limit is given `defaultMaxOutputTokens`, while a guard without caps leaves it as it
   * is. A prompt with a file given by URL or reference is refused, since its size is unknown. A failed attempt keeps its whole
   * reservation, since what it used is unknown.
   */
  wrap(
    model: LanguageModel,
    options?: { defaultMaxOutputTokens?: number },
  ): Exclude<LanguageModel, string>;
}

/** Output limit given to a guarded attempt that has none, so its worst case is bounded. */
export const SPEND_GUARD_DEFAULT_MAX_OUTPUT_TOKENS = 32_000;

/** Input tokens a provider may add to an attempt beyond its text, such as tool and output-format instructions. */
export const SPEND_GUARD_ATTEMPT_OVERHEAD_TOKENS = 1_000;

const encoder = new TextEncoder();

/**
 * An upper bound on the input tokens of a serialized request: its UTF-8 byte length, since every token of a
 * byte-level tokenizer covers at least one byte, plus `SPEND_GUARD_ATTEMPT_OVERHEAD_TOKENS`.
 */
export function spendInputTokenBound(serialized: string) {
  return (
    encoder.encode(serialized).length + SPEND_GUARD_ATTEMPT_OVERHEAD_TOKENS
  );
}

/**
 * Whether a prompt holds a file part given by URL or provider reference, whose size the serialized prompt does
 * not show.
 */
function hasUnsizedFile(prompt: { content: unknown }[]) {
  return prompt.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some(
        (part: { type: string; data?: { type: string } }) =>
          part.type === 'file' &&
          (part.data?.type === 'url' || part.data?.type === 'reference'),
      ),
  );
}

/** Total tokens of a provider usage report; input includes cache reads and writes when the total is missing. */
function usageTotal(usage: {
  inputTokens: {
    total: number | undefined;
    noCache: number | undefined;
    cacheRead: number | undefined;
    cacheWrite: number | undefined;
  };
  outputTokens: { total: number | undefined };
}) {
  const input =
    usage.inputTokens.total ??
    (usage.inputTokens.noCache ?? 0) +
      (usage.inputTokens.cacheRead ?? 0) +
      (usage.inputTokens.cacheWrite ?? 0);
  return input + (usage.outputTokens.total ?? 0);
}

/**
 * One budget for every call of a run: reservations before calls, settlement with reported usage after them.
 * Without `caps` the guard only counts: its limits are never reached and wrapped attempts keep their own output
 * limits.
 */
export function createSpendGuard(caps?: SpendLimits): SpendGuard {
  const limits = caps ?? {
    maxCalls: Number.MAX_SAFE_INTEGER,
    maxTotalTokens: Number.MAX_SAFE_INTEGER,
  };
  const used: SpendAmount = { calls: 0, totalTokens: 0 };
  const held: SpendAmount = { calls: 0, totalTokens: 0 };
  let refusal: SpendLimitError | null = null;
  let overrun: string | null = null;
  const left = () => ({
    calls: limits.maxCalls - used.calls - held.calls,
    totalTokens: limits.maxTotalTokens - used.totalTokens - held.totalTokens,
  });
  const reserve = (label: string, amount: SpendAmount): SpendReservation => {
    const l = left();
    if (overrun)
      throw (refusal = new SpendLimitError(label, amount, l, overrun));
    if (amount.calls > l.calls || amount.totalTokens > l.totalTokens)
      throw (refusal = new SpendLimitError(label, amount, l));
    held.calls += amount.calls;
    held.totalTokens += amount.totalTokens;
    let open = true;
    return {
      settle(actual) {
        if (!open) return;
        open = false;
        held.calls -= amount.calls;
        held.totalTokens -= amount.totalTokens;
        used.calls += actual.calls;
        used.totalTokens += actual.totalTokens;
        // without caps an attempt may reserve no output, so passing its reservation says nothing about a bound
        if (
          caps &&
          (actual.calls > amount.calls ||
            actual.totalTokens > amount.totalTokens)
        ) {
          overrun ??= `${label} used ${actual.calls} calls and ${actual.totalTokens} tokens of a ${amount.calls}-call, ${amount.totalTokens}-token reservation`;
          refusal ??= new SpendLimitError(label, actual, left(), overrun);
        }
      },
    };
  };
  return {
    limits,
    used: () => ({ ...used }),
    left,
    reserve,
    refused: () => refusal,
    wrap(model, options = {}) {
      if (typeof model === 'string')
        throw new Error('Guarded calls require a model instance');
      // without caps an attempt keeps its own output limit, so no provider sees one it did not ask for
      const maxOutputTokens = caps
        ? (options.defaultMaxOutputTokens ??
          SPEND_GUARD_DEFAULT_MAX_OUTPUT_TOKENS)
        : undefined;
      return wrapLanguageModel({
        model,
        middleware: {
          transformParams: async ({ params }) => ({
            ...params,
            maxOutputTokens: params.maxOutputTokens ?? maxOutputTokens,
          }),
          wrapGenerate: async ({ doGenerate, params, model: provider }) => {
            if (caps && hasUnsizedFile(params.prompt))
              throw (refusal = new SpendLimitError(
                provider.modelId,
                { calls: 1, totalTokens: 0 },
                left(),
                'a file given by URL or reference has no size to reserve',
              ));
            const input = spendInputTokenBound(
              JSON.stringify([
                params.prompt,
                params.responseFormat ?? null,
                params.tools ?? null,
              ]),
            );
            const worst = {
              calls: 1,
              totalTokens: input + (params.maxOutputTokens ?? 0),
            };
            const reservation = reserve(provider.modelId, worst);
            try {
              const result = await doGenerate();
              reservation.settle({
                calls: 1,
                totalTokens: usageTotal(result.usage),
              });
              return result;
            } catch (error) {
              reservation.settle(worst);
              throw error;
            }
          },
        },
      });
    },
  };
}
