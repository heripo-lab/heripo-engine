import type { LoggerMethods } from '@heripo/logger';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { DoclingEnvironment } from './docling-environment';

vi.mock('./python-environment', () => ({
  PythonEnvironment: vi.fn(),
}));

vi.mock('./docling-server', () => {
  const DoclingServer = vi.fn();
  (DoclingServer as any).killProcessOnPort = vi.fn();
  return { DoclingServer };
});

const { PythonEnvironment } = await import('./python-environment');
const MockPythonEnvironment = vi.mocked(PythonEnvironment);

const { DoclingServer } = await import('./docling-server');
const MockDoclingServer = vi.mocked(DoclingServer);

function createMockLogger(): LoggerMethods {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('DoclingEnvironment', () => {
  let logger: LoggerMethods;

  beforeEach(() => {
    logger = createMockLogger();
    MockPythonEnvironment.mockClear();
    MockDoclingServer.mockClear();
    (MockDoclingServer as any).killProcessOnPort.mockClear();
  });

  describe('constructor', () => {
    test('should create PythonEnvironment and DoclingServer with correct params', () => {
      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      expect(env).toBeDefined();
      expect(MockPythonEnvironment).toHaveBeenCalledWith(logger, '/test/venv');
      expect(MockDoclingServer).toHaveBeenCalledWith(
        logger,
        '/test/venv',
        8080,
      );
    });
  });

  describe('setup', () => {
    const ownListener = {
      pid: 7,
      uid: 501,
      command: '/py /test/venv/bin/docling-serve run',
    };

    function setupWith(
      server: Record<string, unknown>,
      options: {
        killExistingProcess?: boolean;
        pythonSetup?: () => unknown;
      } = {},
    ) {
      const mockPythonInstance = { setup: vi.fn(options.pythonSetup) };
      const mockServerInstance = {
        findListeners: vi.fn().mockResolvedValue([]),
        isOwnListener: vi.fn().mockReturnValue(true),
        checkApiKeyEnforcement: vi.fn().mockResolvedValue('enforced'),
        stopOwnServer: vi.fn().mockResolvedValue(true),
        start: vi.fn(),
        ...server,
      };
      MockPythonEnvironment.mockImplementation(function () {
        return mockPythonInstance as any;
      });
      MockDoclingServer.mockImplementation(function () {
        return mockServerInstance as any;
      });
      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: options.killExistingProcess ?? false,
      });
      return { env, mockPythonInstance, mockServerInstance };
    }

    test('should setup python env and start server when no listener is visible', async () => {
      const { env, mockPythonInstance, mockServerInstance } = setupWith({});

      await env.setup();

      expect(mockPythonInstance.setup).toHaveBeenCalled();
      expect(mockServerInstance.findListeners).toHaveBeenCalled();
      expect(mockServerInstance.start).toHaveBeenCalledWith(false);
      expect(mockServerInstance.checkApiKeyEnforcement).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Setting up Python environment...',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Setup completed',
      );
    });

    test('should reuse this venv server when it enforces the API key', async () => {
      const { env, mockServerInstance } = setupWith({
        findListeners: vi.fn().mockResolvedValue([ownListener]),
      });

      await env.setup();

      expect(mockServerInstance.isOwnListener).toHaveBeenCalledWith(
        ownListener,
      );
      expect(mockServerInstance.start).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Reusing existing server on port',
        8080,
      );
    });

    test('should restart this venv server when it does not enforce the API key', async () => {
      const { env, mockServerInstance } = setupWith({
        findListeners: vi.fn().mockResolvedValue([ownListener]),
        checkApiKeyEnforcement: vi.fn().mockResolvedValue('not-enforced'),
      });

      await env.setup();

      expect(mockServerInstance.stopOwnServer).toHaveBeenCalled();
      expect(mockServerInstance.start).toHaveBeenCalledWith(false);
      expect(logger.warn).toHaveBeenCalledWith(
        '[DoclingEnvironment] Existing server on port',
        8080,
        'does not enforce the API key; restarting it',
      );
    });

    test('should refuse a port held by another process without probing or stopping it', async () => {
      const { env, mockServerInstance } = setupWith({
        findListeners: vi.fn().mockResolvedValue([{ ...ownListener, pid: 99 }]),
        isOwnListener: vi.fn().mockReturnValue(false),
      });

      await expect(env.setup()).rejects.toThrow(
        'Port 8080 is in use by another process (pid 99); not reusing or stopping it',
      );
      expect(mockServerInstance.checkApiKeyEnforcement).not.toHaveBeenCalled();
      expect(mockServerInstance.start).not.toHaveBeenCalled();
    });

    test('should neither reuse nor stop a server whose API key cannot be verified', async () => {
      const { env, mockServerInstance } = setupWith({
        findListeners: vi.fn().mockResolvedValue([ownListener]),
        checkApiKeyEnforcement: vi.fn().mockResolvedValue('unknown'),
      });

      await expect(env.setup()).rejects.toThrow(
        'Could not verify the API key of the server on port 8080; not reusing or stopping it',
      );
      expect(mockServerInstance.stopOwnServer).not.toHaveBeenCalled();
      expect(mockServerInstance.start).not.toHaveBeenCalled();
    });

    test('should start server when killExistingProcess is true', async () => {
      const { env, mockServerInstance } = setupWith(
        { findListeners: vi.fn().mockResolvedValue([ownListener]) },
        { killExistingProcess: true },
      );

      await env.setup();

      expect(mockServerInstance.start).toHaveBeenCalledWith(true);
      expect(mockServerInstance.checkApiKeyEnforcement).not.toHaveBeenCalled();
    });

    test('should propagate python setup error', async () => {
      const { env } = setupWith(
        {},
        {
          pythonSetup: () => Promise.reject(new Error('Python setup failed')),
        },
      );

      await expect(env.setup()).rejects.toThrow('Python setup failed');
    });

    test('should propagate server start error', async () => {
      const { env } = setupWith({
        start: vi.fn().mockRejectedValue(new Error('Server start failed')),
      });

      await expect(env.setup()).rejects.toThrow('Server start failed');
    });
  });

  describe('stopOwnServer', () => {
    test('should delegate to server.stopOwnServer', async () => {
      const stopOwnServer = vi.fn().mockResolvedValue(false);
      MockPythonEnvironment.mockImplementation(function () {
        return { setup: vi.fn() } as any;
      });
      MockDoclingServer.mockImplementation(function () {
        return { stopOwnServer } as any;
      });
      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.stopOwnServer()).resolves.toBe(false);
    });
  });

  describe('assertServerOwnership', () => {
    test('should delegate to server.assertOwnListener', async () => {
      const assertOwnListener = vi.fn().mockResolvedValue(undefined);
      MockPythonEnvironment.mockImplementation(function () {
        return { setup: vi.fn() } as any;
      });
      MockDoclingServer.mockImplementation(function () {
        return { assertOwnListener } as any;
      });
      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await env.assertServerOwnership();

      expect(assertOwnListener).toHaveBeenCalled();
    });
  });

  describe('startServer', () => {
    test('should delegate to server.start with killExistingProcess flag', async () => {
      const mockServerInstance = {
        isPortInUse: vi.fn(),
        start: vi.fn(),
      };
      const mockPythonInstance = { setup: vi.fn() };

      MockPythonEnvironment.mockImplementation(function () {
        return mockPythonInstance as any;
      });
      MockDoclingServer.mockImplementation(function () {
        return mockServerInstance as any;
      });

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: true,
      });

      await env.startServer();

      expect(mockServerInstance.start).toHaveBeenCalledWith(true);
    });

    test('should propagate error from server.start', async () => {
      const mockServerInstance = {
        isPortInUse: vi.fn(),
        start: vi.fn().mockRejectedValue(new Error('Start failed')),
      };
      const mockPythonInstance = { setup: vi.fn() };

      MockPythonEnvironment.mockImplementation(function () {
        return mockPythonInstance as any;
      });
      MockDoclingServer.mockImplementation(function () {
        return mockServerInstance as any;
      });

      const env = new DoclingEnvironment({
        logger,
        venvPath: '/test/venv',
        port: 8080,
        killExistingProcess: false,
      });

      await expect(env.startServer()).rejects.toThrow('Start failed');
    });
  });

  describe('killProcessOnPort', () => {
    test('should delegate to DoclingServer.killProcessOnPort', async () => {
      await DoclingEnvironment.killProcessOnPort(logger, 8080);

      expect((MockDoclingServer as any).killProcessOnPort).toHaveBeenCalledWith(
        logger,
        8080,
      );
    });
  });
});
