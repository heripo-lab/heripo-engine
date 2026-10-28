import type * as Shared from '@heripo/shared';
import type * as Ai from 'ai';

import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { ArchaeologyLedgerResult } from '../ledger/archaeology-ledger';
import type { PlaceAliasProposalRequest } from './place-alias-proposal';
import type { RelationParents } from './relation-parents';
import type { RelationSignal } from './relation-signals';

import { generateText } from 'ai';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  PLACE_ALIAS_PROPOSAL_VERSION,
  assemblePlaceAliasProposal,
  createPlaceAliasProposalRequest,
  proposePlaceAliases,
} from './place-alias-proposal';

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof Ai>()),
  generateText: vi.fn(),
}));
vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

const entry = (groupId: string, recordKind: string, sourceName: string) => ({
  ref: groupId,
  groupId,
  recordKind,
  mentions: [
    { sourceName, sourceIdentifier: null, chapterPath: [], evidence: [] },
  ],
});
const REGISTRY = [
  entry('z1', 'area', '23-1 구역'),
  entry('z2', 'area', '23-2 구역'),
  entry('a1', 'area', '23-A-1 구역'),
  entry('short', 'area', '발굴 2구역'),
  entry('c1', 'artifact', '청자'),
  entry('c2', 'artifact', '백자'),
];
const TEXTS = [
  '1) 정밀발굴조사(23-1~ 6구역)',
  '2) 시굴조사(23-A구역)',
  '마도발굴23-3',
  `발굴 23-1 구역 ${'가'.repeat(400)}`,
];
const planOf = (
  registry = REGISTRY,
  texts = TEXTS,
  context = ['발굴 23-2구역 일지'],
) =>
  ({
    inputSha256: 'hash',
    registry,
    units: [
      {
        sources: texts.map((text) => ({ resource: { data: { text } } })),
        readOnlyContext: context.map((text) => ({ text })),
      },
    ],
  }) as unknown as ContentAttachmentPlan;
const ledgerOf = (registry = REGISTRY) =>
  ({
    records: registry.map((e, i) => ({
      id: `record-${e.groupId}`,
      recordKind: e.recordKind,
      sourceName: e.mentions[0].sourceName,
      sourceIdentifier: null,
      ordinal: i,
      content: [],
    })),
  }) as unknown as ArchaeologyLedgerResult;
const phrase = (place: string | undefined, targets: string[] = []) =>
  ({
    kind: 'phrase',
    text: `출수위치 ${place ?? ''}`,
    place,
    targetRecordIds: targets,
    finding: true,
  }) as RelationSignal;
const parentsOf = (questions: Array<[string, RelationSignal[]]>) =>
  ({
    questions: questions.map(([recordId, signals]) => ({
      recordId,
      reasons: ['unmatched_place'],
      candidateRecordIds: [],
      signals,
    })),
  }) as unknown as RelationParents;
const PARENTS = parentsOf([
  [
    'record-c1',
    [
      phrase('발굴 1구역'),
      phrase('발굴 1구역'),
      phrase('23-1 구역', ['record-z1']),
      phrase(undefined),
      { kind: 'heading_scope', text: 'h', targetRecordIds: [] },
    ],
  ],
  ['record-c2', [phrase('발굴 1구역'), phrase('시굴 1구역')]],
]);

describe('createPlaceAliasProposalRequest', () => {
  test('lists unmatched places, offered names without short forms and statements from the text', () => {
    const request = createPlaceAliasProposalRequest(
      planOf(),
      ledgerOf(),
      PARENTS,
    )!;
    expect(request.version).toBe(PLACE_ALIAS_PROPOSAL_VERSION);
    expect(request.inputSha256).toBe('hash');
    expect(request.places).toEqual([
      {
        ref: 'P1',
        place: '발굴 1구역',
        recordIds: ['record-c1', 'record-c2'],
      },
      { ref: 'P2', place: '시굴 1구역', recordIds: ['record-c2'] },
    ]);
    expect(request.names).toEqual([
      { ref: 'N1', recordId: 'record-z1', name: '23-1 구역' },
      { ref: 'N2', recordId: 'record-a1', name: '23-A-1 구역' },
    ]);
    expect(request.statements).toEqual([
      { ref: 'S1', text: '발굴 23-2구역 일지' },
      { ref: 'S2', text: '2) 시굴조사(23-A구역)' },
      { ref: 'S3', text: '1) 정밀발굴조사(23-1~ 6구역)' },
    ]);
    expect(request.userPrompt).toContain('P1 발굴 1구역 (2)');
    expect(request.userPrompt).toContain('N2 23-A-1 구역');
    expect(request.userPrompt).toContain('S2 2) 시굴조사(23-A구역)');
    expect(request.systemPrompt).toContain('never propose a bare');
    expect(request.providerOutputSchema.required).toEqual(['rules']);
  });

  test('returns null without unmatched places, names or statements', () => {
    expect(
      createPlaceAliasProposalRequest(planOf(), ledgerOf(), parentsOf([])),
    ).toBeNull();
    const shortOnly = [
      entry('short', 'area', '발굴 2구역'),
      entry('c1', 'artifact', '청자'),
    ];
    expect(
      createPlaceAliasProposalRequest(
        planOf(shortOnly),
        ledgerOf(shortOnly),
        parentsOf([['record-c1', [phrase('발굴 1구역')]]]),
      ),
    ).toBeNull();
    expect(
      createPlaceAliasProposalRequest(
        planOf(REGISTRY, ['마도발굴23-3'], []),
        ledgerOf(),
        PARENTS,
      ),
    ).toBeNull();
  });
});

