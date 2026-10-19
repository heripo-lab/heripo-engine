import type { ContentAttachmentWorkScopeAssessment } from './content-attachment-work-scope';

import { expect, test, vi } from 'vitest';

import {
  createContentAttachmentWorkGroupReviewsSchema,
  createContentAttachmentWorkGroups,
  inspectContentAttachmentWorkGroupReviews,
} from './content-attachment-work-group-reviews';
import {
  createContentAttachmentWorkScopeSchema,
  inspectContentAttachmentWorkScope,
} from './content-attachment-work-scope';

const groups = [
  {
    ref: 'G1',
    inventoryRef: 'U1',
    recordKind: 'trench',
    candidateRefs: ['R2', 'R3'],
  },
  {
    ref: 'G2',
    inventoryRef: 'U1',
    recordKind: 'feature',
    candidateRefs: ['R4'],
  },
];
function assessment(): ContentAttachmentWorkScopeAssessment {
  const target = (refs: string[], established = false) => ({
    targetIdentification: {
      candidateRefs: refs,
      currentWordRanges: ['E1:W1-W2'],
      contextWordRanges: [],
      candidateEvidenceRefs: refs.map((r) => 'K' + r),
      originRowRefs: [],
    },
    operationCoverage: {
      state: established
        ? ('established' as const)
        : ('not_established' as const),
      supportingWordRanges: established ? ['E1:W1-W2'] : [],
      consideredWordRanges: [],
      reason:
        'Original set definition alone does not establish whole-set work.',
    },
  });
  return {
    state: 'operation',
    currentWordRanges: ['E1:W1-W2'],
    targetGroups: [target(['R1'], true), target(['R3', 'R2'])],
    groupReviews: {
      G1: {
        relevance: 'relevant',
        targetGroupIndexes: [1],
        reason: 'Review the original trench set.',
      },
      G2: {
        relevance: 'not_relevant',
        targetGroupIndexes: [],
        reason: 'No work connection to this feature inventory.',
      },
    },
    reason: 'Independent area work with unestablished whole-trench coverage.',
  };
}
const schema = () =>
  createContentAttachmentWorkScopeSchema(
    ['R1', 'R2', 'R3', 'R4'],
    ['G1', 'G2'],
  );

test('partitions original inventories by kind and preserves member order without chapter or answer filtering', () => {
  const input = {
    payload: {
      candidates: [
        ['R1', 'area'],
        ['R2', 'trench'],
        ['R3', 'trench'],
        ['R4', 'feature'],
        ['R2', 'trench'],
      ],
      inventoryMembers: [
        ['U1', ['R2', 'R4', 'R3', 'R2']],
        ['U2', []],
        ['U3', ['R4']],
      ],
    },
  } as unknown as Parameters<typeof createContentAttachmentWorkGroups>[0];
  const before = JSON.stringify(input);
  expect(createContentAttachmentWorkGroups(input)).toEqual([
    groups[0],
    groups[1],
    { ...groups[1], ref: 'G3', inventoryRef: 'U3' },
  ]);
  expect(JSON.stringify(input)).toBe(before);
  input.payload.inventoryMembers = [['U1', ['missing']]];
  expect(() => createContentAttachmentWorkGroups(input)).toThrow(
    'Unknown work-group member: missing',
  );
  input.payload.candidates.push(['R2', 'feature']);
  expect(() => createContentAttachmentWorkGroups(input)).toThrow(
    'Inconsistent registered work-group kind: R2',
  );
});

test('keeps independent R1 attachment, full-group unestablished review and original response unchanged', () => {
  const a = assessment(),
    attachments = ['R1'],
    before = JSON.stringify({ a, attachments });
  expect(schema().safeParse(a).success).toBe(true);
  inspectContentAttachmentWorkGroupReviews(groups, a, attachments);
  inspectContentAttachmentWorkScope(a, attachments, vi.fn());
  expect(JSON.stringify({ a, attachments })).toBe(before);
});

