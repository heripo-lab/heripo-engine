import type { ContentAttachmentPlan } from '../content-attachment';
import type { ContentAttachmentThinEvidence } from './inspection';
import type { ContentAttachmentThinRoutedSegment } from './routing';
import type {
  ContentAttachmentThinRunName,
  ContentAttachmentThinUnitResult,
} from './run';

import { createContentAttachmentThinInput } from './compile';
import { CONTENT_ATTACHMENT_THIN_VERSION } from './prompt';

export type ContentAttachmentThinBasis =
  | 'model_unanimous'
  | 'code_row_owner'
  | 'code_typed_row'
  | 'code_cell_registration';
/** One original source segment attached to a registry candidate, with how the attachment was made. */
export interface ContentAttachmentThinExcerpt {
  unitId: string;
  segment: string;
  resourceKey: string;
  charStart: number;
  charEnd: number;
  basis: ContentAttachmentThinBasis;
}
export interface ContentAttachmentThinReviewItem extends Omit<
  ContentAttachmentThinRoutedSegment,
  'status'
> {
  unitId: string;
  resourceKey: string;
  charStart: number;
  charEnd: number;
  /** Each final run's decision for the segment, in run order; null when the run was invalid for it. */
  runs: Array<{
    run: ContentAttachmentThinRunName;
    recipients: string[];
    recipientIdentityAlternatives: string[][];
    relationshipSubjectAlternatives: string[][];
  } | null>;
  evidence: ContentAttachmentThinEvidence[];
}
export interface ContentAttachmentThinResult {
  version: 'ledger-content-attachments.v2';
  method: typeof CONTENT_ATTACHMENT_THIN_VERSION;
  reviewStatus: 'not_reviewed';
  totalUnits: number;
  units: Array<{
    unitId: string;
    status: ContentAttachmentThinUnitResult['status'];
    calls: number;
    finalRuns: ContentAttachmentThinRunName[];
    wholeUnitReview: boolean;
  }>;
  missingUnitIds: string[];
  /** Attachments grouped by registry candidate, in registry order. */
  contents: Array<{
    registryRef: string;
    groupId: string;
    excerpts: ContentAttachmentThinExcerpt[];
  }>;
  /** Evidence of automatically confirmed model segments, merged across the final runs. */
  segmentEvidence: Array<{
    unitId: string;
    segment: string;
    evidence: ContentAttachmentThinEvidence[];
  }>;
  /** Uncertainty groups that every final run returned for an automatically accepted segment. */
  uncertainties: Array<{
    unitId: string;
    segment: string;
    recipientIdentityAlternatives: string[][];
    relationshipSubjectAlternatives: string[][];
  }>;
  reviewItems: ContentAttachmentThinReviewItem[];
  /** What this stage deliberately does not decide. */
  scope: { relationCounterparts: 'deferred_to_link_extraction' };
  issues: Array<{ unitId: string; reason: string }>;
}

