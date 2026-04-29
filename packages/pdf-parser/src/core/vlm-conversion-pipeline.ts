import type { LoggerMethods } from '@heripo/logger';
import type { LanguageModel } from 'ai';

import type {
  ConversionCompleteCallback,
  PDFConvertOptions,
} from './pdf-converter';

import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

import { PdfTextExtractor } from '../processors/pdf-text-extractor';
import { VlmTextCorrector } from '../processors/vlm-text-corrector';
import { runJqFileJson } from '../utils/jq';
import { isReviewAssistanceEnabled } from './review-assistance-options';

/**
 * Wraps the standard OCR callback with VLM text correction.
 *
 * Runs the standard OCR pipeline (Docling) first, then applies VLM text
 * correction to fix garbled Chinese characters (漢字/Hanja) in OCR output.
 */
export class VlmConversionPipeline {
  constructor(private readonly logger: LoggerMethods) {}

  /**
   * Wrap the original callback with VLM text correction.
   * Returns a new callback that runs VLM correction before calling the original.
   */
  wrapCallback(
    pdfPath: string,
    options: PDFConvertOptions,
    originalCallback: ConversionCompleteCallback,
    abortSignal?: AbortSignal,
    detectedLanguages?: string[],
    koreanHanjaMixPages?: number[],
  ): ConversionCompleteCallback {
    if (
      isReviewAssistanceEnabled(
        options.reviewAssistance,
        options.reviewAssistanceConcurrency,
      )
    ) {
      this.logger.info(
        '[VlmConversionPipeline] Review Assistance enabled; legacy VLM text correction skipped',
      );
      return originalCallback;
    }

    if (!options.vlmProcessorModel) {
      throw new Error('vlmProcessorModel is required when OCR strategy is VLM');
    }

    return async (outputDir: string) => {
      // Pre-extract text from PDF text layer for VLM reference
      let pageTexts: Map<number, string> | undefined;
      try {
        const resultPath = join(outputDir, 'result.json');
        // Use jq to extract only page count — avoids loading full JSON into memory
        const totalPages = await runJqFileJson<number>(
          '.pages | length',
          resultPath,
        );
        const textExtractor = new PdfTextExtractor(this.logger);
        pageTexts = await textExtractor.extractText(pdfPath, totalPages);
      } catch {
        this.logger.warn(
          '[PDFConverter] pdftotext extraction failed, proceeding without text reference',
        );
      }

      // Save OCR-only result before VLM correction for debugging
      const resultPath = join(outputDir, 'result.json');
      const ocrOriginPath = join(outputDir, 'result_ocr_origin.json');
      copyFileSync(resultPath, ocrOriginPath);

      const corrector = new VlmTextCorrector(this.logger);
      await corrector.correctAndSave(
        outputDir,
        options.vlmProcessorModel as LanguageModel,
        {
          concurrency: options.vlmConcurrency,
          aggregator: options.aggregator,
          abortSignal,
          onTokenUsage: options.onTokenUsage,
          documentLanguages: detectedLanguages,
          pageTexts,
          koreanHanjaMixPages,
        },
      );
      await originalCallback(outputDir);
    };
  }
}
