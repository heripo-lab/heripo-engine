import type { CandidateEvidence } from '../candidates/discovery-types';
import type { AttachmentUnit, ContentAttachmentPlan } from './types';

import { createContentAttachmentSelectionInput } from './excerpts';

/** A caller-supplied, confirmed decision about one original mention, never an entire source. */
export interface ContentRegistrationDecision {
  decisionId: string;
  inputSha256: string;
  decision: 'not_independent_record';
  basis: 'no_independent_body_or_table_item';
  authority: 'author_confirmed';
  evidence: CandidateEvidence;
  provenance: { reference: string; text: string };
}

/** Bind confirmed decisions by original ranges; never infer exclusions from missing candidates. */
export function createContentAttachmentDecisionInput(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
) {
  const selected = createContentAttachmentSelectionInput(plan, unit);
  const decisions = plan.registrationDecisions ?? [];
  const seen = new Set<string>();
  const bindings: Array<{
    ref: string;
    decisionId: string;
    excerptRef: string;
  }> = [];
  const rows: Array<{
    ref: string;
    excerptRef: string;
    mention: string;
    decision: ContentRegistrationDecision['decision'];
    basis: ContentRegistrationDecision['basis'];
    authority: ContentRegistrationDecision['authority'];
  }> = [];
  for (const [i, decision] of decisions.entries()) {
    if (
      !decision.decisionId ||
      seen.has(decision.decisionId) ||
      decision.inputSha256 !== plan.inputSha256 ||
      decision.decision !== 'not_independent_record' ||
      decision.basis !== 'no_independent_body_or_table_item' ||
      decision.authority !== 'author_confirmed' ||
      !decision.provenance.reference ||
      !decision.provenance.text
    )
      throw new Error('Invalid registration decision metadata');
    seen.add(decision.decisionId);
    const e = decision.evidence;
    const sources = plan.units
      .flatMap((u) => u.sources)
      .filter((s) => s.resource.key === e.resourceKey);
    if (sources.length !== 1)
      throw new Error('Registration decision source is missing or ambiguous');
    const { resource: r, sourceId } = sources[0];
    if (
      !Number.isInteger(e.charStart) ||
      !Number.isInteger(e.charEnd) ||
      e.charStart < 0 ||
      e.charEnd <= e.charStart ||
      e.charEnd > r.data.text.length ||
      !/\S/u.test(e.quote)
    )
      throw new Error('Invalid registration decision mention range');
    const expected: CandidateEvidence = {
      sourceId,
      resourceKey: r.key,
      resourceId: r.resourceId,
      sourceRefs: r.sourceRefs,
      pdfPageNo: r.pdfPageNo,
      logicalPageRange: r.logicalPageRange,
      charStart: e.charStart,
      charEnd: e.charEnd,
      quote: r.data.text.slice(e.charStart, e.charEnd),
    };
    if (
      !Object.entries(expected).every(
        ([key, value]) =>
          JSON.stringify(e[key as keyof CandidateEvidence]) ===
          JSON.stringify(value),
      )
    )
      throw new Error(
        'Registration decision evidence differs from original source',
      );
    if (!unit.sources.some((s) => s.resource.key === e.resourceKey)) continue;
    const matches = selected.codeMap.excerpts.filter((excerpt) =>
      excerpt.evidence.some(
        (f) =>
          f.resourceKey === e.resourceKey &&
          f.charStart <= e.charStart &&
          e.charEnd <= f.charEnd,
      ),
    );
    if (matches.length !== 1)
      throw new Error('Registration decision must fit one selectable excerpt');
    const ref = `D${i + 1}`;
    const excerptRef = matches[0].ref;
    bindings.push({ ref, decisionId: decision.decisionId, excerptRef });
    rows.push({
      ref,
      excerptRef,
      mention: e.quote,
      decision: decision.decision,
      basis: decision.basis,
      authority: decision.authority,
    });
  }
  return {
    payload: {
      ...selected.payload,
      current: { ...selected.payload.current, registrationDecisions: rows },
    },
    codeMap: {
      ...selected.codeMap,
      registrationDecisionSnapshot: decisions,
      registrationDecisionBindings: bindings,
    },
  };
}
