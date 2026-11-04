import type { LoggerMethods } from '@heripo/logger';

import { spawnAsync } from '@heripo/shared';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { DOCLING_ENVIRONMENT } from '../config/constants';
import { loadOrCreateDoclingApiKey } from './docling-api-key';

export interface DoclingListener {
  pid: number;
  uid: number;
  command: string;
}

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

  /**
   * The process listening on this port, if this account can see it. macOS
   * `lsof` run without root lists only this account's processes, so a port held
   * by another account reports no listener.
   */
  async findListener(): Promise<DoclingListener | null> {
    try {
      const lsof = await spawnAsync('lsof', [
        '-nP',
        `-iTCP:${this.port}`,
        '-sTCP:LISTEN',
        '-Fpu',
      ]);
      const pid = Number(/^p(\d+)$/m.exec(lsof.stdout)?.[1]);
      const uid = Number(/^u(\d+)$/m.exec(lsof.stdout)?.[1]);
      if (lsof.code !== 0 || !pid || Number.isNaN(uid)) {
        return null;
      }

      const ps = await spawnAsync('ps', ['-o', 'command=', '-p', String(pid)]);
      return { pid, uid, command: ps.stdout.trim() };
    } catch {
      return null;
    }
  }

  /**
   * Whether the listener is this venv's docling-serve run by this account.
   * Only such a server may receive the API key, be reused or be restarted.
   */
  isOwnListener(listener: DoclingListener): boolean {
    return (
      listener.uid === process.getuid?.() &&
      listener.command.includes(join(this.venvPath, 'bin', 'docling-serve'))
    );
  }

  /**
   * Throws unless this venv's docling-serve owns the port. Call before sending
   * the API key: after a start, another account may have held the port and the
   * health check would have reached its server instead.
   */
  async assertOwnListener(): Promise<void> {
    const listener = await this.findListener();
    if (!listener || !this.isOwnListener(listener)) {
      throw new Error(
        `[DoclingEnvironment] Port ${this.port} is not served by this venv's docling-serve` +
          (listener ? ` (pid ${listener.pid})` : ''),
      );
    }
  }

  /**
   * Whether this venv's running server enforces this venv's API key: a request
   * without the key must be rejected and one with the key accepted. A server
   * started before the key existed accepts everything and must not be reused.
   * Call only after {@link isOwnListener} confirmed the listener.
   */
  async enforcesApiKey(): Promise<boolean> {
    const url = `http://127.0.0.1:${this.port}/v1/status/poll/heripo-api-key-check`;
    try {
      const withoutKey = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });
      if (withoutKey.status !== 401) {
        return false;
      }
      const withKey = await fetch(url, {
        headers: { 'X-Api-Key': loadOrCreateDoclingApiKey(this.venvPath) },
        signal: AbortSignal.timeout(5000),
      });
      return withKey.status !== 401;
    } catch {
      return false;
    }
  }

  private async waitForPortRelease(): Promise<void> {
    for (let attempt = 0; attempt < 25; attempt++) {
      if (!(await this.isPortInUse())) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  async start(killExistingProcess: boolean): Promise<void> {
    return new Promise(async (resolve, reject) => {
      if (killExistingProcess) {
        await DoclingServer.killProcessOnPort(this.logger, this.port);
        // The killed process can hold the port for a moment; a docling-serve
        // spawned before it is released fails to bind without any error here.
        await this.waitForPortRelease();
      }

      const doclingServePath = join(this.venvPath, 'bin', 'docling-serve');
      // Bind to loopback only: the parser talks to it via localhost, and docling-serve
      // has no auth, so it must not be reachable from the LAN.
      const args = [
        'run',
        '--host',
        '127.0.0.1',
        '--port',
        this.port.toString(),
      ];

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
          DOCLING_SERVE_API_KEY: loadOrCreateDoclingApiKey(this.venvPath),
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
