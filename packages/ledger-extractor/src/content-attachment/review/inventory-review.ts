import type { ExtendedTokenUsage, LLMCallAttempt } from '@heripo/shared';

import type {
  ContentAttachmentGroundedResponse,
  createContentAttachmentGroundedInput,
} from '../grounding';
import type { ContentAttachmentRequiredResponse } from '../response';

import { z } from 'zod';

import {
  inspectContentAttachmentGrounding,
  requiredContentAttachmentInventoryAudits,
} from '../grounding';

type Input = ReturnType<typeof createContentAttachmentGroundedInput>;
type Member =
  ContentAttachmentGroundedResponse['inventoryAudits'][number]['members'][string];
export interface ContentAttachmentInventoryReviewResponse {
  reviews: Record<string, Record<string, Member>>;
}
export interface ContentAttachmentInventoryReviewAudit {
  systemPrompt: string;
  userPrompt: string;
  rawResponse: ContentAttachmentInventoryReviewResponse;
  usage: ExtendedTokenUsage;
  callAttempts: LLMCallAttempt[];
}

/** A second bounded judgment call explains frozen selections; it cannot rewrite them. */
export function createContentAttachmentInventoryReviewRequest(
  input: Input,
  selection: ContentAttachmentRequiredResponse,
) {
  const required = requiredContentAttachmentInventoryAudits(input, selection);
  const candidateRefs = new Set(required.flatMap((r) => r.candidateRefs));
  const inventoryRefs = new Set(required.map((r) => r.inventoryRef));
  const rowRefs = new Set(
    input.payload.originRows
      .filter((r) => inventoryRefs.has(r[1]))
      .map((r) => r[0]),
  );
  const enumOf = (refs: string[]) => z.enum(refs as [string, ...string[]]);
  const schema: z.ZodType<ContentAttachmentInventoryReviewResponse> =
    z.strictObject({
      reviews: z.strictObject(
        Object.fromEntries(
          required.map((r) => [
            r.key,
            z.strictObject(
              Object.fromEntries(
                r.candidateRefs.map((ref) => [
                  ref,
                  r.selected.includes(ref)
                    ? z.strictObject({ state: z.literal('included') })
                    : z.strictObject({
                        state: z.literal('excluded'),
                        contextRef: z.literal(r.excerptRef),
                        candidateEvidenceRefs: z
                          .array(
                            enumOf(
                              input.citations
                                .filter((c) => c.candidateRef === ref)
                                .map((c) => c.ref),
                            ),
                          )
                          .min(1),
                        reason: z.string().min(1),
                      }),
                ]),
              ),
            ),
          ]),
        ),
      ),
    });
  return {
    required,
    schema,
    systemPrompt:
      'Explain the supplied frozen attachment decisions using only original evidence. Return every required review key and every member required by the schema. The code-defined registration pool is a review baseline, not an eligible-recipient set. Included members already occur in assignments or genuine relationship-role alternatives; do not reinterpret inclusion as confirmed physical identity or a confirmed relationship. For each excluded member, select its own supplied K evidence and the current E context, and explain the actual qualifier, missing direct description or other original ground. Apply the current investigation, period, location and type before explaining exclusions, retaining recorded tentative classifications within their supported scope. Candidates outside a current qualifier still require their own exclusion grounds. Read earlier E context to resolve the bounded set. E and K IDs select immutable original text; never reproduce, normalize or invent source quotations. Explain judgments in Korean. You cannot change the frozen decisions, supply new targets or omit required reviews. If the original evidence conflicts with a frozen selection, state that conflict honestly in its explanation rather than inventing support.',
    userPrompt: JSON.stringify({
      columns: input.payload.columns,
      candidateQuoteColumns: input.payload.candidateQuoteColumns,
      contexts: input.payload.contexts,
      candidates: input.payload.candidates.filter((r) =>
        candidateRefs.has(r[0] as string),
      ),
      excerpts: input.payload.current.excerpts.filter((e) => e[1] === 'text'),
      bodyBlocks: input.payload.current.bodyBlocks,
      readOnlyContext: input.payload.current.readOnlyContext,
      originRowColumns: input.payload.originRowColumns,
      originCellColumns: input.payload.originCellColumns,
      originTables: input.payload.originTables.filter((t) =>
        inventoryRefs.has(t.ref),
      ),
      originRows: input.payload.originRows.filter((r) => rowRefs.has(r[0])),
      originAnchorColumns: input.payload.originAnchorColumns,
      originAnchors: input.payload.originAnchors.filter(
        (a) => candidateRefs.has(a[0]) && rowRefs.has(a[1]),
      ),
      requiredReviews: required.map((r) => [
        r.key,
        r.excerptRef,
        r.inventoryRef,
      ]),
      decisions: Object.fromEntries(
        required.map((r) => [r.excerptRef, selection.decisions[r.excerptRef]]),
      ),
    }),
  };
}

/** Replay the review independently; malformed or missing coverage blocks assembly. */
export function inspectContentAttachmentInventoryReview(
  input: Input,
  selection: ContentAttachmentRequiredResponse,
  audit?: ContentAttachmentInventoryReviewAudit,
) {
  const request = createContentAttachmentInventoryReviewRequest(
    input,
    selection,
  );
  if (!audit && !request.required.length) return { issues: [], exclusions: [] };
  const parsed = request.schema.safeParse(audit?.rawResponse);
  if (
    !parsed.success ||
    audit!.systemPrompt !== request.systemPrompt ||
    audit!.userPrompt !== request.userPrompt
  )
    return {
      issues: [
        'Invalid or missing required inventory review response or request',
      ],
      exclusions: [],
    };
  return inspectContentAttachmentGrounding(input, {
    ...selection,
    inventoryAudits: request.required.map((r) => ({
      excerptRef: r.excerptRef,
      inventoryRef: r.inventoryRef,
      members: parsed.data.reviews[r.key],
    })),
    exclusions: [],
  });
}
