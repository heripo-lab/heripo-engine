import type { ExtendedTokenUsage, LLMCallAttempt } from '@heripo/shared';

import type { CandidateDeduplicationResult } from '../candidates/candidate-deduplication';
import type {
  CandidateDiscoveryPlan,
  CandidateEvidence,
  LedgerObjectCandidate,
} from '../candidates/candidate-discovery';
import type { DocumentResource } from '../resources/document-resource-index';
import type { createContentAttachmentBodyBlockInput } from './body-blocks';
import type { createContentAttachmentContextInput } from './context';
import type { ContentRegistrationDecision } from './decisions';
import type { createContentAttachmentDecisionInput } from './decisions';
import type { createContentAttachmentSelectionInput } from './excerpts';
import type {
  ContentAttachmentExclusion,
  ContentAttachmentGroundedResponse,
} from './grounding';
import type { createContentAttachmentInput } from './input';
import type { createContentAttachmentOriginInput } from './origins';
import type { ContentAttachmentRequiredResponse } from './response';
import type {
  ContentAttachmentIndependentReviewAudit,
  ContentAttachmentReviewFinding,
} from './review/independent-review';
import type { ContentAttachmentInventoryReviewAudit } from './review/inventory-review';
import type { createContentAttachmentTableAnchorInput } from './tables/anchors';

import { z } from 'zod';

export type TextSource = Extract<
  DocumentResource,
  { kind: 'text' | 'tableCell' }
>;
export interface AttachmentSource {
  sourceId: string;
  resource: TextSource;
}
export interface AttachmentUnit {
  unitId: string;
  pdfPageNo: number;
  sources: AttachmentSource[];
  chapters: Array<{
    chapterId: string;
    path: CandidateDiscoveryPlan['units'][number]['chapterPath'];
  }>;
  /** Original table grids and captions preserve structural context; only sources are selectable. */
  tables: Array<{
    key: string;
    data: Extract<DocumentResource, { kind: 'table' }>['data'];
  }>;
  readOnlyContext: Array<{ resourceKey: string; text: string }>;
}
export interface AttachmentRegistryEntry {
  ref: string;
  groupId: string;
  recordKind: LedgerObjectCandidate['recordKind'];
  mentions: Array<{
    candidateId: string;
    sourceName: string;
    sourceIdentifier: string | null;
    chapterPath: CandidateDiscoveryPlan['units'][number]['chapterPath'];
    evidence: CandidateEvidence[];
  }>;
}
export interface ContentAttachmentPlan {
  version: 'ledger-content-attachment-plan.v1';
  inputSha256: string;
  candidateSnapshotId: string;
  registrySha256: string;
  registry: AttachmentRegistryEntry[];
  registryUncertainties: CandidateDeduplicationResult['uncertainMatches'];
  registrationDecisions?: ContentRegistrationDecision[];
  pages: Array<{
    pdfPageNo: number;
    unitIds: string[];
    status: 'planned' | 'no_body_or_table_text';
  }>;
  units: AttachmentUnit[];
}
function responseSchema(
  source: z.ZodType<string>,
  candidate: z.ZodType<string>,
) {
  const fragments = z
    .array(z.object({ sourceId: source, quote: z.string().min(1) }))
    .min(1);
  return z.object({
    assignments: z.array(
      z.object({
        candidateRefs: z.array(candidate).min(1),
        fragments,
        reason: z.string().min(1),
      }),
    ),
    unresolved: z.array(
      z.object({
        candidateRefs: z.array(candidate),
        fragments,
        reason: z.string().min(1),
      }),
    ),
    ignoredSources: z.array(
      z.object({ sourceId: source, reason: z.string().min(1) }),
    ),
  });
}
export function ignoredPassageSchema(source: z.ZodType<string>) {
  return z.array(
    z.object({
      fragments: z
        .array(z.object({ sourceId: source, quote: z.string().min(1) }))
        .min(1),
      reason: z.string().min(1),
    }),
  );
}
export const savedSchema = responseSchema(z.string(), z.string()).extend({
  ignoredPassages: ignoredPassageSchema(z.string()).optional(),
});
export type ContentAttachmentResponse = z.infer<typeof savedSchema>;
function selectionSchema(
  excerpt: z.ZodType<string>,
  candidate: z.ZodType<string>,
) {
  const item = { excerptRef: excerpt, reason: z.string().min(1) };
  return z.strictObject({
    assignments: z.array(
      z.strictObject({ ...item, candidateRefs: z.array(candidate).min(1) }),
    ),
    unresolved: z.array(
      z.strictObject({ ...item, candidateRefs: z.array(candidate) }),
    ),
    ignored: z.array(z.strictObject(item)),
  });
}
export const savedSelectionSchema = selectionSchema(z.string(), z.string());
export type ContentAttachmentSelectionResponse = z.infer<
  typeof savedSelectionSchema
