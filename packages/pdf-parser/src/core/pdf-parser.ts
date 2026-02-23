import type { LoggerMethods } from '@heripo/logger';
import type { TokenUsageReport } from '@heripo/model';
import type { DoclingAPIClient } from 'docling-sdk';

import { Docling } from 'docling-sdk';
import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import { join } from 'node:path';

import { PDF_PARSER } from '../config/constants';
import { DoclingEnvironment } from '../environment/docling-environment';
import {
  type ConversionCompleteCallback,
  type PDFConvertOptions,
  PDFConverter,
} from './pdf-converter';

type Options = {
  logger: LoggerMethods;
  timeout?: number;
  venvPath?: string;
  killExistingProcess?: boolean;
  /**
   * Enable fallback to image-based PDF when conversion fails.
   * Only works with local server mode (port option).
   * Requires ImageMagick and Ghostscript to be installed.
   */
  enableImagePdfFallback?: boolean;
} & ({ port?: number } | { baseUrl: string });

/**
 * PDFParser - A PDF document parser using docling-serve
 *
 * ## System Requirements
 * Before using PDFParser, ensure your system meets these requirements:
 *
 * ### Operating System
 * - macOS 10.15 (Catalina) or later
 *
 * ### Required Software
 * - `python3` (version 3.9 - 3.12)
 *   - Python 3.13+ is NOT compatible with docling-serve
 *   - Recommended: Python 3.11 or 3.12
 *   - Install specific version: `pyenv install 3.12.0 && pyenv global 3.12.0`
 * - `jq` - JSON processor
 *   - Install: `brew install jq`
 * - `lsof` - List open files (usually pre-installed on macOS)
 *
 * ## Initialization Process
 * When `init()` is called, the following setup occurs automatically:
 *
 * ### If using external server (baseUrl provided):
 * 1. Connects to the provided baseUrl
 * 2. Waits for server health check (up to 120 seconds)
 *
 * ### If using local server (default):
 * 1. **Python Environment Setup**
 *    - Verifies Python version compatibility (3.9-3.12)
 *    - Creates Python virtual environment at `venvPath` (default: `.venv`)
 *    - Verifies virtual environment Python version
 *
 * 2. **Dependency Installation**
 *    - Upgrades pip to latest version
 *    - Installs setuptools and wheel
 *    - Installs pyarrow (binary-only to avoid compilation)
 *    - Installs docling-serve package
 *
 * 3. **Server Management**
 *    - Checks if specified port is already in use
 *    - If `killExistingProcess` is true, kills any process using the port
 *    - If port is in use and `killExistingProcess` is false, reuses existing server
 *    - Otherwise, starts new docling-serve instance on specified port
 *    - Waits for server to become ready (health check, up to 120 seconds)
 *
 * ## Notes
 * - First initialization may take several minutes due to Python package downloads
 * - Subsequent initializations are faster if virtual environment already exists
 * - The virtual environment and packages are reused across sessions
 * - Server process runs in background and needs to be managed separately if needed
 */
export class PDFParser {
  private readonly logger: LoggerMethods;
  private readonly port?: number;
  private readonly baseUrl?: string;
  private readonly timeout: number;
  private readonly venvPath: string;
  private readonly killExistingProcess: boolean;
  private readonly enableImagePdfFallback: boolean;
  private client: DoclingAPIClient | null = null;
  private environment?: DoclingEnvironment;

  constructor(options: Options) {
    const {
      logger,
      timeout = PDF_PARSER.DEFAULT_TIMEOUT_MS,
      venvPath,
      killExistingProcess = false,
      enableImagePdfFallback = false,
    } = options;

    this.logger = logger;

    if ('baseUrl' in options) {
      this.baseUrl = options.baseUrl;
      this.port = undefined;
    } else {
      this.port = options.port;
      this.baseUrl = undefined;
    }

    this.timeout = timeout;
    this.venvPath = venvPath || join(process.cwd(), '.venv');
    this.killExistingProcess = killExistingProcess;
    this.enableImagePdfFallback = enableImagePdfFallback;
  }

