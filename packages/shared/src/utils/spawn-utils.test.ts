import type { ChildProcess } from 'node:child_process';

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { spawnAsync } from './spawn-utils';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

const spawnMock = vi.mocked(spawn);

function createMockProcess(options?: {
  hasStdout?: boolean;
  hasStderr?: boolean;
}): ChildProcess {
  const emitter = new EventEmitter();
  const proc = emitter as unknown as ChildProcess;

  if (options?.hasStdout !== false) {
    proc.stdout = new Readable({ read() {} }) as ChildProcess['stdout'];
  } else {
    proc.stdout = null;
  }

  if (options?.hasStderr !== false) {
    proc.stderr = new Readable({ read() {} }) as ChildProcess['stderr'];
  } else {
    proc.stderr = null;
  }

  return proc;
}

describe('spawnAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should execute command and capture stdout/stderr', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const promise = spawnAsync('echo', ['hello']);

    proc.stdout!.emit('data', Buffer.from('hello'));
    proc.stderr!.emit('data', Buffer.from('warning'));
    proc.emit('close', 0);

    const result = await promise;

    expect(spawnMock).toHaveBeenCalledWith('echo', ['hello'], {});
    expect(result).toEqual({
      stdout: 'hello',
      stderr: 'warning',
      code: 0,
    });
  });

  test('should pass spawn options to child_process.spawn', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const promise = spawnAsync('python', ['script.py'], {
      cwd: '/custom/path',
      env: { PATH: '/usr/bin' },
    });

    proc.emit('close', 0);

    await promise;

    expect(spawnMock).toHaveBeenCalledWith('python', ['script.py'], {
      cwd: '/custom/path',
      env: { PATH: '/usr/bin' },
    });
  });

  test('should not capture stdout when captureStdout is false', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const promise = spawnAsync('cmd', [], { captureStdout: false });

    proc.stdout!.emit('data', Buffer.from('ignored'));
    proc.emit('close', 0);

    const result = await promise;

    expect(result.stdout).toBe('');
  });

  test('should not capture stderr when captureStderr is false', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const promise = spawnAsync('cmd', [], { captureStderr: false });

    proc.stderr!.emit('data', Buffer.from('ignored'));
    proc.emit('close', 0);

    const result = await promise;

    expect(result.stderr).toBe('');
  });

  test('should handle process without stdout stream', async () => {
    const proc = createMockProcess({ hasStdout: false });
    spawnMock.mockReturnValue(proc);

    const promise = spawnAsync('cmd', []);

    proc.emit('close', 0);

    const result = await promise;

    expect(result.stdout).toBe('');
  });

  test('should handle process without stderr stream', async () => {
    const proc = createMockProcess({ hasStderr: false });
    spawnMock.mockReturnValue(proc);

    const promise = spawnAsync('cmd', []);

    proc.emit('close', 0);

    const result = await promise;

    expect(result.stderr).toBe('');
  });

  test('should return 0 when exit code is null', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const promise = spawnAsync('cmd', []);

    proc.emit('close', null);

    const result = await promise;

    expect(result.code).toBe(0);
  });

  test('should return non-zero exit code', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const promise = spawnAsync('cmd', []);

    proc.emit('close', 1);

    const result = await promise;

    expect(result.code).toBe(1);
  });

  test('should reject on process error', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const promise = spawnAsync('nonexistent', []);

    const error = new Error('ENOENT: command not found');
    proc.emit('error', error);

    await expect(promise).rejects.toThrow('ENOENT: command not found');
  });

  test('should accumulate multiple data chunks', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const promise = spawnAsync('cmd', []);

    proc.stdout!.emit('data', Buffer.from('chunk1'));
    proc.stdout!.emit('data', Buffer.from('chunk2'));
    proc.stderr!.emit('data', Buffer.from('err1'));
    proc.stderr!.emit('data', Buffer.from('err2'));
    proc.emit('close', 0);

    const result = await promise;

    expect(result.stdout).toBe('chunk1chunk2');
    expect(result.stderr).toBe('err1err2');
  });
});