>;
export type ContentAttachmentSelectionAudit =
  ContentAttachmentAudit<ContentAttachmentSelectionResponse>;
export interface ContentAttachmentAudit<Response = ContentAttachmentResponse> {
  unitId: string;
  promptVersion: string;
  systemPrompt: string;
  userPrompt: string;
  response: Response;
  /** Exact model output from v42 onward; response is its lossless legacy-format projection. */
  rawResponse?:
    ContentAttachmentRequiredResponse | ContentAttachmentGroundedResponse;
  usage: ExtendedTokenUsage;
  /** Separate immutable review response; selection output remains unmodified. */
  inventoryReview?: ContentAttachmentInventoryReviewAudit;
  /** Independent proposal; never overwrites the initial decision or its evidence. */
  independentReview?: ContentAttachmentIndependentReviewAudit;
  /** Per-call selection usage when usage totals both bounded calls. */
  selectionUsage?: ExtendedTokenUsage;
  /** Optional for historical audits; new calls retain every provider attempt. */
  callAttempts?: LLMCallAttempt[];
  /** Code-only binding; never forwarded to the model. Legacy v1 audits omit it. */
  codeMap?:
    | ReturnType<typeof createContentAttachmentInput>['codeMap']
    | ReturnType<typeof createContentAttachmentSelectionInput>['codeMap']
    | ReturnType<typeof createContentAttachmentDecisionInput>['codeMap']
    | ReturnType<typeof createContentAttachmentTableAnchorInput>['codeMap']
    | ReturnType<typeof createContentAttachmentContextInput>['codeMap']
    | ReturnType<typeof createContentAttachmentBodyBlockInput>['codeMap']
    | ReturnType<typeof createContentAttachmentOriginInput>['codeMap'];
}
export interface AttachedExcerpt {
  kind: 'body' | 'table_item';
  /** Each original block/cell fragment stays separate, including split words. */
  fragments: string[];
  occurrences: Array<{ evidence: CandidateEvidence[] }>;
  reasons: string[];
}
export interface ContentAttachmentResult {
  version: 'ledger-content-attachments.v1';
  reviewStatus: 'not_reviewed';
  completedUnitIds: string[];
  totalUnits: number;
  contents: Array<{
    registryRef: string;
    groupId: string;
    excerpts: AttachedExcerpt[];
  }>;
  unresolved: Array<{
    unitId: string;
    candidateRefs: string[];
    evidence: CandidateEvidence[];
    reason: string;
  }>;
  exclusionEvidence?: Array<ContentAttachmentExclusion & { unitId: string }>;
  independentReviewFindings?: Array<
    ContentAttachmentReviewFinding & { unitId: string }
  >;
  reviewDisagreements?: Array<
    ContentAttachmentReviewFinding & { unitId: string }
  >;
  ignoredSources: Array<{ unitId: string; sourceId: string; reason: string }>;
  ignoredPassages: Array<{
    unitId: string;
    evidence: CandidateEvidence[];
    reason: string;
  }>;
  issues: Array<{ unitId: string; reason: string }>;
}
