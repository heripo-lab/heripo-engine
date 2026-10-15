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
export {
  prepareCandidateDiscovery,
  prepareCandidateDiscoveryRetry,
  discoverCandidateUnit,
  assembleCandidateDiscovery,
  CANDIDATE_DISCOVERY_PROMPT_VERSION,
} from './candidate-discovery';
export type {
  CandidateDiscoveryPlan,
  CandidateDiscoveryUnit,
  CandidateDiscoveryAudit,
  CandidateDiscoveryResult,
  CandidateEvidence,
  LedgerObjectCandidate,
} from './candidate-discovery';
export {
  buildDocumentResourceIndex,
  queryDocumentResources,
} from './document-resource-index';
export type {
  DocumentResource,
  DocumentResourceIndex,
  DocumentResourceQuery,
} from './document-resource-index';
export {
  parseProcessedDocument,
  ProcessedDocumentValidationError,
} from './parse-processed-document';
export type {
  LedgerExtractionPreview,
  LedgerExtractorLogger,
  LedgerExtractorOptions,
} from './types';

export {
  createCandidateDeduplicationRequest,
  deduplicateCandidates,
  assembleCandidateDeduplication,
  getCandidateGroupMembers,
  CANDIDATE_DEDUPLICATION_PROMPT_VERSION,
} from './candidate-deduplication';
export type {
  CandidateDeduplicationAudit,
  CandidateDeduplicationResult,
  CandidateGroup,
} from './candidate-deduplication';

export {
  prepareContentAttachment,
  createContentAttachmentRequest,
  attachContentUnit,
  assembleContentAttachment,
  CONTENT_ATTACHMENT_PROMPT_VERSION,
} from './content-attachment';
export type {
  ContentAttachmentPlan,
  ContentAttachmentAudit,
  ContentAttachmentResponse,
  ContentAttachmentSelectionResponse,
  ContentAttachmentSelectionAudit,
  ContentAttachmentResult,
  AttachmentUnit,
} from './content-attachment';

export { createContentAttachmentInput } from './content-attachment-input';
export { createContentAttachmentSelectionInput } from './content-attachment-excerpts';
export { createContentAttachmentDecisionInput } from './content-attachment-decisions';
export type { ContentRegistrationDecision } from './content-attachment-decisions';

export { createContentAttachmentTableAnchorInput } from './content-attachment-table-anchors';
