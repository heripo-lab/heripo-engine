/**
 * Result type for document processing operation
 *
 * Contains both the processed document and detailed token usage information.
 */
import type { ProcessedDocument } from './processed-document';
import type { TokenUsageReport } from './token-usage-report';

/**
 * Complete result of document processing
 *
 * Combines the processed document output with comprehensive token usage tracking.
 */
export interface DocumentProcessResult {
  /**
   * The processed document
   *
   * Contains the structured document with text blocks, chapters, images, tables,
   * and page range mapping, optimized for LLM analysis.
   */
  document: ProcessedDocument;

  /**
   * Token usage report for the processing operation
   *
   * Detailed breakdown of LLM token consumption by component, phase, and model type.
   * Includes information about fallback model usage when primary models fail.
   */
  usage: TokenUsageReport;
}
