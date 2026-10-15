import type { ProcessedDocument } from '@heripo/model';

import type { CandidateEvidence } from './candidate-discovery';
import type {
  ContentAttachmentPlan,
  ContentAttachmentSelectionAudit,
} from './content-attachment';

import { describe, expect, test } from 'vitest';

import {
  assembleContentAttachment,
  createContentAttachmentRequest,
} from './content-attachment';
import { createContentAttachmentBodyBlockInput } from './content-attachment-body-blocks';
import {
  adjacentAttachmentBody,
  createContentAttachmentContextInput,
} from './content-attachment-context';
import { createContentAttachmentTableAnchorInput } from './content-attachment-table-anchors';
import { buildDocumentResourceIndex } from './document-resource-index';

function fixture() {
  const cell = (text: string, isHeader = false, colSpan = 1) => ({
    text,
    isHeader,
    rowSpan: 1,
    colSpan,
  });
  const doc: ProcessedDocument = {
    reportId: 'report',
    pageRangeMap: {},
    images: [],
    footnotes: [],
    chapters: [
      {
        id: 'pits',
        title: 'Pits',
        originTitle: 'Pits',
        level: 1,
        pageNo: 1,
        textBlocks: [
          {
            id: 'inventory',
            pdfPageNo: 1,
            text: 'Three pits were investigated.',
          },
          { id: 'subject', pdfPageNo: 1, text: 'Most were cut into red clay' },
          { id: 'body', pdfPageNo: 2, text: 'or gray clay. Their plans vary.' },
          { id: 'next', pdfPageNo: 4, text: 'Finds' },
          { id: 'after', pdfPageNo: 4, text: 'A vessel was recovered.' },
        ],
        tableIds: ['local', 'remote', 'remote-two'],
        imageIds: [],
        footnoteIds: [],
      },
      {
        id: 'other',
        title: 'Other survey',
        originTitle: 'Other survey',
        level: 1,
        pageNo: 3,
        textBlocks: [],
        tableIds: ['other'],
        imageIds: [],
        footnoteIds: [],
      },
    ],
    tables: [
      {
        id: 'local',
        pdfPageNo: 2,
        numRows: 2,
        numCols: 2,
        grid: [
          [cell('Number', true), cell('Shape', true)],
          [cell('1'), cell('round')],
        ],
      },
      {
        id: 'remote',
        pdfPageNo: 3,
        caption: { fullText: 'Original inventory' },
        numRows: 3,
        numCols: 3,
        grid: [
          [cell('Number', true), cell('Dimensions', true, 2)],
          [cell('2'), cell('round'), cell('12')],
          [cell('3'), cell('square'), cell('14')],
        ],
      },
      {
        id: 'other',
        pdfPageNo: 3,
        numRows: 2,
        numCols: 2,
        grid: [
          [cell('Number', true), cell('Shape', true)],
          [cell('2'), cell('round')],
        ],
      },
      {
        id: 'remote-two',
        pdfPageNo: 4,
        numRows: 1,
        numCols: 1,
        grid: [[cell('4')]],
      },
    ],
  };
  const index = buildDocumentResourceIndex(doc);
  const selected = index.resources
    .filter((r) => r.kind === 'text' || r.kind === 'tableCell')
    .map((resource) => ({ sourceId: `source:${resource.key}`, resource }));
  const mainPath = [{ id: 'pits', originTitle: 'Pits' }];
  const evidence = (key: string): CandidateEvidence => {
    const { resource: r, sourceId } = selected.find(
      (s) => s.resource.key === key,
    )!;
    return {
      sourceId,
      resourceKey: key,
      resourceId: r.resourceId,
      sourceRefs: r.sourceRefs,
      pdfPageNo: r.pdfPageNo,
      logicalPageRange: r.logicalPageRange,
      charStart: 0,
      charEnd: r.data.text.length,
      quote: r.data.text,
    };
  };
  const specs = [
    ['/tables/0/grid/1/0'],
    ['/tables/1/grid/1/0', '/tables/1/grid/1/1'],
    ['/tables/1/grid/2/0'],
    ['/tables/2/grid/1/0'],
    ['/chapters/0/textBlocks/0'],
    ['/tables/3/grid/0/0'],
  ];
  const plan: ContentAttachmentPlan = {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: 'hash',
    candidateSnapshotId: 'snapshot',
    registrySha256: 'registry',
    registryUncertainties: [],
    pages: [],
    registry: specs.map((keys, i) => ({
      ref: `R${i + 1}`,
      groupId: `long-group-${i}`,
      recordKind: 'feature',
      mentions: [
        {
          candidateId: `long-candidate-${i}`,
          sourceName: 'Pit',
          sourceIdentifier: String(i + 1),
          chapterPath:
            i === 3 ? [{ id: 'other', originTitle: 'Other survey' }] : mainPath,
          evidence: keys.map(evidence),
        },
      ],
    })),
    units: [1, 2, 3, 4].map((page) => ({
      unitId: `page-${page}`,
      pdfPageNo: page,
      sources: selected.filter((s) => s.resource.pdfPageNo === page),
      chapters: [{ chapterId: 'pits', path: mainPath }],
      tables: index.resources
        .filter((r) => r.kind === 'table')
        .filter((r) => r.pdfPageNo === page)
        .map((r) => ({ key: r.key, data: r.data })),
      readOnlyContext: [],
    })),
  };
  return { plan, unit: plan.units[1], evidence };
}

