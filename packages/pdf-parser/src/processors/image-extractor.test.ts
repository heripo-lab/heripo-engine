import type { LoggerMethods } from '@heripo/logger';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Transform } from 'node:stream';
import * as streamPromises from 'node:stream/promises';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as yauzl from 'yauzl';

import {
  jqExtractBase64PngStringsStreaming,
  jqReplaceBase64WithPathsToFile,
} from '../utils/jq';
import { ImageExtractor } from './image-extractor';

vi.mock('node:fs');
vi.mock('node:path');
vi.mock('node:stream/promises');
vi.mock('yauzl');
vi.mock('../utils/jq');

describe('ImageExtractor', () => {
  let mockLogger: LoggerMethods;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
    vi.mocked(path.extname).mockImplementation((p) => {
      const lastDot = p.lastIndexOf('.');
      return lastDot === -1 ? '' : p.slice(lastDot);
    });
  });

  describe('extractAndSaveDocumentsFromZip', () => {
    test('should successfully extract and process documents', async () => {
      const zipPath = '/test/input.zip';
      const extractDir = '/test/extract';
      const outputDir = '/test/output';

      setupSuccessfulZipExtraction([
        { fileName: 'test.json', isDirectory: false },
        { fileName: 'test.html', isDirectory: false },
      ]);

      vi.mocked(fs.readdirSync).mockReturnValue([
        'test.json',
        'test.html',
      ] as any);

      vi.mocked(jqExtractBase64PngStringsStreaming).mockResolvedValue(2);

      vi.mocked(jqReplaceBase64WithPathsToFile).mockResolvedValue(undefined);

      // Mock extractImagesFromHtmlStream via pipeline
      vi.mocked(streamPromises.pipeline).mockResolvedValue(undefined);

      await ImageExtractor.extractAndSaveDocumentsFromZip(
        mockLogger,
        zipPath,
        extractDir,
        outputDir,
      );

      expect(yauzl.open).toHaveBeenCalledWith(
        zipPath,
        { lazyEntries: true },
        expect.any(Function),
      );
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Extracting ZIP file'),
      );

      // Verify jq streaming functions called with correct args
      expect(jqExtractBase64PngStringsStreaming).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Function),
      );
      expect(jqReplaceBase64WithPathsToFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'images',
        'pic',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('picture images from JSON'),
      );
    });

    test('should handle directory entries in zip', async () => {
      const zipPath = '/test/input.zip';
      const extractDir = '/test/extract';
      const outputDir = '/test/output';

      setupSuccessfulZipExtraction([
        { fileName: 'dir/', isDirectory: true },
        { fileName: 'dir/test.json', isDirectory: false },
        { fileName: 'test.html', isDirectory: false },
      ]);

      vi.mocked(fs.readdirSync).mockReturnValue([
        'test.json',
        'test.html',
      ] as any);

      vi.mocked(jqExtractBase64PngStringsStreaming).mockResolvedValue(0);
      vi.mocked(jqReplaceBase64WithPathsToFile).mockResolvedValue(undefined);
      vi.mocked(streamPromises.pipeline).mockResolvedValue(undefined);

      await ImageExtractor.extractAndSaveDocumentsFromZip(
        mockLogger,
        zipPath,
        extractDir,
        outputDir,
      );

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('dir/'),
        expect.any(Object),
      );
    });

    test('should throw error when zip file cannot be opened', async () => {
      const zipPath = '/test/input.zip';
      const extractDir = '/test/extract';
      const outputDir = '/test/output';

      vi.mocked(yauzl.open).mockImplementation(
        (
          _path: string,
          _options: any,
          callback?: (err: Error | null, zipfile: any) => void,
        ) => {
          callback?.(new Error('Cannot open zip'), null as any);
        },
      );

      await expect(
        ImageExtractor.extractAndSaveDocumentsFromZip(
          mockLogger,
          zipPath,
          extractDir,
          outputDir,
        ),
      ).rejects.toThrow('Cannot open zip');
    });

    test('should throw error when zipfile is null', async () => {
      const zipPath = '/test/input.zip';
      const extractDir = '/test/extract';
      const outputDir = '/test/output';

      vi.mocked(yauzl.open).mockImplementation(
        (
          _path: string,
          _options: any,
          callback?: (err: Error | null, zipfile: any) => void,
        ) => {
          callback?.(null, null as any);
        },
      );

      await expect(
        ImageExtractor.extractAndSaveDocumentsFromZip(
          mockLogger,
          zipPath,
          extractDir,
          outputDir,
        ),
      ).rejects.toThrow('Failed to open zip file');
    });

    test('should throw error when read stream fails', async () => {
      const zipPath = '/test/input.zip';
      const extractDir = '/test/extract';
      const outputDir = '/test/output';

      setupZipExtractionWithStreamError('stream-error');

      await expect(
        ImageExtractor.extractAndSaveDocumentsFromZip(
          mockLogger,
          zipPath,
          extractDir,
          outputDir,
        ),
      ).rejects.toThrow('Failed to open read stream');
    });

    test('should throw error when read stream is null', async () => {
      const zipPath = '/test/input.zip';
      const extractDir = '/test/extract';
      const outputDir = '/test/output';

      setupZipExtractionWithStreamError('stream-null');

      await expect(
        ImageExtractor.extractAndSaveDocumentsFromZip(
          mockLogger,
          zipPath,
          extractDir,
          outputDir,
        ),
      ).rejects.toThrow('Failed to open read stream');
    });

    test('should handle write stream error', async () => {
      const zipPath = '/test/input.zip';
      const extractDir = '/test/extract';
      const outputDir = '/test/output';

      setupZipExtractionWithStreamError('write-error');

      await expect(
        ImageExtractor.extractAndSaveDocumentsFromZip(
          mockLogger,
          zipPath,
          extractDir,
          outputDir,
        ),
      ).rejects.toThrow('Write error');
    });

    test('should throw error when JSON file is missing', async () => {
      const zipPath = '/test/input.zip';
      const extractDir = '/test/extract';
      const outputDir = '/test/output';

      setupSuccessfulZipExtraction([
        { fileName: 'test.html', isDirectory: false },
      ]);

      vi.mocked(fs.readdirSync).mockReturnValue(['test.html'] as any);

      await expect(
        ImageExtractor.extractAndSaveDocumentsFromZip(
          mockLogger,
          zipPath,
          extractDir,
          outputDir,
        ),
      ).rejects.toThrow(
        'Expected one JSON and one HTML file in extracted directory',
      );
    });

    test('should throw error when HTML file is missing', async () => {
      const zipPath = '/test/input.zip';
      const extractDir = '/test/extract';
      const outputDir = '/test/output';

      setupSuccessfulZipExtraction([
        { fileName: 'test.json', isDirectory: false },
      ]);

      vi.mocked(fs.readdirSync).mockReturnValue(['test.json'] as any);

      await expect(
        ImageExtractor.extractAndSaveDocumentsFromZip(
          mockLogger,
          zipPath,
          extractDir,
          outputDir,
        ),
      ).rejects.toThrow(
        'Expected one JSON and one HTML file in extracted directory',
      );
    });

    test('should handle case-insensitive file extensions', async () => {
      const zipPath = '/test/input.zip';
      const extractDir = '/test/extract';
      const outputDir = '/test/output';

      setupSuccessfulZipExtraction([
        { fileName: 'test.JSON', isDirectory: false },
        { fileName: 'test.HTML', isDirectory: false },
      ]);

      vi.mocked(fs.readdirSync).mockReturnValue([
        'test.JSON',
        'test.HTML',
      ] as any);

      vi.mocked(jqExtractBase64PngStringsStreaming).mockResolvedValue(0);
      vi.mocked(jqReplaceBase64WithPathsToFile).mockResolvedValue(undefined);
      vi.mocked(streamPromises.pipeline).mockResolvedValue(undefined);

      await ImageExtractor.extractAndSaveDocumentsFromZip(
        mockLogger,
        zipPath,
        extractDir,
        outputDir,
      );

      expect(jqExtractBase64PngStringsStreaming).toHaveBeenCalled();
    });

    test('should handle jq extraction failure and rethrow', async () => {
      const zipPath = '/test/input.zip';
      const extractDir = '/test/extract';
      const outputDir = '/test/output';

      setupSuccessfulZipExtraction([
        { fileName: 'test.json', isDirectory: false },
        { fileName: 'test.html', isDirectory: false },
      ]);

      vi.mocked(fs.readdirSync).mockReturnValue([
        'test.json',
        'test.html',
      ] as any);

      vi.mocked(jqExtractBase64PngStringsStreaming).mockRejectedValue(
        new Error('jq extraction failed'),
      );

      await expect(
        ImageExtractor.extractAndSaveDocumentsFromZip(
          mockLogger,
          zipPath,
          extractDir,
          outputDir,
        ),
      ).rejects.toThrow('jq extraction failed');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to extract images from JSON using jq'),
        expect.any(Error),
      );
    });

    test('should invoke extractBase64ImageToFile via streaming callback', async () => {
      const zipPath = '/test/input.zip';
      const extractDir = '/test/extract';
      const outputDir = '/test/output';

      setupSuccessfulZipExtraction([
        { fileName: 'test.json', isDirectory: false },
        { fileName: 'test.html', isDirectory: false },
      ]);

      vi.mocked(fs.readdirSync).mockReturnValue([
        'test.json',
        'test.html',
      ] as any);

      // Capture the onImage callback and invoke it with test data
      vi.mocked(jqExtractBase64PngStringsStreaming).mockImplementation(
        async (_filePath, onImage) => {
          onImage('data:image/png;base64,abc123', 0);
          onImage('def456', 1);
          return 2;
        },
      );

      vi.mocked(jqReplaceBase64WithPathsToFile).mockResolvedValue(undefined);
      vi.mocked(streamPromises.pipeline).mockResolvedValue(undefined);

      const bufferFromSpy = vi.spyOn(Buffer, 'from');

      await ImageExtractor.extractAndSaveDocumentsFromZip(
        mockLogger,
        zipPath,
        extractDir,
        outputDir,
      );

      expect(bufferFromSpy).toHaveBeenCalledWith('abc123', 'base64');
      expect(bufferFromSpy).toHaveBeenCalledWith('def456', 'base64');

      // Verify images are saved to 'images' dir with 'pic' prefix
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('images/pic_0.png'),
        expect.any(Buffer),
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('images/pic_1.png'),
        expect.any(Buffer),
      );
    });

    test('should handle output directory removal failure gracefully', async () => {
      const zipPath = '/test/input.zip';
      const extractDir = '/test/extract';
      const outputDir = '/test/output';

      setupSuccessfulZipExtraction([
        { fileName: 'test.json', isDirectory: false },
        { fileName: 'test.html', isDirectory: false },
      ]);

      vi.mocked(fs.readdirSync).mockReturnValue([
        'test.json',
        'test.html',
      ] as any);

      vi.mocked(fs.existsSync).mockReturnValue(true);

      vi.mocked(fs.rmSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      vi.mocked(jqExtractBase64PngStringsStreaming).mockResolvedValue(0);
      vi.mocked(jqReplaceBase64WithPathsToFile).mockResolvedValue(undefined);
      vi.mocked(streamPromises.pipeline).mockResolvedValue(undefined);

      await ImageExtractor.extractAndSaveDocumentsFromZip(
        mockLogger,
        zipPath,
        extractDir,
        outputDir,
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to clear output directory'),
        expect.any(Error),
      );
    });

    test('should fallback to streaming copy when HTML extraction fails', async () => {
      const zipPath = '/test/input.zip';
      const extractDir = '/test/extract';
      const outputDir = '/test/output';

      setupSuccessfulZipExtraction([
        { fileName: 'test.json', isDirectory: false },
        { fileName: 'test.html', isDirectory: false },
      ]);

      vi.mocked(fs.readdirSync).mockReturnValue([
        'test.json',
        'test.html',
      ] as any);

      vi.mocked(jqExtractBase64PngStringsStreaming).mockResolvedValue(0);
      vi.mocked(jqReplaceBase64WithPathsToFile).mockResolvedValue(undefined);

      // First call to pipeline (for extractImagesFromHtmlStream) throws error
      // Second call (for fallback streaming copy) succeeds
      let pipelineCallCount = 0;
      vi.mocked(streamPromises.pipeline).mockImplementation(async () => {
        pipelineCallCount++;
        if (pipelineCallCount === 1) {
          throw new Error('HTML stream processing failed');
        }
      });

      await ImageExtractor.extractAndSaveDocumentsFromZip(
        mockLogger,
        zipPath,
        extractDir,
        outputDir,
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to extract images from HTML, copying original',
        ),
        expect.any(Error),
      );
      // Verify fallback used streaming copy (createReadStream + createWriteStream + pipeline)
      expect(fs.createReadStream).toHaveBeenCalled();
      expect(fs.createWriteStream).toHaveBeenCalled();
    });

    test('should handle zipfile error event', async () => {
      const zipPath = '/test/input.zip';
      const extractDir = '/test/extract';
      const outputDir = '/test/output';

      setupZipExtractionWithError();

      await expect(
        ImageExtractor.extractAndSaveDocumentsFromZip(
          mockLogger,
          zipPath,
          extractDir,
          outputDir,
        ),
      ).rejects.toThrow('Zipfile error');
    });
  });

  describe('extractImagesFromHtmlStream', () => {
    test('should extract base64 images and replace with file paths', async () => {
      // Use real pipeline for streaming test
      vi.mocked(streamPromises.pipeline).mockRestore();
      const { pipeline: realPipeline } = await vi.importActual<
        typeof streamPromises
      >('node:stream/promises');
      vi.mocked(streamPromises.pipeline).mockImplementation(realPipeline);

      const htmlInput =
        '<html><img src="data:image/png;base64,iVBOR"/><img src="data:image/png;base64,AAAA"/></html>';

      // Mock createReadStream to return a readable stream with our test data
      const { Readable } = (await vi.importActual('node:stream')) as any;
      vi.mocked(fs.createReadStream).mockReturnValue(
        Readable.from([htmlInput]) as any,
      );

      const chunks: string[] = [];
      const mockWs = new Transform({
        transform(chunk, _enc, cb) {
          chunks.push(chunk.toString());
          cb();
        },
      });
      vi.mocked(fs.createWriteStream).mockReturnValue(mockWs as any);

      const count = await ImageExtractor.extractImagesFromHtmlStream(
        '/input.html',
        '/output.html',
        '/images',
      );

      expect(count).toBe(2);
      const output = chunks.join('');
      expect(output).toContain('src="images/image_0.png"');
      expect(output).toContain('src="images/image_1.png"');
      expect(output).not.toContain('data:image/png;base64');

      expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/images/image_0.png',
        expect.any(Buffer),
      );
    });

    test('should handle data split across chunk boundaries', async () => {
      vi.mocked(streamPromises.pipeline).mockRestore();
      const { pipeline: realPipeline } = await vi.importActual<
        typeof streamPromises
      >('node:stream/promises');
      vi.mocked(streamPromises.pipeline).mockImplementation(realPipeline);

      const { Readable } = (await vi.importActual('node:stream')) as any;

      // Split the marker across two chunks
      vi.mocked(fs.createReadStream).mockReturnValue(
        Readable.from([
          '<img src="data:image/png;base',
          '64,AAAA" />rest',
        ]) as any,
      );

      const chunks: string[] = [];
      const mockWs = new Transform({
        transform(chunk, _enc, cb) {
          chunks.push(chunk.toString());
          cb();
        },
      });
      vi.mocked(fs.createWriteStream).mockReturnValue(mockWs as any);

      const count = await ImageExtractor.extractImagesFromHtmlStream(
        '/input.html',
        '/output.html',
        '/images',
      );

      expect(count).toBe(1);
      const output = chunks.join('');
      expect(output).toContain('src="images/image_0.png"');
      expect(output).toContain('rest');
    });

    test('should handle closing quote split across chunks', async () => {
      vi.mocked(streamPromises.pipeline).mockRestore();
      const { pipeline: realPipeline } = await vi.importActual<
        typeof streamPromises
      >('node:stream/promises');
      vi.mocked(streamPromises.pipeline).mockImplementation(realPipeline);

      const { Readable } = (await vi.importActual('node:stream')) as any;

      // First chunk has the marker and base64 data start but no closing quote
      // Second chunk has more base64 data with the closing quote
      vi.mocked(fs.createReadStream).mockReturnValue(
        Readable.from([
          '<img src="data:image/png;base64,AAAA',
          'BBBB" />done',
        ]) as any,
      );

      const chunks: string[] = [];
      const mockWs = new Transform({
        transform(chunk, _enc, cb) {
          chunks.push(chunk.toString());
          cb();
        },
      });
      vi.mocked(fs.createWriteStream).mockReturnValue(mockWs as any);

      const count = await ImageExtractor.extractImagesFromHtmlStream(
        '/input.html',
        '/output.html',
        '/images',
      );

      expect(count).toBe(1);
      const output = chunks.join('');
      expect(output).toContain('src="images/image_0.png"');
      expect(output).toContain('done');
    });

    test('should pass through HTML without images unchanged', async () => {
      vi.mocked(streamPromises.pipeline).mockRestore();
      const { pipeline: realPipeline } = await vi.importActual<
        typeof streamPromises
      >('node:stream/promises');
      vi.mocked(streamPromises.pipeline).mockImplementation(realPipeline);

      const { Readable } = (await vi.importActual('node:stream')) as any;

      vi.mocked(fs.createReadStream).mockReturnValue(
        Readable.from(['<html><body>Hello</body></html>']) as any,
      );

      const chunks: string[] = [];
      const mockWs = new Transform({
        transform(chunk, _enc, cb) {
          chunks.push(chunk.toString());
          cb();
        },
      });
      vi.mocked(fs.createWriteStream).mockReturnValue(mockWs as any);

      const count = await ImageExtractor.extractImagesFromHtmlStream(
        '/input.html',
        '/output.html',
        '/images',
      );

      expect(count).toBe(0);
      const output = chunks.join('');
      expect(output).toContain('Hello');
    });

    test('should handle very short chunks without pushing empty result', async () => {
      vi.mocked(streamPromises.pipeline).mockRestore();
      const { pipeline: realPipeline } = await vi.importActual<
        typeof streamPromises
      >('node:stream/promises');
      vi.mocked(streamPromises.pipeline).mockImplementation(realPipeline);

      const { Readable } = (await vi.importActual('node:stream')) as any;

      // Send data as individual characters — each chunk is shorter than the marker length,
      // so safeEnd=0 and result='' (covers result.length > 0 false branch)
      vi.mocked(fs.createReadStream).mockReturnValue(
        Readable.from(['a', 'b', 'c']) as any,
      );

      const chunks: string[] = [];
      const mockWs = new Transform({
        transform(chunk, _enc, cb) {
          chunks.push(chunk.toString());
          cb();
        },
      });
      vi.mocked(fs.createWriteStream).mockReturnValue(mockWs as any);

      const count = await ImageExtractor.extractImagesFromHtmlStream(
        '/input.html',
        '/output.html',
        '/images',
      );

      expect(count).toBe(0);
      const output = chunks.join('');
      expect(output).toBe('abc');
    });

    test('should handle empty input with nothing to flush', async () => {
      vi.mocked(streamPromises.pipeline).mockRestore();
      const { pipeline: realPipeline } = await vi.importActual<
        typeof streamPromises
      >('node:stream/promises');
      vi.mocked(streamPromises.pipeline).mockImplementation(realPipeline);

      const { Readable } = (await vi.importActual('node:stream')) as any;

      // Empty input — no data passed to transform, flush is called with empty pending
      // (covers pending.length > 0 false branch in flush)
      vi.mocked(fs.createReadStream).mockReturnValue(Readable.from([]) as any);

      const chunks: string[] = [];
      const mockWs = new Transform({
        transform(chunk, _enc, cb) {
          chunks.push(chunk.toString());
          cb();
        },
      });
      vi.mocked(fs.createWriteStream).mockReturnValue(mockWs as any);

      const count = await ImageExtractor.extractImagesFromHtmlStream(
        '/input.html',
        '/output.html',
        '/images',
      );

      expect(count).toBe(0);
      expect(chunks.join('')).toBe('');
    });
  });
});

