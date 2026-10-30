import type { CandidateDeduplicationSplitAudit } from './candidate-deduplication-split';
import type {
  CandidateDiscoveryPlan,
  CandidateDiscoveryResult,
  CandidateDiscoveryUnit,
  LedgerObjectCandidate,
} from './discovery-types';

import { LLMCaller } from '@heripo/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  CANDIDATE_DEDUPLICATION_UNMERGED_REASON,
  assembleCandidateDeduplication,
} from './candidate-deduplication';
import {
  CANDIDATE_DEDUPLICATION_BLOCK_PROMPT_VERSION,
  assembleCandidateDeduplicationSplit,
  createCandidateDeduplicationBlockRequest,
  deduplicateCandidateBlocks,
  planCandidateDeduplication,
} from './candidate-deduplication-split';

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

const text = (key: string, value: string) => ({
  kind: 'text' as const,
  key,
  resourceId: key,
  sourceRefs: [],
  chapterIds: ['ch'],
  pdfPageNo: 1,
  logicalPageRange: null,
  data: { text: value, pdfPageNo: 1 },
});
const cell = (
  key: string,
  rowIndex: number,
  columnIndex: number,
  value: string,
) => ({
  kind: 'tableCell' as const,
  key,
  resourceId: null,
  sourceRefs: [],
  chapterIds: ['ch'],
  pdfPageNo: 1,
  logicalPageRange: null,
  tableId: 'tb',
  rowIndex,
  columnIndex,
  data: { text: value, rowSpan: 1, colSpan: 1, isHeader: false },
});
const unit = (
  unitId: string,
  resources: CandidateDiscoveryUnit['resources'],
): CandidateDiscoveryUnit => ({
  unitId,
  chapterId: 'ch',
  chapterPath: [{ id: 'ch', originTitle: '조사내용' }],
  table: null,
  context: [],
  resources,
});
const plan: CandidateDiscoveryPlan = {
  scopeChapterId: 'ch',
  scopeTitle: '조사내용',
  inputSha256: 'hash',
  units: [
    unit('u1', [
      text('/t1', '1호 수혈과 2호 주거지, 우물을 확인하였다.'),
      text('/t2', '토기 마도23-7 마도발굴23-9 마도시굴23-1'),
    ]),
    unit('u2', [
      cell('/r0c0', 0, 0, '마도23-3'),
      cell('/r0c1', 0, 1, '마도발굴23-28'),
      cell('/r1c0', 1, 0, '마도23-4'),
      cell('/r1c1', 1, 1, '마도발굴23-29'),
      cell('/r1c2', 1, 2, '마도발굴23-30'),
    ]),
    unit('u3', [text('/t3', '관계없는 블록')]),
  ],
};
const candidate = (
  candidateId: string,
  recordKind: LedgerObjectCandidate['recordKind'],
  sourceName: string,
  sourceIdentifier: string | null,
  resourceKey: string,
): LedgerObjectCandidate => ({
  candidateId,
  status: 'proposed',
  recordKind,
  sourceName,
  sourceIdentifier,
  eligibilityBasis: 'independent_body',
  reason: '원문',
  chapterId: 'ch',
  unitIds: ['u1'],
  evidence: [
    {
      sourceId: `id:${resourceKey}`,
      resourceKey,
      resourceId: null,
      sourceRefs: [],
      pdfPageNo: 1,
      logicalPageRange: null,
      quote: sourceName,
      charStart: 0,
      charEnd: 1,
    },
  ],
});
const discovery = (): CandidateDiscoveryResult => ({
  version: 'ledger-object-candidates.v1',
  inputSha256: 'hash',
  scopeChapterId: 'ch',
  scopeTitle: '조사내용',
  candidates: [
    candidate('a1', 'feature', '수혈', '1호', '/t1'),
    candidate('a2', 'feature', '수 혈', '1 호', '/t1'),
    candidate('b1', 'artifact', '청자', '마도23-3', '/r0c0'),
    candidate('b2', 'artifact', '청자', '마도발굴23-28', '/r0c1'),
    candidate('c1', 'artifact', '백자', '마도23-4', '/r1c0'),
    candidate('c2', 'artifact', '백자', '마도발굴23-29', '/r1c1'),
    candidate('c3', 'artifact', '백자', '마도발굴23-30', '/r1c2'),
    candidate('d1', 'feature', '주거지', '2호', '/t1'),
    candidate('d2', 'feature', '건물지', '2호', '/t1'),
    candidate('e1', 'feature', '우물', null, '/t1'),
    candidate('e2', 'feature', '우물', null, '/t1'),
    candidate('f1', 'feature', '가마', '1호', '/t1'),
    candidate('f2', 'feature', '가마', null, '/t1'),
    candidate('g1', 'layer', '갈색사질토', null, '/t1'),
    candidate('g2', 'layer', '적색점토', null, '/t1'),
    candidate('h1', 'artifact', '토기', '마도23-7', '/t2'),
    candidate('h2', 'artifact', '토기편', '마도발굴23-9', '/t2'),
    candidate('h3', 'artifact', '기와', '마도시굴23-1', '/t2'),
    candidate('i1', 'artifact', '골각기', '마도23-8', '/missing'),
  ],
  issues: [],
  exclusions: [],
  completedUnitIds: ['u1', 'u2', 'u3'],
  totalUnits: 3,
  inspectedResourceCount: 8,
});
const blockMembers = () =>
  planCandidateDeduplication(plan, discovery()).blocks.map(
    (b) => b.candidateIds,
  );
