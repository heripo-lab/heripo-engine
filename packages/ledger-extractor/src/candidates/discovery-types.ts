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
export function responseSchema(sourceId: z.ZodType<string>) {
  return z.object({
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
    exclusions: z.array(z.object({ sourceId, reason: z.string() })),
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
  scopeTitle: string;
  inputSha256: string;
  units: CandidateDiscoveryUnit[];
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
export interface CandidateDiscoveryAudit {
  unitId: string;
  promptVersion: string;
  systemPrompt: string;
  userPrompt: string;
  response: CandidateDiscoveryResponse;
  usage: ExtendedTokenUsage;
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
  scopeTitle: string;
  candidates: LedgerObjectCandidate[];
  issues: CandidateDiscoveryIssue[];
  exclusions: Array<{
    unitId: string;
    sourceId: string;
    resourceKey: string;
    reason: string;
  }>;
  completedUnitIds: string[];
  totalUnits: number;
  /** Coverage refers to submitted input resources, not proven semantic completeness. */
  inspectedResourceCount: number;
}