function setupSuccessfulZipExtraction(
  entries: Array<{ fileName: string; isDirectory: boolean }>,
) {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};

  const mockZipfile = {
    readEntry: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (!listeners[event]) {
        listeners[event] = [];
      }
      listeners[event].push(handler);
      return mockZipfile;
    }),
    openReadStream: vi.fn(
      (_entry: any, callback: (err: Error | null, stream: any) => void) => {
        const mockReadStream = {
          pipe: vi.fn((writeStream: any) => {
            queueMicrotask(() => {
              const finishHandlers = listeners['finish'] || [];
              finishHandlers.forEach((h) => h());
            });
            return writeStream;
          }),
        };
        callback(null, mockReadStream);
      },
    ),
  };

  let entryIndex = 0;

  mockZipfile.readEntry.mockImplementation(() => {
    queueMicrotask(() => {
      if (entryIndex < entries.length) {
        const entry = entries[entryIndex];
        entryIndex++;
        const entryHandlers = listeners['entry'] || [];
        entryHandlers.forEach((handler) =>
          handler({
            fileName: entry.fileName,
          }),
        );
      } else {
        const endHandlers = listeners['end'] || [];
        endHandlers.forEach((handler) => handler());
      }
    });
  });

  vi.mocked(yauzl.open).mockImplementation(
    (
      _path: string,
      _options: any,
      callback?: (err: Error | null, zipfile: any) => void,
    ) => {
      callback?.(null, mockZipfile as any);
    },
  );

  vi.mocked(fs.createWriteStream).mockImplementation(() => {
    const stream = {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        if (event === 'finish') {
          if (!listeners['finish']) {
            listeners['finish'] = [];
          }
          listeners['finish'].push(handler);
        }
        return stream;
      }),
    };
    return stream as any;
  });
}