const mergeEvidence = (lists: ContentAttachmentThinEvidence[][]) => {
  const seen = new Set<string>();
  return lists.flat().filter((e) => {
    const key = `${e.sourceRef}|${e.charStart}|${e.charEnd}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Assemble per-unit thin attachment results into the ledger attachment view. Only automatically accepted
 * segments and code-assigned table cells become attachments; review segments are kept as review items with
 * every final run's decision. Original source strings are referenced by key and span, never copied or
 * repaired. Relation counterparts are not attached at this stage.
 */
export function assembleContentAttachmentThin(
  plan: ContentAttachmentPlan,
  results: ContentAttachmentThinUnitResult[],
): ContentAttachmentThinResult {
  const output: ContentAttachmentThinResult = {
    version: 'ledger-content-attachments.v2',
    method: CONTENT_ATTACHMENT_THIN_VERSION,
    reviewStatus: 'not_reviewed',
    totalUnits: plan.units.length,
    units: [],
    missingUnitIds: [],
    contents: [],
    segmentEvidence: [],
    uncertainties: [],
    reviewItems: [],
    scope: { relationCounterparts: 'deferred_to_link_extraction' },
    issues: [],
  };
  const excerpts = new Map<string, ContentAttachmentThinExcerpt[]>();
  const attach = (ref: string, excerpt: ContentAttachmentThinExcerpt) =>
    excerpts.set(ref, [...(excerpts.get(ref) ?? []), excerpt]);

  for (const result of results) {
    const unit = plan.units.find((u) => u.unitId === result.unitId);
    if (!unit) {
      output.issues.push({ unitId: result.unitId, reason: 'unknown unit' });
      continue;
    }
    if (output.units.some((u) => u.unitId === result.unitId)) {
      output.issues.push({
        unitId: result.unitId,
        reason: 'duplicate unit result',
      });
      continue;
    }
    output.units.push({
      unitId: result.unitId,
      status: result.status,
      calls: result.calls.length,
      finalRuns: result.outliers?.finalRuns ?? [],
      wholeUnitReview: result.outliers?.wholeUnitReview ?? false,
    });
    if (result.status === 'failed') {
      output.issues.push({
        unitId: result.unitId,
        reason: 'a required call failed',
      });
      continue;
    }
    const { codeMap } = createContentAttachmentThinInput(plan, unit);
    const span = (segment: string) => {
      const s = codeMap.segSpans.find((x) => x.seg === segment)!;
      return { resourceKey: s.key, charStart: s.charStart, charEnd: s.charEnd };
    };
    const typedRows = new Set(
      codeMap.rowBindings.flatMap((b) =>
        'owner' in b ? [`${b.table}/grid/${b.row}/`] : [],
      ),
    );
    for (const [segment, owner, ...registered] of codeMap.codeAssigned) {
      const location = span(segment);
      const typed = [...typedRows].some((p) =>
        location.resourceKey.startsWith(p),
      );
      attach(owner, {
        unitId: result.unitId,
        segment,
        ...location,
        basis: typed ? 'code_typed_row' : 'code_row_owner',
      });
      for (const ref of registered)
        attach(ref, {
          unitId: result.unitId,
          segment,
          ...location,
          basis: 'code_cell_registration',
        });
    }
    const finalCalls = (result.outliers?.finalRuns ?? []).map((run) =>
      result.calls.find((c) => c.run === run)!,
    );
    for (const routed of result.segments) {
      const decisions = finalCalls.map((c) =>
        c.inspection!.decisions.find((d) => d.segment === routed.segment),
      );
      const evidence = mergeEvidence(decisions.map((d) => d?.evidence ?? []));
      const location = span(routed.segment);
      if (routed.status === 'review') {
        const { status: _status, ...rest } = routed;
        output.reviewItems.push({
          unitId: result.unitId,
          ...location,
          ...rest,
          runs: decisions.map((d, i) =>
            d
              ? {
                  run: finalCalls[i].run,
                  recipients: d.recipients,
                  recipientIdentityAlternatives:
                    d.recipientIdentityAlternatives,
                  relationshipSubjectAlternatives:
                    d.relationshipSubjectAlternatives,
                }
              : null,
          ),
          evidence,
        });
        continue;
      }
      for (const ref of routed.confirmed)
        attach(ref, {
          unitId: result.unitId,
          segment: routed.segment,
          ...location,
          basis: 'model_unanimous',
        });
      if (evidence.length)
        output.segmentEvidence.push({
          unitId: result.unitId,
          segment: routed.segment,
          evidence,
        });
      if (
        routed.recipientIdentityAlternatives.length ||
        routed.relationshipSubjectAlternatives.length
      )
        output.uncertainties.push({
          unitId: result.unitId,
          segment: routed.segment,
          recipientIdentityAlternatives: routed.recipientIdentityAlternatives,
          relationshipSubjectAlternatives:
            routed.relationshipSubjectAlternatives,
        });
    }
  }
  output.missingUnitIds = plan.units
    .map((u) => u.unitId)
    .filter((id) => !output.units.some((u) => u.unitId === id));
  output.contents = plan.registry
    .filter((r) => excerpts.has(r.ref))
    .map((r) => ({
      registryRef: r.ref,
      groupId: r.groupId,
      excerpts: excerpts.get(r.ref)!,
    }));
  return output;
}