describe('read-only original body and table context', () => {
  test('retains preceding inventory and qualified split text around a table-ended batch and supplies exact nonlocal candidate rows', () => {
    const { plan, unit } = fixture(),
      before = structuredClone(plan);
    const input = createContentAttachmentContextInput(plan, unit),
      old = createContentAttachmentTableAnchorInput(plan, unit);
    expect(input.payload.current.readOnlyContext.map((r) => r[2])).toEqual([
      'Three pits were investigated.',
      'Most were cut into red clay',
      'Finds',
      'A vessel was recovered.',
    ]);
    expect(input.payload.current.excerpts).toEqual(
      old.payload.current.excerpts,
    );
    expect(input.codeMap.excerpts).toEqual(old.codeMap.excerpts);
    expect(input.payload.supportingRows).toEqual([
      [
        'M1',
        'Q1',
        1,
        [
          [0, '2'],
          [1, 'round'],
        ],
      ],
      ['M2', 'Q1', 2, [[0, '3']]],
      ['M3', 'Q2', 0, [[0, '4']]],
    ]);
    expect(input.payload.supportingAnchors).toEqual([
      ['R2', 'M1', 0],
      ['R2', 'M1', 1],
      ['R3', 'M2', 0],
      ['R6', 'M3', 0],
    ]);
    expect(input.payload.supportingTables[0]).toEqual({
      ref: 'Q1',
      contexts: ['C1'],
      caption: 'Original inventory',
      headers: [
        [0, 0, 'Number', 1, 1, true],
        [0, 1, 'Dimensions', 1, 2, true],
      ],
    });
    expect(input.payload.supportingTables[1]).toEqual({
      ref: 'Q2',
      contexts: ['C1'],
      caption: null,
      headers: [],
    });
    expect(input.codeMap.supportingAnchors[0].evidence).toEqual(
      plan.registry[1].mentions[0].evidence[0],
    );
    expect(input.codeMap.supportingBody[0].resourceKey).toBe(
      '/chapters/0/textBlocks/0',
    );
    const headerProbe = structuredClone(plan);
    headerProbe.units[2].tables[0].data.grid[0][1].isHeader = false;
    expect(
      createContentAttachmentContextInput(headerProbe, headerProbe.units[1])
        .payload.supportingTables[0].headers[1],
    ).toEqual([0, 1, 'Dimensions', 1, 2, false]);
    expect(input.payload.supportingAnchors.some((a) => a[0] === 'R4')).toBe(
      false,
    );
    expect(
      input.payload.supportingRows
        .flatMap((r) => r[3])
        .some((c) => c[1] === '12'),
    ).toBe(false);
    for (const hidden of [
      'long-group',
      'long-candidate',
      'resourceKey',
      'charStart',
      '/tables/',
    ])
      expect(JSON.stringify(input.payload)).not.toContain(hidden);
    plan.registry.reverse();
    const reversed = createContentAttachmentContextInput(plan, unit);
    expect(reversed.payload.supportingRows).toEqual(
      input.payload.supportingRows,
    );
    expect([...reversed.payload.supportingAnchors].sort()).toEqual(
      [...input.payload.supportingAnchors].sort(),
    );
    plan.registry.reverse();
    expect(plan).toEqual(before);
  });

  test('handles table-only batches, document edges, unsorted pages and caller context without mutating or selecting them', () => {
    const { plan, unit } = fixture();
    const texts = plan.units
      .flatMap((u) => u.sources)
      .map((s) => s.resource)
      .filter((r) => r.kind === 'text');
    const cells = unit.sources.filter((s) => s.resource.kind === 'tableCell');
    expect(
      adjacentAttachmentBody(
        [...texts.slice(3), ...texts.slice(0, 3)],
        cells,
        2,
      ).map((c) => c.text),
    ).toEqual([
      'Most were cut into red clay',
      'or gray clay. Their plans vary.',
      'Finds',
      'A vessel was recovered.',
    ]);
    expect(adjacentAttachmentBody(texts, cells, 0).map((c) => c.text)).toEqual([
      'Three pits were investigated.',
      'Most were cut into red clay',
    ]);
    expect(adjacentAttachmentBody(texts, cells, 99).map((c) => c.text)).toEqual(
      ['Finds', 'A vessel was recovered.'],
    );
    expect(adjacentAttachmentBody([], cells, 2)).toEqual([]);
    const first = plan.units[0];
    expect(
      adjacentAttachmentBody(texts, first.sources, 1).map((c) => c.text),
    ).toEqual(['or gray clay. Their plans vary.', 'Finds']);
    unit.sources.reverse();
    expect(
      createContentAttachmentContextInput(plan, unit).payload.current
        .readOnlyContext[0][2],
    ).toBe('Three pits were investigated.');
    unit.readOnlyContext = [
      { resourceKey: '/caller', text: 'Caller context is evidence only.' },
    ];
    plan.registry[0].mentions[0].chapterPath = [];
    expect(
      createContentAttachmentContextInput(
        plan,
        unit,
      ).payload.current.readOnlyContext.at(-1),
    ).toEqual(['B5', [], 'Caller context is evidence only.']);
    unit.sources = cells;
    const none = createContentAttachmentContextInput(plan, unit);
    expect(
      none.payload.current.excerpts.every((e) => e[1] === 'tableCell'),
    ).toBe(true);
    plan.registry = [];
    const noAnchors = createContentAttachmentContextInput(plan, unit);
    expect(noAnchors.payload.supportingRows).toEqual([]);
    expect(noAnchors.payload.supportingTables).toEqual([]);
  });

  test('deduplicates aliases and ignores missing or body evidence while rejecting changed original cell ranges', () => {
    const { plan, unit } = fixture();
    const alias = structuredClone(plan.registry[1].mentions[0]);
    alias.candidateId = 'alias';
    plan.registry[1].mentions.push(alias);
    const missing = structuredClone(plan.registry[1].mentions[0]);
    missing.candidateId = 'missing';
    missing.evidence[0].resourceKey = '/missing';
    missing.evidence = missing.evidence.slice(0, 1);
    plan.registry[1].mentions.push(missing);
    const input = createContentAttachmentContextInput(plan, unit);
    expect(
      input.payload.supportingAnchors.filter((a) => a[0] === 'R2'),
    ).toHaveLength(2);
    expect(
      input.codeMap.supportingAnchors.filter((a) => a.candidateRef === 'R2'),
    ).toHaveLength(4);
    const mutations: Array<(e: CandidateEvidence) => void> = [
      (e) => {
        e.charStart = 0.5;
      },
      (e) => {
        e.charEnd = 1.5;
      },
      (e) => {
        e.charStart = -1;
      },
      (e) => {
        e.charEnd = 0;
      },
      (e) => {
        e.charEnd = 999;
      },
      (e) => {
        e.quote = 'invented';
      },
    ];
    for (const mutate of mutations) {
      const p = structuredClone(plan);
      mutate(p.registry[1].mentions[0].evidence[0]);
      expect(() => createContentAttachmentContextInput(p, p.units[1])).toThrow(
        'differs from original cell',
      );
    }
  });

  test('keeps context nonselectable, rejects forged support maps and replays exact v30 audits without filling semantic targets', () => {
    const { plan, unit } = fixture(),
      input = createContentAttachmentContextInput(plan, unit),
      old = createContentAttachmentTableAnchorInput(plan, unit);
    const headers = new Set(['E3', 'E4']);
    const raw: ContentAttachmentSelectionAudit = {
      unitId: unit.unitId,
      ...createContentAttachmentRequest(plan, unit, 'content-attachment.v32'),
      codeMap: input.codeMap,
      response: {
        assignments: input.codeMap.excerpts
          .filter((e) => !headers.has(e.ref))
          .map((e) => ({
            excerptRef: e.ref,
            candidateRefs: ['R1'],
            reason: 'Selected by model',
          })),
        unresolved: [],
        ignored: [...headers].map((excerptRef) => ({
          excerptRef,
          reason: 'Header',
        })),
      },
      usage: {
        component: 'test',
        phase: 'test',
        model: 'primary',
        modelName: 'mock',
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      },
    };
    const before = structuredClone(raw),
      result = assembleContentAttachment(plan, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.contents.map((c) => c.registryRef)).toEqual(['R1']);
    expect(raw).toEqual(before);
    const historical = {
      ...raw,
      ...createContentAttachmentRequest(plan, unit, 'content-attachment.v30'),
      codeMap: old.codeMap,
    };
    expect(assembleContentAttachment(plan, [historical])).toEqual(result);
    expect(historical.systemPrompt).not.toContain(
      'READ-ONLY BODY AND SUPPORTING TABLE',
    );
    expect(raw.systemPrompt.startsWith(historical.systemPrompt)).toBe(true);
    const previousContext = {
      ...raw,
      ...createContentAttachmentRequest(plan, unit, 'content-attachment.v31'),
    };
    expect(previousContext.userPrompt).toBe(raw.userPrompt);
    expect(previousContext.codeMap).toEqual(raw.codeMap);
    expect(assembleContentAttachment(plan, [previousContext])).toEqual(result);
    expect(raw.systemPrompt.startsWith(previousContext.systemPrompt)).toBe(
      true,
    );

    const forged = structuredClone(raw);
    (forged.codeMap as typeof input.codeMap).supportingRows[0].rowIndex = 99;
    expect(
      assembleContentAttachment(plan, [forged]).issues[0].reason,
    ).toContain('code map');
    const selected = structuredClone(raw);
    selected.response.assignments[0].excerptRef = 'B1';
    expect(
      assembleContentAttachment(plan, [selected]).issues.some((i) =>
        i.reason.includes('Unknown'),
      ),
    ).toBe(true);
  });
});

