import type {
  CandidateDiscoveryAudit,
  CandidateDiscoveryPlan,
} from './discovery-types';

import { assembleCandidateDiscovery } from './discovery-assembly';

/** Reuse successful units unchanged and schedule only units with recorded validation issues. */
export async function prepareCandidateDiscoveryRetry(
  plan: CandidateDiscoveryPlan,
  audits: CandidateDiscoveryAudit[],
  options: { unitIds?: string[]; updatedPlan?: CandidateDiscoveryPlan } = {},
) {
  const previous = await assembleCandidateDiscovery(plan, audits);
  if (previous.completedUnitIds.length !== plan.units.length) {
    throw new Error('Retry requires a complete, replayable discovery snapshot');
  }
  const retryUnitIds = [
    ...new Set([
      ...previous.issues.map((issue) => issue.unitId),
      ...(options.unitIds ?? []),
    ]),
  ];
  if (!retryUnitIds.length) throw new Error('No discovery issues to retry');
  const updated = options.updatedPlan ?? plan;
  if (
    updated.inputSha256 !== plan.inputSha256 ||
    updated.scopeChapterId !== plan.scopeChapterId ||
    retryUnitIds.some(
      (id) =>
        !plan.units.some((u) => u.unitId === id) ||
        !updated.units.some((u) => u.unitId === id),
    )
  )
    throw new Error(
      'Retry units require matching original input, scope and unit IDs',
    );
  const nextPlan = {
    ...plan,
    units: plan.units.map((unit) =>
      retryUnitIds.includes(unit.unitId)
        ? updated.units.find((u) => u.unitId === unit.unitId)!
        : unit,
    ),
  };
  const retainedAudits = audits.filter(
    (audit) => !retryUnitIds.includes(audit.unitId),
  );
  return {
    plan: nextPlan,
    retryUnitIds,
    retainedAudits,
    result: await assembleCandidateDiscovery(nextPlan, retainedAudits),
  };
}
