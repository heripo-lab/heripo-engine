import type { Bcp47LanguageTag } from '../language/bcp47-language-tag';

/**
 * Result of the OCR strategy sampling phase.
 * Determines whether to use ocrmac (standard Docling pipeline)
 * or VLM (direct vision language model processing) for a given document.
 */
export interface OcrStrategy {
  /** Selected OCR method */
  method: 'ocrmac' | 'vlm';

  /** OCR language weights for ocrmac (e.g., ['ko-KR', 'en-US'] or ['zh-Hant', 'ko-KR']) */
  ocrLanguages?: string[];

  /** BCP 47 language tags detected during sampling, ordered by frequency (e.g., ['ko-KR', 'en-US']) */
  detectedLanguages?: Bcp47LanguageTag[];

  /** Human-readable explanation of the decision */
  reason: string;

  /** Number of pages that were sampled for the decision */
  sampledPages: number;

  /** Total number of pages in the document */
  totalPages: number;

  /** 1-based page numbers where Korean-Hanja mixed script was detected in text layer */
  koreanHanjaMixPages?: number[];
}
