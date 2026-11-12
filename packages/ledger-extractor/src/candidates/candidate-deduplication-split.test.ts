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

    expect(split.version).toBe('candidate-deduplication-split.v5');
    expect(split.ruleMerges).toEqual([
      { candidateIds: ['a1', 'a2'], rule: 'same_number' },
      { candidateIds: ['b1', 'b2'], rule: 'number_correspondence' },
    ]);
    expect(split.blocks).toEqual([
      {
        blockId: 'block-1',
        candidateIds: ['a1', 'a2', 'f1', 'f2'],
        ruleGroups: [['a1', 'a2']],
      },
      { blockId: 'block-2', candidateIds: ['c1', 'c2', 'c3'], ruleGroups: [] },
      { blockId: 'block-3', candidateIds: ['d1', 'd2'], ruleGroups: [] },
      { blockId: 'block-4', candidateIds: ['e1', 'e2'], ruleGroups: [] },
      { blockId: 'block-5', candidateIds: ['g1', 'g2'], ruleGroups: [] },
      { blockId: 'block-6', candidateIds: ['h1', 'h2'], ruleGroups: [] },
    ]);
  });

  test('keeps rule-merged candidates as separate block members without groups in split v3', () => {
    const split = planCandidateDeduplication(
      plan,
      discovery(),
      'candidate-deduplication-split.v3',
    );

    expect(split.ruleMerges).toEqual(
      planCandidateDeduplication(plan, discovery()).ruleMerges,
    );
    expect(split.blocks[0]).toEqual({
      blockId: 'block-1',
      candidateIds: ['a1', 'a2', 'f1', 'f2'],
    });
  });

  test('marks the rule groups of a block from split v4 and leaves groups without model pairs out of blocks', () => {
    const tombs = (): CandidateDiscoveryResult => ({
      ...discovery(),
      candidates: [
        candidate('m1', 'feature', '墓', 'M218', '/t1'),
        candidate('r1', 'feature', '墓葬', '218', '/r0c0'),
        candidate('r2', 'feature', '墓葬', '218', '/r1c0'),
        candidate('s1', 'feature', '墓葬', '206', '/r0c1'),
        candidate('s2', 'feature', '墓葬', '206', '/r1c1'),
      ],
    });

    const v4 = planCandidateDeduplication(
      plan,
      tombs(),
      'candidate-deduplication-split.v4',
    );
    const v3 = planCandidateDeduplication(
      plan,
      tombs(),
      'candidate-deduplication-split.v3',
    );

    expect(v4.ruleMerges).toEqual([
      { candidateIds: ['r1', 'r2'], rule: 'same_number' },
      { candidateIds: ['s1', 's2'], rule: 'same_number' },
    ]);
    expect(v3.blocks).toEqual([
      { blockId: 'block-1', candidateIds: ['m1', 'r1', 'r2'] },
    ]);
    expect(v4.blocks).toEqual([
      {
        blockId: 'block-1',
        candidateIds: ['m1', 'r1', 'r2'],
        ruleGroups: [['r1', 'r2']],
      },
    ]);
  });

  test('merges labels discovery gave one bare number and number forms one to one per rule group from split v5', () => {
    const register = (
      tableId: string,
      rowIndex: number,
      texts: string[],
    ): CandidateDiscoveryUnit['resources'] =>
      texts.map((value, columnIndex) => ({
        ...cell(
          `/${tableId}/${rowIndex}/${columnIndex}`,
          rowIndex,
          columnIndex,
          value,
        ),
        tableId,
      }));
    const registers: CandidateDiscoveryPlan = {
      ...plan,
      units: [
        unit('u1', [
          text('/x1', '99XXM206位于墓地东部。'),
          text('/x2', '墓M300'),
        ]),
        {
          ...unit(
            'u2',
            register('side', 0, ['218', '墓葬', '206', '丙']).concat(
              register('side', 1, ['300', '甲', '', '']),
            ),
          ),
          table: {
            id: 'side',
            caption: null,
            headerRows: [],
            columnBlocks: { count: 2, columnsPerBlock: 2 },
          },
        },
        unit('u3', [
          ...register('plain', 0, ['218', '墓主']),
          ...register('plain', 1, ['206', '']),
          ...register('plain', 2, ['300', '']),
          ...register('plain', 3, ['300', '']),
        ]),
      ],
    };
    const tombs = (): CandidateDiscoveryResult => ({
      ...discovery(),
      candidates: [
        candidate('r1', 'feature', '墓葬', '218', '/side/0/0'),
        candidate('r2', 'feature', '墓', '218', '/plain/0/0'),
        candidate('s1', 'feature', '墓葬', '206', '/side/0/2'),
        candidate('s2', 'feature', '墓', '206', '/plain/1/0'),
        candidate('s3', 'feature', '墓', '206', '/plain/1/0'),
        candidate('m1', 'feature', '墓', '99XXM206', '/x1'),
        candidate('t1', 'feature', '墓', '300', '/side/1/0'),
        candidate('t2', 'feature', '墓葬', '300', '/plain/2/0'),
        candidate('t3', 'feature', '墓葬祔', '300', '/plain/3/0'),
        candidate('t4', 'feature', '墓', 'M300', '/x2'),
      ],
    });

    const v5 = planCandidateDeduplication(registers, tombs());
    const v4 = planCandidateDeduplication(
      registers,
      tombs(),
      'candidate-deduplication-split.v4',
    );

    expect(v5.ruleMerges).toEqual([
      { candidateIds: ['s2', 's3'], rule: 'same_number' },
      { candidateIds: ['s1', 's2'], rule: 'inferred_name' },
      { candidateIds: ['s1', 's3'], rule: 'inferred_name' },
      { candidateIds: ['s1', 'm1'], rule: 'number_form' },
      { candidateIds: ['s2', 'm1'], rule: 'number_form' },
      { candidateIds: ['s3', 'm1'], rule: 'number_form' },
    ]);
    expect(v5.blocks.map((b) => b.candidateIds)).toEqual([
      ['r1', 'r2'],
      ['t1', 't2', 't3', 't4'],
    ]);
    expect(v4.ruleMerges).toEqual([
      { candidateIds: ['s2', 's3'], rule: 'same_number' },
    ]);
  });

  test('merges one number written in different forms by code in split v3, one to one', () => {
    const forms = (): CandidateDiscoveryResult => ({
      ...discovery(),
      candidates: [
        candidate('t1', 'feature', '墓', '99XXM107', '/t1'),
        candidate('t2', 'feature', '墓葬', '107', '/r0c0'),
        candidate('t3', 'feature', '墓', '102A', '/r0c1'),
        candidate('t4', 'feature', '墓', '99XXM102', '/t2'),
        candidate('m1', 'feature', '墓', 'M106', '/t1'),
        candidate('m2', 'feature', '墓', '99XXM106', '/t2'),
        candidate('m3', 'feature', '墓', '106', '/r1c0'),
        candidate('x1', 'artifact', '罐', '107', '/r1c1'),
      ],
    });

    const v3 = planCandidateDeduplication(
      plan,
      forms(),
      'candidate-deduplication-split.v3',
    );
    const v2 = planCandidateDeduplication(
      plan,
      forms(),
      'candidate-deduplication-split.v2',
    );

    expect(v3.ruleMerges).toEqual([
      { candidateIds: ['t1', 't2'], rule: 'number_form' },
    ]);
    expect(v3.blocks.map((b) => b.candidateIds)).toContainEqual([
      'm1',
      'm2',
      'm3',
    ]);
    expect(v2.ruleMerges).toEqual([]);
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

  test('sends a rule group as one ref with its other candidates under mergedByCode from split v4', () => {
    const v4 = planCandidateDeduplication(plan, discovery());
    const v3 = planCandidateDeduplication(
      plan,
      discovery(),
      'candidate-deduplication-split.v3',
    );

    const grouped = createCandidateDeduplicationBlockRequest(
      plan,
      discovery(),
      v4.blocks[0],
    );
    const separate = createCandidateDeduplicationBlockRequest(
      plan,
      discovery(),
      v3.blocks[0],
    );
    const payload = JSON.parse(grouped.userPrompt);

    expect(grouped.promptVersion).toBe('candidate-deduplication.v9');
    expect(
      payload.candidates.map(
        (c: { ref: string; candidateId: string; mergedByCode?: unknown[] }) => [
          c.ref,
          c.candidateId,
          c.mergedByCode?.length ?? 0,
        ],
      ),
    ).toEqual([
      ['C1', 'a1', 1],
      ['C2', 'f1', 0],
      ['C3', 'f2', 0],
    ]);
    expect(payload.candidates[0].mergedByCode[0].candidateId).toBe('a2');
    expect(payload.rules).toEqual([expect.stringContaining('MERGED BY CODE:')]);
    expect(separate.promptVersion).toBe('candidate-deduplication.v8');
    expect(JSON.parse(separate.userPrompt).candidates).toHaveLength(4);
    expect(JSON.parse(separate.userPrompt).rules).toBeUndefined();
    // a v4 block without a rule group asks exactly what a v3 block asked
    const plain = createCandidateDeduplicationBlockRequest(
      plan,
      discovery(),
      v4.blocks[1],
    );
    expect(plain.promptVersion).toBe('candidate-deduplication.v9');
    expect(plain.userPrompt).toBe(
      createCandidateDeduplicationBlockRequest(plan, discovery(), v3.blocks[1])
        .userPrompt,
    );
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
        feature: [{ members: ['C1', 'C3'], reason: '같은 가마' }],
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
    ).toEqual(['Uncertain match inside one group: f1, a1']);
    expect(blockMembers()[0]).toEqual(['a1', 'a2', 'f1', 'f2']);
  });
});
