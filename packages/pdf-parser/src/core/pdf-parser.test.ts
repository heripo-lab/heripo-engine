import * as DoclingSdk from 'docling-sdk';
import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import { describe, expect, test, vi } from 'vitest';

import * as EnvMod from '../environment/docling-environment';
import * as ConvMod from './pdf-converter';
import { PDFParser } from './pdf-parser';

vi.mock('node:os', () => ({
  platform: vi.fn(() => 'darwin'),
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(() => ''),
}));

vi.mock('docling-sdk', () => {
  const client = {
    health: vi.fn<() => Promise<void>>(),
    destroy: vi.fn<() => void>(),
  };
  const Docling = vi.fn(() => client);
  return {
    Docling,
    __clientMock: client,
  };
});

vi.mock('../environment/docling-environment', () => {
  const setupMock = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const DoclingEnvironment = vi.fn((_: any) => ({
    setup: setupMock,
  })) as any;
  (DoclingEnvironment as any).killProcessOnPort = vi
    .fn<(logger: any, port: number) => Promise<void>>()
    .mockResolvedValue(undefined);
  return {
    DoclingEnvironment,
    __envMocks: { setupMock },
  };
});

vi.mock('./pdf-converter', () => {
  const convert = vi.fn();
  const PDFConverter = vi.fn(() => ({ convert }));
  return {
    PDFConverter,
    __convertMock: convert,
  };
});

const makeLogger = () =>
  ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }) as any;

// Access mocks from mocked modules with loose typing to avoid TS type errors
const Docling = (DoclingSdk as any).Docling as any;
const doclingClient = (DoclingSdk as any).__clientMock as any;
const DoclingEnvironment = (EnvMod as any).DoclingEnvironment as any;
const envMocks = (EnvMod as any).__envMocks as any;
const PDFConverter = (ConvMod as any).PDFConverter as any;
const convertMock = (ConvMod as any).__convertMock as any;

