import type { AttachmentUnit, ContentAttachmentPlan } from '../types';
import type { ContentAttachmentThinCompilation } from './compile-types';
import type {
  ContentAttachmentThinDecision,
  ContentAttachmentThinInspection,
} from './inspection';

import { layerInChapters, localLayerHomes } from './compile-candidates';

/** A run is an outlier when it alone differs on more than this share of segments... */
export const CONTENT_ATTACHMENT_THIN_OUTLIER_RATE = 0.25;
/** ...and on at least this many segments. */
export const CONTENT_ATTACHMENT_THIN_OUTLIER_MIN_COUNT = 3;
/** Unanimous segments confirming more targets than this (collective statements) go to review. */
export const CONTENT_ATTACHMENT_THIN_LARGE_COLLECTIVE_LIMIT = 50;
/** Unanimous segments confirming more targets than this through collective handles go to review. */
export const CONTENT_ATTACHMENT_THIN_LARGE_HANDLE_LIMIT = 10;
/** Layer names or numbers shorter than this are too generic to suggest. */
const LAYER_KEY_MIN_LENGTH = 3;

export interface ContentAttachmentThinLoneRate {
  rate: number;
  count: number;
}
export interface ContentAttachmentThinOutlierCheck {
  /** Lone-outlier share and count of each run, in the given order. */
  rates: ContentAttachmentThinLoneRate[];
  /** Indexes of the runs above both thresholds. */
  flagged: number[];
}
export interface ContentAttachmentThinVote {
  ref: string;
  votes: number;
}
export interface ContentAttachmentThinRoutedSegment {
  segment: string;
  status: 'auto' | 'review';
  reasons: Array<
    | 'whole_unit'
    | 'invalid_run'
    | 'contested_targets'
    | 'uncertainty_differs'
    | 'area'
    | 'layer'
    | 'large_collective'
    | 'large_handle'
  >;
  /** Targets returned by every run; areas only under the plan's `unanimous` area policy. */
  confirmed: string[];
  /** Targets returned by only some runs, with their vote counts. */
  contested: ContentAttachmentThinVote[];
  /** Area candidates returned by any run, unless the plan's area policy is `unanimous`. */
  areaSuggestions: ContentAttachmentThinVote[];
  /** Layer candidates named literally in the segment but not returned by every run. */
  layerSuggestions: string[];
  /** Uncertainty groups when every run returned the same groups. */
  recipientIdentityAlternatives: string[][];
  relationshipSubjectAlternatives: string[][];
  /** `majority`: two of three runs agreed after the first two disagreed (see `routeContentAttachmentThinTiebreak`). */
  decidedBy?: 'majority';
}

/** Review reasons a third run can settle: the runs disagree on targets or uncertainty, or one run is invalid. */
const TIEBREAK_REASONS = new Set<
  ContentAttachmentThinRoutedSegment['reasons'][number]
>(['contested_targets', 'uncertainty_differs', 'invalid_run']);

/** Whether a routed segment is in review only for reasons a third run can settle. */
export const isContentAttachmentThinTiebreakable = (
  segment: ContentAttachmentThinRoutedSegment,
) =>
  segment.status === 'review' &&
  segment.reasons.every((r) => TIEBREAK_REASONS.has(r));

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '');
const groups = (gs: string[][]) => gs.map((g) => [...g].sort()).sort();
/** Canonical comparison key for a run's decision; none and invalid decisions have their own keys. */
const decisionKey = (d: ContentAttachmentThinDecision | undefined) =>
  !d
    ? 'invalid'
    : d.kind === 'none'
      ? '[]'
      : JSON.stringify([
          [...d.recipients].sort(),
          groups(d.relationshipSubjectAlternatives),
          groups(d.recipientIdentityAlternatives),
        ]);
const byIndex = (runs: ContentAttachmentThinInspection[]) =>
  runs.map((r) => new Map(r.decisions.map((d) => [d.segment, d])));

/**
 * Measure how often each of three runs alone differs from the two others, which agree with each other.
 * Exactly one flagged run calls for one replacement call; a flagged replacement routes with all four runs.
 */
export function checkContentAttachmentThinOutliers(
  segments: string[],
  runs: ContentAttachmentThinInspection[],
): ContentAttachmentThinOutlierCheck {
  if (runs.length !== 3) throw new Error('Expected exactly three runs');
  const keys = byIndex(runs).map((m) =>
    segments.map((s) => decisionKey(m.get(s))),
  );
  const rates = keys.map((own, i) => {
    const [a, b] = [0, 1, 2].filter((j) => j !== i);
    const count = segments.filter(
      (_, k) => keys[a][k] === keys[b][k] && own[k] !== keys[a][k],
    ).length;
    return { rate: segments.length ? count / segments.length : 0, count };
  });
  return {
    rates,
    flagged: rates.flatMap((r, i) =>
      r.rate > CONTENT_ATTACHMENT_THIN_OUTLIER_RATE &&
      r.count >= CONTENT_ATTACHMENT_THIN_OUTLIER_MIN_COUNT
        ? [i]
        : [],
    ),
  };
}

