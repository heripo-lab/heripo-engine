import type { LoggerMethods } from '@heripo/logger';
import type { SpawnResult } from '@heripo/shared';
import type { ChildProcess } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { DoclingServer } from './docling-server';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('./docling-api-key', () => ({
  loadOrCreateDoclingApiKey: vi.fn(() => 'test-api-key'),
}));

vi.mock('@heripo/shared', () => ({
  spawnAsync: vi.fn(),
}));

vi.useFakeTimers();

const { spawn } = await import('node:child_process');
const mockSpawn = vi.mocked(spawn);

const { spawnAsync } = await import('@heripo/shared');
const mockSpawnAsync = vi.mocked(spawnAsync);

function createMockLogger(): LoggerMethods {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createMockProcess(): Partial<ChildProcess> {
  return {
    stdout: {
      on: vi.fn(),
    } as any,
    stderr: {
      on: vi.fn(),
    } as any,
    on: vi.fn(),
    unref: vi.fn(),
  };
}

function setupProcessMock(
  mockProcess: Partial<ChildProcess>,
  callbacks: {
    stdout?: string;
    stderr?: string;
    code?: number;
    error?: Error;
  },
): void {
  if (callbacks.stdout || callbacks.stderr) {
    const stdoutOn = mockProcess.stdout?.on as any;
    const stderrOn = mockProcess.stderr?.on as any;

    stdoutOn?.mockImplementation(
      (event: string, handler: (data: Buffer) => void) => {
        if (event === 'data' && callbacks.stdout) {
          handler(Buffer.from(callbacks.stdout));
        }
      },
    );

    stderrOn?.mockImplementation(
      (event: string, handler: (data: Buffer) => void) => {
        if (event === 'data' && callbacks.stderr) {
          handler(Buffer.from(callbacks.stderr));
        }
      },
    );
  }

  const processOn = mockProcess.on as any;
  processOn?.mockImplementation(
    (event: string, handler: (arg?: any) => void) => {
      if (event === 'close' && callbacks.code !== undefined) {
        handler(callbacks.code);
      }
      if (event === 'error' && callbacks.error) {
        handler(callbacks.error);
      }
    },
  );
}

function createSpawnResult(options: {
  stdout?: string;
  stderr?: string;
  code?: number;
}): SpawnResult {
  return {
    stdout: options.stdout ?? '',
    stderr: options.stderr ?? '',
    code: options.code ?? 0,
  };
}

describe('DoclingServer', () => {
  let logger: LoggerMethods;

  beforeEach(() => {
    logger = createMockLogger();
    mockSpawn.mockReset();
    mockSpawnAsync.mockReset();
  });

  describe('isPortInUse', () => {
    test('should return true when port is in use', async () => {
      mockSpawnAsync.mockResolvedValueOnce(
        createSpawnResult({ stdout: '12345', code: 0 }),
      );

      const server = new DoclingServer(logger, '/test/venv', 8080);
      const result = await server.isPortInUse();

      expect(result).toBe(true);
      expect(mockSpawnAsync).toHaveBeenCalledWith('lsof', ['-ti', ':8080']);
    });

    test('should return false when port is not in use', async () => {
      mockSpawnAsync.mockResolvedValueOnce(createSpawnResult({ code: 1 }));

      const server = new DoclingServer(logger, '/test/venv', 8080);
      const result = await server.isPortInUse();

      expect(result).toBe(false);
    });

    test('should return false when lsof returns no pid', async () => {
      mockSpawnAsync.mockResolvedValueOnce(
        createSpawnResult({ stdout: '', code: 0 }),
      );

      const server = new DoclingServer(logger, '/test/venv', 8080);
      const result = await server.isPortInUse();

      expect(result).toBe(false);
    });

    test('should return false when lsof has error', async () => {
      mockSpawnAsync.mockRejectedValueOnce(new Error('lsof error'));

      const server = new DoclingServer(logger, '/test/venv', 8080);
      const result = await server.isPortInUse();

      expect(result).toBe(false);
    });
  });

  describe('findListener', () => {
    test('returns the pid, uid and command of the listening process', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(
          createSpawnResult({ stdout: 'p4321\nu550\nf20\n' }),
        )
        .mockResolvedValueOnce(
          createSpawnResult({
            stdout: '/opt/python /test/venv/bin/docling-serve run\n',
          }),
        );
      const server = new DoclingServer(logger, '/test/venv', 8080);

      await expect(server.findListener()).resolves.toEqual({
        pid: 4321,
        uid: 550,
        command: '/opt/python /test/venv/bin/docling-serve run',
      });
      expect(mockSpawnAsync).toHaveBeenNthCalledWith(1, 'lsof', [
        '-nP',
        '-iTCP:8080',
        '-sTCP:LISTEN',
        '-Fpu',
      ]);
      expect(mockSpawnAsync).toHaveBeenNthCalledWith(2, 'ps', [
        '-o',
        'command=',
        '-p',
        '4321',
      ]);
    });

    test('returns null when no visible process listens', async () => {
      mockSpawnAsync.mockResolvedValueOnce(
        createSpawnResult({ stdout: '', code: 1 }),
      );
      const server = new DoclingServer(logger, '/test/venv', 8080);

      await expect(server.findListener()).resolves.toBeNull();
    });

    test('returns null when lsof fails', async () => {
      mockSpawnAsync.mockRejectedValueOnce(new Error('lsof missing'));
      const server = new DoclingServer(logger, '/test/venv', 8080);

      await expect(server.findListener()).resolves.toBeNull();
    });
  });

  describe('isOwnListener', () => {
    const uid = process.getuid?.() ?? 0;
    const server = () => new DoclingServer(logger, '/test/venv', 8080);

    test('accepts this venv docling-serve of this account', () => {
      expect(
        server().isOwnListener({
          pid: 1,
          uid,
          command: '/opt/python /test/venv/bin/docling-serve run',
        }),
      ).toBe(true);
    });

    test('rejects another account or another venv', () => {
      expect(
        server().isOwnListener({
          pid: 1,
          uid: uid + 1,
          command: '/opt/python /test/venv/bin/docling-serve run',
        }),
      ).toBe(false);
      expect(
        server().isOwnListener({
          pid: 1,
          uid,
          command: '/opt/python /other/venv/bin/docling-serve run',
        }),
      ).toBe(false);
    });
  });

  describe('assertOwnListener', () => {
    const uid = String(process.getuid?.() ?? 0);

    test('passes for this venv docling-serve', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: `p7\nu${uid}\n` }))
        .mockResolvedValueOnce(
          createSpawnResult({ stdout: '/py /test/venv/bin/docling-serve run' }),
        );

      await expect(
        new DoclingServer(logger, '/test/venv', 8080).assertOwnListener(),
      ).resolves.toBeUndefined();
    });

    test('throws when another process or nothing visible owns the port', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: `p7\nu${uid}\n` }))
        .mockResolvedValueOnce(createSpawnResult({ stdout: '/usr/bin/nc -l' }));
      await expect(
        new DoclingServer(logger, '/test/venv', 8080).assertOwnListener(),
      ).rejects.toThrow(
        "Port 8080 is not served by this venv's docling-serve (pid 7)",
      );

      mockSpawnAsync.mockResolvedValueOnce(
        createSpawnResult({ stdout: '', code: 1 }),
      );
      await expect(
        new DoclingServer(logger, '/test/venv', 8080).assertOwnListener(),
      ).rejects.toThrow(/not served by this venv's docling-serve$/);
    });
  });

  describe('enforcesApiKey', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    test('requires rejection without the key and acceptance with it', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ status: 401 })
        .mockResolvedValueOnce({ status: 404 });
      vi.stubGlobal('fetch', fetchMock);

      const server = new DoclingServer(logger, '/test/venv', 8080);

      await expect(server.enforcesApiKey()).resolves.toBe(true);
      const url = 'http://127.0.0.1:8080/v1/status/poll/heripo-api-key-check';
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        url,
        expect.not.objectContaining({ headers: expect.anything() }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        url,
        expect.objectContaining({ headers: { 'X-Api-Key': 'test-api-key' } }),
      );
    });

    test('returns false for a server that accepts requests without the key', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ status: 404 });
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        new DoclingServer(logger, '/test/venv', 8080).enforcesApiKey(),
      ).resolves.toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('returns false for a server that rejects this venv key', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401 }));

      await expect(
        new DoclingServer(logger, '/test/venv', 8080).enforcesApiKey(),
      ).resolves.toBe(false);
    });

    test('returns false when the server does not answer', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

      await expect(
        new DoclingServer(logger, '/test/venv', 8080).enforcesApiKey(),
      ).resolves.toBe(false);
    });
  });

  describe('start', () => {
    test('should start docling-serve without killing existing process', async () => {
      const doclingServeProcess = createMockProcess();
      setupProcessMock(doclingServeProcess, {});
      mockSpawn.mockReturnValueOnce(doclingServeProcess as any);

      const server = new DoclingServer(logger, '/test/venv', 8080);
      const startPromise = server.start(false);
      await vi.advanceTimersByTimeAsync(2000);
      await startPromise;

      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Starting docling-serve on port',
        8080,
      );
      expect(mockSpawn).toHaveBeenCalledWith(
        '/test/venv/bin/docling-serve',
        ['run', '--host', '127.0.0.1', '--port', '8080'],
        {
          detached: true,
          stdio: 'ignore',
          env: expect.objectContaining({
            DOCLING_SERVE_ENABLE_REMOTE_SERVICES: 'true',
            DOCLING_SERVE_API_KEY: 'test-api-key',
          }),
        },
      );
    });

    test('should kill existing process before starting when killExistingProcess is true', async () => {
      const lsofProcess = createMockProcess();
      const killProcess = createMockProcess();
      const doclingServeProcess = createMockProcess();

      setupProcessMock(lsofProcess, { stdout: '12345', code: 0 });
      setupProcessMock(killProcess, { code: 0 });
      setupProcessMock(doclingServeProcess, {});

      mockSpawn
        .mockReturnValueOnce(lsofProcess as any)
        .mockReturnValueOnce(killProcess as any)
        .mockReturnValueOnce(doclingServeProcess as any);

      const server = new DoclingServer(logger, '/test/venv', 8080);
      const startPromise = server.start(true);
      await vi.advanceTimersByTimeAsync(2000);
      await startPromise;

      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Killing process',
        '12345',
        'on port',
        8080,
      );
    });

    test('waits for the killed process to release the port before starting', async () => {
      const lsofProcess = createMockProcess();
      const killProcess = createMockProcess();
      const doclingServeProcess = createMockProcess();
      setupProcessMock(lsofProcess, { stdout: '12345', code: 0 });
      setupProcessMock(killProcess, { code: 0 });
      setupProcessMock(doclingServeProcess, {});
      mockSpawn
        .mockReturnValueOnce(lsofProcess as any)
        .mockReturnValueOnce(killProcess as any)
        .mockReturnValueOnce(doclingServeProcess as any);
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: '12345', code: 0 }))
        .mockResolvedValueOnce(createSpawnResult({ stdout: '12345', code: 0 }))
        .mockResolvedValueOnce(createSpawnResult({ stdout: '', code: 1 }));

      const server = new DoclingServer(logger, '/test/venv', 8080);
      const startPromise = server.start(true);
      // Polls at 0 ms and 200 ms still see the port in use.
      await vi.advanceTimersByTimeAsync(300);
      expect(mockSpawn).toHaveBeenCalledTimes(2);

      // Released at 400 ms, then the startup delay runs.
      await vi.advanceTimersByTimeAsync(2500);
      await startPromise;
      expect(mockSpawnAsync).toHaveBeenCalledTimes(3);
      expect(mockSpawn).toHaveBeenCalledTimes(3);
    });

    test('starts anyway when the port stays in use', async () => {
      const lsofProcess = createMockProcess();
      const doclingServeProcess = createMockProcess();
      setupProcessMock(lsofProcess, { stdout: '', code: 1 });
      setupProcessMock(doclingServeProcess, {});
      mockSpawn
        .mockReturnValueOnce(lsofProcess as any)
        .mockReturnValueOnce(doclingServeProcess as any);
      mockSpawnAsync.mockResolvedValue(
        createSpawnResult({ stdout: '999', code: 0 }),
      );

      const server = new DoclingServer(logger, '/test/venv', 8080);
      const startPromise = server.start(true);
      await vi.advanceTimersByTimeAsync(5000 + 2000);
      await startPromise;

      expect(mockSpawnAsync).toHaveBeenCalledTimes(25);
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    test('should handle docling-serve error event', async () => {
      const doclingServeProcess = createMockProcess();
      const error = new Error('Docling serve error');
      setupProcessMock(doclingServeProcess, { error });
      mockSpawn.mockReturnValueOnce(doclingServeProcess as any);

      const server = new DoclingServer(logger, '/test/venv', 8080);

      await expect(server.start(false)).rejects.toThrow('Docling serve error');
      expect(logger.error).toHaveBeenCalledWith(
        '[DoclingEnvironment] docling-serve error:',
        error,
      );
    });
  });

  describe('killProcessOnPort', () => {
    test('should kill processes on port successfully', async () => {
      const lsofProcess = createMockProcess();
      const killProcess = createMockProcess();

      setupProcessMock(lsofProcess, { stdout: '12345\n67890', code: 0 });
      setupProcessMock(killProcess, { code: 0 });

      mockSpawn
        .mockReturnValueOnce(lsofProcess as any)
        .mockReturnValueOnce(killProcess as any)
        .mockReturnValueOnce(killProcess as any);

      await DoclingServer.killProcessOnPort(logger, 8080);

      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Killing process',
        '12345, 67890',
        'on port',
        8080,
      );
    });

    test('should handle when no processes are found', async () => {
      const lsofProcess = createMockProcess();
      setupProcessMock(lsofProcess, { stdout: '', code: 1 });

      mockSpawn.mockReturnValueOnce(lsofProcess as any);

      await DoclingServer.killProcessOnPort(logger, 8080);

      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Killing process'),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    test('should handle kill process failure', async () => {
      const lsofProcess = createMockProcess();
      const killProcess = createMockProcess();

      setupProcessMock(lsofProcess, { stdout: '12345', code: 0 });
      setupProcessMock(killProcess, { code: 1 });

      mockSpawn
        .mockReturnValueOnce(lsofProcess as any)
        .mockReturnValueOnce(killProcess as any);

      await DoclingServer.killProcessOnPort(logger, 8080);

      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Failed to kill process',
        '12345',
      );
    });

    test('should handle kill process error event', async () => {
      const lsofProcess = createMockProcess();
      const killProcess = createMockProcess();
      const error = new Error('Kill failed');

      setupProcessMock(lsofProcess, { stdout: '12345', code: 0 });
      setupProcessMock(killProcess, { error });

      mockSpawn
        .mockReturnValueOnce(lsofProcess as any)
        .mockReturnValueOnce(killProcess as any);

      await DoclingServer.killProcessOnPort(logger, 8080);

      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Failed to kill process',
        error,
      );
    });

    test('should handle lsof error event', async () => {
      const lsofProcess = createMockProcess();
      setupProcessMock(lsofProcess, { error: new Error('lsof error') });

      mockSpawn.mockReturnValueOnce(lsofProcess as any);

      await DoclingServer.killProcessOnPort(logger, 8080);

      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Killing process'),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
