import type { ExtendedTokenUsage, LLMCallAttempt } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { createContentAttachmentGroundedInput } from '../grounding';
import type {
  ContentAttachmentWordEvidenceSnapshot,
  ContentAttachmentWordRangeEvidence,
} from './word-evidence';

import { LLMCaller, createAuditedModel } from '@heripo/shared';
import { z } from 'zod';

import { resolveContentAttachmentSegmentRanges } from './segment-ranges';
import {
  CONTENT_ATTACHMENT_WORD_RANGE_PATTERN,
  contentAttachmentWordRows,
  createContentAttachmentWordEvidence,
} from './word-evidence';

type Input = ReturnType<typeof createContentAttachmentGroundedInput>;
export const CONTENT_ATTACHMENT_SEGMENTATION_VERSION =
  'content-segmentation.v2' as const;
type SegmentationVersion =
  'content-segmentation.v1' | typeof CONTENT_ATTACHMENT_SEGMENTATION_VERSION;

export interface ContentAttachmentSegmentationResponse {
  segments: Record<string, Array<{ wordRanges: string[] }>>;
}
export interface ContentAttachmentSegmentationAudit {
  version: SegmentationVersion;
  excerptRefs: string[];
  wordEvidence: ContentAttachmentWordEvidenceSnapshot;
  systemPrompt: string;
  userPrompt: string;
  rawResponse: ContentAttachmentSegmentationResponse;
  usage: ExtendedTokenUsage;
  callAttempts: LLMCallAttempt[];
}
export interface ContentAttachmentIdentifiedSegment {
  ref: string;
  excerptRef: string;
  evidence: ContentAttachmentWordRangeEvidence[];
}

const V1_SYSTEM_PROMPT =
  'Identify independently meaningful actions and assertions within each CURRENT excerpt. This is source segmentation only. Candidate identities, earlier recipient judgments and expected answers are intentionally absent. Return only original word-ID ranges grouped into segments for every required current E. Different action subjects or a change from a collective observation to an individual relationship claim should be represented separately, even within one unchanged sentence or table cell. Do not let a later local action absorb an earlier independent action. Shared predicates may overlap and a segment may use disjoint ranges. A single segment is appropriate for a single independent claim/action or an indivisible fragment, not as a shortcut for multiple independent subjects or claims.\nUse original whole text, body-block boundaries, table headers/row context and read-only neighboring source text to interpret the boundaries. W numbering restarts within each E and endpoints are inclusive, for example E3:W2-W5. Select only ranges in the SAME current E, never ranges from another excerpt or read-only passage. Every current word must be covered, including introductions, headers and incomplete fragments. Preserve original punctuation, split words/numbers, decimals and incomplete parentheses without repair or normalization. Do not classify or discard titles or administrative material here: retain their ranges for the later recipient judgment.\nDo not return recipients, candidate references, classifications, reasons, new text, normalized quotations or rewritten sentences. Code assigns segment IDs after validating ranges and word coverage. Original E text and saved responses remain unchanged. Valid coverage is not proof of semantically correct segmentation. No candidate judgment or ledger assembly occurs at this stage.';

const SHARED_SCOPE_POLICY =
  'Split only where actions or assertions are clearly independently interpretable in the supplied original context. Punctuation, commas, conjunctions and noun lists alone do not establish an independent action. Keep a subject, object or scope phrase with the predicate/action it qualifies; do not isolate it as an incomplete fragment when its governing action is available in the same current E. Keeping all words is necessary but does not justify orphaning a dependent phrase. When coordinated actions depend on a common subject, object or scope and its distribution is unclear, preserve the connected work as one segment rather than forcing finer splits. If separate actions are clearly supported, retain their necessary shared original words using overlapping or disjoint ranges; never invent an omitted phrase or extend a scope without source support. A genuinely incomplete source fragment remains unchanged. Keep a separately identified local action apart from preceding shared work. Continue to separate a collective observation from an individual relationship assertion when each is independently interpretable; segmentation does not decide recipients or relationship identity. Before returning, check that each proposed split preserves the original dependency between participants, scope and action. Do not force a target segment count.';

