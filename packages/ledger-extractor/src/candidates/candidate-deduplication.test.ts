import type { LanguageModel } from 'ai';

import type { CandidateDeduplicationAudit } from './candidate-deduplication';
import type {
  CandidateDiscoveryPlan,
  CandidateDiscoveryResult,
  LedgerObjectCandidate,
} from './discovery-types';

import { LLMCaller } from '@heripo/shared';
import { describe, expect, test, vi } from 'vitest';

import {
  CANDIDATE_DEDUPLICATION_UNMERGED_REASON,
  assembleCandidateDeduplication,
  createCandidateDeduplicationRequest,
  deduplicateCandidates,
  getCandidateGroupMembers,
  groupCandidateUncertainties,
} from './candidate-deduplication';

vi.mock('@heripo/shared', () => ({ LLMCaller: { call: vi.fn() } }));
const usage = {
  component: 'test',
  phase: 'test',
  model: 'primary' as const,
  modelName: 'mock',
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
};
const candidate = (
  id: string,
  recordKind: LedgerObjectCandidate['recordKind'] = 'feature',
): LedgerObjectCandidate => ({
  candidateId: id,
  recordKind,
  status: 'proposed',
  sourceName: '우물',
  sourceIdentifier: null,
  eligibilityBasis: 'independent_body',
  reason: '원문',
  chapterId: 'ch',
  unitIds: ['u'],
  evidence: [
    {
      sourceId: 'id:t',
      resourceKey: '/t',
      resourceId: 't',
      sourceRefs: ['#/texts/1'],
      quote: '원문 그대로',
      pdfPageNo: 1,
      logicalPageRange: { startPageNo: 0, endPageNo: 0 },
      charStart: 0,
      charEnd: 6,
    },
  ],
});
const plan: CandidateDiscoveryPlan = {
  scopeChapterId: 'ch',
  scopeTitle: '조사내용',
  inputSha256: 'hash',
  units: [
    {
      unitId: 'u',
      chapterId: 'ch',
      chapterPath: [{ id: 'ch', originTitle: '백제' }],
      table: null,
      context: [],
      resources: [
        {
          kind: 'text',
          key: '/t',
          resourceId: 't',
          sourceRefs: [],
          chapterIds: ['ch'],
          pdfPageNo: 1,
          logicalPageRange: null,
          data: { text: '원문 그대로', pdfPageNo: 1 },
        },
        {
          kind: 'tableCell',
          key: '/cell',
          resourceId: null,
          sourceRefs: [],
          chapterIds: ['ch'],
          pdfPageNo: 1,
          logicalPageRange: null,
          tableId: 'tb',
          rowIndex: 0,
          columnIndex: 0,
          data: { text: '호수', rowSpan: 1, colSpan: 1, isHeader: true },
        },
        {
          kind: 'tableCell',
          key: '/other',
          resourceId: null,
          sourceRefs: [],
          chapterIds: ['ch'],
          pdfPageNo: 1,
          logicalPageRange: null,
          tableId: 'tb',
          rowIndex: 1,
          columnIndex: 0,
          data: {
            text: '관계없는 행',
            rowSpan: 1,
            colSpan: 1,
            isHeader: false,
          },
        },
      ],
    },
  ],
};
const discovery = (): CandidateDiscoveryResult => ({
  version: 'ledger-object-candidates.v1',
  inputSha256: 'hash',
  scopeChapterId: 'ch',
  scopeTitle: '조사내용',
  candidates: [candidate('a'), candidate('b'), candidate('c')],
  issues: [],
  exclusions: [],
  completedUnitIds: ['u'],
  totalUnits: 1,
  inspectedResourceCount: 3,
});
const response = () => ({
  groups: [
    { members: ['C1', 'C2'], reason: '본문과 표의 같은 우물' },
    { members: ['C3'], reason: '별개 대상' },
  ],
  uncertainMatches: [{ left: 'C2', right: 'C3', reason: '번호만 같음' }],
});
type FlatAudit = Omit<CandidateDeduplicationAudit, 'response'> & {
  response: ReturnType<typeof response>;
};
/** A saved v5 audit: flat groups, replayed with its own prompt. */
const audit = (d = discovery()): FlatAudit => ({
  ...createCandidateDeduplicationRequest(plan, d, 'candidate-deduplication.v5'),
  response: response(),
  usage,
});
const byKind = () => ({
  groupsByKind: {
    feature: [
      { members: ['C1', 'C2'], reason: '본문과 표의 같은 우물' },
      { members: ['C3'], reason: '별개 대상' },
    ],
  },
  uncertainMatches: [{ left: 'C2', right: 'C3', reason: '번호만 같음' }],
});
const merges = () => ({
  mergesByKind: {
    feature: [{ members: ['C1', 'C2'], reason: '본문과 표의 같은 우물' }],
  },
  uncertainMatches: [{ left: 'C2', right: 'C3', reason: '번호만 같음' }],
});

