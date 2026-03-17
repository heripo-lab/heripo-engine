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
    test('should setup python env and start server when port is not in use', async () => {
      const mockServerInstance = {
        isPortInUse: vi.fn().mockResolvedValue(false),
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
        killExistingProcess: false,
      });

      await env.setup();

      expect(mockPythonInstance.setup).toHaveBeenCalled();
      expect(mockServerInstance.isPortInUse).toHaveBeenCalled();
      expect(mockServerInstance.start).toHaveBeenCalledWith(false);
      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Setting up Python environment...',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Setup completed',
      );
    });

    test('should reuse existing server when port is in use and killExistingProcess is false', async () => {
      const mockServerInstance = {
        isPortInUse: vi.fn().mockResolvedValue(true),
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
        killExistingProcess: false,
      });

      await env.setup();

      expect(mockServerInstance.start).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        '[DoclingEnvironment] Reusing existing server on port',
        8080,
      );
    });

    test('should start server when port is in use and killExistingProcess is true', async () => {
      const mockServerInstance = {
        isPortInUse: vi.fn().mockResolvedValue(true),
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

      await env.setup();

      expect(mockServerInstance.start).toHaveBeenCalledWith(true);
    });

    test('should propagate python setup error', async () => {
      const mockServerInstance = {
        isPortInUse: vi.fn(),
        start: vi.fn(),
      };
      const mockPythonInstance = {
        setup: vi.fn().mockRejectedValue(new Error('Python setup failed')),
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
        killExistingProcess: false,
      });

      await expect(env.setup()).rejects.toThrow('Python setup failed');
    });

    test('should propagate server start error', async () => {
      const mockServerInstance = {
        isPortInUse: vi.fn().mockResolvedValue(false),
        start: vi.fn().mockRejectedValue(new Error('Server start failed')),
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

      await expect(env.setup()).rejects.toThrow('Server start failed');
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