describe('original selectable body block input', () => {
  test('preserves distinct original blocks with identical text, skips whitespace and keeps table excerpts separate without changing source ranges', () => {
    const { plan, unit } = fixture();
    const original = unit.sources.find((s) => s.resource.kind === 'text')!;
    const repeated = structuredClone(original);
    repeated.sourceId = 'long-repeat-source';
    repeated.resource.key = '/long-repeat-resource';
    const blank = structuredClone(original);
    blank.sourceId = 'blank';
    blank.resource.key = '/blank-resource';
    blank.resource.data.text = '  \n ';
    unit.sources.push(repeated, blank);
    const before = structuredClone(plan);
    const old = createContentAttachmentContextInput(plan, unit);
    const input = createContentAttachmentBodyBlockInput(plan, unit);
    expect(input.payload.current.bodyBlockColumns).toEqual(['ref', 'excerpts']);
    expect(input.payload.current.bodyBlocks).toEqual([
      ['P1', ['E1', 'E2']],
      ['P2', ['E7', 'E8']],
    ]);
    expect(input.codeMap.bodyBlocks).toEqual([
      {
        ref: 'P1',
        sourceId: original.sourceId,
        resourceKey: original.resource.key,
        excerpts: ['E1', 'E2'],
      },
      {
        ref: 'P2',
        sourceId: repeated.sourceId,
        resourceKey: repeated.resource.key,
        excerpts: ['E7', 'E8'],
      },
    ]);
    expect(input.codeMap.excerpts).toEqual(old.codeMap.excerpts);
    const {
      bodyBlockColumns: _columns,
      bodyBlocks: _blocks,
      ...current
    } = input.payload.current;
    expect(current).toEqual(old.payload.current);
    expect(JSON.stringify(input.payload)).not.toContain('long-repeat');
    expect(plan).toEqual(before);
    const cells = unit.sources.filter((s) => s.resource.kind === 'tableCell');
    unit.sources = cells;
    expect(
      createContentAttachmentBodyBlockInput(plan, unit).payload.current
        .bodyBlocks,
    ).toEqual([]);
  });

  test('replays v31 and v32 without block bindings and replays v33 block bindings and rejects forged or selected block references', () => {
    const { plan, unit } = fixture();
    const current = createContentAttachmentBodyBlockInput(plan, unit);
    const old = createContentAttachmentContextInput(plan, unit);
    const request = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v41',
    );
    expect(request.promptVersion).toBe('content-attachment.v41');
    const latest = createContentAttachmentRequest(plan, unit);
    expect(latest.promptVersion).toBe('content-attachment.v48');
    expect(latest.userPrompt).toBe(request.userPrompt);
    expect(latest.systemPrompt.startsWith(request.systemPrompt)).toBe(true);
    expect(request.systemPrompt).not.toContain(
      'REQUIRED PER-E OUTPUT CONTRACT',
    );
    expect(JSON.parse(request.userPrompt)).toEqual(current.payload);
    expect(request.systemPrompt).toContain(
      'NONREGISTERED SUBJECTS STILL GOVERN FOLLOW-UP SENTENCES',
    );
    const raw: ContentAttachmentSelectionAudit = {
      unitId: unit.unitId,
      ...request,
      codeMap: current.codeMap,
      response: {
        assignments: ['E1', 'E2', 'E5', 'E6'].map((excerptRef) => ({
          excerptRef,
          candidateRefs: ['R1'],
          reason: 'Model selection',
        })),
        unresolved: [],
        ignored: ['E3', 'E4'].map((excerptRef) => ({
          excerptRef,
          reason: 'Header',
        })),
      },
      usage: {
        component: 'test',
        phase: 'test',
        model: 'primary',
        modelName: 'mock',
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      },
    };
    const before = structuredClone(raw);
    const result = assembleContentAttachment(plan, [raw]);
    expect(result.issues).toEqual([]);
    expect(raw).toEqual(before);
    for (const version of [
      'content-attachment.v31',
      'content-attachment.v32',
    ] as const) {
      const historicalRequest = createContentAttachmentRequest(
        plan,
        unit,
        version,
      );
      expect(JSON.parse(historicalRequest.userPrompt)).toEqual(old.payload);
      expect(historicalRequest.systemPrompt).not.toContain(
        'ORIGINAL SELECTABLE BODY BLOCKS',
      );
      expect(
        request.systemPrompt.startsWith(historicalRequest.systemPrompt),
      ).toBe(true);
      expect(
        assembleContentAttachment(plan, [
          { ...raw, ...historicalRequest, codeMap: old.codeMap },
        ]),
      ).toEqual(result);
    }
    const v33 = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v33',
    );
    expect(JSON.parse(v33.userPrompt)).toEqual(current.payload);
    expect(v33.systemPrompt).not.toContain(
      'PARTIAL FOLLOW-UPS PRESERVE QUALIFIED SET EVIDENCE',
    );
    expect(request.systemPrompt.startsWith(v33.systemPrompt)).toBe(true);
    expect(assembleContentAttachment(plan, [{ ...raw, ...v33 }])).toEqual(
      result,
    );
    for (const version of [
      'content-attachment.v34',
      'content-attachment.v35',
      'content-attachment.v36',
    ] as const) {
      const historical = createContentAttachmentRequest(plan, unit, version);
      expect(historical.userPrompt).toBe(request.userPrompt);
      expect(request.systemPrompt.startsWith(historical.systemPrompt)).toBe(
        true,
      );
      expect(historical.systemPrompt).not.toContain(
        'NONREGISTERED ANTECEDENTS GOVERN SUBSEQUENT DESCRIPTIONS',
      );
      expect(
        historical.systemPrompt.includes(
          'SURVEY AREA LAYOUT AND IDENTIFIED TRENCHES',
        ),
      ).toBe(version === 'content-attachment.v36');
      expect(
        assembleContentAttachment(plan, [{ ...raw, ...historical }]),
      ).toEqual(result);
    }
    const v37 = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v37',
    );
    expect(v37.userPrompt).toBe(request.userPrompt);
    expect(request.systemPrompt.startsWith(v37.systemPrompt)).toBe(true);
    expect(v37.systemPrompt).toContain(
      'NONREGISTERED ANTECEDENTS GOVERN SUBSEQUENT DESCRIPTIONS',
    );
    expect(v37.systemPrompt).not.toContain(
      'LATER INDIVIDUAL CLAUSES DO NOT ERASE EARLIER ESTABLISHED-SET DESCRIPTIONS',
    );
    expect(assembleContentAttachment(plan, [{ ...raw, ...v37 }])).toEqual(
      result,
    );
    const v38 = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v38',
    );
    expect(v38.userPrompt).toBe(request.userPrompt);
    expect(request.systemPrompt.startsWith(v38.systemPrompt)).toBe(true);
    expect(v38.systemPrompt).toContain(
      'LATER INDIVIDUAL CLAUSES DO NOT ERASE EARLIER ESTABLISHED-SET DESCRIPTIONS',
    );
    expect(v38.systemPrompt).not.toContain(
      'ROW OWNERS ARE REQUIRED, NOT EXCLUSIVE, TARGETS OF RELATION REMARKS',
    );
    expect(assembleContentAttachment(plan, [{ ...raw, ...v38 }])).toEqual(
      result,
    );
    const v39 = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v39',
    );
    expect(v39.userPrompt).toBe(request.userPrompt);
    expect(request.systemPrompt.startsWith(v39.systemPrompt)).toBe(true);
    expect(v39.systemPrompt).toContain(
      'ROW OWNERS ARE REQUIRED, NOT EXCLUSIVE, TARGETS OF RELATION REMARKS',
    );
    expect(v39.systemPrompt).not.toContain(
      'NEAREST EXPLICIT INVENTORY BOUNDS IMPLICIT FOLLOW-UPS',
    );
    expect(assembleContentAttachment(plan, [{ ...raw, ...v39 }])).toEqual(
      result,
    );
    const v40 = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v40',
    );
    expect(v40.userPrompt).toBe(request.userPrompt);
    expect(request.systemPrompt.startsWith(v40.systemPrompt)).toBe(true);
    expect(v40.systemPrompt).toContain(
      'NEAREST EXPLICIT INVENTORY BOUNDS IMPLICIT FOLLOW-UPS',
    );
    expect(v40.systemPrompt).not.toContain(
      'EACH REGISTERED INDIVIDUAL ARTIFACT HEADING IS AN INDEPENDENT REQUIRED E SELECTION',
    );
    expect(
      assembleContentAttachment(plan, [
        {
          ...raw,
          ...v40,
        },
      ]),
    ).toEqual(result);

    const forged = structuredClone(raw);
    (forged.codeMap as typeof current.codeMap).bodyBlocks[0].excerpts = ['E5'];
    expect(
      assembleContentAttachment(plan, [forged]).issues[0].reason,
    ).toContain('code map');
    const selected = structuredClone(raw);
    selected.response.assignments[0].excerptRef = 'P1';
    expect(
      assembleContentAttachment(plan, [selected]).issues.some((i) =>
        i.reason.includes('Unknown'),
      ),
    ).toBe(true);
  });
});