/** Model answers per block, in block order: c1 = c2 with c1 ~ c3 unresolved, e1 = e2, nothing else merged. */
const answers = () => [
  { mergesByKind: {}, uncertainMatches: [] },
  {
    mergesByKind: {
      artifact: [{ members: ['C1', 'C2'], reason: '대응표의 같은 백자' }],
    },
    uncertainMatches: [{ left: 'C1', right: 'C3', reason: '번호만 겹침' }],
  },
  { mergesByKind: {}, uncertainMatches: [] },
  {
    mergesByKind: { feature: [{ members: ['C1', 'C2'], reason: '같은 우물' }] },
    uncertainMatches: [],
  },
  { mergesByKind: {}, uncertainMatches: [] },
  { mergesByKind: {}, uncertainMatches: [] },
];
async function splitAudit(): Promise<CandidateDeduplicationSplitAudit> {
  const queue = answers();
  vi.mocked(LLMCaller.call).mockImplementation((async () => ({
    output: queue.shift(),
    usage,
  })) as never);
  return deduplicateCandidateBlocks(plan, discovery(), {
    model: {} as never,
    maxRetries: 1,
  });
}

beforeEach(() => {
  vi.mocked(LLMCaller.call).mockReset();
});

describe('planCandidateDeduplication', () => {
  test('merges same numbers and one-to-one correspondences by code and blocks the pairs a model must judge', () => {
    const split = planCandidateDeduplication(plan, discovery());

    expect(split.version).toBe('candidate-deduplication-split.v2');
    expect(split.ruleMerges).toEqual([
      { candidateIds: ['a1', 'a2'], rule: 'same_number' },
      { candidateIds: ['b1', 'b2'], rule: 'number_correspondence' },
    ]);
    expect(split.blocks).toEqual([
      { blockId: 'block-1', candidateIds: ['a1', 'a2', 'f1', 'f2'] },
      { blockId: 'block-2', candidateIds: ['c1', 'c2', 'c3'] },
      { blockId: 'block-3', candidateIds: ['d1', 'd2'] },
      { blockId: 'block-4', candidateIds: ['e1', 'e2'] },
      { blockId: 'block-5', candidateIds: ['g1', 'g2'] },
      { blockId: 'block-6', candidateIds: ['h1', 'h2'] },
    ]);
  });

  test('leaves number-linked pairs under nested names apart in split v1', () => {
    const split = planCandidateDeduplication(
      plan,
      discovery(),
      'candidate-deduplication-split.v1',
    );

    expect(split.version).toBe('candidate-deduplication-split.v1');
    expect(split.blocks.map((b) => b.candidateIds)).not.toContainEqual([
      'h1',
      'h2',
    ]);
    expect(split.blocks).toHaveLength(5);
  });

  test('refuses discovery that is incomplete or from another input', () => {
    const other = { ...discovery(), inputSha256: 'other' };
    const partial = { ...discovery(), completedUnitIds: ['u1', 'u2', 'x'] };
    const short = { ...discovery(), completedUnitIds: ['u1'] };

    for (const d of [other, partial, short])
      expect(() => planCandidateDeduplication(plan, d)).toThrow(
        'Deduplication requires completed discovery for the same input and scope',
      );
    expect(() =>
      createCandidateDeduplicationBlockRequest(plan, other, {
        blockId: 'block-1',
        candidateIds: ['a1'],
      }),
    ).toThrow('Deduplication requires completed discovery');
  });
});

