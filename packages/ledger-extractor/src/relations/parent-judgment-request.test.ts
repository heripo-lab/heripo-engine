import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { ArchaeologyLedgerResult } from '../ledger/archaeology-ledger';
import type { RelationParents } from './relation-parents';

import { describe, expect, test } from 'vitest';

import {
  RELATION_PARENT_JUDGMENT_VERSION,
  createRelationParentRequests,
  createRelationParentSchema,
} from './parent-judgment-request';

const record = (
  id: string,
  recordKind: string,
  sourceName: string,
  sourceIdentifier: string | undefined,
  ordinal: number,
  content: string[] = [],
) => ({
  id,
  recordKind,
  sourceName,
  ...(sourceIdentifier ? { sourceIdentifier } : {}),
  ordinal,
  content: content.map((text) => ({ text })),
});
const long = '가'.repeat(400);
const ledger = {
  records: [
    record('a1', 'artifact', '청자발', '마도23-1', 2),
    record('a2', 'artifact', '접시', '2', 1),
    record('z1', 'area', '23-1 구역', undefined, 3, [long]),
    record('z2', 'area', '구역', '23-2', 4, ['짧은 설명']),
    record('z3', 'area', '발굴조사', undefined, 5, [
      '조사 개요',
      '23-1구역부터 23-6구역까지 전면 조사',
      '23-1~6구역 범위',
    ]),
    record('z4', 'area', '발굴 지점', undefined, 8, ['설명']),
    record('a9', 'artifact', '구역 표본', undefined, 6),
    record('t1', 'trench', '트렌치', '1', 0),
    record('n1', 'layer', 'Ⅰ', undefined, 7),
  ],
  sources: [
    {
      recordId: 'a1',
      locator: 'b1#250-260',
      excerpt: 'x',
      charStart: 250,
      charEnd: 260,
    },
    {
      recordId: 'a1',
      locator: 'b2#0-4',
      excerpt: '짧은글',
      charStart: 0,
      charEnd: 4,
    },
    {
      recordId: 'a1',
      locator: 'b2#0-4',
      excerpt: '짧은글',
      charStart: 0,
      charEnd: 4,
    },
    {
      recordId: 'a1',
      locator: 'missing#0-2',
      excerpt: '원문',
      charStart: 0,
      charEnd: 2,
    },
    {
      recordId: 'a2',
      locator: 'missing#0-2',
      excerpt: '접시 설명',
      charStart: 0,
      charEnd: 2,
    },
  ],
} as unknown as ArchaeologyLedgerResult;
const plan = {
  units: [
    {
      sources: [
        {
          resource: {
            key: 'b1',
            data: { text: `${'앞'.repeat(250)}${'뒤'.repeat(300)}` },
          },
        },
        { resource: { key: 'b2', data: { text: '짧은글입니다' } } },
      ],
    },
  ],
} as unknown as ContentAttachmentPlan;
const parents = {
  questions: [
    {
      recordId: 'a1',
      reasons: ['unmatched_place'],
      candidateRecordIds: ['t1'],
      signals: [
        {
          kind: 'phrase',
          targetRecordIds: [],
          text: '출수위치 발굴 1구역',
          place: '발굴 1구역',
          finding: true,
          locator: 'b9#0-9',
        },
        {
          kind: 'phrase',
          targetRecordIds: ['t1'],
          text: '1트렌치에서 출토',
          place: '1트렌치',
        },
        { kind: 'phrase', targetRecordIds: [], text: '조사 중 출토' },
        {
          kind: 'chapter_title',
          targetRecordIds: ['t1'],
          text: '1) 1트렌치',
          chapterId: 'ch-1',
        },
      ],
    },
    {
      recordId: 'a2',
      reasons: ['unmatched_place'],
      candidateRecordIds: [],
      signals: [
        {
          kind: 'phrase',
          targetRecordIds: [],
          text: '외곽에서 출토',
          place: '외곽',
        },
      ],
    },
  ],
} as unknown as RelationParents;

