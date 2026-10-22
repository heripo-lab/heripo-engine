import type { createContentAttachmentGroundedInput } from '../grounding';
import type { ContentAttachmentInventoryReview } from './inventory-reviews';
import type {
  ContentAttachmentIdentifiedSegment,
  ContentAttachmentSegmentationAudit,
} from './segmentation';
import type { ContentAttachmentWordEvidenceSnapshot } from './word-evidence';

import { z } from 'zod';

import { inspectContentAttachmentInventoryReviews } from './inventory-reviews';
import {
  CONTENT_ATTACHMENT_WORD_RANGE_PATTERN,
  resolveContentAttachmentWordRange,
} from './word-evidence';

type Input = ReturnType<typeof createContentAttachmentGroundedInput>;
type Compatibility =
  'compatible' | 'incompatible' | 'unresolved' | 'not_constrained';
export interface ContentAttachmentCollectiveMember {
  candidateEvidenceRefs: string[];
  originRowRefs: string[];
  periodStatus: Compatibility;
  typeStatus: Compatibility;
  tentativeClassification: 'preserved' | 'not_present';
  membership: 'linked' | 'unresolved' | 'not_linked';
  disposition: 'included' | 'excluded' | 'unresolved';
  reason: string;
}
export interface ContentAttachmentCollectiveTrace {
  inventoryReviews?: Record<string, ContentAttachmentInventoryReview>;
  collectiveAssessment: {
    state: 'collective' | 'not_collective' | 'uncertain';
    currentWordRanges: string[];
    contextWordRanges: string[];
    reason: string;
  };
  qualifierAssessment: {
    periodWordRanges: string[];
    typeWordRanges: string[];
    scopeWordRanges: string[];
    reason: string;
  };
  inventoryMembershipLinks: Array<{
    inventoryRef: string;
    contextWordRanges: string[];
    members: Record<string, ContentAttachmentCollectiveMember>;
    reason: string;
  }>;
}

export const CONTENT_ATTACHMENT_COLLECTIVE_TRACE_POLICY =
  'EXPLICIT COLLECTIVE TRACE: In this SAME response, before final recipients, return collectiveAssessment, qualifierAssessment and inventoryMembershipLinks for EVERY segment. These judgments must not be inferred from a fixed final answer. First determine whether the CURRENT segment describes an original bounded set, using the whole E and supplied investigation/body continuity. Select current evidence and context ranges for that link. Second select the actual current period/type/scope restrictions as source IDs; keep empty ranges where a restriction is absent. Third choose relevant original inventory tables and judge EVERY registered member of each chosen table, including row-owner units and incompatible period/type members. The schema lists each original member, not expected recipients. For every member cite its own K grounds and original rows in that table, and explicitly record period/type compatibility, tentative-label preservation, current-set membership, disposition and a short source-grounded reason. Do not omit exclusions.\nA source-established collective can link through an original inventory even when current individual numbers do not repeat. Do not require a collective observation to identify an individual relationship subject. Inventory membership alone does not override CURRENT period/type/scope restrictions or justify propagating to containing units. A broad compatible era label does not itself prove a more precise individual date; use the source-linked collective without modifying the candidate chronology. Tentative classification alone is not a membership exclusion. Shared layout tasks and individual relationship claims are not inventory collectives merely because other passages describe a set. For a non-collective return state not_collective and an empty inventoryMembershipLinks list, while still judging its directly described recipients and genuine relationship alternatives. For an uncertain set show the actual source gap. Body-only collectives may have no selected inventory; explain that choice instead of inventing a table.\nKeep area own-result or other directly supported recipients outside a selected feature inventory on their independent original grounds. Included inventory members must remain final attachments; unresolved members must remain recipient-identity alternatives; excluded members must not be attached by that collective. When inventories overlap, an included disposition takes precedence, then unresolved, then excluded. A final list contradicting the intermediate judgments is invalid; code reports it and never supplies or removes recipients. Relationship-subject alternatives remain independent of collective attachments and recipient uncertainty. Do not group separate unknown referents together or split alternatives of one unknown referent into independent groups without source support. Do not add a model call, rewrite a quote or return an expected sample-specific answer.';