describe('whole-pool candidate deduplication', () => {
  test('preserves every original occurrence and partitions the complete pool without rewriting text', () => {
    const d = discovery();
    const before = structuredClone(d);
    const result = assembleCandidateDeduplication(plan, d, audit(d));
    expect(result.issues).toEqual([]);
    expect(result.groups.map((g) => g.memberCandidateIds)).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
    expect(result.uncertainMatches[0].leftCandidateId).toBe('b');
    expect(getCandidateGroupMembers(result.groups[0], d.candidates)).toEqual(
      d.candidates.slice(0, 2),
    );
    expect(d).toEqual(before);
    expect(() => getCandidateGroupMembers(result.groups[0], [])).toThrow(
      'Missing original candidate',
    );
  });
  test('binds full context and selected table rows, and refuses incomplete or mismatched discovery', () => {
    const d = discovery();
    d.candidates[0].evidence[0].resourceKey = '/cell';
    const request = JSON.parse(
      createCandidateDeduplicationRequest(plan, d).userPrompt,
    );
    expect(request.units[0].sources.map((s: { key: string }) => s.key)).toEqual(
      ['/t', '/cell'],
    );
    expect(request.units[0].chapterPath).toEqual(plan.units[0].chapterPath);
    expect(request).not.toHaveProperty('scopeChapterIds');
    const scopes = ['ch', 'ch2'];
    expect(
      JSON.parse(
        createCandidateDeduplicationRequest(
          { ...plan, scopeChapterIds: scopes },
          { ...d, scopeChapterIds: scopes },
        ).userPrompt,
      ).scopeChapterIds,
    ).toEqual(scopes);
    for (const change of [
      { inputSha256: 'other' },
      { scopeChapterId: 'other' },
      { scopeChapterIds: ['ch', 'other'] },
      { completedUnitIds: [] },
      { completedUnitIds: ['wrong'] },
    ])
      expect(() =>
        createCandidateDeduplicationRequest(plan, { ...d, ...change }),
      ).toThrow('completed discovery');
  });
  test('rejects missing, repeated, unknown, cross-kind assignments and invalid uncertainty atomically', () => {
    const d = discovery();
    d.candidates[2].recordKind = 'layer';
    const a = audit(d);
    a.response.groups = [
      { members: ['C1', 'C1', 'C3', 'C9'], reason: 'invalid' },
    ];
    a.response.uncertainMatches = [
      { left: 'C1', right: 'C3', reason: 'already merged' },
      { left: 'C1', right: 'C9', reason: 'unknown right' },
      { left: 'C9', right: 'C2', reason: 'unknown left' },
    ];
    const result = assembleCandidateDeduplication(plan, d, a);
    expect(result.groups).toEqual([]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'Missing candidate ref: C2',
        'Repeated candidate ref: C1',
        'Unknown candidate ref: C9',
        'Group 1 mixes record kinds',
        'Invalid uncertain match: C1, C3',
      ]),
    );
  });
  test('retains rejected audit responses without repair and detects stale request bindings', () => {
    const d = discovery();
    for (const field of [
      'promptVersion',
      'systemPrompt',
      'userPrompt',
    ] as const) {
      const a = audit(d);
      a[field] = 'stale';
      expect(assembleCandidateDeduplication(plan, d, a).issues[0]).toContain(
        'does not match',
      );
    }
    const a = audit(d);
    a.response.groups[0].members = [];
    expect(assembleCandidateDeduplication(plan, d, a).issues).toEqual([
      'Invalid deduplication response schema',
    ]);
    expect(a.response.groups[0].members).toEqual([]);
  });
  test('makes one structured call for the entire pool and exposes exact prompts and response', async () => {
    vi.mocked(LLMCaller.call).mockResolvedValue({
      output: merges(),
      usage,
      usedFallback: false,
    });
    const d = discovery();
    d.candidates[2].recordKind = 'layer';
    const result = await deduplicateCandidates(plan, d, {
      model: {} as LanguageModel,
      maxRetries: 0,
    });
    const call = vi.mocked(LLMCaller.call).mock.calls[0][0];
    const valid = {
      mergesByKind: {
        feature: [{ members: ['C1', 'C2'], reason: '같은 우물' }],
        layer: [],
      },
      uncertainMatches: [{ left: 'C2', right: 'C3', reason: '확인 필요' }],
    };
    expect(call.schema.safeParse(valid).success).toBe(true);
    for (const mergesByKind of [
      { feature: [{ members: ['C1', 'C3'], reason: 'cross kind' }], layer: [] },
      { feature: [{ members: ['C1', 'C9'], reason: 'unknown' }], layer: [] },
      { feature: [{ members: ['C1'], reason: 'alone' }], layer: [] },
      { feature: [] },
    ])
      expect(
        call.schema.safeParse({ mergesByKind, uncertainMatches: [] }).success,
      ).toBe(false);
    expect(result.response).toEqual(merges());
    expect(result.promptVersion).toBe('candidate-deduplication.v7');
    expect(result.systemPrompt).toContain('MERGES STAY WITHIN ONE RECORD KIND');
    expect(result.systemPrompt).toContain('Return only merges');
    for (const partition of [
      'Return a complete partition',
      'Keep all candidates exactly once in the partition',
      'Keep the complete partition',
    ])
      expect(result.systemPrompt).not.toContain(partition);
    expect(JSON.parse(result.userPrompt).candidates).toHaveLength(3);
    await expect(
      deduplicateCandidates(
        plan,
        { ...d, candidates: [] },
        { model: {} as LanguageModel, maxRetries: 0 },
      ),
    ).rejects.toThrow('No candidates');
  });
});

