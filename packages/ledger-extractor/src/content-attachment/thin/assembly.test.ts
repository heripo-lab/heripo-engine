import type { ProcessedDocument } from '@heripo/model';

import type { DocumentResource } from '../../resources/document-resource-index';
import type {
  AttachmentRegistryEntry,
  AttachmentUnit,
  ContentAttachmentPlan,
} from '../types';
import type {
  ContentAttachmentThinCall,
  ContentAttachmentThinRunName,
  ContentAttachmentThinUnitResult,
} from './run';

import { describe, expect, test } from 'vitest';

import { buildDocumentResourceIndex } from '../../resources/document-resource-index';
import { assembleContentAttachmentThin } from './assembly';
import { createContentAttachmentThinInput } from './compile';
import { inspectContentAttachmentThinResponse } from './inspection';
import { createContentAttachmentThinRequest } from './prompt';
import { routeContentAttachmentThinSegments } from './routing';

const cell = (text: string, isHeader = false) => ({
  text,
  isHeader,
  rowSpan: 1,
  colSpan: 1,
});

function fixture() {
  const document: ProcessedDocument = {
    reportId: 'report',
    pageRangeMap: {},
    images: [],
    footnotes: [],
    chapters: [
      {
        id: 'c',
        title: '조사',
        originTitle: '조사',
        level: 1,
        pageNo: 1,
        imageIds: [],
        footnoteIds: [],
        tableIds: ['inventory', 'buildings', 'twins'],
        textBlocks: [
          { id: 'b0', pdfPageNo: 1, text: '수혈 1호와 수혈 2호 조사.' },
          { id: 'b1', pdfPageNo: 1, text: '날씨 맑음.' },
          { id: 'b2', pdfPageNo: 2, text: '' },
        ],
      },
    ],
    tables: [
      {
        id: 'inventory',
        pdfPageNo: 1,
        numRows: 2,
        numCols: 2,
        grid: [
          [cell('번호', true), cell('유구', true)],
          [cell('1'), cell('도로')],
        ],
      },
      {
        id: 'buildings',
        pdfPageNo: 1,
        numRows: 1,
        numCols: 2,
        caption: { fullText: '표 2 건물지' },
        grid: [[cell('1호'), cell('장방형')]],
      },
      {
        id: 'twins',
        pdfPageNo: 2,
        numRows: 1,
        numCols: 1,
        caption: { fullText: '표 3 우물' },
        grid: [[cell('3호')]],
      },
    ],
  };
  const resources = buildDocumentResourceIndex(document).resources;
  const sourceOf = (keys: (k: string) => boolean) =>
    resources
      .filter(
        (r): r is Extract<DocumentResource, { kind: 'text' | 'tableCell' }> =>
          (r.kind === 'text' || r.kind === 'tableCell') && keys(r.key),
      )
      .map((resource) => ({ sourceId: `s:${resource.key}`, resource }));
  const tables = resources
    .filter(
      (r): r is Extract<DocumentResource, { kind: 'table' }> =>
        r.kind === 'table',
    )
    .map((r) => ({ key: r.key, data: r.data }));
  const entry = (
    ref: string,
    recordKind: AttachmentRegistryEntry['recordKind'],
    sourceName: string,
    sourceIdentifier: string | null,
    resourceKey = '/chapters/0/textBlocks/0',
    quote = sourceName,
  ): AttachmentRegistryEntry => ({
    ref,
    groupId: `g-${ref}`,
    recordKind,
    mentions: [
      {
        candidateId: `c-${ref}`,
        sourceName,
        sourceIdentifier,
        chapterPath: [],
        evidence: [
          {
            sourceId: `s:${resourceKey}`,
            resourceKey,
            resourceId: null,
            sourceRefs: [],
            pdfPageNo: 1,
            logicalPageRange: null,
            quote,
            charStart: 0,
            charEnd: quote.length,
          },
        ],
      },
    ],
  });
  const unitA: AttachmentUnit = {
    unitId: 'page-1',
    pdfPageNo: 1,
    sources: sourceOf(
      (k) => k !== '/chapters/0/textBlocks/2' && !k.startsWith('/tables/2'),
    ),
    chapters: [],
    tables: tables.filter((t) => t.key !== '/tables/2'),
    readOnlyContext: [],
  };
  const unitB: AttachmentUnit = {
    unitId: 'page-2',
    pdfPageNo: 2,
    sources: sourceOf((k) => k === '/chapters/0/textBlocks/2'),
    chapters: [],
    tables: tables.filter((t) => t.key === '/tables/2'),
    readOnlyContext: [],
  };
  const unitC: AttachmentUnit = { ...unitB, unitId: 'page-3', pdfPageNo: 3 };
  const plan: ContentAttachmentPlan = {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: 'input',
    candidateSnapshotId: 'snapshot',
    registrySha256: 'registry',
    registryUncertainties: [],
    registry: [
      entry('R1', 'area', '사업범위', null),
      entry('R2', 'feature', '수혈', '1호'),
      entry('R3', 'feature', '수혈', '2호'),
      entry('R4', 'trench', '트렌치', '1', '/tables/0/grid/1/0', '1'),
      entry('R5', 'feature', '도로', null, '/tables/0/grid/1/1', '도로'),
      entry('R6', 'feature', '건물지', '1호'),
      entry('R7', 'feature', '우물', '3호'),
      entry('R8', 'feature', '우물', '3호'),
    ],
    pages: [],
    units: [unitA, unitB, unitC],
  };
  return { plan, unitA };
}