/** Project only current source text and bounded unit context, never candidate or prior-answer data. */
export function createContentAttachmentSegmentationRequest(
  input: Input,
  excerptRefs: readonly string[],
  version: SegmentationVersion = CONTENT_ATTACHMENT_SEGMENTATION_VERSION,
) {
  if (
    version !== 'content-segmentation.v1' &&
    version !== CONTENT_ATTACHMENT_SEGMENTATION_VERSION
  )
    throw new Error('Unsupported segmentation version');
  const selected = new Set(excerptRefs);
  const excerpts = input.payload.current.excerpts;
  if (
    !selected.size ||
    selected.size !== excerptRefs.length ||
    excerptRefs.some((ref) => !excerpts.some((e) => e[0] === ref))
  )
    throw new Error('Expected unique existing segmentation excerpt refs');
  const current = excerpts.filter((e) => selected.has(e[0]));
  const visible = new Set(
    input.payload.current.bodyBlocks.flatMap((b) => b[1]),
  );
  for (const ref of selected) visible.add(ref);
  const tables = input.payload.current.tables.flatMap((table) => {
    const rows = table.grid.flatMap((row, index) =>
      row.some((cell) => cell[0] !== null && selected.has(cell[0]))
        ? [index]
        : [],
    );
    if (!rows.length) return [];
    const contextRows = table.grid.flatMap((row, index) => {
      if (!rows.includes(index) && !row.some((cell) => cell[4])) return [];
      for (const cell of row) if (cell[0] !== null) visible.add(cell[0]);
      return [{ index, cells: row }];
    });
    return [{ ref: table.ref, caption: table.caption, rows: contextRows }];
  });
  const wordEvidence = createContentAttachmentWordEvidence(input, visible);
  const contextRefs = new Set<string>();
  for (const row of excerpts.filter((e) => visible.has(e[0])))
    for (const ref of row[2]) contextRefs.add(ref);
  for (const row of input.payload.current.readOnlyContext)
    for (const ref of row[1]) contextRefs.add(ref);
  const refs = current.map((e) => e[0]);
  const payload = {
    contexts: Object.fromEntries(
      Object.entries(input.payload.contexts).filter(([ref]) =>
        contextRefs.has(ref),
      ),
    ),
    current: current.map((e) => {
      const source = wordEvidence.sources.find((s) => s.ref === e[0])!;
      return {
        ref: e[0],
        kind: e[1],
        contexts: e[2],
        tableCell: e[3],
        text: source.text,
        words: contentAttachmentWordRows(source),
      };
    }),
    bodyBlocks: input.payload.current.bodyBlocks,
    tables,
    readOnlyContext: wordEvidence.sources
      .filter((s) => !selected.has(s.ref))
      .map((s) => ({ ref: s.ref, text: s.text })),
    wordColumns: ['ref', 'literalSurfaceUnit'],
  };
  const ranges = z
    .array(z.string().regex(CONTENT_ATTACHMENT_WORD_RANGE_PATTERN))
    .min(1)
    .meta({ id: 'SegmentationRanges' });
  const segment = z
    .strictObject({ wordRanges: ranges })
    .meta({ id: 'SourceSegment' });
  const schema: z.ZodType<ContentAttachmentSegmentationResponse> =
    z.strictObject({
      segments: z.strictObject(
        Object.fromEntries(
          refs.map((ref) => [
            ref,
            z
              .array(segment)
              .min(
                wordEvidence.sources.find((s) => s.ref === ref)!.words.length
                  ? 1
                  : 0,
              ),
          ]),
        ),
      ),
    });
  return {
    version,
    excerptRefs: refs,
    wordEvidence,
    systemPrompt:
      version === 'content-segmentation.v1'
        ? V1_SYSTEM_PROMPT
        : V1_SYSTEM_PROMPT + '\n' + SHARED_SCOPE_POLICY,
    userPrompt: JSON.stringify(payload),
    schema,
  };
}

/** Replay the exact request and resolve model ranges without repairing a source or response. */
export function inspectContentAttachmentSegmentation(
  input: Input,
  audit: ContentAttachmentSegmentationAudit,
): { issues: string[]; segments: ContentAttachmentIdentifiedSegment[] } {
  let request: ReturnType<typeof createContentAttachmentSegmentationRequest>;
  try {
    request = createContentAttachmentSegmentationRequest(
      input,
      audit.excerptRefs,
      audit.version,
    );
  } catch {
    return { issues: ['Invalid segmentation excerpt selection'], segments: [] };
  }
  const parsed = request.schema.safeParse(audit.rawResponse);
  if (
    !parsed.success ||
    audit.version !== request.version ||
    audit.systemPrompt !== request.systemPrompt ||
    audit.userPrompt !== request.userPrompt ||
    JSON.stringify(audit.wordEvidence) !== JSON.stringify(request.wordEvidence)
  )
    return {
      issues: ['Invalid segmentation response, request or source snapshot'],
      segments: [],
    };
  const issues: string[] = [],
    segments: ContentAttachmentIdentifiedSegment[] = [];
  for (const ref of request.excerptRefs) {
    try {
      const resolved = resolveContentAttachmentSegmentRanges(
        request.wordEvidence,
        ref,
        parsed.data.segments[ref],
      );
      segments.push(
        ...resolved.map((evidence, i) => ({
          ref: `${ref}:S${i + 1}`,
          excerptRef: ref,
          evidence,
        })),
      );
    } catch {
      issues.push(`Invalid segmentation ranges or coverage: ${ref}`);
    }
  }
  return { issues, segments };
}

/** Run segmentation only; callers must separately inspect it before any future recipient stage. */
export async function identifyContentAttachmentSegments(
  input: Input,
  excerptRefs: readonly string[],
  options: {
    model: LanguageModel;
    maxRetries: number;
    abortSignal?: AbortSignal;
    onAttempt?: (attempt: LLMCallAttempt) => void | Promise<void>;
  },
): Promise<ContentAttachmentSegmentationAudit> {
  const request = createContentAttachmentSegmentationRequest(
    input,
    excerptRefs,
  );
  const model = createAuditedModel(options.model, options.onAttempt);
  const result = await LLMCaller.call({
    schema: request.schema,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    primaryModel: model.model,
    maxRetries: options.maxRetries,
    abortSignal: options.abortSignal,
    component: 'LedgerContentAttachment',
    phase: 'content-segmentation',
    metadata: {
      version: request.version,
      excerptRefs: request.excerptRefs.join(','),
    },
  });
  return {
    version: request.version,
    excerptRefs: request.excerptRefs,
    wordEvidence: request.wordEvidence,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    rawResponse: result.output,
    usage: result.usage,
    callAttempts: model.attempts,
  };
}
