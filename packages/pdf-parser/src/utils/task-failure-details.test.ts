import type { LoggerMethods } from '@heripo/logger';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { getTaskFailureDetails } from './task-failure-details';

describe('getTaskFailureDetails', () => {
  let logger: LoggerMethods;

  beforeEach(() => {
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

  test('logs error and returns fallback when getResult throws', async () => {
    const networkError = new Error('Network error');
    const task = {
      getResult: vi.fn().mockRejectedValue(networkError),
    };

    const result = await getTaskFailureDetails(task, logger, '[Test]');

    expect(result).toBe('unable to retrieve error details');
    expect(logger.error).toHaveBeenCalledWith(
      '[Test] Failed to retrieve task result:',
      networkError,
    );
  });
});
