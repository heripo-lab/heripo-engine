import { Agent } from 'undici';

/**
 * Reconnect policy for local model servers (LM Studio, Ollama) used by the demo.
 *
 * A local server may crash and restart itself. When a request cannot reach it,
 * the demo waits and resends the request instead of failing the task. This is a
 * demo-only policy; library consumers decide their own fallback behavior.
 */
export const LOCAL_MODEL_RECONNECT = {
  /** Delay before each resend, in milliseconds */
  delayMs: 2_000,
  /** Maximum number of resends after the first attempt */
  maxRetries: 5,
} as const;

/**
 * Longest wait for a local model's response. A local model can think for
 * longer than fetch's default five-minute header and body timeouts allow, so
 * the demo waits up to this limit instead. Caller abort signals still apply.
 */
export const LOCAL_MODEL_RESPONSE_TIMEOUT_MS = 30 * 60 * 1000;

const localModelDispatcher = new Agent({
  headersTimeout: LOCAL_MODEL_RESPONSE_TIMEOUT_MS,
  bodyTimeout: LOCAL_MODEL_RESPONSE_TIMEOUT_MS,
});

/**
 * Socket error codes that mean the server could not be reached. Header and
 * body timeouts are left out: they mean the model is still generating, and a
 * resend would only start the same long request again.
 */
const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function isConnectionError(error: unknown): boolean {
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === 'string' && CONNECTION_ERROR_CODES.has(code);
}

function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * fetch for local model servers: waits up to LOCAL_MODEL_RESPONSE_TIMEOUT_MS
 * for a response and resends a request when the server cannot be reached,
 * following LOCAL_MODEL_RECONNECT. HTTP error responses are returned unchanged.
 */
export const reconnectingFetch: typeof fetch = async (input, init) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(input, {
        ...init,
        dispatcher: localModelDispatcher,
      } as RequestInit);
    } catch (error) {
      if (
        attempt >= LOCAL_MODEL_RECONNECT.maxRetries ||
        !isConnectionError(error)
      ) {
        throw error;
      }
      console.warn(
        `[local-model] connection failed, retry ${attempt + 1}/${LOCAL_MODEL_RECONNECT.maxRetries} in ${LOCAL_MODEL_RECONNECT.delayMs} ms: ${(error as Error).message}`,
      );
      await wait(LOCAL_MODEL_RECONNECT.delayMs, init?.signal);
    }
  }
};
