import type { ContentAttachmentWordEvidenceSnapshot } from '../recipients/word-evidence';
import type { ContentAttachmentIndependentMember } from './independent-review-types';
import type { ContentAttachmentReviewSegment } from './segment-review';

import { expect, test } from 'vitest';

import { resolveContentAttachmentWordRange } from '../recipients/word-evidence';
import {
  inspectContentAttachmentSegmentDecisions,
  inspectContentAttachmentSegments,
} from './segment-review';

function fixture() {
  const text = '범위 측량 TR7 제토';
  const snapshot: ContentAttachmentWordEvidenceSnapshot = {
    version: 'word-ranges.v1',
    sources: [
      {
        ref: 'E1',
        originalRef: 'E1',
        kind: 'excerpt',
        text,
        resourceKey: '/table/cell',
        words: [...text.matchAll(/\S+/g)].map((m, i) => ({
          ref: `W${i + 1}`,
          charStart: m.index,
          charEnd: m.index + m[0].length,
        })),
        evidence: [],
      },
    ],
  };
  const segments: ContentAttachmentReviewSegment[] = [
    { kind: 'substantive', wordRanges: ['E1:W1-W2'] },
    { kind: 'substantive', wordRanges: ['E1:W3-W4'] },
  ];
  const member: ContentAttachmentIndependentMember = {
    attachment: 'included',
    relationshipSubject: 'not_alternative',
    contextRef: 'E1',
    candidateEvidenceRefs: ['K1.1'],
    reason: 'Area boundary work',
    wordRanges: ['E1:W1-W2'],
    segmentDecisions: [
      {
        segment: 1,
        attachment: 'included',
        relationshipSubject: 'not_alternative',
        reason: 'Area own survey',
      },
      {
        segment: 2,
        attachment: 'excluded',
        relationshipSubject: 'not_alternative',
        reason: 'Local trench work',
      },
    ],
  };
  const inspect = (answer = member, plan = segments) =>
    inspectContentAttachmentSegmentDecisions(
      inspectContentAttachmentSegments(snapshot, 'E1', plan),
      answer,
      answer.wordRanges!.map((range) =>
        resolveContentAttachmentWordRange(snapshot, range, 'E1'),
      ),
    );
  return { snapshot, segments, member, inspect };
}

test('preserves separate area and local actions, shared predicates and exact evidence without changing a source or judgment', () => {
  const { snapshot, segments, member, inspect } = fixture();
  const before = structuredClone({ snapshot, segments, member });
  const findings = inspect();
  expect(
    findings.map((f) => [f.segment, f.evidence[0].text, f.decision.attachment]),
  ).toEqual([
    [1, '범위 측량', 'included'],
    [2, 'TR7 제토', 'excluded'],
  ]);
  expect({ snapshot, segments, member }).toEqual(before);
  const local = structuredClone(member);
  local.segmentDecisions!.reverse();
  for (const d of local.segmentDecisions!)
    d.attachment = d.segment === 2 ? 'included' : 'excluded';
  local.wordRanges = ['E1:W3-W4'];
  expect(inspect(local)[1].decision.attachment).toBe('included');
  expect(
    inspectContentAttachmentSegments(snapshot, 'E1', [
      { kind: 'substantive', wordRanges: ['E1:W1-W2', 'E1:W4-W4'] },
      { kind: 'substantive', wordRanges: ['E1:W3-W4'] },
    ]),
  ).toHaveLength(2);
});

test('rejects omitted words, copied sources, invalid ranges and duplicate segments without guessing the missing action', () => {
  const { snapshot, segments } = fixture();
  for (const plan of [
    [segments[1]],
    [{ kind: 'substantive', wordRanges: ['E1:W1-W99'] }],
    [segments[0], segments[0], segments[1]],
    [{ ...segments[0], wordRanges: ['E1:W1-W2', 'E1:W1-W2'] }, segments[1]],
  ])
    expect(() =>
      inspectContentAttachmentSegments(
        snapshot,
        'E1',
        plan as ContentAttachmentReviewSegment[],
      ),
    ).toThrow();
  snapshot.sources.push({
    ...snapshot.sources[0],
    ref: 'X1',
    kind: 'read_only',
  });
  expect(() =>
    inspectContentAttachmentSegments(snapshot, 'E1', [
      { kind: 'substantive', wordRanges: ['X1:W1-W4'] },
    ]),
  ).toThrow('another source');
  snapshot.sources[0].words = [];
  expect(inspectContentAttachmentSegments(snapshot, 'E1', [])).toEqual([]);
});

test('requires every segment verdict once and rejects contradictory inclusion, role and unsupported action evidence', () => {
  const { member, inspect } = fixture();
  for (const ids of [[1], [1, 1], [1, 3], [0, 2]]) {
    const invalid = structuredClone(member);
    invalid.segmentDecisions = ids.map((segment) => ({
      ...member.segmentDecisions![0],
      segment,
    }));
    expect(() => inspect(invalid)).toThrow('Incomplete');
  }
  const invalid = structuredClone(member);
  invalid.attachment = 'excluded';
  expect(() => inspect(invalid)).toThrow('aggregate');
  invalid.attachment = 'included';
  invalid.relationshipSubject = 'alternative';
  expect(() => inspect(invalid)).toThrow('aggregate');
  invalid.relationshipSubject = 'not_alternative';
  invalid.wordRanges = ['E1:W3-W4'];
  expect(() => inspect(invalid)).toThrow('Missing segment evidence');
});

test('keeps excluded segment reasons, recipient uncertainty, independent role uncertainty and non-substantive exclusions', () => {
  const { member, inspect, segments } = fixture();
  const excluded = structuredClone(member);
  excluded.attachment = 'excluded';
  excluded.wordRanges = [];
  excluded.segmentDecisions![0].attachment = 'excluded';
  expect(inspect(excluded)[0].decision.reason).toBe('Area own survey');
  const unresolved = structuredClone(member);
  unresolved.attachment = 'unresolved';
  unresolved.segmentDecisions![0].attachment = 'unresolved';
  expect(inspect(unresolved)[0].decision.attachment).toBe('unresolved');
  unresolved.relationshipSubject = 'alternative';
  unresolved.segmentDecisions![0].relationshipSubject = 'alternative';
  expect(inspect(unresolved)[0].decision.relationshipSubject).toBe(
    'alternative',
  );
  unresolved.attachment = 'excluded';
  unresolved.segmentDecisions![0].attachment = 'excluded';
  expect(inspect(unresolved)[0].decision.relationshipSubject).toBe(
    'alternative',
  );
  segments[0].kind = 'non_substantive';
  expect(() => inspect(member)).toThrow('Non-substantive');
  expect(inspect(excluded)[0].kind).toBe('non_substantive');
});
