import { describe, expect, test, vi } from 'vitest';

import { audit, prepare, proposal } from './candidate-discovery.test-fixture';
import { assembleCandidateDiscovery } from './discovery-assembly';
import {
  createCandidateDiscoveryRequest,
  getCandidateSources,
} from './discovery-request';
import { prepareCandidateDiscoveryRetry } from './discovery-retry';

vi.mock('@heripo/shared', () => ({ LLMCaller: { call: vi.fn() } }));

describe('discovery retries and preserved source fragments', () => {
  test('retries only failed units and replays mixed prompt versions without rewriting retained audits', async () => {
    const plan = prepare();
    const tableUnit = plan.units.find(
      (u) => u.table && u.resources.some((r) => r.data.text === '2호'),
    )!;
    const oldAudit = {
      ...audit(plan.units[0], {
        candidates: [proposal(plan.units[0])],
        exclusions: [],
      }),
      ...createCandidateDiscoveryRequest(
        plan.units[0],
        'candidate-discovery.v4',
      ),
    };
    const badProposal = {
      ...proposal(tableUnit),
      sourceName: '우물 2호',
      identifierSourceId: getCandidateSources(tableUnit)[0].sourceId,
      sourceIdentifier: '2호',
      eligibilityBasis: 'table_item' as const,
      evidence: [
        { sourceId: getCandidateSources(tableUnit)[0].sourceId, quote: '2호' },
      ],
    };
    const audits = plan.units.map((u) =>
      u === plan.units[0]
        ? oldAudit
        : audit(u, {
            candidates: u === tableUnit ? [badProposal] : [],
            exclusions: [],
          }),
    );
    const before = structuredClone(audits);
    const retry = await prepareCandidateDiscoveryRetry(plan, audits);
    expect(retry.retryUnitIds).toEqual([tableUnit.unitId]);
    expect(retry.retainedAudits).toEqual(
      audits.filter((a) => a.unitId !== tableUnit.unitId),
    );
    expect(retry.result.completedUnitIds).toHaveLength(plan.units.length - 1);
    const replacement = audit(tableUnit, {
      candidates: [{ ...badProposal, sourceName: '우물' }],
      exclusions: [],
    });
    const result = await assembleCandidateDiscovery(plan, [
      ...retry.retainedAudits,
      replacement,
    ]);
    expect(result.completedUnitIds).toHaveLength(plan.units.length);
    expect(result.issues).toEqual([]);
    expect(result.candidates.map((c) => c.sourceName)).toEqual([
      '우물',
      '우물',
    ]);
    expect(result.candidates[1].sourceIdentifier).toBe('2호');
    expect(audits).toEqual(before);
    const tampered = { ...oldAudit, systemPrompt: replacement.systemPrompt };
    expect(
      (await assembleCandidateDiscovery(plan, [tampered])).issues[0].reason,
    ).toContain('does not match');
    await expect(
      prepareCandidateDiscoveryRetry(plan, [oldAudit]),
    ).rejects.toThrow('complete, replayable');
    await expect(
      prepareCandidateDiscoveryRetry(
        plan,
        plan.units.map((u) => audit(u, { candidates: [], exclusions: [] })),
      ),
    ).rejects.toThrow('No discovery issues');
  });
});

describe('original table identifiers and chapter continuations', () => {
  test('replaces only selected input units while preserving historical v5 audits and checking retry bindings', async () => {
    const plan = prepare();
    const audits = plan.units.map((u) => ({
      ...audit(u, { candidates: [], exclusions: [] }),
      ...createCandidateDiscoveryRequest(u, 'candidate-discovery.v5'),
    }));
    const updated = structuredClone(plan);
    updated.units[0].context.push({ key: 'extra', text: '추가 원문 문맥' });
    updated.units[1].context.push({ key: 'unselected', text: '보존 대상' });
    const before = structuredClone(audits);
    const retry = await prepareCandidateDiscoveryRetry(plan, audits, {
      unitIds: [plan.units[0].unitId],
      updatedPlan: updated,
    });
    expect(retry.plan.units[0]).toEqual(updated.units[0]);
    expect(retry.plan.units[1]).toEqual(plan.units[1]);
    expect(retry.retainedAudits).toEqual(audits.slice(1));
    expect(audits).toEqual(before);
    for (const options of [
      { unitIds: ['missing'] },
      {
        unitIds: [plan.units[0].unitId],
        updatedPlan: { ...updated, inputSha256: 'other' },
      },
      {
        unitIds: [plan.units[0].unitId],
        updatedPlan: { ...updated, scopeChapterId: 'other' },
      },
      {
        unitIds: [plan.units[0].unitId],
        updatedPlan: { ...updated, units: [] },
      },
    ])
      await expect(
        prepareCandidateDiscoveryRetry(plan, audits, options),
      ).rejects.toThrow('matching original');
  });
});
