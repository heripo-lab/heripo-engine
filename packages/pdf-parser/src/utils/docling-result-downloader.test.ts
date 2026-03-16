import type { LoggerMethods } from '@heripo/logger';
import type { DoclingAPIClient } from 'docling-sdk';
import type { Mock } from 'vitest';

import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { downloadTaskResult } from './docling-result-downloader';

vi.mock('node:fs', () => ({
  createWriteStream: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
}));

vi.mock('node:stream/promises', () => ({
  pipeline: vi.fn(),
}));

describe('downloadTaskResult', () => {
  let client: DoclingAPIClient;
  let logger: LoggerMethods;

  beforeEach(() => {
    client = {
      getTaskResultFile: vi.fn(),
      getConfig: vi.fn().mockReturnValue({ baseUrl: 'http://localhost:5001' }),
    } as unknown as DoclingAPIClient;

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as LoggerMethods;
  });

  test('downloads via fileStream when available', async () => {
    const mockStream = { pipe: vi.fn() };
    const mockWriteStream = {};
    vi.mocked(createWriteStream).mockReturnValue(mockWriteStream as any);
    vi.mocked(pipeline).mockResolvedValue(undefined);
    (client.getTaskResultFile as Mock).mockResolvedValue({
      fileStream: mockStream,
    });

    await downloadTaskResult(
      client,
      'task-1',
      '/tmp/result.zip',
      logger,
      '[Test]',
    );

    expect(createWriteStream).toHaveBeenCalledWith('/tmp/result.zip');
    expect(pipeline).toHaveBeenCalledWith(mockStream, mockWriteStream);
    expect(writeFile).not.toHaveBeenCalled();
  });

  test('downloads via data when fileStream is absent', async () => {
    const mockData = new Uint8Array([1, 2, 3]);
    (client.getTaskResultFile as Mock).mockResolvedValue({
      data: mockData,
    });

    await downloadTaskResult(
      client,
      'task-2',
      '/tmp/result.zip',
      logger,
      '[Test]',
    );

    expect(writeFile).toHaveBeenCalledWith('/tmp/result.zip', mockData);
    expect(createWriteStream).not.toHaveBeenCalled();
  });

  test('falls back to direct HTTP fetch when no fileStream or data', async () => {
    (client.getTaskResultFile as Mock).mockResolvedValue({});

    const mockBuffer = new ArrayBuffer(4);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(mockBuffer),
    });
    vi.stubGlobal('fetch', mockFetch);

    await downloadTaskResult(
      client,
      'task-3',
      '/tmp/result.zip',
      logger,
      '[Test]',
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:5001/v1/result/task-3',
      { headers: { Accept: 'application/zip' } },
    );
    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/result.zip',
      new Uint8Array(mockBuffer),
    );
    expect(logger.warn).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  test('throws on non-ok HTTP response', async () => {
    (client.getTaskResultFile as Mock).mockResolvedValue({});

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      downloadTaskResult(client, 'task-4', '/tmp/result.zip', logger, '[Test]'),
    ).rejects.toThrow('Failed to download ZIP file: 500 Internal Server Error');

    vi.unstubAllGlobals();
  });

  test('logs with provided prefix', async () => {
    const mockData = new Uint8Array([1]);
    (client.getTaskResultFile as Mock).mockResolvedValue({ data: mockData });

    await downloadTaskResult(
      client,
      'task-5',
      '/tmp/result.zip',
      logger,
      '[MyPrefix]',
    );

    expect(logger.info).toHaveBeenCalledWith(
      '\n[MyPrefix] Task completed, downloading ZIP file...',
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[MyPrefix] Saving ZIP file to:',
      '/tmp/result.zip',
    );
  });
});
