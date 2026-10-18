import { expect, test } from 'vitest';

import { retrieveContentAttachmentReviewReferents } from './content-attachment-review-retrieval';

type Input = Parameters<typeof retrieveContentAttachmentReviewReferents>[0];

function fixture(name = 'Road'): Input {
  return {
    bodyCandidateContexts: [['remote', 'other']],
    payload: {
      candidates: [['remote', 'feature', 'other', name, null, []]],
      current: {
        excerpts: [
          ['first', 'text', ['local'], [], 'A road crosses the boundary.'],
          ['continuation', 'text', ['local'], [], 'Its width is recorded.'],
          ['unrelated', 'text', ['local'], [], 'An unrelated passage.'],
        ],
        bodyBlocks: [['block', ['first', 'continuation']]],
      },
    },
  };
}

test('recovers a source-named referent across chapters within its original block, retaining exact evidence and deduplicating registrations', () => {
  const input = fixture();
  input.payload.candidates.push(...structuredClone(input.payload.candidates));
  input.payload.candidates.push([
    'table-only',
    'feature',
    'other',
    'road',
    null,
    [],
  ]);
  input.payload.candidates.push([
    'remote',
    'feature',
    'table-context',
    'width',
    null,
    [],
  ]);
  const before = structuredClone(input);
  const matches = retrieveContentAttachmentReviewReferents(input);
  expect(matches).toEqual(
    ['first', 'continuation'].map((excerptRef) => ({
      excerptRef,
      contextExcerptRefs: ['first', 'continuation'],
      candidateRef: 'remote',
      contextRef: 'other',
      sourceName: 'Road',
    })),
  );
  expect(input).toEqual(before);
});

test.each([
  ['도로', '백제 도 로의 관계', true],
  ['6) 도로', '도로의 관계', true],
  ['原地盤層', '原地盤層の記録', true],
  ['층위', '층위'.normalize('NFD'), true],
  ['Wall (A)', 'The wall (A) is recorded.', true],
  ['A+B', 'A+B', true],
  ['1호', '11호', false],
  ['1호', '1호', true],
  ['TR1', 'TR12', false],
  ['TR1', 'TR1', true],
  ['1호 수혈', '11호 수혈', false],
  ['1호 수혈', '11호 수혈, 1호 수혈', true],
  ['Pit', 'capital', false],
  ['Pit', 'pitfall', false],
  ['Pit', 'pit', true],
  ['구', '구', false],
  ['123', '123', false],
  ['Road', 'Different text', false],
])(
  'matches literal source name %s against %s without turning retrieval into identity judgment',
  (name, text, found) => {
    const input = fixture(name);
    input.payload.current.bodyBlocks = [];
    input.payload.current.excerpts = [
      ['fragment', 'text', ['local'], [], text],
    ];
    expect(retrieveContentAttachmentReviewReferents(input).length).toBe(
      found ? 1 : 0,
    );
  },
);

test('retrieves explicit source identifiers without using opaque ref suffixes or bare quantities', () => {
  const input = fixture('Trench');
  input.payload.current.bodyBlocks = [];
  input.payload.current.excerpts = [
    ['numbered', 'text', ['local'], [], 'TR4 was recorded.'],
  ];
  input.payload.candidates[0][4] = 'TR4';
  expect(retrieveContentAttachmentReviewReferents(input)).toEqual([
    {
      excerptRef: 'numbered',
      contextExcerptRefs: ['numbered'],
      candidateRef: 'remote',
      contextRef: 'other',
      sourceName: 'Trench',
      matchedIdentifier: 'TR4',
    },
  ]);
  input.payload.candidates[0][4] = 'TR5';
  expect(retrieveContentAttachmentReviewReferents(input)).toEqual([]);
  input.payload.current.excerpts = [
    ['numbered', 'text', ['local'], [], '1호와 중복'],
  ];
  input.payload.candidates[0][4] = '1호';
  expect(retrieveContentAttachmentReviewReferents(input)).toEqual([]);
  input.payload.current.excerpts = [
    ['numbered', 'text', ['local'], [], 'A quantity of 4.'],
  ];
  input.payload.candidates[0][4] = '4';
  expect(retrieveContentAttachmentReviewReferents(input)).toEqual([]);
});