const request = createPlaceAliasProposalRequest(
  planOf(),
  ledgerOf(),
  PARENTS,
) as PlaceAliasProposalRequest;
const rule = (overrides: Record<string, unknown> = {}) => ({
  written: ['발굴 {n}구역'],
  registered: '23-{n} 구역',
  numbers: { from: 1, to: 6 },
  basis: 'S3',
  reason: 'stated by S3',
  ...overrides,
});
const assemble = (first: unknown[], second: unknown[] = first) =>
  assemblePlaceAliasProposal(
    planOf(),
    ledgerOf(),
    request,
    [{ rules: first }, { rules: second }],
    '2026-10-28T00:00:00.000Z',
  );

describe('assemblePlaceAliasProposal', () => {
  test('keeps rules both runs gave alike and code accepts, as a model table', () => {
    const outcome = assemble(
      [
        rule(),
        rule({
          written: ['시굴 {n}구역'],
          registered: '23-A-{n} 구역',
          numbers: { from: 1, to: 10 },
          basis: 'S2',
        }),
      ],
      [
        rule({
          written: ['시굴 {n}구역'],
          registered: '23-A-{n}구역',
          numbers: { from: 1, to: 10 },
          basis: 'S2',
        }),
        rule({ basis: 'S2', reason: 'other' }),
      ],
    );
    expect(outcome.dropped).toEqual([]);
    expect(outcome.table).toEqual({
      version: 'place-aliases.v1',
      inputSha256: 'hash',
      source: 'model',
      confirmedAt: '2026-10-28T00:00:00.000Z',
      rules: [
        {
          id: 'model-1',
          written: ['발굴 {n}구역'],
          registered: '23-{n} 구역',
          numbers: { from: 1, to: 6 },
          recordKind: 'area',
          basis: { quote: '1) 정밀발굴조사(23-1~ 6구역)' },
          note: 'stated by S3',
        },
        {
          id: 'model-2',
          written: ['시굴 {n}구역'],
          registered: '23-A-{n} 구역',
          numbers: { from: 1, to: 10 },
          recordKind: 'area',
          basis: { quote: '2) 시굴조사(23-A구역)' },
          note: 'stated by S3',
        },
      ],
    });
  });

  test('drops rules without changing them and gives each reason', () => {
    const outcome = assemble(
      [
        'not a rule',
        rule({ numbers: { from: 1, to: 5 } }),
        rule({ basis: 'S9' }),
        rule({ numbers: null }),
        rule({ written: ['{n}구역'] }),
        rule({
          written: ['시굴 {n}구역'],
          registered: '23-A-{n} 구역',
          numbers: { from: 1, to: 10 },
        }),
        rule({
          written: ['시굴 외곽'],
          registered: '외곽 지점',
          numbers: null,
          basis: 'S2',
        }),
        rule({ numbers: { from: 3, to: 1 } }),
        rule({
          written: ['발굴 {n}구역'],
          registered: '23-{n} 구역',
          numbers: { from: 3, to: 6 },
        }),
        rule({
          written: ['시굴 외곽'],
          registered: '23-A-1 구역',
          numbers: null,
          basis: 'S2',
        }),
        rule({
          written: ['시굴 {n}'],
          registered: '{n} 구역',
          numbers: { from: 1, to: 2 },
          basis: 'S2',
        }),
      ],
      [
        rule({ numbers: { from: 1, to: 4 } }),
        rule({ basis: 'S8' }),
        rule({ numbers: null }),
        rule({ written: ['{n}구역'] }),
        rule({
          written: ['시굴 {n}구역'],
          registered: '23-A-{n} 구역',
          numbers: { from: 1, to: 10 },
        }),
        rule({
          written: ['시굴 외곽'],
          registered: '외곽 지점',
          numbers: null,
          basis: 'S2',
        }),
        rule({ numbers: { from: 3, to: 1 } }),
        rule({
          written: ['발굴 {n}구역'],
          registered: '23-{n} 구역',
          numbers: { from: 3, to: 6 },
        }),
        rule({
          written: ['시굴 외곽'],
          registered: '23-A-1 구역',
          numbers: null,
          basis: 'S2',
        }),
        rule({
          written: ['시굴 {n}'],
          registered: '{n} 구역',
          numbers: { from: 1, to: 2 },
          basis: 'S2',
        }),
      ],
    );
    expect(outcome.table).toBeNull();
    expect(outcome.dropped.map((d) => d.reason)).toEqual([
      'malformed rule',
      'not proposed alike by both runs',
      'basis is not a statement of the request',
      'numbered rule without a number range',
      'no written form has a word the registered name lacks',
      'basis does not name the written form and the registered name',
      'basis does not name the written form and the registered name',
      'invalid with the kept rules: Rule model-1: invalid number range',
      'maps no written place to exactly one record',
      'maps no written place to exactly one record',
      'maps no written place to exactly one record',
    ]);
    expect(outcome.dropped[0].rule).toBe('not a rule');
  });

  test('leaves the record kind out when the names cover several kinds, and reads missing rule lists as empty', () => {
    const registry = [...REGISTRY, entry('z2f', 'feature', '23-2 구역')];
    const outcome = assemblePlaceAliasProposal(
      planOf(registry),
      ledgerOf(registry),
      request,
      [{ rules: [rule()] }, { rules: [rule()] }],
      '2026-10-28T00:00:00.000Z',
    );
    expect(outcome.table!.rules[0].recordKind).toBeUndefined();
    expect(
      assemblePlaceAliasProposal(
        planOf(),
        ledgerOf(),
        request,
        [null, { rules: 'x' }],
        'now',
      ),
    ).toEqual({ table: null, dropped: [] });
  });
});

