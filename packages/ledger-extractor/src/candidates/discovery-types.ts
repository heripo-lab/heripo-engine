import type { ProcessedTableCell } from '@heripo/model';
import type { ExtendedTokenUsage } from '@heripo/shared';

import type { DocumentResource } from '../resources/document-resource-index';

import { z } from 'zod';

export const kindSchema = z.enum([
  'site',
  'area',
  'trench',
  'layer',
  'feature',
  'artifact',
  'shipwreck',
  'unknown',
]);
export const basisSchema = z.enum([
  'independent_body',
  'table_item',
  'explicit_context_unit',
]);
/** Why a selectable source holds no candidate; there is deliberately no category for an object of this investigation. */
export const exclusionCategorySchema = z.enum([
  'previous_or_external',
  'passing_mention',
  'summary_row',
  'header_row',
  'non_item_table',
]);
/** Whether a table unit lists individual objects; a body unit is none. */
export const tableRoleSchema = z.enum(['item_table', 'non_item_table', 'none']);
/** Fields added in prompt v9 are optional here so earlier saved responses still parse. */
export function responseSchema(sourceId: z.ZodType<string>) {
  return z.object({
    tableRole: tableRoleSchema.optional(),
    candidates: z.array(
      z.object({
        recordKind: kindSchema,
        sourceName: z
          .string()
          .min(1)
          .describe(
            'Unnumbered object name copied verbatim from one supplied source/title/context. Keep the object identifier and section ordinal out of this field; never concatenate a type and number.',
          ),
        sourceIdentifier: z
          .string()
          .min(1)
          .nullable()
          .describe(
            'Exact object identifier copied from original evidence, separately from sourceName. Do not add missing suffixes or use a section ordinal.',
          ),
        identifierSourceId: sourceId.nullable().optional(),
        nameSourceId: sourceId.nullable().optional(),
        eligibilityBasis: basisSchema,
        reason: z.string().min(1),
        evidence: z
          .array(
            z.object({
              sourceId,
              quote: z
                .string()
                .min(1)
                .describe(
                  'An exact substring of the text belonging to this selected sourceId, never a neighboring source.',
                ),
            }),
          )
          .min(1),
      }),
    ),
    exclusions: z.array(
      z.object({
        sourceId,
        category: exclusionCategorySchema.optional(),
        reason: z.string(),
      }),
    ),
  });
}
export const candidateDiscoveryResponseSchema = responseSchema(z.string());
export type CandidateDiscoveryResponse = z.infer<
  typeof candidateDiscoveryResponseSchema
>;

export type InputResource = Extract<
  DocumentResource,
  { kind: 'text' | 'tableCell' }
