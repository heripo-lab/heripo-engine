import type { CandidateDiscoveryResponse } from './discovery-types';

import { describe, expect, test } from 'vitest';

import {
  audit,
  pairs,
  registry,
  sections,
} from './candidate-discovery.test-fixture';
import { assembleCandidateDiscovery } from './discovery-assembly';
import {
  CANDIDATE_DISCOVERY_PROMPT_VERSION,
  RECONSIDERED_EXCLUSIONS_RULE,
  SIDE_BY_SIDE_TABLES_RULE,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_V10,
  SYSTEM_PROMPT_V11,
  UNANSWERED_NUMBERED_BLOCKS_RULE,
  UNANSWERED_NUMBERED_BLOCKS_RULE_V15,
  createCandidateDiscoveryRequest,
  isSectionHeading,
} from './discovery-request';
import {
  candidateCheckLevel,
  candidateCorrections,
  headingReconsiderations,
  planCandidateDiscoveryFollowUp,
  unansweredNumberedBlocks,
} from './discovery-validation';

describe('discovery v10 sections, name lead and corrections', () => {
  test('marks the heading section of every body source from v10 only', () => {
    const { unit } = sections();
    const sources = JSON.parse(
      createCandidateDiscoveryRequest(unit).userPrompt,
    ).selectableSources.map(
      (s: { text: string; section: string; sectionHeading: boolean }) => [
        s.text.slice(0, 6),
        s.section,
        s.sectionHeading,
      ],
    );
    const tableSource = JSON.parse(
      createCandidateDiscoveryRequest(registry().unit).userPrompt,
    ).selectableSources[0];

    expect(sources).toEqual([
      ['유구는 조사', 'S0', false],
      ['(1) 1호', 'S1', true],
      ['1호 건물지', 'S1', false],
      ['2024. ', 'S1', false],
      ['21. 호 ', 'S2', true],
      ['96호 수혈', 'S2', false],
    ]);
    expect(
      createCandidateDiscoveryRequest(unit, 'candidate-discovery.v9')
        .userPrompt,
    ).not.toContain('"section"');
    expect(tableSource).not.toHaveProperty('section');
    expect(isSectionHeading(`1. ${'가'.repeat(200)}`)).toBe(false);
    expect(isSectionHeading('가. 조사 경위')).toBe(true);
  });

  test('requires a v10 independent body to name its object at the start of an evidence block', async () => {
    const { plan, unit, body } = sections();
    const ids = Object.fromEntries(
      unit.resources.map((r) => [
        r.data.text.slice(0, 4),
        `id:${r.resourceId}`,
      ]),
    );
    const named = body('호 구연편', '21', ids['21. '], '21. 호 구연편');
    const passing = body('백자', null, ids['96호 '], '백자');
    const assemble = (version?: 'candidate-discovery.v9') =>
      assembleCandidateDiscovery(plan, [
        {
          ...audit(unit, {
            tableRole: 'none',
            candidates: [named, passing],
            exclusions: [],
          }),
          ...(version && createCandidateDiscoveryRequest(unit, version)),
        },
      ]);

    expect(
      (await assemble()).issues.map((i) => [i.candidateIndex, i.reason]),
    ).toEqual([
      [
        1,
        'Independent body candidate is not named at the start of any evidence block',
      ],
    ]);
    expect((await assemble('candidate-discovery.v9')).issues).toEqual([]);
    expect(candidateCheckLevel('candidate-discovery.v5')).toEqual({
      strictTableIdentifier: false,
      v9: false,
      v10: false,
      v11: false,
      v12: false,
      v13: false,
      v14: false,
      v15: false,
    });
  });

  test('asks a v14 body artifact whose block opens with a catalog number for that number', async () => {
    const { plan, unit, body } = sections();
    const ids = Object.fromEntries(
      unit.resources.map((r) => [
        r.data.text.slice(0, 4),
        `id:${r.resourceId}`,
      ]),
    );
    const unnumbered = body('호 구연편', null, ids['21. '], '21. 호 구연편');
    const assemble = (
      version?: 'candidate-discovery.v13' | 'candidate-discovery.v14',
      candidates = [unnumbered],
    ) =>
      assembleCandidateDiscovery(plan, [
        {
          ...audit(unit, {
            tableRole: 'none',
            candidates,
            exclusions: [],
          }),
          ...(version && createCandidateDiscoveryRequest(unit, version)),
        },
      ]);

    expect(
      (await assemble()).issues.map((i) => [i.candidateIndex, i.reason]),
    ).toEqual([
      [
        0,
        'Body artifact block opens with catalog number 21 before its name; copy that number unchanged as sourceIdentifier',
      ],
    ]);
    expect((await assemble('candidate-discovery.v13')).issues).toEqual([]);
    expect(
      (await assemble('candidate-discovery.v14')).issues.map((i) => i.reason),
    ).toEqual([
      'Body artifact block opens with catalog number 21 before its name; copy that number unchanged as sourceIdentifier',
    ]);
    // a later name after the number, or a block without a catalog number, is not asked
    for (const other of [
      body('구연편', null, ids['21. '], '21. 호 구연편'),
      body('백자', null, ids['96호 '], '백자'),
    ])
      expect(
        (await assemble(undefined, [other])).issues.map((i) => i.reason),
      ).not.toContainEqual(expect.stringMatching(/^Body artifact block/));
    expect(
      planCandidateDiscoveryFollowUp(
        unit,
        { tableRole: 'none', candidates: [unnumbered], exclusions: [] },
        'candidate-discovery.v13',
      ),
    ).toBeNull();
    expect(
      planCandidateDiscoveryFollowUp(
        unit,
        { tableRole: 'none', candidates: [unnumbered], exclusions: [] },
        CANDIDATE_DISCOVERY_PROMPT_VERSION,
      )?.corrections,
    ).toHaveLength(1);
    expect(candidateCheckLevel('candidate-discovery.v13')).toMatchObject({
      v13: true,
      v14: false,
    });
  });

  test('lists invalid and repeated-anchor candidates with fixes and plans one follow-up', () => {
    const { unit, body } = sections();
    const ids = Object.fromEntries(
      unit.resources.map((r) => [
        r.data.text.slice(0, 4),
        `id:${r.resourceId}`,
      ]),
    );
    const named = body('호 구연편', '21', ids['21. '], '21. 호 구연편');
    const response = {
      tableRole: 'none' as const,
      candidates: [
        named,
        named,
        body('백자', null, ids['96호 '], '백자'),
        { ...named, sourceIdentifier: '21(도면 5)' },
        { ...named, evidence: [{ sourceId: ids['21. '], quote: '없는 인용' }] },
      ],
      exclusions: [],
    };

    const corrections = candidateCorrections(
      unit,
      response,
      'candidate-discovery.v10',
    );
    const plan = planCandidateDiscoveryFollowUp(
      unit,
      response,
      'candidate-discovery.v10',
    )!;

    expect(corrections.map((c) => [c.candidateIndex, c.issue])).toEqual([
      [1, 'Duplicate anchor in this response'],
      [
        2,
        'Independent body candidate is not named at the start of any evidence block',
      ],
      [3, 'Source identifier is not present in the quoted evidence'],
      [4, 'Evidence does not match an exact input quote in this unit'],
    ]);
    expect(corrections[0].fix).toContain('Quote only the words');
    expect(corrections[1].fix).toContain('names its object at its start');
    expect(corrections[2].fix).toContain('Follow every rule');
    expect(
      candidateCorrections(unit, response, 'candidate-discovery.v9'),
    ).toEqual([]);
    expect(plan.unit).toBe(unit);
    expect(JSON.parse(plan.userPrompt)).toMatchObject({
      unansweredRows: [],
      corrections: [
        { candidate: named, issue: 'Duplicate anchor in this response' },
        {},
        {},
        {},
      ],
    });
    expect(
      planCandidateDiscoveryFollowUp(
        unit,
        { ...response, candidates: [named] },
        'candidate-discovery.v10',
      ),
    ).toBeNull();
    expect(
      planCandidateDiscoveryFollowUp(unit, response, 'candidate-discovery.v8'),
    ).toBeNull();
  });

  test('asks unanswered rows with the version of the first request and lists header and figure fixes', () => {
    const { unit, id, item } = registry();
    const first = {
      tableRole: 'item_table' as const,
      candidates: [
        item('2', '뚜껑'),
        { ...item('3', '삼족기'), sourceName: '유물명', nameSourceId: null },
        {
          ...item('4', '도면 1'),
          sourceIdentifier: '도면 1',
          identifierSourceId: id('도면 1'),
          nameSourceId: null,
          sourceName: '도면 1',
          evidence: [{ sourceId: id('도면 1'), quote: '도면 1' }],
        },
      ],
      exclusions: [],
    };

    const v9 = planCandidateDiscoveryFollowUp(
      unit,
      first,
      'candidate-discovery.v9',
    )!;
    const v10 = planCandidateDiscoveryFollowUp(
      unit,
      first,
      'candidate-discovery.v10',
    )!;

    expect(v9.corrections).toEqual([]);
    expect(v9.rowIndexes).toEqual([5]);
    expect(v9.userPrompt).not.toContain('"section"');
    expect(v10.corrections.map((c) => c.fix)).toEqual([
      expect.stringContaining('never a column header'),
      expect.stringContaining('without circled numerals'),
    ]);
    expect(JSON.parse(v10.userPrompt).unansweredRows).toEqual([5]);
  });
});

