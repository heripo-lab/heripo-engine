import { spawnAsync } from '@heripo/shared';
import { type Mock, beforeEach, describe, expect, test, vi } from 'vitest';

import { PdfTextExtractor } from './pdf-text-extractor';

vi.mock('@heripo/shared', () => ({
  spawnAsync: vi.fn(),
}));

const mockSpawnAsync = spawnAsync as Mock;

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('PdfTextExtractor', () => {
  let extractor: PdfTextExtractor;

  beforeEach(() => {
    vi.clearAllMocks();
    extractor = new PdfTextExtractor(mockLogger);
  });

  describe('extractText', () => {
    test('extracts text from all pages and returns Map', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce({
          code: 0,
          stdout: 'Page 1 text content',
          stderr: '',
        })
        .mockResolvedValueOnce({
          code: 0,
          stdout: 'Page 2 text content',
          stderr: '',
        })
        .mockResolvedValueOnce({
          code: 0,
          stdout: 'Page 3 text content',
          stderr: '',
        });

      const result = await extractor.extractText('/tmp/test.pdf', 3);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(3);
      expect(result.get(1)).toBe('Page 1 text content');
      expect(result.get(2)).toBe('Page 2 text content');
      expect(result.get(3)).toBe('Page 3 text content');
    });

    test('calls pdftotext with correct arguments for each page', async () => {
      mockSpawnAsync.mockResolvedValue({
        code: 0,
        stdout: 'text',
        stderr: '',
      });

      await extractor.extractText('/tmp/test.pdf', 2);

      expect(mockSpawnAsync).toHaveBeenCalledTimes(2);
      expect(mockSpawnAsync).toHaveBeenNthCalledWith(1, 'pdftotext', [
        '-f',
        '1',
        '-l',
        '1',
        '-layout',
        '/tmp/test.pdf',
        '-',
      ]);
      expect(mockSpawnAsync).toHaveBeenNthCalledWith(2, 'pdftotext', [
        '-f',
        '2',
        '-l',
        '2',
        '-layout',
        '/tmp/test.pdf',
        '-',
      ]);
    });

    test('returns empty string for pages where pdftotext fails', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce({
          code: 0,
          stdout: 'Page 1 text',
          stderr: '',
        })
        .mockResolvedValueOnce({
          code: 1,
          stdout: '',
          stderr: 'pdftotext error',
        });

      const result = await extractor.extractText('/tmp/test.pdf', 2);

      expect(result.get(1)).toBe('Page 1 text');
      expect(result.get(2)).toBe('');
    });

    test('logs warning when pdftotext fails for a page', async () => {
      mockSpawnAsync.mockResolvedValueOnce({
        code: 1,
        stdout: '',
        stderr: 'Syntax Error: Invalid PDF',
      });

      await extractor.extractText('/tmp/test.pdf', 1);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[PdfTextExtractor] pdftotext failed for page 1: Syntax Error: Invalid PDF',
      );
    });

    test('logs warning with fallback message when stderr is empty', async () => {
      mockSpawnAsync.mockResolvedValueOnce({
        code: 1,
        stdout: '',
        stderr: '',
      });

      await extractor.extractText('/tmp/test.pdf', 1);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[PdfTextExtractor] pdftotext failed for page 1: Unknown error',
      );
    });

    test('returns empty Map for 0 pages', async () => {
      const result = await extractor.extractText('/tmp/test.pdf', 0);

      expect(result.size).toBe(0);
      expect(mockSpawnAsync).not.toHaveBeenCalled();
    });

    test('handles image-only pages with empty pdftotext output', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce({
          code: 0,
          stdout: '한국어 텍스트',
          stderr: '',
        })
        .mockResolvedValueOnce({
          code: 0,
          stdout: '   \n\n  ',
          stderr: '',
        });

      const result = await extractor.extractText('/tmp/test.pdf', 2);

      expect(result.get(1)).toBe('한국어 텍스트');
      expect(result.get(2)).toBe('   \n\n  ');
    });

    test('logs extraction start and completion with non-empty count', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce({
          code: 0,
          stdout: 'Text content',
          stderr: '',
        })
        .mockResolvedValueOnce({
          code: 0,
          stdout: '   \n  ',
          stderr: '',
        })
        .mockResolvedValueOnce({
          code: 0,
          stdout: 'More text',
          stderr: '',
        });

      await extractor.extractText('/tmp/test.pdf', 3);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[PdfTextExtractor] Extracting text from 3 pages...',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[PdfTextExtractor] Extracted text from 2/3 pages',
      );
    });

    test('counts failed pages as non-text in summary', async () => {
      mockSpawnAsync
        .mockResolvedValueOnce({
          code: 0,
          stdout: 'Text content',
          stderr: '',
        })
        .mockResolvedValueOnce({
          code: 1,
          stdout: '',
          stderr: 'error',
        });

      await extractor.extractText('/tmp/test.pdf', 2);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[PdfTextExtractor] Extracted text from 1/2 pages',
      );
    });
  });

  describe('extractPageText', () => {
    test('returns text from a single page', async () => {
      mockSpawnAsync.mockResolvedValueOnce({
        code: 0,
        stdout: 'Single page text',
        stderr: '',
      });

      const result = await extractor.extractPageText('/tmp/test.pdf', 3);

      expect(result).toBe('Single page text');
      expect(mockSpawnAsync).toHaveBeenCalledWith('pdftotext', [
        '-f',
        '3',
        '-l',
        '3',
        '-layout',
        '/tmp/test.pdf',
        '-',
      ]);
    });

    test('returns empty string on failure', async () => {
      mockSpawnAsync.mockResolvedValueOnce({
        code: 1,
        stdout: '',
        stderr: 'Error reading PDF',
      });

      const result = await extractor.extractPageText('/tmp/test.pdf', 1);

      expect(result).toBe('');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[PdfTextExtractor] pdftotext failed for page 1: Error reading PDF',
      );
    });
  });

  describe('getPageCount', () => {
    test('returns page count from pdfinfo output', async () => {
      mockSpawnAsync.mockResolvedValueOnce({
        code: 0,
        stdout: [
          'Title:          Test Document',
          'Author:         Test',
          'Pages:          42',
          'Page size:      595.276 x 841.89 pts (A4)',
        ].join('\n'),
        stderr: '',
      });

      const result = await extractor.getPageCount('/tmp/test.pdf');

      expect(result).toBe(42);
      expect(mockSpawnAsync).toHaveBeenCalledWith('pdfinfo', ['/tmp/test.pdf']);
    });

    test('returns 0 when pdfinfo fails', async () => {
      mockSpawnAsync.mockResolvedValueOnce({
        code: 1,
        stdout: '',
        stderr: 'Command not found',
      });

      const result = await extractor.getPageCount('/tmp/test.pdf');

      expect(result).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[PdfTextExtractor] pdfinfo failed: Command not found',
      );
    });

    test('returns 0 when pdfinfo fails with empty stderr', async () => {
      mockSpawnAsync.mockResolvedValueOnce({
        code: 1,
        stdout: '',
        stderr: '',
      });

      const result = await extractor.getPageCount('/tmp/test.pdf');

      expect(result).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[PdfTextExtractor] pdfinfo failed: Unknown error',
      );
    });

    test('returns 0 when Pages line is missing from output', async () => {
      mockSpawnAsync.mockResolvedValueOnce({
        code: 0,
        stdout: 'Title: Test\nAuthor: Test\n',
        stderr: '',
      });

      const result = await extractor.getPageCount('/tmp/test.pdf');

      expect(result).toBe(0);
    });

    test('parses single-digit page count', async () => {
      mockSpawnAsync.mockResolvedValueOnce({
        code: 0,
        stdout: 'Pages:          1\n',
        stderr: '',
      });

      const result = await extractor.getPageCount('/tmp/test.pdf');

      expect(result).toBe(1);
    });

    test('parses large page count', async () => {
      mockSpawnAsync.mockResolvedValueOnce({
        code: 0,
        stdout: 'Pages:          1234\n',
        stderr: '',
      });

      const result = await extractor.getPageCount('/tmp/test.pdf');

      expect(result).toBe(1234);
    });
  });
});