describe('PDFParser', () => {
  test('init with external server (baseUrl) succeeds and waits for health', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(execSync as any).mockImplementation((cmd: string) => {
      // Return a non-matching version string to cover the versionMatch === null branch
      if (cmd.startsWith('sw_vers')) return 'unknown-version-output';
      if (cmd.startsWith('which jq')) return '';
      return '';
    });
    doclingClient.health.mockResolvedValueOnce();

    const logger = makeLogger();
    const parser = new PDFParser({
      logger,
      baseUrl: 'http://example.com',
      timeout: 123,
    });
    await parser.init();

    expect(Docling).toHaveBeenCalledWith({
      api: { baseUrl: 'http://example.com', timeout: 123 },
    });
    expect(doclingClient.health).toHaveBeenCalled();
  });

  test('init with local server succeeds (environment setup and client ready)', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(execSync as any).mockImplementation((cmd: string) => {
      if (cmd.startsWith('sw_vers')) return '13.5.1';
      if (cmd.startsWith('which jq')) return '';
      return '';
    });
    doclingClient.health.mockResolvedValueOnce();
    vi.mocked(envMocks.setupMock).mockResolvedValueOnce();

    const logger = makeLogger();
    const parser = new PDFParser({
      logger,
      port: 3210,
      timeout: 5000,
      killExistingProcess: true,
    });
    await parser.init();

    expect(DoclingEnvironment).toHaveBeenCalledWith({
      logger,
      venvPath: expect.any(String),
      port: 3210,
      killExistingProcess: true,
    });
    expect(envMocks.setupMock).toHaveBeenCalledTimes(1);
    expect(Docling).toHaveBeenCalledWith({
      api: { baseUrl: 'http://localhost:3210', timeout: 5000 },
    });
  });

  test('init with local server wraps environment setup error', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(execSync as any).mockImplementation((cmd: string) => {
      if (cmd.startsWith('sw_vers')) return '13.0.0';
      if (cmd.startsWith('which jq')) return '';
      return '';
    });
    vi.mocked(envMocks.setupMock).mockRejectedValueOnce(new Error('boom'));

    const logger = makeLogger();
    const parser = new PDFParser({ logger, port: 9999 });

    await expect(parser.init()).rejects.toThrow(
      'Failed to initialize PDFParser: Error: boom',
    );
    expect(logger.error).toHaveBeenCalled();
  });

  test('waitForServerReady times out after maximum attempts (logs throttled)', async () => {
    vi.useFakeTimers();
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(execSync as any).mockImplementation((cmd: string) => {
      if (cmd.startsWith('sw_vers')) return '12.6.3';
      if (cmd.startsWith('which jq')) return '';
      return '';
    });
    doclingClient.health.mockRejectedValue(new Error('down'));

    const logger = makeLogger();
    const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
    const initPromise = parser.init();
    const handled = initPromise.catch((e) => e as Error);

    await vi.runAllTimersAsync();
    await expect(handled).resolves.toHaveProperty(
      'message',
      'Server failed to become ready after maximum attempts',
    );
    vi.useRealTimers();
  });

  test('throws on non-macOS platforms', async () => {
    vi.mocked(platform).mockReturnValue('linux');
    const logger = makeLogger();
    const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
    await expect(parser.init()).rejects.toThrow(
      'PDFParser is only supported on macOS. Current platform: linux',
    );
  });

  test('throws when jq is not installed', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(execSync as any).mockImplementation((cmd: string) => {
      if (cmd.startsWith('which jq')) throw new Error('not found');
      return '';
    });
    const logger = makeLogger();
    const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
    await expect(parser.init()).rejects.toThrow(
      'jq is not installed. Please install jq using: brew install jq',
    );
  });

  test('throws when macOS version is below 10.15', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(execSync as any).mockImplementation((cmd: string) => {
      if (cmd.startsWith('which jq')) return '';
      if (cmd.startsWith('sw_vers')) return '10.14.6';
      return '';
    });
    const logger = makeLogger();
    const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
    await expect(parser.init()).rejects.toThrow(
      'macOS 10.15 or later is required. Current version: 10.14.6',
    );
  });

  test('throws when macOS version check fails unexpectedly', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(execSync as any).mockImplementation((cmd: string) => {
      if (cmd.startsWith('which jq')) return '';
      if (cmd.startsWith('sw_vers')) throw new Error('boom');
      return '';
    });
    const logger = makeLogger();
    const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
    await expect(parser.init()).rejects.toThrow(
      'Failed to check macOS version',
    );
  });

  test('throws when ImageMagick is not installed with enableImagePdfFallback on local server', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(execSync as any).mockImplementation((cmd: string) => {
      if (cmd.startsWith('sw_vers')) return '13.0.0';
      if (cmd.startsWith('which jq')) return '';
      if (cmd.startsWith('which magick')) throw new Error('not found');
      return '';
    });
    const logger = makeLogger();
    const parser = new PDFParser({
      logger,
      port: 5001,
      enableImagePdfFallback: true,
    });
    await expect(parser.init()).rejects.toThrow(
      'ImageMagick is not installed but enableImagePdfFallback is enabled. ' +
        'Please install ImageMagick using: brew install imagemagick',
    );
  });

  test('throws when Ghostscript is not installed with enableImagePdfFallback on local server', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(execSync as any).mockImplementation((cmd: string) => {
      if (cmd.startsWith('sw_vers')) return '13.0.0';
      if (cmd.startsWith('which jq')) return '';
      if (cmd.startsWith('which magick')) return '';
      if (cmd.startsWith('which gs')) throw new Error('not found');
      return '';
    });
    const logger = makeLogger();
    const parser = new PDFParser({
      logger,
      port: 5001,
      enableImagePdfFallback: true,
    });
    await expect(parser.init()).rejects.toThrow(
      'Ghostscript is not installed but enableImagePdfFallback is enabled. ' +
        'Please install Ghostscript using: brew install ghostscript',
    );
  });

  test('does not check ImageMagick/Ghostscript when enableImagePdfFallback is false', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(execSync as any).mockImplementation((cmd: string) => {
      if (cmd.startsWith('sw_vers')) return '13.0.0';
      if (cmd.startsWith('which jq')) return '';
      // magick and gs would throw if called, but they should not be called
      if (cmd.startsWith('which magick')) throw new Error('not found');
      if (cmd.startsWith('which gs')) throw new Error('not found');
      return '';
    });
    doclingClient.health.mockResolvedValueOnce();

    const logger = makeLogger();
    const parser = new PDFParser({
      logger,
      baseUrl: 'http://example.com',
      enableImagePdfFallback: false,
    });
    // Should not throw because ImageMagick/Ghostscript checks are skipped
    await expect(parser.init()).resolves.toBeUndefined();
  });

  test('parse throws if called before init', async () => {
    const logger = makeLogger();
    const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
    await expect(
      parser.parse('http://file.pdf', 'r1', vi.fn(), true, { num_threads: 2 }),
    ).rejects.toThrow(
      'PDFParser is not initialized. Call init() before using parse()',
    );
  });

  test('parse delegates to PDFConverter.convert after init', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(execSync as any).mockImplementation((cmd: string) => {
      if (cmd.startsWith('sw_vers')) return '12.6.0';
      if (cmd.startsWith('which jq')) return '';
      return '';
    });
    doclingClient.health.mockResolvedValueOnce();
    convertMock.mockResolvedValueOnce('OK');

    const logger = makeLogger();
    const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
    await parser.init();

    const onComplete = vi.fn();
    const result = await parser.parse(
      'http://file.pdf',
      'report-1',
      onComplete,
      false,
      { num_threads: 4 },
    );

    // Third argument is false because baseUrl is used (external server)
    expect(PDFConverter).toHaveBeenCalledWith(
      logger,
      expect.any(Object),
      false,
    );
    expect(convertMock).toHaveBeenCalledWith(
      'http://file.pdf',
      'report-1',
      onComplete,
      false,
      { num_threads: 4 },
      undefined,
    );
    expect(result).toBe('OK');
  });

  test('parse passes enableImagePdfFallback=true when local server and option enabled', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(execSync as any).mockImplementation((cmd: string) => {
      if (cmd.startsWith('sw_vers')) return '12.6.0';
      if (cmd.startsWith('which')) return ''; // jq, magick, gs all found
      return '';
    });
    doclingClient.health.mockResolvedValueOnce();
    convertMock.mockResolvedValueOnce('OK');

    const logger = makeLogger();
    const parser = new PDFParser({
      logger,
      port: 5001,
      enableImagePdfFallback: true,
    });
    await parser.init();

    const onComplete = vi.fn();
    await parser.parse('http://file.pdf', 'report-1', onComplete, false, {
      num_threads: 4,
    });

    // Third argument is true because local server mode and fallback is enabled
    expect(PDFConverter).toHaveBeenCalledWith(logger, expect.any(Object), true);
  });

  test('parse passes enableImagePdfFallback=false when external server even if option enabled', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(execSync as any).mockImplementation((cmd: string) => {
      if (cmd.startsWith('sw_vers')) return '12.6.0';
      if (cmd.startsWith('which jq')) return '';
      return '';
    });
    doclingClient.health.mockResolvedValueOnce();
    convertMock.mockResolvedValueOnce('OK');

    const logger = makeLogger();
    const parser = new PDFParser({
      logger,
      baseUrl: 'http://example.com',
      enableImagePdfFallback: true,
    });
    await parser.init();

    const onComplete = vi.fn();
    await parser.parse('http://file.pdf', 'report-1', onComplete, false, {
      num_threads: 4,
    });

    // Third argument is false because external server mode disables fallback
    expect(PDFConverter).toHaveBeenCalledWith(
      logger,
      expect.any(Object),
      false,
    );
    // Warning should have been logged during init
    expect(logger.warn).toHaveBeenCalledWith(
      '[PDFParser] enableImagePdfFallback is ignored when using external server (baseUrl)',
    );
  });

  test('dispose with external server destroys client without killing local process', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(execSync as any).mockImplementation((cmd: string) => {
      if (cmd.startsWith('sw_vers')) return '12.6.0';
      if (cmd.startsWith('which jq')) return '';
      return '';
    });
    doclingClient.health.mockResolvedValueOnce();

    const logger = makeLogger();
    const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
    await parser.init();

    await parser.dispose();

    expect(
      (DoclingEnvironment as any).killProcessOnPort,
    ).not.toHaveBeenCalled();
    expect(doclingClient.destroy).toHaveBeenCalledTimes(1);
  });

  test('dispose with local server kills process and destroys client', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(execSync as any).mockImplementation((cmd: string) => {
      if (cmd.startsWith('sw_vers')) return '12.6.0';
      if (cmd.startsWith('which jq')) return '';
      return '';
    });
    doclingClient.health.mockResolvedValueOnce();
    const killSpy = vi.mocked((DoclingEnvironment as any).killProcessOnPort);
    killSpy.mockResolvedValueOnce();

    const logger = makeLogger();
    const parser = new PDFParser({ logger, port: 5555 });
    await parser.init();
    await parser.dispose();

    expect(killSpy).toHaveBeenCalledWith(logger, 5555);
    expect(doclingClient.destroy).toHaveBeenCalledTimes(1);
  });

  test('dispose swallows kill errors but still destroys client', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(execSync as any).mockImplementation((cmd: string) => {
      if (cmd.startsWith('sw_vers')) return '12.6.0';
      if (cmd.startsWith('which jq')) return '';
      return '';
    });
    doclingClient.health.mockResolvedValueOnce();
    const killSpy = vi.mocked((DoclingEnvironment as any).killProcessOnPort);
    killSpy.mockRejectedValueOnce(new Error('kill failed'));

    const logger = makeLogger();
    const parser = new PDFParser({ logger, port: 7777 });
    await parser.init();

    await expect(parser.dispose()).resolves.toBeUndefined();
    expect(killSpy).toHaveBeenCalledWith(logger, 7777);
    expect(doclingClient.destroy).toHaveBeenCalledTimes(1);
  });

  describe('server recovery', () => {
    test('parse recovers from ECONNREFUSED error on local server', async () => {
      vi.mocked(platform).mockReturnValue('darwin');
      vi.mocked(execSync as any).mockImplementation((cmd: string) => {
        if (cmd.startsWith('sw_vers')) return '12.6.0';
        if (cmd.startsWith('which jq')) return '';
        return '';
      });
      doclingClient.health.mockResolvedValue(undefined);
      const killSpy = vi.mocked((DoclingEnvironment as any).killProcessOnPort);
      killSpy.mockResolvedValue(undefined);

      // First call fails with ECONNREFUSED, second succeeds
      const econnRefusedError = new Error('Connection refused');
      (econnRefusedError as any).code = 'ECONNREFUSED';
      convertMock
        .mockRejectedValueOnce(econnRefusedError)
        .mockResolvedValueOnce('OK');

      // Mock for startServer call during recovery
      const startServerMock = vi.fn().mockResolvedValue(undefined);
      (DoclingEnvironment as any).mockImplementation(() => ({
        setup: envMocks.setupMock,
        startServer: startServerMock,
      }));

      const logger = makeLogger();
      const parser = new PDFParser({ logger, port: 5001 });
      await parser.init();

      const onComplete = vi.fn();
      const result = await parser.parse(
        'http://file.pdf',
        'report-1',
        onComplete,
        false,
        { num_threads: 4 },
      );

      expect(logger.warn).toHaveBeenCalledWith(
        '[PDFParser] Connection refused, attempting server recovery...',
      );
      expect(result).toBe('OK');
    });

    test('parse does not recover from ECONNREFUSED error on external server', async () => {
      vi.mocked(platform).mockReturnValue('darwin');
      vi.mocked(execSync as any).mockImplementation((cmd: string) => {
        if (cmd.startsWith('sw_vers')) return '12.6.0';
        if (cmd.startsWith('which jq')) return '';
        return '';
      });
      doclingClient.health.mockResolvedValueOnce();

      const econnRefusedError = new Error('Connection refused');
      (econnRefusedError as any).code = 'ECONNREFUSED';
      convertMock.mockRejectedValueOnce(econnRefusedError);

      const logger = makeLogger();
      const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
      await parser.init();

      const onComplete = vi.fn();
      await expect(
        parser.parse('http://file.pdf', 'report-1', onComplete, false, {
          num_threads: 4,
        }),
      ).rejects.toThrow('Connection refused');

      expect(logger.warn).not.toHaveBeenCalled();
    });

    test('parse throws after recovery attempt fails', async () => {
      vi.mocked(platform).mockReturnValue('darwin');
      vi.mocked(execSync as any).mockImplementation((cmd: string) => {
        if (cmd.startsWith('sw_vers')) return '12.6.0';
        if (cmd.startsWith('which jq')) return '';
        return '';
      });
      doclingClient.health.mockResolvedValue(undefined);
      const killSpy = vi.mocked((DoclingEnvironment as any).killProcessOnPort);
      killSpy.mockResolvedValue(undefined);

      // Both calls fail with ECONNREFUSED
      const econnRefusedError = new Error('Connection refused');
      (econnRefusedError as any).code = 'ECONNREFUSED';
      convertMock
        .mockRejectedValueOnce(econnRefusedError)
        .mockRejectedValueOnce(econnRefusedError);

      // Mock for startServer call during recovery
      const startServerMock = vi.fn().mockResolvedValue(undefined);
      (DoclingEnvironment as any).mockImplementation(() => ({
        setup: envMocks.setupMock,
        startServer: startServerMock,
      }));

      const logger = makeLogger();
      const parser = new PDFParser({ logger, port: 5001 });
      await parser.init();

      const onComplete = vi.fn();
      await expect(
        parser.parse('http://file.pdf', 'report-1', onComplete, false, {
          num_threads: 4,
        }),
      ).rejects.toThrow('Connection refused');

      expect(logger.warn).toHaveBeenCalledWith(
        '[PDFParser] Connection refused, attempting server recovery...',
      );
    });

    test('parse throws non-ECONNREFUSED errors without recovery', async () => {
      vi.mocked(platform).mockReturnValue('darwin');
      vi.mocked(execSync as any).mockImplementation((cmd: string) => {
        if (cmd.startsWith('sw_vers')) return '12.6.0';
        if (cmd.startsWith('which jq')) return '';
        return '';
      });
      doclingClient.health.mockResolvedValueOnce();

      convertMock.mockRejectedValueOnce(new Error('Some other error'));

      const logger = makeLogger();
      const parser = new PDFParser({ logger, port: 5001 });
      await parser.init();

      const onComplete = vi.fn();
      await expect(
        parser.parse('http://file.pdf', 'report-1', onComplete, false, {
          num_threads: 4,
        }),
      ).rejects.toThrow('Some other error');

      expect(logger.warn).not.toHaveBeenCalled();
    });

    test('isConnectionRefusedError returns false for non-Error objects', async () => {
      vi.mocked(platform).mockReturnValue('darwin');
      vi.mocked(execSync as any).mockImplementation((cmd: string) => {
        if (cmd.startsWith('sw_vers')) return '12.6.0';
        if (cmd.startsWith('which jq')) return '';
        return '';
      });
      doclingClient.health.mockResolvedValueOnce();

      // Throw a non-Error object
      convertMock.mockRejectedValueOnce('string error');

      const logger = makeLogger();
      const parser = new PDFParser({ logger, port: 5001 });
      await parser.init();

      const onComplete = vi.fn();
      await expect(
        parser.parse('http://file.pdf', 'report-1', onComplete, false, {
          num_threads: 4,
        }),
      ).rejects.toBe('string error');

      expect(logger.warn).not.toHaveBeenCalled();
    });

    test('parse throws immediately when abortSignal is already aborted', async () => {
      vi.mocked(platform).mockReturnValue('darwin');
      vi.mocked(execSync as any).mockImplementation((cmd: string) => {
        if (cmd.startsWith('sw_vers')) return '12.6.0';
        if (cmd.startsWith('which jq')) return '';
        return '';
      });
      doclingClient.health.mockResolvedValueOnce();

      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      convertMock.mockRejectedValueOnce(abortError);

      const logger = makeLogger();
      const parser = new PDFParser({ logger, port: 5001 });
      await parser.init();

      const abortController = new AbortController();
      abortController.abort();

      const onComplete = vi.fn();
      await expect(
        parser.parse(
          'http://file.pdf',
          'report-1',
          onComplete,
          false,
          { num_threads: 4 },
          abortController.signal,
        ),
      ).rejects.toThrow('Aborted');

      // Should NOT attempt recovery when aborted
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
