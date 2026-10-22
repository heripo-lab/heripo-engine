import type { ProcessedDocument } from '@heripo/model';
import type * as Shared from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { CandidateEvidence } from '../../candidates/candidate-discovery';
import type { ContentAttachmentPlan } from '../content-attachment';

import { LLMCaller } from '@heripo/shared';
import { describe, expect, test, vi } from 'vitest';

import { buildDocumentResourceIndex } from '../../resources/document-resource-index';
import {
  assembleContentAttachment,
  attachContentUnit,
  createContentAttachmentRequest,
} from '../content-attachment';
import { createContentAttachmentDecisionInput } from '../decisions';
import { createContentAttachmentGroundedInput } from '../grounding';
import { createContentAttachmentIndependentReviewRequest } from '../review/independent-review';
import { createContentAttachmentTableAnchorInput } from './anchors';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

function fixture() {
  const cell = (text: string, isHeader = false, rowSpan = 1, colSpan = 1) => ({
    text,
    isHeader,
    rowSpan,
    colSpan,
  });
  const doc: ProcessedDocument = {
    reportId: 'report',
    pageRangeMap: { 1: { startPageNo: 0, endPageNo: 0 } },
    chapters: [
      {
        id: 'ch',
        originTitle: 'Survey',
        title: 'Survey',
        level: 1,
        pageNo: 0,
        textBlocks: [
          { id: 'body', text: 'Trenches were investigated.', pdfPageNo: 1 },
        ],
        imageIds: [],
        tableIds: ['table-long-id', 'other-table-long-id'],
        footnoteIds: [],
      },
    ],
    images: [],
    footnotes: [],
    tables: [
      {
        id: 'table-long-id',
        sourceRef: '#/tables/0',
        pdfPageNo: 1,
        caption: { fullText: 'Trench inventory' },
        numRows: 5,
        numCols: 4,
        grid: [
          [
            cell('Tr', true, 2),
            cell('Dimensions', true, 1, 2),
            cell('Findings', true, 2),
          ],
          [cell('Length', true), cell('Width', true)],
          [cell('1'), cell('2.5'), cell('1.0'), cell('Pit; Wall')],
          [cell('2'), cell('3.0'), cell('1.2'), cell('Pit')],
          [cell('3'), cell('4.0'), cell('1.3'), cell('')],
        ],
      },
      {
        id: 'other-table-long-id',
        sourceRef: '#/tables/1',
        pdfPageNo: 1,
        numRows: 2,
        numCols: 2,
        grid: [
          [cell('Other', true), cell('Findings', true)],
          [cell('1'), cell('Pit')],
        ],
      },
    ],
  };
  const index = buildDocumentResourceIndex(doc);
  const sources = index.resources
    .filter((r) => r.kind === 'text' || r.kind === 'tableCell')
    .map((resource) => ({ sourceId: `long-source:${resource.key}`, resource }));
  const first = sources.filter(
    (s) => s.resource.kind === 'text' || s.resource.tableId === 'table-long-id',
  );
  const second = sources.filter(
    (s) =>
      s.resource.kind === 'tableCell' &&
      s.resource.tableId === 'other-table-long-id',
  );
  const evidence = (
    key: string,
    start = 0,
    end?: number,
  ): CandidateEvidence => {
    const s = sources.find((s) => s.resource.key === key)!;
    const stop = end ?? s.resource.data.text.length;
    return {
      sourceId: s.sourceId,
      resourceKey: key,
      resourceId: s.resource.resourceId,
      sourceRefs: s.resource.sourceRefs,
      pdfPageNo: s.resource.pdfPageNo,
      logicalPageRange: s.resource.logicalPageRange,
      charStart: start,
      charEnd: stop,
      quote: s.resource.data.text.slice(start, stop),
    };
  };
  const path = [{ id: 'ch', originTitle: 'Survey' }];
  const specs: Array<
    [string, 'feature' | 'trench', string | null, CandidateEvidence[]]
  > = [
    ['Pit', 'feature', null, [evidence('/tables/0/grid/2/3', 0, 3)]],
    ['Pit', 'feature', null, [evidence('/tables/0/grid/3/3')]],
    ['Trench', 'trench', '1', [evidence('/tables/0/grid/2/0')]],
    ['Trench', 'trench', '2', [evidence('/tables/0/grid/3/0')]],
    ['Pit', 'feature', null, [evidence('/tables/1/grid/1/1')]],
    ['Survey', 'feature', null, [evidence(first[0].resource.key)]],
    [
      'Elsewhere',
      'feature',
      null,
      [{ ...evidence('/tables/0/grid/2/3', 0, 3), resourceKey: '/outside' }],
    ],
    ['Wall', 'feature', null, [evidence('/tables/0/grid/2/3', 5, 9)]],
  ];
  const plan: ContentAttachmentPlan = {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: 'input',
    candidateSnapshotId: 'snapshot',
    registrySha256: 'registry',
    registryUncertainties: [],
    pages: [],
    registry: specs.map(([name, kind, number, ev], i) => ({
      ref: `R${i + 1}`,
      groupId: `long-group-${i}`,
      recordKind: kind,
      mentions: [
        {
          candidateId: `long-candidate-${i}`,
          sourceName: name,
          sourceIdentifier: number,
          chapterPath: path,
          evidence: ev,
        },
      ],
    })),
    units: [first, second].map((selected, i) => ({
      unitId: `unit-${i}`,
      pdfPageNo: 1,
      sources: selected,
      chapters: [{ chapterId: 'ch', path }],
      tables: index.resources
        .filter((r) => r.kind === 'table')
        .map((r) => ({ key: r.key, data: r.data })),
      readOnlyContext: [],
    })),
  };
  return { plan, unit: plan.units[0], evidence };
}

