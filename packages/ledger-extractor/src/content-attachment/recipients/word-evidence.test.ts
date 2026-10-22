import { expect, test } from 'vitest';

import {
  contentAttachmentWordRows,
  createContentAttachmentWordEvidence,
  resolveContentAttachmentWordRange,
} from './word-evidence';

type Input = Parameters<typeof createContentAttachmentWordEvidence>[0];

function fixture(text = '\t😀 TR  8 제토.\n'): Input {
  const context = '\tRead-only context.\n';
  return {
    payload: {
      current: {
        excerpts: [['E1', 'text', ['C1'], null, text]],
        readOnlyContext: [['B1', ['C1'], context]],
      },
    },
    codeMap: {
      excerpts: [
        {
          ref: 'E1',
          evidence: [
            {
              sourceId: 'original',
              resourceKey: '/body/0',
              resourceId: 'body',
              sourceRefs: ['#/body/0'],
              pdfPageNo: 3,
              logicalPageRange: { startPageNo: -1, endPageNo: -1 },
              charStart: 17,
              charEnd: 17 + text.length,
              quote: text,
            },
          ],
        },
      ],
      supportingBody: [{ ref: 'B1', resourceKey: '/body/1', text: context }],
    },
  };
}

test('labels literal surface units in UTF-16 while preserving whitespace, punctuation, fragments and source offsets', () => {
  const input = fixture(),
    before = structuredClone(input);
  const snapshot = createContentAttachmentWordEvidence(input, new Set(['E1']));
  expect(contentAttachmentWordRows(snapshot.sources[0])).toEqual([
    ['W1', '😀'],
    ['W2', 'TR'],
    ['W3', '8'],
    ['W4', '제토.'],
  ]);
  const range = resolveContentAttachmentWordRange(snapshot, 'E1:W2-W4', 'E1');
  expect(range).toMatchObject({
    basis: 'direct',
    text: 'TR  8 제토.',
    charStart: 4,
    evidence: [
      {
        charStart: 21,
        charEnd: 30,
        quote: 'TR  8 제토.',
        logicalPageRange: { startPageNo: -1 },
      },
    ],
  });
  expect(snapshot.sources[0].text).toBe(input.payload.current.excerpts[0][4]);
  expect(
    resolveContentAttachmentWordRange(snapshot, 'E1:W1-W1', 'E2').basis,
  ).toBe('context');
  expect(
    resolveContentAttachmentWordRange(snapshot, 'X1:W1-W2', 'E1'),
  ).toMatchObject({
    basis: 'context',
    originalRef: 'B1',
    resourceKey: '/body/1',
    text: 'Read-only context.',
    evidence: [],
  });
  expect(input).toEqual(before);
});

test.each([
  'E1:W0-W1',
  'E1:W1-W0',
  'E9:W1-W1',
  'E1:W99-W99',
  'E1:W3-W2',
  'X1:W1-W99',
  'invented words',
])('rejects %s without altering original ranges', (range) => {
  const input = fixture();
  const snapshot = createContentAttachmentWordEvidence(input, new Set(['E1']));
  expect(() =>
    resolveContentAttachmentWordRange(snapshot, range, 'E1'),
  ).toThrow();
});

test('keeps absent and whitespace-only sources deterministic without interpreting unspaced languages or decimals', () => {
  expect(
    createContentAttachmentWordEvidence(fixture(), new Set()).sources.map(
      (s) => s.ref,
    ),
  ).toEqual(['X1']);
  const empty = createContentAttachmentWordEvidence(
    fixture(' \n'),
    new Set(['E1']),
  );
  expect(contentAttachmentWordRows(empty.sources[0])).toEqual([]);
  expect(() =>
    resolveContentAttachmentWordRange(empty, 'E1:W1-W1', 'E1'),
  ).toThrow();
  const literal = createContentAttachmentWordEvidence(
    fixture('道路調査 1.25m (fragment'),
    new Set(['E1']),
  );
  expect(contentAttachmentWordRows(literal.sources[0])).toEqual([
    ['W1', '道路調査'],
    ['W2', '1.25m'],
    ['W3', '(fragment'],
  ]);
});

test('rejects altered excerpt and read-only bindings rather than repairing original source text', () => {
  const variants = [
    fixture(),
    fixture(),
    fixture(),
    fixture(),
    fixture(),
    fixture(),
  ];
  variants[0].codeMap.excerpts = [];
  variants[1].codeMap.excerpts[0].evidence = [];
  variants[2].codeMap.excerpts[0].evidence[0].quote = 'Invented';
  variants[3].codeMap.excerpts[0].evidence[0].charEnd++;
  variants[4].codeMap.supportingBody = [];
  variants[5].codeMap.supportingBody[0].text = 'Rewritten context';
  for (const input of variants)
    expect(() =>
      createContentAttachmentWordEvidence(input, new Set(['E1'])),
    ).toThrow('Word evidence differs');
});
