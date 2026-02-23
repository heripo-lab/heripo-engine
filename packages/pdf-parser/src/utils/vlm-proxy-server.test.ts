import type { LoggerMethods } from '@heripo/logger';
import type { IncomingMessage, Server } from 'node:http';

import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { VlmProxyServer } from './vlm-proxy-server';

/**
 * Helper to read the full request body from an IncomingMessage.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

/**
 * Helper to start a Node.js HTTP server on a random port and return port + server.
 */
function listenOnRandomPort(
  server: Server,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

/**
 * Helper to close a server.
 */
function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

describe('VlmProxyServer', () => {
  let logger: LoggerMethods;
  let targetServer: Server;
  let targetPort: number;
  let targetUrl: string;
  let proxy: VlmProxyServer;

  beforeEach(async () => {
    logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    // Start a real target server to proxy to (plain Node.js http)
    const server = createServer(async (req, res) => {
      const body = await readBody(req);
      const authHeader = req.headers.authorization;

      // Check for test-specific behavior based on auth header
      if (authHeader === 'Bearer error-key') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } }),
        );
        return;
      }

      if (authHeader === 'Bearer no-usage-key') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: '# Hello' } }],
          }),
        );
        return;
      }

      if (authHeader === 'Bearer non-json-key') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('not json');
        return;
      }

      if (authHeader === 'Bearer null-usage-key') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: 'test' } }],
            usage: {
              input_tokens: null,
              output_tokens: null,
              total_tokens: null,
            },
          }),
        );
        return;
      }

      // Legacy format (prompt_tokens/completion_tokens) for fallback test
      if (authHeader === 'Bearer legacy-key') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: 'legacy' } }],
            usage: {
              prompt_tokens: 30,
              completion_tokens: 20,
              total_tokens: 50,
            },
          }),
        );
        return;
      }

      // Default: success with usage (new format)
      void body;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: '# Markdown result' } }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            total_tokens: 150,
          },
        }),
      );
    });

    const result = await listenOnRandomPort(server);
    targetServer = result.server;
    targetPort = result.port;
    targetUrl = `http://127.0.0.1:${targetPort}/v1/chat/completions`;
  });

  afterEach(async () => {
    if (proxy) {
      await proxy.stop();
    }
    await closeServer(targetServer);
  });

  test('should forward request body and auth header to target', async () => {
    proxy = new VlmProxyServer(logger, targetUrl, 'Bearer test-key');
    const proxyUrl = await proxy.start();

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.2',
        messages: [{ role: 'user', content: 'test' }],
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.choices[0].message.content).toBe('# Markdown result');
  });

  test('should return response body unchanged', async () => {
    proxy = new VlmProxyServer(logger, targetUrl, 'Bearer test-key');
    const proxyUrl = await proxy.start();

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.2', messages: [] }),
    });

    const body = (await response.json()) as any;
    expect(body).toEqual({
      choices: [{ message: { content: '# Markdown result' } }],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
      },
    });
  });

  test('should accumulate token usage across multiple requests', async () => {
    proxy = new VlmProxyServer(logger, targetUrl, 'Bearer test-key');
    const proxyUrl = await proxy.start();

    // Make 3 requests
    for (let i = 0; i < 3; i++) {
      await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5.2', messages: [] }),
      });
    }

    const usage = proxy.getAccumulatedUsage();
    expect(usage).toEqual({
      inputTokens: 300,
      outputTokens: 150,
      totalTokens: 450,
      requestCount: 3,
    });
  });

  test('should return accurate totals from getAccumulatedUsage', async () => {
    proxy = new VlmProxyServer(logger, targetUrl, 'Bearer test-key');
    const proxyUrl = await proxy.start();

    await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.2', messages: [] }),
    });

    const usage = proxy.getAccumulatedUsage();
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(50);
    expect(usage.totalTokens).toBe(150);
    expect(usage.requestCount).toBe(1);

    // Should log token usage
    expect(logger.info).toHaveBeenCalledWith(
      '[VlmProxyServer] Token usage: input=100, output=50 (accumulated: input=100, output=50)',
    );
  });

  test('should fall back to legacy prompt_tokens/completion_tokens', async () => {
    proxy = new VlmProxyServer(logger, targetUrl, 'Bearer legacy-key');
    const proxyUrl = await proxy.start();

    await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.2', messages: [] }),
    });

    const usage = proxy.getAccumulatedUsage();
    expect(usage.inputTokens).toBe(30);
    expect(usage.outputTokens).toBe(20);
    expect(usage.totalTokens).toBe(50);
    expect(usage.requestCount).toBe(1);
  });

  test('should forward API error responses', async () => {
    proxy = new VlmProxyServer(logger, targetUrl, 'Bearer error-key');
    const proxyUrl = await proxy.start();

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.2', messages: [] }),
    });

    expect(response.status).toBe(500);
    const body = (await response.json()) as any;
    expect(body.error.message).toBe('Internal server error');
  });

  test('should count request even when response has no usage field', async () => {
    proxy = new VlmProxyServer(logger, targetUrl, 'Bearer no-usage-key');
    const proxyUrl = await proxy.start();

    await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.2', messages: [] }),
    });

    const usage = proxy.getAccumulatedUsage();
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
    expect(usage.totalTokens).toBe(0);
    expect(usage.requestCount).toBe(1);
  });

  test('should count request even when response is not JSON', async () => {
    proxy = new VlmProxyServer(logger, targetUrl, 'Bearer non-json-key');
    const proxyUrl = await proxy.start();

    await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.2', messages: [] }),
    });

    const usage = proxy.getAccumulatedUsage();
    expect(usage.requestCount).toBe(1);
    expect(usage.totalTokens).toBe(0);
  });

  test('should start and stop cleanly', async () => {
    proxy = new VlmProxyServer(logger, targetUrl, 'Bearer test-key');
    const proxyUrl = await proxy.start();

    expect(proxyUrl).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/v1\/chat\/completions$/,
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('[VlmProxyServer] Started on port'),
    );

    await proxy.stop();

    expect(logger.info).toHaveBeenCalledWith('[VlmProxyServer] Stopped');

    // Verify server is actually stopped - fetch should fail
    await expect(
      fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    ).rejects.toThrow();
  });

  test('should stop gracefully when server was never started', async () => {
    proxy = new VlmProxyServer(logger, targetUrl, 'Bearer test-key');
    // Stop without starting should not throw
    await expect(proxy.stop()).resolves.toBeUndefined();
  });

  test('should return 502 for unreachable target', async () => {
    // Use a port that nothing is listening on
    proxy = new VlmProxyServer(
      logger,
      'http://127.0.0.1:1/v1/chat/completions',
      'Bearer test-key',
    );
    const proxyUrl = await proxy.start();

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.2', messages: [] }),
    });

    expect(response.status).toBe(502);
    const body = (await response.json()) as any;
    expect(body.error.message).toContain('Proxy request failed');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('[VlmProxyServer] Proxy error'),
    );
  });

  test('should work without auth header when target does not require it', async () => {
    proxy = new VlmProxyServer(logger, targetUrl, '');
    const proxyUrl = await proxy.start();

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.2', messages: [] }),
    });

    // Target returns success with usage for any non-special auth header
    expect(response.status).toBe(200);
  });

  test('should handle double-stop cleanly', async () => {
    proxy = new VlmProxyServer(logger, targetUrl, 'Bearer test-key');
    await proxy.start();

    await proxy.stop();
    // Second stop on null server should resolve cleanly
    await expect(proxy.stop()).resolves.toBeUndefined();
  });

  test('should handle null token values in usage with nullish coalescing', async () => {
    proxy = new VlmProxyServer(logger, targetUrl, 'Bearer null-usage-key');
    const proxyUrl = await proxy.start();

    await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.2', messages: [] }),
    });

    const usage = proxy.getAccumulatedUsage();
    // null values should fall back to 0 via ?? operator
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
    expect(usage.totalTokens).toBe(0);
    expect(usage.requestCount).toBe(1);
  });

  test('should return a copy of usage data from getAccumulatedUsage', async () => {
    proxy = new VlmProxyServer(logger, targetUrl, 'Bearer test-key');
    const proxyUrl = await proxy.start();

    await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.2', messages: [] }),
    });

    const usage1 = proxy.getAccumulatedUsage();
    const usage2 = proxy.getAccumulatedUsage();

    // Should be equal but not the same reference
    expect(usage1).toEqual(usage2);
    expect(usage1).not.toBe(usage2);
  });
});
