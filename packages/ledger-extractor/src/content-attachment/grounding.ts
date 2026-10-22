import type { CandidateEvidence } from '../candidates/discovery-types';
import type { ContentAttachmentRequiredResponse } from './response';
import type { AttachmentUnit, ContentAttachmentPlan } from './types';

import { z } from 'zod';

import { createContentAttachmentOriginInput } from './origins';
import { contentAttachmentDecisionSchema } from './response';

/** Label existing quotes without copying another text inventory into the model input. */
export function createContentAttachmentGroundedInput(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
) {
  const base = createContentAttachmentOriginInput(plan, unit);
  const bodyKeys = new Set(
    plan.units.flatMap((u) =>
      u.sources
        .filter((s) => s.resource.kind === 'text')
        .map((s) => s.resource.key),
    ),
  );
  const citations = base.codeMap.candidateRows.flatMap((row, rowIndex) =>
    row.evidence.map((evidence, quoteIndex) => ({
      ref: `K${rowIndex + 1}.${quoteIndex + 1}`,
      candidateRef: row.ref,
      rowIndex,
      quoteIndex,
      evidence,
    })),
  );
  const inventories = base.payload.originTables.map((table) => ({
    ref: table.ref,
    candidateRefs: plan.registry
      .map((c) => c.ref)
      .filter((ref) =>
        base.payload.originAnchors.some(
          (a) =>
            a[0] === ref &&
            base.payload.originRows.some(
              (row) => row[0] === a[1] && row[1] === table.ref,
            ),
        ),
      ),
  }));
  return {
    payload: {
      ...base.payload,
      candidateQuoteColumns: ['ref', 'text'],
      candidates: base.payload.candidates.map((row, rowIndex) => [
        ...row.slice(0, 5),
        row[5].map((text, quoteIndex) => [
          `K${rowIndex + 1}.${quoteIndex + 1}`,
          text,
        ]),
      ]),
      inventoryMembers: inventories.map((i) => [i.ref, i.candidateRefs]),
    },
    codeMap: base.codeMap,
    citations,
    inventories,
    bodyCandidateContexts: base.codeMap.candidateRows.flatMap(
      (row, rowIndex) =>
        row.evidence.some((e) => bodyKeys.has(e.resourceKey))
          ? [
              [row.ref, base.payload.candidates[rowIndex][2]] as [
                string,
                string,
              ],
            ]
          : [],
    ),
  };
}

type Input = ReturnType<typeof createContentAttachmentGroundedInput>;

/** Derive review coverage from frozen selections and original row bindings, not lexical guesses. */
export function requiredContentAttachmentInventoryAudits(
  input: Input,
  response: ContentAttachmentRequiredResponse,
) {
  return input.codeMap.excerpts.flatMap((e) => {
    const source = input.codeMap.sources.find(
      (s) => s.source.sourceId === e.evidence[0].sourceId,
    )!;
    if (source.source.resource.kind !== 'text') return [];
    const decision = response.decisions[e.ref];
    const targets =
      decision.status === 'assigned'
        ? [
            ...decision.candidateRefs,
            ...(decision.unresolved?.candidateRefs ?? []),
          ]
        : decision.status === 'unresolved'
          ? decision.candidateRefs
          : [];
    return input.inventories.flatMap((inventory) => {
      const selected = inventory.candidateRefs.filter((ref) =>
        targets.includes(ref),
      );
      const rows = new Set(
        input.codeMap.originAnchors
          .filter(
            (a) =>
              selected.includes(a.candidateRef) &&
              input.codeMap.originRows.some(
                (r) => r.ref === a.rowRef && r.tableRef === inventory.ref,
              ),
          )
          .map((a) => a.rowRef),
      );
      return selected.length > 1 && rows.size > 1
        ? [
            {
              key: `${e.ref}:${inventory.ref}`,
              excerptRef: e.ref,
              inventoryRef: inventory.ref,
              candidateRefs: inventory.candidateRefs,
              selected,
            },
          ]
        : [];
    });
  });
}
const enumOf = (refs: string[]) => z.enum(refs as [string, ...string[]]);
const explanation = z.string().min(1);
const included = z
  .strictObject({ state: z.literal('included') })
  .meta({ id: 'GroundingIncluded' });

