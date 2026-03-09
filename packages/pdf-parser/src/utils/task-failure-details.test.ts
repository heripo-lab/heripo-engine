import type { LoggerMethods } from '@heripo/logger';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { getTaskFailureDetails } from './task-failure-details';

describe('getTaskFailureDetails', () => {
  let logger: LoggerMethods;

  beforeEach(() => {
    vi.useFakeTimers();
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as LoggerMethods;
  });

  test('returns joined error messages when errors array is present', async () => {
    const task = {
      getResult: vi.fn().mockResolvedValue({
        errors: [{ message: 'error one' }, { message: 'error two' }],
        status: 'failure',
      }),
    };

    const result = await getTaskFailureDetails(task, logger, '[Test]');

    expect(result).toBe('error one; error two');
    expect(task.getResult).toHaveBeenCalledTimes(1);
  });

  test('returns status fallback when errors array is empty', async () => {
    const task = {
      getResult: vi.fn().mockResolvedValue({
        errors: [],
        status: 'failure',
      }),
    };

    const result = await getTaskFailureDetails(task, logger, '[Test]');

    expect(result).toBe('status: failure');
  });

  test('returns status fallback when errors is undefined', async () => {
    const task = {
      getResult: vi.fn().mockResolvedValue({
        status: 'partial_failure',
      }),
    };

    const result = await getTaskFailureDetails(task, logger, '[Test]');

    expect(result).toBe('status: partial_failure');
  });

  test('returns "status: unknown" when both errors and status are absent', async () => {
    const task = {
      getResult: vi.fn().mockResolvedValue({}),
    };

    const result = await getTaskFailureDetails(task, logger, '[Test]');

    expect(result).toBe('status: unknown');
  });

  test('retries on getResult failure and succeeds on second attempt', async () => {
    const networkError = new Error('Network error');
    const task = {
      getResult: vi
        .fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({
          errors: [{ message: 'OCR engine crashed' }],
        }),
    };

    const promise = getTaskFailureDetails(task, logger, '[Test]');
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toBe('OCR engine crashed');
    expect(task.getResult).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      '[Test] Result not available yet, retrying (1/3)...',
    );
  });

  test('retries up to 3 times and returns fallback on all failures', async () => {
    const networkError = new Error('Network error');
    const task = {
      getResult: vi.fn().mockRejectedValue(networkError),
    };

    const promise = getTaskFailureDetails(task, logger, '[Test]');
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toBe('unable to retrieve error details');
    expect(task.getResult).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      '[Test] Failed to retrieve task result after 3 attempts:',
      networkError,
    );
  });

  test('succeeds on third attempt after two failures', async () => {
    const networkError = new Error('Network error');
    const task = {
      getResult: vi
        .fn()
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({
          errors: [{ message: 'timeout exceeded' }],
        }),
    };

    const promise = getTaskFailureDetails(task, logger, '[Test]');
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toBe('timeout exceeded');
    expect(task.getResult).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('does not delay on first attempt', async () => {
    const task = {
      getResult: vi.fn().mockResolvedValue({
        errors: [{ message: 'immediate error' }],
      }),
    };

    const result = await getTaskFailureDetails(task, logger, '[Test]');

    expect(result).toBe('immediate error');
    expect(task.getResult).toHaveBeenCalledTimes(1);
    // No warn or error logs since first attempt succeeded
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
