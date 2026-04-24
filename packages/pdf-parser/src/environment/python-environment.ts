import type { LoggerMethods } from '@heripo/logger';

import { spawnAsync } from '@heripo/shared';
import { join } from 'node:path';

import {
  PythonVersionError,
  type PythonVersionInfo,
  parsePythonVersion,
  validatePythonVersion,
} from '../utils/python-version';

const DOCLING_SERVE_PACKAGE = 'docling-serve==1.16.1';

// docling-serve depends on docling-jobkit[kfp,ray,rq,vlm], which can push pip
// into resolution-too-deep failures. Install the known runtime set explicitly,
// then install docling-serve itself with --no-deps.
const DOCLING_RUNTIME_PACKAGES = [
  'docling-jobkit==1.16.0',
  'docling==2.88.0',
  'docling-core==2.73.0',
  'docling-ibm-models==3.13.0',
  'docling-parse==5.9.0',
];

const DOCLING_SERVE_RUNTIME_PACKAGES = [
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
];

export class PythonEnvironment {
  constructor(
    private readonly logger: LoggerMethods,
    private readonly venvPath: string,
  ) {}

  async setup(): Promise<void> {
    await this.checkPythonVersion();
    await this.setupPythonEnvironment();
    await this.upgradePip();
    await this.installSetuptools();
    await this.installPyArrow();
    await this.installDoclingRuntimePackages();
    await this.installDoclingServeRuntimePackages();
    await this.installDoclingServe();
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

  private async installDoclingRuntimePackages(): Promise<void> {
    const pipPath = join(this.venvPath, 'bin', 'pip');
    const result = await spawnAsync(pipPath, [
      'install',
      '--upgrade',
      ...DOCLING_RUNTIME_PACKAGES,
    ]);

    if (result.code !== 0) {
      this.logger.error(
        '[DoclingEnvironment] Failed to install docling runtime packages:',
        result.stderr,
      );
      throw new Error(
        `Failed to install docling runtime packages. Exit code: ${result.code}`,
      );
    }
  }

  private async installDoclingServe(): Promise<void> {
    const pipPath = join(this.venvPath, 'bin', 'pip');
    const result = await spawnAsync(pipPath, [
      'install',
      '--upgrade',
      '--no-deps',
      DOCLING_SERVE_PACKAGE,
    ]);

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

  private async installDoclingServeRuntimePackages(): Promise<void> {
    const pipPath = join(this.venvPath, 'bin', 'pip');
    const result = await spawnAsync(pipPath, [
      'install',
      '--upgrade',
      ...DOCLING_SERVE_RUNTIME_PACKAGES,
    ]);

    if (result.code !== 0) {
      this.logger.error(
        '[DoclingEnvironment] Failed to install docling-serve runtime packages:',
        result.stderr,
      );
      throw new Error(
        `Failed to install docling-serve runtime packages. Exit code: ${result.code}`,
      );
    }
  }
}
