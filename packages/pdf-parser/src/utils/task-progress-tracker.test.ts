import type { LoggerMethods } from '@heripo/logger';

import type * as Constants from '../config/constants';

import { type Mock, beforeEach, describe, expect, test, vi } from 'vitest';

import { PDF_CONVERTER } from '../config/constants';
import { getTaskFailureDetails } from './task-failure-details';
import { trackTaskProgress } from './task-progress-tracker';

vi.mock('./task-failure-details', () => ({
  getTaskFailureDetails: vi.fn(),
}));

vi.mock('../config/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof Constants>();
  return {
    ...actual,
    PDF_CONVERTER: {
      ...actual.PDF_CONVERTER,
      POLL_INTERVAL_MS: 0,
    },
  };
});

function createMockTask(overrides?: {
  taskId?: string;
  pollResponses?: {
    task_status: string;
    task_position?: number;
    task_meta?: Record<string, unknown>;
  }[];
  getResultValue?: unknown;
}) {
  const responses = overrides?.pollResponses ?? [{ task_status: 'success' }];
  let pollIndex = 0;
  return {
    taskId: overrides?.taskId ?? 'task-1',
    poll: vi.fn(
      async () => responses[Math.min(pollIndex++, responses.length - 1)],
    ),
    getResult: vi.fn().mockResolvedValue(overrides?.getResultValue ?? {}),
  };
}