  async init(): Promise<void> {
    this.logger.info('[PDFParser] Initializing...');

    this.checkOperatingSystem();
    this.checkJqInstalled();
    this.checkMacOSVersion();

    // Check ImageMagick/Ghostscript only for local server mode with fallback enabled
    if (this.enableImagePdfFallback && !this.baseUrl) {
      this.checkImageMagickInstalled();
      this.checkGhostscriptInstalled();
    } else if (this.enableImagePdfFallback && this.baseUrl) {
      this.logger.warn(
        '[PDFParser] enableImagePdfFallback is ignored when using external server (baseUrl)',
      );
    }

    if (this.baseUrl) {
      this.logger.info('[PDFParser] Using external server:', this.baseUrl);
      this.client = new Docling({
        api: { baseUrl: this.baseUrl, timeout: this.timeout },
      });
      await this.waitForServerReady();
      return;
    }

    this.logger.info('[PDFParser] Setting up local server...');
    try {
      this.environment = new DoclingEnvironment({
        logger: this.logger,
        venvPath: this.venvPath,
        port: this.port as number,
        killExistingProcess: this.killExistingProcess,
      });

      await this.environment.setup();

      const clientUrl = `http://localhost:${this.port}`;
      this.client = new Docling({
        api: {
          baseUrl: clientUrl,
          timeout: this.timeout,
        },
      });

      await this.waitForServerReady();
      this.logger.info('[PDFParser] Ready');
    } catch (error) {
      this.logger.error('[PDFParser] Initialization failed:', error);
      throw new Error(`Failed to initialize PDFParser: ${error}`);
    }
  }

  private checkOperatingSystem(): void {
    if (platform() !== 'darwin') {
      throw new Error(
        'PDFParser is only supported on macOS. Current platform: ' + platform(),
      );
    }
  }

  private checkJqInstalled(): void {
    try {
      execSync('which jq', { stdio: 'ignore' });
    } catch {
      throw new Error(
        'jq is not installed. Please install jq using: brew install jq',
      );
    }
  }

