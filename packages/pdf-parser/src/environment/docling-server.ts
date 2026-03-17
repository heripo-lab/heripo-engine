import type { LoggerMethods } from '@heripo/logger';

import { spawnAsync } from '@heripo/shared';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { DOCLING_ENVIRONMENT } from '../config/constants';

export class DoclingServer {
  constructor(
    private readonly logger: LoggerMethods,
    private readonly venvPath: string,
    private readonly port: number,
  ) {}

  async isPortInUse(): Promise<boolean> {
    try {
      const result = await spawnAsync('lsof', ['-ti', `:${this.port}`]);
      return result.code === 0 && !!result.stdout.trim();
    } catch {
      return false;
    }
  }

  async start(killExistingProcess: boolean): Promise<void> {
    return new Promise(async (resolve, reject) => {
      if (killExistingProcess) {
        await DoclingServer.killProcessOnPort(this.logger, this.port);
      }

      const doclingServePath = join(this.venvPath, 'bin', 'docling-serve');
      const args = ['run', '--port', this.port.toString()];

      this.logger.info(
        '[DoclingEnvironment] Starting docling-serve on port',
        this.port,
      );
      const doclingProcess = spawn(doclingServePath, args, {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          DOCLING_SERVE_ENABLE_REMOTE_SERVICES: 'true',
        },
      });

      doclingProcess.unref();

      doclingProcess.on('error', (error) => {
        this.logger.error('[DoclingEnvironment] docling-serve error:', error);
        reject(error);
      });

      setTimeout(() => {
        resolve();
      }, DOCLING_ENVIRONMENT.STARTUP_DELAY_MS);
    });
  }

  static async killProcessOnPort(
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
}