describe('assembled v10 corrections', () => {
  test('replaces corrected candidates with the follow-up and rejects a follow-up whose corrections differ', async () => {
    const { plan, unit, body } = sections();
    const ids = Object.fromEntries(
      unit.resources.map((r) => [
        r.data.text.slice(0, 4),
        `id:${r.resourceId}`,
      ]),
    );
    const named = body('호 구연편', '21', ids['21. '], '21. 호 구연편');
    const first = {
      tableRole: 'none' as const,
      candidates: [
        named,
        {
          ...named,
          sourceIdentifier: '21(도면)',
          evidence: [{ sourceId: ids['21. '], quote: '없음' }],
        },
      ],
      exclusions: [],
    };
    const planned = planCandidateDiscoveryFollowUp(
      unit,
      first,
      'candidate-discovery.v10',
    )!;
    const building = body('건물지', '1호', ids['(1) '], '(1) 1호 건물지');
    const followUp = {
      rowIndexes: planned.rowIndexes,
      corrections: planned.corrections,
      userPrompt: planned.userPrompt,
      response: {
        tableRole: 'none' as const,
        candidates: [{ ...building, recordKind: 'feature' as const }],
        exclusions: [],
      },
      usage: audit(unit, first).usage,
    };
    // the sections fixture leaves "96호 수혈" uncited, which v13 would also ask; this test covers corrections only
    const assemble = (overrides: object) =>
      assembleCandidateDiscovery(plan, [
        {
          ...audit(unit, first, 'candidate-discovery.v12'),
          followUp,
          ...overrides,
        },
      ]);

    const merged = await assemble({});
    expect(merged.candidates.map((c) => c.sourceName)).toEqual([
      '호 구연편',
      '건물지',
    ]);
    expect(merged.issues).toEqual([]);
    expect(
      (await assemble({ followUp: { ...followUp, corrections: [] } })).issues[0]
        .reason,
    ).toBe(
      'Saved follow-up does not match the unanswered rows, corrections, reconsidered headings and numbered blocks of this unit',
    );
  });
});

