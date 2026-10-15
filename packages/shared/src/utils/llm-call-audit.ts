import type { LanguageModel } from 'ai';

import { wrapLanguageModel } from 'ai';

/** One provider generation attempt, captured before structured-output parsing. */
export interface LLMCallAttempt {
  sequence: number;
  modelId: string;
  provider: string;
  startedAt: string;
  completedAt: string;
  outcome: 'returned' | 'error';
  finishReason: { unified: string; raw?: string } | null;
  apiStatus: string | null;
  incompleteDetails: unknown;
  responseId: string | null;
  requestBody: unknown;
  responseBody: unknown;
  content: unknown;
  usage: unknown;
  error: { name: string; message: string; statusCode: number | null } | null;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metadata(body: unknown) {
  if (typeof body !== 'string') return record(body);
  try {
    return record(JSON.parse(body));
  } catch {
    return {};
  }
}

function text(value: unknown) {
  return typeof value === 'string' ? value : null;
}

/** Observe each doGenerate invocation without changing prompts, responses or retries. */
export function createAuditedModel(
  model: LanguageModel,
  onAttempt?: (attempt: LLMCallAttempt) => void | Promise<void>,
): { model: Exclude<LanguageModel, string>; attempts: LLMCallAttempt[] } {
  if (typeof model === 'string')
    throw new Error('Audited calls require a model instance');
  const attempts: LLMCallAttempt[] = [];
  let sequence = 0;
  return {
    attempts,
    model: wrapLanguageModel({
      model,
      middleware: {
        wrapGenerate: async ({ doGenerate, model: providerModel }) => {
          const ordinal = ++sequence;
          const startedAt = new Date().toISOString();
          let result: Awaited<ReturnType<typeof doGenerate>> | undefined;
          let failed = false;
          let failure: unknown;
          try {
            result = await doGenerate();
          } catch (error) {
            failed = true;
            failure = error;
          }
          const error = record(failure);
          const responseBody = failed
            ? (error.responseBody ?? null)
            : (result!.response?.body ?? null);
          const api = metadata(responseBody);
          const attempt: LLMCallAttempt = {
            sequence: ordinal,
            modelId: providerModel.modelId,
            provider: providerModel.provider,
            startedAt,
            completedAt: new Date().toISOString(),
            outcome: failed ? 'error' : 'returned',
            finishReason: result?.finishReason ?? null,
            apiStatus: text(api.status),
            incompleteDetails: api.incomplete_details ?? null,
            responseId: text(api.id) ?? result?.response?.id ?? null,
            requestBody: failed
              ? (error.requestBodyValues ?? null)
              : (result!.request?.body ?? null),
            responseBody,
            content: result?.content ?? null,
            usage: result?.usage ?? null,
            error: failed
              ? {
                  name: failure instanceof Error ? failure.name : 'Error',
                  message:
                    failure instanceof Error
                      ? failure.message
                      : String(failure),
                  statusCode:
                    typeof error.statusCode === 'number'
                      ? error.statusCode
                      : null,
                }
              : null,
          };
          attempts.push(attempt);
          await onAttempt?.(attempt);
          if (failed) throw failure;
          return result!;
        },
      },
    }),
  };
}