test('adds full-source layer and identity-conflict review while replaying immutable v3 partitions', () => {
  const d = discovery();
  d.candidates.forEach((c) => {
    c.recordKind = 'layer';
    c.evidence[0].quote = '원문';
  });
  const fullPlan = structuredClone(plan);
  fullPlan.units[0].resources[0].data.text =
    '원문 그대로: 정의된 층은 동측 사면부의 풍화암반에 해당한다.';
  const oldRequest = createCandidateDeduplicationRequest(
      fullPlan,
      d,
      'candidate-deduplication.v3',
    ),
    current = createCandidateDeduplicationRequest(
      fullPlan,
      d,
      'candidate-deduplication.v5',
    ),
    oldAudit = { ...oldRequest, response: response(), usage },
    newAudit = { ...current, response: response(), usage },
    before = structuredClone({ d, fullPlan, oldAudit, newAudit });
  expect(current.userPrompt).toBe(oldRequest.userPrompt);
  expect(JSON.parse(current.userPrompt).units[0].sources[0].text).toBe(
    fullPlan.units[0].resources[0].data.text,
  );
  expect(current.systemPrompt).toContain('FULL-SOURCE LAYER IDENTITY REVIEW');
  expect(current.systemPrompt).toContain(
    'RELATIONS ARE NOT IDENTITY UNCERTAINTY',
  );
  expect(current.systemPrompt).toContain('FINAL CONFLICT AND COVERAGE AUDIT');
  expect(oldRequest.systemPrompt).not.toContain(
    'FULL-SOURCE LAYER IDENTITY REVIEW',
  );
  const historical = assembleCandidateDeduplication(fullPlan, d, oldAudit),
    result = assembleCandidateDeduplication(fullPlan, d, newAudit);
  expect(result.issues).toEqual([]);
  expect(result).toEqual(historical);
  expect(result.uncertainMatches).toHaveLength(1);
  expect(
    getCandidateGroupMembers(result.groups[0], d.candidates)[0].evidence[0]
      .quote,
  ).toBe('원문');
  expect({ d, fullPlan, oldAudit, newAudit }).toEqual(before);
  expect(
    assembleCandidateDeduplication(fullPlan, d, {
      ...oldAudit,
      systemPrompt: current.systemPrompt,
    }).issues,
  ).toHaveLength(1);
});

