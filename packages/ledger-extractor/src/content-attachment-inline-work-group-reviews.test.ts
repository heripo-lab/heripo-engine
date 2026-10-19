import type {
  ContentAttachmentWorkScopeAssessment,
  ContentAttachmentWorkTarget,
} from './content-attachment-work-scope';

import { expect, test, vi } from 'vitest';

import { inspectContentAttachmentWorkGroupReviews } from './content-attachment-work-group-reviews';
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
function target(
  refs: string[],
  established = false,
): ContentAttachmentWorkTarget {
  return {
    targetIdentification: {
      candidateRefs: refs,
      currentWordRanges: ['E1:W1-W2'],
      contextWordRanges: ['E2:W1-W2'],
      candidateEvidenceRefs: refs.map((r) => 'K' + r),
      originRowRefs: [],
    },
    operationCoverage: {
      state: established ? 'established' : 'not_established',
      supportingWordRanges: established ? ['E1:W1-W2'] : [],
      consideredWordRanges: ['E2:W1-W2'],
      reason:
        'A source-defined set does not alone establish this operation on all members.',
    },
  };
}
function assessment(): ContentAttachmentWorkScopeAssessment {
  return {
    state: 'operation',
    currentWordRanges: ['E1:W1-W2'],
    targetGroups: [target(['R1'], true)],
    groupReviews: {
      G1: {
        relevance: 'relevant',
        reason: 'Source-linked trench boundary work.',
        fullGroupAssessment: target(['R3', 'R2']),
      },
      G2: {
        relevance: 'not_relevant',
        reason: 'No source-supported feature work target.',
      },
    },
    reason:
      'Independent area work and a separately reviewed full trench group.',
  };
}
const schema = () =>
  createContentAttachmentWorkScopeSchema(
    ['R1', 'R2', 'R3', 'R4'],
    ['G1', 'G2'],
    false,
    true,
  );
function inspect(a: ContentAttachmentWorkScopeAssessment, refs = ['R1']) {
  inspectContentAttachmentWorkGroupReviews(groups, a, refs, true);
  inspectContentAttachmentWorkScope(a, refs, vi.fn(), true);
}

test('keeps independent area and supported subset attachments while requiring an inline full group with unestablished coverage', () => {
  const a = assessment();
  expect(schema().safeParse(a).success).toBe(true);
  inspect(a);
  a.targetGroups.push(target(['R2'], true));
  const before = JSON.stringify(a);
  inspect(a, ['R1', 'R2']);
  expect(JSON.stringify(a)).toBe(before);
  expect(
    a.targetGroups.map((t) => t.targetIdentification.candidateRefs),
  ).toEqual([['R1'], ['R2']]);
});

test.each([
  [
    'missing group key',
    (a: ContentAttachmentWorkScopeAssessment) => {
      delete a.groupReviews!.G1;
    },
  ],
  [
    'extra group key',
    (a: ContentAttachmentWorkScopeAssessment) => {
      a.groupReviews!.G99 = a.groupReviews!.G1;
    },
  ],
  [
    'missing full object',
    (a: ContentAttachmentWorkScopeAssessment) => {
      delete a.groupReviews!.G1.fullGroupAssessment;
    },
  ],
  [
    'index only',
    (a: ContentAttachmentWorkScopeAssessment) => {
      delete a.groupReviews!.G1.fullGroupAssessment;
      a.groupReviews!.G1.targetGroupIndexes = [1];
    },
  ],
  [
    'extra index',
    (a: ContentAttachmentWorkScopeAssessment) => {
      a.groupReviews!.G1.targetGroupIndexes = [0];
    },
  ],
  [
    'empty full object',
    (a: ContentAttachmentWorkScopeAssessment) => {
      a.groupReviews!.G1.fullGroupAssessment = {} as never;
    },
  ],
  [
    'missing identification',
    (a: ContentAttachmentWorkScopeAssessment) => {
      delete (
        a.groupReviews!.G1
          .fullGroupAssessment as Partial<ContentAttachmentWorkTarget>
      ).targetIdentification;
    },
  ],
  [
    'missing coverage',
    (a: ContentAttachmentWorkScopeAssessment) => {
      delete (
        a.groupReviews!.G1
          .fullGroupAssessment as Partial<ContentAttachmentWorkTarget>
      ).operationCoverage;
    },
  ],
  [
    'missing candidate grounds',
    (a: ContentAttachmentWorkScopeAssessment) => {
      a.groupReviews!.G1.fullGroupAssessment!.targetIdentification.candidateEvidenceRefs =
        [];
    },
  ],
  [
    'missing reason',
    (a: ContentAttachmentWorkScopeAssessment) => {
      a.groupReviews!.G1.reason = '';
    },
  ],
  [
    'irrelevant full object',
    (a: ContentAttachmentWorkScopeAssessment) => {
      a.groupReviews!.G2.fullGroupAssessment = target(['R4']);
    },
  ],
])('rejects %s structurally without repairing attachments', (_, mutate) => {
  const a = assessment();
  mutate(a);
  const before = JSON.stringify(a);
  expect(schema().safeParse(a).success).toBe(false);
  expect(JSON.stringify(a)).toBe(before);
  expect(a.targetGroups[0].targetIdentification.candidateRefs).toEqual(['R1']);
});

