import type { LoggerMethods } from '@heripo/logger';

import { spawnAsync } from '@heripo/shared';
import { spawn } from 'node:child_process';
import { arch, platform } from 'node:os';
import { join } from 'node:path';

import { DOCLING_ENVIRONMENT, VLM_ENVIRONMENT } from '../config/constants';
import {
  PythonVersionError,
  type PythonVersionInfo,
  parsePythonVersion,
  validatePythonVersion,
} from '../utils/python-version';

export class DoclingEnvironment {
  private readonly logger: LoggerMethods;
  private readonly venvPath: string;
  private readonly port: number;
  private readonly killExistingProcess: boolean;
  private vlmDependenciesInstalled = false;

  constructor(options: {
    logger: LoggerMethods;
    venvPath: string;
    port: number;
    killExistingProcess: boolean;
  }) {
    this.logger = options.logger;
    this.venvPath = options.venvPath;
    this.port = options.port;
    this.killExistingProcess = options.killExistingProcess;
  }

  async setup(): Promise<void> {
    this.logger.info('[DoclingEnvironment] Setting up Python environment...');

    await this.checkPythonVersion();
    await this.setupPythonEnvironment();
    await this.upgradePip();
    await this.installSetuptools();
    await this.installPyArrow();
    await this.installDoclingServe();

    // Check if server is already running
    const portInUse = await this.isPortInUse(this.port);

    if (portInUse && !this.killExistingProcess) {
      this.logger.info(
        '[DoclingEnvironment] Reusing existing server on port',
        this.port,
      );
    } else {
      await this.startDoclingServe();
    }

    this.logger.info('[DoclingEnvironment] Setup completed');
  }

  private async checkPythonVersion(): Promise<PythonVersionInfo> {
    const result = await spawnAsync('python3', ['--version']);

    if (result.code !== 0) {
      throw new Error('Failed to check Python version');
    }

    const output = result.stdout + result.stderr;
    const version = parsePythonVersion(output);

    if (!version) {
      throw new Error('Could not parse Python version');
    }

    this.logger.info(
      '[DoclingEnvironment] Python version:',
      version.versionString,
    );

    try {
      validatePythonVersion(version, 'system');
    } catch (error) {
      if (error instanceof PythonVersionError && version.minor >= 13) {
        this.logger.error(
          '[DoclingEnvironment] Python 3.13+ is not compatible. Install 3.11 or 3.12 with: pyenv install 3.12.0 && pyenv global 3.12.0',
        );
      }
      throw error;
    }

    return version;
  }

  private async setupPythonEnvironment(): Promise<void> {
    const result = await spawnAsync('python3', ['-m', 'venv', this.venvPath]);

    if (result.code !== 0) {
      throw new Error('Failed to create Python virtual environment');
    }

    await this.verifyVenvPythonVersion();
  }

  private async verifyVenvPythonVersion(): Promise<void> {
    const pythonPath = join(this.venvPath, 'bin', 'python');
    const result = await spawnAsync(pythonPath, ['--version']);

    if (result.code !== 0) {
      throw new Error('Failed to verify venv Python version');
    }

    const output = result.stdout + result.stderr;
    const version = parsePythonVersion(output);

    if (!version) {
      throw new Error('Could not parse venv Python version');
    }

    validatePythonVersion(version, 'venv');
  }

  private async upgradePip(): Promise<void> {
    const pipPath = join(this.venvPath, 'bin', 'pip');
    const result = await spawnAsync(pipPath, ['install', '--upgrade', 'pip']);

    if (result.code !== 0) {
      this.logger.error(
        '[DoclingEnvironment] Failed to upgrade pip:',
        result.stderr,
      );
      throw new Error(`Failed to upgrade pip. Exit code: ${result.code}`);
    }
  }

  private async installSetuptools(): Promise<void> {
    const pipPath = join(this.venvPath, 'bin', 'pip');
    const result = await spawnAsync(pipPath, [
      'install',
      '--upgrade',
      'setuptools',
      'wheel',
    ]);

    if (result.code !== 0) {
      this.logger.error(
        '[DoclingEnvironment] Failed to install setuptools:',
        result.stderr,
      );
      throw new Error(
        `Failed to install setuptools. Exit code: ${result.code}`,
      );
    }
  }

  private async installPyArrow(): Promise<void> {
    const pipPath = join(this.venvPath, 'bin', 'pip');
    const result = await spawnAsync(pipPath, [
      'install',
      '--only-binary',
      ':all:',
      'pyarrow',
    ]);

    if (result.code !== 0) {
      this.logger.error(
        '[DoclingEnvironment] Failed to install pyarrow:',
        result.stderr,
      );
      throw new Error(`Failed to install pyarrow. Exit code: ${result.code}`);
    }
  }

  private async installDoclingServe(): Promise<void> {
    const pipPath = join(this.venvPath, 'bin', 'pip');
    const result = await spawnAsync(pipPath, ['install', 'docling-serve']);

    if (result.code !== 0) {
      this.logger.error(
        '[DoclingEnvironment] Failed to install docling-serve:',
        result.stderr,
      );
      throw new Error(
        `Failed to install docling-serve. Exit code: ${result.code}`,
      );
    }
  }

