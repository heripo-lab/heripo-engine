import * as DoclingSdk from 'docling-sdk';
import { describe, expect, test, vi } from 'vitest';

import * as EnvMod from '../environment/docling-environment';
import * as SystemChecks from '../utils/system-checks';
import * as ConvMod from './pdf-converter';
import { PDFParser } from './pdf-parser';

vi.mock('../utils/system-checks', () => ({
  checkCommandExists: vi.fn(),
  checkOperatingSystem: vi.fn(),
  checkMacOSVersion: vi.fn(),
}));

vi.mock('docling-sdk', () => {
  const client = {
    health: vi.fn<() => Promise<void>>(),
    destroy: vi.fn<() => void>(),
  };
  const Docling = vi.fn(function () {
    return client;
  });
  return {
    Docling,
    __clientMock: client,
  };
});

vi.mock('../environment/docling-environment', () => {
  const setupMock = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const DoclingEnvironment = vi.fn(function (_: any) {
    return { setup: setupMock };
  }) as any;
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
  const convertWithStrategy = vi.fn();
  const PDFConverter = vi.fn(function () {
    return { convert, convertWithStrategy };
  });
  return {
    PDFConverter,
    __convertMock: convert,
    __convertWithStrategyMock: convertWithStrategy,
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
const convertWithStrategyMock = (ConvMod as any)
  .__convertWithStrategyMock as any;

const mockDoclingEnvironment = (
  startServerMock = vi.fn().mockResolvedValue(undefined),
) => {
  (DoclingEnvironment as any).mockImplementation(function () {
    return {
      setup: envMocks.setupMock,
      startServer: startServerMock,
    };
  });

  return startServerMock;
};

describe('PDFParser', () => {
  test('init with external server (baseUrl) succeeds and waits for health', async () => {
    doclingClient.health.mockResolvedValueOnce();

    const logger = makeLogger();
    const parser = new PDFParser({
      logger,
      baseUrl: 'http://example.com',
      timeout: 123,
    });
    await parser.init();

    expect(SystemChecks.checkOperatingSystem).toHaveBeenCalled();
    expect(SystemChecks.checkCommandExists).toHaveBeenCalledWith(
      'jq',
      expect.any(String),
    );
    expect(SystemChecks.checkCommandExists).toHaveBeenCalledWith(
      'pdftotext',
      expect.any(String),
    );
    expect(SystemChecks.checkMacOSVersion).toHaveBeenCalled();
    expect(Docling).toHaveBeenCalledWith({
      api: { baseUrl: 'http://example.com', timeout: 123 },
    });
    expect(doclingClient.health).toHaveBeenCalled();
  });

  test('init with local server succeeds (environment setup and client ready)', async () => {
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

  test('init propagates checkOperatingSystem error', async () => {
    vi.mocked(SystemChecks.checkOperatingSystem).mockImplementationOnce(() => {
      throw new Error(
        'PDFParser is only supported on macOS. Current platform: linux',
      );
    });
    const logger = makeLogger();
    const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
    await expect(parser.init()).rejects.toThrow(
      'PDFParser is only supported on macOS. Current platform: linux',
    );
  });

  test('init propagates checkCommandExists error for jq', async () => {
    vi.mocked(SystemChecks.checkCommandExists).mockImplementationOnce(
      (_cmd, msg) => {
        throw new Error(msg);
      },
    );
    const logger = makeLogger();
    const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
    await expect(parser.init()).rejects.toThrow(
      'jq is not installed. Please install jq using: brew install jq',
    );
  });

  test('init propagates checkCommandExists error for poppler', async () => {
    // First call (jq) succeeds, second call (pdftotext) throws
    vi.mocked(SystemChecks.checkCommandExists)
      .mockImplementationOnce(() => {})
      .mockImplementationOnce((_cmd, msg) => {
        throw new Error(msg);
      });
    const logger = makeLogger();
    const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
    await expect(parser.init()).rejects.toThrow(
      'poppler is not installed. Please install poppler using: brew install poppler',
    );
  });

  test('init propagates checkMacOSVersion error', async () => {
    vi.mocked(SystemChecks.checkMacOSVersion).mockImplementationOnce(() => {
      throw new Error(
        'macOS 10.15 or later is required. Current version: 10.14.6',
      );
    });
    const logger = makeLogger();
    const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
    await expect(parser.init()).rejects.toThrow(
      'macOS 10.15 or later is required. Current version: 10.14.6',
    );
  });

  test('init checks ImageMagick and Ghostscript when enableImagePdfFallback on local server', async () => {
    doclingClient.health.mockResolvedValueOnce();
    vi.mocked(envMocks.setupMock).mockResolvedValueOnce();

    const logger = makeLogger();
    const parser = new PDFParser({
      logger,
      port: 5001,
      enableImagePdfFallback: true,
    });
    await parser.init();

    // jq, pdftotext, magick, gs = 4 calls
    expect(SystemChecks.checkCommandExists).toHaveBeenCalledWith(
      'magick',
      expect.stringContaining('ImageMagick'),
    );
    expect(SystemChecks.checkCommandExists).toHaveBeenCalledWith(
      'gs',
      expect.stringContaining('Ghostscript'),
    );
  });

  test('init propagates ImageMagick check error with enableImagePdfFallback on local server', async () => {
    // jq ok, pdftotext ok, magick throws
    vi.mocked(SystemChecks.checkCommandExists)
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {})
      .mockImplementationOnce((_cmd, msg) => {
        throw new Error(msg);
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

  test('init propagates Ghostscript check error with enableImagePdfFallback on local server', async () => {
    // jq ok, pdftotext ok, magick ok, gs throws
    vi.mocked(SystemChecks.checkCommandExists)
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {})
      .mockImplementationOnce((_cmd, msg) => {
        throw new Error(msg);
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

  test('init does not check ImageMagick/Ghostscript when enableImagePdfFallback is false', async () => {
    doclingClient.health.mockResolvedValueOnce();

    const logger = makeLogger();
    const parser = new PDFParser({
      logger,
      baseUrl: 'http://example.com',
      enableImagePdfFallback: false,
    });
    await expect(parser.init()).resolves.toBeUndefined();

    // Only jq and pdftotext should be checked
    expect(SystemChecks.checkCommandExists).toHaveBeenCalledTimes(2);
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

    expect(PDFConverter).toHaveBeenCalledWith(
      logger,
      expect.any(Object),
      false,
      expect.any(Number),
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

  test('parse returns TokenUsageReport from converter via strategy flow', async () => {
    doclingClient.health.mockResolvedValueOnce();

    const mockReport = {
      components: [
        {
          component: 'VlmPipeline',
          phases: [
            {
              phase: 'page-conversion',
              primary: {
                modelName: 'openai/gpt-5.2',
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 150,
              },
              total: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
            },
          ],
          total: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        },
      ],
      total: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    };
    convertWithStrategyMock.mockResolvedValueOnce({
      strategy: {
        method: 'vlm',
        reason: 'Forced: vlm',
        sampledPages: 0,
        totalPages: 0,
      },
      tokenUsageReport: mockReport,
    });

    const logger = makeLogger();
    const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
    await parser.init();

    const result = await parser.parse(
      'http://file.pdf',
      'report-vlm',
      vi.fn(),
      false,
      { forcedMethod: 'vlm', vlmProcessorModel: {} as any },
    );

    expect(result).toBe(mockReport);
    expect(result!.components[0].component).toBe('VlmPipeline');
  });

  test('parse returns null when converter returns null', async () => {
    doclingClient.health.mockResolvedValueOnce();
    convertMock.mockResolvedValueOnce(null);

    const logger = makeLogger();
    const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
    await parser.init();

    const result = await parser.parse(
      'http://file.pdf',
      'report-std',
      vi.fn(),
      false,
      { num_threads: 4 },
    );

    expect(result).toBeNull();
  });

  test('parse calls checkCommandExists for magick and gs when forceImagePdf is true on local server', async () => {
    doclingClient.health.mockResolvedValueOnce();
    vi.mocked(envMocks.setupMock).mockResolvedValueOnce();
    convertMock.mockResolvedValueOnce('OK');

    const logger = makeLogger();
    const parser = new PDFParser({ logger, port: 5001 });
    await parser.init();

    // Clear mock calls from init
    vi.mocked(SystemChecks.checkCommandExists).mockClear();

    await parser.parse('http://file.pdf', 'report-1', vi.fn(), false, {
      num_threads: 4,
      forceImagePdf: true,
    });

    expect(SystemChecks.checkCommandExists).toHaveBeenCalledWith(
      'magick',
      expect.stringContaining('ImageMagick'),
    );
    expect(SystemChecks.checkCommandExists).toHaveBeenCalledWith(
      'gs',
      expect.stringContaining('Ghostscript'),
    );
  });

  test('parse propagates checkCommandExists error when forceImagePdf and magick missing', async () => {
    doclingClient.health.mockResolvedValueOnce();
    vi.mocked(envMocks.setupMock).mockResolvedValueOnce();

    const logger = makeLogger();
    const parser = new PDFParser({ logger, port: 5001 });
    await parser.init();

    // After init, make checkCommandExists throw for magick
    vi.mocked(SystemChecks.checkCommandExists).mockImplementation(
      (cmd, msg) => {
        if (cmd === 'magick') throw new Error(msg);
      },
    );

    await expect(
      parser.parse('http://file.pdf', 'report-1', vi.fn(), false, {
        num_threads: 4,
        forceImagePdf: true,
      }),
    ).rejects.toThrow('ImageMagick is not installed');
  });

  test('parse skips forceImagePdf dependency check when using external server', async () => {
    doclingClient.health.mockResolvedValueOnce();
    convertMock.mockResolvedValueOnce('OK');

    const logger = makeLogger();
    const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
    await parser.init();

    // Clear mock calls from init
    vi.mocked(SystemChecks.checkCommandExists).mockClear();

    await parser.parse('http://file.pdf', 'report-1', vi.fn(), false, {
      num_threads: 4,
      forceImagePdf: true,
    });

    // Should NOT call checkCommandExists during parse since external server
    expect(SystemChecks.checkCommandExists).not.toHaveBeenCalled();
  });

  test('parse passes enableImagePdfFallback=true when local server and option enabled', async () => {
    doclingClient.health.mockResolvedValueOnce();
    vi.mocked(envMocks.setupMock).mockResolvedValueOnce();
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

    expect(PDFConverter).toHaveBeenCalledWith(
      logger,
      expect.any(Object),
      true,
      expect.any(Number),
    );
  });

  test('parse passes enableImagePdfFallback=false when external server even if option enabled', async () => {
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

    expect(PDFConverter).toHaveBeenCalledWith(
      logger,
      expect.any(Object),
      false,
      expect.any(Number),
    );
    // Warning should have been logged during init
    expect(logger.warn).toHaveBeenCalledWith(
      '[PDFParser] enableImagePdfFallback is ignored when using external server (baseUrl)',
    );
  });

  test('dispose with external server destroys client without killing local process', async () => {
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
    doclingClient.health.mockResolvedValueOnce();
    vi.mocked(envMocks.setupMock).mockResolvedValueOnce();
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
    doclingClient.health.mockResolvedValueOnce();
    vi.mocked(envMocks.setupMock).mockResolvedValueOnce();
    const killSpy = vi.mocked((DoclingEnvironment as any).killProcessOnPort);
    killSpy.mockRejectedValueOnce(new Error('kill failed'));

    const logger = makeLogger();
    const parser = new PDFParser({ logger, port: 7777 });
    await parser.init();

    await expect(parser.dispose()).resolves.toBeUndefined();
    expect(killSpy).toHaveBeenCalledWith(logger, 7777);
    expect(doclingClient.destroy).toHaveBeenCalledTimes(1);
  });

  test('isReady returns false before init', async () => {
    const logger = makeLogger();
    const parser = new PDFParser({ logger, port: 5001 });

    await expect(parser.isReady()).resolves.toBe(false);
  });

  test('isReady checks the live Docling health endpoint', async () => {
    doclingClient.health
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('down'));

    const logger = makeLogger();
    const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
    await parser.init();

    await expect(parser.isReady()).resolves.toBe(false);
  });

  test('ensureReady succeeds when health check passes', async () => {
    doclingClient.health.mockResolvedValue(undefined);

    const logger = makeLogger();
    const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
    await parser.init();

    await expect(parser.ensureReady()).resolves.toBeUndefined();
  });

  test('ensureReady recovers local server when health check fails', async () => {
    doclingClient.health
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(undefined);
    vi.mocked(envMocks.setupMock).mockResolvedValueOnce();
    const startServerMock = mockDoclingEnvironment();

    const logger = makeLogger();
    const parser = new PDFParser({ logger, port: 5001 });
    await parser.init();

    await expect(parser.ensureReady()).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      '[PDFParser] Health check failed, attempting server recovery...',
    );
    expect(startServerMock).toHaveBeenCalledTimes(1);
  });

  test('ensureReady does not recover external server health failures', async () => {
    doclingClient.health
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('down'));

    const logger = makeLogger();
    const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
    await parser.init();

    await expect(parser.ensureReady()).rejects.toThrow('down');
    expect(logger.warn).not.toHaveBeenCalledWith(
      '[PDFParser] Health check failed, attempting server recovery...',
    );
  });

  describe('server recovery', () => {
    test('parse recovers from ECONNREFUSED error on local server', async () => {
      doclingClient.health.mockResolvedValue(undefined);
      vi.mocked(envMocks.setupMock).mockResolvedValueOnce();
      const killSpy = vi.mocked((DoclingEnvironment as any).killProcessOnPort);
      killSpy.mockResolvedValue(undefined);

      // First call fails with ECONNREFUSED, second succeeds
      const econnRefusedError = new Error(
        'connect ECONNREFUSED 127.0.0.1:5001',
      );
      convertMock
        .mockRejectedValueOnce(econnRefusedError)
        .mockResolvedValueOnce('OK');

      // Mock for startServer call during recovery
      mockDoclingEnvironment();

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
      doclingClient.health.mockResolvedValueOnce();

      const econnRefusedError = new Error(
        'connect ECONNREFUSED 127.0.0.1:5001',
      );
      convertMock.mockRejectedValueOnce(econnRefusedError);

      const logger = makeLogger();
      const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
      await parser.init();

      const onComplete = vi.fn();
      await expect(
        parser.parse('http://file.pdf', 'report-1', onComplete, false, {
          num_threads: 4,
        }),
      ).rejects.toThrow('ECONNREFUSED');

      expect(logger.warn).not.toHaveBeenCalled();
    });

    test('parse throws after recovery attempt fails', async () => {
      doclingClient.health.mockResolvedValue(undefined);
      vi.mocked(envMocks.setupMock).mockResolvedValueOnce();
      const killSpy = vi.mocked((DoclingEnvironment as any).killProcessOnPort);
      killSpy.mockResolvedValue(undefined);

      // Both calls fail with ECONNREFUSED
      const econnRefusedError = new Error(
        'connect ECONNREFUSED 127.0.0.1:5001',
      );
      convertMock
        .mockRejectedValueOnce(econnRefusedError)
        .mockRejectedValueOnce(econnRefusedError);

      // Mock for startServer call during recovery
      mockDoclingEnvironment();

      const logger = makeLogger();
      const parser = new PDFParser({ logger, port: 5001 });
      await parser.init();

      const onComplete = vi.fn();
      await expect(
        parser.parse('http://file.pdf', 'report-1', onComplete, false, {
          num_threads: 4,
        }),
      ).rejects.toThrow('ECONNREFUSED');

      expect(logger.warn).toHaveBeenCalledWith(
        '[PDFParser] Connection refused, attempting server recovery...',
      );
    });

    test('parse throws non-ECONNREFUSED errors without recovery', async () => {
      doclingClient.health.mockResolvedValueOnce();
      vi.mocked(envMocks.setupMock).mockResolvedValueOnce();

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
      doclingClient.health.mockResolvedValueOnce();
      vi.mocked(envMocks.setupMock).mockResolvedValueOnce();

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

    test('parse recovers from ECONNREFUSED in error cause chain (ofetch style)', async () => {
      doclingClient.health.mockResolvedValue(undefined);
      vi.mocked(envMocks.setupMock).mockResolvedValueOnce();
      const killSpy = vi.mocked((DoclingEnvironment as any).killProcessOnPort);
      killSpy.mockResolvedValue(undefined);

      // ofetch-style error: ECONNREFUSED in cause, not in main message
      const causeError = new Error('connect ECONNREFUSED 127.0.0.1:5001');
      const fetchError = new Error('fetch failed', { cause: causeError });
      convertMock.mockRejectedValueOnce(fetchError).mockResolvedValueOnce('OK');

      mockDoclingEnvironment();

      const logger = makeLogger();
      const parser = new PDFParser({ logger, port: 5001 });
      await parser.init();

      const result = await parser.parse(
        'http://file.pdf',
        'report-1',
        vi.fn(),
        false,
        { num_threads: 4 },
      );

      expect(logger.warn).toHaveBeenCalledWith(
        '[PDFParser] Connection refused, attempting server recovery...',
      );
      expect(result).toBe('OK');
    });

    test('parse recovers from ECONNREFUSED via Error.code property', async () => {
      doclingClient.health.mockResolvedValue(undefined);
      vi.mocked(envMocks.setupMock).mockResolvedValueOnce();
      const killSpy = vi.mocked((DoclingEnvironment as any).killProcessOnPort);
      killSpy.mockResolvedValue(undefined);

      // Error object whose message does NOT contain ECONNREFUSED but code does
      const err = new Error('fetch failed') as Error & { code?: string };
      err.code = 'ECONNREFUSED';
      convertMock.mockRejectedValueOnce(err).mockResolvedValueOnce('OK');

      mockDoclingEnvironment();

      const logger = makeLogger();
      const parser = new PDFParser({ logger, port: 5001 });
      await parser.init();

      const result = await parser.parse(
        'http://file.pdf',
        'report-1',
        vi.fn(),
        false,
        { num_threads: 4 },
      );

      expect(result).toBe('OK');
      expect(logger.warn).toHaveBeenCalledWith(
        '[PDFParser] Connection refused, attempting server recovery...',
      );
    });

    test('parse recovers from ECONNREFUSED on plain object error via code', async () => {
      doclingClient.health.mockResolvedValue(undefined);
      vi.mocked(envMocks.setupMock).mockResolvedValueOnce();
      vi.mocked(
        (DoclingEnvironment as any).killProcessOnPort,
      ).mockResolvedValue(undefined);

      convertMock
        .mockRejectedValueOnce({ code: 'ECONNREFUSED' })
        .mockResolvedValueOnce('OK');

      mockDoclingEnvironment();

      const logger = makeLogger();
      const parser = new PDFParser({ logger, port: 5001 });
      await parser.init();

      const result = await parser.parse(
        'http://file.pdf',
        'report-1',
        vi.fn(),
        false,
        { num_threads: 4 },
      );

      expect(result).toBe('OK');
    });

    test('parse recovers from ECONNREFUSED on plain object error via message', async () => {
      doclingClient.health.mockResolvedValue(undefined);
      vi.mocked(envMocks.setupMock).mockResolvedValueOnce();
      vi.mocked(
        (DoclingEnvironment as any).killProcessOnPort,
      ).mockResolvedValue(undefined);

      convertMock
        .mockRejectedValueOnce({ message: 'connect ECONNREFUSED 127.0.0.1' })
        .mockResolvedValueOnce('OK');

      mockDoclingEnvironment();

      const logger = makeLogger();
      const parser = new PDFParser({ logger, port: 5001 });
      await parser.init();

      const result = await parser.parse(
        'http://file.pdf',
        'report-1',
        vi.fn(),
        false,
        { num_threads: 4 },
      );

      expect(result).toBe('OK');
    });

    test('parse recovers from ECONNREFUSED on plain object error via cause chain', async () => {
      doclingClient.health.mockResolvedValue(undefined);
      vi.mocked(envMocks.setupMock).mockResolvedValueOnce();
      vi.mocked(
        (DoclingEnvironment as any).killProcessOnPort,
      ).mockResolvedValue(undefined);

      convertMock
        .mockRejectedValueOnce({
          cause: { code: 'ECONNREFUSED' },
        })
        .mockResolvedValueOnce('OK');

      mockDoclingEnvironment();

      const logger = makeLogger();
      const parser = new PDFParser({ logger, port: 5001 });
      await parser.init();

      const result = await parser.parse(
        'http://file.pdf',
        'report-1',
        vi.fn(),
        false,
        { num_threads: 4 },
      );

      expect(result).toBe('OK');
    });

    test('isReady returns true when health check succeeds', async () => {
      doclingClient.health.mockResolvedValue(undefined);

      const logger = makeLogger();
      const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
      await parser.init();

      await expect(parser.isReady()).resolves.toBe(true);
    });

    test('ensureReady throws when parser is not initialized', async () => {
      const logger = makeLogger();
      const parser = new PDFParser({ logger, port: 5001 });

      await expect(parser.ensureReady()).rejects.toThrow(
        'PDFParser is not initialized',
      );
    });

    test('recoverServer reuses in-flight recovery promise for concurrent calls', async () => {
      doclingClient.health
        .mockResolvedValueOnce(undefined) // init
        .mockRejectedValueOnce(new Error('down')) // ensureReady #1
        .mockRejectedValueOnce(new Error('down')) // ensureReady #2
        .mockResolvedValue(undefined); // waitForServerReady during restart
      vi.mocked(envMocks.setupMock).mockResolvedValue(undefined);

      // Delay startServer so both recoverServer calls overlap
      let resolveStart: () => void;
      const startGate = new Promise<void>((resolve) => {
        resolveStart = resolve;
      });
      const startServerMock = vi
        .fn<() => Promise<void>>()
        .mockImplementation(() => startGate);
      mockDoclingEnvironment(startServerMock);

      const logger = makeLogger();
      const parser = new PDFParser({ logger, port: 5001 });
      await parser.init();

      const p1 = parser.ensureReady();
      const p2 = parser.ensureReady();

      // Let the concurrent call hit the "already in progress" branch
      await Promise.resolve();
      await Promise.resolve();

      resolveStart!();
      await Promise.all([p1, p2]);

      expect(startServerMock).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        '[PDFParser] Server recovery already in progress...',
      );
    });

    test('parse throws immediately when abortSignal is already aborted', async () => {
      doclingClient.health.mockResolvedValueOnce();
      vi.mocked(envMocks.setupMock).mockResolvedValueOnce();

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

  describe('strategy-based flow', () => {
    test('parse routes to strategy flow when strategySamplerModel is provided', async () => {
      doclingClient.health.mockResolvedValueOnce();

      const mockReport = {
        components: [],
        total: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };
      convertWithStrategyMock.mockResolvedValueOnce({
        strategy: {
          method: 'ocrmac',
          reason: 'Sampling skipped',
          sampledPages: 0,
          totalPages: 0,
        },
        tokenUsageReport: mockReport,
      });

      const logger = makeLogger();
      const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
      await parser.init();

      const fakeModel = {} as any;
      const result = await parser.parse(
        'http://file.pdf',
        'report-1',
        vi.fn(),
        false,
        { strategySamplerModel: fakeModel },
      );

      expect(convertWithStrategyMock).toHaveBeenCalledWith(
        'http://file.pdf',
        'report-1',
        expect.any(Function),
        false,
        { strategySamplerModel: fakeModel },
        undefined,
      );
      expect(result).toBe(mockReport);
      // Should NOT call legacy convert
      expect(convertMock).not.toHaveBeenCalled();
    });

    test('parse routes to strategy flow when forcedMethod is provided', async () => {
      doclingClient.health.mockResolvedValueOnce();

      convertWithStrategyMock.mockResolvedValueOnce({
        strategy: {
          method: 'vlm',
          reason: 'Forced: vlm',
          sampledPages: 0,
          totalPages: 0,
        },
        tokenUsageReport: null,
      });

      const logger = makeLogger();
      const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
      await parser.init();

      const result = await parser.parse(
        'http://file.pdf',
        'report-1',
        vi.fn(),
        true,
        { forcedMethod: 'vlm' },
      );

      expect(convertWithStrategyMock).toHaveBeenCalled();
      expect(result).toBeNull();
      expect(convertMock).not.toHaveBeenCalled();
    });

    test('parse routes to strategy flow when Review Assistance is enabled', async () => {
      doclingClient.health.mockResolvedValueOnce();

      convertWithStrategyMock.mockResolvedValueOnce({
        strategy: {
          method: 'ocrmac',
          reason: 'Sampling skipped',
          sampledPages: 0,
          totalPages: 0,
        },
        tokenUsageReport: null,
      });

      const logger = makeLogger();
      const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
      await parser.init();

      const result = await parser.parse(
        'http://file.pdf',
        'report-1',
        vi.fn(),
        false,
        { reviewAssistance: true },
      );

      expect(convertWithStrategyMock).toHaveBeenCalled();
      expect(convertMock).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    test('parse uses legacy flow when Review Assistance object is disabled', async () => {
      doclingClient.health.mockResolvedValueOnce();
      convertMock.mockResolvedValueOnce('legacy-result');

      const logger = makeLogger();
      const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
      await parser.init();

      const result = await parser.parse(
        'http://file.pdf',
        'report-1',
        vi.fn(),
        false,
        { reviewAssistance: {} },
      );

      expect(convertMock).toHaveBeenCalled();
      expect(convertWithStrategyMock).not.toHaveBeenCalled();
      expect(result).toBe('legacy-result');
    });

    test('parse returns null tokenUsageReport from strategy flow', async () => {
      doclingClient.health.mockResolvedValueOnce();

      convertWithStrategyMock.mockResolvedValueOnce({
        strategy: {
          method: 'vlm',
          reason: 'Korean-Hanja mix detected',
          sampledPages: 3,
          totalPages: 50,
        },
        tokenUsageReport: null,
      });

      const logger = makeLogger();
      const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
      await parser.init();

      const result = await parser.parse(
        'file:///tmp/doc.pdf',
        'report-2',
        vi.fn(),
        false,
        { forcedMethod: 'vlm', vlmProcessorModel: {} as any },
      );

      expect(result).toBeNull();
    });

    test('strategy flow recovers from ECONNREFUSED on local server', async () => {
      doclingClient.health.mockResolvedValue(undefined);
      vi.mocked(envMocks.setupMock).mockResolvedValueOnce();
      const killSpy = vi.mocked((DoclingEnvironment as any).killProcessOnPort);
      killSpy.mockResolvedValue(undefined);

      // First call fails with ECONNREFUSED, second succeeds
      const econnRefusedError = new Error(
        'connect ECONNREFUSED 127.0.0.1:5001',
      );
      convertWithStrategyMock
        .mockRejectedValueOnce(econnRefusedError)
        .mockResolvedValueOnce({
          strategy: {
            method: 'ocrmac',
            reason: 'Sampling skipped',
            sampledPages: 0,
            totalPages: 0,
          },
          tokenUsageReport: null,
        });

      mockDoclingEnvironment();

      const logger = makeLogger();
      const parser = new PDFParser({ logger, port: 5001 });
      await parser.init();

      const result = await parser.parse(
        'http://file.pdf',
        'report-1',
        vi.fn(),
        false,
        { forcedMethod: 'ocrmac' },
      );

      expect(logger.warn).toHaveBeenCalledWith(
        '[PDFParser] Connection refused, attempting server recovery...',
      );
      expect(result).toBeNull();
    });

    test('strategy flow does not recover on external server', async () => {
      doclingClient.health.mockResolvedValueOnce();

      const econnRefusedError = new Error(
        'connect ECONNREFUSED 127.0.0.1:5001',
      );
      convertWithStrategyMock.mockRejectedValueOnce(econnRefusedError);

      const logger = makeLogger();
      const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
      await parser.init();

      await expect(
        parser.parse('http://file.pdf', 'report-1', vi.fn(), false, {
          forcedMethod: 'ocrmac',
        }),
      ).rejects.toThrow('ECONNREFUSED');

      expect(logger.warn).not.toHaveBeenCalled();
    });

    test('strategy flow throws immediately when abortSignal is aborted', async () => {
      doclingClient.health.mockResolvedValueOnce();
      vi.mocked(envMocks.setupMock).mockResolvedValueOnce();

      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      convertWithStrategyMock.mockRejectedValueOnce(abortError);

      const logger = makeLogger();
      const parser = new PDFParser({ logger, port: 5001 });
      await parser.init();

      const abortController = new AbortController();
      abortController.abort();

      await expect(
        parser.parse(
          'http://file.pdf',
          'report-1',
          vi.fn(),
          false,
          { forcedMethod: 'ocrmac' },
          abortController.signal,
        ),
      ).rejects.toThrow('Aborted');

      expect(logger.warn).not.toHaveBeenCalled();
    });

    test('strategy flow throws after recovery attempt exhausted', async () => {
      doclingClient.health.mockResolvedValue(undefined);
      vi.mocked(envMocks.setupMock).mockResolvedValueOnce();
      const killSpy = vi.mocked((DoclingEnvironment as any).killProcessOnPort);
      killSpy.mockResolvedValue(undefined);

      const econnRefusedError = new Error(
        'connect ECONNREFUSED 127.0.0.1:5001',
      );
      convertWithStrategyMock
        .mockRejectedValueOnce(econnRefusedError)
        .mockRejectedValueOnce(econnRefusedError);

      mockDoclingEnvironment();

      const logger = makeLogger();
      const parser = new PDFParser({ logger, port: 5001 });
      await parser.init();

      await expect(
        parser.parse('http://file.pdf', 'report-1', vi.fn(), false, {
          forcedMethod: 'ocrmac',
        }),
      ).rejects.toThrow('ECONNREFUSED');
    });

    test('strategy flow passes enableImagePdfFallback=true for local server', async () => {
      doclingClient.health.mockResolvedValueOnce();
      vi.mocked(envMocks.setupMock).mockResolvedValueOnce();

      convertWithStrategyMock.mockResolvedValueOnce({
        strategy: {
          method: 'ocrmac',
          reason: 'Sampling skipped',
          sampledPages: 0,
          totalPages: 0,
        },
        tokenUsageReport: null,
      });

      const logger = makeLogger();
      const parser = new PDFParser({
        logger,
        port: 5001,
        enableImagePdfFallback: true,
      });
      await parser.init();

      await parser.parse('http://file.pdf', 'report-1', vi.fn(), false, {
        forcedMethod: 'ocrmac',
      });

      // PDFConverter should be created with enableImagePdfFallback=true
      expect(PDFConverter).toHaveBeenCalledWith(
        logger,
        expect.any(Object),
        true,
        expect.any(Number),
      );
    });

    test('strategy flow uses legacy flow when neither strategySamplerModel nor forcedMethod set', async () => {
      doclingClient.health.mockResolvedValueOnce();
      convertMock.mockResolvedValueOnce('legacy-result');

      const logger = makeLogger();
      const parser = new PDFParser({ logger, baseUrl: 'http://example.com' });
      await parser.init();

      const result = await parser.parse(
        'http://file.pdf',
        'report-1',
        vi.fn(),
        false,
        { num_threads: 4 },
      );

      expect(convertMock).toHaveBeenCalled();
      expect(convertWithStrategyMock).not.toHaveBeenCalled();
      expect(result).toBe('legacy-result');
    });
  });
});