export const CONTENT_ATTACHMENT_CURRENT_PERIOD_MEMBER_POLICY =
  "Carry each selected current period restriction through member-level judgments for every type it governs. Compare the current period word IDs with each candidate's own K grounds; matching the type or belonging to the inventory does not remove that restriction.\n\nDistinguish uncertain individual precise dating from explicitly incompatible dating. When original continuity and inventory grounds establish membership, a broader compatible period may leave the individual's precise date unresolved without preventing collective source attachment. Use unresolved with linked membership and included disposition when no other exclusion applies; do not infer or rewrite the individual date. When the candidate's own grounds explicitly identify an incompatible period, return incompatible and excluded even if membership is linked and the type matches.\n\nExplain the comparison using the current period word IDs and that candidate's K refs in the existing reason. Preserve independent area judgments and other existing exclusions.";

/** Require complete original membership for each model-selected inventory, without preselecting a table. */
export function createContentAttachmentCollectiveTraceSchema(input: Input) {
  const ranges = z
    .array(z.string().regex(CONTENT_ATTACHMENT_WORD_RANGE_PATTERN))
    .meta({ id: 'CollectiveTraceRanges' });
  const compatibility = z
    .enum(['compatible', 'incompatible', 'unresolved', 'not_constrained'])
    .meta({ id: 'CollectiveCompatibility' });
  const member = z
    .strictObject({
      candidateEvidenceRefs: z.array(z.string()).min(1),
      originRowRefs: z.array(z.string()).min(1),
      periodStatus: compatibility,
      typeStatus: compatibility,
      tentativeClassification: z.enum(['preserved', 'not_present']),
      membership: z.enum(['linked', 'unresolved', 'not_linked']),
      disposition: z.enum(['included', 'excluded', 'unresolved']),
      reason: z.string().min(1),
    })
    .meta({ id: 'CollectiveMember' });
  const inventoriesInput = input.payload.inventoryMembers as Array<
    [string, string[]]
  >;
  const variants = inventoriesInput.map(([inventoryRef, refs]) =>
    z.strictObject({
      inventoryRef: z.literal(inventoryRef),
      contextWordRanges: ranges,
      members: z.strictObject(
        Object.fromEntries(refs.map((ref) => [ref, member])),
      ),
      reason: z.string().min(1),
    }),
  );
  const inventory = variants.length
    ? z.union([variants[0], ...variants.slice(1)])
    : z.strictObject({
        inventoryRef: z.string(),
        contextWordRanges: ranges,
        members: z.strictObject({}),
        reason: z.string().min(1),
      });
  const inventories = variants.length
    ? z.array(inventory)
    : z.array(inventory).max(0);
  return {
    collectiveAssessment: z
      .strictObject({
        state: z.enum(['collective', 'not_collective', 'uncertain']),
        currentWordRanges: ranges,
        contextWordRanges: ranges,
        reason: z.string().min(1),
      })
      .meta({ id: 'CollectiveAssessment' }),
    qualifierAssessment: z
      .strictObject({
        periodWordRanges: ranges,
        typeWordRanges: ranges,
        scopeWordRanges: ranges,
        reason: z.string().min(1),
      })
      .meta({ id: 'CollectiveQualifiers' }),
    inventoryMembershipLinks: inventories.meta({ id: 'CollectiveInventories' }),
  };
}

