import type { LoggerMethods } from '@heripo/logger';

/**
 * Retrieve detailed error information from a failed async conversion task.
 *
 * Tries `task.getResult()` and inspects:
 * 1. `result.errors` array – joins all messages with "; "
 * 2. `result.status` fallback – returns "status: <value>"
 * 3. If both are absent – returns "status: unknown"
 * 4. If `getResult()` throws – logs the error and returns a fallback string
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
  try {
    const result = await task.getResult();
    if (result.errors?.length) {
      return result.errors.map((e) => e.message).join('; ');
    }
    return `status: ${result.status ?? 'unknown'}`;
  } catch (err) {
    logger.error(`${logPrefix} Failed to retrieve task result:`, err);
    return 'unable to retrieve error details';
  }
}