describe('proposePlaceAliases', () => {
  const model = { modelId: 'mock' } as unknown as Ai.LanguageModel;
  beforeEach(() => vi.mocked(generateText).mockReset());

  test('sends two runs and keeps the rules both gave alike', async () => {
    vi.mocked(generateText).mockResolvedValue({
      output: { rules: [rule()] },
      usage: { totalTokens: 10 },
      finishReason: 'stop',
    } as never);
    const result = await proposePlaceAliases(planOf(), ledgerOf(), request, {
      model,
      now: () => new Date('2026-10-28T01:00:00.000Z'),
    });
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(vi.mocked(generateText).mock.calls[0][0]).toMatchObject({
      system: request.systemPrompt,
      prompt: request.userPrompt,
      maxRetries: 0,
    });
    expect(result.status).toBe('proposed');
    expect(result.calls.map((c) => [c.run, c.status, c.finishReason])).toEqual([
      ['r1', 'completed', 'stop'],
      ['r2', 'completed', 'stop'],
    ]);
    expect(result.table!.confirmedAt).toBe('2026-10-28T01:00:00.000Z');
    expect(result.table!.rules).toHaveLength(1);
  });

  test('proposes no table when a run fails, and defaults the time to now', async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({ output: { rules: [rule()] } } as never)
      .mockRejectedValueOnce(new Error('rate limited'));
    const failed = await proposePlaceAliases(planOf(), ledgerOf(), request, {
      model,
      maxRetries: 1,
    });
    expect(failed.status).toBe('failed');
    expect(failed.table).toBeNull();
    expect(failed.calls[1]).toMatchObject({
      status: 'failed',
      error: 'rate limited',
    });

    vi.mocked(generateText)
      .mockResolvedValueOnce({ output: { rules: [] } } as never)
      .mockRejectedValueOnce('boom');
    expect(
      (await proposePlaceAliases(planOf(), ledgerOf(), request, { model }))
        .calls[1].error,
    ).toBe('boom');

    vi.mocked(generateText).mockResolvedValue({
      output: { rules: [] },
    } as never);
    const empty = await proposePlaceAliases(planOf(), ledgerOf(), request, {
      model,
    });
    expect(empty).toMatchObject({ status: 'proposed', table: null });
  });
});
