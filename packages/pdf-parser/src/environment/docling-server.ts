import type { LoggerMethods } from '@heripo/logger';

import { spawnAsync } from '@heripo/shared';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { DOCLING_ENVIRONMENT } from '../config/constants';
import { loadOrCreateDoclingApiKey } from './docling-api-key';

/**
 * `lsof` arguments that list only processes LISTENing on the TCP port. A plain
 * `lsof -ti :port` also lists clients connected to it, such as this process.
 */
function listenPidArgs(port: number): string[] {
  return ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'];
}

export type ApiKeyEnforcement = 'enforced' | 'not-enforced' | 'unknown';

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
      const result = await spawnAsync('lsof', listenPidArgs(this.port));
      return result.code === 0 && !!result.stdout.trim();
    } catch {
      return false;
    }
  }

  /**
   * The processes listening on this port that this account can see. macOS
   * `lsof` run without root lists only this account's processes, so a port held
   * by another account reports none. IPv4 and IPv6 listeners on the same port
   * are separate entries.
   */
  async findListeners(): Promise<DoclingListener[]> {
    try {
      const lsof = await spawnAsync('lsof', [
        '-nP',
        `-iTCP:${this.port}`,
        '-sTCP:LISTEN',
        '-Fpu',
      ]);
      if (lsof.code !== 0) {
        return [];
      }

      const entries: Array<{ pid: number; uid: number }> = [];
      for (const line of lsof.stdout.split('\n')) {
        if (line.startsWith('p')) {
          entries.push({ pid: Number(line.slice(1)), uid: Number.NaN });
        } else if (line.startsWith('u') && entries.length > 0) {
          entries[entries.length - 1].uid = Number(line.slice(1));
        }
      }

      const listeners: DoclingListener[] = [];
      for (const { pid, uid } of entries) {
        if (!pid || Number.isNaN(uid)) continue;
        const ps = await spawnAsync('ps', [
          '-o',
          'command=',
          '-p',
          String(pid),
        ]);
        listeners.push({ pid, uid, command: ps.stdout.trim() });
      }
      return listeners;
    } catch {
      return [];
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
   * Throws unless this venv's docling-serve is the only visible listener on
   * the port. Call before sending the API key: after a start, another account
   * may have held the port and the health check would have reached its server.
   */
  async assertOwnListener(): Promise<void> {
    const listeners = await this.findListeners();
    const foreign = listeners.find((l) => !this.isOwnListener(l));
    if (listeners.length === 0 || foreign) {
      throw new Error(
        `[DoclingEnvironment] Port ${this.port} is not served by this venv's docling-serve` +
          (foreign ? ` (pid ${foreign.pid})` : ''),
      );
    }
  }

  /**
   * Whether this venv's running server enforces this venv's API key: a request
   * without the key must be rejected and one with the key accepted. A server
   * started before the key existed accepts everything and must not be reused.
   * `unknown` means it did not answer, so nothing can be concluded.
   * Call only after {@link isOwnListener} confirmed the listeners.
   */
  async checkApiKeyEnforcement(): Promise<ApiKeyEnforcement> {
    const url = `http://127.0.0.1:${this.port}/v1/status/poll/heripo-api-key-check`;
    try {
      const withoutKey = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });
      if (withoutKey.status !== 401) {
        return 'not-enforced';
      }
      const withKey = await fetch(url, {
        headers: { 'X-Api-Key': loadOrCreateDoclingApiKey(this.venvPath) },
        signal: AbortSignal.timeout(5000),
      });
      return withKey.status === 401 ? 'not-enforced' : 'enforced';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Waits until no process listens on the port. Throws if it stays in use, so
   * a failed stop is never mistaken for a restart: the new docling-serve would
   * fail to bind and the old server would keep answering.
   */
  private async waitForPortRelease(): Promise<void> {
    for (let attempt = 0; attempt < 25; attempt++) {
      if (!(await this.isPortInUse())) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(
      `[DoclingEnvironment] Port ${this.port} is still in use after stopping its server`,
    );
  }

  /**
   * Stops this venv's docling-serve on the port, killing only the listener
   * PIDs that were checked. Returns false and leaves every process running when
   * any visible listener on the port belongs to another process.
   */
  async stopOwnServer(): Promise<boolean> {
    const listeners = await this.findListeners();
    if (listeners.length === 0) {
      return true;
    }
    if (listeners.some((l) => !this.isOwnListener(l))) {
      return false;
    }

    const pids = listeners
      .map((l) => String(l.pid))
      .filter((pid) => pid !== String(process.pid));
    this.logger.info(
      '[DoclingEnvironment] Stopping docling-serve',
      pids.join(', '),
      'on port',
      this.port,
    );
    for (const pid of pids) {
      await spawnAsync('kill', ['-9', pid]).catch(() => undefined);
    }
    await this.waitForPortRelease();
    return true;
  }

  async start(killExistingProcess: boolean): Promise<void> {
    if (killExistingProcess) {
      await DoclingServer.killProcessOnPort(this.logger, this.port);
      // The killed process can hold the port for a moment; a docling-serve
      // spawned before it is released fails to bind without any error here.
      await this.waitForPortRelease();
    }

    // Read before the Promise so a key file error rejects start().
    const apiKey = loadOrCreateDoclingApiKey(this.venvPath);

    return new Promise((resolve, reject) => {
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
          DOCLING_SERVE_API_KEY: apiKey,
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
      const lsof = spawn('lsof', listenPidArgs(port));
      const found: string[] = [];

      lsof.stdout?.on('data', (data) => {
        const txt: string = data.toString();
        found.push(
          ...txt
            .split(/\s+/)
            .map((s) => s.trim())
            .filter(Boolean),
        );
      });

      lsof.on('close', () => {
        // Never the current process, which may hold a client connection.
        const pids = [...new Set(found)].filter(
          (pid) => pid !== String(process.pid),
        );
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
