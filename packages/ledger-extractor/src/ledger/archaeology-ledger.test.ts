import type { ContentAttachmentThinResult } from '../content-attachment/thin/assembly';
import type { ContentAttachmentPlan } from '../content-attachment/types';

import { describe, expect, test } from 'vitest';

import {
  ARCHAEOLOGY_LEDGER_PENDING_PARTS,
  ARCHAEOLOGY_LEDGER_VERSION,
  assembleArchaeologyLedger,
} from './archaeology-ledger';

const text = (
  key: string,
  value: string,
  extra: Record<string, unknown> = {},
) => ({
  sourceId: `s:${key}`,
  resource: {
    key,
    kind: 'text',
    resourceId: 'b1',
    sourceRefs: ['#/texts/1'],
    chapterIds: ['ch-1'],
    pdfPageNo: 3,
    logicalPageRange: null,
    data: { id: 'b1', text: value, pdfPageNo: 3 },
    ...extra,
  },
});
const evidence = (resourceKey: string, quote: string, charStart = 0) => ({
  sourceId: `s:${resourceKey}`,
  resourceKey,
  resourceId: null,
  sourceRefs: [] as string[],
  pdfPageNo: 9,
  logicalPageRange: null,
  quote,
  charStart,
  charEnd: charStart + quote.length,
});
const entry = (
  ref: string,
  recordKind: string,
  sourceName: string,
  sourceIdentifier: string | null,
  ev: ReturnType<typeof evidence>[],
) => ({
  ref,
  groupId: `g${ref}`,
  recordKind,
  mentions: [
    {
      candidateId: `c${ref}`,
      sourceName,
      sourceIdentifier,
      chapterPath: [],
      evidence: ev,
    },
  ],
});
function fixture() {
  const plan = {
    candidateSnapshotId: 'snap',
    units: [
      {
        unitId: 'page-3',
        sources: [
          text(
            '/chapters/0/textBlocks/0',
            '1호 수혈은 원형이다. 1호 수혈은 원형이다.',
          ),
          text('/chapters/0/textBlocks/1', '유물은 없다.', {
            resourceId: null,
            sourceRefs: [],
            chapterIds: [],
          }),
          {
            sourceId: 's:cell',
            resource: {
              key: '/tables/0/grid/1/0',
              kind: 'tableCell',
              tableId: 't1',
              rowIndex: 1,
              columnIndex: 0,
              resourceId: null,
              sourceRefs: ['#/tables/0'],
              chapterIds: ['ch-1'],
              pdfPageNo: 4,
              logicalPageRange: null,
              data: { text: '1호', rowSpan: 1, colSpan: 1, isHeader: false },
            },
          },
        ],
      },
    ],
    registry: [
      entry('R1', 'feature', '1호 수혈', '1호', [
        evidence('/chapters/0/textBlocks/0', '1호 수혈'),
      ]),
      entry('R2', 'artifact', '토기', null, [
        { ...evidence('/outside/0', '토기 1점'), sourceRefs: ['#/texts/9'] },
      ]),
      entry('R3', 'area', '조사구역', null, [
        evidence('/outside/1', '조사구역'),
      ]),
    ],
    registryUncertainties: [
      {
        leftCandidateId: 'cR1',
        rightCandidateId: 'cR2',
        reason: '같은 대상인지 불명확',
      },
    ],
  } as unknown as ContentAttachmentPlan;
  const span = (resourceKey: string, charStart: number, charEnd: number) => ({
    unitId: 'page-3',
    segment: 'E1:S1',
    resourceKey,
    charStart,
    charEnd,
  });
  const attachments = {
    method: 'content-attachment-thin.v13',
    contents: [
      {
        registryRef: 'R1',
        groupId: 'gR1',
        excerpts: [
          {
            ...span('/chapters/0/textBlocks/0', 0, 12),
            basis: 'model_unanimous',
          },
          {
            ...span('/chapters/0/textBlocks/0', 13, 25),
            basis: 'model_unanimous',
          },
          {
            ...span('/chapters/0/textBlocks/0', 13, 25),
            basis: 'model_unanimous',
          },
          { ...span('/tables/0/grid/1/0', 0, 2), basis: 'code_row_owner' },
        ],
      },
    ],
    reviewItems: [
      {
        ...span('/chapters/0/textBlocks/1', 0, 7),
        reasons: ['contested_targets'],
        confirmed: ['R1'],
        contested: [{ ref: 'R2', votes: 2 }],
        areaSuggestions: [{ ref: 'R2', votes: 1 }],
        layerSuggestions: [],
      },
      {
        ...span('/chapters/0/textBlocks/0', 0, 6),
        reasons: ['large_handle'],
        confirmed: ['R1'],
        contested: [],
        areaSuggestions: [],
        layerSuggestions: ['R3'],
        collectiveHandle: {
          ref: 'H1',
          path: ['IV', '수혈'],
          kind: 'feature',
          members: 5,
        },
      },
    ],
    issues: [],
    missingUnitIds: [],
  } as unknown as ContentAttachmentThinResult;
  return { plan, attachments };
}
const options = {
  ledgerId: 'ledger-1',
  processedDocumentId: 'doc-1',
  extractorVersion: '0.2.0',
  extractedAt: '2026-10-26T00:00:00.000Z',
  createdAt: '2026-10-26T00:00:01.000Z',
};