/** A selected original table requires an explicit disposition for every registered member. */
export function createContentAttachmentGroundedSchema(
  input: Input,
): z.ZodType<ContentAttachmentGroundedResponse> {
  const excerpt = enumOf(input.codeMap.excerpts.map((e) => e.ref)).meta({
    id: 'GroundingExcerpt',
  });
  const candidate = enumOf([
    ...new Set(input.codeMap.candidateRows.map((c) => c.ref)),
  ]).meta({ id: 'ContentAttachmentCandidate' });
  const decision = contentAttachmentDecisionSchema(candidate).meta({
    id: 'ContentAttachmentDecision',
  });
  const quote = enumOf(input.citations.map((c) => c.ref)).meta({
    id: 'GroundingQuote',
  });
  const review = z
    .union([
      included,
      z
        .strictObject({
          state: z.literal('excluded'),
          contextRef: excerpt,
          candidateEvidenceRefs: z.array(quote).min(1),
          reason: explanation,
        })
        .meta({ id: 'GroundingExcluded' }),
    ])
    .meta({ id: 'GroundingMember' });
  const tables = input.inventories.map((i) =>
    z.strictObject({
      excerptRef: excerpt,
      inventoryRef: z.literal(i.ref),
      members: z.strictObject(
        Object.fromEntries(i.candidateRefs.map((ref) => [ref, review])),
      ),
    }),
  );
  const audit = tables.length
    ? z.union(tables as [(typeof tables)[number], ...typeof tables])
    : z.strictObject({
        excerptRef: excerpt,
        inventoryRef: z.literal('none'),
        members: z.strictObject({}),
      });
  return z.strictObject({
    decisions: z.strictObject(
      Object.fromEntries(input.codeMap.excerpts.map((e) => [e.ref, decision])),
    ),
    inventoryAudits: tables.length ? z.array(audit) : z.array(audit).max(0),
    exclusions: z.array(
      z.strictObject({
        excerptRef: excerpt,
        candidateRef: candidate,
        contextRef: excerpt,
        candidateEvidenceRefs: z.array(quote).min(1),
        reason: explanation,
      }),
    ),
  });
}

export type ContentAttachmentGroundedResponse =
  ContentAttachmentRequiredResponse & {
    inventoryAudits: Array<{
      excerptRef: string;
      inventoryRef: string;
      members: Record<
        string,
        | { state: 'included' }
        | {
            state: 'excluded';
            contextRef: string;
            candidateEvidenceRefs: string[];
            reason: string;
          }
      >;
    }>;
    exclusions: Array<{
      excerptRef: string;
      candidateRef: string;
      contextRef: string;
      candidateEvidenceRefs: string[];
      reason: string;
    }>;
  };
export interface ContentAttachmentExclusion {
  excerptRef: string;
  inventoryRef: string | null;
  candidateRef: string;
  contextRef: string;
  contextEvidence: CandidateEvidence[];
  candidateEvidenceRefs: string[];
  candidateEvidence: CandidateEvidence[];
  reason: string;
}

/** Validate provenance and coverage, never invent a member or replace the model's choices. */
export function inspectContentAttachmentGrounding(
  input: Input,
  response: ContentAttachmentGroundedResponse,
) {
  const issues: string[] = [],
    exclusions: ContentAttachmentExclusion[] = [],
    seen = new Set<string>();
  const targets = (excerptRef: string) => {
    const decision = response.decisions[excerptRef];
    return decision.status === 'assigned'
      ? [
          ...decision.candidateRefs,
          ...(decision.unresolved?.candidateRefs ?? []),
        ]
      : decision.status === 'unresolved'
        ? decision.candidateRefs
        : [];
  };
  const add = (
    excerptRef: string,
    candidateRef: string,
    contextRef: string,
    refs: string[],
    reason: string,
    inventoryRef: string | null,
  ) => {
    const key = `${excerptRef}:${candidateRef}`;
    const provenanceKey = `${key}:${inventoryRef ?? 'extra'}`;
    const context = input.codeMap.excerpts.find((e) => e.ref === contextRef)!;
    const quotes = refs.map((ref) =>
      input.citations.find((c) => c.ref === ref)!,
    );
    if (
      seen.has(provenanceKey) ||
      (inventoryRef === null &&
        exclusions.some(
          (e) => e.excerptRef === excerptRef && e.candidateRef === candidateRef,
        )) ||
      contextRef !== excerptRef ||
      targets(excerptRef).includes(candidateRef) ||
      new Set(refs).size !== refs.length ||
      quotes.some((q) => q.candidateRef !== candidateRef)
    ) {
      issues.push(`Invalid or repeated exclusion provenance: ${key}`);
      return;
    }
    seen.add(provenanceKey);
    exclusions.push({
      excerptRef,
      inventoryRef,
      candidateRef,
      contextRef,
      contextEvidence: context.evidence,
      candidateEvidenceRefs: refs,
      candidateEvidence: quotes.map((q) => q.evidence),
      reason,
    });
  };
  const audited = new Set<string>();
  for (const audit of response.inventoryAudits) {
    const key = `${audit.excerptRef}:${audit.inventoryRef}`;
    if (audited.has(key)) issues.push(`Repeated inventory audit: ${key}`);
    audited.add(key);
    for (const [ref, member] of Object.entries(audit.members)) {
      if (member.state === 'included') {
        if (!targets(audit.excerptRef).includes(ref))
          issues.push(
            `Inventory member has no target selection: ${audit.excerptRef}:${ref}`,
          );
      } else
        add(
          audit.excerptRef,
          ref,
          member.contextRef,
          member.candidateEvidenceRefs,
          member.reason,
          audit.inventoryRef,
        );
    }
  }
  for (const exclusion of response.exclusions)
    add(
      exclusion.excerptRef,
      exclusion.candidateRef,
      exclusion.contextRef,
      exclusion.candidateEvidenceRefs,
      exclusion.reason,
      null,
    );
  for (const review of requiredContentAttachmentInventoryAudits(
    input,
    response,
  ))
    if (!audited.has(review.key))
      issues.push(`Missing original inventory audit: ${review.key}`);
  return { issues, exclusions };
}
