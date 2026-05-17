import type { ConversionOptions } from 'docling-sdk';

import type { PDFConvertOptions } from './pdf-converter';

import { omit } from 'es-toolkit';

import { DEFAULT_OCR_LANGUAGES } from '../detectors/pdf-language-detector';

/**
 * Build Docling ConversionOptions from PDFConvertOptions.
 * Strips pdf-parser-specific fields and configures OCR settings.
 */
export function buildConversionOptions(
  options: PDFConvertOptions,
): ConversionOptions {
  const ocrLanguages = options.ocr_lang ?? DEFAULT_OCR_LANGUAGES;

  return {
    ...omit(options, [
      'num_threads',
      'document_timeout',
      'forceImagePdf',
      'correction',
      'aggregator',
      'onTokenUsage',
      'onReviewAssistanceProgress',
      'chunkedConversion',
      'chunkSize',
      'chunkMaxRetries',
      'documentValidationModel',
      'languageDetectionModel',
    ]),
    to_formats: ['json', 'html'],
    image_export_mode: 'embedded',
    // Docling currently reads this top-level field in addition to ocr_options.
    // Keep it populated even when language detection is skipped.
    ocr_lang: ocrLanguages,
    ocr_engine: 'ocrmac',
    ocr_options: {
      kind: 'ocrmac',
      lang: ocrLanguages,
      recognition: 'accurate',
      framework: 'livetext',
    },
    generate_picture_images: true,
    do_picture_classification: true,
    do_picture_description: true,
    generate_page_images: false, // Page images are rendered by PageRenderer (ImageMagick) after conversion
    images_scale: 2.0,
    /**
     * While disabling this option yields the most accurate text extraction for readable PDFs,
     * text layers overlaid on images or drawings can introduce noise when not merged properly.
     * In practice, archaeological report PDFs almost always contain such overlapping cases.
     * Enabling force_ocr mitigates this risk. Although OCR may introduce minor errors compared
     * to direct text extraction, the accuracy remains high since the source is digital, not scanned paper.
     */
    force_ocr: true,
    accelerator_options: {
      device: 'mps',
      num_threads: options.num_threads,
    },
    ...(options.document_timeout !== undefined && {
      document_timeout: options.document_timeout,
    }),
  };
}