  private checkMacOSVersion(): void {
    try {
      const versionOutput = execSync('sw_vers -productVersion', {
        encoding: 'utf-8',
      }).trim();
      const versionMatch = versionOutput.match(/^(\d+)\.(\d+)/);
      if (versionMatch) {
        const major = parseInt(versionMatch[1]);
        const minor = parseInt(versionMatch[2]);
        if (major < 10 || (major === 10 && minor < 15)) {
          throw new Error(
            `macOS 10.15 or later is required. Current version: ${versionOutput}`,
          );
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('macOS 10.15')) {
        throw error;
      }
      throw new Error('Failed to check macOS version');
    }
  }

  private checkImageMagickInstalled(): void {
    try {
      execSync('which magick', { stdio: 'ignore' });
    } catch {
      throw new Error(
        'ImageMagick is not installed but enableImagePdfFallback is enabled. ' +
          'Please install ImageMagick using: brew install imagemagick',
      );
    }
  }

  private checkGhostscriptInstalled(): void {
    try {
      execSync('which gs', { stdio: 'ignore' });
    } catch {
      throw new Error(
        'Ghostscript is not installed but enableImagePdfFallback is enabled. ' +
          'Please install Ghostscript using: brew install ghostscript',
      );
    }
  }

  /**
   * Check if an error is a connection refused error (ECONNREFUSED).
   * This typically indicates the Docling server has crashed.
   */
  private isConnectionRefusedError(error: unknown): boolean {
    if (error instanceof Error) {
      const errorStr = JSON.stringify(error);
      return errorStr.includes('ECONNREFUSED');
    }
    return false;
  }

  /**
   * Restart the Docling server after it has crashed.
   * This kills any existing process on the port, starts a new server,
   * and waits for it to become ready.
   *
   * Note: This method is only called when canRecover is true,
   * which guarantees this.port is defined.
   */
  private async restartServer(): Promise<void> {
    this.logger.info('[PDFParser] Restarting server...');

    // Kill existing process on port
    // Note: this.port is guaranteed to be defined by the caller (canRecover check)
    await DoclingEnvironment.killProcessOnPort(this.logger, this.port!);

    // Start new server
    const environment = new DoclingEnvironment({
      logger: this.logger,
      venvPath: this.venvPath,
      port: this.port!,
      killExistingProcess: false, // Already killed above
    });

    await environment.startServer();

    // Recreate client
    this.client?.destroy();
    this.client = new Docling({
      api: {
        baseUrl: `http://localhost:${this.port}`,
        timeout: this.timeout,
      },
    });

    await this.waitForServerReady();
    this.logger.info('[PDFParser] Server restarted successfully');
  }

  private async waitForServerReady(): Promise<void> {
    const maxAttempts = PDF_PARSER.MAX_HEALTH_CHECK_ATTEMPTS;
    const checkInterval = PDF_PARSER.HEALTH_CHECK_INTERVAL_MS;
    const logInterval = PDF_PARSER.HEALTH_CHECK_LOG_INTERVAL_MS;
    let lastLogTime = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.client!.health();
        this.logger.info('[PDFParser] Server is ready');
        return;
      } catch {
        const now = Date.now();
        if (now - lastLogTime >= logInterval) {
          this.logger.info(
            '[PDFParser] Waiting for server... (attempt',
            attempt,
            '/',
            maxAttempts,
            ')',
          );
          lastLogTime = now;
        }

        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, checkInterval));
        }
      }
    }

    throw new Error('Server failed to become ready after maximum attempts');
  }

  public async parse(
    url: string,
    reportId: string,
    onComplete: ConversionCompleteCallback,
    cleanupAfterCallback: boolean,
    options: PDFConvertOptions,
    abortSignal?: AbortSignal,
  ): Promise<TokenUsageReport | null> {
    if (!this.client) {
      throw new Error(
        'PDFParser is not initialized. Call init() before using parse()',
      );
    }

    // Check ImageMagick/Ghostscript for forceImagePdf (lazy check at parse time)
    if (options.forceImagePdf && !this.baseUrl) {
      this.checkImageMagickInstalled();
      this.checkGhostscriptInstalled();
    }

    // Auto-setup VLM dependencies if VLM pipeline is requested
    if (options.pipeline === 'vlm' && this.environment && !this.baseUrl) {
      const isApiVlm = options.vlm_api_model !== undefined;
      this.logger.info(
        `[PDFParser] VLM pipeline requested (${isApiVlm ? 'API' : 'local'}), ensuring VLM dependencies...`,
      );
      await this.environment.setupVlmDependencies();
    }

    // Enable recovery only for local server mode
    const canRecover = !this.baseUrl && this.port !== undefined;
    const maxAttempts = PDF_PARSER.MAX_SERVER_RECOVERY_ATTEMPTS;
    let attempt = 0;

    while (attempt <= maxAttempts) {
      try {
        // Enable fallback only for local server mode
        const effectiveFallbackEnabled =
          this.enableImagePdfFallback && !this.baseUrl;
        const converter = new PDFConverter(
          this.logger,
          this.client,
          effectiveFallbackEnabled,
          this.timeout,
        );
        return await converter.convert(
          url,
          reportId,
          onComplete,
          cleanupAfterCallback,
          options,
          abortSignal,
        );
      } catch (error) {
        // If aborted, don't retry - re-throw immediately
        if (abortSignal?.aborted) {
          throw error;
        }

        // Attempt server recovery on ECONNREFUSED (server crashed)
        if (
          canRecover &&
          this.isConnectionRefusedError(error) &&
          attempt < maxAttempts
        ) {
          this.logger.warn(
            '[PDFParser] Connection refused, attempting server recovery...',
          );
          await this.restartServer();
          attempt++;
          continue;
        }
        throw error;
      }
    }

    /* v8 ignore start */
    return null;
    /* v8 ignore stop */
  }

  /**
   * Dispose the parser instance.
   * - Sets the internal client to null
   * - If a local docling server was started (no baseUrl), kills the process on the configured port
   */
  public async dispose(): Promise<void> {
    this.logger.info('[PDFParser] Disposing...');

    try {
      // Only manage local server lifecycle when we started it (i.e., no external baseUrl)
      if (!this.baseUrl && this.port) {
        await DoclingEnvironment.killProcessOnPort(this.logger, this.port);
      }
    } catch (error) {
      this.logger.error('[PDFParser] Error while disposing:', error);
    } finally {
      // Always clear the client reference
      this.client?.destroy();
      this.client = null;
      this.logger.info('[PDFParser] Disposed');
    }
  }
}
