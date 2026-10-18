import type { LanguageModel } from 'ai';

import type { CandidateDeduplicationAudit } from './candidate-deduplication';
import type {
  CandidateDiscoveryPlan,
  CandidateDiscoveryResult,
  LedgerObjectCandidate,
} from './candidate-discovery';

import { LLMCaller } from '@heripo/shared';
import { describe, expect, test, vi } from 'vitest';

import {
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
const audit = (d = discovery()): CandidateDeduplicationAudit => ({
  ...createCandidateDeduplicationRequest(plan, d),
  response: response(),
  usage,
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
    for (const change of [
      { inputSha256: 'other' },
      { scopeChapterId: 'other' },
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
      output: response(),
      usage,
      usedFallback: false,
    });
    const d = discovery();
    const result = await deduplicateCandidates(plan, d, {
      model: {} as LanguageModel,
      maxRetries: 0,
    });
    const call = vi.mocked(LLMCaller.call).mock.calls[0][0];
    expect(call.schema.safeParse(response()).success).toBe(true);
    expect(
      call.schema.safeParse({
        groups: [{ members: ['C9'], reason: 'wrong' }],
        uncertainMatches: [],
      }).success,
    ).toBe(false);
    expect(result.response).toEqual(response());
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
    current = createCandidateDeduplicationRequest(fullPlan, d),
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
    current = createCandidateDeduplicationRequest(plan, d),
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
