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

    const portInUse = await this.server.isPortInUse();
    if (portInUse && !this.killExistingProcess) {
      this.logger.info(
        '[DoclingEnvironment] Reusing existing server on port',
        this.port,
      );
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

  public static async killProcessOnPort(
    logger: LoggerMethods,
    port: number,
  ): Promise<void> {
    return DoclingServer.killProcessOnPort(logger, port);
  }
}
