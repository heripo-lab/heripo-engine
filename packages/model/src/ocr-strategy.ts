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

  /** Primary document language detected during sampling (ISO 639-1, e.g., 'ko') */
  detectedLanguage?: string;

  /** Human-readable explanation of the decision */
  reason: string;

  /** Number of pages that were sampled for the decision */
  sampledPages: number;

  /** Total number of pages in the document */
  totalPages: number;
}