describe('createRelationParentRequests', () => {
  test('builds batches in ledger order with signal candidates, spelling candidates and block context', () => {
    const [request] = createRelationParentRequests(plan, ledger, parents);

    expect(request.version).toBe(RELATION_PARENT_JUDGMENT_VERSION);
    expect(request.batchId).toBe('parents-1');
    expect(request.questions).toEqual([
      {
        ref: 'Q1',
        recordId: 'a2',
        candidateRefs: [],
        evidenceRefs: ['E1', 'E2'],
        contextRefs: [],
      },
      {
        ref: 'Q2',
        recordId: 'a1',
        candidateRefs: ['R1', 'R2'],
        evidenceRefs: ['E3', 'E4', 'E5', 'E6', 'E7', 'E8'],
        contextRefs: ['K1', 'K2'],
      },
    ]);
    expect(request.candidates).toEqual([
      { ref: 'R1', recordId: 't1' },
      { ref: 'R2', recordId: 'z1' },
    ]);
    expect(request.contexts).toEqual([
      { ref: 'K1', recordId: 'z3' },
      { ref: 'K2', recordId: 'z4' },
    ]);
    expect(request.userPrompt).toContain(
      'Context (not candidates):\nK1 [area] 발굴조사\n  23-1~6구역 범위\n  23-1구역부터 23-6구역까지 전면 조사\nK2 [area] 발굴 지점\n  설명\n',
    );
    expect(request.userPrompt).toContain('  context: K1, K2\n');
    expect(request.evidence[2]).toEqual({
      ref: 'E3',
      questionRef: 'Q2',
      kind: 'phrase',
      text: '출수위치 발굴 1구역',
      locator: 'b9#0-9',
    });
    expect(request.evidence[5]).toMatchObject({
      kind: 'chapter_title',
      chapterId: 'ch-1',
    });
    expect(request.evidence.map((e) => e.text).slice(6)).toEqual([
      `${'앞'.repeat(145)}${'뒤'.repeat(155)}`,
      '짧은글입니다',
    ]);
    expect(request.evidence[1].text).toBe('접시 설명');
    expect(request.userPrompt).toContain('R1 [trench] 1 트렌치\n');
    expect(request.userPrompt).toContain(
      `R2 [area] 23-1 구역 — ${long.slice(0, 160)}…`,
    );
    expect(request.userPrompt).toContain(
      'Q1 [artifact] 2 접시\n  candidates: none',
    );
    expect(request.userPrompt).toContain('Q2 [artifact] 마도23-1 청자발');
    expect(request.userPrompt).toContain('  E6 chapter title: 1) 1트렌치');
    expect(request.providerOutputSchema).toEqual(
      createRelationParentSchema(['Q1', 'Q2']),
    );
  });

  test('splits batches and caps candidates', () => {
    const wide = {
      questions: [
        {
          ...parents.questions[0],
          signals: [
            {
              kind: 'phrase',
              targetRecordIds: [],
              text: '구역에서 출토',
              place: '구역',
            },
          ],
        },
        { ...parents.questions[1], candidateRecordIds: ['t1'] },
      ],
    } as unknown as RelationParents;

    const all = createRelationParentRequests(plan, ledger, wide);
    const capped = createRelationParentRequests(plan, ledger, wide, {
      batchSize: 1,
      maxCandidates: 2,
    });

    expect(all[0].questions[1].candidateRefs).toEqual(['R1', 'R2', 'R3']);
    expect(all[0].candidates.map((c) => c.recordId)).toEqual([
      't1',
      'z1',
      'z2',
    ]);
    expect(capped.map((r) => r.batchId)).toEqual(['parents-1', 'parents-2']);
    expect(capped[1].questions[0].candidateRefs).toEqual(['R1', 'R2']);
    expect(capped[1].userPrompt).toContain('R2 [area] 23-1 구역');
  });
  test('shares context records between questions of a batch', () => {
    const question = (recordId: string) => ({
      recordId,
      reasons: ['unmatched_place'],
      candidateRecordIds: ['z1'],
      signals: [
        {
          kind: 'phrase',
          targetRecordIds: [],
          text: '출수위치 발굴 9구역',
          place: '발굴 9구역',
          finding: true,
        },
      ],
    });

    const [request] = createRelationParentRequests(plan, ledger, {
      questions: [question('a1'), question('a2')],
    } as unknown as RelationParents);

    expect(request.contexts.map((c) => c.recordId)).toEqual(['z3', 'z4']);
    expect(request.questions.map((q) => q.contextRefs)).toEqual([
      ['K1', 'K2'],
      ['K1', 'K2'],
    ]);
  });
});
