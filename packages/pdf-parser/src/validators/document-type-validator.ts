import type { LanguageModel } from 'ai';

import type { PdfTextExtractor } from '../processors/pdf-text-extractor';

import { LLMCaller } from '@heripo/shared';
import { z } from 'zod';

import { InvalidDocumentTypeError } from '../errors/invalid-document-type-error';

const SYSTEM_PROMPT = `You are given text extracted from the first and last pages of a PDF document.
Determine if this document is an archaeological investigation report from any country.

Valid types include (in any language):
- Excavation report (발굴조사보고서)
- Trial excavation report (시굴조사보고서)
- Surface survey report (지표조사보고서)
- Detailed excavation report (정밀발굴조사보고서)
- Underwater excavation report (수중발굴조사보고서)
- Salvage excavation report
- Archaeological assessment report
- Any other archaeological fieldwork investigation report

NOT valid (these are NOT archaeological investigation reports):
- Repair/restoration reports (수리보고서)
- Simple measurement reports (단순 실측 보고서)
- Architectural investigation reports (건축조사보고서)
- Academic research reports (학술조사보고서)
- Environmental impact assessments (환경영향평가)
- General academic papers or textbooks about archaeology
- Conservation/preservation reports
- Museum catalogs or exhibition guides`;

const documentTypeSchema = z.object({
  isValid: z
    .boolean()
    .describe('Whether this is an archaeological investigation report'),
  reason: z.string().describe('Brief reason for the decision'),
});

export interface DocumentTypeValidatorOptions {
  abortSignal?: AbortSignal;
}

/**
 * Validates whether a PDF is an archaeological investigation report
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