describe('createCandidateDeduplicationBlockRequest', () => {
  test('sends the block candidates with local refs and only the units holding their evidence', () => {
    const split = planCandidateDeduplication(plan, discovery());

    const request = createCandidateDeduplicationBlockRequest(
      plan,
      discovery(),
      split.blocks[1],
    );
    const payload = JSON.parse(request.userPrompt);

    expect(request.promptVersion).toBe(
      CANDIDATE_DEDUPLICATION_BLOCK_PROMPT_VERSION,
    );
    expect(request.systemPrompt).toContain('BLOCK REVIEW:');
    expect(request.systemPrompt).toContain('mergesByKind');
    expect(payload.blockId).toBe('block-2');
    expect(payload.scopeChapterIds).toBeUndefined();
    expect(
      payload.candidates.map((c: { ref: string; candidateId: string }) => [
        c.ref,
        c.candidateId,
      ]),
    ).toEqual([
      ['C1', 'c1'],
      ['C2', 'c2'],
      ['C3', 'c3'],
    ]);
    expect(payload.units.map((u: { unitId: string }) => u.unitId)).toEqual([
      'u2',
    ]);
    expect(
      JSON.parse(
        createCandidateDeduplicationBlockRequest(
          { ...plan, scopeChapterIds: ['ch', 'ch2'] },
          { ...discovery(), scopeChapterIds: ['ch', 'ch2'] },
          split.blocks[0],
        ).userPrompt,
      ).scopeChapterIds,
    ).toEqual(['ch', 'ch2']);
  });
});

describe('deduplicateCandidateBlocks', () => {
  test('asks one block at a time with a per-kind merge schema and reuses saved block audits', async () => {
    const audit = await splitAudit();
    const onBlock = vi.fn();

    expect(LLMCaller.call).toHaveBeenCalledTimes(6);
    const args = vi.mocked(LLMCaller.call).mock.calls[1][0];
    expect(args).toMatchObject({
      maxRetries: 1,
      cacheSystemPrompt: true,
      providerOptions: { anthropic: { effort: 'low' } },
      phase: 'candidate-deduplication-block',
      metadata: { blockId: 'block-2', candidateCount: 3 },
    });
    expect(
      args.schema.safeParse({
        mergesByKind: { artifact: [{ members: ['C1', 'C2'], reason: 'r' }] },
        uncertainMatches: [],
      }).success,
    ).toBe(true);
    expect(
      args.schema.safeParse({
        mergesByKind: { artifact: [{ members: ['C1', 'C9'], reason: 'r' }] },
        uncertainMatches: [],
      }).success,
    ).toBe(false);
    expect(audit.blocks.map((b) => b.blockId)).toEqual([
      'block-1',
      'block-2',
      'block-3',
      'block-4',
      'block-5',
      'block-6',
    ]);

    vi.mocked(LLMCaller.call).mockClear();
    vi.mocked(LLMCaller.call).mockResolvedValue({
      output: { mergesByKind: {}, uncertainMatches: [] },
      usage,
    } as never);
    const resumed = await deduplicateCandidateBlocks(plan, discovery(), {
      model: {} as never,
      maxRetries: 0,
      completed: [...audit.blocks.slice(0, 4), audit.blocks[5]],
      onBlock,
    });

    expect(LLMCaller.call).toHaveBeenCalledTimes(1);
    expect(onBlock).toHaveBeenCalledTimes(1);
    expect(onBlock.mock.calls[0][0].blockId).toBe('block-5');
    expect(resumed.blocks.slice(0, 4)).toEqual(audit.blocks.slice(0, 4));
  });
});

