import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';

import { spawn } from 'node:child_process';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  jqExtractBase64PngStrings,
  jqReplaceBase64WithPaths,
  runJqFileJson,
} from './jq';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

describe('jq utils', () => {
  let mockChild: {
    stdout: {
      setEncoding: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    };
    stderr: {
      setEncoding: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    };
    on: ReturnType<typeof vi.fn>;
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
        on: vi.fn((event, handler) => {
          stdoutHandlers.set(event, handler);
        }),
      },
      stderr: {
        setEncoding: vi.fn(),
        on: vi.fn((event, handler) => {
          stderrHandlers.set(event, handler);
        }),
      },
      on: vi.fn((event, handler) => {
        childHandlers.set(event, handler);
      }),
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
});
