import type { ContentAttachmentAreaRecipientDecision } from './content-attachment-recipients';

import { expect, test } from 'vitest';

import { assembleContentAttachmentAreaRecipientDecision } from './content-attachment-area-recipient-assembly';

const kinds = new Map([
  ['A', 'area'],
  ['F', 'feature'],
  ['B', 'area'],
]);
function fixture(): ContentAttachmentAreaRecipientDecision {
  const support = {
    currentWordRanges: ['E1:W1-W2'],
    contextWordRanges: [],
    candidateEvidenceRefs: ['K1'],
    originRowRefs: ['O1'],
  };
  return {
    nonAreaAttachments: [{ candidateRef: 'F', ...support }],
    areaAssessments: {
      B: {
        disposition: 'excluded',
        ...support,
        reason: 'Not independently described.',
      },
      A: {
        disposition: 'included',
        ...support,
        reason: 'Direct area finding.',
      },
    },
    recipientIdentityAlternatives: [],
    relationshipSubjectAlternatives: [],
    reason: 'Synthetic source judgments.',
  };
}

test('assembles non-area and area recipients once in registry area order with auditable decision origins', () => {
  const raw = fixture();
  raw.areaAssessments.B.disposition = 'included';
  const before = JSON.stringify(raw);
  const result = assembleContentAttachmentAreaRecipientDecision(kinds, raw);
  expect(result.decision.attachments.map((a) => a.candidateRef)).toEqual([
    'F',
    'A',
    'B',
  ]);
  expect(result.attachmentOrigins).toEqual([
    { candidateRef: 'F', field: 'nonAreaAttachments', index: 0 },
    { candidateRef: 'A', field: 'areaAssessments', areaRef: 'A' },
    { candidateRef: 'B', field: 'areaAssessments', areaRef: 'B' },
  ]);
  expect(result.decision.attachments[1].originRowRefs).toEqual(['O1']);
  expect(result.decision).not.toHaveProperty('nonAreaAttachments');
  expect(raw).not.toHaveProperty('attachments');
  result.decision.attachments[1].currentWordRanges.push('E1:W3-W4');
  expect(JSON.stringify(raw)).toBe(before);
});

test.each(['missing', 'extra', 'foreign'] as const)(
  'rejects %s area keys rather than filling or interpreting them',
  (mode) => {
    const raw = fixture();
    if (mode === 'missing') delete raw.areaAssessments.A;
    else if (mode === 'extra') raw.areaAssessments.X = raw.areaAssessments.A;
    else {
      delete raw.areaAssessments.A;
      raw.areaAssessments.X = raw.areaAssessments.B;
    }
    const before = JSON.stringify(raw);
    expect(() =>
      assembleContentAttachmentAreaRecipientDecision(kinds, raw),
    ).toThrow('Area assessment keys differ from the registry');
    expect(JSON.stringify(raw)).toBe(before);
  },
);

test.each(['A', 'unknown'])(
  'rejects invalid non-area ref %s before creating final recipients',
  (ref) => {
    const raw = fixture();
    raw.nonAreaAttachments[0].candidateRef = ref;
    expect(() =>
      assembleContentAttachmentAreaRecipientDecision(kinds, raw),
    ).toThrow('Non-area attachment has an area or unknown candidate');
  },
);

test('retains explicit unresolved grouping without promoting it to confirmation', () => {
  const raw = fixture();
  raw.areaAssessments.A.disposition = 'unresolved';
  raw.areaAssessments.B.disposition = 'unresolved';
  raw.recipientIdentityAlternatives = [
    {
      candidateRefs: ['A', 'B'],
      currentWordRanges: ['E1:W1-W2'],
      contextWordRanges: [],
      candidateEvidenceRefs: ['K1', 'K2'],
      originRowRefs: ['O1'],
    },
  ];
  const before = JSON.stringify(raw);
  const result = assembleContentAttachmentAreaRecipientDecision(kinds, raw);
  expect(result.decision.attachments.map((a) => a.candidateRef)).toEqual(['F']);
  expect(result.decision.recipientIdentityAlternatives).toEqual(
    raw.recipientIdentityAlternatives,
  );
  expect(JSON.stringify(raw)).toBe(before);
});