test('replays archived v4 judgments without applying the new scope or distribution policy in code', () => {
  const d = discovery(),
    prior = createCandidateDeduplicationRequest(
      plan,
      d,
      'candidate-deduplication.v4',
    ),
    current = createCandidateDeduplicationRequest(
      plan,
      d,
      'candidate-deduplication.v5',
    ),
    priorAudit = { ...prior, response: response(), usage },
    before = structuredClone({ d, priorAudit });
  expect(current.promptVersion).toBe('candidate-deduplication.v5');
  expect(current.userPrompt).toBe(prior.userPrompt);
  expect(current.systemPrompt.startsWith(prior.systemPrompt)).toBe(true);
  expect(current.systemPrompt).toContain(
    'LAYER-GROUP MEMBERSHIP VERSUS OBJECT IDENTITY',
  );
  expect(current.systemPrompt).toContain(
    'QUALIFIED DISTRIBUTION IS NONEXCLUSIVE',
  );
  const historical = assembleCandidateDeduplication(plan, d, priorAudit);
  expect(historical.issues).toEqual([]);
  expect(historical).toEqual(
    assembleCandidateDeduplication(plan, d, {
      ...current,
      response: priorAudit.response,
      usage,
    }),
  );
  expect(
    assembleCandidateDeduplication(plan, d, {
      ...priorAudit,
      systemPrompt: current.systemPrompt,
    }).issues,
  ).toHaveLength(1);
  expect({ d, priorAudit }).toEqual(before);
});

test('groups unordered identity pairs while retaining every source pair, reason and original candidate', () => {
  const d = discovery();
  d.candidates.push(candidate('d'));
  const a = audit(d);
  a.response.groups.push({ members: ['C4'], reason: 'another object' });
  a.response.uncertainMatches = [
    { left: 'C1', right: 'C3', reason: 'definition conflict' },
    { left: 'C4', right: 'C1', reason: 'different identity gap' },
    { left: 'C3', right: 'C2', reason: 'local occurrence conflict' },
  ];
  const result = assembleCandidateDeduplication(plan, d, a),
    before = structuredClone({ result, d, a });
  const grouped = groupCandidateUncertainties(result, d.candidates);
  expect(grouped).toHaveLength(2);
  expect(grouped.map((g) => g.candidateMatches.length)).toEqual([2, 1]);
  expect(grouped[0]).toMatchObject({
    leftGroupId: 'group-a',
    rightGroupId: 'group-c',
  });
  expect(grouped[0].candidateMatches[1]).toEqual({
    ...result.uncertainMatches[2],
    sourceMatchIndex: 2,
    leftCandidate: d.candidates[2],
    rightCandidate: d.candidates[1],
  });
  for (const match of grouped.flatMap((g) => g.candidateMatches)) {
    expect(match.reason).toBe(
      result.uncertainMatches[match.sourceMatchIndex].reason,
    );
    expect(match.leftCandidate).toBe(
      d.candidates.find((c) => c.candidateId === match.leftCandidateId),
    );
    expect(match.rightCandidate).toBe(
      d.candidates.find((c) => c.candidateId === match.rightCandidateId),
    );
  }
  expect({ result, d, a }).toEqual(before);
  expect(LLMCaller.call).not.toHaveBeenCalled();
  expect(
    groupCandidateUncertainties({ ...result, uncertainMatches: [] }, []),
  ).toEqual([]);
});

test('rejects missing provenance and intra-group doubts instead of silently dropping them', () => {
  const d = discovery(),
    result = assembleCandidateDeduplication(plan, d, audit(d));
  expect(() =>
    groupCandidateUncertainties({ ...result, groups: [] }, d.candidates),
  ).toThrow('Missing uncertainty candidate group');
  expect(() => groupCandidateUncertainties(result, [])).toThrow(
    'Missing original candidate',
  );
  const invalid = structuredClone(result);
  invalid.uncertainMatches[0].rightCandidateId = 'a';
  expect(() => groupCandidateUncertainties(invalid, d.candidates)).toThrow(
    'Identity uncertainty must link distinct groups',
  );
});

