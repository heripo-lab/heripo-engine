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
    vi.resetAllMocks();

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

  test('should download via fileStream when available', async () => {
    const mockStream = { pipe: vi.fn() };
    const mockWriteStream = { on: vi.fn() };

    (client.getTaskResultFile as Mock).mockResolvedValue({
      fileStream: mockStream,
    });
    vi.mocked(createWriteStream).mockReturnValue(
      mockWriteStream as unknown as ReturnType<typeof createWriteStream>,
    );
    vi.mocked(pipeline).mockResolvedValue(undefined);

    await downloadTaskResult(
      client,
      'task-123',
      '/tmp/result.zip',
      logger,
      '[Test]',
    );

    expect(client.getTaskResultFile).toHaveBeenCalledWith('task-123');
    expect(createWriteStream).toHaveBeenCalledWith('/tmp/result.zip');
    expect(pipeline).toHaveBeenCalledWith(mockStream, mockWriteStream);
    expect(writeFile).not.toHaveBeenCalled();
  });

  test('should download via writeFile when data is present', async () => {
    const mockData = Buffer.from('zip-data');

    (client.getTaskResultFile as Mock).mockResolvedValue({
      data: mockData,
    });

    await downloadTaskResult(
      client,
      'task-456',
      '/tmp/result.zip',
      logger,
      '[Test]',
    );

    expect(writeFile).toHaveBeenCalledWith('/tmp/result.zip', mockData);
    expect(createWriteStream).not.toHaveBeenCalled();
    expect(pipeline).not.toHaveBeenCalled();
  });

  test('should fallback to direct HTTP fetch when neither fileStream nor data is present', async () => {
    (client.getTaskResultFile as Mock).mockResolvedValue({});

    const mockArrayBuffer = new ArrayBuffer(8);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
    });
    vi.stubGlobal('fetch', mockFetch);

    await downloadTaskResult(
      client,
      'task-789',
      '/tmp/result.zip',
      logger,
      '[Test]',
    );

    expect(logger.warn).toHaveBeenCalledWith(
      '[Test] SDK file result unavailable, falling back to direct download...',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:5001/v1/result/task-789',
      { headers: { Accept: 'application/zip' } },
    );
    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/result.zip',
      new Uint8Array(mockArrayBuffer),
    );

    vi.unstubAllGlobals();
  });

  test('should throw error when direct fetch fallback fails', async () => {
    (client.getTaskResultFile as Mock).mockResolvedValue({});

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      downloadTaskResult(
        client,
        'task-fail',
        '/tmp/result.zip',
        logger,
        '[Test]',
      ),
    ).rejects.toThrow('Failed to download ZIP file: 500 Internal Server Error');

    vi.unstubAllGlobals();
  });

  test('should log correct messages with provided prefix', async () => {
    const mockStream = { pipe: vi.fn() };
    const mockWriteStream = { on: vi.fn() };

    (client.getTaskResultFile as Mock).mockResolvedValue({
      fileStream: mockStream,
    });
    vi.mocked(createWriteStream).mockReturnValue(
      mockWriteStream as unknown as ReturnType<typeof createWriteStream>,
    );
    vi.mocked(pipeline).mockResolvedValue(undefined);

    await downloadTaskResult(
      client,
      'task-log',
      '/output/result.zip',
      logger,
      '[PDFConverter]',
    );

    expect(logger.info).toHaveBeenCalledWith(
      '\n[PDFConverter] Task completed, downloading ZIP file...',
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[PDFConverter] Saving ZIP file to:',
      '/output/result.zip',
    );
  });

  test('should prefer fileStream over data when both are present', async () => {
    const mockStream = { pipe: vi.fn() };
    const mockData = Buffer.from('zip-data');
    const mockWriteStream = { on: vi.fn() };

    (client.getTaskResultFile as Mock).mockResolvedValue({
      fileStream: mockStream,
      data: mockData,
    });
    vi.mocked(createWriteStream).mockReturnValue(
      mockWriteStream as unknown as ReturnType<typeof createWriteStream>,
    );
    vi.mocked(pipeline).mockResolvedValue(undefined);

    await downloadTaskResult(
      client,
      'task-both',
      '/tmp/result.zip',
      logger,
      '[Test]',
    );

    expect(pipeline).toHaveBeenCalledWith(mockStream, mockWriteStream);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