  /**
   * Install VLM-specific dependencies for the Docling VLM pipeline.
   *
   * Installs:
   * 1. docling-serve[vlm] - VLM model support for docling-serve
   * 2. mlx + mlx-lm (macOS ARM64 only) - Apple Silicon optimized inference
   *
   * This is idempotent - subsequent calls skip if already installed.
   */
  async setupVlmDependencies(): Promise<void> {
    if (this.vlmDependenciesInstalled) {
      this.logger.info(
        '[DoclingEnvironment] VLM dependencies already installed, skipping',
      );
      return;
    }

    // Check if VLM modules are already importable (e.g., from a previous session)
    if (await this.isVlmReady()) {
      this.vlmDependenciesInstalled = true;
      this.logger.info(
        '[DoclingEnvironment] VLM dependencies already installed, skipping',
      );
      return;
    }

    this.logger.info('[DoclingEnvironment] Installing VLM dependencies...');

    const pipPath = join(this.venvPath, 'bin', 'pip');

    // Install docling[vlm]
    this.logger.info('[DoclingEnvironment] Installing docling[vlm]...');
    const vlmResult = await spawnAsync(
      pipPath,
      ['install', 'docling-serve[vlm]'],
      { timeout: VLM_ENVIRONMENT.SETUP_TIMEOUT_MS },
    );

    if (vlmResult.code !== 0) {
      this.logger.error(
        '[DoclingEnvironment] Failed to install docling-serve[vlm]:',
        vlmResult.stderr,
      );
      throw new Error(
        `Failed to install docling-serve[vlm]. Exit code: ${vlmResult.code}`,
      );
    }

    // Install mlx + mlx-lm for macOS ARM64 (Apple Silicon)
    if (platform() === 'darwin' && arch() === 'arm64') {
      this.logger.info(
        '[DoclingEnvironment] Installing mlx + mlx-lm for Apple Silicon...',
      );
      const mlxResult = await spawnAsync(
        pipPath,
        ['install', 'mlx', 'mlx-lm'],
        { timeout: VLM_ENVIRONMENT.SETUP_TIMEOUT_MS },
      );

      if (mlxResult.code !== 0) {
        this.logger.error(
          '[DoclingEnvironment] Failed to install mlx/mlx-lm:',
          mlxResult.stderr,
        );
        throw new Error(
          `Failed to install mlx/mlx-lm. Exit code: ${mlxResult.code}`,
        );
      }
    }

    this.vlmDependenciesInstalled = true;
    this.logger.info(
      '[DoclingEnvironment] VLM dependencies installed successfully',
    );
  }

  /**
   * Check if VLM dependencies are ready by verifying Python module imports
   */
  async isVlmReady(): Promise<boolean> {
    const pythonPath = join(this.venvPath, 'bin', 'python');
    const result = await spawnAsync(pythonPath, [
      '-c',
      'import docling_core; import docling',
    ]);
    return result.code === 0;
  }

  private async isPortInUse(port: number): Promise<boolean> {
    try {
      const result = await spawnAsync('lsof', ['-ti', `:${port}`]);
      return result.code === 0 && !!result.stdout.trim();
    } catch {
      return false;
    }
  }

  /**
   * Start the docling-serve server without running full setup.
   * Useful for restarting the server after it has crashed.
   */
  public async startServer(): Promise<void> {
    await this.startDoclingServe();
  }

  // Process-killing logic is provided as a static method to allow reuse without instantiation
  public static async killProcessOnPort(
    logger: LoggerMethods,
    port: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      const lsof = spawn('lsof', ['-ti', `:${port}`]);
      const pids: string[] = [];

      lsof.stdout?.on('data', (data) => {
        const txt: string = data.toString();
        pids.push(
          ...txt
            .split(/\s+/)
            .map((s) => s.trim())
            .filter(Boolean),
        );
      });

      lsof.on('close', () => {
        if (pids.length === 0) return resolve();

        let remaining = pids.length;
        const done = () => {
          if (--remaining <= 0) resolve();
        };

        logger.info(
          '[DoclingEnvironment] Killing process',
          pids.join(', '),
          'on port',
          port,
        );
        for (const pid of pids) {
          const killProc = spawn('kill', ['-9', pid]);

          killProc.on('close', (killCode) => {
            if (killCode !== 0) {
              logger.info('[DoclingEnvironment] Failed to kill process', pid);
            }
            done();
          });
          killProc.on('error', (Error) => {
            logger.info('[DoclingEnvironment] Failed to kill process', Error);
            done();
          });
        }
      });

      lsof.on('error', () => resolve());
    });
  }

  private async startDoclingServe(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      // Kill any existing process on the port if option is enabled
      if (this.killExistingProcess) {
        await DoclingEnvironment.killProcessOnPort(this.logger, this.port);
      }

      const venvPath = this.venvPath;
      const doclingServePath = join(venvPath, 'bin', 'docling-serve');
      const args = ['run', '--port', this.port.toString()];

      this.logger.info(
        '[DoclingEnvironment] Starting docling-serve on port',
        this.port,
      );
      const doclingProcess = spawn(doclingServePath, args, {
        detached: true, // Detached from parent process
        stdio: 'ignore', // Remove stdio pipes to prevent event loop from hanging
      });

      doclingProcess.unref(); // Parent doesn't wait for child process to exit

      doclingProcess.on('error', (error) => {
        this.logger.error('[DoclingEnvironment] docling-serve error:', error);
        reject(error);
      });

      // Give docling-serve time to start
      setTimeout(() => {
        resolve();
      }, DOCLING_ENVIRONMENT.STARTUP_DELAY_MS);
    });
  }
}
