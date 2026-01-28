import type { Server } from 'node:http';

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { LocalFileServer } from './local-file-server';

vi.mock('node:fs', () => ({
  createReadStream: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('node:http', () => ({
  createServer: vi.fn(),
}));

vi.mock('node:path', () => ({
  basename: vi.fn(),
}));

describe('LocalFileServer', () => {
  let mockServer: {
    listen: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    address: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };
  let requestHandler: (req: any, res: any) => void;

  beforeEach(() => {
    vi.clearAllMocks();

    mockServer = {
      listen: vi.fn(),
      close: vi.fn(),
      address: vi.fn(),
      on: vi.fn(),
    };

    vi.mocked(createServer).mockImplementation((handler: any) => {
      requestHandler = handler;
      return mockServer as unknown as Server;
    });

    vi.mocked(basename).mockReturnValue('test.pdf');
    vi.mocked(statSync).mockReturnValue({ size: 1024 } as any);
  });

  describe('start', () => {
    test('should start server and return URL', async () => {
      mockServer.listen.mockImplementation(
        (_port: number, _host: string, callback: () => void) => {
          callback();
          return mockServer;
        },
      );
      mockServer.address.mockReturnValue({
        port: 12345,
        family: 'IPv4',
        address: '127.0.0.1',
      });

      const server = new LocalFileServer();
      const url = await server.start('/path/to/test.pdf');

      expect(url).toBe('http://127.0.0.1:12345/test.pdf');
      expect(createServer).toHaveBeenCalled();
      expect(mockServer.listen).toHaveBeenCalledWith(
        0,
        '127.0.0.1',
        expect.any(Function),
      );
    });

    test('should reject if server address is not object', async () => {
      mockServer.listen.mockImplementation(
        (_port: number, _host: string, callback: () => void) => {
          callback();
          return mockServer;
        },
      );
      mockServer.address.mockReturnValue(null);

      const server = new LocalFileServer();

      await expect(server.start('/path/to/test.pdf')).rejects.toThrow(
        'Failed to get server address',
      );
    });

    test('should reject on server error', async () => {
      mockServer.on.mockImplementation(
        (event: string, handler: (err: Error) => void) => {
          if (event === 'error') {
            handler(new Error('Server error'));
          }
          return mockServer;
        },
      );

      const server = new LocalFileServer();

      await expect(server.start('/path/to/test.pdf')).rejects.toThrow(
        'Server error',
      );
    });

    test('should serve file on matching URL', async () => {
      mockServer.listen.mockImplementation(
        (_port: number, _host: string, callback: () => void) => {
          callback();
          return mockServer;
        },
      );
      mockServer.address.mockReturnValue({
        port: 12345,
        family: 'IPv4',
        address: '127.0.0.1',
      });

      const mockStream = { pipe: vi.fn() };
      vi.mocked(createReadStream).mockReturnValue(mockStream as any);

      const server = new LocalFileServer();
      await server.start('/path/to/test.pdf');

      const mockReq = { url: '/test.pdf' };
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      };

      requestHandler(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': 1024,
      });
      expect(createReadStream).toHaveBeenCalledWith('/path/to/test.pdf');
      expect(mockStream.pipe).toHaveBeenCalledWith(mockRes);
    });

    test('should return 404 on non-matching URL', async () => {
      mockServer.listen.mockImplementation(
        (_port: number, _host: string, callback: () => void) => {
          callback();
          return mockServer;
        },
      );
      mockServer.address.mockReturnValue({
        port: 12345,
        family: 'IPv4',
        address: '127.0.0.1',
      });

      const server = new LocalFileServer();
      await server.start('/path/to/test.pdf');

      const mockReq = { url: '/wrong.pdf' };
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      };

      requestHandler(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalledWith('Not Found');
    });
  });

  describe('stop', () => {
    test('should stop server', async () => {
      mockServer.listen.mockImplementation(
        (_port: number, _host: string, callback: () => void) => {
          callback();
          return mockServer;
        },
      );
      mockServer.address.mockReturnValue({
        port: 12345,
        family: 'IPv4',
        address: '127.0.0.1',
      });
      mockServer.close.mockImplementation((callback: () => void) => {
        callback();
        return mockServer;
      });

      const server = new LocalFileServer();
      await server.start('/path/to/test.pdf');
      await server.stop();

      expect(mockServer.close).toHaveBeenCalled();
    });

    test('should resolve immediately if server not started', async () => {
      const server = new LocalFileServer();
      await server.stop();

      expect(mockServer.close).not.toHaveBeenCalled();
    });
  });
});