test.each([
  [
    'missing key',
    (a: ContentAttachmentWorkScopeAssessment) => {
      delete a.groupReviews!.G1;
    },
  ],
  [
    'extra key',
    (a: ContentAttachmentWorkScopeAssessment) => {
      a.groupReviews!.G99 = a.groupReviews!.G1;
    },
  ],
  [
    'empty relevant references',
    (a: ContentAttachmentWorkScopeAssessment) => {
      a.groupReviews!.G1.targetGroupIndexes = [];
    },
  ],
  [
    'irrelevant references',
    (a: ContentAttachmentWorkScopeAssessment) => {
      a.groupReviews!.G2.targetGroupIndexes = [1];
    },
  ],
  [
    'missing reason',
    (a: ContentAttachmentWorkScopeAssessment) => {
      a.groupReviews!.G1.reason = '';
    },
  ],
  [
    'negative index',
    (a: ContentAttachmentWorkScopeAssessment) => {
      a.groupReviews!.G1.targetGroupIndexes = [-1];
    },
  ],
  [
    'fractional index',
    (a: ContentAttachmentWorkScopeAssessment) => {
      a.groupReviews!.G1.targetGroupIndexes = [0.5];
    },
  ],
  [
    'string index',
    (a: ContentAttachmentWorkScopeAssessment) => {
      a.groupReviews!.G1.targetGroupIndexes = ['1'] as never;
    },
  ],
])(
  'rejects %s in the schema without changing raw R1 recipients',
  (_, mutate) => {
    const a = assessment(),
      attachments = ['R1'];
    mutate(a);
    const before = JSON.stringify({ a, attachments });
    expect(schema().safeParse(a).success).toBe(false);
    expect(JSON.stringify({ a, attachments })).toBe(before);
  },
);

test.each([
  [[2], 'G1[2]: Work target index out of range'],
  [[0], 'G1[0]: Work group member mismatch'],
  [[1, 1], 'G1[1]: Duplicate work target index'],
])(
  'rejects broken references %j before cascading full-group checks',
  (indexes, message) => {
    const a = assessment();
    a.groupReviews!.G1.targetGroupIndexes = indexes;
    const before = JSON.stringify(a);
    expect(schema().safeParse(a).success).toBe(true);
    expect(() =>
      inspectContentAttachmentWorkGroupReviews(groups, a, ['R1']),
    ).toThrow(message);
    expect(JSON.stringify(a)).toBe(before);
  },
);

test('requires an explicitly referenced full set and permits separately supported proper subsets', () => {
  const a = assessment();
  a.targetGroups.push(structuredClone(a.targetGroups[1]));
  a.targetGroups[2].targetIdentification.candidateRefs = ['R2'];
  a.targetGroups[2].operationCoverage.state = 'established';
  a.targetGroups[2].operationCoverage.supportingWordRanges = ['E1:W1-W2'];
  a.groupReviews!.G1.targetGroupIndexes = [2];
  expect(() =>
    inspectContentAttachmentWorkGroupReviews(groups, a, ['R1']),
  ).toThrow('G1: Missing full work group assessment');
  a.groupReviews!.G1.targetGroupIndexes = [1, 2];
  inspectContentAttachmentWorkGroupReviews(groups, a, ['R1', 'R2']);
  inspectContentAttachmentWorkScope(a, ['R1', 'R2'], vi.fn());
});

test('does not let an irrelevant review conceal whole-group work attachment', () => {
  const a = assessment();
  a.groupReviews!.G1 = {
    relevance: 'not_relevant',
    targetGroupIndexes: [],
    reason: 'No link.',
  };
  inspectContentAttachmentWorkGroupReviews(groups, a, ['R1', 'R2']);
  expect(() =>
    inspectContentAttachmentWorkGroupReviews(groups, a, ['R1', 'R2', 'R3']),
  ).toThrow('G1: Irrelevant work group attaches all members');
});

test('keeps existing coverage inspection for relevant full groups', () => {
  const a = assessment();
  inspectContentAttachmentWorkGroupReviews(groups, a, ['R1', 'R2', 'R3']);
  expect(() =>
    inspectContentAttachmentWorkScope(a, ['R1', 'R2', 'R3'], vi.fn()),
  ).toThrow('Unestablished operation attaches entire target group');
});

test('requires empty review objects for non-work and inventories without groups', () => {
  const a = assessment();
  a.state = 'not_applicable';
  a.targetGroups = [];
  expect(schema().safeParse(a).success).toBe(false);
  a.groupReviews = {};
  expect(schema().safeParse(a).success).toBe(true);
  inspectContentAttachmentWorkGroupReviews(groups, a, ['R1']);
  inspectContentAttachmentWorkScope(a, ['R1'], vi.fn());
  a.state = 'operation';
  expect(
    createContentAttachmentWorkScopeSchema(['R1'], []).safeParse(a).success,
  ).toBe(true);
  inspectContentAttachmentWorkGroupReviews([], a, []);
  expect(
    createContentAttachmentWorkGroupReviewsSchema([]).safeParse({}).success,
  ).toBe(true);
});
