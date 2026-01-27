import type { LoggerMethods } from '@heripo/logger';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as yauzl from 'yauzl';

import {
  jqExtractBase64PngStrings,
  jqReplaceBase64WithPaths,
} from '../utils/jq';
import { ImageExtractor } from './image-extractor';

vi.mock('node:fs');
vi.mock('node:path');
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

      vi.mocked(fs.readFileSync).mockReturnValue(
        '<html><img src="data:image/png;base64,iVBORw0KGgo="/></html>',
      );

      vi.mocked(jqExtractBase64PngStrings).mockResolvedValue([
        'data:image/png;base64,abc123',
        'data:image/png;base64,def456',
      ]);

      vi.mocked(jqReplaceBase64WithPaths).mockResolvedValue({
        data: { pages: [] },
        count: 2,
      });

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
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Extracting ZIP file'),
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

      vi.mocked(fs.readFileSync).mockReturnValue('<html></html>');

      vi.mocked(jqExtractBase64PngStrings).mockResolvedValue([]);

      vi.mocked(jqReplaceBase64WithPaths).mockResolvedValue({
        data: { pages: [] },
        count: 0,
      });

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

      vi.mocked(fs.readFileSync).mockReturnValue('<html></html>');

      vi.mocked(jqExtractBase64PngStrings).mockResolvedValue([]);

      vi.mocked(jqReplaceBase64WithPaths).mockResolvedValue({
        data: { pages: [] },
        count: 0,
      });

      await ImageExtractor.extractAndSaveDocumentsFromZip(
        mockLogger,
        zipPath,
        extractDir,
        outputDir,
      );

      expect(fs.readFileSync).toHaveBeenCalled();
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

      vi.mocked(fs.readFileSync).mockReturnValue('<html></html>');

      vi.mocked(jqExtractBase64PngStrings).mockRejectedValue(
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

    test('should handle HTML image extraction with multiple images', async () => {
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

      vi.mocked(fs.readFileSync).mockReturnValue(
        '<html><img src="data:image/png;base64,abc123"/><img src="data:image/png;base64,def456"/></html>',
      );

      vi.mocked(jqExtractBase64PngStrings).mockResolvedValue([]);

      vi.mocked(jqReplaceBase64WithPaths).mockResolvedValue({
        data: { pages: [] },
        count: 0,
      });

      await ImageExtractor.extractAndSaveDocumentsFromZip(
        mockLogger,
        zipPath,
        extractDir,
        outputDir,
      );

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.html'),
        expect.stringContaining('images/image_'),
        'utf-8',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Extracted 2 images from HTML'),
      );
    });

    test('should handle HTML image extraction failure gracefully', async () => {
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

      vi.mocked(fs.readFileSync).mockReturnValue('<html></html>');

      vi.mocked(jqExtractBase64PngStrings).mockResolvedValue([]);

      vi.mocked(jqReplaceBase64WithPaths).mockResolvedValue({
        data: { pages: [] },
        count: 0,
      });

      let htmlWriteAttempted = false;
      vi.mocked(fs.writeFileSync).mockImplementation((filepath) => {
        if (filepath.toString().includes('.html') && !htmlWriteAttempted) {
          htmlWriteAttempted = true;
          throw new Error('HTML write failed');
        }
      });

      await ImageExtractor.extractAndSaveDocumentsFromZip(
        mockLogger,
        zipPath,
        extractDir,
        outputDir,
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to extract images from HTML'),
        expect.any(Error),
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

      vi.mocked(fs.readFileSync).mockReturnValue('<html></html>');

      vi.mocked(fs.existsSync).mockReturnValue(true);

      vi.mocked(fs.rmSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      vi.mocked(jqExtractBase64PngStrings).mockResolvedValue([]);

      vi.mocked(jqReplaceBase64WithPaths).mockResolvedValue({
        data: { pages: [] },
        count: 0,
      });

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

    test('should handle base64 images with and without prefix', async () => {
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

      vi.mocked(fs.readFileSync).mockReturnValue('<html></html>');

      vi.mocked(jqExtractBase64PngStrings).mockResolvedValue([
        'data:image/png;base64,abc123',
        'def456',
      ]);

      vi.mocked(jqReplaceBase64WithPaths).mockResolvedValue({
        data: { pages: [] },
        count: 2,
      });

      const bufferFromSpy = vi.spyOn(Buffer, 'from');

      await ImageExtractor.extractAndSaveDocumentsFromZip(
        mockLogger,
        zipPath,
        extractDir,
        outputDir,
      );

      expect(bufferFromSpy).toHaveBeenCalledWith('abc123', 'base64');
      expect(bufferFromSpy).toHaveBeenCalledWith('def456', 'base64');
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
