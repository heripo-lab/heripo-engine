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

/** Thrown, without calling the provider, when a reservation would cross a cap. */
export class SpendLimitError extends Error {
  constructor(
    readonly label: string,
    readonly requested: SpendAmount,
    readonly left: SpendAmount,
  ) {
    super(
      `${label} needs up to ${requested.calls} calls and ${requested.totalTokens} tokens, but ${left.calls} calls and ${left.totalTokens} tokens are left`,
    );
    this.name = 'SpendLimitError';
  }
}

/** A worst case held against the caps until it is settled with what was actually used. */
export interface SpendReservation {
  /** Replace the reservation with the actual usage. Later calls do nothing. */
  settle(actual: SpendAmount): void;
}

export interface SpendGuard {
  readonly limits: SpendLimits;
  /** Settled usage. */
  used(): SpendAmount;
  /** What the caps leave after settled usage and open reservations. */
  left(): SpendAmount;
  /** Hold a worst case synchronously, or throw `SpendLimitError` when it does not fit. */
  reserve(label: string, amount: SpendAmount): SpendReservation;
  /**
   * A model whose every provider attempt is reserved before it is sent and settled with the reported usage, so
   * schema retries and concurrent callers are counted too. The worst case of an attempt is its prompt length in
   * tokens (`inputTokensPerChar` per character of the serialized prompt, schema and tools) plus its output limit;
   * an attempt without an output limit is given `defaultMaxOutputTokens`. A failed attempt keeps its whole
   * reservation, since what it used is unknown.
   */
  wrap(
    model: LanguageModel,
    options?: { defaultMaxOutputTokens?: number; inputTokensPerChar?: number },
  ): Exclude<LanguageModel, string>;
}

/** Output limit given to a guarded attempt that has none, so its worst case is bounded. */
export const SPEND_GUARD_DEFAULT_MAX_OUTPUT_TOKENS = 32_000;

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

/** One budget for every call of a run: reservations before calls, settlement with reported usage after them. */
export function createSpendGuard(limits: SpendLimits): SpendGuard {
  const used: SpendAmount = { calls: 0, totalTokens: 0 };
  const held: SpendAmount = { calls: 0, totalTokens: 0 };
  const left = () => ({
    calls: limits.maxCalls - used.calls - held.calls,
    totalTokens: limits.maxTotalTokens - used.totalTokens - held.totalTokens,
  });
  const reserve = (label: string, amount: SpendAmount): SpendReservation => {
    const l = left();
    if (amount.calls > l.calls || amount.totalTokens > l.totalTokens)
      throw new SpendLimitError(label, amount, l);
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
      },
    };
  };
  return {
    limits,
    used: () => ({ ...used }),
    left,
    reserve,
    wrap(model, options = {}) {
      if (typeof model === 'string')
        throw new Error('Guarded calls require a model instance');
      const maxOutputTokens =
        options.defaultMaxOutputTokens ?? SPEND_GUARD_DEFAULT_MAX_OUTPUT_TOKENS;
      const perChar = options.inputTokensPerChar ?? 1;
      return wrapLanguageModel({
        model,
        middleware: {
          transformParams: async ({ params }) => ({
            ...params,
            maxOutputTokens: params.maxOutputTokens ?? maxOutputTokens,
          }),
          wrapGenerate: async ({ doGenerate, params, model: provider }) => {
            const chars = JSON.stringify([
              params.prompt,
              params.responseFormat ?? null,
              params.tools ?? null,
            ]).length;
            const worst = {
              calls: 1,
              totalTokens:
                // transformParams has given every attempt an output limit
                Math.ceil(chars * perChar) + (params.maxOutputTokens as number),
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
