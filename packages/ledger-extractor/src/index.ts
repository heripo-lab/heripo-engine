/**
 * @heripo/ledger-extractor
 *
 * Archaeology ledger extraction from a ProcessedDocument (produced by
 * `@heripo/document-processor`).
 *
 * Builds an experimental `archaeology-ledger.v1` ledger: report profile,
 * investigation-object candidate discovery with duplicate review, thin per-unit
 * content attachment, parents, media references, table attributes, record links
 * and validation. Model calls run in separate steps that return their prompts,
 * raw responses and usage; ledger assembly makes no model calls. Original source
 * text is kept unchanged and model output is never repaired. Standardization and
 * storage are follow-up work.
 *
 * ## Key Features
 * - Runtime validation of unknown input (`parseProcessedDocument`)
 * - Whole-document resource index and source lookup (S0)
 * - Source-backed candidate discovery, duplicate review and content attachment
 * - Ledger assembly and validation (`buildArchaeologyLedger`)
 * - Spend guard with hard call and token caps (`createSpendGuard`)
 * - Bounded extraction preview (`LedgerExtractor`)
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
  SPEND_GUARD_ATTEMPT_OVERHEAD_TOKENS,
  SPEND_GUARD_DEFAULT_MAX_OUTPUT_TOKENS,
  SpendLimitError,
  createSpendGuard,
  spendInputTokenBound,
  type SpendAmount,
  type SpendGuard,
  type SpendLimits,
  type SpendReservation,
} from '@heripo/shared';
