import type { LoggerMethods } from '@heripo/logger';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

import {
  createProxyMiddleware,
  responseInterceptor,
} from 'http-proxy-middleware';
import { createServer } from 'node:http';

/**
 * Accumulated token usage from VLM API proxy
 */
export interface AccumulatedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number;
}

/**
 * Proxy server that intercepts VLM API calls to capture token usage.
 *
 * Uses `http-proxy-middleware` to forward requests to the actual VLM API
 * endpoint, capturing usage data from API responses via `responseInterceptor`.
 *
 * The library handles header forwarding, encoding, keep-alive, and streaming
 * automatically. No per-request timeout is applied — the overall conversion
 * timeout is managed by PDFConverter, and the upstream VLM API has its own
 * server-side timeout.
 */
export class VlmProxyServer {
  private server: Server | null = null;
  private usage: AccumulatedTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    requestCount: 0,
  };

  constructor(
    private readonly logger: LoggerMethods,
    private readonly targetUrl: string,
    private readonly targetAuthHeader: string,
  ) {}

  /**
   * Start the proxy server on a random available port.
   * @returns The proxy URL (e.g., `http://127.0.0.1:{port}/v1/chat/completions`)
   */
  async start(): Promise<string> {
    // Extract the base URL (e.g., "http://api.example.com") from the full target URL
    const url = new URL(this.targetUrl);
    const target = `${url.protocol}//${url.host}`;

    const proxyMiddleware = createProxyMiddleware({
      target,
      changeOrigin: true,
      selfHandleResponse: true,
      on: {
        proxyReq: (proxyReq) => {
          if (this.targetAuthHeader) {
            proxyReq.setHeader('Authorization', this.targetAuthHeader);
          }
        },
        proxyRes: responseInterceptor(
          async (responseBuffer, _proxyRes, _req, _res) => {
            try {
              const json = JSON.parse(responseBuffer.toString('utf8'));
              if (json.usage) {
                const input =
                  json.usage.input_tokens ?? json.usage.prompt_tokens ?? 0;
                const output =
                  json.usage.output_tokens ?? json.usage.completion_tokens ?? 0;
                const total = json.usage.total_tokens ?? 0;
                this.usage.inputTokens += input;
                this.usage.outputTokens += output;
                this.usage.totalTokens += total;
                this.logger.info(
                  `[VlmProxyServer] Token usage: input=${input}, output=${output} (accumulated: input=${this.usage.inputTokens}, output=${this.usage.outputTokens})`,
                );
              }
              this.usage.requestCount++;
            } catch {
              // Response is not JSON or has no usage — still count the request
              this.usage.requestCount++;
            }
            return responseBuffer;
          },
        ),
        error: (
          err: Error,
          _req: IncomingMessage,
          res: ServerResponse | Socket,
        ) => {
          this.logger.error(`[VlmProxyServer] Proxy error: ${err.message}`);
          /* v8 ignore start -- res is always ServerResponse for HTTP requests; Socket branch is defensive */
          if (res && 'writeHead' in res) {
            const httpRes = res as ServerResponse;
            if (!httpRes.headersSent) {
              httpRes.writeHead(502, {
                'Content-Type': 'application/json',
              });
            }
            httpRes.end(
              JSON.stringify({
                error: {
                  message: `Proxy request failed: ${err.message}`,
                },
              }),
            );
          }
          /* v8 ignore stop */
        },
      },
    });

    this.server = createServer(proxyMiddleware);

    return new Promise<string>((resolve, reject) => {
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        /* v8 ignore start -- address is always AddressInfo for TCP listen */
        if (typeof address !== 'object' || address === null) {
          reject(new Error('Failed to get server address'));
          return;
        }
        /* v8 ignore stop */
        const port = address.port;
        const proxyUrl = `http://127.0.0.1:${port}/v1/chat/completions`;
        this.logger.info(`[VlmProxyServer] Started on port ${port}`);
        resolve(proxyUrl);
      });

      this.server!.on('error', reject);
    });
  }

  /**
   * Stop the proxy server.
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = null;

    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        /* v8 ignore start -- server.close callback never receives an error in practice */
        if (err) {
          reject(err);
          return;
        }
        /* v8 ignore stop */
        resolve();
      });
    });

    this.logger.info('[VlmProxyServer] Stopped');
  }

  /**
   * Get accumulated token usage from all proxied requests.
   */
  getAccumulatedUsage(): AccumulatedTokenUsage {
    return { ...this.usage };
  }
}
