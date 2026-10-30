import type { LanguageModel } from 'ai';

import { LLMCaller } from '@heripo/shared';
import { describe, expect, test, vi } from 'vitest';

import {
  pairs,
  prepare,
  proposal,
  registry,
  sections,
  usage,
} from './candidate-discovery.test-fixture';
import {
  createCandidateDiscoveryRequest,
  createCandidateDiscoverySchema,
  getCandidateSources,
} from './discovery-request';
import { createFollowUpUnit } from './discovery-rows';
import {
  createCandidateDiscoveryUnitCall,
  discoverCandidateUnit,
  recordCandidateDiscoveryUnit,
} from './discovery-unit';

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
    expect(result).not.toHaveProperty('finishReason');
    expect(result).not.toHaveProperty('structuredAttempts');
    expect(result.systemPrompt).toContain('THIS investigation');
    expect(result.systemPrompt).toContain(
      'ITEM TABLES ARE ANSWERED ROW BY ROW',
    );
    expect(
      createCandidateDiscoveryRequest(unit, 'candidate-discovery.v7')
        .systemPrompt,
    ).not.toContain('ITEM TABLES ARE ANSWERED ROW BY ROW');
    expect(result.systemPrompt).toContain('EVERY EXCLUSION TAKES ONE category');
    expect(
      createCandidateDiscoveryRequest(unit, 'candidate-discovery.v8')
        .systemPrompt,
    ).not.toContain('EVERY EXCLUSION TAKES ONE category');
    vi.mocked(LLMCaller.call).mockResolvedValue({
      output: response,
      usage: { ...usage, reasoningTokens: 1 },
      usedFallback: false,
      finishReason: 'stop',
      structuredAttempts: 2,
    });
    expect(
      await discoverCandidateUnit(unit, {
        model: {} as LanguageModel,
        maxRetries: 0,
      }),
    ).toMatchObject({
      finishReason: 'stop',
      structuredAttempts: 2,
      usage: { reasoningTokens: 1 },
    });
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
    const valid = (response: object) => schema.safeParse(response).success;
    const current = { ...proposal(unit), nameSourceId: null };
    expect(
      valid({ tableRole: 'none', candidates: [current], exclusions: [] }),
    ).toBe(true);
    expect(
      valid({ tableRole: 'item_table', candidates: [current], exclusions: [] }),
    ).toBe(false);
    expect(
      valid({
        tableRole: 'none',
        candidates: [],
        exclusions: [{ sourceId: 'id:a', reason: '분류 없음' }],
      }),
    ).toBe(false);
    expect(
      valid({
        tableRole: 'none',
        candidates: [],
        exclusions: [
          { sourceId: 'id:a', category: 'passing_mention', reason: '언급' },
        ],
      }),
    ).toBe(true);
    const tableSchema = createCandidateDiscoverySchema(
      prepare().units.find((u) => u.table)!,
    );
    expect(
      tableSchema.safeParse({
        tableRole: 'none',
        candidates: [],
        exclusions: [],
      }).success,
    ).toBe(false);
    expect(
      tableSchema.safeParse({
        tableRole: 'non_item_table',
        candidates: [],
        exclusions: [],
      }).success,
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

  test('asks the unanswered item-table rows once more and keeps both calls in the audit', async () => {
    const { unit, id, item } = registry();
    const first = {
      tableRole: 'item_table' as const,
      candidates: [item('2', '뚜껑')],
      exclusions: [
        {
          sourceId: id('합계'),
          category: 'summary_row' as const,
          reason: '합계',
        },
      ],
    };
    const second = {
      tableRole: 'item_table' as const,
      candidates: [item('3', '삼족기')],
      exclusions: [],
    };
    vi.mocked(LLMCaller.call)
      .mockResolvedValueOnce({ output: first, usage, usedFallback: false })
      .mockResolvedValueOnce({
        output: second,
        usage: { ...usage, reasoningTokens: 2 },
        usedFallback: false,
        finishReason: 'stop',
        structuredAttempts: 2,
      });
    const options = { model: {} as LanguageModel, maxRetries: 0 };

    const result = await discoverCandidateUnit(unit, options);

    expect(LLMCaller.call).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userPrompt: createCandidateDiscoveryRequest(
          createFollowUpUnit(unit, [3, 4]),
        ).userPrompt,
        cacheSystemPrompt: true,
        metadata: expect.objectContaining({ followUp: true }),
      }),
    );
    expect(result.response).toEqual(first);
    expect(result).toMatchObject({
      usage: {
        inputTokens: 2,
        outputTokens: 4,
        totalTokens: 6,
        reasoningTokens: 2,
      },
      structuredAttempts: 3,
      followUp: {
        rowIndexes: [3, 4],
        response: second,
        usage: { reasoningTokens: 2 },
        finishReason: 'stop',
        structuredAttempts: 2,
      },
    });
    vi.mocked(LLMCaller.call)
      .mockResolvedValueOnce({
        output: first,
        usage: { ...usage, reasoningTokens: 1 },
        usedFallback: false,
      })
      .mockResolvedValueOnce({ output: second, usage, usedFallback: false });
    expect(
      (await discoverCandidateUnit(unit, options)).usage.reasoningTokens,
    ).toBe(1);
    vi.mocked(LLMCaller.call)
      .mockResolvedValueOnce({ output: first, usage, usedFallback: false })
      .mockResolvedValueOnce({ output: second, usage, usedFallback: false });
    const plain = await discoverCandidateUnit(unit, options);
    expect(plain.usage).not.toHaveProperty('reasoningTokens');
    expect(plain.structuredAttempts).toBe(2);
    expect(plain.followUp).not.toHaveProperty('finishReason');
    expect(plain.followUp).not.toHaveProperty('structuredAttempts');
  });

  test('records calls made elsewhere and refuses a missing or unneeded follow-up', () => {
    const { unit, id, item } = registry();
    const first = {
      tableRole: 'item_table' as const,
      candidates: [item('2', '뚜껑')],
      exclusions: [
        {
          sourceId: id('합계'),
          category: 'summary_row' as const,
          reason: '합계',
        },
      ],
    };
    const done = {
      tableRole: 'item_table' as const,
      candidates: [item('2', '뚜껑'), item('3', '삼족기'), item('4', '기대')],
      exclusions: first.exclusions,
    };

    expect(createCandidateDiscoveryUnitCall(unit).userPrompt).toBe(
      createCandidateDiscoveryRequest(unit).userPrompt,
    );
    expect(() =>
      recordCandidateDiscoveryUnit(unit, { output: first, usage }),
    ).toThrow(`Unit ${unit.unitId} needs its follow-up call`);
    expect(() =>
      recordCandidateDiscoveryUnit(
        unit,
        { output: done, usage },
        { output: done, usage },
      ),
    ).toThrow(`Unit ${unit.unitId} needs no follow-up call`);
    expect(
      recordCandidateDiscoveryUnit(unit, { output: done, usage }).followUp,
    ).toBeUndefined();
  });

  test('sends invalid candidates back once with the whole unit and records the corrections', async () => {
    const { unit, body } = sections();
    const ids = Object.fromEntries(
      unit.resources.map((r) => [
        r.data.text.slice(0, 4),
        `id:${r.resourceId}`,
      ]),
    );
    const first = {
      tableRole: 'none' as const,
      candidates: [body('백자', null, ids['96호 '], '백자')],
      exclusions: [],
    };
    const second = {
      tableRole: 'none' as const,
      candidates: [],
      exclusions: [
        {
          sourceId: ids['96호 '],
          category: 'passing_mention' as const,
          reason: '나열',
        },
      ],
    };
    vi.mocked(LLMCaller.call)
      .mockResolvedValueOnce({ output: first, usage, usedFallback: false })
      .mockResolvedValueOnce({ output: second, usage, usedFallback: false });

    const result = await discoverCandidateUnit(unit, {
      model: {} as LanguageModel,
      maxRetries: 0,
    });

    expect(result.followUp?.corrections).toEqual([
      expect.objectContaining({ candidateIndex: 0 }),
    ]);
    expect(JSON.parse(result.followUp!.userPrompt).corrections).toHaveLength(1);
  });

  test('records asked row blocks and reconsidered headings of a v11 follow-up', async () => {
    const table = pairs();
    const left = {
      tableRole: 'item_table' as const,
      candidates: [table.item(2, 0), table.item(3, 0), table.item(4, 0)],
      exclusions: [],
    };
    const { unit } = sections();
    const heading = {
      tableRole: 'none' as const,
      candidates: [],
      exclusions: [
        {
          sourceId: getCandidateSources(unit)[1].sourceId,
          category: 'passing_mention' as const,
          reason: '제목',
        },
      ],
    };
    const empty = { candidates: [], exclusions: [] };
    vi.mocked(LLMCaller.call)
      .mockResolvedValueOnce({ output: left, usage, usedFallback: false })
      .mockResolvedValueOnce({ output: empty, usage, usedFallback: false })
      .mockResolvedValueOnce({ output: heading, usage, usedFallback: false })
      .mockResolvedValueOnce({ output: empty, usage, usedFallback: false });
    const options = { model: {} as LanguageModel, maxRetries: 0 };

    const blocks = await discoverCandidateUnit(table.unit, options);
    const headings = await discoverCandidateUnit(unit, options);

    expect(blocks.followUp).toMatchObject({
      rowIndexes: [2, 3],
      rowBlocks: [
        { rowIndex: 2, block: 1 },
        { rowIndex: 3, block: 1 },
      ],
    });
    expect(blocks.followUp).not.toHaveProperty('reconsiderations');
    expect(headings.followUp?.reconsiderations).toEqual([
      expect.objectContaining({ exclusionIndex: 0 }),
    ]);
    expect(headings.followUp).not.toHaveProperty('rowBlocks');
  });

  test('records the numbered body blocks a v13 follow-up asks', async () => {
    const { unit, body } = sections();
    const [heading] = getCandidateSources(unit).slice(1);
    const first = {
      tableRole: 'none' as const,
      candidates: [body('건물지', '1호', heading.sourceId, '(1) 1호 건물지')],
      exclusions: [],
    };
    const empty = {
      tableRole: 'none' as const,
      candidates: [],
      exclusions: [],
    };
    vi.mocked(LLMCaller.call)
      .mockResolvedValueOnce({ output: first, usage, usedFallback: false })
      .mockResolvedValueOnce({ output: empty, usage, usedFallback: false });

    const result = await discoverCandidateUnit(unit, {
      model: {} as LanguageModel,
      maxRetries: 0,
    });

    expect(result.followUp?.numberedBlocks).toEqual([
      { sourceId: getCandidateSources(unit)[5].sourceId, number: '96호' },
    ]);
    expect(result.followUp).not.toHaveProperty('corrections');
  });
});