describe('assembleArchaeologyLedger', () => {
  test('builds records with unchanged excerpts, their sources and review items without flagging collective members', () => {
    const { plan, attachments } = fixture();

    const result = assembleArchaeologyLedger(plan, attachments, options);

    expect(result.ledger).toEqual({
      id: 'ledger-1',
      processedDocumentId: 'doc-1',
      revisionKind: 'extraction',
      schemaVersion: ARCHAEOLOGY_LEDGER_VERSION,
      extractorVersion: '0.2.0',
      promptVersion: 'content-attachment-thin.v13',
      validationStatus: 'not_run',
      reviewStatus: 'not_reviewed',
      candidateSnapshotId: 'snap',
      extractedAt: options.extractedAt,
      createdAt: options.createdAt,
    });
    expect(result.pending).toEqual([...ARCHAEOLOGY_LEDGER_PENDING_PARTS]);
    expect(result).toMatchObject({
      attributes: [],
      mediaReferences: [],
      links: [],
    });
    const [pit, pot, area] = result.records;
    expect(pit).toMatchObject({
      id: 'record-gR1',
      ledgerId: 'ledger-1',
      recordKind: 'feature',
      sourceIdentifier: '1호',
      sourceName: '1호 수혈',
      ordinal: 0,
      needsReview: true,
      reviewStatus: 'not_reviewed',
    });
    expect(pit.content.map((c) => [c.text, c.sourceIds.length])).toEqual([
      ['1호 수혈', 1],
      ['1호 수혈은 원형이다.', 2],
      ['1호', 1],
    ]);
    expect(pot).not.toHaveProperty('sourceIdentifier');
    expect(pot.content[0].text).toBe('토기 1점');
    expect(pot.needsReview).toBe(true);
    expect(area.needsReview).toBe(false);
    expect(
      result.sources.find((s) => s.basis === 'code_row_owner'),
    ).toMatchObject({
      tableId: 't1',
      tableCell: { rowIndex: 1, columnIndex: 0 },
      chapterId: 'ch-1',
      sourceRef: '#/tables/0',
      pdfPageNo: 4,
      excerpt: '1호',
    });
    expect(result.sources[0]).toMatchObject({
      recordId: 'record-gR1',
      textBlockId: 'b1',
      locator: '/chapters/0/textBlocks/0#0-5',
      basis: 'registration',
    });
    expect(result.sources.find((s) => s.recordId === 'record-gR2')).toEqual({
      id: 'source-2',
      recordId: 'record-gR2',
      locator: '/outside/0#0-5',
      charStart: 0,
      charEnd: 5,
      pdfPageNo: 9,
      sourceRef: '#/texts/9',
      excerpt: '토기 1점',
      basis: 'registration',
    });
    expect(result.reviewItems).toEqual([
      {
        id: 'review-1',
        kind: 'segment',
        recordIds: ['record-gR1', 'record-gR2'],
        confirmedRecordIds: ['record-gR1'],
        reasons: ['contested_targets'],
        text: '유물은 없다.',
        locator: '/chapters/0/textBlocks/1#0-7',
        pdfPageNo: 3,
      },
      expect.objectContaining({
        id: 'review-2',
        recordIds: ['record-gR1', 'record-gR3'],
        collective: { path: ['IV', '수혈'], kind: 'feature', members: 5 },
      }),
      {
        id: 'review-3',
        kind: 'identity',
        recordIds: ['record-gR1', 'record-gR2'],
        confirmedRecordIds: [],
        reasons: ['identity_uncertain'],
        detail: '같은 대상인지 불명확',
      },
    ]);
    expect(result.issues).toEqual([]);
  });

  test('records profile rules, decisions left to a person and attachment problems', () => {
    const { plan, attachments } = fixture();
    plan.registryUncertainties = [];
    plan.profile = { profileSha256: 'abc', source: 'router' };
    plan.thinPolicy = { layers: 'local' };
    plan.thinPolicyDecisions = [
      {
        branch: 'layers',
        value: 'local',
        source: 'default',
        trait: 'local_stratigraphy',
        traitValue: 'unclear',
        needsDecision: true,
      },
      {
        branch: 'continuity',
        value: 'linked',
        source: 'profile',
        needsDecision: false,
      },
    ];
    attachments.reviewItems = [];
    attachments.issues = [{ unitId: 'page-3', reason: 'bad' }];
    attachments.missingUnitIds = ['page-4'];
    const bare = fixture();
    bare.plan.registry[2].mentions[0].evidence = [];
    bare.plan.profile = { profileSha256: 'abc', source: 'manual' };

    const result = assembleArchaeologyLedger(plan, attachments, options);
    const minimal = assembleArchaeologyLedger(
      bare.plan,
      bare.attachments,
      options,
    );

    expect(result.ledger).toMatchObject({
      validationStatus: 'not_run',
      reportProfile: {
        profileSha256: 'abc',
        source: 'router',
        thinPolicy: { layers: 'local' },
        thinPolicyDecisions: plan.thinPolicyDecisions,
      },
    });
    expect(result.issues).toEqual([
      {
        code: 'UNRESOLVED_EVIDENCE_ASSIGNMENT',
        severity: 'warning',
        stage: 'assembly',
        message: 'page-3: bad',
      },
      {
        code: 'UNRESOLVED_EVIDENCE_ASSIGNMENT',
        severity: 'error',
        stage: 'assembly',
        message: 'page-4: unit not attached',
      },
    ]);
    expect(result.reviewItems).toEqual([
      {
        id: 'review-1',
        kind: 'profile_decision',
        recordIds: [],
        confirmedRecordIds: [],
        reasons: ['profile_decision'],
        detail: 'layers=local (local_stratigraphy=unclear)',
      },
    ]);
    expect(result.records.every((r) => !r.needsReview)).toBe(true);
    expect(minimal.ledger.reportProfile).toEqual({
      profileSha256: 'abc',
      source: 'manual',
    });
    expect(minimal.records[2].content).toEqual([]);
  });
});
