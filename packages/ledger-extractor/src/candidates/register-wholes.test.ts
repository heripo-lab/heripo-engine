import type {
  CandidateDiscoveryPlan,
  CandidateDiscoveryResult,
  CandidateDiscoveryUnit,
  LedgerObjectCandidate,
} from './discovery-types';

import { describe, expect, test } from 'vitest';

import {
  REGISTER_WHOLE_REASON,
  proposeRegisterWholeCandidates,
  withRegisterWholeCandidates,
} from './register-wholes';

const text = (key: string, value: string) => ({
  kind: 'text' as const,
  key,
  resourceId: key,
  sourceRefs: [`#${key}`],
  chapterIds: ['ch'],
  pdfPageNo: 5,
  logicalPageRange: null,
  data: { text: value, pdfPageNo: 5 },
});
const cell = (
  tableId: string,
  rowIndex: number,
  columnIndex: number,
  value: string,
) => ({
  kind: 'tableCell' as const,
  key: `/${tableId}/${rowIndex}/${columnIndex}`,
  resourceId: null,
  sourceRefs: [],
  chapterIds: ['appendix'],
  pdfPageNo: 90,
  logicalPageRange: null,
  tableId,
  rowIndex,
  columnIndex,
  data: { text: value, rowSpan: 1, colSpan: 1, isHeader: false },
});
const body = (
  unitId: string,
  resources: CandidateDiscoveryUnit['resources'],
): CandidateDiscoveryUnit => ({
  unitId,
  chapterId: 'ch',
  chapterPath: [{ id: 'ch', originTitle: '墓葬形制' }],
  table: null,
  context: [],
  resources,
});
const register = (
  unitId: string,
  id: string,
  resources: CandidateDiscoveryUnit['resources'],
  registerRows: NonNullable<CandidateDiscoveryUnit['table']>['registerRows'],
  columnBlocks?: { count: number; columnsPerBlock: number },
): CandidateDiscoveryUnit => ({
  unitId,
  chapterId: 'appendix',
  chapterPath: [{ id: 'appendix', originTitle: '附表' }],
  table: {
    id,
    caption: null,
    headerRows: [],
    registerRows,
    ...(columnBlocks ? { columnBlocks } : {}),
  },
  context: [],
  resources,
});
const plan: CandidateDiscoveryPlan = {
  scopeChapterId: 'ch',
  scopeTitle: '墓葬形制',
  inputSha256: 'hash',
  units: [
    body('b1', [
      text('/t1', '标本M304:15，灰色。'),
      text('/t2', 'Ⅰ式 2座（M 304、M320）。M208。M301A。'),
    ]),
    register(
      'r1',
      'side',
      [
        cell('side', 1, 0, '304A'),
        cell('side', 1, 1, '甲'),
        cell('side', 1, 2, '208'),
        cell('side', 2, 0, '304B'),
        cell('side', 2, 2, '207A'),
      ],
      [
        { rowIndex: 1, block: 0, number: '304', writtenAs: 'M304' },
        { rowIndex: 2, block: 0, number: '304', writtenAs: 'M304' },
        { rowIndex: 1, block: 1, number: '208', writtenAs: 'M208' },
        { rowIndex: 2, block: 1, number: '207', writtenAs: 'M207' },
      ],
      { count: 2, columnsPerBlock: 2 },
    ),
    register(
      'r2',
      'plain',
      [
        cell('plain', 1, 1, '320A'),
        cell('plain', 2, 0, '301A'),
        cell('plain', 3, 0, '305A'),
        cell('plain', 4, 0, '306A'),
      ],
      [
        { rowIndex: 1, number: '320', writtenAs: 'M320' },
        { rowIndex: 2, number: '301', writtenAs: 'M301' },
        { rowIndex: 3, number: '305', writtenAs: 'M305' },
        { rowIndex: 4, number: '306', writtenAs: 'M306' },
      ],
    ),
    body('b2', [text('/t3', '无关')]),
  ],
};
const candidate = (
  candidateId: string,
  recordKind: LedgerObjectCandidate['recordKind'],
  sourceName: string,
  sourceIdentifier: string | null,
): LedgerObjectCandidate => ({
  candidateId,
  status: 'proposed',
  recordKind,
  sourceName,
  sourceIdentifier,
  eligibilityBasis: 'table_item',
  reason: '원문',
  chapterId: 'appendix',
  unitIds: ['r1'],
  evidence: [],
});
const result = (
  candidates: LedgerObjectCandidate[],
  completedUnitIds = ['b1', 'r1', 'r2', 'b2'],
): CandidateDiscoveryResult => ({
  version: 'ledger-object-candidates.v1',
  inputSha256: 'hash',
  scopeChapterId: 'ch',
  scopeTitle: '墓葬形制',
  candidates,
  issues: [],
  exclusions: [],
  completedUnitIds,
  totalUnits: 4,
  inspectedResourceCount: 0,
});
const pool = () => [
  candidate('p2', 'feature', '墓', '304B'),
  candidate('p1', 'feature', '墓葬', '304A'),
  candidate('p3', 'feature', '墓葬', '304 B'),
  candidate('p4', 'feature', '墓室', '304C'),
  candidate('q1', 'feature', '墓葬', '207A'),
  candidate('q2', 'artifact', '罐', null),
  candidate('w1', 'feature', '墓', '320A'),
  candidate('w2', 'feature', '墓', '99XXM320'),
  candidate('x1', 'feature', '墓', '301A'),
  candidate('y1', 'feature', '墓', '305A'),
  candidate('y2', 'artifact', '墓', '305B'),
];

describe('proposeRegisterWholeCandidates', () => {
  test('proposes the whole of a register number written only by its parts, quoting its first writing in the scope', async () => {
    const proposals = await proposeRegisterWholeCandidates(
      plan,
      result(pool()),
    );

    expect(proposals).toEqual([
      {
        candidateId: expect.stringMatching(/^candidate-[0-9a-f]{64}$/),
        status: 'proposed',
        recordKind: 'feature',
        sourceName: '墓葬',
        sourceIdentifier: 'M 304',
        eligibilityBasis: 'register_parts',
        reason: REGISTER_WHOLE_REASON,
        chapterId: 'ch',
        unitIds: ['b1'],
        evidence: [
          {
            sourceId: 'id:/t2',
            resourceKey: '/t2',
            resourceId: '/t2',
            sourceRefs: ['#/t2'],
            pdfPageNo: 5,
            logicalPageRange: null,
            quote: 'M 304',
            charStart: 6,
            charEnd: 11,
          },
        ],
      },
    ]);
  });

  test('proposes nothing before every unit is answered', async () => {
    expect(
      await proposeRegisterWholeCandidates(plan, result(pool(), ['b1'])),
    ).toEqual([]);
  });

  test('adds the wholes once', async () => {
    const first = await withRegisterWholeCandidates(plan, result(pool()));
    const second = await withRegisterWholeCandidates(plan, first);
    const none = result([]);

    expect(first.candidates.map((c) => c.sourceIdentifier)).toContain('M 304');
    expect(second).toBe(first);
    expect(await withRegisterWholeCandidates(plan, none)).toBe(none);
  });
});
