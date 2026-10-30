import type {
  CandidateDiscoveryAudit,
  CandidateDiscoveryIssue,
  CandidateDiscoveryPlan,
  CandidateDiscoveryResponse,
  CandidateDiscoveryResult,
  LedgerObjectCandidate,
} from './discovery-types';

import {
  CANDIDATE_DISCOVERY_PROMPT_VERSION,
  createCandidateDiscoveryRequest,
  getCandidateSources,
  isSectionHeading,
} from './discovery-request';
import {
  columnBlocks,
  unansweredItemTableBlocks,
  unansweredItemTableRows,
} from './discovery-rows';
import { candidateDiscoveryResponseSchema } from './discovery-types';
import {
  anchorKey,
  candidateCheckLevel,
  checkCandidate,
  planCandidateDiscoveryFollowUp,
  unansweredNumberedBlocks,
} from './discovery-validation';

export async function candidateId(value: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return `candidate-${Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The follow-up candidates a v11 assembly keeps. A candidate that repeats the kind and anchor of a kept valid
 * candidate of the first response is dropped rather than reported as a duplicate. In the section of a reconsidered
 * heading, only a candidate anchored at the heading itself is kept, so a reconsideration adds the heading's object,
 * not every object its description mentions.
 */
function followUpCandidates(
  unit: CandidateDiscoveryPlan['units'][number],
  first: CandidateDiscoveryResponse,
  kept: CandidateDiscoveryResponse['candidates'],
  reconsidered: number[],
  candidates: CandidateDiscoveryResponse['candidates'],
  level: ReturnType<typeof candidateCheckLevel>,
) {
  // every kept candidate is valid: invalid ones were sent back as corrections
  const anchors = new Set(
    kept.map((proposal) =>
      anchorKey(
        proposal.recordKind,
        checkCandidate(unit, proposal, first.tableRole, level).evidence[0],
      ),
    ),
  );
  const sources = getCandidateSources(unit);
  const sectionBody = new Set<string>();
  for (const index of reconsidered) {
    const at = sources.findIndex(
      (s) => s.sourceId === first.exclusions[index].sourceId,
    );
    for (
      let next = at + 1;
      next < sources.length &&
      !isSectionHeading(sources[next].resource.data.text);
      next++
    )
      sectionBody.add(sources[next].sourceId);
  }
  return candidates.filter((proposal) => {
    if (sectionBody.has(proposal.evidence[0].sourceId)) return false;
    const { evidence, invalid } = checkCandidate(
      unit,
      proposal,
      first.tableRole,
      level,
    );
    return invalid || !anchors.has(anchorKey(proposal.recordKind, evidence[0]));
  });
}

/** Validate saved responses against exact input locations; invalid proposals stay issues. */
export async function assembleCandidateDiscovery(
  plan: CandidateDiscoveryPlan,
  audits: CandidateDiscoveryAudit[],
): Promise<CandidateDiscoveryResult> {
  const candidates = new Map<string, LedgerObjectCandidate>();
  const issues: CandidateDiscoveryIssue[] = [];
  const exclusions: CandidateDiscoveryResult['exclusions'] = [];
  const completedUnitIds: string[] = [];
  let inspectedResourceCount = 0;
  for (const unit of plan.units) {
    const audit = audits.find((a) => a.unitId === unit.unitId);
    if (!audit) continue;
    const expected = createCandidateDiscoveryRequest(
      unit,
      audit.promptVersion === 'candidate-discovery.v4'
        ? 'candidate-discovery.v4'
        : audit.promptVersion === 'candidate-discovery.v5'
          ? 'candidate-discovery.v5'
          : audit.promptVersion === 'candidate-discovery.v6'
            ? 'candidate-discovery.v6'
            : audit.promptVersion === 'candidate-discovery.v7'
              ? 'candidate-discovery.v7'
              : audit.promptVersion === 'candidate-discovery.v8'
                ? 'candidate-discovery.v8'
                : audit.promptVersion === 'candidate-discovery.v9'
                  ? 'candidate-discovery.v9'
                  : audit.promptVersion === 'candidate-discovery.v10'
                    ? 'candidate-discovery.v10'
                    : audit.promptVersion === 'candidate-discovery.v11'
                      ? 'candidate-discovery.v11'
                      : audit.promptVersion === 'candidate-discovery.v12'
                        ? 'candidate-discovery.v12'
                        : audit.promptVersion === 'candidate-discovery.v13'
                          ? 'candidate-discovery.v13'
                          : audit.promptVersion === 'candidate-discovery.v14'
                            ? 'candidate-discovery.v14'
                            : CANDIDATE_DISCOVERY_PROMPT_VERSION,
    );
    if (
      audit.promptVersion !== expected.promptVersion ||
      audit.systemPrompt !== expected.systemPrompt ||
      audit.userPrompt !== expected.userPrompt
    ) {
      issues.push({
        unitId: unit.unitId,
        candidateIndex: null,
        reason:
          'Saved response does not match this input unit and prompt version',
      });
      continue;
    }
    const parsed = candidateDiscoveryResponseSchema.safeParse(audit.response);
    const followUp = audit.followUp
      ? candidateDiscoveryResponseSchema.safeParse(audit.followUp.response)
      : null;
    if (!parsed.success || followUp?.success === false) {
      issues.push({
        unitId: unit.unitId,
        candidateIndex: null,
        reason: 'Invalid saved model response schema',
      });
      continue;
    }
    const level = candidateCheckLevel(audit.promptVersion);
    if (audit.followUp) {
      const plan = planCandidateDiscoveryFollowUp(
        unit,
        parsed.data,
        audit.promptVersion,
      );
      if (
        !plan ||
        JSON.stringify(plan.rowIndexes) !==
          JSON.stringify(audit.followUp.rowIndexes) ||
        JSON.stringify(plan.rowBlocks) !==
          JSON.stringify(audit.followUp.rowBlocks ?? []) ||
        JSON.stringify(plan.corrections) !==
          JSON.stringify(audit.followUp.corrections ?? []) ||
        JSON.stringify(plan.reconsiderations) !==
          JSON.stringify(audit.followUp.reconsiderations ?? []) ||
        JSON.stringify(plan.numberedBlocks) !==
          JSON.stringify(audit.followUp.numberedBlocks ?? []) ||
        plan.userPrompt !== audit.followUp.userPrompt
      ) {
        issues.push({
          unitId: unit.unitId,
          candidateIndex: null,
          reason:
            'Saved follow-up does not match the unanswered rows, corrections, reconsidered headings and numbered blocks of this unit',
        });
        continue;
      }
    }
    // corrected candidates and reconsidered exclusions of the first response are replaced by the follow-up's answer
    const corrected = new Set(
      (audit.followUp?.corrections ?? []).map((c) => c.candidateIndex),
    );
    const reconsidered = new Set(
      (audit.followUp?.reconsiderations ?? []).map((r) => r.exclusionIndex),
    );
    const kept = parsed.data.candidates.filter((_, i) => !corrected.has(i));
    const response: CandidateDiscoveryResponse = followUp?.data
      ? {
          ...parsed.data,
          candidates: [
            ...kept,
            ...(level.v11
              ? followUpCandidates(
                  unit,
                  parsed.data,
                  kept,
                  [...reconsidered],
                  followUp.data.candidates,
                  level,
                )
              : followUp.data.candidates),
          ],
          exclusions: [
            ...parsed.data.exclusions.filter((_, i) => !reconsidered.has(i)),
            ...followUp.data.exclusions,
          ],
        }
      : parsed.data;
    completedUnitIds.push(unit.unitId);
    inspectedResourceCount += unit.resources.length;
    const sources = getCandidateSources(unit);
    for (const exclusion of response.exclusions) {
      const selected = sources.find(
        (source) => source.sourceId === exclusion.sourceId,
      );
      if (selected)
        exclusions.push({
          unitId: unit.unitId,
          sourceId: exclusion.sourceId,
          resourceKey: selected.resource.key,
          ...(exclusion.category && { category: exclusion.category }),
          reason: exclusion.reason,
        });
      else
        issues.push({
          unitId: unit.unitId,
          candidateIndex: null,
          reason: 'Exclusion references a resource outside the unit',
        });
    }
    for (const [candidateIndex, proposal] of response.candidates.entries()) {
      const { evidence, invalid } = checkCandidate(
        unit,
        proposal,
        response.tableRole,
        level,
      );
      if (invalid) {
        issues.push({ unitId: unit.unitId, candidateIndex, reason: invalid });
        continue;
      }
      const anchor = evidence[0];
      const id = await candidateId(
        JSON.stringify([
          plan.inputSha256,
          ...JSON.parse(anchorKey(proposal.recordKind, anchor)),
        ]),
      );
      const existing = candidates.get(id);
      // from v15 a proposal identical to one already kept (same anchor, name and number) is the same candidate
      if (
        existing &&
        level.v15 &&
        existing.sourceName === proposal.sourceName &&
        existing.sourceIdentifier === proposal.sourceIdentifier
      )
        continue;
      if (existing) {
        issues.push({
          unitId: unit.unitId,
          candidateIndex,
          reason: `Duplicate anchor requires review: ${id}`,
        });
        continue;
      }
      candidates.set(id, {
        candidateId: id,
        status: 'proposed',
        recordKind: proposal.recordKind,
        sourceName: proposal.sourceName,
        sourceIdentifier: proposal.sourceIdentifier,
        eligibilityBasis: proposal.eligibilityBasis,
        reason: proposal.reason,
        chapterId: unit.chapterId,
        unitIds: [unit.unitId],
        evidence,
      });
    }
    const numbered = unansweredNumberedBlocks(
      unit,
      response,
      audit.promptVersion,
    );
    if (numbered.length)
      issues.push({
        unitId: unit.unitId,
        candidateIndex: null,
        reason: `Numbered body blocks neither proposed nor excluded: ${numbered.map((b) => b.number).join(', ')}`,
      });
    if (level.v11 && columnBlocks(unit)) {
      const missing = unansweredItemTableBlocks(unit, response);
      if (missing.length)
        issues.push({
          unitId: unit.unitId,
          candidateIndex: null,
          reason: `Table row blocks neither proposed nor excluded with a row-level category: ${missing.map((b) => `${b.rowIndex}:${b.block}`).join(', ')}`,
        });
    } else if (level.v9) {
      const missing = unansweredItemTableRows(unit, response);
      if (missing.length)
        issues.push({
          unitId: unit.unitId,
          candidateIndex: null,
          reason: `Table rows neither proposed nor excluded with a row-level category: ${missing.join(', ')}`,
        });
    } else if (
      audit.promptVersion === 'candidate-discovery.v7' ||
      audit.promptVersion === 'candidate-discovery.v8'
    ) {
      // without tableRole and categories, any table item makes an item table and any exclusion answers its row
      const missing = unansweredItemTableRows(unit, parsed.data);
      if (missing.length)
        issues.push({
          unitId: unit.unitId,
          candidateIndex: null,
          reason: `Table rows neither proposed nor excluded: ${missing.join(', ')}`,
        });
    }
  }
  return {
    version: 'ledger-object-candidates.v1',
    inputSha256: plan.inputSha256,
    scopeChapterId: plan.scopeChapterId,
    ...(plan.scopeChapterIds ? { scopeChapterIds: plan.scopeChapterIds } : {}),
    scopeTitle: plan.scopeTitle,
    candidates: [...candidates.values()],
    issues,
    exclusions,
    completedUnitIds,
    totalUnits: plan.units.length,
    inspectedResourceCount,
  };
}