function setupZipExtractionWithStreamError(errorType: string) {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};

  const mockZipfile = {
    readEntry: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (!listeners[event]) {
        listeners[event] = [];
      }
      listeners[event].push(handler);
      return mockZipfile;
    }),
    openReadStream: vi.fn(
      (_entry: any, callback: (err: Error | null, stream: any) => void) => {
        if (errorType === 'stream-error') {
          callback(new Error('Failed to open read stream'), null);
          return;
        }

        if (errorType === 'stream-null') {
          callback(null, null);
          return;
        }

        const mockReadStream = {
          pipe: vi.fn((writeStream: any) => writeStream),
        };
        callback(null, mockReadStream);
      },
    ),
  };

  mockZipfile.readEntry.mockImplementation(() => {
    queueMicrotask(() => {
      const entryHandlers = listeners['entry'] || [];
      entryHandlers.forEach((handler) =>
        handler({
          fileName: 'test.json',
        }),
      );
    });
  });

  vi.mocked(yauzl.open).mockImplementation(
    (
      _path: string,
      _options: any,
      callback?: (err: Error | null, zipfile: any) => void,
    ) => {
      callback?.(null, mockZipfile as any);
    },
  );

  if (errorType === 'write-error') {
    vi.mocked(fs.createWriteStream).mockImplementation(() => {
      const stream = {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          if (event === 'error') {
            queueMicrotask(() => handler(new Error('Write error')));
          }
          return stream;
        }),
      };
      return stream as any;
    });
  }
}

function setupZipExtractionWithError() {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};

  const mockZipfile = {
    readEntry: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (!listeners[event]) {
        listeners[event] = [];
      }
      listeners[event].push(handler);
      return mockZipfile;
    }),
    openReadStream: vi.fn(),
  };

  mockZipfile.readEntry.mockImplementation(() => {
    queueMicrotask(() => {
      const errorHandlers = listeners['error'] || [];
      errorHandlers.forEach((handler) => handler(new Error('Zipfile error')));
    });
  });

  vi.mocked(yauzl.open).mockImplementation(
    (
      _path: string,
      _options: any,
      callback?: (err: Error | null, zipfile: any) => void,
    ) => {
      callback?.(null, mockZipfile as any);
    },
  );
}