test('reads v6 groups per record kind in pool order and keeps saved v5 partitions replayable', () => {
  const d = discovery();
  d.candidates[0].recordKind = 'layer';
  d.candidates[1].recordKind = 'layer';
  const current = createCandidateDeduplicationRequest(
    plan,
    d,
    'candidate-deduplication.v6',
  );
  const v5 = createCandidateDeduplicationRequest(
    plan,
    d,
    'candidate-deduplication.v5',
  );
  const v6 = (response: unknown): CandidateDeduplicationAudit =>
    ({ ...current, response, usage }) as CandidateDeduplicationAudit;
  const groups = {
    feature: [{ members: ['C3'], reason: '별개 대상' }],
    layer: [{ members: ['C1', 'C2'], reason: '같은 층' }],
  };

  const result = assembleCandidateDeduplication(
    plan,
    d,
    v6({ groupsByKind: groups, uncertainMatches: [] }),
  );
  const unknownKind = assembleCandidateDeduplication(
    plan,
    d,
    v6({
      groupsByKind: { ...groups, site: [{ members: ['C3'], reason: 'x' }] },
      uncertainMatches: [],
    }),
  );
  const mixed = assembleCandidateDeduplication(
    plan,
    d,
    v6({
      groupsByKind: {
        layer: [{ members: ['C1', 'C2', 'C3'], reason: '섞임' }],
      },
      uncertainMatches: [],
    }),
  );

  expect(current.userPrompt).toBe(v5.userPrompt);
  expect(current.systemPrompt.startsWith(v5.systemPrompt)).toBe(true);
  expect(v5.systemPrompt).not.toContain('GROUPS STAY WITHIN ONE RECORD KIND');
  expect(result.issues).toEqual([]);
  expect(result.groups.map((g) => g.memberCandidateIds)).toEqual([
    ['a', 'b'],
    ['c'],
  ]);
  expect(unknownKind.issues).toEqual([
    'Groups listed under a kind absent from the pool: site',
  ]);
  expect(unknownKind.groups).toEqual([]);
  expect(mixed.issues).toEqual(['Group 1 mixes record kinds']);
  expect(
    assembleCandidateDeduplication(plan, d, v6(response())).issues,
  ).toEqual(['Invalid deduplication response schema']);
  expect(
    assembleCandidateDeduplication(plan, d, {
      ...v5,
      response: byKind(),
      usage,
    }).issues,
  ).toEqual(['Invalid deduplication response schema']);
});

test('fills v7 records outside every merge as their own groups in pool order', () => {
  const d = discovery();
  d.candidates.push(candidate('d'), candidate('e', 'layer'));
  const request = createCandidateDeduplicationRequest(plan, d);
  const v7 = (response: unknown): CandidateDeduplicationAudit =>
    ({ ...request, response, usage }) as CandidateDeduplicationAudit;
  const merged = {
    mergesByKind: {
      feature: [{ members: ['C4', 'C2'], reason: '같은 우물' }],
      layer: [],
    },
    uncertainMatches: [{ left: 'C1', right: 'C2', reason: '확인 필요' }],
  };

  const result = assembleCandidateDeduplication(plan, d, v7(merged));
  const none = assembleCandidateDeduplication(
    plan,
    d,
    v7({ mergesByKind: { feature: [], layer: [] }, uncertainMatches: [] }),
  );
  const repeated = assembleCandidateDeduplication(
    plan,
    d,
    v7({
      mergesByKind: {
        feature: [
          { members: ['C1', 'C2'], reason: 'a' },
          { members: ['C2', 'C3'], reason: 'b' },
        ],
      },
      uncertainMatches: [{ left: 'C2', right: 'C3', reason: 'same merge' }],
    }),
  );

  expect(request.promptVersion).toBe('candidate-deduplication.v7');
  expect(result.issues).toEqual([]);
  expect(result.groups.map((g) => g.memberCandidateIds)).toEqual([
    ['a'],
    ['d', 'b'],
    ['c'],
    ['e'],
  ]);
  expect(result.groups[0].reason).toBe(CANDIDATE_DEDUPLICATION_UNMERGED_REASON);
  expect(result.groups[1]).toMatchObject({
    groupId: 'group-d',
    reason: '같은 우물',
  });
  expect(result.uncertainMatches).toHaveLength(1);
  expect(none.groups.map((g) => g.memberCandidateIds)).toEqual(
    d.candidates.map((c) => [c.candidateId]),
  );
  expect(repeated.issues).toEqual([
    'Repeated candidate ref: C2',
    'Invalid uncertain match: C2, C3',
  ]);
  expect(assembleCandidateDeduplication(plan, d, v7(byKind())).issues).toEqual([
    'Invalid deduplication response schema',
  ]);
});
