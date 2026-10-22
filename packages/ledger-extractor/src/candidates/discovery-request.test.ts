import type { LanguageModel } from 'ai';

import { LLMCaller } from '@heripo/shared';
import { describe, expect, test, vi } from 'vitest';

import { prepare, proposal, usage } from './candidate-discovery.test-fixture';
import {
  createCandidateDiscoveryRequest,
  createCandidateDiscoverySchema,
  getCandidateSources,
} from './discovery-request';
import { discoverCandidateUnit } from './discovery-unit';

vi.mock('@heripo/shared', () => ({ LLMCaller: { call: vi.fn() } }));

describe('candidate discovery', () => {
  test('retains prompts, validates the model response schema and propagates model failure', async () => {
    const unit = prepare().units[0];
    const response = { candidates: [], exclusions: [] };
    vi.mocked(LLMCaller.call).mockResolvedValue({
      output: response,
      usage,
      usedFallback: false,
    });
    const result = await discoverCandidateUnit(unit, {
      model: {} as LanguageModel,
      maxRetries: 0,
    });
    expect(result.userPrompt).toBe(
      createCandidateDiscoveryRequest(unit).userPrompt,
    );
    expect(result.response).toEqual(response);
    expect(result.systemPrompt).toContain('THIS investigation');
    expect(LLMCaller.call).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRetries: 0,
        component: 'LedgerCandidateDiscovery',
      }),
    );
    vi.mocked(LLMCaller.call).mockRejectedValue(new Error('model failed'));
    await expect(
      discoverCandidateUnit(unit, {
        model: {} as LanguageModel,
        maxRetries: 0,
      }),
    ).rejects.toThrow('model failed');
  });

  test('presents verbatim source text with unique selectors and constrains model choices to those selectors', () => {
    const unit = prepare().units[0];
    const before = structuredClone(unit);
    const request = createCandidateDiscoveryRequest(unit);
    const payload = JSON.parse(request.userPrompt);
    expect(unit).toEqual(before);
    expect(
      payload.selectableSources.map(
        (source: { sourceId: string; text: string }) => [
          source.sourceId,
          source.text,
        ],
      ),
    ).toEqual([
      ['id:a', '1호 우물'],
      ['id:b', '우물의 독립 본문이다.'],
    ]);
    expect(payload.readOnlyContext).toEqual(
      unit.context.map((block) => ({ text: block.text })),
    );
    const schema = createCandidateDiscoverySchema(unit);
    expect(
      schema.safeParse({ candidates: [proposal(unit)], exclusions: [] })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({
        candidates: [
          {
            ...proposal(unit),
            evidence: [{ sourceId: 'id:not-in-unit', quote: '1호 우물' }],
          },
        ],
        exclusions: [],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        candidates: [],
        exclusions: [{ sourceId: 'path:context-only', reason: 'outside' }],
      }).success,
    ).toBe(false);
    const duplicate = structuredClone(unit);
    duplicate.resources[1].resourceId = duplicate.resources[0].resourceId;
    expect(
      getCandidateSources(duplicate).map((source) => source.sourceId),
    ).toEqual(duplicate.resources.map((resource) => `path:${resource.key}`));
    const tableUnit = prepare().units.find((u) => u.table)!;
    const cell = JSON.parse(
      createCandidateDiscoveryRequest(tableUnit).userPrompt,
    ).selectableSources[0];
    expect(cell.sourceId).toBe(`path:${tableUnit.resources[0].key}`);
    expect(cell.tableCell).toMatchObject({
      tableId: 't',
      rowIndex: 0,
      columnIndex: 0,
      rowSpan: 1,
      colSpan: 1,
    });
    expect(() =>
      createCandidateDiscoverySchema({ ...unit, resources: [] }),
    ).toThrow('no selectable sources');
  });
});
