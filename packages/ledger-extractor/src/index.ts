/**
 * @heripo/ledger-extractor
 *
 * Ledger extraction preview package.
 *
 * Takes a ProcessedDocument (produced by `@heripo/document-processor`) and
 * summarizes it into a LedgerExtractionPreview: aggregated counts and a few
 * representative samples. This is the first vertical slice of the ledger
 * extraction stage. Separate APIs provide a complete resource index and bounded,
 * source-backed LLM candidate proposals. The final ledger domain schema,
 * standardization, and storage are follow-up work.
 *
 * ## Key Features
 * - Runtime validation of unknown input (`parseProcessedDocument`)
 * - Recursive chapter/text-block aggregation
 * - Table grid cell aggregation
 * - Bounded samples (chapter titles, text blocks, image URLs, tables)
 * - Whole-document source lookup and investigation candidate review
 *
 * @packageDocumentation
 */

export { LedgerExtractor } from './ledger-extractor';
export type {
  LedgerExtractionPreview,
  LedgerExtractorLogger,
  LedgerExtractorOptions,
} from './types';
export * from './candidates';
export * from './resources';
export * from './validators';
export * from './content-attachment';
export * from './profile';
export * from './ledger';
export * from './relations';
export * from './media';
export * from './attributes';
export * from './links';
export {
  SPEND_GUARD_DEFAULT_MAX_OUTPUT_TOKENS,
  SpendLimitError,
  createSpendGuard,
  type SpendAmount,
  type SpendGuard,
  type SpendLimits,
  type SpendReservation,
} from '@heripo/shared';
