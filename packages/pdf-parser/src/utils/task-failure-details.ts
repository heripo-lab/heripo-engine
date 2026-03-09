import type { LoggerMethods } from '@heripo/logger';

/** Maximum number of retry attempts for fetching task failure details */
const MAX_RESULT_RETRIES = 3;

/** Delay in milliseconds between retry attempts */
const RESULT_RETRY_DELAY_MS = 2000;

/**
 * Retrieve detailed error information from a failed async conversion task.
 *
 * The Docling server may not have the failure result available immediately after
 * the task status transitions to "failure". This function retries up to
 * {@link MAX_RESULT_RETRIES} times with a {@link RESULT_RETRY_DELAY_MS} delay
 * between attempts to allow the server time to persist the result.
 *
 * For each attempt it inspects:
 * 1. `result.errors` array – joins all messages with "; "
 * 2. `result.status` fallback – returns "status: <value>"
 * 3. If both are absent – returns "status: unknown"
 * 4. If all attempts fail – logs the error and returns a fallback string
 */
export async function getTaskFailureDetails(
  task: {
    getResult: () => Promise<{
      errors?: { message: string }[];
      status?: string;
    }>;
  },
  logger: LoggerMethods,
  logPrefix: string,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_RESULT_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, RESULT_RETRY_DELAY_MS));
      }
      const result = await task.getResult();
      if (result.errors?.length) {
        return result.errors.map((e) => e.message).join('; ');
      }
      return `status: ${result.status ?? 'unknown'}`;
    } catch (err) {
      if (attempt === MAX_RESULT_RETRIES - 1) {
        logger.error(
          `${logPrefix} Failed to retrieve task result after ${MAX_RESULT_RETRIES} attempts:`,
          err,
        );
        return 'unable to retrieve error details';
      }
      logger.warn(
        `${logPrefix} Result not available yet, retrying (${attempt + 1}/${MAX_RESULT_RETRIES})...`,
      );
    }
  }

  /* v8 ignore start -- unreachable: loop always returns */
  return 'unable to retrieve error details';
  /* v8 ignore stop */
}
