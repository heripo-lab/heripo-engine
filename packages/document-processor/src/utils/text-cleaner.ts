import { BatchProcessor } from '@heripo/shared';

/**
 * TextCleaner - Text normalization and cleaning
 *
 * Utility for normalizing text from DoclingDocument.
 * - Whitespace normalization (remove consecutive spaces, clean line breaks)
 * - Special character removal/normalization
 * - Unicode normalization
 * - Batch normalization + filtering
 */
export class TextCleaner {
  /**
   * Normalizes text
   * - Converts consecutive spaces/line breaks to single space
   * - Trims leading and trailing spaces
   * - Normalizes special whitespace characters (tabs, non-breaking spaces, etc.)
   */
  static normalize(text: string): string {
    if (!text) return '';

    // Unicode normalization (NFC)
    let normalized = text.normalize('NFC');

    // Convert special whitespace characters to regular space
    normalized = normalized.replace(/[\t\u00A0\u2000-\u200B]/g, ' ');

    // Convert line breaks to space
    normalized = normalized.replace(/[\r\n]+/g, ' ');

    // Convert consecutive spaces to single space
    normalized = normalized.replace(/\s+/g, ' ');

    // Trim leading and trailing spaces
    normalized = normalized.trim();

    return normalized;
  }

  /**
   * Clean text starting/ending with punctuation marks
   * - Remove commas/periods at sentence start
   * - Clean spaces and punctuation at sentence end
   */
  static cleanPunctuation(text: string): string {
    if (!text) return '';

    // Remove commas/periods at start
    let cleaned = text.replace(/^[,.:;!?]+\s*/, '');

    // Clean spaces at end
    cleaned = cleaned.replace(/\s+[,.:;!?]*$/, '');

    return cleaned;
  }

  /**
   * Filter text consisting only of numbers and spaces
   */
  static isValidText(text: string): boolean {
    if (!text) return false;
    const cleaned = this.normalize(text);
    // Invalid if only numbers and spaces
    return !/^\s*[\d\s]*$/.test(cleaned);
  }

  /**
   * Batch normalization (for bulk processing)
   */
  static normalizeBatch(texts: string[]): string[] {
    return texts.map((text) => this.normalize(text));
  }

  /**
   * Batch filtering (returns only valid text)
   */
  static filterValidTexts(texts: string[]): string[] {
    return texts.filter((text) => this.isValidText(text));
  }

  /**
   * Batch normalization + filtering (stage 1 + stage 2 combined)
   *
   * Performs TextCleaner's basic normalization and filtering in batch processing at once.
   * Splits large amounts of text into batches for efficient processing.
   *
   * If batchSize is 0, processes items sequentially without batch processing.
   *
   * @param texts - Original text array
   * @param batchSize - Batch size (default: 10). Set to 0 for sequential processing without batching.
   * @returns Normalized and filtered text array
   *
   * @example
   * ```typescript
   * const rawTexts = ['  text 1  ', '123', 'text 2\n'];
   * const cleaned = TextCleaner.normalizeAndFilterBatch(rawTexts, 10);
   * // ['text 1', 'text 2']
   *
   * // Sequential processing (no batching)
   * const cleanedSequential = TextCleaner.normalizeAndFilterBatch(rawTexts, 0);
   * // ['text 1', 'text 2']
   * ```
   */
  static normalizeAndFilterBatch(
    texts: string[],
    batchSize: number = 10,
  ): string[] {
    if (batchSize === 0) {
      // Sequential processing without BatchProcessor
      const results: string[] = [];
      for (const text of texts) {
        const normalized = this.normalize(text);
        if (this.isValidText(normalized)) {
          results.push(normalized);
        }
      }
      return results;
    }

    // Batch processing: normalize then filter for each batch
    return BatchProcessor.processBatchSync(texts, batchSize, (batch) => {
      // Stage 1: Normalize
      const normalized = this.normalizeBatch(batch);
      // Stage 2: Filter
      return this.filterValidTexts(normalized);
    });
  }
}
