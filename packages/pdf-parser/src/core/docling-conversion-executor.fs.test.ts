import type { LoggerMethods } from '@heripo/logger';
import type { AsyncConversionTask, DoclingAPIClient } from 'docling-sdk';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ImageExtractor } from '../processors/image-extractor';
import { downloadTaskResult } from '../utils/docling-result-downloader';
import { buildConversionOptions } from './conversion-options-builder';
import { DoclingConversionExecutor } from './docling-conversion-executor';

vi.mock('./conversion-options-builder', () => ({
  buildConversionOptions: vi.fn(),
}));

vi.mock('../utils/task-progress-tracker', () => ({
  trackTaskProgress: vi.fn(),
}));

vi.mock('../utils/docling-result-downloader', () => ({
  downloadTaskResult: vi.fn(),
}));

vi.mock('../processors/image-extractor', () => ({
  ImageExtractor: {
    extractAndSaveDocumentsFromZip: vi.fn(),
  },
}));

/**
 * Runs the executor against the real file system with a read-only working
 * directory layout in mind: the ZIP and extracted files must survive
 * ImageExtractor clearing the report output directory, and nothing may be
 * written to the working directory itself.
 */
describe('DoclingConversionExecutor temp files (real file system)', () => {
  let root: string;
  let cwd: string;
  let logger: LoggerMethods;
  let client: DoclingAPIClient;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'docling-executor-fs-test-'));
    cwd = join(root, 'app');
    mkdirSync(cwd);
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    client = {
      convertSourceAsync: vi
        .fn()
        .mockResolvedValue({ taskId: 'task-1' } as AsyncConversionTask),
    } as unknown as DoclingAPIClient;

    vi.mocked(buildConversionOptions).mockReturnValue({});
    vi.mocked(downloadTaskResult).mockImplementation(
      async (_client, _taskId, zipPath) => {
        writeFileSync(zipPath, 'zip-bytes');
      },
    );

    // Mirrors the real contract: extract the ZIP, clear and recreate outputDir,
    // then read the extracted documents and write the results.
    vi.mocked(ImageExtractor.extractAndSaveDocumentsFromZip).mockImplementation(
      async (_logger, zipPath, extractDir, outputDir) => {
        mkdirSync(extractDir, { recursive: true });
        writeFileSync(join(extractDir, 'doc.json'), readFileSync(zipPath));
        rmSync(outputDir, { recursive: true, force: true });
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(
          join(outputDir, 'result.json'),
          readFileSync(join(extractDir, 'doc.json')),
        );
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  test('keeps temp files outside the output directory that ImageExtractor clears', async () => {
    const executor = new DoclingConversionExecutor(logger, client, 1000);
    let tempDir: string | undefined;
    const onComplete = vi.fn(async (outputDir: string) => {
      expect(readFileSync(join(outputDir, 'result.json'), 'utf8')).toBe(
        'zip-bytes',
      );
    });
    vi.mocked(downloadTaskResult).mockImplementationOnce(
      async (_client, _taskId, zipPath) => {
        tempDir = join(zipPath, '..');
        writeFileSync(zipPath, 'zip-bytes');
      },
    );

    await executor.execute(
      'http://example.test/doc.pdf',
      'report-1',
      onComplete,
      false,
      {} as never,
    );

    expect(onComplete).toHaveBeenCalledWith(join(cwd, 'output', 'report-1'));
    expect(tempDir?.startsWith(join(cwd, 'output', 'report-1'))).toBe(false);
    // Nothing besides the output directory is written to the working directory.
    expect(readdirSync(cwd)).toEqual(['output']);
    expect(readdirSync(join(cwd, 'output', 'report-1'))).toEqual([
      'result.json',
    ]);
    // The temp dir is removed after the conversion.
    expect(tempDir && existsSync(tempDir)).toBe(false);
  });

  test('removes the temp dir when the conversion fails', async () => {
    const executor = new DoclingConversionExecutor(logger, client, 1000);
    let tempDir: string | undefined;
    vi.mocked(downloadTaskResult).mockImplementationOnce(
      async (_client, _taskId, zipPath) => {
        tempDir = join(zipPath, '..');
        throw new Error('download failed');
      },
    );

    await expect(
      executor.execute(
        'http://example.test/doc.pdf',
        'report-2',
        vi.fn(),
        false,
        {} as never,
      ),
    ).rejects.toThrow('download failed');

    expect(tempDir && existsSync(tempDir)).toBe(false);
  });
});
