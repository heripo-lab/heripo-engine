import type { LoggerMethods } from '@heripo/logger';

import { type Mock, beforeEach, describe, expect, test, vi } from 'vitest';

// Lazily import so we can mock it
import { getTaskFailureDetails } from './task-failure-details';
import { trackTaskProgress } from './task-progress-tracker';

vi.mock('../config/constants', () => ({
  PDF_CONVERTER: { POLL_INTERVAL_MS: 0 },
}));

vi.mock('./task-failure-details', () => ({
  getTaskFailureDetails: vi.fn(),
}));

describe('trackTaskProgress', () => {
  let logger: LoggerMethods;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    stdoutWriteSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
  });

  function makeTask(
    pollResults: {
      task_status: string;
      task_position?: number;
      task_meta?: any;
    }[],
  ) {
    let pollIndex = 0;
    return {
      taskId: 'test-task',
      poll: vi.fn(async () => pollResults[pollIndex++]),
      getResult: vi.fn(),
    };
  }

  test('resolves on success status', async () => {
    const task = makeTask([{ task_status: 'success' }]);

    await trackTaskProgress(task, 60_000, logger, '[Test]');

    expect(task.poll).toHaveBeenCalledTimes(1);
  });

  test('polls multiple times until success', async () => {
    const task = makeTask([
      { task_status: 'started' },
      { task_status: 'started' },
      { task_status: 'success' },
    ]);

    await trackTaskProgress(task, 60_000, logger, '[Test]');

    expect(task.poll).toHaveBeenCalledTimes(3);
  });

  test('throws on timeout', async () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0) // startTime
      .mockReturnValueOnce(200); // timeout check (200ms > 100ms timeout)

    const task = makeTask([{ task_status: 'started' }]);

    await expect(
      trackTaskProgress(task, 100, logger, '[Test]'),
    ).rejects.toThrow('Task timeout');
  });

  test('throws on timeout with custom errorPrefix', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(200);

    const task = makeTask([{ task_status: 'started' }]);

    await expect(
      trackTaskProgress(task, 100, logger, '[Test]', {
        errorPrefix: '[Custom] ',
      }),
    ).rejects.toThrow('[Custom] Task timeout');
  });

  test('throws on failure with error details', async () => {
    vi.mocked(getTaskFailureDetails).mockResolvedValue('OCR engine crashed');

    const task = makeTask([{ task_status: 'failure' }]);

    await expect(
      trackTaskProgress(task, 60_000, logger, '[Test]'),
    ).rejects.toThrow('Task failed: OCR engine crashed');

    expect(getTaskFailureDetails).toHaveBeenCalledWith(task, logger, '[Test]');
  });

  test('throws on failure with custom errorPrefix', async () => {
    vi.mocked(getTaskFailureDetails).mockResolvedValue('some error');

    const task = makeTask([{ task_status: 'failure' }]);

    await expect(
      trackTaskProgress(task, 60_000, logger, '[Test]', {
        errorPrefix: '[Chunk] ',
      }),
    ).rejects.toThrow('[Chunk] Task failed: some error');
  });

  test('logs elapsed time on failure', async () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0) // startTime
      .mockReturnValueOnce(0) // timeout check
      .mockReturnValueOnce(30_000); // elapsed calculation

    vi.mocked(getTaskFailureDetails).mockResolvedValue('error');

    const task = makeTask([{ task_status: 'failure' }]);

    await expect(
      trackTaskProgress(task, 60_000, logger, '[Test]'),
    ).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      '\n[Test] Task failed after 30s: error',
    );
  });

  // showDetailedProgress tests
  test('does not write to stdout when showDetailedProgress is false', async () => {
    const task = makeTask([
      { task_status: 'started', task_position: 1 },
      { task_status: 'success' },
    ]);

    await trackTaskProgress(task, 60_000, logger, '[Test]');

    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  test('does not log completion message when showDetailedProgress is false', async () => {
    const task = makeTask([{ task_status: 'success' }]);

    await trackTaskProgress(task, 60_000, logger, '[Test]');

    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('Conversion completed'),
    );
  });

  test('writes progress to stdout when showDetailedProgress is true', async () => {
    const task = makeTask([
      { task_status: 'started' },
      { task_status: 'success' },
    ]);

    await trackTaskProgress(task, 60_000, logger, '[Test]', {
      showDetailedProgress: true,
    });

    expect(stdoutWriteSpy).toHaveBeenCalledWith('\r[Test] Status: started');
  });

  test('logs completion message when showDetailedProgress is true', async () => {
    const task = makeTask([{ task_status: 'success' }]);

    await trackTaskProgress(task, 60_000, logger, '[Test]', {
      showDetailedProgress: true,
    });

    expect(logger.info).toHaveBeenCalledWith('\n[Test] Conversion completed!');
  });

  test('shows position in progress line', async () => {
    const task = makeTask([
      { task_status: 'started', task_position: 5 },
      { task_status: 'success' },
    ]);

    await trackTaskProgress(task, 60_000, logger, '[Test]', {
      showDetailedProgress: true,
    });

    expect(stdoutWriteSpy).toHaveBeenCalledWith(
      '\r[Test] Status: started | position: 5',
    );
  });

  test('shows document progress from task_meta', async () => {
    const task = makeTask([
      {
        task_status: 'started',
        task_meta: { total_documents: 10, processed_documents: 3 },
      },
      { task_status: 'success' },
    ]);

    await trackTaskProgress(task, 60_000, logger, '[Test]', {
      showDetailedProgress: true,
    });

    expect(stdoutWriteSpy).toHaveBeenCalledWith(
      '\r[Test] Status: started | progress: 3/10',
    );
  });

  test('shows position and document progress together', async () => {
    const task = makeTask([
      {
        task_status: 'started',
        task_position: 2,
        task_meta: { total_documents: 10, processed_documents: 7 },
      },
      { task_status: 'success' },
    ]);

    await trackTaskProgress(task, 60_000, logger, '[Test]', {
      showDetailedProgress: true,
    });

    expect(stdoutWriteSpy).toHaveBeenCalledWith(
      '\r[Test] Status: started | position: 2 | progress: 7/10',
    );
  });

  test('ignores task_meta without document counts', async () => {
    const task = makeTask([
      { task_status: 'started', task_meta: {} },
      { task_status: 'success' },
    ]);

    await trackTaskProgress(task, 60_000, logger, '[Test]', {
      showDetailedProgress: true,
    });

    expect(stdoutWriteSpy).toHaveBeenCalledWith('\r[Test] Status: started');
  });

  test('deduplicates identical progress lines', async () => {
    const task = makeTask([
      { task_status: 'started' },
      { task_status: 'started' }, // same as above
      { task_status: 'success' },
    ]);

    await trackTaskProgress(task, 60_000, logger, '[Test]', {
      showDetailedProgress: true,
    });

    const calls = (stdoutWriteSpy as Mock).mock.calls.filter(
      (call: any[]) => call[0] === '\r[Test] Status: started',
    );
    expect(calls).toHaveLength(1);
  });

  test('uses setTimeout with POLL_INTERVAL_MS between polls', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const task = makeTask([
      { task_status: 'started' },
      { task_status: 'success' },
    ]);

    await trackTaskProgress(task, 60_000, logger, '[Test]');

    // POLL_INTERVAL_MS is mocked to 0
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);
  });
});