/**
 * Route each judged segment of a unit from its final runs. Targets returned by every run are confirmed,
 * others are contested with votes. A segment goes to review when targets are contested, uncertainty
 * groups differ, a run is invalid for it, an area is returned, a literally named layer is not confirmed, or
 * more targets are confirmed than a collective statement may attach without review, or than a collective
 * handle may confirm without review. Under the plan's
 * `unanimous` area policy areas are voted on like other targets instead of always going to review.
 * Under the plan's `local` layer policy a layer name shared by several layers suggests only the nearest local one, and a
 * single-unit layer from a neighbouring unit is suggested only to a segment in its chapter.
 */
export function routeContentAttachmentThinSegments(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
  compilation: ContentAttachmentThinCompilation,
  runs: ContentAttachmentThinInspection[],
  options: { wholeUnitReview?: boolean } = {},
): ContentAttachmentThinRoutedSegment[] {
  if (!runs.length) throw new Error('Expected at least one run');
  const kinds = new Map(plan.registry.map((r) => [r.ref, r.recordKind]));
  const handleMembers = new Map(
    compilation.codeMap.handles.map((h) => [h.ref, h.members]),
  );
  const order = plan.registry.map((r) => r.ref);
  const layerKeys = plan.registry
    .filter((r) => r.recordKind === 'layer')
    .map((r) => ({
      ref: r.ref,
      keys: r.mentions
        .flatMap((m) => [m.sourceName, m.sourceIdentifier])
        .map(norm)
        .filter((k) => k.length >= LAYER_KEY_MIN_LENGTH),
    }));
  const texts = new Map(
    unit.sources.map((s) => [s.resource.key, s.resource.data.text]),
  );
  const indexes = byIndex(runs);
  const sourceOrder = new Map(unit.sources.map((s, i) => [s.resource.key, i]));
  const evidenceOrder = new Map(
    plan.registry
      .filter((r) => r.recordKind === 'layer')
      .map((r) => [
        r.ref,
        r.mentions.flatMap((m) =>
          m.evidence.flatMap((e) =>
            sourceOrder.has(e.resourceKey)
              ? [sourceOrder.get(e.resourceKey)!]
              : [],
          ),
        ),
      ]),
  );
  // under the local policy only layers offered to the model for this unit can be suggested
  const local = plan.thinPolicy?.layers === 'local';
  const votedAreas = plan.thinPolicy?.areas === 'unanimous';
  const offered = new Set(compilation.codeMap.candidateRefs);
  const entries = new Map(plan.registry.map((r) => [r.ref, r]));
  const homes = local ? localLayerHomes(plan) : new Map<string, number>();
  const unitAt = plan.units.findIndex((u) => u.unitId === unit.unitId);
  const chapterPaths = new Map(
    unit.chapters.map((c) => [c.chapterId, c.path.map((x) => x.id)]),
  );
  const segmentPaths = new Map(
    unit.sources.map((s) => [
      s.resource.key,
      s.resource.chapterIds.map((id) => chapterPaths.get(id) ?? [id]),
    ]),
  );
  const nameUse = new Map<string, number>();
  for (const l of layerKeys)
    for (const k of new Set(l.keys)) nameUse.set(k, (nameUse.get(k) ?? 0) + 1);
  /**
   * Local rule for a name several layers share: keep the layers with evidence in this unit, then only the
   * one whose evidence is nearest at or before the segment. Names used by one layer are unaffected, but
   * only layers offered to the model for this unit can be suggested, and a single-unit layer from a
   * neighbouring unit only to a segment in its chapter.
   */
  const narrowLocal = (
    named: typeof layerKeys,
    text: string,
    at: number,
    paths: string[][],
  ) => {
    const shared = [...nameUse].flatMap(([k, n]) =>
      n > 1 && text.includes(k) ? [k] : [],
    );
    const before = (ref: string) =>
      Math.max(-1, ...evidenceOrder.get(ref)!.filter((i) => i <= at));
    const pool = named.filter(
      (l) =>
        offered.has(l.ref) &&
        (!homes.has(l.ref) ||
          homes.get(l.ref) === unitAt ||
          layerInChapters(entries.get(l.ref)!, paths)),
    );
    return pool.filter((l) => {
      const key = shared.find((k) => l.keys.includes(k));
      if (!key) return true;
      if (!evidenceOrder.get(l.ref)!.length) return false;
      const rivals = pool.filter(
        (o) => o.keys.includes(key) && evidenceOrder.get(o.ref)!.length,
      );
      const best = Math.max(...rivals.map((o) => before(o.ref)));
      return best >= 0 ? before(l.ref) === best : rivals[0] === l;
    });
  };

  return compilation.codeMap.segments.map((segment) => {
    const span = compilation.codeMap.segSpans.find((s) => s.seg === segment)!;
    const text = norm(texts.get(span.key)!.slice(span.charStart, span.charEnd));
    const ds = indexes.map((m) => m.get(segment));
    const valid = ds.filter((d): d is ContentAttachmentThinDecision => !!d);
    const votes = new Map<string, number>();
    for (const d of valid)
      for (const ref of d.recipients) votes.set(ref, (votes.get(ref) ?? 0) + 1);
    const returned = order.filter((ref) => votes.has(ref));
    const unanimous = (ref: string) =>
      valid.length === runs.length && votes.get(ref) === runs.length;
    const vote = (ref: string) => ({ ref, votes: votes.get(ref)! });
    const isArea = (ref: string) => !votedAreas && kinds.get(ref) === 'area';
    const confirmed = returned.filter((r) => unanimous(r) && !isArea(r));
    const contested = returned.filter((r) => !unanimous(r) && !isArea(r));
    const areaSuggestions = returned.filter(isArea).map(vote);
    const named = layerKeys.filter((l) => l.keys.some((k) => text.includes(k)));
    const layerSuggestions = (
      local
        ? narrowLocal(
            named,
            text,
            sourceOrder.get(span.key)!,
            segmentPaths.get(span.key)!,
          )
        : named
    )
      .filter((l) => !(votes.has(l.ref) && unanimous(l.ref)))
      .map((l) => l.ref);
    const groupKeys = new Set(
      valid.map((d) =>
        JSON.stringify([
          groups(d.relationshipSubjectAlternatives),
          groups(d.recipientIdentityAlternatives),
        ]),
      ),
    );
    const reasons: ContentAttachmentThinRoutedSegment['reasons'] = [];
    if (options.wholeUnitReview) reasons.push('whole_unit');
    if (valid.length !== runs.length) reasons.push('invalid_run');
    if (contested.length) reasons.push('contested_targets');
    if (groupKeys.size > 1) reasons.push('uncertainty_differs');
    if (areaSuggestions.length) reasons.push('area');
    if (layerSuggestions.length) reasons.push('layer');
    if (confirmed.length > CONTENT_ATTACHMENT_THIN_LARGE_COLLECTIVE_LIMIT)
      reasons.push('large_collective');
    // a confirmed target counts as handle-derived when any run reached it through a returned handle
    const viaHandle = confirmed.filter((ref) =>
      valid.some((d) =>
        d.handles.some((h) => handleMembers.get(h)?.includes(ref)),
      ),
    );
    if (viaHandle.length > CONTENT_ATTACHMENT_THIN_LARGE_HANDLE_LIMIT)
      reasons.push('large_handle');
    const agreedGroups = groupKeys.size === 1 && valid.length === runs.length;
    return {
      segment,
      status: reasons.length ? 'review' : 'auto',
      reasons,
      confirmed,
      contested: contested.map(vote),
      areaSuggestions,
      layerSuggestions,
      recipientIdentityAlternatives: agreedGroups
        ? valid[0].recipientIdentityAlternatives
        : [],
      relationshipSubjectAlternatives: agreedGroups
        ? valid[0].relationshipSubjectAlternatives
        : [],
    };
  });
}

