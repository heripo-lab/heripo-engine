import type {
  CandidateDiscoveryAudit,
  CandidateDiscoveryIssue,
  CandidateDiscoveryPlan,
  CandidateDiscoveryResponse,
  CandidateDiscoveryResult,
  CandidateEvidence,
  LedgerObjectCandidate,
} from './discovery-types';

import {
  CANDIDATE_DISCOVERY_PROMPT_VERSION,
  createCandidateDiscoveryRequest,
  getCandidateSources,
} from './discovery-request';
import { candidateDiscoveryResponseSchema } from './discovery-types';

export async function candidateId(value: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return `candidate-${Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')}`;
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
    if (!parsed.success) {
      issues.push({
        unitId: unit.unitId,
        candidateIndex: null,
        reason: 'Invalid saved model response schema',
      });
      continue;
    }
    completedUnitIds.push(unit.unitId);
    inspectedResourceCount += unit.resources.length;
    const sources = getCandidateSources(unit);
    for (const exclusion of parsed.data.exclusions) {
      const selected = sources.find(
        (source) => source.sourceId === exclusion.sourceId,
      );
      if (selected)
        exclusions.push({
          unitId: unit.unitId,
          sourceId: exclusion.sourceId,
          resourceKey: selected.resource.key,
          reason: exclusion.reason,
        });
      else
        issues.push({
          unitId: unit.unitId,
          candidateIndex: null,
          reason: 'Exclusion references a resource outside the unit',
        });
    }
    for (const [candidateIndex, proposal] of parsed.data.candidates.entries()) {
      const evidence: CandidateEvidence[] = [];
      for (const pointer of proposal.evidence) {
        const resource = sources.find(
          (source) => source.sourceId === pointer.sourceId,
        )?.resource;
        const start = resource?.data.text.indexOf(pointer.quote) ?? -1;
        if (!resource || start < 0) break;
        evidence.push({
          sourceId: pointer.sourceId,
          resourceKey: resource.key,
          resourceId: resource.resourceId,
          sourceRefs: resource.sourceRefs,
          pdfPageNo: resource.pdfPageNo,
          logicalPageRange: resource.logicalPageRange,
          quote: pointer.quote,
          charStart: start,
          charEnd: start + pointer.quote.length,
        });
      }
      const sourceText = [
        ...unit.resources.map((r) => r.data.text),
        ...unit.context.map((r) => r.text),
        ...unit.chapterPath.map((c) => c.originTitle),
        unit.table?.caption ?? '',
      ];
      const identifierCell = sources.find(
        (source) => source.sourceId === proposal.identifierSourceId,
      );
      const firstCell = sources.find(
        (source) => source.sourceId === proposal.evidence[0].sourceId,
      )?.resource;
      const strictTableIdentifier =
        (audit.promptVersion === 'candidate-discovery.v6' ||
          audit.promptVersion === 'candidate-discovery.v7' ||
          audit.promptVersion === CANDIDATE_DISCOVERY_PROMPT_VERSION) &&
        unit.table !== null &&
        proposal.eligibilityBasis === 'table_item';
      let invalid = '';
      if (evidence.length !== proposal.evidence.length)
        invalid = 'Evidence does not match an exact input quote in this unit';
      else if (!sourceText.some((t) => t.includes(proposal.sourceName)))
        invalid = 'Source name is not verbatim in the supplied input';
      else if (
        proposal.sourceIdentifier !== null &&
        !evidence.some((e) => e.quote.includes(proposal.sourceIdentifier!))
      )
        invalid = 'Source identifier is not present in the quoted evidence';
      else if (
        strictTableIdentifier &&
        (proposal.sourceIdentifier !== null ||
          (firstCell?.kind === 'tableCell' &&
            /^\d+(?:호)?$/u.test(firstCell.data.text))) &&
        (!identifierCell ||
          identifierCell.resource.kind !== 'tableCell' ||
          identifierCell.resource.data.isHeader ||
          proposal.sourceIdentifier !== identifierCell.resource.data.text ||
          proposal.evidence[0].sourceId !== proposal.identifierSourceId ||
          proposal.evidence[0].quote !== identifierCell.resource.data.text)
      )
        invalid =
          'Table identifier must equal the selected original number cell and first evidence';
      else if (
        ['feature', 'artifact'].includes(proposal.recordKind) &&
        proposal.eligibilityBasis === 'explicit_context_unit'
      )
        invalid =
          'Feature/artifact candidates require independent body or table evidence';
      else if (
        proposal.eligibilityBasis === 'table_item' &&
        unit.table === null
      )
        invalid = 'Table candidate has no original table input';
      else if (
        proposal.eligibilityBasis === 'independent_body' &&
        unit.table !== null
      )
        invalid = 'Body candidate has no body input';
      if (invalid) {
        issues.push({ unitId: unit.unitId, candidateIndex, reason: invalid });
        continue;
      }
      const anchor = evidence[0];
      const id = await candidateId(
        JSON.stringify([
          plan.inputSha256,
          proposal.recordKind,
          anchor.resourceKey,
          anchor.charStart,
          anchor.charEnd,
        ]),
      );
      const existing = candidates.get(id);
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
    if (
      audit.promptVersion === 'candidate-discovery.v7' ||
      audit.promptVersion === CANDIDATE_DISCOVERY_PROMPT_VERSION
    ) {
      const missing = unhandledTableRows(sources, parsed.data);
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

/**
 * Data rows of a table unit that no proposal or exclusion references, once any row of the unit is proposed as a
 * table item. Rows with a header cell or only empty cells are not data rows. A table without item proposals
 * (a log or a summary) may skip non-object rows silently, as the prompt allows.
 */
function unhandledTableRows(
  sources: ReturnType<typeof getCandidateSources>,
  response: CandidateDiscoveryResponse,
): number[] {
  if (!response.candidates.some((c) => c.eligibilityBasis === 'table_item'))
    return [];
  const rows = new Map<number, { header: boolean; text: boolean }>();
  const rowOf = new Map<string, number>();
  for (const { sourceId, resource } of sources) {
    if (resource.kind !== 'tableCell') continue;
    rowOf.set(sourceId, resource.rowIndex);
    const row = rows.get(resource.rowIndex) ?? { header: false, text: false };
    row.header ||= resource.data.isHeader;
    row.text ||= resource.data.text.trim() !== '';
    rows.set(resource.rowIndex, row);
  }
  const handled = new Set(
    [
      ...response.candidates.flatMap((c) => [
        c.identifierSourceId,
        ...c.evidence.map((e) => e.sourceId),
      ]),
      ...response.exclusions.map((e) => e.sourceId),
    ].flatMap((id) =>
      typeof id === 'string' && rowOf.has(id) ? [rowOf.get(id)!] : [],
    ),
  );
  return [...rows]
    .filter(([index, row]) => row.text && !row.header && !handled.has(index))
    .map(([index]) => index);
}