describe('candidate table source anchors', () => {
  test('disambiguates equal names with exact rows and current excerpts while sharing row context and preserving all original data', () => {
    const { plan, unit } = fixture();
    const alias = structuredClone(plan.registry[0].mentions[0]);
    alias.candidateId = 'another-long-candidate';
    plan.registry[0].mentions.push(alias);
    const before = structuredClone(plan);
    const old = createContentAttachmentDecisionInput(plan, unit);
    const current = createContentAttachmentTableAnchorInput(plan, unit);
    expect(current.payload.candidateTableRows).toEqual([
      ['A1', 'T1', 2, ['E7', 'E8', 'E9', 'E10']],
      ['A2', 'T1', 3, ['E11', 'E12', 'E13', 'E14']],
    ]);
    expect(current.payload.candidateTableAnchors).toEqual([
      ['R1', 'A1', 3, 'E10'],
      ['R2', 'A2', 3, 'E14'],
      ['R3', 'A1', 0, 'E7'],
      ['R4', 'A2', 0, 'E11'],
      ['R8', 'A1', 3, 'E10'],
    ]);
    expect(current.codeMap.candidateTableAnchors).toHaveLength(6);
    expect(current.codeMap.candidateTableAnchors[1]).toMatchObject({
      candidateId: alias.candidateId,
      candidateRef: 'R1',
      rowRef: 'A1',
      evidence: alias.evidence[0],
      excerptRef: 'E10',
    });
    expect(current.codeMap.candidateTableRows[0]).toEqual({
      ref: 'A1',
      tableRef: 'T1',
      tableKey: '/tables/0',
      rowIndex: 2,
      excerptRefs: ['E7', 'E8', 'E9', 'E10'],
    });
    expect(current.payload.current).toEqual(old.payload.current);
    expect(current.payload.candidates).toEqual(old.payload.candidates);
    expect(current.codeMap.excerpts).toEqual(old.codeMap.excerpts);
    const {
      candidateTableRows: _rows,
      candidateTableAnchors: _anchors,
      candidateTableRowColumns: _rc,
      candidateTableAnchorColumns: _ac,
      ...legacy
    } = current.payload;
    expect(legacy).toEqual(old.payload);
    for (const hidden of [
      'long-candidate',
      'long-source',
      '/tables/',
      'resourceKey',
      'charStart',
      'groupId',
    ])
      expect(JSON.stringify(current.payload)).not.toContain(hidden);
    expect(current.payload.current.tables[0].grid[0][0].slice(2)).toEqual([
      2,
      1,
      true,
    ]);
    expect(current.payload.current.tables[0].grid[0][1].slice(2)).toEqual([
      1,
      2,
      true,
    ]);
    expect(plan).toEqual(before);
  });

  test('keeps row references independent of registry order and separates tables with the same row numbers', () => {
    const { plan, unit } = fixture();
    const before = createContentAttachmentTableAnchorInput(plan, unit);
    plan.registry.reverse();
    const reversed = createContentAttachmentTableAnchorInput(plan, unit);
    expect(reversed.payload.candidateTableRows).toEqual(
      before.payload.candidateTableRows,
    );
    expect([...reversed.payload.candidateTableAnchors].sort()).toEqual(
      [...before.payload.candidateTableAnchors].sort(),
    );
    unit.sources.push(...plan.units[1].sources);
    const combined = createContentAttachmentTableAnchorInput(plan, unit);
    const anchor = combined.payload.candidateTableAnchors.find(
      (a) => a[0] === 'R5',
    )!;
    expect(
      combined.payload.candidateTableRows
        .find((r) => r[0] === anchor[1])!
        .slice(0, 3),
    ).toEqual(['A3', 'T2', 1]);
    expect(
      combined.codeMap.candidateTableAnchors.find(
        (a) => a.candidateRef === 'R5',
      )!.evidence.resourceKey,
    ).toBe('/tables/1/grid/1/1');
  });

  test('omits local anchors for unselected and body evidence without dropping candidates or read-only table context', () => {
    const { plan, unit } = fixture();
    unit.sources = unit.sources.filter((s) => s.resource.kind === 'text');
    const input = createContentAttachmentTableAnchorInput(plan, unit);
    expect(input.payload.candidateTableAnchors).toEqual([]);
    expect(input.payload.candidateTableRows).toEqual([]);
    expect(input.payload.candidates).toHaveLength(8);
    expect(input.payload.current.tables).toHaveLength(2);
    expect(input.codeMap.candidateRows[0].evidence).toEqual(
      plan.registry[0].mentions[0].evidence,
    );
  });

  test('rejects inexact candidate ranges and nonselectable cells without guessing another location', () => {
    const { plan } = fixture();
    const mutations: Array<(e: CandidateEvidence) => void> = [
      (e) => {
        e.charStart = 0.5;
      },
      (e) => {
        e.charEnd = 2.5;
      },
      (e) => {
        e.charStart = -1;
      },
      (e) => {
        e.charEnd = 0;
      },
      (e) => {
        e.charEnd = 100;
      },
      (e) => {
        e.quote = 'pit';
      },
    ];
    for (const mutate of mutations) {
      const p = structuredClone(plan);
      mutate(p.registry[0].mentions[0].evidence[0]);
      expect(() =>
        createContentAttachmentTableAnchorInput(p, p.units[0]),
      ).toThrow('differs from original cell');
    }
    const blank = structuredClone(plan),
      unit = blank.units[0];
    const source = unit.sources.find(
      (s) => s.resource.key === '/tables/0/grid/4/3',
    )!;
    source.resource.data.text = ' ';
    blank.registry[0].mentions[0].evidence[0] = {
      ...blank.registry[0].mentions[0].evidence[0],
      resourceKey: source.resource.key,
      charStart: 0,
      charEnd: 1,
      quote: ' ',
    };
    expect(() => createContentAttachmentTableAnchorInput(blank, unit)).toThrow(
      'must fit one selectable cell',
    );
  });

  test('sends anchors to the model, replays historical input, rejects forged maps, and preserves a model decision rather than repairing it', async () => {
    const { plan, unit } = fixture();
    const current = createContentAttachmentGroundedInput(plan, unit);
    const response = {
      assignments: [
        ...['E7', 'E8', 'E9'].map((excerptRef) => ({
          excerptRef,
          candidateRefs: ['R3'],
          reason: 'Owner',
        })),
        {
          excerptRef: 'E10',
          candidateRefs: ['R3', 'R2'],
          reason: 'Deliberate model decision',
        },
        ...['E11', 'E12', 'E13', 'E14'].map((excerptRef) => ({
          excerptRef,
          candidateRefs: ['R4'],
          reason: 'Owner',
        })),
      ],
      unresolved: [],
      ignored: current.codeMap.excerpts
        .filter(
          (e) =>
            !['E7', 'E8', 'E9', 'E10', 'E11', 'E12', 'E13', 'E14'].includes(
              e.ref,
            ),
        )
        .map((e) => ({ excerptRef: e.ref, reason: 'Other' })),
    };
    const wireResponse = {
      decisions: Object.fromEntries([
        ...response.assignments.map(({ excerptRef, ...item }) => [
          excerptRef,
          {
            status: 'assigned' as const,
            ...item,
            unresolved: null,
          },
        ]),
        ...response.ignored.map(({ excerptRef, reason }) => [
          excerptRef,
          { status: 'ignored' as const, reason },
        ]),
      ]),
    };
    vi.mocked(LLMCaller.call).mockResolvedValue({
      output: wireResponse,
      usedFallback: false,
      usage: {
        component: 'test',
        phase: 'test',
        model: 'primary',
        modelName: 'mock',
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      },
    });
    const reviewRequest = createContentAttachmentIndependentReviewRequest(
      current,
      wireResponse,
      {
        includeBodyContext: true,
        qualifyBeforeIdentity: true,
        reconcileRecipientRefs: true,
        crossChapterAreas: true,
        preserveAreaWork: true,
        preserveAreaResults: true,
        boundAreaResultRecipients: true,
        reviewTableWork: true,
        traceAreaRecording: true,
        boundAreaRecording: true,
        checkClauseGrounds: true,
        gateQualifierStage: true,
        preserveTentativeMembership: true,
        segmentReview: true,
        wordEvidence: true,
        sourceGroundedCoverage: true,
      },
    );
    const reviewOutput = reviewRequest.schema.parse({
      segments: Object.fromEntries(
        reviewRequest
          .wordEvidence!.sources.filter((source) =>
            reviewRequest.required.some((r) => r.excerptRef === source.ref),
          )
          .map((source) => [
            source.ref,
            [
              {
                kind: 'substantive',
                wordRanges: [`${source.ref}:W1-${source.words.at(-1)!.ref}`],
              },
            ],
          ]),
      ),
      reviews: Object.fromEntries(
        reviewRequest.required.map((r) => [
          r.key,
          Object.fromEntries(
            r.candidateRefs.map((ref) => [
              ref,
              {
                segmentDecisions: [
                  {
                    segment: 1,
                    attachment: response.assignments.some(
                      (a) =>
                        a.excerptRef === r.excerptRef &&
                        a.candidateRefs.includes(ref),
                    )
                      ? 'included'
                      : 'excluded',
                    relationshipSubject: 'not_alternative',
                    reason: 'Fixture segment judgment',
                  },
                ],
                wordRanges: response.assignments.some(
                  (a) =>
                    a.excerptRef === r.excerptRef &&
                    a.candidateRefs.includes(ref),
                )
                  ? [`${r.excerptRef}:W1-W1`]
                  : [],
                attachment: response.assignments.some(
                  (a) =>
                    a.excerptRef === r.excerptRef &&
                    a.candidateRefs.includes(ref),
                )
                  ? 'included'
                  : 'excluded',
                relationshipSubject: 'not_alternative',
                contextRef: r.excerptRef,
                candidateEvidenceRefs: [
                  current.citations.find((c) => c.candidateRef === ref)!.ref,
                ],
                reason:
                  'Fixture review preserves explicit original assignments',
              },
            ]),
          ),
        ]),
      ),
    });
    const mockUsage = {
      component: 'test',
      phase: 'test',
      model: 'primary' as const,
      modelName: 'mock',
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    };
    vi.mocked(LLMCaller.call)
      .mockResolvedValueOnce({
        output: wireResponse,
        usedFallback: false,
        usage: mockUsage,
      })
      .mockResolvedValueOnce({
        output: reviewOutput,
        usedFallback: false,
        usage: mockUsage,
      });
    const raw = await attachContentUnit(plan, unit, {
      model: {} as LanguageModel,
      maxRetries: 0,
    });
    expect(LLMCaller.call).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(vi.mocked(LLMCaller.call).mock.calls[0][0].userPrompt),
    ).toEqual(current.payload);
    expect(raw.codeMap).toEqual(current.codeMap);
    const before = structuredClone(raw),
      result = assembleContentAttachment(plan, [raw]);
    const {
      independentReviewFindings: _findings,
      reviewDisagreements: _disagreements,
      ...initialResult
    } = result;
    expect(result.issues).toEqual([]);
    expect(
      result.contents.find((c) => c.registryRef === 'R2')!.excerpts[0]
        .fragments,
    ).toEqual(['Pit; Wall']);
    expect(raw).toEqual(before);
    const old = createContentAttachmentDecisionInput(plan, unit);
    const historical = {
      ...raw,
      ...createContentAttachmentRequest(plan, unit, 'content-attachment.v24'),
      codeMap: old.codeMap,
    };
    expect(JSON.parse(historical.userPrompt)).toEqual(old.payload);
    expect(assembleContentAttachment(plan, [historical])).toEqual(
      initialResult,
    );
    const forged = structuredClone(raw);
    (forged.codeMap as typeof current.codeMap).candidateTableRows[0].rowIndex =
      99;
    expect(
      assembleContentAttachment(plan, [forged]).issues[0].reason,
    ).toContain('code map');
    const changed = { ...raw, userPrompt: historical.userPrompt };
    expect(
      assembleContentAttachment(plan, [changed]).issues[0].reason,
    ).toContain('Audit does not match');
  });
});