describe('trackTaskProgress', () => {
  let logger: LoggerMethods;
  let stdoutWriteSpy: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();

    logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    stdoutWriteSpy = vi
      .spyOn(process.stdout, 'write')
      .mockReturnValue(true) as unknown as Mock;
  });

  describe('success', () => {
    test('resolves when task completes successfully', async () => {
      const task = createMockTask();

      await trackTaskProgress(task, 60000, logger, '[Test]');

      expect(task.poll).toHaveBeenCalledTimes(1);
    });

    test('polls multiple times before success', async () => {
      const task = createMockTask({
        pollResponses: [
          { task_status: 'pending' },
          { task_status: 'started' },
          { task_status: 'success' },
        ],
      });

      await trackTaskProgress(task, 60000, logger, '[Test]');

      expect(task.poll).toHaveBeenCalledTimes(3);
    });

    test('logs completion message when showDetailedProgress is enabled', async () => {
      const task = createMockTask();

      await trackTaskProgress(task, 60000, logger, '[Test]', {
        showDetailedProgress: true,
      });

      expect(logger.info).toHaveBeenCalledWith(
        '\n[Test] Conversion completed!',
      );
    });

    test('does not log completion message when showDetailedProgress is disabled', async () => {
      const task = createMockTask();

      await trackTaskProgress(task, 60000, logger, '[Test]');

      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('detailed progress', () => {
    test('writes status to stdout', async () => {
      const task = createMockTask({
        pollResponses: [{ task_status: 'started' }, { task_status: 'success' }],
      });

      await trackTaskProgress(task, 60000, logger, '[Test]', {
        showDetailedProgress: true,
      });

      expect(stdoutWriteSpy).toHaveBeenCalledWith('\r[Test] Status: started');
    });

    test('writes position to stdout', async () => {
      const task = createMockTask({
        pollResponses: [
          { task_status: 'started', task_position: 5 },
          { task_status: 'success' },
        ],
      });

      await trackTaskProgress(task, 60000, logger, '[Test]', {
        showDetailedProgress: true,
      });

      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        '\r[Test] Status: started | position: 5',
      );
    });

    test('writes document progress from task_meta', async () => {
      const task = createMockTask({
        pollResponses: [
          {
            task_status: 'started',
            task_position: 1,
            task_meta: { total_documents: 10, processed_documents: 3 },
          },
          { task_status: 'success' },
        ],
      });

      await trackTaskProgress(task, 60000, logger, '[Test]', {
        showDetailedProgress: true,
      });

      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        '\r[Test] Status: started | position: 1 | progress: 3/10',
      );
    });

    test('ignores task_meta without document counts', async () => {
      const task = createMockTask({
        pollResponses: [
          { task_status: 'started', task_meta: {} },
          { task_status: 'success' },
        ],
      });

      await trackTaskProgress(task, 60000, logger, '[Test]', {
        showDetailedProgress: true,
      });

      expect(stdoutWriteSpy).toHaveBeenCalledWith('\r[Test] Status: started');
    });

    test('deduplicates identical progress lines', async () => {
      const task = createMockTask({
        pollResponses: [
          { task_status: 'started' },
          { task_status: 'started' },
          { task_status: 'success' },
        ],
      });

      await trackTaskProgress(task, 60000, logger, '[Test]', {
        showDetailedProgress: true,
      });

      const startedCalls = stdoutWriteSpy.mock.calls.filter(
        (call: unknown[]) => call[0] === '\r[Test] Status: started',
      );
      expect(startedCalls).toHaveLength(1);
    });

    test('does not write progress when showDetailedProgress is disabled', async () => {
      const task = createMockTask({
        pollResponses: [{ task_status: 'started' }, { task_status: 'success' }],
      });

      await trackTaskProgress(task, 60000, logger, '[Test]');

      expect(stdoutWriteSpy).not.toHaveBeenCalled();
    });
  });

  describe('timeout', () => {
    test('throws default timeout error with Task prefix', async () => {
      vi.spyOn(Date, 'now')
        .mockReturnValueOnce(1000000)
        .mockReturnValueOnce(1000200);

      const task = createMockTask({
        pollResponses: [{ task_status: 'pending' }],
      });

      await expect(
        trackTaskProgress(task, 100, logger, '[Test]'),
      ).rejects.toThrow('Task timeout');
    });

    test('throws timeout error with custom errorPrefix', async () => {
      vi.spyOn(Date, 'now')
        .mockReturnValueOnce(1000000)
        .mockReturnValueOnce(1000200);

      const task = createMockTask({
        pollResponses: [{ task_status: 'pending' }],
      });

      await expect(
        trackTaskProgress(task, 100, logger, '[Test]', {
          errorPrefix: '[Custom] Chunk task ',
        }),
      ).rejects.toThrow('[Custom] Chunk task timeout');
    });
  });

  describe('failure', () => {
    test('throws failure error with error details (default prefix)', async () => {
      vi.mocked(getTaskFailureDetails).mockResolvedValue('OCR engine crashed');

      const task = createMockTask({
        pollResponses: [{ task_status: 'failure' }],
      });

      await expect(
        trackTaskProgress(task, 60000, logger, '[Test]'),
      ).rejects.toThrow('Task failed: OCR engine crashed');
    });

    test('throws failure error with custom errorPrefix', async () => {
      vi.mocked(getTaskFailureDetails).mockResolvedValue('OCR engine crashed');

      const task = createMockTask({
        pollResponses: [{ task_status: 'failure' }],
      });

      await expect(
        trackTaskProgress(task, 60000, logger, '[Test]', {
          errorPrefix: '[Chunked] task ',
        }),
      ).rejects.toThrow('[Chunked] task failed: OCR engine crashed');
    });

    test('logs detailed failure with elapsed time when showDetailedProgress is enabled', async () => {
      vi.spyOn(Date, 'now')
        .mockReturnValueOnce(1000000)
        .mockReturnValueOnce(1000000)
        .mockReturnValueOnce(1060000);

      vi.mocked(getTaskFailureDetails).mockResolvedValue('Processing failed');

      const task = createMockTask({
        pollResponses: [{ task_status: 'failure' }],
      });

      await expect(
        trackTaskProgress(task, 120000, logger, '[Test]', {
          showDetailedProgress: true,
        }),
      ).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        '\n[Test] Task failed after 60s: Processing failed',
      );
    });

    test('logs compact failure with taskId and decimal elapsed when showDetailedProgress is disabled', async () => {
      vi.spyOn(Date, 'now')
        .mockReturnValueOnce(1000000)
        .mockReturnValueOnce(1000000)
        .mockReturnValueOnce(1005500);

      vi.mocked(getTaskFailureDetails).mockResolvedValue('Processing failed');

      const task = createMockTask({
        taskId: 'task-abc',
        pollResponses: [{ task_status: 'failure' }],
      });

      await expect(
        trackTaskProgress(task, 120000, logger, '[Test]'),
      ).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        '[Test] Task task-abc failed after 5.5s',
      );
    });

    test('calls getTaskFailureDetails with correct arguments', async () => {
      vi.mocked(getTaskFailureDetails).mockResolvedValue('some error');

      const task = createMockTask({
        pollResponses: [{ task_status: 'failure' }],
      });

      await expect(
        trackTaskProgress(task, 60000, logger, '[MyPrefix]'),
      ).rejects.toThrow();

      expect(getTaskFailureDetails).toHaveBeenCalledWith(
        task,
        logger,
        '[MyPrefix]',
      );
    });
  });

  describe('polling interval', () => {
    test('waits POLL_INTERVAL_MS between polls', async () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      const task = createMockTask({
        pollResponses: [{ task_status: 'started' }, { task_status: 'success' }],
      });

      await trackTaskProgress(task, 60000, logger, '[Test]');

      expect(setTimeoutSpy).toHaveBeenCalledWith(
        expect.any(Function),
        PDF_CONVERTER.POLL_INTERVAL_MS,
      );
    });
  });
});