/** Check the model's own trace against provenance and its final lists without choosing semantic answers. */
export function inspectContentAttachmentCollectiveTrace(
  input: Input,
  segmentation: ContentAttachmentSegmentationAudit,
  segment: ContentAttachmentIdentifiedSegment,
  trace: ContentAttachmentCollectiveTrace,
  grounds: Array<{ ref: string; candidateRef: string }>,
  final: {
    attachments: Array<{ candidateRef: string }>;
    recipientIdentityAlternatives: Array<{ candidateRefs: string[] }>;
  },
  wordEvidence: ContentAttachmentWordEvidenceSnapshot = segmentation.wordEvidence,
) {
  const {
    collectiveAssessment: collective,
    qualifierAssessment: qualifiers,
    inventoryMembershipLinks: inventories,
  } = trace;
  const resolve = (ranges: string[], direct = false) => {
    if (new Set(ranges).size !== ranges.length)
      throw new Error('Duplicate collective evidence');
    for (const range of ranges) {
      const evidence = resolveContentAttachmentWordRange(
        wordEvidence,
        range,
        segment.excerptRef,
      );
      if (
        direct &&
        (evidence.basis !== 'direct' ||
          !segment.evidence.some(
            (s) =>
              evidence.charStart >= s.charStart &&
              evidence.charEnd <= s.charEnd,
          ))
      )
        throw new Error('Collective evidence outside current segment');
    }
  };
  if (
    collective.state !== 'not_collective' &&
    !collective.currentWordRanges.length
  )
    throw new Error('Collective lacks current evidence');
  if (collective.state === 'not_collective' && inventories.length)
    throw new Error('Non-collective has inventory judgments');
  resolve(collective.currentWordRanges, true);
  resolve(collective.contextWordRanges);
  for (const ranges of [
    qualifiers.periodWordRanges,
    qualifiers.typeWordRanges,
    qualifiers.scopeWordRanges,
  ])
    resolve(ranges);
  if (trace.inventoryReviews)
    inspectContentAttachmentInventoryReviews(
      input,
      trace.inventoryReviews,
      collective.state,
      inventories.map((i) => i.inventoryRef),
      grounds,
      resolve,
    );
  const seen = new Set<string>();
  const votes = new Map<string, string[]>();
  for (const selection of inventories) {
    if (seen.has(selection.inventoryRef))
      throw new Error('Duplicate collective inventory');
    seen.add(selection.inventoryRef);
    resolve(selection.contextWordRanges);
    for (const [ref, member] of Object.entries(selection.members)) {
      if (
        new Set(member.candidateEvidenceRefs).size !==
          member.candidateEvidenceRefs.length ||
        new Set(member.originRowRefs).size !== member.originRowRefs.length
      )
        throw new Error('Duplicate collective member support');
      if (
        member.candidateEvidenceRefs.some(
          (k) => !grounds.some((g) => g.ref === k && g.candidateRef === ref),
        )
      )
        throw new Error('Foreign collective member grounds');
      if (
        member.originRowRefs.some(
          (row) =>
            !input.payload.originRows.some(
              (r) => r[0] === row && r[1] === selection.inventoryRef,
            ) ||
            !input.payload.originAnchors.some(
              (a) => a[0] === ref && a[1] === row,
            ),
        )
      )
        throw new Error('Foreign collective member row');
      if (
        member.disposition === 'included' &&
        (member.periodStatus === 'incompatible' ||
          member.typeStatus === 'incompatible' ||
          member.membership !== 'linked')
      )
        throw new Error('Contradictory collective qualifiers');
      votes.set(ref, [...(votes.get(ref) ?? []), member.disposition]);
    }
  }
  for (const [ref, dispositions] of votes) {
    const disposition = dispositions.includes('included')
      ? 'included'
      : dispositions.includes('unresolved')
        ? 'unresolved'
        : 'excluded';
    const attached = final.attachments.some((a) => a.candidateRef === ref);
    const uncertain = final.recipientIdentityAlternatives.some((a) =>
      a.candidateRefs.includes(ref),
    );
    if (
      attached !== (disposition === 'included') ||
      uncertain !== (disposition === 'unresolved')
    )
      throw new Error('Collective trace and final recipients disagree');
  }
}
