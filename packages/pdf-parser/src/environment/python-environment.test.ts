import type { LoggerMethods } from '@heripo/logger';
import type { SpawnResult } from '@heripo/shared';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { PythonEnvironment } from './python-environment';

vi.mock('@heripo/shared', () => ({
  spawnAsync: vi.fn(),
}));

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

describe('PythonEnvironment', () => {
  let logger: LoggerMethods;

  beforeEach(() => {
    logger = createMockLogger();
    mockSpawnAsync.mockReset();
  });

  describe('setup', () => {
    test('should run all setup steps in order', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' })) // checkPythonVersion
        .mockResolvedValueOnce(createSpawnResult({})) // setupPythonEnvironment
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' })) // verifyVenvPythonVersion
        .mockResolvedValueOnce(createSpawnResult({})) // upgradePip
        .mockResolvedValueOnce(createSpawnResult({})) // installSetuptools
        .mockResolvedValueOnce(createSpawnResult({})) // installPyArrow
        .mockResolvedValueOnce(createSpawnResult({})) // installDoclingRuntimePackages
        .mockResolvedValueOnce(createSpawnResult({})) // installDoclingServeRuntimePackages
        .mockResolvedValueOnce(createSpawnResult({})); // installDoclingServe

      const env = new PythonEnvironment(logger, '/test/venv');
      await env.setup();

      expect(mockSpawnAsync).toHaveBeenCalledTimes(9);
      expect(mockSpawnAsync).toHaveBeenNthCalledWith(1, 'python3', [
        '--version',
      ]);
      expect(mockSpawnAsync).toHaveBeenNthCalledWith(2, 'python3', [
        '-m',
        'venv',
        '/test/venv',
      ]);
      expect(mockSpawnAsync).toHaveBeenNthCalledWith(
        3,
        '/test/venv/bin/python',
        ['--version'],
      );
      expect(mockSpawnAsync).toHaveBeenNthCalledWith(4, '/test/venv/bin/pip', [
        'install',
        '--upgrade',
        'pip',
      ]);
      expect(mockSpawnAsync).toHaveBeenNthCalledWith(5, '/test/venv/bin/pip', [
        'install',
        '--upgrade',
        'setuptools',
        'wheel',
      ]);
      expect(mockSpawnAsync).toHaveBeenNthCalledWith(6, '/test/venv/bin/pip', [
        'install',
        '--only-binary',
        ':all:',
        'pyarrow',
      ]);
      expect(mockSpawnAsync).toHaveBeenNthCalledWith(7, '/test/venv/bin/pip', [
        'install',
        '--upgrade',
        'docling-jobkit==1.16.0',
        'docling==2.88.0',
        'docling-core==2.73.0',
        'docling-ibm-models==3.13.0',
        'docling-parse==5.9.0',
      ]);
      expect(mockSpawnAsync).toHaveBeenNthCalledWith(8, '/test/venv/bin/pip', [
        'install',
        '--upgrade',
        'fastapi[standard]<0.130.0',
        'httpx~=0.28',
        'pydantic~=2.10',
        'pydantic-settings~=2.4',
        'python-multipart<0.1.0,>=0.0.14',
        'typer~=0.12',
        'uvicorn[standard]<1.0.0,>=0.29.0',
        'websockets<17.0,>=14.0',
        'scalar-fastapi>=1.0.3',
        'docling-mcp>=1.0.0',
        'opentelemetry-api==1.36.0',
        'opentelemetry-sdk==1.36.0',
        'opentelemetry-exporter-otlp==1.36.0',
        'opentelemetry-instrumentation-fastapi==0.57b0',
        'opentelemetry-exporter-prometheus==0.57b0',
        'prometheus-client>=0.21.0',
      ]);
      expect(mockSpawnAsync).toHaveBeenNthCalledWith(9, '/test/venv/bin/pip', [
        'install',
        '--upgrade',
        '--no-deps',
        'docling-serve==1.16.1',
      ]);
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
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}));

      const env = new PythonEnvironment(logger, '/test/venv');
      await env.setup();

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
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}));

      const env = new PythonEnvironment(logger, '/test/venv');
      await env.setup();

      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Python version:',
        '3.12',
      );
    });

    test('should reject Python 3.13 or higher with specific message', async () => {
      mockSpawnAsync.mockResolvedValueOnce(
        createSpawnResult({ stdout: 'Python 3.13.0' }),
      );

      const env = new PythonEnvironment(logger, '/test/venv');

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

      const env = new PythonEnvironment(logger, '/test/venv');

      await expect(env.setup()).rejects.toThrow(
        'Python 3.9 or higher is required',
      );
    });

    test('should reject Python 2.x', async () => {
      mockSpawnAsync.mockResolvedValueOnce(
        createSpawnResult({ stdout: 'Python 2.7.0' }),
      );

      const env = new PythonEnvironment(logger, '/test/venv');

      await expect(env.setup()).rejects.toThrow(
        'Python 3.9 or higher is required',
      );
    });

    test('should handle version parsing failure', async () => {
      mockSpawnAsync.mockResolvedValueOnce(
        createSpawnResult({ stdout: 'Invalid output' }),
      );

      const env = new PythonEnvironment(logger, '/test/venv');

      await expect(env.setup()).rejects.toThrow(
        'Could not parse Python version',
      );
    });

    test('should handle python check failure with non-zero exit code', async () => {
      mockSpawnAsync.mockResolvedValueOnce(createSpawnResult({ code: 1 }));

      const env = new PythonEnvironment(logger, '/test/venv');

      await expect(env.setup()).rejects.toThrow(
        'Failed to check Python version',
      );
    });

    test('should handle python process error event', async () => {
      mockSpawnAsync.mockRejectedValueOnce(new Error('Command not found'));

      const env = new PythonEnvironment(logger, '/test/venv');

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
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}));

      const env = new PythonEnvironment(logger, '/test/venv');
      await env.setup();

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

      const env = new PythonEnvironment(logger, '/test/venv');

      await expect(env.setup()).rejects.toThrow(
        'Failed to create Python virtual environment',
      );
    });

    test('should handle venv creation process error', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockRejectedValueOnce(new Error('Venv creation failed'));

      const env = new PythonEnvironment(logger, '/test/venv');

      await expect(env.setup()).rejects.toThrow('Venv creation failed');
    });
  });

  describe('verifyVenvPythonVersion', () => {
    test('should reject venv with Python 3.13+', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.13.0' }));

      const env = new PythonEnvironment(logger, '/test/venv');

      await expect(env.setup()).rejects.toThrow(
        'Venv Python 3.13 is too new. docling-serve requires Python 3.11 or 3.12.',
      );
    });

    test('should reject venv with Python below 3.9', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.8.0' }));

      const env = new PythonEnvironment(logger, '/test/venv');

      await expect(env.setup()).rejects.toThrow(
        'Python 3.9 or higher is required',
      );
    });

    test('should handle venv version check failure', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ code: 1 }));

      const env = new PythonEnvironment(logger, '/test/venv');

      await expect(env.setup()).rejects.toThrow(
        'Failed to verify venv Python version',
      );
    });

    test('should handle venv version parsing failure', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Invalid' }));

      const env = new PythonEnvironment(logger, '/test/venv');

      await expect(env.setup()).rejects.toThrow(
        'Could not parse venv Python version',
      );
    });

    test('should handle venv version check process error', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockRejectedValueOnce(new Error('Venv check error'));

      const env = new PythonEnvironment(logger, '/test/venv');

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
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}));

      const env = new PythonEnvironment(logger, '/test/venv');
      await env.setup();

      expect(mockSpawnAsync).toHaveBeenCalledTimes(9);
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

      const env = new PythonEnvironment(logger, '/test/venv');

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

      const env = new PythonEnvironment(logger, '/test/venv');

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

      const env = new PythonEnvironment(logger, '/test/venv');

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

      const env = new PythonEnvironment(logger, '/test/venv');

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

      const env = new PythonEnvironment(logger, '/test/venv');

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

      const env = new PythonEnvironment(logger, '/test/venv');

      await expect(env.setup()).rejects.toThrow('PyArrow error');
    });
  });

  describe('installDoclingRuntimePackages', () => {
    test('should handle docling runtime package installation failure', async () => {
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

      const env = new PythonEnvironment(logger, '/test/venv');

      await expect(env.setup()).rejects.toThrow(
        'Failed to install docling runtime packages. Exit code: 1',
      );
      expect(logger.error).toHaveBeenCalledWith(
        '[DoclingEnvironment] Failed to install docling runtime packages:',
        'Docling error',
      );
    });

    test('should handle docling runtime package installation process error', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockRejectedValueOnce(new Error('Docling error'));

      const env = new PythonEnvironment(logger, '/test/venv');

      await expect(env.setup()).rejects.toThrow('Docling error');
    });
  });

  describe('installDoclingServeRuntimePackages', () => {
    test('should handle docling-serve runtime package installation failure', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(
          createSpawnResult({ stderr: 'Docling serve deps error', code: 1 }),
        );

      const env = new PythonEnvironment(logger, '/test/venv');

      await expect(env.setup()).rejects.toThrow(
        'Failed to install docling-serve runtime packages. Exit code: 1',
      );
      expect(logger.error).toHaveBeenCalledWith(
        '[DoclingEnvironment] Failed to install docling-serve runtime packages:',
        'Docling serve deps error',
      );
    });

    test('should handle docling-serve runtime package installation process error', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({ stdout: 'Python 3.11.0' }))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockRejectedValueOnce(new Error('Docling serve deps error'));

      const env = new PythonEnvironment(logger, '/test/venv');

      await expect(env.setup()).rejects.toThrow('Docling serve deps error');
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
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(
          createSpawnResult({ stderr: 'Docling serve error', code: 1 }),
        );

      const env = new PythonEnvironment(logger, '/test/venv');

      await expect(env.setup()).rejects.toThrow(
        'Failed to install docling-serve. Exit code: 1',
      );
      expect(logger.error).toHaveBeenCalledWith(
        '[DoclingEnvironment] Failed to install docling-serve:',
        'Docling serve error',
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
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockResolvedValueOnce(createSpawnResult({}))
        .mockRejectedValueOnce(new Error('Docling serve error'));

      const env = new PythonEnvironment(logger, '/test/venv');

      await expect(env.setup()).rejects.toThrow('Docling serve error');
    });
  });
});