const attach = (r: string[], e: string[], ia: string[][] = []) => ({
  k: 'a',
  r,
  h: [],
  x: [],
  ia,
  sa: [],
  e,
});
function routedResult(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
  outputs: unknown[],
): ContentAttachmentThinUnitResult {
  const compilation = createContentAttachmentThinInput(plan, unit);
  const request = createContentAttachmentThinRequest(compilation, {
    format: 'object',
  });
  const calls: ContentAttachmentThinCall[] = outputs.map((rawResponse, i) => ({
    run: `r${i + 1}` as ContentAttachmentThinRunName,
    status: 'completed',
    request,
    rawResponse,
    callAttempts: [],
    inspection: inspectContentAttachmentThinResponse(plan, unit, {
      request,
      rawResponse,
    }),
  }));
  return {
    unitId: unit.unitId,
    status: 'routed',
    calls,
    outliers: {
      first: { rates: [], flagged: [] },
      finalRuns: calls.map((c) => c.run),
      wholeUnitReview: false,
    },
    segments: routeContentAttachmentThinSegments(
      plan,
      unit,
      compilation,
      calls.map((c) => c.inspection!),
    ),
    codeAssigned: compilation.codeMap.codeAssigned,
  };
}

describe('assembleContentAttachmentThin', () => {
  test('attaches confirmed model targets and code-assigned cells by registry candidate', () => {
    const { plan, unitA } = fixture();
    const a = routedResult(plan, unitA, [
      {
        d: {
          'E1:S1': attach(['R2'], ['Q1:L1-L2'], [['R2', 'R3']]),
          'E2:S1': { k: 'n' },
        },
      },
      {
        d: {
          'E1:S1': attach(['R2'], ['Q1:L1-L2', 'Q1:L3-L4'], [['R2', 'R3']]),
          'E2:S1': { k: 'n' },
        },
      },
      {
        d: {
          'E1:S1': attach(['R2'], ['Q1:L1-L2'], [['R3', 'R2']]),
          'E2:S1': { k: 'n' },
        },
      },
    ]);
    const b: ContentAttachmentThinUnitResult = {
      unitId: 'page-2',
      status: 'no_llm_segments',
      calls: [],
      segments: [],
      codeAssigned: [],
    };

    const view = assembleContentAttachmentThin(plan, [a, b]);

    expect(view).toMatchObject({
      version: 'ledger-content-attachments.v2',
      method: 'content-attachment-thin.v8',
      reviewStatus: 'not_reviewed',
      totalUnits: 3,
      missingUnitIds: ['page-3'],
      issues: [],
      reviewItems: [],
      scope: { relationCounterparts: 'deferred_to_link_extraction' },
    });
    expect(view.units).toEqual([
      {
        unitId: 'page-1',
        status: 'routed',
        calls: 3,
        finalRuns: ['r1', 'r2', 'r3'],
        wholeUnitReview: false,
      },
      {
        unitId: 'page-2',
        status: 'no_llm_segments',
        calls: 0,
        finalRuns: [],
        wholeUnitReview: false,
      },
    ]);
    expect(
      view.contents.map((c) => [
        c.registryRef,
        c.excerpts.map((e) => `${e.segment}:${e.basis}`),
      ]),
    ).toEqual([
      ['R2', ['E1:S1:model_unanimous']],
      ['R4', ['E5:S1:code_row_owner', 'E6:S1:code_row_owner']],
      ['R5', ['E6:S1:code_cell_registration']],
      ['R6', ['E7:S1:code_typed_row', 'E8:S1:code_typed_row']],
    ]);
    const majority = assembleContentAttachmentThin(plan, [
      {
        ...a,
        segments: a.segments.map((x) =>
          x.segment === 'E1:S1' ? { ...x, decidedBy: 'majority' as const } : x,
        ),
      },
    ]);
    expect(majority.contents[0].excerpts[0].basis).toBe('model_majority');
    expect(view.contents[0].excerpts[0]).toEqual({
      unitId: 'page-1',
      segment: 'E1:S1',
      resourceKey: '/chapters/0/textBlocks/0',
      charStart: 0,
      charEnd: 16,
      basis: 'model_unanimous',
    });
    expect(view.segmentEvidence).toEqual([
      {
        unitId: 'page-1',
        segment: 'E1:S1',
        evidence: [
          expect.objectContaining({
            range: 'Q1:L1-L2',
            charStart: 0,
            charEnd: 6,
          }),
          expect.objectContaining({
            range: 'Q1:L3-L4',
            charStart: 7,
            charEnd: 12,
          }),
        ],
      },
    ]);
    expect(view.uncertainties).toEqual([
      {
        unitId: 'page-1',
        segment: 'E1:S1',
        recipientIdentityAlternatives: [['R2', 'R3']],
        relationshipSubjectAlternatives: [],
      },
    ]);
  });

  test('marks review items whose proposed targets are exactly a chapter collective, preferring the deepest chapter', () => {
    const { plan, unitA } = fixture();
    const pits = ['R2', 'R3', 'R6', 'R7', 'R8'];
    for (const r of plan.registry)
      if (pits.includes(r.ref)) {
        const m = r.mentions[0];
        m.chapterPath = [
          { id: 'c', originTitle: '조사' },
          { id: 'c2', originTitle: '수혈' },
        ];
        r.mentions.push({
          ...m,
          chapterPath: [{ id: 'z', originTitle: '요약' }],
        });
      }
    plan.registry.find((r) => r.ref === 'R4')!.mentions[0].chapterPath = [
      { id: 'c', originTitle: '조사' },
    ];
    const a = routedResult(plan, unitA, [
      { d: { 'E1:S1': attach(pits, []), 'E2:S1': attach(['R4'], []) } },
      { d: { 'E1:S1': attach(pits, []), 'E2:S1': { k: 'n' } } },
      { d: { 'E1:S1': attach(['R2'], []), 'E2:S1': { k: 'n' } } },
    ]);

    const view = assembleContentAttachmentThin(plan, [a]);

    expect(
      view.reviewItems.map((r) => [r.segment, r.collectiveHandle]),
    ).toEqual([
      [
        'E1:S1',
        {
          ref: expect.stringMatching(/^H\d+$/),
          path: ['조사', '수혈'],
          kind: 'feature',
          members: 5,
        },
      ],
      ['E2:S1', undefined],
    ]);
  });

  test('lists layer mentions of auto and review segments and reads routings saved without them', () => {
    const { plan, unitA } = fixture();
    const a = routedResult(plan, unitA, [
      { d: { 'E1:S1': attach(['R2'], []), 'E2:S1': { k: 'n' } } },
      { d: { 'E1:S1': attach(['R2'], []), 'E2:S1': attach(['R2'], []) } },
    ]);
    const [first, second] = a.segments;
    const saved = { ...second } as Partial<typeof second>;
    delete saved.layerMentions;

    const view = assembleContentAttachmentThin(plan, [
      {
        ...a,
        segments: [{ ...first, layerMentions: ['R4'] }, saved as typeof second],
      },
    ]);
    const reviewed = assembleContentAttachmentThin(plan, [
      { ...a, segments: [first, { ...second, layerMentions: ['R4'] }] },
    ]);

    expect(view.layerMentions).toEqual([
      expect.objectContaining({
        unitId: unitA.unitId,
        segment: 'E1:S1',
        layers: ['R4'],
        confirmed: ['R2'],
      }),
    ]);
    expect(reviewed.layerMentions).toEqual([
      expect.objectContaining({ segment: 'E2:S1', confirmed: [] }),
    ]);
  });

  test('keeps review segments with every final run and leaves them unattached', () => {
    const { plan, unitA } = fixture();
    const a = routedResult(plan, unitA, [
      { d: { 'E1:S1': attach(['R2'], []), 'E2:S1': { k: 'n' } } },
      {
        d: {
          'E1:S1': attach(['R2', 'R3'], ['Q1:L1-L2']),
          'E2:S1': attach(['R1'], ['Q2:L1-L2']),
        },
      },
      { d: { 'E1:S1': attach(['R2'], []) } },
    ]);

    const view = assembleContentAttachmentThin(plan, [a]);

    expect(
      view.contents.some((c) =>
        c.excerpts.some((e) => e.basis === 'model_unanimous'),
      ),
    ).toBe(false);
    expect(view.segmentEvidence).toEqual([]);
    expect(view.reviewItems.map((r) => [r.segment, r.reasons])).toEqual([
      ['E1:S1', ['contested_targets']],
      ['E2:S1', ['invalid_run', 'area']],
    ]);
    expect(view.reviewItems[1]).toMatchObject({
      unitId: 'page-1',
      resourceKey: '/chapters/0/textBlocks/1',
      charStart: 0,
      charEnd: 6,
      areaSuggestions: [{ ref: 'R1', votes: 1 }],
      runs: [
        {
          run: 'r1',
          recipients: [],
          recipientIdentityAlternatives: [],
          relationshipSubjectAlternatives: [],
        },
        {
          run: 'r2',
          recipients: ['R1'],
          recipientIdentityAlternatives: [],
          relationshipSubjectAlternatives: [],
        },
        null,
      ],
      evidence: [expect.objectContaining({ range: 'Q2:L1-L2' })],
    });
    expect(view.reviewItems[1]).not.toHaveProperty('status');
  });

  test('reports failed, unknown and duplicate unit results', () => {
    const { plan, unitA } = fixture();
    const failed: ContentAttachmentThinUnitResult = {
      unitId: 'page-1',
      status: 'failed',
      calls: [],
      segments: [],
      codeAssigned: [],
    };

    const view = assembleContentAttachmentThin(plan, [
      failed,
      { ...failed, unitId: 'page-9' },
      routedResult(plan, unitA, [{ d: {} }]),
    ]);

    expect(view.method).toBe('content-attachment-thin.v8');
    expect(assembleContentAttachmentThin(plan, []).method).toBe(
      'content-attachment-thin.v8',
    );
    plan.thinPolicy = { layers: 'all', continuity: 'linked' };
    expect(assembleContentAttachmentThin(plan, []).method).toBe(
      'content-attachment-thin.v9',
    );
    expect(view.issues).toEqual([
      { unitId: 'page-1', reason: 'a required call failed' },
      { unitId: 'page-9', reason: 'unknown unit' },
      { unitId: 'page-1', reason: 'duplicate unit result' },
    ]);
    expect(view.units).toEqual([
      {
        unitId: 'page-1',
        status: 'failed',
        calls: 0,
        finalRuns: [],
        wholeUnitReview: false,
      },
    ]);
    expect(view.contents).toEqual([]);
    expect(view.missingUnitIds).toEqual(['page-2', 'page-3']);
  });
});
