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
  groupCandidateUncertainties,
  CANDIDATE_DEDUPLICATION_PROMPT_VERSION,
} from './candidate-deduplication';
export type {
  CandidateDeduplicationAudit,
  CandidateDeduplicationResult,
  CandidateGroup,
  CandidateGroupUncertainty,
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

export { createContentAttachmentContextInput } from './content-attachment-context';

export { createContentAttachmentBodyBlockInput } from './content-attachment-body-blocks';

export type { ContentAttachmentRequiredResponse } from './content-attachment-response';

export { createContentAttachmentOriginInput } from './content-attachment-origins';

export {
  createContentAttachmentGroundedInput,
  createContentAttachmentGroundedSchema,
  inspectContentAttachmentGrounding,
} from './content-attachment-grounding';
export type {
  ContentAttachmentGroundedResponse,
  ContentAttachmentExclusion,
} from './content-attachment-grounding';

export {
  createContentAttachmentInventoryReviewRequest,
  inspectContentAttachmentInventoryReview,
} from './content-attachment-inventory-review';
export type {
  ContentAttachmentInventoryReviewAudit,
  ContentAttachmentInventoryReviewResponse,
} from './content-attachment-inventory-review';

export {
  createContentAttachmentIndependentReviewRequest,
  inspectContentAttachmentIndependentReview,
} from './content-attachment-independent-review';
export type {
  ContentAttachmentIndependentMember,
  ContentAttachmentIndependentReviewAudit,
  ContentAttachmentIndependentReviewResponse,
  ContentAttachmentReviewFinding,
} from './content-attachment-independent-review';

export type {
  ContentAttachmentWordEvidenceSnapshot,
  ContentAttachmentWordRangeEvidence,
} from './content-attachment-word-evidence';

export type {
  ContentAttachmentReviewSegment,
  ContentAttachmentSegmentDecision,
  ContentAttachmentSegmentFinding,
} from './content-attachment-segment-review';

export {
  CONTENT_ATTACHMENT_SEGMENTATION_VERSION,
  createContentAttachmentSegmentationRequest,
  identifyContentAttachmentSegments,
  inspectContentAttachmentSegmentation,
} from './content-attachment-segmentation';
export type {
  ContentAttachmentSegmentationAudit,
  ContentAttachmentSegmentationResponse,
  ContentAttachmentIdentifiedSegment,
} from './content-attachment-segmentation';

export {
  CONTENT_ATTACHMENT_RECIPIENT_VERSION,
  createContentAttachmentRecipientRequest,
  inspectContentAttachmentRecipients,
  judgeContentAttachmentRecipients,
} from './content-attachment-recipients';
export type {
  ContentAttachmentRecipientSupport,
  ContentAttachmentRecipientAttachment,
  ContentAttachmentRecipientAlternative,
  ContentAttachmentRecipientDecision,
  ContentAttachmentRecipientResponse,
  ContentAttachmentAreaRecipientDecision,
  ContentAttachmentAreaRecipientResponse,
  ContentAttachmentRecipientAttachmentOrigin,
  ContentAttachmentDerivedRecipientResponse,
  ContentAttachmentRecipientAudit,
  ContentAttachmentResolvedRecipientSupport,
  ContentAttachmentRecipientFinding,
} from './content-attachment-recipients';

export type {
  ContentAttachmentCollectiveMember,
  ContentAttachmentCollectiveTrace,
} from './content-attachment-collective-trace';

export type {
  ContentAttachmentInventoryReview,
  ContentAttachmentInventoryContext,
} from './content-attachment-inventory-reviews';

export type {
  ContentAttachmentWorkScopeAssessment,
  ContentAttachmentWorkTarget,
} from './content-attachment-work-scope';

export type {
  ContentAttachmentAreaAssessment,
  ContentAttachmentGroundedAreaAssessment,
} from './content-attachment-area-assessments';

export type { ContentAttachmentWorkGroupReview } from './content-attachment-work-group-reviews';

export {
  CONTENT_ATTACHMENT_SOURCE_CONTEXT_VERSION,
  createContentAttachmentSourceContextRequest,
  resolveContentAttachmentSourceContextRange,
} from './content-attachment-source-context';
export type {
  ContentAttachmentSourceContextOptions,
  ContentAttachmentSourceContextRequest,
  ContentAttachmentTableContextPair,
  ContentAttachmentSourceContextBinding,
} from './content-attachment-source-context';

export {
  createContentAttachmentSourceContextReplaySnapshot,
  inspectContentAttachmentSourceContextRecipients,
} from './content-attachment-source-context-inspection';
export type {
  ContentAttachmentSourceContextRecipientAudit,
  ContentAttachmentSourceContextRecipientInspection,
} from './content-attachment-source-context-inspection';

export {
  CONTENT_ATTACHMENT_EVIDENCE_WINDOWS_VERSION,
  CONTENT_ATTACHMENT_EVIDENCE_WINDOWS_PROMPT_VERSION,
  createContentAttachmentEvidenceWindowRequest,
  resolveContentAttachmentEvidenceWindowRange,
  projectContentAttachmentEvidenceWindowChain,
} from './content-attachment-evidence-windows';
export type {
  ContentAttachmentEvidenceWindow,
  ContentAttachmentEvidenceWindowRequest,
  ContentAttachmentEvidenceWindowVersion,
} from './content-attachment-evidence-windows';
export { inspectContentAttachmentEvidenceWindowRecipients } from './content-attachment-evidence-window-inspection';
export type {
  ContentAttachmentEvidenceWindowAudit,
  ContentAttachmentEvidenceWindowInspection,
} from './content-attachment-evidence-window-inspection';