describe('discovery v11 heading reconsideration and row blocks', () => {
  const sectionIds = () => {
    const fixture = sections();
    const ids = Object.fromEntries(
      fixture.unit.resources.map((r) => [
        r.data.text.slice(0, 4),
        `id:${r.resourceId}`,
      ]),
    );
    const exclusion = (
      key: string,
      category: 'passing_mention' | 'previous_or_external' = 'passing_mention',
    ) => ({ sourceId: ids[key], category, reason: '제목' });
    return { ...fixture, ids, exclusion };
  };

  test('reconsiders only excluded headings of a numbered object over descriptive blocks', () => {
    const { unit, exclusion } = sectionIds();
    const response = {
      tableRole: 'none' as const,
      candidates: [],
      exclusions: [
        exclusion('(1) '),
        exclusion('21. '),
        exclusion('유구는 '),
        exclusion('(1) ', 'previous_or_external'),
        { ...exclusion('(1) '), sourceId: 'id:missing' },
      ],
    };
    const headed = structuredClone(unit);
    headed.resources[2].data.text = '(2) 2호 건물지';
    const last = structuredClone(unit);
    last.resources[5].data.text = '(3) 3호 수혈';

    expect(
      headingReconsiderations(unit, response, 'candidate-discovery.v11'),
    ).toEqual([
      {
        exclusionIndex: 0,
        issue:
          'Excluded heading names a numbered object over descriptive blocks',
        fix: expect.stringContaining('"③ 3호 주거지(도면 5)"'),
      },
    ]);
    expect(
      headingReconsiderations(unit, response, 'candidate-discovery.v10'),
    ).toEqual([]);
    expect(
      headingReconsiderations(headed, response, 'candidate-discovery.v11'),
    ).toEqual([]);
    expect(
      headingReconsiderations(
        last,
        {
          ...response,
          exclusions: [
            {
              ...exclusion('96호 '),
              sourceId: `id:${last.resources[5].resourceId}`,
            },
          ],
        },
        'candidate-discovery.v11',
      ),
    ).toEqual([]);
    expect(
      headingReconsiderations(
        registry().unit,
        response,
        'candidate-discovery.v11',
      ),
    ).toEqual([]);
  });

  test('sends reconsidered headings with the whole unit', () => {
    const { unit, exclusion } = sectionIds();
    const response = {
      tableRole: 'none' as const,
      candidates: [],
      exclusions: [exclusion('(1) ')],
    };

    const plan = planCandidateDiscoveryFollowUp(
      unit,
      response,
      'candidate-discovery.v11',
    )!;

    expect(plan.unit).toBe(unit);
    expect(plan.reconsiderations).toHaveLength(1);
    expect(JSON.parse(plan.userPrompt)).toMatchObject({
      corrections: [],
      unansweredRows: [],
      reconsiderExclusions: [{ exclusion: response.exclusions[0] }],
    });
    expect(JSON.parse(plan.userPrompt)).not.toHaveProperty(
      'unansweredRowBlocks',
    );
    expect(
      planCandidateDiscoveryFollowUp(unit, response, 'candidate-discovery.v10'),
    ).toBeNull();
  });

  test('asks unanswered blocks of a side-by-side table with its column blocks', () => {
    const { unit, item } = pairs();
    const left = {
      tableRole: 'item_table' as const,
      candidates: [item(2, 0), item(3, 0), item(4, 0)],
      exclusions: [],
    };
    const corrected = {
      ...left,
      candidates: [
        ...left.candidates,
        { ...item(2, 1), sourceIdentifier: '4(도면 1)' },
      ],
    };

    const narrowed = planCandidateDiscoveryFollowUp(
      unit,
      left,
      'candidate-discovery.v11',
    )!;
    const whole = planCandidateDiscoveryFollowUp(
      unit,
      corrected,
      'candidate-discovery.v11',
    )!;

    const current = planCandidateDiscoveryFollowUp(
      unit,
      left,
      CANDIDATE_DISCOVERY_PROMPT_VERSION,
    )!;

    expect(JSON.parse(narrowed.userPrompt)).not.toHaveProperty('followUpRules');
    expect(JSON.parse(current.userPrompt)).toMatchObject({
      table: { columnBlocks: { count: 2, columnsPerBlock: 3 } },
      followUpRules: [SIDE_BY_SIDE_TABLES_RULE],
    });
    expect(narrowed.rowIndexes).toEqual([2, 3]);
    expect(narrowed.unit.resources).toHaveLength(6);
    expect(JSON.parse(narrowed.userPrompt).table.columnBlocks).toEqual({
      count: 2,
      columnsPerBlock: 3,
    });
    expect(whole.unit).toBe(unit);
    expect(JSON.parse(whole.userPrompt)).toMatchObject({
      table: { columnBlocks: { count: 2, columnsPerBlock: 3 } },
      unansweredRows: [3],
      unansweredRowBlocks: [{ rowIndex: 3, block: 1 }],
    });
    expect(
      planCandidateDiscoveryFollowUp(
        unit,
        { ...left, candidates: [...left.candidates, item(2, 1), item(3, 1)] },
        'candidate-discovery.v11',
      ),
    ).toBeNull();
    expect(
      planCandidateDiscoveryFollowUp(unit, left, 'candidate-discovery.v10'),
    ).toBeNull();
  });
});