describe('assembleCandidateDeduplicationSplit', () => {
  test('joins rule merges and block merges into groups in pool order and keeps uncertain matches', async () => {
    const audit = await splitAudit();

    const result = assembleCandidateDeduplication(plan, discovery(), audit);

    expect(result.issues).toEqual([]);
    expect(result.groups.map((g) => g.memberCandidateIds)).toEqual([
      ['a1', 'a2'],
      ['b1', 'b2'],
      ['c1', 'c2'],
      ['c3'],
      ['d1'],
      ['d2'],
      ['e1', 'e2'],
      ['f1'],
      ['f2'],
      ['g1'],
      ['g2'],
      ['h1'],
      ['h2'],
      ['h3'],
      ['i1'],
    ]);
    expect(result.groups[0]).toEqual({
      groupId: 'group-a1',
      status: 'proposed',
      memberCandidateIds: ['a1', 'a2'],
      reason: '코드 규칙: 같은 종류·번호·이름',
    });
    expect(result.groups[1].reason).toBe(
      '코드 규칙: 같은 이름, 근거 블록·표 행의 번호 대응',
    );
    expect(result.groups[2].reason).toBe('대응표의 같은 백자');
    expect(result.groups[3].reason).toBe(
      CANDIDATE_DEDUPLICATION_UNMERGED_REASON,
    );
    expect(result.uncertainMatches).toEqual([
      { leftCandidateId: 'c1', rightCandidateId: 'c3', reason: '번호만 겹침' },
    ]);
  });

  test('joins a model merge with a rule merge transitively and lists both reasons', async () => {
    const audit = await splitAudit();
    audit.blocks[0].response = {
      mergesByKind: {
        feature: [{ members: ['C1', 'C4'], reason: '같은 가마' }],
      },
      uncertainMatches: [],
    };

    const result = assembleCandidateDeduplicationSplit(
      plan,
      discovery(),
      audit,
    );

    expect(result.issues).toEqual([]);
    expect(result.groups[0]).toMatchObject({
      memberCandidateIds: ['a1', 'a2', 'f2'],
      reason: '코드 규칙: 같은 종류·번호·이름 / 같은 가마',
    });
  });

  test('reports a changed split, missing or mismatched blocks and invalid responses without repairing them', async () => {
    const audit = await splitAudit();
    const issuesOf = (a: CandidateDeduplicationSplitAudit) =>
      assembleCandidateDeduplicationSplit(plan, discovery(), a).issues;

    expect(
      issuesOf({ ...audit, split: { ...audit.split, blocks: [] } }),
    ).toEqual(['Saved split does not match the candidate pool']);
    expect(issuesOf({ ...audit, blocks: audit.blocks.slice(1) })).toEqual([
      'Missing block response: block-1',
    ]);
    const blocks = (patch: Partial<(typeof audit.blocks)[number]>) => ({
      ...audit,
      blocks: [{ ...audit.blocks[0], ...patch }, ...audit.blocks.slice(1)],
    });
    expect(issuesOf(blocks({ userPrompt: 'other' }))).toEqual([
      'Block response does not match its request: block-1',
    ]);
    expect(issuesOf(blocks({ systemPrompt: 'other' }))).toEqual([
      'Block response does not match its request: block-1',
    ]);
    expect(issuesOf(blocks({ promptVersion: 'x' as never }))).toEqual([
      'Block response does not match its request: block-1',
    ]);
    expect(issuesOf(blocks({ response: { groups: [] } as never }))).toEqual([
      'Invalid block response schema: block-1',
    ]);
    expect(
      issuesOf(
        blocks({
          response: {
            mergesByKind: {
              layer: [],
              feature: [
                { members: ['C1', 'C2'], reason: 'r' },
                { members: ['C2', 'C3'], reason: 'r' },
                { members: ['C1', 'C9'], reason: 'r' },
              ],
            },
            uncertainMatches: [{ left: 'C1', right: 'C9', reason: 'r' }],
          },
        }),
      ),
    ).toEqual([
      'Merges listed under a kind absent from block-1: layer',
      'Repeated candidate ref in block-1',
      'Unknown candidate ref in block-1',
      'Invalid uncertain match in block-1: C1, C9',
    ]);
    expect(
      issuesOf(
        blocks({
          response: {
            mergesByKind: { feature: [{ members: ['C1', 'C2'], reason: 'r' }] },
            uncertainMatches: [{ left: 'C9', right: 'C1', reason: 'r' }],
          },
        }),
      ),
    ).toEqual(['Invalid uncertain match in block-1: C9, C1']);
    expect(
      issuesOf(
        blocks({
          response: {
            mergesByKind: { feature: [{ members: ['C1', 'C2'], reason: 'r' }] },
            uncertainMatches: [{ left: 'C2', right: 'C1', reason: 'r' }],
          },
        }),
      ),
    ).toEqual(['Uncertain match inside one group: a2, a1']);
    expect(blockMembers()[0]).toEqual(['a1', 'a2', 'f1', 'f2']);
  });
});
