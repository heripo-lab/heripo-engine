import type { ExtendedTokenUsage, LLMCallAttempt } from '@heripo/shared';

import type { CandidateEvidence } from '../../candidates/candidate-discovery';
import type { createContentAttachmentGroundedInput } from '../grounding';
import type {
  ContentAttachmentWordEvidenceSnapshot,
  ContentAttachmentWordRangeEvidence,
} from '../recipients/word-evidence';
import type { ReviewReferentMatch } from './review-retrieval';
import type {
  ContentAttachmentReviewSegment,
  ContentAttachmentSegmentDecision,
  ContentAttachmentSegmentFinding,
} from './segment-review';

import { z } from 'zod';

export type Input = ReturnType<typeof createContentAttachmentGroundedInput>;
export const attachment = z
  .enum(['included', 'excluded', 'unresolved'])
  .meta({ id: 'IndependentAttachment' });
export const relationshipSubject = z
  .enum(['alternative', 'not_alternative'])
  .meta({ id: 'IndependentSubject' });
export interface ContentAttachmentIndependentMember {
  segmentDecisions?: ContentAttachmentSegmentDecision[];
  wordRanges?: string[];
  attachment: z.infer<typeof attachment>;
  relationshipSubject: z.infer<typeof relationshipSubject>;
  contextRef: string;
  candidateEvidenceRefs: string[];
  reason: string;
}
export interface ContentAttachmentIndependentReviewResponse {
  segments?: Record<string, ContentAttachmentReviewSegment[]>;
  reviews: Record<string, Record<string, ContentAttachmentIndependentMember>>;
}
export interface ContentAttachmentReviewCoverage {
  version: 'source-grounded.v1';
  referentMatches: ReviewReferentMatch[];
}
export interface ContentAttachmentIndependentReviewAudit {
  segmentReview?: { version: 'segment-review.v1' };
  wordEvidence?: ContentAttachmentWordEvidenceSnapshot;
  coverage?: ContentAttachmentReviewCoverage;
  systemPrompt: string;
  userPrompt: string;
  rawResponse: ContentAttachmentIndependentReviewResponse;
  usage: ExtendedTokenUsage;
  callAttempts: LLMCallAttempt[];
}
export interface ContentAttachmentReviewFinding {
  segmentEvidence?: ContentAttachmentSegmentFinding[];
  wordEvidence?: ContentAttachmentWordRangeEvidence[];
  excerptRef: string;
  inventoryRef: string;
  candidateRef: string;
  original: { assigned: boolean; unresolved: boolean };
  review: ContentAttachmentIndependentMember;
  contextEvidence: CandidateEvidence[];
  candidateEvidence: CandidateEvidence[];
  changedFields: Array<'attachment' | 'unresolved'>;
  reviewBasis?: 'inventory' | 'body_context';
}