describe('assembled v11 follow-ups', () => {
  test('keeps a reconsidered heading object, drops section-body and repeated candidates, and replaces the exclusion', async () => {
    const { plan, unit, body } = sections();
    const ids = Object.fromEntries(
      unit.resources.map((r) => [
        r.data.text.slice(0, 4),
        `id:${r.resourceId}`,
      ]),
    );
    const named = body('호 구연편', '21', ids['21. '], '21. 호 구연편');
    const first = {
      tableRole: 'none' as const,
      candidates: [named],
      exclusions: [
        {
          sourceId: ids['(1) '],
          category: 'passing_mention' as const,
          reason: '제목',
        },
        {
          sourceId: ids['유구는 '],
          category: 'passing_mention' as const,
          reason: '서술',
        },
      ],
    };
    // v12: the uncited "96호 수혈" block would add a v13 numbered-block question to this reconsideration
    const planned = planCandidateDiscoveryFollowUp(
      unit,
      first,
      'candidate-discovery.v12',
    )!;
    const building = {
      ...body('건물지', '1호', ids['(1) '], '(1) 1호 건물지'),
      recordKind: 'feature' as const,
      evidence: [
        { sourceId: ids['(1) '], quote: '(1) 1호 건물지' },
        { sourceId: ids['1호 건'], quote: '1호 건물지는 중앙부에 위치한다.' },
      ],
    };
    const followUp = {
      rowIndexes: planned.rowIndexes,
      reconsiderations: planned.reconsiderations,
      userPrompt: planned.userPrompt,
      response: {
        tableRole: 'none' as const,
        candidates: [
          building,
          {
            ...body('건물지', null, ids['1호 건'], '1호 건물지'),
            recordKind: 'feature' as const,
          },
          named,
          { ...named, evidence: [{ sourceId: ids['21. '], quote: '없음' }] },
        ],
        exclusions: [],
      },
      usage: audit(unit, first).usage,
    };

    const merged = await assembleCandidateDiscovery(plan, [
      { ...audit(unit, first, 'candidate-discovery.v12'), followUp },
    ]);
    const mismatched = await assembleCandidateDiscovery(plan, [
      {
        ...audit(unit, first, 'candidate-discovery.v12'),
        followUp: { ...followUp, reconsiderations: [] },
      },
    ]);

    expect(merged.candidates.map((c) => c.sourceName)).toEqual([
      '호 구연편',
      '건물지',
    ]);
    expect(merged.issues.map((i) => i.reason)).toEqual([
      'Evidence does not match an exact input quote in this unit',
    ]);
    expect(JSON.parse(planned.userPrompt).followUpRules).toEqual([
      RECONSIDERED_EXCLUSIONS_RULE,
    ]);
    expect(merged.exclusions.map((e) => e.sourceId)).toEqual([ids['유구는 ']]);
    expect(mismatched.issues[0].reason).toBe(
      'Saved follow-up does not match the unanswered rows, corrections, reconsidered headings and numbered blocks of this unit',
    );
  });

  test('reports unanswered row blocks and merges a block follow-up', async () => {
    const { plan, unit, item } = pairs();
    const first = {
      tableRole: 'item_table' as const,
      candidates: [item(2, 0), item(3, 0), item(4, 0)],
      exclusions: [],
    };
    const planned = planCandidateDiscoveryFollowUp(
      unit,
      first,
      CANDIDATE_DISCOVERY_PROMPT_VERSION,
    )!;

    const missing = await assembleCandidateDiscovery(plan, [
      audit(unit, first),
    ]);
    const merged = await assembleCandidateDiscovery(plan, [
      {
        ...audit(unit, first),
        followUp: {
          rowIndexes: planned.rowIndexes,
          rowBlocks: planned.rowBlocks,
          userPrompt: planned.userPrompt,
          response: {
            tableRole: 'item_table' as const,
            candidates: [item(2, 1), item(3, 1)],
            exclusions: [],
          },
          usage: audit(unit, first).usage,
        },
      },
    ]);

    expect(missing.issues.map((i) => i.reason)).toEqual([
      'Table row blocks neither proposed nor excluded with a row-level category: 2:1, 3:1',
    ]);
    expect(merged.candidates.map((c) => c.sourceIdentifier)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(merged.issues).toEqual([]);
  });

  test('replays v10 and v11 audits with their own prompts and follow-ups', async () => {
    const { plan, unit, body } = sections();
    const ids = Object.fromEntries(
      unit.resources.map((r) => [
        r.data.text.slice(0, 4),
        `id:${r.resourceId}`,
      ]),
    );
    const named = body('호 구연편', '21', ids['21. '], '21. 호 구연편');
    const first = {
      tableRole: 'none' as const,
      candidates: [named, { ...named, sourceIdentifier: '21(도면)' }],
      exclusions: [
        {
          sourceId: ids['(1) '],
          category: 'passing_mention' as const,
          reason: '제목',
        },
      ],
    };
    const v10 = createCandidateDiscoveryRequest(
      unit,
      'candidate-discovery.v10',
    );
    const planned = planCandidateDiscoveryFollowUp(
      unit,
      first,
      'candidate-discovery.v10',
    )!;

    const v11 = createCandidateDiscoveryRequest(
      unit,
      'candidate-discovery.v11',
    );
    const planned11 = planCandidateDiscoveryFollowUp(
      unit,
      first,
      'candidate-discovery.v11',
    )!;
    const replayed11 = await assembleCandidateDiscovery(plan, [
      {
        ...audit(unit, first),
        ...v11,
        followUp: {
          rowIndexes: planned11.rowIndexes,
          corrections: planned11.corrections,
          reconsiderations: planned11.reconsiderations,
          userPrompt: planned11.userPrompt,
          response: {
            tableRole: 'none' as const,
            candidates: [named],
            exclusions: [],
          },
          usage: audit(unit, first).usage,
        },
      },
    ]);
    const result = await assembleCandidateDiscovery(plan, [
      {
        ...audit(unit, first),
        ...v10,
        followUp: {
          rowIndexes: planned.rowIndexes,
          corrections: planned.corrections,
          userPrompt: planned.userPrompt,
          response: {
            tableRole: 'none' as const,
            candidates: [named],
            exclusions: [],
          },
          usage: audit(unit, first).usage,
        },
      },
    ]);

    expect(v10.systemPrompt).toBe(SYSTEM_PROMPT_V10);
    expect(SYSTEM_PROMPT).toBe(SYSTEM_PROMPT_V10);
    expect(v11.systemPrompt).toBe(SYSTEM_PROMPT_V11);
    expect(SYSTEM_PROMPT_V11).toContain(`- ${RECONSIDERED_EXCLUSIONS_RULE}`);
    expect(SYSTEM_PROMPT_V11).toContain(`- ${SIDE_BY_SIDE_TABLES_RULE}`);
    expect(planned11.reconsiderations).toHaveLength(1);
    expect(JSON.parse(planned11.userPrompt)).not.toHaveProperty(
      'followUpRules',
    );
    expect(replayed11.candidates.map((c) => c.sourceName)).toEqual([
      '호 구연편',
    ]);
    expect(replayed11.issues).toEqual([]);
    expect(planned.reconsiderations).toEqual([]);
    expect(result.issues.map((i) => i.reason)).toEqual([
      expect.stringContaining('Duplicate anchor requires review'),
    ]);
    expect(result.exclusions).toHaveLength(1);
  });
});

describe('discovery v15 repeated proposals', () => {
  test('keeps an identical repeated proposal once and still reports a different one at the same anchor', async () => {
    const { plan, unit, body } = sections();
    const ids = Object.fromEntries(
      unit.resources.map((r) => [
        r.data.text.slice(0, 4),
        `id:${r.resourceId}`,
      ]),
    );
    const named = body('호 구연편', '21', ids['21. '], '21. 호 구연편');
    const assemble = (
      candidates: CandidateDiscoveryResponse['candidates'],
      version?: 'candidate-discovery.v14',
    ) =>
      assembleCandidateDiscovery(plan, [
        {
          ...audit(unit, { tableRole: 'none', candidates, exclusions: [] }),
          ...(version && createCandidateDiscoveryRequest(unit, version)),
        },
      ]);

    const repeated = await assemble([named, named]);
    expect(repeated.issues).toEqual([]);
    expect(repeated.candidates).toHaveLength(1);
    expect(
      (await assemble([named, { ...named, sourceName: '구연편' }])).issues.map(
        (i) => i.reason,
      ),
    ).toEqual([expect.stringContaining('Duplicate anchor requires review')]);
    expect(
      (await assemble([named, named], 'candidate-discovery.v14')).issues.map(
        (i) => i.reason,
      ),
    ).toEqual([expect.stringContaining('Duplicate anchor requires review')]);
  });
});

describe('discovery v13 numbered body blocks', () => {
  const setup = () => {
    const { plan, unit, body } = sections();
    const ids = Object.fromEntries(
      unit.resources.map((r) => [
        r.data.text.slice(0, 4),
        `id:${r.resourceId}`,
      ]),
    );
    const building = body('건물지', '1호', ids['(1) '], '(1) 1호 건물지');
    const first: CandidateDiscoveryResponse = {
      tableRole: 'none',
      candidates: [building],
      exclusions: [],
    };
    return { plan, unit, body, ids, building, first };
  };

  test('finds uncited body blocks that open with a number of a proposed identifier form', () => {
    const { unit, body, ids, building, first } = setup();
    const current = CANDIDATE_DISCOVERY_PROMPT_VERSION;
    const withCandidates = (
      candidates: (typeof first)['candidates'],
      exclusions: (typeof first)['exclusions'] = [],
    ) =>
      unansweredNumberedBlocks(
        unit,
        { ...first, candidates, exclusions },
        current,
      );

    // "1호 건물지는" opens with a number a candidate uses; "2024. 12. 16" and "21. 호" do not match "N호"
    expect(unansweredNumberedBlocks(unit, first, current)).toEqual([
      { sourceId: ids['96호 '], number: '96호' },
    ]);
    // an unnumbered candidate beside a numbered one adds no form and no number
    expect(
      withCandidates([building, body('백자', null, ids['21. '], '21. 호')]),
    ).toEqual([{ sourceId: ids['96호 '], number: '96호' }]);
    expect(
      unansweredNumberedBlocks(unit, first, 'candidate-discovery.v12'),
    ).toEqual([]);
    expect(
      withCandidates(
        [building],
        [
          {
            sourceId: ids['96호 '],
            category: 'passing_mention',
            reason: '언급',
          },
        ],
      ),
    ).toEqual([]);
    // identifiers without both a digit and a letter give no form to look for
    expect(
      withCandidates([
        body('호 구연편', '21', ids['21. '], '21. 호 구연편'),
        body('백자', null, ids['96호 '], '백자'),
        body('호 구연편', '호', ids['21. '], '21. 호 구연편'),
      ]),
    ).toEqual([]);
    expect(
      unansweredNumberedBlocks(
        registry().unit,
        { tableRole: 'item_table', candidates: [building], exclusions: [] },
        current,
      ),
    ).toEqual([]);
  });

  test('also finds uncited blocks that open with a numbered area label from v15', () => {
    const { unit, ids } = setup();
    const area = unit.resources.find(
      (r) => `id:${r.resourceId}` === ids['21. '],
    )!;
    area.data.text = '23-4구역은 3구역과 같은 양상이며 백자가 출수되었다.';
    const none = { tableRole: 'none' as const, candidates: [], exclusions: [] };

    expect(
      unansweredNumberedBlocks(unit, none, CANDIDATE_DISCOVERY_PROMPT_VERSION),
    ).toEqual([{ sourceId: ids['21. '], number: '23-4구역' }]);
    expect(
      unansweredNumberedBlocks(unit, none, 'candidate-discovery.v14'),
    ).toEqual([]);
  });

  test('asks the numbered blocks in a whole-unit follow-up with its rule', () => {
    const { unit, ids, first } = setup();

    const planned = planCandidateDiscoveryFollowUp(
      unit,
      first,
      CANDIDATE_DISCOVERY_PROMPT_VERSION,
    )!;
    const input = JSON.parse(planned.userPrompt);

    expect(planned.numberedBlocks).toEqual([
      { sourceId: ids['96호 '], number: '96호' },
    ]);
    expect(planned.unit).toBe(unit);
    expect(input.unansweredNumberedBlocks).toEqual(planned.numberedBlocks);
    expect(input.followUpRules).toEqual([UNANSWERED_NUMBERED_BLOCKS_RULE_V15]);
    expect(
      JSON.parse(
        planCandidateDiscoveryFollowUp(unit, first, 'candidate-discovery.v14')!
          .userPrompt,
      ).followUpRules,
    ).toEqual([UNANSWERED_NUMBERED_BLOCKS_RULE]);
    expect(input).not.toHaveProperty('reconsiderExclusions');
    expect(
      planCandidateDiscoveryFollowUp(unit, first, 'candidate-discovery.v12'),
    ).toBeNull();
  });

  test('merges the answer to numbered blocks and reports blocks left unanswered', async () => {
    const { plan, unit, ids, first } = setup();
    const planned = planCandidateDiscoveryFollowUp(
      unit,
      first,
      CANDIDATE_DISCOVERY_PROMPT_VERSION,
    )!;
    const followUp = {
      rowIndexes: planned.rowIndexes,
      numberedBlocks: planned.numberedBlocks,
      userPrompt: planned.userPrompt,
      response: {
        tableRole: 'none' as const,
        candidates: [],
        exclusions: [
          {
            sourceId: ids['96호 '],
            category: 'passing_mention' as const,
            reason: '출토 위치 언급',
          },
        ],
      },
      usage: audit(unit, first).usage,
    };
    const assemble = (overrides: object) =>
      assembleCandidateDiscovery(plan, [
        { ...audit(unit, first), ...overrides },
      ]);

    const merged = await assemble({ followUp });
    const unasked = await assemble({});
    const mismatched = await assemble({
      followUp: { ...followUp, numberedBlocks: [] },
    });

    expect(merged.issues).toEqual([]);
    expect(merged.candidates.map((c) => c.sourceName)).toEqual(['건물지']);
    expect(unasked.issues.map((i) => i.reason)).toEqual([
      'Numbered body blocks neither proposed nor excluded: 96호',
    ]);
    expect(mismatched.issues[0].reason).toBe(
      'Saved follow-up does not match the unanswered rows, corrections, reconsidered headings and numbered blocks of this unit',
    );
  });
});
