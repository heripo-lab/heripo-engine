import type { Server } from 'node:http';

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename } from 'node:path';

/**
 * Simple local HTTP server for serving a single file
 *
 * Used to serve local PDF files to docling-serve which requires HTTP URLs.
 */
export class LocalFileServer {
  private server: Server | null = null;
  private port: number = 0;

  /**
   * Start serving a file and return the URL
   *
   * @param filePath Absolute path to the file to serve
   * @returns URL to access the file
   */
  async start(filePath: string): Promise<string> {
    const filename = basename(filePath);
    const stat = statSync(filePath);

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        if (req.url === `/${filename}`) {
          res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Length': stat.size,
          });
          createReadStream(filePath).pipe(res);
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });

      this.server.on('error', reject);

      // Listen on random available port
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        if (typeof address === 'object' && address !== null) {
          this.port = address.port;
          resolve(`http://127.0.0.1:${this.port}/${filename}`);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
    });
  }

  /**
   * Stop the server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          this.port = 0;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
