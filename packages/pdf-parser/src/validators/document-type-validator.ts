import type { LanguageModel } from 'ai';

import type { PdfTextExtractor } from '../processors/pdf-text-extractor';

import { LLMCaller } from '@heripo/shared';
import { z } from 'zod';

import { InvalidDocumentTypeError } from '../errors/invalid-document-type-error';

const SYSTEM_PROMPT = `You are given text extracted from the first and last pages of a PDF document.
Determine if this document is a Korean archaeological investigation report (고고학 조사 보고서).

Valid types include:
- 발굴조사보고서 (excavation investigation report)
- 시굴조사보고서 (trial excavation report)
- 지표조사보고서 (surface survey report)
- 정밀발굴조사보고서 (detailed excavation report)
- 수중발굴조사보고서 (underwater excavation report)

NOT valid (these are NOT archaeological investigation reports):
- 수리보고서 (repair/restoration report)
- 단순 실측 보고서 (simple measurement report)
- 건축조사보고서 (architectural investigation report)
- 학술조사보고서 (academic research report)
- 환경영향평가 (environmental impact assessment)
- General academic papers or textbooks about archaeology`;

const documentTypeSchema = z.object({
  isValid: z
    .boolean()
    .describe('Whether this is a Korean archaeological investigation report'),
  reason: z.string().describe('Brief reason for the decision'),
});

export interface DocumentTypeValidatorOptions {
  abortSignal?: AbortSignal;
}

/**
 * Validates whether a PDF is a Korean archaeological investigation report
 * by extracting text from the first and last pages and using an LLM to classify it.
 */
export class DocumentTypeValidator {
  private readonly textExtractor: PdfTextExtractor;

  constructor(textExtractor: PdfTextExtractor) {
    this.textExtractor = textExtractor;
  }

  /**
   * Validate that the PDF at the given path is an archaeological investigation report.
   *
   * @throws {InvalidDocumentTypeError} if the document is not a valid report type
   */
  async validate(
    pdfPath: string,
    model: LanguageModel,
    options?: DocumentTypeValidatorOptions,
  ): Promise<void> {
    const totalPages = await this.textExtractor.getPageCount(pdfPath);
    if (totalPages === 0) return;

    // Extract front pages
    const frontText = await this.textExtractor.extractPageRange(
      pdfPath,
      1,
      Math.min(10, totalPages),
    );

    // Extract back pages only if document is longer than 20 pages
    let backText = '';
    if (totalPages > 20) {
      backText = await this.textExtractor.extractPageRange(
        pdfPath,
        Math.max(1, totalPages - 9),
        totalPages,
      );
    }

    const combinedText = (frontText + '\n' + backText).trim();

    // Skip validation for image-only PDFs (no extractable text)
    if (combinedText.length === 0) return;

    const result = await LLMCaller.call({
      schema: documentTypeSchema,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `--- Document text (first and last pages) ---\n${combinedText}`,
      primaryModel: model,
      maxRetries: 2,
      temperature: 0,
      abortSignal: options?.abortSignal,
      component: 'DocumentTypeValidator',
      phase: 'validation',
    });

    if (!result.output.isValid) {
      throw new InvalidDocumentTypeError(result.output.reason);
    }
  }
}
