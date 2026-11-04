import type { LoggerMethods } from '@heripo/logger';

import { DoclingServer } from './docling-server';
import { PythonEnvironment } from './python-environment';

export class DoclingEnvironment {
  private readonly logger: LoggerMethods;
  private readonly port: number;
  private readonly pythonEnv: PythonEnvironment;
  private readonly server: DoclingServer;
  private readonly killExistingProcess: boolean;

  constructor(options: {
    logger: LoggerMethods;
    venvPath: string;
    port: number;
    killExistingProcess: boolean;
  }) {
    this.logger = options.logger;
    this.port = options.port;
    this.pythonEnv = new PythonEnvironment(options.logger, options.venvPath);
    this.server = new DoclingServer(
      options.logger,
      options.venvPath,
      options.port,
    );
    this.killExistingProcess = options.killExistingProcess;
  }

  async setup(): Promise<void> {
    this.logger.info('[DoclingEnvironment] Setting up Python environment...');

    await this.pythonEnv.setup();

    // Another account's server on the port is invisible to lsof here; the start
    // then fails to bind and assertServerOwnership() rejects it after startup.
    const listeners = await this.server.findListeners();
    if (listeners.length > 0 && !this.killExistingProcess) {
      const foreign = listeners.find((l) => !this.server.isOwnListener(l));
      if (foreign) {
        throw new Error(
          `[DoclingEnvironment] Port ${this.port} is in use by another process (pid ${foreign.pid}); not reusing or stopping it`,
        );
      }

      const enforcement = await this.server.checkApiKeyEnforcement();
      if (enforcement === 'unknown') {
        // A busy or stuck server may be running a conversion; do not stop it.
        throw new Error(
          `[DoclingEnvironment] Could not verify the API key of the server on port ${this.port}; not reusing or stopping it`,
        );
      }
      if (enforcement === 'enforced') {
        this.logger.info(
          '[DoclingEnvironment] Reusing existing server on port',
          this.port,
        );
      } else {
        this.logger.warn(
          '[DoclingEnvironment] Existing server on port',
          this.port,
          'does not enforce the API key; restarting it',
        );
        await this.server.stopOwnServer();
        await this.server.start(false);
      }
    } else {
      await this.server.start(this.killExistingProcess);
    }

    this.logger.info('[DoclingEnvironment] Setup completed');
  }

  /**
   * Start the docling-serve server without running full setup.
   * Useful for restarting the server after it has crashed.
   */
  public async startServer(): Promise<void> {
    await this.server.start(this.killExistingProcess);
  }

  /**
   * Throws unless this venv's docling-serve owns the port. The parser calls
   * this after the server is ready and before it sends the API key.
   */
  public async assertServerOwnership(): Promise<void> {
    await this.server.assertOwnListener();
  }

  /**
   * Stops this venv's docling-serve on the port. Returns false and leaves the
   * process running when another process holds the port.
   */
  public async stopOwnServer(): Promise<boolean> {
    return this.server.stopOwnServer();
  }

  public static async killProcessOnPort(
    logger: LoggerMethods,
    port: number,
  ): Promise<void> {
    return DoclingServer.killProcessOnPort(logger, port);
  }
}
