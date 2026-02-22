import type { LoggerMethods } from '@heripo/logger';
import type { SpawnResult } from '@heripo/shared';
import type { ChildProcess } from 'node:child_process';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { DoclingEnvironment } from './docling-environment';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('@heripo/shared', () => ({
  spawnAsync: vi.fn(),
}));

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const origPlatform = original.platform as () => string;
  const origArch = original.arch as () => string;
  return {
    ...original,
    platform: vi.fn(() => origPlatform()),
    arch: vi.fn(() => origArch()),
  };
});

vi.useFakeTimers();

const { spawn } = await import('node:child_process');
const mockSpawn = vi.mocked(spawn);

const { spawnAsync } = await import('@heripo/shared');
const mockSpawnAsync = vi.mocked(spawnAsync);

const { platform: mockPlatform, arch: mockArch } = await import('node:os');
const mockPlatformFn = vi.mocked(mockPlatform);
const mockArchFn = vi.mocked(mockArch);

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

/**
 * Helper to create spawnAsync mock result
 */
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

describe('DoclingEnvironment', () => {
  let logger: LoggerMethods;

  beforeEach(() => {
    logger = createMockLogger();
    mockSpawn.mockReset();
    mockSpawnAsync.mockReset();
  });

  describe('constructor', () => {
    test('should store all options', () => {
      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      expect(env).toBeDefined();
    });
  });

  describe('setup', () => {
    test('should complete full setup when port is not in use', async () => {
      // spawnAsync mocks (checkPythonVersion, setupPythonEnvironment, verifyVenvPythonVersion, upgradePip, installSetuptools, installPyArrow, installDoclingServe, isPortInUse)
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' })) // checkPythonVersion
        .mockResolvedValueOnce(createSpawnResult({})) // setupPythonEnvironment
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' })) // verifyVenvPythonVersion
        .mockResolvedValueOnce(createSpawnResult({})) // upgradePip
        .mockResolvedValueOnce(createSpawnResult({})) // installSetuptools
        .mockResolvedValueOnce(createSpawnResult({})) // installPyArrow
        .mockResolvedValueOnce(createSpawnResult({})) // installDoclingServe
        .mockResolvedValueOnce(createSpawnResult({ code: 1 })); // isPortInUse (port not in use)

      // spawn mock for startDoclingServe
      const doclingServeProcess = createMockProcess();
      setupProcessMock(doclingServeProcess, {});
      mockSpawn.mockReturnValueOnce(doclingServeProcess as any);

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      const setupPromise = env.setup();
      await vi.advanceTimersByTimeAsync(2000);
      await setupPromise;

      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Setting up Python environment...',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Setup completed',
      );
    });

    test('should reuse existing server when port is in use and killExistingProcess is false', async () => {
      // spawnAsync mocks
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' })) // checkPythonVersion
        .mockResolvedValueOnce(createSpawnResult({})) // setupPythonEnvironment
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' })) // verifyVenvPythonVersion
        .mockResolvedValueOnce(createSpawnResult({})) // upgradePip
        .mockResolvedValueOnce(createSpawnResult({})) // installSetuptools
        .mockResolvedValueOnce(createSpawnResult({})) // installPyArrow
        .mockResolvedValueOnce(createSpawnResult({})) // installDoclingServe
        .mockResolvedValueOnce(createSpawnResult({ stdout: '12345', code: 0 })); // isPortInUse (port in use)

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await env.setup();

      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Reusing existing server on port',
        8080,
      );
    });

    test('should kill existing process and start new server when killExistingProcess is true', async () => {
      // spawnAsync mocks
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' })) // checkPythonVersion
        .mockResolvedValueOnce(createSpawnResult({})) // setupPythonEnvironment
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' })) // verifyVenvPythonVersion
        .mockResolvedValueOnce(createSpawnResult({})) // upgradePip
        .mockResolvedValueOnce(createSpawnResult({})) // installSetuptools
        .mockResolvedValueOnce(createSpawnResult({})) // installPyArrow
        .mockResolvedValueOnce(createSpawnResult({})) // installDoclingServe
        .mockResolvedValueOnce(createSpawnResult({ stdout: '12345', code: 0 })); // isPortInUse (port in use)

      // spawn mocks for killProcessOnPort and startDoclingServe
      const lsofKillProcess = createMockProcess();
      const killProcess = createMockProcess();
      const doclingServeProcess = createMockProcess();

      setupProcessMock(lsofKillProcess, { stdout: '12345', code: 0 });
      setupProcessMock(killProcess, { code: 0 });
      setupProcessMock(doclingServeProcess, {});

      mockSpawn
        .mockReturnValueOnce(lsofKillProcess as any)
        .mockReturnValueOnce(killProcess as any)
        .mockReturnValueOnce(doclingServeProcess as any);

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: true,
      });

      const setupPromise = env.setup();
      await vi.advanceTimersByTimeAsync(2000);
      await setupPromise;

      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Killing process',
        '12345',
        'on port',
        8080,
      );
    });
  });

  describe('checkPythonVersion', () => {
    test('should accept Python 3.9', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.9.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.9.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ code: 1 }));

      const doclingServeProcess = createMockProcess();
      setupProcessMock(doclingServeProcess, {});
      mockSpawn.mockReturnValueOnce(doclingServeProcess as any);

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      const setupPromise = env.setup();
      await vi.advanceTimersByTimeAsync(2000);
      await setupPromise;

      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Python version:',
        '3.9',
      );
    });

    test('should accept Python 3.12', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.12.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.12.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ code: 1 }));

      const doclingServeProcess = createMockProcess();
      setupProcessMock(doclingServeProcess, {});
      mockSpawn.mockReturnValueOnce(doclingServeProcess as any);

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      const setupPromise = env.setup();
      await vi.advanceTimersByTimeAsync(2000);
      await setupPromise;

      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Python version:',
        '3.12',
      );
    });

    test('should reject Python 3.13 or higher', async () => {
      mockSpawnAsync.mockResolvedValueOnce(
        createSpawnResult({ stdout: 'Python 3.13.0' }),
      );

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow(
        'Python 3.13 is too new. docling-serve requires Python 3.11 or 3.12.',
      );

      expect(logger.error).toHaveBeenCalledWith(
        '[DoclingEnvironment] Python 3.13+ is not compatible. Install 3.11 or 3.12 with: pyenv install 3.12.0 && pyenv global 3.12.0',
      );
    });

    test('should reject Python versions below 3.9', async () => {
      mockSpawnAsync.mockResolvedValueOnce(
        createSpawnResult({ stdout: 'Python 3.8.0' }),
      );

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow(
        'Python 3.9 or higher is required',
      );
    });

    test('should reject Python 2.x', async () => {
      mockSpawnAsync.mockResolvedValueOnce(
        createSpawnResult({ stdout: 'Python 2.7.0' }),
      );

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow(
        'Python 3.9 or higher is required',
      );
    });

    test('should handle version parsing failure', async () => {
      mockSpawnAsync.mockResolvedValueOnce(
        createSpawnResult({ stdout: 'Invalid output' }),
      );

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow(
        'Could not parse Python version',
      );
    });

    test('should handle python check failure with non-zero exit code', async () => {
      mockSpawnAsync.mockResolvedValueOnce(createSpawnResult({ code: 1 }));

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow(
        'Failed to check Python version',
      );
    });

    test('should handle python process error event', async () => {
      mockSpawnAsync.mockRejectedValueOnce(new Error('Command not found'));

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow('Command not found');
    });

    test('should read version from stderr if needed', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stderr: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ code: 1 }));

      const doclingServeProcess = createMockProcess();
      setupProcessMock(doclingServeProcess, {});
      mockSpawn.mockReturnValueOnce(doclingServeProcess as any);

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      const setupPromise = env.setup();
      await vi.advanceTimersByTimeAsync(2000);
      await setupPromise;

      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Python version:',
        '3.11',
      );
    });
  });

  describe('setupPythonEnvironment', () => {
    test('should handle venv creation failure', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({ code: 1 }));

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow(
        'Failed to create Python virtual environment',
      );
    });

    test('should handle venv creation process error', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockRejectedValueOnce(new Error('Venv creation failed'));

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow('Venv creation failed');
    });
  });

  describe('verifyVenvPythonVersion', () => {
    test('should reject venv with Python 3.13+', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.13.0' }));

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow(
        'Venv Python 3.13 is too new. docling-serve requires Python 3.11 or 3.12.',
      );
    });

    test('should reject venv with Python below 3.9', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.8.0' }));

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow(
        'Python 3.9 or higher is required',
      );
    });

    test('should handle venv version check failure', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ code: 1 }));

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow(
        'Failed to verify venv Python version',
      );
    });

    test('should handle venv version parsing failure', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Invalid' }));

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow(
        'Could not parse venv Python version',
      );
    });

    test('should handle venv version check process error', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockRejectedValueOnce(new Error('Venv check error'));

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow('Venv check error');
    });

    test('should read venv version from stderr', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stderr: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ code: 1 }));

      const doclingServeProcess = createMockProcess();
      setupProcessMock(doclingServeProcess, {});
      mockSpawn.mockReturnValueOnce(doclingServeProcess as any);

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      const setupPromise = env.setup();
      await vi.advanceTimersByTimeAsync(2000);
      await setupPromise;

      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Setup completed',
      );
    });
  });

  describe('upgradePip', () => {
    test('should handle pip upgrade failure', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(
          createSpawnResult({ stderr: 'Pip upgrade error', code: 1 }),
        );

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow(
        'Failed to upgrade pip. Exit code: 1',
      );
      expect(logger.error).toHaveBeenCalledWith(
        '[DoclingEnvironment] Failed to upgrade pip:',
        'Pip upgrade error',
      );
    });

    test('should handle pip upgrade process error', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockRejectedValueOnce(new Error('Pip error'));

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow('Pip error');
    });
  });

  describe('installSetuptools', () => {
    test('should handle setuptools installation failure', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(
          createSpawnResult({ stderr: 'Setuptools error', code: 1 }),
        );

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow(
        'Failed to install setuptools. Exit code: 1',
      );
      expect(logger.error).toHaveBeenCalledWith(
        '[DoclingEnvironment] Failed to install setuptools:',
        'Setuptools error',
      );
    });

    test('should handle setuptools installation process error', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockRejectedValueOnce(new Error('Setuptools error'));

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow('Setuptools error');
    });
  });

  describe('installPyArrow', () => {
    test('should handle pyarrow installation failure', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(
          createSpawnResult({ stderr: 'PyArrow error', code: 1 }),
        );

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow(
        'Failed to install pyarrow. Exit code: 1',
      );
      expect(logger.error).toHaveBeenCalledWith(
        '[DoclingEnvironment] Failed to install pyarrow:',
        'PyArrow error',
      );
    });

    test('should handle pyarrow installation process error', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockRejectedValueOnce(new Error('PyArrow error'));

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow('PyArrow error');
    });
  });

  describe('installDoclingServe', () => {
    test('should handle docling-serve installation failure', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(
          createSpawnResult({ stderr: 'Docling error', code: 1 }),
        );

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow(
        'Failed to install docling-serve. Exit code: 1',
      );
      expect(logger.error).toHaveBeenCalledWith(
        '[DoclingEnvironment] Failed to install docling-serve:',
        'Docling error',
      );
    });

    test('should handle docling-serve installation process error', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockRejectedValueOnce(new Error('Docling error'));

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow('Docling error');
    });
  });

  describe('isPortInUse', () => {
    test('should return false when port is not in use', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ code: 1 }));

      const doclingServeProcess = createMockProcess();
      setupProcessMock(doclingServeProcess, {});
      mockSpawn.mockReturnValueOnce(doclingServeProcess as any);

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      const setupPromise = env.setup();
      await vi.advanceTimersByTimeAsync(2000);
      await setupPromise;

      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Starting docling-serve on port',
        8080,
      );
    });

    test('should return false when lsof returns no pid', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: '', code: 0 }));

      const doclingServeProcess = createMockProcess();
      setupProcessMock(doclingServeProcess, {});
      mockSpawn.mockReturnValueOnce(doclingServeProcess as any);

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      const setupPromise = env.setup();
      await vi.advanceTimersByTimeAsync(2000);
      await setupPromise;

      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Starting docling-serve on port',
        8080,
      );
    });

    test('should return false when lsof has error', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockRejectedValueOnce(new Error('lsof error'));

      const doclingServeProcess = createMockProcess();
      setupProcessMock(doclingServeProcess, {});
      mockSpawn.mockReturnValueOnce(doclingServeProcess as any);

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      const setupPromise = env.setup();
      await vi.advanceTimersByTimeAsync(2000);
      await setupPromise;

      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Starting docling-serve on port',
        8080,
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

      await DoclingEnvironment.killProcessOnPort(logger, 8080);

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

      await DoclingEnvironment.killProcessOnPort(logger, 8080);

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

      await DoclingEnvironment.killProcessOnPort(logger, 8080);

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

      await DoclingEnvironment.killProcessOnPort(logger, 8080);

      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Failed to kill process',
        error,
      );
    });

    test('should handle lsof error event', async () => {
      const lsofProcess = createMockProcess();
      setupProcessMock(lsofProcess, { error: new Error('lsof error') });

      mockSpawn.mockReturnValueOnce(lsofProcess as any);

      await DoclingEnvironment.killProcessOnPort(logger, 8080);

      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Killing process'),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('startDoclingServe', () => {
    test('should handle docling-serve error event', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ code: 1 }));

      const doclingServeProcess = createMockProcess();
      const error = new Error('Docling serve error');
      setupProcessMock(doclingServeProcess, { error });
      mockSpawn.mockReturnValueOnce(doclingServeProcess as any);

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow('Docling serve error');
      expect(logger.error).toHaveBeenCalledWith(
        '[DoclingEnvironment] docling-serve error:',
        error,
      );
    });
  });

  describe('startServer', () => {
    test('should start docling-serve without full setup', async () => {
      const doclingServeProcess = createMockProcess();
      setupProcessMock(doclingServeProcess, {});
      mockSpawn.mockReturnValueOnce(doclingServeProcess as any);

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      const startPromise = env.startServer();
      await vi.advanceTimersByTimeAsync(2000);
      await startPromise;

      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Starting docling-serve on port',
        8080,
      );
      expect(mockSpawn).toHaveBeenCalledWith(
        '/test/venv/bin/docling-serve',
        ['run', '--port', '8080'],
        { detached: true, stdio: 'ignore' },
      );
    });

    test('should handle error during startServer', async () => {
      const doclingServeProcess = createMockProcess();
      const error = new Error('Server start failed');
      setupProcessMock(doclingServeProcess, { error });
      mockSpawn.mockReturnValueOnce(doclingServeProcess as any);

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.startServer()).rejects.toThrow('Server start failed');
      expect(logger.error).toHaveBeenCalledWith(
        '[DoclingEnvironment] docling-serve error:',
        error,
      );
    });
  });

  describe('setupVlmDependencies', () => {
    test('should install docling-serve[vlm] and mlx on macOS ARM64', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({})) // docling-serve[vlm]
        .mockResolvedValueOnce(createSpawnResult({})); // mlx + mlx-lm

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await env.setupVlmDependencies();

      expect(mockSpawnAsync).toHaveBeenCalledWith(
        '/test/venv/bin/pip',
        ['install', 'docling-serve[vlm]'],
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] VLM dependencies installed successfully',
      );
    });

    test('should skip if already installed (idempotent)', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({})) // docling-serve[vlm]
        .mockResolvedValueOnce(createSpawnResult({})); // mlx + mlx-lm

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await env.setupVlmDependencies();
      mockSpawnAsync.mockClear();

      // Second call should skip
      await env.setupVlmDependencies();

      expect(mockSpawnAsync).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] VLM dependencies already installed, skipping',
      );
    });

    test('should throw on docling-serve[vlm] installation failure', async () => {
      mockSpawnAsync.mockResolvedValueOnce(
        createSpawnResult({ stderr: 'VLM install error', code: 1 }),
      );

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setupVlmDependencies()).rejects.toThrow(
        'Failed to install docling-serve[vlm]. Exit code: 1',
      );
      expect(logger.error).toHaveBeenCalledWith(
        '[DoclingEnvironment] Failed to install docling-serve[vlm]:',
        'VLM install error',
      );
    });

    test('should skip mlx installation on non-ARM64 platform', async () => {
      mockPlatformFn.mockReturnValue('linux');
      mockArchFn.mockReturnValue('x64');

      mockSpawnAsync.mockResolvedValueOnce(createSpawnResult({})); // docling-serve[vlm] only

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await env.setupVlmDependencies();

      // Only 1 call (docling-serve[vlm]), no mlx install
      expect(mockSpawnAsync).toHaveBeenCalledTimes(1);
      expect(mockSpawnAsync).toHaveBeenCalledWith(
        '/test/venv/bin/pip',
        ['install', 'docling-serve[vlm]'],
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] VLM dependencies installed successfully',
      );

      mockPlatformFn.mockRestore();
      mockArchFn.mockRestore();
    });

    test('should throw on mlx installation failure', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({})) // docling-serve[vlm] success
        .mockResolvedValueOnce(
          createSpawnResult({ stderr: 'mlx error', code: 1 }),
        ); // mlx failure

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.setupVlmDependencies()).rejects.toThrow(
        'Failed to install mlx/mlx-lm. Exit code: 1',
      );
      expect(logger.error).toHaveBeenCalledWith(
        '[DoclingEnvironment] Failed to install mlx/mlx-lm:',
        'mlx error',
      );
    });
  });

  describe('isVlmReady', () => {
    test('should return true when Python modules import successfully', async () => {
      mockSpawnAsync.mockResolvedValueOnce(createSpawnResult({ code: 0 }));

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      const result = await env.isVlmReady();

      expect(result).toBe(true);
      expect(mockSpawnAsync).toHaveBeenCalledWith('/test/venv/bin/python', [
        '-c',
        'import docling_core; import docling',
      ]);
    });

    test('should return false when Python modules are not available', async () => {
      mockSpawnAsync.mockResolvedValueOnce(createSpawnResult({ code: 1 }));

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      const result = await env.isVlmReady();

      expect(result).toBe(false);
    });
  });
});