/**
 * Route a unit from r1, r2 and a tie-breaking r3. A segment r1 and r2 agree on keeps that routing. A segment in
 * review only because the two disagreed (or one was invalid) is decided by whichever of r1 or r2 agrees with r3,
 * marked `decidedBy: 'majority'`; when neither does, or the segment is in review for another reason (areas, layers,
 * large collectives, a whole-unit review), it stays in review with all three runs.
 */
export function routeContentAttachmentThinTiebreak(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
  compilation: ContentAttachmentThinCompilation,
  runs: [
    ContentAttachmentThinInspection,
    ContentAttachmentThinInspection,
    ContentAttachmentThinInspection,
  ],
): ContentAttachmentThinRoutedSegment[] {
  const route = (list: ContentAttachmentThinInspection[]) =>
    new Map(
      routeContentAttachmentThinSegments(plan, unit, compilation, list).map(
        (s) => [s.segment, s],
      ),
    );
  const [r1, r2, r3] = runs;
  const all = route(runs);
  const pairs = [route([r1, r3]), route([r2, r3])];
  return routeContentAttachmentThinSegments(plan, unit, compilation, [
    r1,
    r2,
  ]).map((segment) => {
    if (!isContentAttachmentThinTiebreakable(segment)) return segment;
    const settled = pairs
      .map((p) => p.get(segment.segment)!)
      .find((s) => s.status === 'auto');
    return settled
      ? { ...settled, decidedBy: 'majority' as const }
      : all.get(segment.segment)!;
  });
}
