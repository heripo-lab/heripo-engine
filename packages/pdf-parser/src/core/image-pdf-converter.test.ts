import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';

import { ImagePdfConverter } from './image-pdf-converter';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  tmpdir: vi.fn(() => '/tmp'),
}));

vi.mock('@heripo/shared', () => ({
  spawnAsync: vi.fn(),
}));

const fsMock = vi.mocked(await import('node:fs'));

const sharedMock = vi.mocked(await import('@heripo/shared'));

const makeLogger = () =>
  ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }) as any;

describe('ImagePdfConverter', () => {
  describe('convert', () => {
    test('should download PDF and convert to image PDF successfully', async () => {
      const fixedTimestamp = 1234567890;
      vi.spyOn(Date, 'now').mockReturnValue(fixedTimestamp);
      fsMock.existsSync.mockReturnValue(true);

      sharedMock.spawnAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 }) // curl
        .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 }); // magick

      const logger = makeLogger();
      const converter = new ImagePdfConverter(logger);
      const result = await converter.convert(
        'http://example.com/test.pdf',
        'report-123',
      );

      expect(result).toBe(
        join('/tmp', `report-123-${fixedTimestamp}-image.pdf`),
      );
      expect(sharedMock.spawnAsync).toHaveBeenCalledTimes(2);

      // Verify curl call
      expect(sharedMock.spawnAsync).toHaveBeenNthCalledWith(1, 'curl', [
        '-L',
        '-o',
        join('/tmp', `report-123-${fixedTimestamp}-input.pdf`),
        '-s',
        '--fail',
        'http://example.com/test.pdf',
      ]);

      // Verify magick call
      expect(sharedMock.spawnAsync).toHaveBeenNthCalledWith(2, 'magick', [
        '-density',
        '300',
        join('/tmp', `report-123-${fixedTimestamp}-input.pdf`),
        '-quality',
        '100',
        join('/tmp', `report-123-${fixedTimestamp}-image.pdf`),
      ]);

      // Verify input file cleanup in finally block
      expect(fsMock.rmSync).toHaveBeenCalledWith(
        join('/tmp', `report-123-${fixedTimestamp}-input.pdf`),
        { force: true },
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[ImagePdfConverter] Downloading PDF from URL...',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[ImagePdfConverter] Converting to image PDF...',
      );
    });

    test('should throw error when PDF download fails', async () => {
      const fixedTimestamp = 1234567890;
      vi.spyOn(Date, 'now').mockReturnValue(fixedTimestamp);
      fsMock.existsSync.mockReturnValue(false);

      sharedMock.spawnAsync.mockResolvedValueOnce({
        stdout: '',
        stderr: 'Connection refused',
        code: 7,
      });

      const logger = makeLogger();
      const converter = new ImagePdfConverter(logger);

      await expect(
        converter.convert('http://example.com/test.pdf', 'report-123'),
      ).rejects.toThrow('Failed to download PDF: Connection refused');
    });

    test('should throw error when ImageMagick conversion fails', async () => {
      const fixedTimestamp = 1234567890;
      vi.spyOn(Date, 'now').mockReturnValue(fixedTimestamp);
      fsMock.existsSync.mockReturnValue(true);

      sharedMock.spawnAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 }) // curl success
        .mockResolvedValueOnce({
          stdout: '',
          stderr: 'Invalid PDF',
          code: 1,
        }); // magick fail

      const logger = makeLogger();
      const converter = new ImagePdfConverter(logger);

      await expect(
        converter.convert('http://example.com/test.pdf', 'report-123'),
      ).rejects.toThrow('Failed to convert PDF to image PDF: Invalid PDF');

      // Input file should still be cleaned up in finally block
      expect(fsMock.rmSync).toHaveBeenCalled();
    });

    test('should cleanup input file even when conversion fails', async () => {
      const fixedTimestamp = 1234567890;
      vi.spyOn(Date, 'now').mockReturnValue(fixedTimestamp);
      fsMock.existsSync.mockReturnValue(true);

      sharedMock.spawnAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })
        .mockRejectedValueOnce(new Error('Unexpected error'));

      const logger = makeLogger();
      const converter = new ImagePdfConverter(logger);

      await expect(
        converter.convert('http://example.com/test.pdf', 'report-123'),
      ).rejects.toThrow('Unexpected error');

      expect(fsMock.rmSync).toHaveBeenCalledWith(
        join('/tmp', `report-123-${fixedTimestamp}-input.pdf`),
        { force: true },
      );
    });

    test('should not attempt to remove input file if it does not exist', async () => {
      const fixedTimestamp = 1234567890;
      vi.spyOn(Date, 'now').mockReturnValue(fixedTimestamp);
      fsMock.existsSync.mockReturnValue(false);

      sharedMock.spawnAsync.mockResolvedValueOnce({
        stdout: '',
        stderr: 'Download failed',
        code: 1,
      });

      const logger = makeLogger();
      const converter = new ImagePdfConverter(logger);

      await expect(
        converter.convert('http://example.com/test.pdf', 'report-123'),
      ).rejects.toThrow();

      expect(fsMock.rmSync).not.toHaveBeenCalled();
    });

    test('should use tmpdir for temp file location', async () => {
      const fixedTimestamp = 9999;
      vi.spyOn(Date, 'now').mockReturnValue(fixedTimestamp);
      vi.mocked(tmpdir).mockReturnValue('/custom/temp');
      fsMock.existsSync.mockReturnValue(true);

      sharedMock.spawnAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })
        .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });

      const logger = makeLogger();
      const converter = new ImagePdfConverter(logger);
      const result = await converter.convert(
        'http://example.com/test.pdf',
        'my-report',
      );

      expect(result).toBe(join('/custom/temp', 'my-report-9999-image.pdf'));
    });

    test('should throw with generic message when download stderr is empty', async () => {
      fsMock.existsSync.mockReturnValue(false);

      sharedMock.spawnAsync.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        code: 1,
      });

      const logger = makeLogger();
      const converter = new ImagePdfConverter(logger);

      await expect(
        converter.convert('http://example.com/test.pdf', 'report-123'),
      ).rejects.toThrow('Failed to download PDF: Unknown error');
    });

    test('should throw with generic message when ImageMagick stderr is empty', async () => {
      const fixedTimestamp = 1234567890;
      vi.spyOn(Date, 'now').mockReturnValue(fixedTimestamp);
      fsMock.existsSync.mockReturnValue(true);

      sharedMock.spawnAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 }) // curl success
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          code: 1,
        }); // magick fail with empty stderr

      const logger = makeLogger();
      const converter = new ImagePdfConverter(logger);

      await expect(
        converter.convert('http://example.com/test.pdf', 'report-123'),
      ).rejects.toThrow('Failed to convert PDF to image PDF: Unknown error');
    });
  });

  describe('cleanup', () => {
    test('should remove file if it exists', () => {
      fsMock.existsSync.mockReturnValue(true);

      const logger = makeLogger();
      const converter = new ImagePdfConverter(logger);
      converter.cleanup('/tmp/test-image.pdf');

      expect(fsMock.rmSync).toHaveBeenCalledWith('/tmp/test-image.pdf', {
        force: true,
      });
      expect(logger.info).toHaveBeenCalledWith(
        '[ImagePdfConverter] Cleaning up temp file:',
        '/tmp/test-image.pdf',
      );
    });

    test('should not attempt to remove file if it does not exist', () => {
      fsMock.existsSync.mockReturnValue(false);

      const logger = makeLogger();
      const converter = new ImagePdfConverter(logger);
      converter.cleanup('/tmp/nonexistent.pdf');

      expect(fsMock.rmSync).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
