import type { ExtendedTokenUsage, LLMCallAttempt } from '@heripo/shared';

import type { CandidateEvidence } from '../../candidates/candidate-discovery';
import type { createContentAttachmentGroundedInput } from '../grounding';
import type {
  ContentAttachmentAreaAssessment,
  ContentAttachmentGroundedAreaAssessment,
} from './area-assessments';
import type { ContentAttachmentCollectiveTrace } from './collective-trace';
import type { ContentAttachmentInventoryContext } from './inventory-reviews';
import type { RecipientVersion } from './prompt';
import type { ContentAttachmentIdentifiedSegment } from './segmentation';
import type { ContentAttachmentWordRangeEvidence } from './word-evidence';
import type { ContentAttachmentWorkScopeAssessment } from './work-scope';

export type Input = ReturnType<typeof createContentAttachmentGroundedInput>;

export type CandidateRow = [
  string,
  string,
  string,
  string | null,
  string | null,
  Array<[string, string]>,
];
export interface ContentAttachmentRecipientSupport {
  currentWordRanges: string[];
  contextWordRanges: string[];
  candidateEvidenceRefs: string[];
  originRowRefs: string[];
}
export interface ContentAttachmentRecipientAttachment extends ContentAttachmentRecipientSupport {
  candidateRef: string;
}
export interface ContentAttachmentRecipientAlternative extends ContentAttachmentRecipientSupport {
  candidateRefs: string[];
}
export interface ContentAttachmentRecipientDecision extends Partial<ContentAttachmentCollectiveTrace> {
  areaAssessments?: Record<string, ContentAttachmentAreaAssessment>;
  workScopeAssessment?: ContentAttachmentWorkScopeAssessment;
  attachments: ContentAttachmentRecipientAttachment[];
  recipientIdentityAlternatives: ContentAttachmentRecipientAlternative[];
  relationshipSubjectAlternatives: Array<
    ContentAttachmentRecipientAlternative & { role: 'subject' }
  >;
  reason: string;
}
export interface ContentAttachmentRecipientResponse {
  decisions: Record<string, ContentAttachmentRecipientDecision>;
}
export interface ContentAttachmentAreaRecipientDecision extends Omit<
  ContentAttachmentRecipientDecision,
  'attachments' | 'areaAssessments'
> {
  nonAreaAttachments: ContentAttachmentRecipientAttachment[];
  areaAssessments: Record<string, ContentAttachmentGroundedAreaAssessment>;
}
export interface ContentAttachmentAreaRecipientResponse {
  decisions: Record<string, ContentAttachmentAreaRecipientDecision>;
}
export type ContentAttachmentRecipientAttachmentOrigin =
  | { candidateRef: string; field: 'nonAreaAttachments'; index: number }
  | { candidateRef: string; field: 'areaAssessments'; areaRef: string };
export interface ContentAttachmentDerivedRecipientResponse extends ContentAttachmentRecipientResponse {
  attachmentOrigins: Record<
    string,
    ContentAttachmentRecipientAttachmentOrigin[]
  >;
}
export interface CandidateBinding {
  ref: string;
  candidateRef: string;
  evidence: CandidateEvidence;
}
export interface ContentAttachmentRecipientAudit<
  Response = ContentAttachmentRecipientResponse,
> {
  version: RecipientVersion;
  segmentSnapshot: ContentAttachmentIdentifiedSegment[];
  candidateEvidence: CandidateBinding[];
  systemPrompt: string;
  userPrompt: string;
  rawResponse: Response;
  usage: ExtendedTokenUsage;
  callAttempts: LLMCallAttempt[];
}
export interface ContentAttachmentResolvedRecipientSupport {
  candidateRefs: string[];
  currentEvidence: ContentAttachmentWordRangeEvidence[];
  contextEvidence: ContentAttachmentWordRangeEvidence[];
  candidateEvidence: CandidateBinding[];
  originRowRefs: string[];
}
export interface ContentAttachmentRecipientFinding {
  areaAssessments?: Record<string, ContentAttachmentAreaAssessment>;
  workScopeAssessment?: ContentAttachmentWorkScopeAssessment;
  collectiveTrace?: ContentAttachmentCollectiveTrace;
  inventoryContexts?: Record<string, ContentAttachmentInventoryContext>;
  segmentRef: string;
  excerptRef: string;
  attachments: ContentAttachmentResolvedRecipientSupport[];
  recipientIdentityAlternatives: ContentAttachmentResolvedRecipientSupport[];
  relationshipSubjectAlternatives: ContentAttachmentResolvedRecipientSupport[];
}