test.each([['R2'], ['R2', 'R4'], ['R2', 'R2']])(
  'rejects incomplete, foreign or duplicate full group members %j',
  (...refs) => {
    const a = assessment();
    a.groupReviews!.G1.fullGroupAssessment = target(refs);
    expect(schema().safeParse(a).success).toBe(true);
    const before = JSON.stringify(a);
    expect(() => inspect(a)).toThrow('G1: Full work group member mismatch');
    expect(JSON.stringify(a)).toBe(before);
  },
);

test('checks full-group provenance, considered grounds, positive support and final recipient consistency', () => {
  const a = assessment();
  const full = a.groupReviews!.G1.fullGroupAssessment!;
  full.operationCoverage.consideredWordRanges = [];
  expect(() => inspect(a)).toThrow(
    'Full work group lacks considered coverage evidence',
  );
  full.operationCoverage.consideredWordRanges = ['E2:W1-W2'];
  const resolve = vi.fn().mockImplementation((_, refs: string[]) => {
    if (refs.includes('R3')) throw new Error('Missing candidate grounds');
  });
  expect(() =>
    inspectContentAttachmentWorkScope(a, ['R1'], resolve, true),
  ).toThrow('Missing candidate grounds');
  full.operationCoverage.supportingWordRanges = ['E1:W1-W2'];
  expect(() => inspect(a)).toThrow(
    'Unestablished operation asserts supporting evidence',
  );
  full.operationCoverage.supportingWordRanges = [];
  expect(() => inspect(a, ['R1', 'R2', 'R3'])).toThrow(
    'Unestablished operation attaches entire target group',
  );
  full.operationCoverage.state = 'established';
  expect(() => inspect(a, ['R1', 'R2', 'R3'])).toThrow(
    'Established operation lacks coverage evidence',
  );
  full.operationCoverage.supportingWordRanges = ['E1:W1-W2'];
  inspect(a, ['R1', 'R2', 'R3']);
  expect(() => inspect(a, ['R1', 'R4'])).toThrow(
    'G2: Irrelevant work group attaches all members',
  );
});

test('allows an explicit irrelevant verdict without a phantom full object and retains independent area work', () => {
  const a = assessment();
  a.groupReviews!.G1 = {
    relevance: 'not_relevant',
    reason:
      'The source identifies the area fence, without linking it to trench targets.',
  };
  expect(schema().safeParse(a).success).toBe(true);
  inspect(a);
  expect(a.targetGroups[0].targetIdentification.candidateRefs).toEqual(['R1']);
});

test('keeps non-work and empty-inventory contracts explicit', () => {
  const a = assessment();
  a.state = 'not_applicable';
  a.targetGroups = [];
  a.groupReviews = {};
  expect(schema().safeParse(a).success).toBe(true);
  inspect(a, []);
  a.state = 'operation';
  expect(
    createContentAttachmentWorkScopeSchema(['R1'], [], false, true).safeParse(a)
      .success,
  ).toBe(true);
  inspectContentAttachmentWorkGroupReviews([], a, [], true);
  inspectContentAttachmentWorkScope(a, [], vi.fn(), true);
});
