import type { ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { rename } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  jqExtractBase64PngStrings,
  jqExtractBase64PngStringsStreaming,
  jqReplaceBase64WithPaths,
  jqReplaceBase64WithPathsToFile,
  runJqFileJson,
  runJqFileLines,
  runJqFileToFile,
} from './jq';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:fs', () => ({
  createWriteStream: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  rename: vi.fn(),
}));

vi.mock('node:stream/promises', () => ({
  pipeline: vi.fn(),
}));

describe('jq utils', () => {
  let mockChild: {
    stdout: {
      setEncoding: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      pipe?: ReturnType<typeof vi.fn>;
    };
    stderr: {
      setEncoding: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    };
    on: ReturnType<typeof vi.fn>;
    exitCode: number | null;
  };
  let stdoutHandlers: Map<string, (chunk: string) => void>;
  let stderrHandlers: Map<string, (chunk: string) => void>;
  let childHandlers: Map<string, (arg: any) => void>;

  beforeEach(() => {
    stdoutHandlers = new Map();
    stderrHandlers = new Map();
    childHandlers = new Map();

    mockChild = {
      stdout: {
        setEncoding: vi.fn(),
        on: vi.fn((event: string, handler: (chunk: string) => void) => {
          stdoutHandlers.set(event, handler);
        }),
      },
      stderr: {
        setEncoding: vi.fn(),
        on: vi.fn((event: string, handler: (chunk: string) => void) => {
          stderrHandlers.set(event, handler);
        }),
      },
      on: vi.fn((event: string, handler: (arg: any) => void) => {
        childHandlers.set(event, handler);
      }),
      exitCode: null,
    };

    vi.mocked(spawn).mockReturnValue(
      mockChild as unknown as ChildProcess & Readable,
    );
  });

  describe('runJqFileJson', () => {
    test('should successfully run jq and parse JSON output', async () => {
      const promise = runJqFileJson('.foo', '/path/to/file.json');

      const closeHandler = childHandlers.get('close');
      const stdoutHandler = stdoutHandlers.get('data');

      stdoutHandler?.('{"result":');
      stdoutHandler?.(' 123}\n');
      closeHandler?.(0);

      const result = await promise;

      expect(result).toEqual({ result: 123 });
      expect(spawn).toHaveBeenCalledWith(
        'jq',
        ['-c', '.foo', '/path/to/file.json'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        },
      );
      expect(mockChild.stdout.setEncoding).toHaveBeenCalledWith('utf-8');
      expect(mockChild.stderr.setEncoding).toHaveBeenCalledWith('utf-8');
    });

    test('should use JQ_PATH environment variable when set', async () => {
      const originalJqPath = process.env.JQ_PATH;
      process.env.JQ_PATH = '/custom/path/to/jq';

      const promise = runJqFileJson('.bar', '/path/to/file.json');

      const closeHandler = childHandlers.get('close');
      const stdoutHandler = stdoutHandlers.get('data');

      stdoutHandler?.('"test"');
      closeHandler?.(0);

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        '/custom/path/to/jq',
        ['-c', '.bar', '/path/to/file.json'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        },
      );

      if (originalJqPath === undefined) {
        delete process.env.JQ_PATH;
      } else {
        process.env.JQ_PATH = originalJqPath;
      }
    });

    test('should use default jq when JQ_PATH is empty string', async () => {
      const originalJqPath = process.env.JQ_PATH;
      process.env.JQ_PATH = '  ';

      const promise = runJqFileJson('.test', '/path/to/file.json');

      const closeHandler = childHandlers.get('close');
      const stdoutHandler = stdoutHandlers.get('data');

      stdoutHandler?.('null');
      closeHandler?.(0);

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'jq',
        ['-c', '.test', '/path/to/file.json'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        },
      );

      if (originalJqPath === undefined) {
        delete process.env.JQ_PATH;
      } else {
        process.env.JQ_PATH = originalJqPath;
      }
    });

    test('should reject when spawn emits error', async () => {
      const promise = runJqFileJson('.foo', '/path/to/file.json');

      const errorHandler = childHandlers.get('error');
      const spawnError = new Error('spawn ENOENT');
      errorHandler?.(spawnError);

      await expect(promise).rejects.toThrow('spawn ENOENT');
    });

    test('should reject when jq exits with non-zero code and stderr', async () => {
      const promise = runJqFileJson('.invalid', '/path/to/file.json');

      const stderrHandler = stderrHandlers.get('data');
      const closeHandler = childHandlers.get('close');

      stderrHandler?.('jq: error: syntax error\n');
      closeHandler?.(1);

      await expect(promise).rejects.toThrow(
        'jq exited with code 1. Stderr: jq: error: syntax error\n',
      );
    });

    test('should reject when jq exits with non-zero code without stderr', async () => {
      const promise = runJqFileJson('.invalid', '/path/to/file.json');

      const closeHandler = childHandlers.get('close');
      closeHandler?.(2);

      await expect(promise).rejects.toThrow('jq exited with code 2.');
    });

    test('should reject when JSON parsing fails', async () => {
      const promise = runJqFileJson('.foo', '/path/to/file.json');

      const stdoutHandler = stdoutHandlers.get('data');
      const closeHandler = childHandlers.get('close');

      stdoutHandler?.('not valid json');
      closeHandler?.(0);

      await expect(promise).rejects.toThrow(
        /Failed to parse jq output as JSON\. Output length=14\./,
      );
    });

    test('should accumulate multiple stdout chunks', async () => {
      const promise = runJqFileJson('.items', '/path/to/file.json');

      const stdoutHandler = stdoutHandlers.get('data');
      const closeHandler = childHandlers.get('close');

      stdoutHandler?.('[1,');
      stdoutHandler?.('2,');
      stdoutHandler?.('3]');
      closeHandler?.(0);

      const result = await promise;

      expect(result).toEqual([1, 2, 3]);
    });

    test('should accumulate multiple stderr chunks', async () => {
      const promise = runJqFileJson('.invalid', '/path/to/file.json');

      const stderrHandler = stderrHandlers.get('data');
      const closeHandler = childHandlers.get('close');

      stderrHandler?.('error line 1\n');
      stderrHandler?.('error line 2\n');
      closeHandler?.(1);

      await expect(promise).rejects.toThrow(
        'jq exited with code 1. Stderr: error line 1\nerror line 2\n',
      );
    });

    test('should trim stdout before parsing JSON', async () => {
      const promise = runJqFileJson('.foo', '/path/to/file.json');

      const stdoutHandler = stdoutHandlers.get('data');
      const closeHandler = childHandlers.get('close');

      stdoutHandler?.('  {"value": 42}  \n\n  ');
      closeHandler?.(0);

      const result = await promise;

      expect(result).toEqual({ value: 42 });
    });
  });

  describe('runJqFileToFile', () => {
    test('should pipe jq stdout to output file', async () => {
      const mockWs = {} as Writable;
      vi.mocked(createWriteStream).mockReturnValue(mockWs as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);

      const promise = runJqFileToFile('.data', '/input.json', '/output.json');

      // Simulate jq exiting successfully
      mockChild.exitCode = 0;
      childHandlers.get('close')?.(0);

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'jq',
        ['.data', '/input.json'],
        expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
      );
      expect(createWriteStream).toHaveBeenCalledWith('/output.json');
      expect(pipeline).toHaveBeenCalledWith(mockChild.stdout, mockWs);
    });

    test('should reject when jq exits with non-zero code', async () => {
      const mockWs = {} as Writable;
      vi.mocked(createWriteStream).mockReturnValue(mockWs as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);

      const promise = runJqFileToFile(
        '.invalid',
        '/input.json',
        '/output.json',
      );

      stderrHandlers.get('data')?.('jq error\n');
      childHandlers.get('close')?.(1);

      await expect(promise).rejects.toThrow(
        'jq exited with code 1. Stderr: jq error\n',
      );
    });

    test('should reject when spawn emits error', async () => {
      const mockWs = { destroy: vi.fn() } as unknown as Writable;
      vi.mocked(createWriteStream).mockReturnValue(mockWs as any);
      vi.mocked(pipeline).mockImplementation(() => new Promise(() => {}));

      const promise = runJqFileToFile('.data', '/input.json', '/output.json');

      childHandlers.get('error')?.(new Error('spawn ENOENT'));

      await expect(promise).rejects.toThrow('spawn ENOENT');
    });

    test('should reject when pipeline fails', async () => {
      const mockWs = {} as Writable;
      vi.mocked(createWriteStream).mockReturnValue(mockWs as any);
      vi.mocked(pipeline).mockRejectedValue(new Error('pipe error'));

      const promise = runJqFileToFile('.data', '/input.json', '/output.json');

      await expect(promise).rejects.toThrow('pipe error');
    });

    test('should resolve via pipeline when exitCode is already 0', async () => {
      const mockWs = {} as Writable;
      vi.mocked(createWriteStream).mockReturnValue(mockWs as any);

      // Simulate jq already exited before pipeline resolves
      mockChild.exitCode = 0;
      vi.mocked(pipeline).mockResolvedValue(undefined);

      const promise = runJqFileToFile('.data', '/input.json', '/output.json');

      // The close handler also fires
      childHandlers.get('close')?.(0);

      await promise;
    });

    test('should reject via pipeline when exitCode is non-zero', async () => {
      const mockWs = {} as Writable;
      vi.mocked(createWriteStream).mockReturnValue(mockWs as any);

      mockChild.exitCode = 1;
      stderrHandlers.get('data')?.('error msg');
      vi.mocked(pipeline).mockResolvedValue(undefined);

      const promise = runJqFileToFile('.data', '/input.json', '/output.json');

      childHandlers.get('close')?.(1);

      await expect(promise).rejects.toThrow('jq exited with code 1');
    });

    test('should reject via pipeline when exitCode is non-zero without stderr', async () => {
      const mockWs = {} as Writable;
      vi.mocked(createWriteStream).mockReturnValue(mockWs as any);

      vi.mocked(pipeline).mockResolvedValue(undefined);

      const promise = runJqFileToFile('.data', '/input.json', '/output.json');

      // Set exitCode after handlers are registered, no stderr data sent
      mockChild.exitCode = 1;

      await expect(promise).rejects.toThrow('jq exited with code 1. ');
    });

    test('should reject via pipeline with stderr when exitCode is non-zero', async () => {
      const mockWs = {} as Writable;
      vi.mocked(createWriteStream).mockReturnValue(mockWs as any);

      vi.mocked(pipeline).mockResolvedValue(undefined);

      const promise = runJqFileToFile('.data', '/input.json', '/output.json');

      // Send stderr data and set exitCode AFTER handlers are registered
      stderrHandlers.get('data')?.('pipeline stderr');
      mockChild.exitCode = 2;

      await expect(promise).rejects.toThrow(
        'jq exited with code 2. Stderr: pipeline stderr',
      );
    });
  });

  describe('runJqFileLines', () => {
    test('should process each line via onLine callback', async () => {
      const lines: string[] = [];
      const promise = runJqFileLines('.[]', '/input.json', (line) => {
        lines.push(line);
      });

      stdoutHandlers.get('data')?.('line1\nline2\nline3\n');
      childHandlers.get('close')?.(0);

      await promise;

      expect(lines).toEqual(['line1', 'line2', 'line3']);
      expect(spawn).toHaveBeenCalledWith(
        'jq',
        ['-r', '.[]', '/input.json'],
        expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
      );
    });

    test('should handle data arriving across chunk boundaries', async () => {
      const lines: string[] = [];
      const promise = runJqFileLines('.[]', '/input.json', (line) => {
        lines.push(line);
      });

      stdoutHandlers.get('data')?.('par');
      stdoutHandlers.get('data')?.('tial_line\nsecond');
      stdoutHandlers.get('data')?.('_line\n');
      childHandlers.get('close')?.(0);

      await promise;

      expect(lines).toEqual(['partial_line', 'second_line']);
    });

    test('should process remaining buffer on close', async () => {
      const lines: string[] = [];
      const promise = runJqFileLines('.[]', '/input.json', (line) => {
        lines.push(line);
      });

      stdoutHandlers.get('data')?.('no_trailing_newline');
      childHandlers.get('close')?.(0);

      await promise;

      expect(lines).toEqual(['no_trailing_newline']);
    });

    test('should skip empty lines', async () => {
      const lines: string[] = [];
      const promise = runJqFileLines('.[]', '/input.json', (line) => {
        lines.push(line);
      });

      stdoutHandlers.get('data')?.('a\n\nb\n');
      childHandlers.get('close')?.(0);

      await promise;

      expect(lines).toEqual(['a', 'b']);
    });

    test('should reject when jq exits with non-zero code', async () => {
      const lines: string[] = [];
      const promise = runJqFileLines('.[]', '/input.json', (line) => {
        lines.push(line);
      });

      stderrHandlers.get('data')?.('parse error');
      childHandlers.get('close')?.(1);

      await expect(promise).rejects.toThrow(
        'jq exited with code 1. Stderr: parse error',
      );
    });

    test('should reject when jq exits with non-zero code without stderr', async () => {
      const lines: string[] = [];
      const promise = runJqFileLines('.[]', '/input.json', (line) => {
        lines.push(line);
      });

      childHandlers.get('close')?.(1);

      await expect(promise).rejects.toThrow('jq exited with code 1. ');
    });

    test('should reject when spawn emits error', async () => {
      const promise = runJqFileLines('.[]', '/input.json', vi.fn());

      childHandlers.get('error')?.(new Error('spawn failed'));

      await expect(promise).rejects.toThrow('spawn failed');
    });
  });

  describe('jqExtractBase64PngStrings', () => {
    test('should extract base64 PNG strings from JSON file', async () => {
      const promise = jqExtractBase64PngStrings('/path/to/file.json');

      const stdoutHandler = stdoutHandlers.get('data');
      const closeHandler = childHandlers.get('close');

      stdoutHandler?.(
        '["data:image/png;base64,abc123","data:image/png;base64,def456"]',
      );
      closeHandler?.(0);

      const result = await promise;

      expect(result).toEqual([
        'data:image/png;base64,abc123',
        'data:image/png;base64,def456',
      ]);
      expect(spawn).toHaveBeenCalledWith(
        'jq',
        expect.arrayContaining([
          '-c',
          expect.any(String),
          '/path/to/file.json',
        ]),
        expect.any(Object),
      );

      const jqProgram = vi.mocked(spawn).mock.calls[0][1][1];
      expect(jqProgram).toContain('select(type == "string"');
      expect(jqProgram).toContain('startswith("data:image/png;base64")');
    });
  });

  describe('jqExtractBase64PngStringsStreaming', () => {
    test('should stream each base64 image to onImage callback with index', async () => {
      const images: Array<{ data: string; index: number }> = [];
      const promise = jqExtractBase64PngStringsStreaming(
        '/path/to/file.json',
        (data, index) => {
          images.push({ data, index });
        },
      );

      const stdoutHandler = stdoutHandlers.get('data');
      const closeHandler = childHandlers.get('close');

      stdoutHandler?.('data:image/png;base64,abc123\n');
      stdoutHandler?.('data:image/png;base64,def456\n');
      closeHandler?.(0);

      const count = await promise;

      expect(count).toBe(2);
      expect(images).toEqual([
        { data: 'data:image/png;base64,abc123', index: 0 },
        { data: 'data:image/png;base64,def456', index: 1 },
      ]);

      // Should use -r flag for raw output
      expect(spawn).toHaveBeenCalledWith(
        'jq',
        expect.arrayContaining(['-r', expect.any(String)]),
        expect.any(Object),
      );
    });

    test('should return 0 when no images found', async () => {
      const images: Array<{ data: string; index: number }> = [];
      const promise = jqExtractBase64PngStringsStreaming(
        '/path/to/file.json',
        (data, index) => {
          images.push({ data, index });
        },
      );

      childHandlers.get('close')?.(0);

      const count = await promise;

      expect(count).toBe(0);
      expect(images).toEqual([]);
    });
  });

  describe('jqReplaceBase64WithPaths', () => {
    test('should replace base64 PNG data-URIs with file paths', async () => {
      const promise = jqReplaceBase64WithPaths(
        '/path/to/file.json',
        'images',
        'img',
      );

      const stdoutHandler = stdoutHandlers.get('data');
      const closeHandler = childHandlers.get('close');

      stdoutHandler?.('{"data":{"img":"images/img_0.png"},"count":1}');
      closeHandler?.(0);

      const result = await promise;

      expect(result).toEqual({
        data: { img: 'images/img_0.png' },
        count: 1,
      });
      expect(spawn).toHaveBeenCalledWith(
        'jq',
        expect.arrayContaining([
          '-c',
          expect.any(String),
          '/path/to/file.json',
        ]),
        expect.any(Object),
      );

      const jqProgram = vi.mocked(spawn).mock.calls[0][1][1];
      expect(jqProgram).toContain('reduce paths');
      expect(jqProgram).toContain('images/img_');
      expect(jqProgram).toContain('.counter');
    });
  });

  describe('jqReplaceBase64WithPathsToFile', () => {
    test('should pipe jq output to temp file and rename to target', async () => {
      const mockWs = {} as Writable;
      vi.mocked(createWriteStream).mockReturnValue(mockWs as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);
      vi.mocked(rename).mockResolvedValue(undefined);

      const promise = jqReplaceBase64WithPathsToFile(
        '/input.json',
        '/output.json',
        'images',
        'pic',
      );

      mockChild.exitCode = 0;
      childHandlers.get('close')?.(0);

      await promise;

      expect(createWriteStream).toHaveBeenCalledWith('/output.json.tmp');
      expect(rename).toHaveBeenCalledWith('/output.json.tmp', '/output.json');

      const jqProgram = vi.mocked(spawn).mock.calls[0][1][0];
      expect(jqProgram).toContain('reduce paths');
      expect(jqProgram).toContain('images/pic_');
      expect(jqProgram).toContain('.data');
    });

    test('should reject when jq fails', async () => {
      const mockWs = {} as Writable;
      vi.mocked(createWriteStream).mockReturnValue(mockWs as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);

      const promise = jqReplaceBase64WithPathsToFile(
        '/input.json',
        '/output.json',
        'images',
        'pic',
      );

      stderrHandlers.get('data')?.('error');
      childHandlers.get('close')?.(1);

      await expect(promise).rejects.toThrow('jq exited with code 1');
    });
  });
});
