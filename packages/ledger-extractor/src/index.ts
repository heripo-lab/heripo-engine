/**
 * @heripo/ledger-extractor
 *
 * Ledger extraction preview package.
 *
 * Takes a ProcessedDocument (produced by `@heripo/document-processor`) and
 * summarizes it into a LedgerExtractionPreview: aggregated counts and a few
 * representative samples. This is the first vertical slice of the ledger
 * extraction stage — the actual ledger domain schema, LLM-based extraction,
 * standardization, and storage are follow-up work.
 *
 * ## Key Features
 * - Runtime validation of unknown input (`parseProcessedDocument`)
 * - Recursive chapter/text-block aggregation
 * - Table grid cell aggregation
 * - Bounded samples (chapter titles, text blocks, image URLs, tables)
 *
 * @packageDocumentation
 */

export { LedgerExtractor } from './ledger-extractor';
export {
  parseProcessedDocument,
  ProcessedDocumentValidationError,
} from './parse-processed-document';
export type {
  LedgerExtractionPreview,
  LedgerExtractorLogger,
  LedgerExtractorOptions,
} from './types';
