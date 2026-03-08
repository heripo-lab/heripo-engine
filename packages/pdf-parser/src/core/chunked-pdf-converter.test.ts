import type { LoggerMethods } from '@heripo/logger';
import type { DoclingDocument } from '@heripo/model';
import type { DoclingAPIClient } from 'docling-sdk';

import { spawnAsync } from '@heripo/shared';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { rename } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { type Mock, beforeEach, describe, expect, test, vi } from 'vitest';

import { DoclingDocumentMerger } from '../processors/docling-document-merger';
import { PageRenderer } from '../processors/page-renderer';
import { runJqFileJson, runJqFileToFile } from '../utils/jq';
import { LocalFileServer } from '../utils/local-file-server';
import { ChunkedPDFConverter } from './chunked-pdf-converter';

vi.mock('@heripo/shared', () => ({
  spawnAsync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  copyFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  rmSync: vi.fn(),
  writeFileSync: vi.fn(),
  createWriteStream: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  rename: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('node:path', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
}));

vi.mock('node:stream/promises', () => ({
  pipeline: vi.fn(),
}));

vi.mock('../processors/image-extractor', () => ({
  ImageExtractor: {
    extractAndSaveDocumentsFromZip: vi.fn(),
  },
}));

vi.mock('../processors/docling-document-merger', () => ({
  DoclingDocumentMerger: vi.fn(),
}));

vi.mock('../processors/page-renderer', () => ({
  PageRenderer: vi.fn(),
}));

vi.mock('../utils/jq', () => ({
  runJqFileJson: vi.fn(),
  runJqFileToFile: vi.fn(),
}));

vi.mock('../utils/local-file-server', () => ({
  LocalFileServer: vi.fn(),
}));

function makeDoc(overrides: Partial<DoclingDocument> = {}): DoclingDocument {
  return {
    schema_name: 'DoclingDocument',
    version: '1.0',
    name: 'test',
    origin: {
      mimetype: 'application/pdf',
      binary_hash: 123,
      filename: 'test.pdf',
    },
    body: {
      self_ref: '#/body',
      children: [],
      content_layer: 'body',
      name: '_root_',
      label: 'unspecified',
    },
    furniture: {
      self_ref: '#/furniture',
      children: [],
      content_layer: 'furniture',
      name: '_root_',
      label: 'unspecified',
    },
    groups: [],
    texts: [],
    pictures: [],
    tables: [],
    pages: {},
    ...overrides,
  };
}

describe('ChunkedPDFConverter', () => {
  let logger: LoggerMethods;
  let client: DoclingAPIClient;
  let converter: ChunkedPDFConverter;
  let mockOnComplete: Mock;
  let mockBuildOptions: Mock;
  let mockServerInstance: { start: Mock; stop: Mock };
  let mockMergerInstance: { merge: Mock };
  let mockRendererInstance: { renderPages: Mock };
  let mockTask: { taskId: string; poll: Mock; getResult: Mock };

  beforeEach(() => {
    vi.clearAllMocks();

    logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    mockTask = {
      taskId: 'task-1',
      poll: vi.fn().mockResolvedValue({ task_status: 'success' }),
      getResult: vi.fn(),
    };

    client = {
      convertSourceAsync: vi.fn().mockResolvedValue(mockTask),
      getTaskResultFile: vi
        .fn()
        .mockResolvedValue({ data: Buffer.from('zip') }),
      getConfig: vi.fn().mockReturnValue({ baseUrl: 'http://localhost:5001' }),
    } as unknown as DoclingAPIClient;

    converter = new ChunkedPDFConverter(logger, client, {
      chunkSize: 10,
      maxRetries: 2,
    });

    mockOnComplete = vi.fn();
    mockBuildOptions = vi.fn().mockReturnValue({ to_formats: ['json'] });

    vi.spyOn(process, 'cwd').mockReturnValue('/test/cwd');

    // Mock LocalFileServer
    mockServerInstance = {
      start: vi.fn().mockResolvedValue('http://127.0.0.1:3000/test.pdf'),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(LocalFileServer).mockImplementation(function () {
      return mockServerInstance as any;
    });

    // Mock DoclingDocumentMerger
    mockMergerInstance = {
      merge: vi.fn().mockImplementation((docs: DoclingDocument[]) => {
        if (docs.length === 1) return docs[0];
        return makeDoc({
          texts: docs.flatMap((d) => d.texts),
          pictures: docs.flatMap((d) => d.pictures),
          tables: docs.flatMap((d) => d.tables),
          pages: Object.assign({}, ...docs.map((d) => d.pages)),
        });
      }),
    };
    vi.mocked(DoclingDocumentMerger).mockImplementation(function () {
      return mockMergerInstance as any;
    });

    // Mock PageRenderer
    mockRendererInstance = {
      renderPages: vi.fn().mockResolvedValue({
        pageCount: 25,
        pagesDir: '/test/cwd/output/report/pages',
        pageFiles: [],
      }),
    };
    vi.mocked(PageRenderer).mockImplementation(function () {
      return mockRendererInstance as any;
    });

    // Mock spawnAsync (pdfinfo returning page count)
    vi.mocked(spawnAsync).mockResolvedValue({
      code: 0,
      stdout: 'Pages:          25\n',
      stderr: '',
    });

    // Mock runJqFileJson (returns DoclingDocument per chunk)
    vi.mocked(runJqFileJson).mockResolvedValue(makeDoc());

    // Mock runJqFileToFile
    vi.mocked(runJqFileToFile).mockResolvedValue(undefined as any);

    // Mock rename
    vi.mocked(rename).mockResolvedValue(undefined);

    // Mock existsSync: default false
    vi.mocked(existsSync).mockReturnValue(false);

    // Mock readdirSync: empty by default
    vi.mocked(readdirSync).mockReturnValue([] as any);

    // Mock readFileSync: empty JSON by default (for cleanupOrphanedPicFiles)
    vi.mocked(readFileSync).mockReturnValue('{}');
  });

  describe('calculateChunks', () => {
    test('divides pages evenly', () => {
      const chunks = converter.calculateChunks(30);
      expect(chunks).toEqual([
        [1, 10],
        [11, 20],
        [21, 30],
      ]);
    });

    test('handles remainder pages', () => {
      const chunks = converter.calculateChunks(25);
      expect(chunks).toEqual([
        [1, 10],
        [11, 20],
        [21, 25],
      ]);
    });

    test('handles single chunk', () => {
      const chunks = converter.calculateChunks(5);
      expect(chunks).toEqual([[1, 5]]);
    });

    test('handles exact chunk size', () => {
      const chunks = converter.calculateChunks(10);
      expect(chunks).toEqual([[1, 10]]);
    });
  });

  describe('convertChunked', () => {
    test('normal 3-chunk conversion and merge', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          25\n',
        stderr: '',
      });

      const doc1 = makeDoc({
        texts: [
          {
            self_ref: '#/texts/0',
            children: [],
            content_layer: 'body',
            label: 'text',
            prov: [],
            orig: 'a',
            text: 'a',
          },
        ],
      });
      const doc2 = makeDoc({
        texts: [
          {
            self_ref: '#/texts/0',
            children: [],
            content_layer: 'body',
            label: 'text',
            prov: [],
            orig: 'b',
            text: 'b',
          },
        ],
      });
      const doc3 = makeDoc({
        texts: [
          {
            self_ref: '#/texts/0',
            children: [],
            content_layer: 'body',
            label: 'text',
            prov: [],
            orig: 'c',
            text: 'c',
          },
        ],
      });

      vi.mocked(runJqFileJson)
        .mockResolvedValueOnce(doc1)
        .mockResolvedValueOnce(doc2)
        .mockResolvedValueOnce(doc3);

      await converter.convertChunked(
        'file:///test/input.pdf',
        'report-1',
        mockOnComplete,
        false,
        {},
        mockBuildOptions,
      );

      // Local file server started and stopped
      expect(mockServerInstance.start).toHaveBeenCalledWith('/test/input.pdf');
      expect(mockServerInstance.stop).toHaveBeenCalled();

      // 3 chunks created (25 pages / 10 = 3 chunks)
      expect(client.convertSourceAsync).toHaveBeenCalledTimes(3);

      // buildConversionOptions called with page_range for each chunk
      expect(mockBuildOptions).toHaveBeenCalledWith(
        expect.objectContaining({ page_range: [1, 10] }),
      );
      expect(mockBuildOptions).toHaveBeenCalledWith(
        expect.objectContaining({ page_range: [11, 20] }),
      );
      expect(mockBuildOptions).toHaveBeenCalledWith(
        expect.objectContaining({ page_range: [21, 25] }),
      );

      // Merger called with 3 documents and picFileOffsets
      expect(mockMergerInstance.merge).toHaveBeenCalledWith(
        [doc1, doc2, doc3],
        [0, 0, 0],
      );

      // onComplete callback called
      expect(mockOnComplete).toHaveBeenCalledWith('/test/cwd/output/report-1');

      // Page rendering done
      expect(mockRendererInstance.renderPages).toHaveBeenCalled();
    });

    test('fails when page count detection fails', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 1,
        stdout: '',
        stderr: 'pdfinfo failed',
      });

      await expect(
        converter.convertChunked(
          'file:///test/input.pdf',
          'report-1',
          mockOnComplete,
          false,
          {},
          mockBuildOptions,
        ),
      ).rejects.toThrow('Failed to detect page count from PDF');
    });

    test('chunk failure triggers retry and succeeds', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          5\n',
        stderr: '',
      });

      // First call fails, second succeeds
      vi.mocked(client.convertSourceAsync as Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockTask);

      await converter.convertChunked(
        'file:///test/input.pdf',
        'report-1',
        mockOnComplete,
        false,
        {},
        mockBuildOptions,
      );

      // Called twice (1 failure + 1 retry success)
      expect(client.convertSourceAsync).toHaveBeenCalledTimes(2);
      expect(mockOnComplete).toHaveBeenCalled();
    });

    test('max retries exceeded causes total failure', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          5\n',
        stderr: '',
      });

      // All attempts fail
      vi.mocked(client.convertSourceAsync as Mock).mockRejectedValue(
        new Error('Persistent error'),
      );

      await expect(
        converter.convertChunked(
          'file:///test/input.pdf',
          'report-1',
          mockOnComplete,
          false,
          {},
          mockBuildOptions,
        ),
      ).rejects.toThrow('Persistent error');

      // Original + maxRetries(2) = 3 attempts
      expect(client.convertSourceAsync).toHaveBeenCalledTimes(3);
      // Server is always stopped even on failure
      expect(mockServerInstance.stop).toHaveBeenCalled();
    });

    test('abort signal stops conversion', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          25\n',
        stderr: '',
      });

      const controller = new AbortController();
      controller.abort();

      await expect(
        converter.convertChunked(
          'file:///test/input.pdf',
          'report-1',
          mockOnComplete,
          false,
          {},
          mockBuildOptions,
          controller.signal,
        ),
      ).rejects.toThrow('aborted');

      // Server always stopped
      expect(mockServerInstance.stop).toHaveBeenCalled();
    });

    test('image relocation with global indexing for both pic_ and image_ files', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          20\n',
        stderr: '',
      });

      // Simulate images in chunk directories
      vi.mocked(existsSync).mockImplementation((path) => {
        const p = String(path);
        return (
          p.includes('_chunk_0/output/images') ||
          p.includes('_chunk_1/output/images')
        );
      });

      vi.mocked(readdirSync).mockImplementation((path) => {
        const p = String(path);
        if (p.includes('_chunk_0/output/images')) {
          return [
            'pic_0.png',
            'pic_1.png',
            'image_0.png',
            'image_1.png',
          ] as any;
        }
        if (p.includes('_chunk_1/output/images')) {
          return ['pic_0.png', 'image_0.png'] as any;
        }
        return [] as any;
      });

      await converter.convertChunked(
        'file:///test/input.pdf',
        'report-1',
        mockOnComplete,
        false,
        {},
        mockBuildOptions,
      );

      // 3 pic_ + 3 image_ = 6 total copies
      expect(copyFileSync).toHaveBeenCalledTimes(6);

      // pic_ files with global indexing
      expect(copyFileSync).toHaveBeenCalledWith(
        expect.stringContaining('_chunk_0/output/images/pic_0.png'),
        expect.stringContaining('images/pic_0.png'),
      );
      expect(copyFileSync).toHaveBeenCalledWith(
        expect.stringContaining('_chunk_0/output/images/pic_1.png'),
        expect.stringContaining('images/pic_1.png'),
      );
      expect(copyFileSync).toHaveBeenCalledWith(
        expect.stringContaining('_chunk_1/output/images/pic_0.png'),
        expect.stringContaining('images/pic_2.png'),
      );

      // image_ files with global indexing
      expect(copyFileSync).toHaveBeenCalledWith(
        expect.stringContaining('_chunk_0/output/images/image_0.png'),
        expect.stringContaining('images/image_0.png'),
      );
      expect(copyFileSync).toHaveBeenCalledWith(
        expect.stringContaining('_chunk_0/output/images/image_1.png'),
        expect.stringContaining('images/image_1.png'),
      );
      expect(copyFileSync).toHaveBeenCalledWith(
        expect.stringContaining('_chunk_1/output/images/image_0.png'),
        expect.stringContaining('images/image_2.png'),
      );
    });

    test('image_ files are relocated with global indexing when no pic_ files exist', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          20\n',
        stderr: '',
      });

      vi.mocked(existsSync).mockImplementation((path) => {
        const p = String(path);
        return (
          p.includes('_chunk_0/output/images') ||
          p.includes('_chunk_1/output/images')
        );
      });

      vi.mocked(readdirSync).mockImplementation((path) => {
        const p = String(path);
        if (p.includes('_chunk_0/output/images')) {
          return ['image_0.png', 'image_1.png'] as any;
        }
        if (p.includes('_chunk_1/output/images')) {
          return ['image_0.png'] as any;
        }
        return [] as any;
      });

      await converter.convertChunked(
        'file:///test/input.pdf',
        'report-1',
        mockOnComplete,
        false,
        {},
        mockBuildOptions,
      );

      // 3 image_ files only
      expect(copyFileSync).toHaveBeenCalledTimes(3);
      expect(copyFileSync).toHaveBeenCalledWith(
        expect.stringContaining('_chunk_0/output/images/image_0.png'),
        expect.stringContaining('images/image_0.png'),
      );
      expect(copyFileSync).toHaveBeenCalledWith(
        expect.stringContaining('_chunk_0/output/images/image_1.png'),
        expect.stringContaining('images/image_1.png'),
      );
      expect(copyFileSync).toHaveBeenCalledWith(
        expect.stringContaining('_chunk_1/output/images/image_0.png'),
        expect.stringContaining('images/image_2.png'),
      );
    });

    test('onComplete receives correct outputDir', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          5\n',
        stderr: '',
      });

      await converter.convertChunked(
        'file:///test/input.pdf',
        'my-report',
        mockOnComplete,
        false,
        {},
        mockBuildOptions,
      );

      expect(mockOnComplete).toHaveBeenCalledWith('/test/cwd/output/my-report');
    });

    test('cleanupAfterCallback removes output directory', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          5\n',
        stderr: '',
      });

      // existsSync returns true for cleanup checks
      vi.mocked(existsSync).mockReturnValue(true);

      await converter.convertChunked(
        'file:///test/input.pdf',
        'report-1',
        mockOnComplete,
        true,
        {},
        mockBuildOptions,
      );

      // Both chunks dir and output dir cleaned up
      expect(rmSync).toHaveBeenCalledWith(
        expect.stringContaining('_chunks'),
        expect.objectContaining({ recursive: true }),
      );
      expect(rmSync).toHaveBeenCalledWith(
        '/test/cwd/output/report-1',
        expect.objectContaining({ recursive: true }),
      );
    });

    test('merged result.json is written to output directory', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          5\n',
        stderr: '',
      });

      await converter.convertChunked(
        'file:///test/input.pdf',
        'report-1',
        mockOnComplete,
        false,
        {},
        mockBuildOptions,
      );

      expect(writeFileSync).toHaveBeenCalledWith(
        '/test/cwd/output/report-1/result.json',
        expect.any(String),
      );
    });

    test('task poll failure reports error details', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          5\n',
        stderr: '',
      });

      const failingTask = {
        taskId: 'task-fail',
        poll: vi.fn().mockResolvedValue({ task_status: 'failure' }),
        getResult: vi.fn().mockResolvedValue({
          errors: [{ message: 'OCR engine crashed' }],
        }),
      };

      vi.mocked(client.convertSourceAsync as Mock).mockResolvedValue(
        failingTask,
      );

      await expect(
        converter.convertChunked(
          'file:///test/input.pdf',
          'report-1',
          mockOnComplete,
          false,
          {},
          mockBuildOptions,
        ),
      ).rejects.toThrow('OCR engine crashed');
    });

    test('task poll failure without errors array falls back to unknown', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          5\n',
        stderr: '',
      });

      const failingTask = {
        taskId: 'task-fail',
        poll: vi.fn().mockResolvedValue({ task_status: 'failure' }),
        getResult: vi.fn().mockResolvedValue({ status: 'failure' }),
      };

      vi.mocked(client.convertSourceAsync as Mock).mockResolvedValue(
        failingTask,
      );

      await expect(
        converter.convertChunked(
          'file:///test/input.pdf',
          'report-1',
          mockOnComplete,
          false,
          {},
          mockBuildOptions,
        ),
      ).rejects.toThrow('Chunk task failed: status: failure');
    });

    test('task poll failure with getResult error falls back to unable to retrieve error details', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          5\n',
        stderr: '',
      });

      const failingTask = {
        taskId: 'task-fail',
        poll: vi.fn().mockResolvedValue({ task_status: 'failure' }),
        getResult: vi.fn().mockRejectedValue(new Error('Network error')),
      };

      vi.mocked(client.convertSourceAsync as Mock).mockResolvedValue(
        failingTask,
      );

      await expect(
        converter.convertChunked(
          'file:///test/input.pdf',
          'report-1',
          mockOnComplete,
          false,
          {},
          mockBuildOptions,
        ),
      ).rejects.toThrow('Chunk task failed: unable to retrieve error details');

      expect(logger.error).toHaveBeenCalledWith(
        '[ChunkedPDFConverter] Failed to retrieve task result:',
        expect.any(Error),
      );
    });

    test('task poll timeout throws error', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          5\n',
        stderr: '',
      });

      // Use a very short timeout
      const shortTimeoutConverter = new ChunkedPDFConverter(
        logger,
        client,
        { chunkSize: 10, maxRetries: 0 },
        1,
      );

      const hangingTask = {
        taskId: 'task-hang',
        poll: vi.fn().mockResolvedValue({ task_status: 'pending' }),
        getResult: vi.fn(),
      };

      vi.mocked(client.convertSourceAsync as Mock).mockResolvedValue(
        hangingTask,
      );

      await expect(
        shortTimeoutConverter.convertChunked(
          'file:///test/input.pdf',
          'report-1',
          mockOnComplete,
          false,
          {},
          mockBuildOptions,
        ),
      ).rejects.toThrow('Chunk task timeout');
    });

    test('downloadResult uses fileStream when available', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          5\n',
        stderr: '',
      });

      const mockWriteStream = { on: vi.fn() };
      vi.mocked(createWriteStream).mockReturnValue(mockWriteStream as any);
      vi.mocked(pipeline).mockResolvedValue(undefined);

      const mockStream = { pipe: vi.fn() };
      vi.mocked(client.getTaskResultFile as Mock).mockResolvedValue({
        fileStream: mockStream,
      });

      await converter.convertChunked(
        'file:///test/input.pdf',
        'report-1',
        mockOnComplete,
        false,
        {},
        mockBuildOptions,
      );

      expect(pipeline).toHaveBeenCalled();
    });

    test('downloadResult uses fetch fallback when no fileStream or data', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          5\n',
        stderr: '',
      });

      vi.mocked(client.getTaskResultFile as Mock).mockResolvedValue({});

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      vi.stubGlobal('fetch', mockFetch);

      await converter.convertChunked(
        'file:///test/input.pdf',
        'report-1',
        mockOnComplete,
        false,
        {},
        mockBuildOptions,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5001/v1/result/task-1',
        expect.objectContaining({ headers: { Accept: 'application/zip' } }),
      );

      vi.unstubAllGlobals();
    });

    test('downloadResult fetch fallback throws on non-ok response', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          5\n',
        stderr: '',
      });

      vi.mocked(client.getTaskResultFile as Mock).mockResolvedValue({});

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        converter.convertChunked(
          'file:///test/input.pdf',
          'report-1',
          mockOnComplete,
          false,
          {},
          mockBuildOptions,
        ),
      ).rejects.toThrow('Failed to download chunk ZIP: 500');

      vi.unstubAllGlobals();
    });

    test('chunk temp files are cleaned up after successful conversion', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          5\n',
        stderr: '',
      });

      // existsSync returns true for zip and extract cleanup
      vi.mocked(existsSync).mockReturnValue(true);

      await converter.convertChunked(
        'file:///test/input.pdf',
        'report-1',
        mockOnComplete,
        false,
        {},
        mockBuildOptions,
      );

      // ZIP and extracted dirs are cleaned per chunk
      expect(rmSync).toHaveBeenCalledWith(
        expect.stringContaining('result.zip'),
        expect.objectContaining({ force: true }),
      );
      expect(rmSync).toHaveBeenCalledWith(
        expect.stringContaining('extracted'),
        expect.objectContaining({ recursive: true }),
      );
    });

    test('cleanupAfterCallback skips rmSync when outputDir does not exist', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          5\n',
        stderr: '',
      });

      // existsSync returns true for _chunks but false for outputDir
      vi.mocked(existsSync).mockImplementation((path) => {
        const p = String(path);
        return p.includes('_chunks');
      });

      await converter.convertChunked(
        'file:///test/input.pdf',
        'report-1',
        mockOnComplete,
        true,
        {},
        mockBuildOptions,
      );

      // _chunks dir cleaned up
      expect(rmSync).toHaveBeenCalledWith(
        expect.stringContaining('_chunks'),
        expect.objectContaining({ recursive: true }),
      );
      // outputDir rmSync NOT called (existsSync returned false)
      expect(rmSync).not.toHaveBeenCalledWith(
        '/test/cwd/output/report-1',
        expect.any(Object),
      );
    });

    test('orphaned pic_ files are cleaned up after page rendering', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          5\n',
        stderr: '',
      });

      // result.json has no pic_ references → all pic_ files are orphaned
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          pages: { '0': { image: { uri: 'pages/page_0.png' } } },
        }),
      );

      // cleanupOrphanedPicFiles reads the final images dir
      vi.mocked(readdirSync).mockImplementation((path) => {
        const p = String(path);
        if (p === '/test/cwd/output/report-1/images') {
          return ['pic_0.png', 'pic_1.png', 'pic_2.png'] as any;
        }
        return [] as any;
      });

      await converter.convertChunked(
        'file:///test/input.pdf',
        'report-1',
        mockOnComplete,
        false,
        {},
        mockBuildOptions,
      );

      // All 3 orphaned pic_ files deleted
      expect(rmSync).toHaveBeenCalledWith(
        expect.stringContaining('images/pic_0.png'),
        expect.objectContaining({ force: true }),
      );
      expect(rmSync).toHaveBeenCalledWith(
        expect.stringContaining('images/pic_1.png'),
        expect.objectContaining({ force: true }),
      );
      expect(rmSync).toHaveBeenCalledWith(
        expect.stringContaining('images/pic_2.png'),
        expect.objectContaining({ force: true }),
      );

      // Logger reports cleanup
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Cleaned up 3 orphaned pic_ files'),
      );
    });

    test('referenced pic_ files are preserved during cleanup', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          5\n',
        stderr: '',
      });

      // result.json references pic_1.png (actual content image)
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          pictures: [{ image: { uri: 'images/pic_1.png' } }],
          pages: { '0': { image: { uri: 'pages/page_0.png' } } },
        }),
      );

      vi.mocked(readdirSync).mockImplementation((path) => {
        const p = String(path);
        if (p === '/test/cwd/output/report-1/images') {
          return ['pic_0.png', 'pic_1.png', 'pic_2.png'] as any;
        }
        return [] as any;
      });

      await converter.convertChunked(
        'file:///test/input.pdf',
        'report-1',
        mockOnComplete,
        false,
        {},
        mockBuildOptions,
      );

      // pic_0 and pic_2 deleted (orphaned)
      expect(rmSync).toHaveBeenCalledWith(
        expect.stringContaining('images/pic_0.png'),
        expect.objectContaining({ force: true }),
      );
      expect(rmSync).toHaveBeenCalledWith(
        expect.stringContaining('images/pic_2.png'),
        expect.objectContaining({ force: true }),
      );

      // pic_1 NOT deleted (referenced)
      const rmSyncCalls = vi.mocked(rmSync).mock.calls;
      const deletedPic1 = rmSyncCalls.some((call) =>
        String(call[0]).includes('images/pic_1.png'),
      );
      expect(deletedPic1).toBe(false);

      // Logger reports 2 orphaned, 1 kept
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          'Cleaned up 2 orphaned pic_ files (1 referenced, kept)',
        ),
      );
    });

    test('pdfinfo returning no Pages line yields zero page count', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Title: Test\nCreator: Test\n',
        stderr: '',
      });

      await expect(
        converter.convertChunked(
          'file:///test/input.pdf',
          'report-1',
          mockOnComplete,
          false,
          {},
          mockBuildOptions,
        ),
      ).rejects.toThrow('Failed to detect page count from PDF');
    });

    test('throws on non-positive chunkSize', () => {
      const zeroChunkConverter = new ChunkedPDFConverter(logger, client, {
        chunkSize: 0,
        maxRetries: 0,
      });
      expect(() => zeroChunkConverter.calculateChunks(10)).toThrow(
        'chunkSize must be positive',
      );

      const negativeChunkConverter = new ChunkedPDFConverter(logger, client, {
        chunkSize: -5,
        maxRetries: 0,
      });
      expect(() => negativeChunkConverter.calculateChunks(10)).toThrow(
        'chunkSize must be positive',
      );
    });

    test('_chunks directory is cleaned up even when renderPageImages throws', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          5\n',
        stderr: '',
      });

      vi.mocked(existsSync).mockReturnValue(true);

      mockRendererInstance.renderPages.mockRejectedValue(
        new Error('ImageMagick crashed'),
      );

      await expect(
        converter.convertChunked(
          'file:///test/input.pdf',
          'report-1',
          mockOnComplete,
          false,
          {},
          mockBuildOptions,
        ),
      ).rejects.toThrow('ImageMagick crashed');

      // _chunks dir still cleaned up despite error
      expect(rmSync).toHaveBeenCalledWith(
        expect.stringContaining('_chunks'),
        expect.objectContaining({ recursive: true }),
      );
    });

    test('_chunks directory is cleaned up even when onComplete throws', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          5\n',
        stderr: '',
      });

      vi.mocked(existsSync).mockReturnValue(true);

      mockOnComplete.mockRejectedValue(new Error('Callback error'));

      await expect(
        converter.convertChunked(
          'file:///test/input.pdf',
          'report-1',
          mockOnComplete,
          false,
          {},
          mockBuildOptions,
        ),
      ).rejects.toThrow('Callback error');

      // _chunks dir still cleaned up despite callback error
      expect(rmSync).toHaveBeenCalledWith(
        expect.stringContaining('_chunks'),
        expect.objectContaining({ recursive: true }),
      );
    });

    test('picFileOffsets are passed to merger based on chunk pic_ file counts', async () => {
      vi.mocked(spawnAsync).mockResolvedValue({
        code: 0,
        stdout: 'Pages:          20\n',
        stderr: '',
      });

      // Simulate pic_ files in chunk directories for buildPicFileOffsets
      vi.mocked(existsSync).mockImplementation((path) => {
        const p = String(path);
        return (
          p.includes('_chunk_0/output/images') ||
          p.includes('_chunk_1/output/images')
        );
      });

      vi.mocked(readdirSync).mockImplementation((path) => {
        const p = String(path);
        // buildPicFileOffsets reads chunk dirs
        if (p.includes('_chunk_0/output/images')) {
          return ['pic_0.png', 'pic_1.png', 'pic_2.png'] as any;
        }
        if (p.includes('_chunk_1/output/images')) {
          return ['pic_0.png', 'pic_1.png'] as any;
        }
        return [] as any;
      });

      await converter.convertChunked(
        'file:///test/input.pdf',
        'report-1',
        mockOnComplete,
        false,
        {},
        mockBuildOptions,
      );

      // Merger should have been called with picFileOffsets [0, 3]
      // (chunk 0 has 3 pic files, so chunk 1 offset = 3)
      expect(mockMergerInstance.merge).toHaveBeenCalledWith(
        expect.any(Array),
        [0, 3],
      );
    });
  });
});
