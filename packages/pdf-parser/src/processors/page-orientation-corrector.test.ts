import { spawnAsync } from '@heripo/shared';
import { type Mock, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  PAGE_ORIENTATION_MIN_UPWARD_CHARS,
  PAGE_ORIENTATION_UPWARD_RATIO,
  PageOrientationCorrector,
} from './page-orientation-corrector';

vi.mock('@heripo/shared', () => ({
  spawnAsync: vi.fn(),
}));

const mockSpawnAsync = spawnAsync as Mock;
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe('PageOrientationCorrector', () => {
  let corrector: PageOrientationCorrector;

  beforeEach(() => {
    vi.clearAllMocks();
    corrector = new PageOrientationCorrector(logger, '/venv/bin/python');
  });

  test('runs the detection script with the paths, languages and thresholds and returns turned pages', async () => {
    mockSpawnAsync.mockResolvedValueOnce({
      code: 0,
      stdout: 'warning line\n{"pages": 12, "rotated": [3, 9]}\n',
      stderr: '',
    });

    const result = await corrector.correct('/in.pdf', '/tmp/upright.pdf', [
      'zh-Hans',
      'en-US',
    ]);

    expect(result).toEqual({ pages: 12, rotatedPages: [3, 9] });
    const [command, args] = mockSpawnAsync.mock.calls[0];
    expect(command).toBe('/venv/bin/python');
    expect(args[0]).toBe('-I');
    expect(args[1]).toBe('-c');
    expect(args[2]).toContain('set_rotation');
    expect(args.slice(3)).toEqual([
      '/in.pdf',
      '/tmp/upright.pdf',
      'zh-Hans,en-US',
      String(PAGE_ORIENTATION_UPWARD_RATIO),
      String(PAGE_ORIENTATION_MIN_UPWARD_CHARS),
    ]);
    expect(mockSpawnAsync.mock.calls[0][2]).toEqual({ signal: undefined });
    expect(logger.info).toHaveBeenCalledWith(
      '[PageOrientationCorrector] 2 of 12 pages turned upright: 3, 9',
    );
  });

  test('reports no turned page without listing pages', async () => {
    mockSpawnAsync.mockResolvedValueOnce({
      code: 0,
      stdout: '{"pages": 3, "rotated": []}',
      stderr: '',
    });

    expect(await corrector.correct('/in.pdf', '/out.pdf', ['ko-KR'])).toEqual({
      pages: 3,
      rotatedPages: [],
    });
    expect(logger.info).toHaveBeenCalledWith(
      '[PageOrientationCorrector] 0 of 3 pages turned upright',
    );
  });

  test('returns null and warns when the script fails or cannot start', async () => {
    mockSpawnAsync
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: ' no ocrmac \n' })
      .mockRejectedValueOnce(new Error('spawn ENOENT'));

    expect(
      await corrector.correct('/in.pdf', '/out.pdf', ['ko-KR']),
    ).toBeNull();
    expect(
      await corrector.correct('/in.pdf', '/out.pdf', ['ko-KR']),
    ).toBeNull();
    expect(logger.warn.mock.calls.map((c) => c[1])).toEqual([
      'no ocrmac',
      'spawn ENOENT',
    ]);
  });

  test('passes the abort signal to the detection process and rethrows its abort error', async () => {
    const controller = new AbortController();
    const abortError = new Error('The operation was aborted');
    mockSpawnAsync.mockImplementationOnce(async () => {
      controller.abort();
      throw abortError;
    });

    await expect(
      corrector.correct('/in.pdf', '/out.pdf', ['ko-KR'], controller.signal),
    ).rejects.toBe(abortError);
    expect(mockSpawnAsync.mock.calls[0][2]).toEqual({
      signal: controller.signal,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('still returns null for a failure while its signal is not aborted', async () => {
    mockSpawnAsync.mockRejectedValueOnce(new Error('spawn ENOENT'));

    expect(
      await corrector.correct(
        '/in.pdf',
        '/out.pdf',
        ['ko-KR'],
        new AbortController().signal,
      ),
    ).toBeNull();
  });
});
