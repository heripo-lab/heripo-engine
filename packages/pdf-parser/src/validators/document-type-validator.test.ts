import { LLMCaller } from '@heripo/shared';
import { describe, expect, test, vi } from 'vitest';

import { InvalidDocumentTypeError } from '../errors/invalid-document-type-error';
import { PdfTextExtractor } from '../processors/pdf-text-extractor';
import { DocumentTypeValidator } from './document-type-validator';

vi.mock('@heripo/shared', () => ({
  LLMCaller: {
    call: vi.fn(),
  },
}));

vi.mock('../processors/pdf-text-extractor');

const mockModel = {} as any;

function createMockExtractor() {
  const extractor = new PdfTextExtractor({} as any);
  vi.mocked(extractor.getPageCount).mockResolvedValue(100);
  vi.mocked(extractor.extractPageRange).mockResolvedValue('sample text');
  return extractor;
}

describe('DocumentTypeValidator', () => {
  test('should pass when LLM determines document is valid', async () => {
    const extractor = createMockExtractor();
    vi.mocked(LLMCaller.call).mockResolvedValue({
      output: { isValid: true, reason: 'This is an excavation report' },
      usage: {} as any,
      usedFallback: false,
    });

    const validator = new DocumentTypeValidator(extractor);
    await expect(
      validator.validate('/test.pdf', mockModel),
    ).resolves.toBeUndefined();
  });

  test('should throw InvalidDocumentTypeError when LLM determines document is invalid', async () => {
    const extractor = createMockExtractor();
    vi.mocked(LLMCaller.call).mockResolvedValue({
      output: { isValid: false, reason: 'This is a repair report' },
      usage: {} as any,
      usedFallback: false,
    });

    const validator = new DocumentTypeValidator(extractor);
    await expect(validator.validate('/test.pdf', mockModel)).rejects.toThrow(
      InvalidDocumentTypeError,
    );
    await expect(validator.validate('/test.pdf', mockModel)).rejects.toThrow(
      'This is a repair report',
    );
  });

  test('should pass when text is empty (image-only PDF)', async () => {
    const extractor = createMockExtractor();
    vi.mocked(extractor.extractPageRange).mockResolvedValue('');

    const validator = new DocumentTypeValidator(extractor);
    await expect(
      validator.validate('/test.pdf', mockModel),
    ).resolves.toBeUndefined();
    expect(LLMCaller.call).not.toHaveBeenCalled();
  });

  test('should pass when page count is 0', async () => {
    const extractor = createMockExtractor();
    vi.mocked(extractor.getPageCount).mockResolvedValue(0);

    const validator = new DocumentTypeValidator(extractor);
    await expect(
      validator.validate('/test.pdf', mockModel),
    ).resolves.toBeUndefined();
    expect(extractor.extractPageRange).not.toHaveBeenCalled();
    expect(LLMCaller.call).not.toHaveBeenCalled();
  });

  test('should call extractPageRange once when totalPages <= 20', async () => {
    const extractor = createMockExtractor();
    vi.mocked(extractor.getPageCount).mockResolvedValue(15);
    vi.mocked(LLMCaller.call).mockResolvedValue({
      output: { isValid: true, reason: 'valid' },
      usage: {} as any,
      usedFallback: false,
    });

    const validator = new DocumentTypeValidator(extractor);
    await validator.validate('/test.pdf', mockModel);

    expect(extractor.extractPageRange).toHaveBeenCalledTimes(1);
    expect(extractor.extractPageRange).toHaveBeenCalledWith('/test.pdf', 1, 10);
  });

  test('should call extractPageRange twice when totalPages > 20', async () => {
    const extractor = createMockExtractor();
    vi.mocked(extractor.getPageCount).mockResolvedValue(50);
    vi.mocked(LLMCaller.call).mockResolvedValue({
      output: { isValid: true, reason: 'valid' },
      usage: {} as any,
      usedFallback: false,
    });

    const validator = new DocumentTypeValidator(extractor);
    await validator.validate('/test.pdf', mockModel);

    expect(extractor.extractPageRange).toHaveBeenCalledTimes(2);
    expect(extractor.extractPageRange).toHaveBeenCalledWith('/test.pdf', 1, 10);
    expect(extractor.extractPageRange).toHaveBeenCalledWith(
      '/test.pdf',
      41,
      50,
    );
  });

  test('should pass abort signal to LLMCaller', async () => {
    const extractor = createMockExtractor();
    const abortController = new AbortController();
    vi.mocked(LLMCaller.call).mockResolvedValue({
      output: { isValid: true, reason: 'valid' },
      usage: {} as any,
      usedFallback: false,
    });

    const validator = new DocumentTypeValidator(extractor);
    await validator.validate('/test.pdf', mockModel, {
      abortSignal: abortController.signal,
    });

    expect(LLMCaller.call).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: abortController.signal,
      }),
    );
  });
});