>;
export interface CandidateDiscoveryUnit {
  unitId: string;
  chapterId: string;
  chapterPath: Array<{ id: string; originTitle: string }>;
  table: {
    id: string;
    caption: string | null;
    headerRows: string[][] | ProcessedTableCell[][];
  } | null;
  resources: InputResource[];
  /** Read-only adjacent context cannot anchor candidates in this unit. */
  context: Array<{ key: string; text: string }>;
}
export interface CandidateDiscoveryPlan {
  scopeChapterId: string;
  /** Every scope chapter in document order, present only when the scope has more than one chapter. */
  scopeChapterIds?: string[];
  scopeTitle: string;
  inputSha256: string;
  units: CandidateDiscoveryUnit[];
  /** Where the scope came from; present only when a confirmed report profile supplied it. */
  scopeSource?: { kind: 'profile'; profileSha256: string };
}
export interface CandidateEvidence {
  sourceId: string;
  resourceKey: string;
  resourceId: string | null;
  sourceRefs: string[];
  pdfPageNo: number | null;
  logicalPageRange: DocumentResource['logicalPageRange'];
  quote: string;
  charStart: number;
  charEnd: number;
}
export interface LedgerObjectCandidate {
  candidateId: string;
  status: 'proposed';
  recordKind: z.infer<typeof kindSchema>;
  sourceName: string;
  sourceIdentifier: string | null;
  eligibilityBasis: z.infer<typeof basisSchema>;
  reason: string;
  chapterId: string;
  unitIds: string[];
  evidence: CandidateEvidence[];
}
/** An invalid candidate of a first response sent back for correction (prompt v10 on). */
export interface CandidateDiscoveryCorrection {
  candidateIndex: number;
  issue: string;
  fix: string;
}
/** An exclusion of a section heading sent back for reconsideration (prompt v11 on). */
export interface CandidateDiscoveryReconsideration {
  exclusionIndex: number;
  issue: string;
  fix: string;
}
/** A side-by-side table's repeated column groups, found from the first header row (prompt v11 on). */
export interface CandidateDiscoveryColumnBlocks {
  count: number;
  columnsPerBlock: number;
}
/** One column block of one data row of a side-by-side table. */
export interface CandidateDiscoveryRowBlock {
  rowIndex: number;
  block: number;
}
/** A body block that opens with an object number of a proposed identifier's form but that no answer cites (v13 on). */
export interface CandidateDiscoveryNumberedBlock {
  sourceId: string;
  /** The leading number as it appears in the block, without whitespace. */
  number: string;
}
/**
 * A second call asking the item-table rows the first response left unanswered (prompt v9 on), from v10 correcting
 * its invalid candidates, from v11 reconsidering its excluded headings and asking side-by-side tables by block, and
 * from v13 asking numbered body blocks.
 */
export interface CandidateDiscoveryFollowUp {
  rowIndexes: number[];
  /** Present when a side-by-side table left row blocks unanswered (prompt v11 on). */
  rowBlocks?: CandidateDiscoveryRowBlock[];
  /** Present when the follow-up corrects candidates; their corrected versions replace them. */
  corrections?: CandidateDiscoveryCorrection[];
  /** Present when excluded headings are reconsidered; the follow-up's answer replaces those exclusions. */
  reconsiderations?: CandidateDiscoveryReconsideration[];
  /** Present when numbered body blocks are asked (prompt v13 on). */
  numberedBlocks?: CandidateDiscoveryNumberedBlock[];
  userPrompt: string;
  response: CandidateDiscoveryResponse;
  usage: ExtendedTokenUsage;
  finishReason?: string;
  structuredAttempts?: number;
}
export interface CandidateDiscoveryAudit {
  unitId: string;
  promptVersion: string;
  systemPrompt: string;
  userPrompt: string;
  response: CandidateDiscoveryResponse;
  /** Includes reasoningTokens when the provider reports thinking tokens; covers the follow-up call too. */
  usage: ExtendedTokenUsage;
  /** How the producing call ended, when the SDK reports it (absent in older audits). */
  finishReason?: string;
  /**
   * Structured-output attempts including schema-mismatch retries, summed with the follow-up's; usage counts only
   * the last attempt of each call.
   */
  structuredAttempts?: number;
  followUp?: CandidateDiscoveryFollowUp;
}
export interface CandidateDiscoveryIssue {
  unitId: string;
  candidateIndex: number | null;
  reason: string;
}
export interface CandidateDiscoveryResult {
  version: 'ledger-object-candidates.v1';
  inputSha256: string;
  scopeChapterId: string;
  /** Every scope chapter in document order, present only when the scope has more than one chapter. */
  scopeChapterIds?: string[];
  scopeTitle: string;
  candidates: LedgerObjectCandidate[];
  issues: CandidateDiscoveryIssue[];
  exclusions: Array<{
    unitId: string;
    sourceId: string;
    resourceKey: string;
    /** Present for responses from prompt v9 on. */
    category?: z.infer<typeof exclusionCategorySchema>;
    reason: string;
  }>;
  completedUnitIds: string[];
  totalUnits: number;
  /** Coverage refers to submitted input resources, not proven semantic completeness. */
  inspectedResourceCount: number;
}
