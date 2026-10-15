import type { ProcessedDocument } from '@heripo/model';

import type {
  ContentAttachmentPlan,
  ContentAttachmentSelectionAudit,
  ContentAttachmentSelectionResponse,
} from './content-attachment';

import { describe, expect, test } from 'vitest';

import {
  assembleContentAttachment,
  attachContentUnit,
  createContentAttachmentRequest,
} from './content-attachment';
import { createContentAttachmentDecisionInput } from './content-attachment-decisions';
import { createContentAttachmentSelectionInput } from './content-attachment-excerpts';
import { buildDocumentResourceIndex } from './document-resource-index';

const s6 = [
  '우물은 조사대상지 중앙부의 평탄대지의 남쪽 해발 11.0m 지점에 위치한다.',
  '남쪽 조사 경계구역 과 접해있으며, 북쪽으로는 약 7.5m 거리를 두고 조선시대 건물지군이 위치하고 있다(사진 85.',
  '최 상부의 표토와 현대 퇴적층을 제거하자, 남서쪽 조사경계에 걸쳐 유구 윤곽선이 확인되었다.',
  '유구 윤곽선은 말각방형의 수혈에 서쪽으로 기다란 구가 부착된 평면형태이다(사진 103).',
];
const empty = (): ContentAttachmentSelectionResponse => ({
  assignments: [],
  unresolved: [],
  ignored: [],
});
function fixture(texts = [s6.join(' ')], table = false): ContentAttachmentPlan {
  const doc: ProcessedDocument = {
    reportId: 'report',
    pageRangeMap: { 122: { startPageNo: -1, endPageNo: -1 } },
    chapters: [
      {
        id: 'ch',
        originTitle: '調査',
        title: '調査',
        level: 1,
        pageNo: -1,
        textBlocks: texts.map((text, i) => ({
          id: `txt-${i}`,
          sourceRef: `#/texts/${i}`,
          pdfPageNo: 122,
          text,
        })),
        imageIds: [],
        tableIds: table ? ['table'] : [],
        footnoteIds: [],
      },
    ],
    images: [],
    footnotes: [],
    tables: table
      ? [
          {
            id: 'table',
            sourceRef: '#/tables/0',
            pdfPageNo: 122,
            numRows: 2,
            numCols: 3,
            grid: [
              [
                { text: '番号', rowSpan: 2, colSpan: 1, isHeader: true },
                { text: '寸法', rowSpan: 1, colSpan: 2, isHeader: true },
              ],
              [
                { text: ' 7 ', rowSpan: 1, colSpan: 1, isHeader: false },
                { text: '', rowSpan: 1, colSpan: 1, isHeader: false },
                { text: '20', rowSpan: 1, colSpan: 1, isHeader: false },
              ],
            ],
          },
        ]
      : [],
  };
  const index = buildDocumentResourceIndex(doc);
  const sources = index.resources
    .filter((r) => r.kind === 'text' || r.kind === 'tableCell')
    .map((resource) => ({ sourceId: `source:${resource.key}`, resource }));
  const path = [{ id: 'ch', originTitle: '調査' }];
  return {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: 'hash',
    candidateSnapshotId: 'snapshot',
    registrySha256: 'registry',
    registryUncertainties: [],
    registry: [
      'Well',
      'Modern deposit',
      'Topsoil',
      'Topsoil',
      'Natural ground',
    ].map((name, i) => ({
      ref: `R${i + 1}`,
      groupId: `g${i + 1}`,
      recordKind: i === 0 ? 'feature' : 'layer',
      mentions: [
        {
          candidateId: `c${i}`,
          sourceName: name,
          sourceIdentifier: null,
          chapterPath: path,
          evidence: [],
        },
      ],
    })),
    pages: [{ pdfPageNo: 122, unitIds: ['page-122'], status: 'planned' }],
    units: [
      {
        unitId: 'page-122',
        pdfPageNo: 122,
        sources,
        chapters: [{ chapterId: 'ch', path }],
        tables: index.resources
          .filter((r) => r.kind === 'table')
          .map((r) => ({ key: r.key, data: r.data })),
        readOnlyContext: [
          {
            resourceKey: 'context',
            text: 'Read-only context cannot be selected.',
          },
        ],
      },
    ],
  };
}
function audit(
  plan: ContentAttachmentPlan,
  response: ContentAttachmentSelectionResponse,
): ContentAttachmentSelectionAudit {
  return {
    unitId: plan.units[0].unitId,
    ...createContentAttachmentRequest(plan, plan.units[0]),
    codeMap: createContentAttachmentDecisionInput(plan, plan.units[0]).codeMap,
    response,
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
}

describe('immutable content excerpt selection', () => {
  test('reports ignored literal artifact headings in their chapter without repairing responses or rejecting other text and ambiguous identities', () => {
    const plan = fixture(
      [
        '7. Vessel (Fig. 4)',
        '7. Vessel',
        'Features',
        '7. Vessel body description.',
        '7. Vessel (Fig. 4). More.',
        '7. Vessellet',
        '7. Vessel (broken',
        '8. Plate (Photo 5)',
        '7. Vessel (Fig. 4)',
      ],
      true,
    );
    for (const [i, entry] of plan.registry.entries()) {
      entry.recordKind = i === 4 ? 'feature' : 'artifact';
      entry.mentions[0].sourceName = i === 3 ? 'Plate' : 'Vessel';
      entry.mentions[0].sourceIdentifier =
        i === 2 ? null : i === 3 ? '8.' : '7.';
    }
    plan.registry[1].mentions[0].chapterPath = [
      { id: 'other', originTitle: 'Other' },
    ];
    plan.registry[3].mentions[0].chapterPath = [];
    plan.registry.push({ ...plan.registry[0], ref: 'R6', groupId: 'other' });
    const unit = plan.units[0];
    const input = createContentAttachmentSelectionInput(plan, unit);
    const raw = audit(plan, {
      ...empty(),
      ignored: input.codeMap.excerpts.map((e) => ({
        excerptRef: e.ref,
        reason: 'Generic heading',
      })),
    });
    const before = structuredClone([plan, raw]);
    const result = assembleContentAttachment(plan, [raw]);
    const headings = input.codeMap.excerpts.filter((e) =>
      ['txt-0', 'txt-1', 'txt-8'].includes(e.evidence[0].resourceId!),
    );
    expect(headings).toHaveLength(3);
    expect(result.issues.map((i) => i.reason)).toEqual(
      headings.map(
        (e) =>
          `Registered artifact heading cannot be ignored: ${e.ref} (R1, R6)`,
      ),
    );
    expect(result.completedUnitIds).toEqual([]);
    expect(result.contents).toEqual([]);
    expect(result.ignoredPassages).toHaveLength(input.codeMap.excerpts.length);
    expect([plan, raw]).toEqual(before);
    for (const version of [
      'content-attachment.v11',
      'content-attachment.v12',
      'content-attachment.v13',
      'content-attachment.v14',
      'content-attachment.v15',
      'content-attachment.v16',
      'content-attachment.v17',
      'content-attachment.v18',
      'content-attachment.v19',
      'content-attachment.v20',
    ] as const) {
      const historical = {
        ...raw,
        ...createContentAttachmentRequest(plan, unit, version),
        codeMap:
          version === 'content-attachment.v13' ||
          version === 'content-attachment.v14' ||
          version === 'content-attachment.v15' ||
          version === 'content-attachment.v16' ||
          version === 'content-attachment.v17' ||
          version === 'content-attachment.v18' ||
          version === 'content-attachment.v19' ||
          version === 'content-attachment.v20'
            ? createContentAttachmentDecisionInput(plan, unit).codeMap
            : createContentAttachmentSelectionInput(plan, unit).codeMap,
      };
      expect(assembleContentAttachment(plan, [historical]).issues).toEqual(
        version === 'content-attachment.v11' ? [] : result.issues,
      );
    }
    const ambiguous = audit(plan, {
      ...empty(),
      unresolved: headings.map((e) => ({
        excerptRef: e.ref,
        candidateRefs: ['R1', 'R6'],
        reason: 'Identical registered identities',
      })),
      ignored: raw.response.ignored.filter(
        (e) => !headings.some((h) => h.ref === e.excerptRef),
      ),
    });
    const unresolved = assembleContentAttachment(plan, [ambiguous]);
    expect(unresolved.issues).toEqual([]);
    expect(unresolved.completedUnitIds).toEqual([unit.unitId]);
    expect(unresolved.unresolved).toHaveLength(3);
    expect(unresolved.contents).toEqual([]);
  });
  test('requires identified table owners and ignores generic headers without rewriting current or historical responses', () => {
    const plan = fixture(['Text.'], true);
    const unit = plan.units[0];
    const table = unit.tables[0].data;
    table.caption = { fullText: 'Well inventory' };
    table.grid[0][0].text = '호수';
    table.grid[0][1].text = '규모(단위 : cm)';
    table.grid[0].forEach((cell) => {
      cell.isHeader = false;
    });
    plan.registry[0].mentions[0].sourceIdentifier = ' 7 ';
    const valid = audit(plan, {
      ...empty(),
      assignments: ['E1', 'E4', 'E5'].map((excerptRef) => ({
        excerptRef,
        candidateRefs: ['R1'],
        reason: 'Identified row or body',
      })),
      ignored: ['E2', 'E3'].map((excerptRef) => ({
        excerptRef,
        reason: 'Column label',
      })),
    });
    expect(assembleContentAttachment(plan, [valid]).issues).toEqual([]);
    const raw = audit(plan, {
      ...empty(),
      assignments: [
        { excerptRef: 'E2', candidateRefs: ['R2'], reason: 'Column label' },
      ],
      ignored: ['E1', 'E3', 'E4', 'E5'].map((excerptRef) => ({
        excerptRef,
        reason: 'Row item',
      })),
    });
    const before = structuredClone([plan, raw]);
    const result = assembleContentAttachment(plan, [raw]);
    expect(result.issues.map((e) => e.reason)).toEqual([
      'Generic table header must be ignored: E2',
      'Identified table-row cell must include R1: E4',
      'Identified table-row cell must include R1: E5',
    ]);
    for (const version of [
      'content-attachment.v18',
      'content-attachment.v19',
      'content-attachment.v20',
    ] as const) {
      const previousTableAudit = {
        ...raw,
        ...createContentAttachmentRequest(plan, unit, version),
      };
      expect(assembleContentAttachment(plan, [previousTableAudit])).toEqual(
        result,
      );
    }
    expect(result.completedUnitIds).toEqual([]);
    expect(result.contents.map((c) => c.registryRef)).toEqual(['R2']);
    expect(result.ignoredPassages).toHaveLength(4);
    expect([plan, raw]).toEqual(before);
    const historical = {
      ...raw,
      ...createContentAttachmentRequest(plan, unit, 'content-attachment.v17'),
    };
    expect(assembleContentAttachment(plan, [historical]).issues).toEqual([]);
    const ambiguousHeader = structuredClone(valid);
    ambiguousHeader.response.ignored.pop();
    ambiguousHeader.response.unresolved.push({
      excerptRef: 'E3',
      candidateRefs: ['R2'],
      reason: 'Header',
    });
    expect(
      assembleContentAttachment(plan, [ambiguousHeader]).issues.map(
        (e) => e.reason,
      ),
    ).toEqual(['Generic table header must be ignored: E3']);
    const wrongOwner = structuredClone(valid);
    wrongOwner.response.assignments[2].candidateRefs = ['R2'];
    expect(
      assembleContentAttachment(plan, [wrongOwner]).issues.map((e) => e.reason),
    ).toEqual(['Identified table-row cell must include R1: E5']);
    const partial = structuredClone(plan);
    partial.units[0].sources = partial.units[0].sources.filter(
      (source) => source.resource.kind === 'text',
    );
    expect(
      assembleContentAttachment(partial, [
        audit(partial, {
          ...empty(),
          ignored: [{ excerptRef: 'E1', reason: 'Body' }],
        }),
      ]).issues,
    ).toEqual([]);
  });
  test('bounds table checks by exact identifiers, literal caption names or original row anchors and never guesses ambiguous owners', () => {
    const run = (
      change: (p: ContentAttachmentPlan) => void,
      assigned = 'E5',
    ) => {
      const plan = fixture(['Text.'], true);
      const table = plan.units[0].tables[0].data;
      table.grid[0][0].text = 'Number';
      table.grid[0][1].text = 'Unrecognized column';
      plan.registry[0].mentions[0].sourceIdentifier = ' 7 ';
      change(plan);
      const input = createContentAttachmentDecisionInput(plan, plan.units[0]);
      const raw = audit(plan, {
        ...empty(),
        assignments: [
          {
            excerptRef: assigned,
            candidateRefs: ['R2'],
            reason: 'Original decision',
          },
        ],
        ignored: input.codeMap.excerpts
          .filter((e) => e.ref !== assigned)
          .map((e) => ({ excerptRef: e.ref, reason: 'Original exclusion' })),
      });
      return assembleContentAttachment(plan, [raw]).issues.map((e) => e.reason);
    };
    expect(run(() => {})).toEqual([]);
    expect(
      run((p) => {
        p.units[0].tables[0].data.caption = { fullText: 'Other objects' };
      }),
    ).toEqual([]);
    expect(
      run((p) => {
        p.registry[0].mentions[0].sourceName = '';
        p.units[0].tables[0].data.caption = { fullText: 'Well inventory' };
      }),
    ).toEqual([]);
    expect(
      run((p) => {
        p.units[0].tables[0].data.caption = { fullText: 'Well inventory' };
        p.registry[0].mentions[0].sourceIdentifier = '7';
      }),
    ).toEqual([]);
    expect(
      run((p) => {
        p.units[0].tables[0].data.caption = { fullText: 'Well inventory' };
        p.registry[1].mentions[0].sourceName = 'Well';
        p.registry[1].mentions[0].sourceIdentifier = ' 7 ';
      }),
    ).toEqual([]);
    expect(
      run((p) => {
        const selected = createContentAttachmentDecisionInput(p, p.units[0]);
        p.registry[0].mentions[0].evidence = selected.codeMap.excerpts.find(
          (e) => e.ref === 'E4',
        )!.evidence;
      }),
    ).toEqual([
      'Identified table-row cell must include R1: E4',
      'Identified table-row cell must include R1: E5',
    ]);
    expect(
      run((p) => {
        const selected = createContentAttachmentDecisionInput(p, p.units[0]);
        p.registry[0].mentions[0].evidence = structuredClone(
          selected.codeMap.excerpts.find((e) => e.ref === 'E4')!.evidence,
        );
        p.registry[0].mentions[0].evidence[0].resourceKey =
          '/tables/0/grid/10/0';
      }),
    ).toEqual([]);
    expect(run(() => {}, 'E2')).toEqual([
      'Generic table header must be ignored: E2',
    ]);
    expect(
      run((p) => {
        p.units[0].tables[0].data.grid[0][0].isHeader = false;
      }, 'E2'),
    ).toEqual([]);
    expect(
      run((p) => {
        p.units[0].tables[0].data.caption = { fullText: 'Well inventory' };
        p.units[0].tables[0].data.grid[1][2].text = 'Name';
      }),
    ).toEqual([
      'Identified table-row cell must include R1: E4',
      'Identified table-row cell must include R1: E5',
    ]);
  });
  test('freezes four S6 sentences with decimals and an unclosed parenthesis, then resolves confirmed and uncertain IDs to unchanged original ranges', () => {
    const plan = fixture(),
      unit = plan.units[0];
    const input = createContentAttachmentSelectionInput(plan, unit);
    expect(input.payload.current.excerpts.map((row) => row[4])).toEqual(s6);
    expect(input.codeMap.excerpts.map((e) => e.evidence[0])).toMatchObject([
      { charStart: 0, charEnd: 42 },
      { charStart: 43, charEnd: 108 },
      { charStart: 109, charEnd: 160 },
      { charStart: 161, charEnd: 210 },
    ]);
    expect(input.payload.candidates).toHaveLength(5);
    expect(JSON.stringify(input.payload)).not.toContain('charStart');
    expect(input.codeMap.segmentation).toMatchObject({
      version: 'sentence-excerpts.v1',
      locale: 'en',
      icu: expect.any(String),
    });
    const raw = audit(plan, {
      assignments: s6.map((_, i) => ({
        excerptRef: `E${i + 1}`,
        candidateRefs: i === 2 ? ['R1', 'R2'] : ['R1'],
        reason: '原文に明示',
      })),
      unresolved: [
        {
          excerptRef: 'E3',
          candidateRefs: ['R3', 'R4'],
          reason: '表土の同一性は未確定',
        },
      ],
      ignored: [],
    });
    const before = structuredClone([plan, raw]);
    const result = assembleContentAttachment(plan, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.completedUnitIds).toEqual(['page-122']);
    expect(result.contents[0].excerpts.map((e) => e.fragments)).toEqual(
      s6.map((s) => [s]),
    );
    expect(result.unresolved[0].evidence).toEqual(
      result.contents[1].excerpts[0].occurrences[0].evidence,
    );
    expect(result.unresolved[0].evidence[0]).toMatchObject({
      resourceId: 'txt-0',
      sourceRefs: ['#/texts/0'],
      logicalPageRange: { startPageNo: -1, endPageNo: -1 },
      quote: s6[2],
    });
    expect([plan, raw]).toEqual(before);
    expect(raw.promptVersion).toBe('content-attachment.v21');
    expect(raw.systemPrompt).toContain('Never return quotes');
    for (const version of [
      'content-attachment.v9',
      'content-attachment.v10',
      'content-attachment.v11',
      'content-attachment.v12',
      'content-attachment.v13',
      'content-attachment.v14',
      'content-attachment.v15',
      'content-attachment.v16',
      'content-attachment.v17',
      'content-attachment.v18',
      'content-attachment.v19',
      'content-attachment.v20',
    ] as const) {
      const historical = {
        ...raw,
        ...createContentAttachmentRequest(plan, unit, version),
        codeMap:
          version === 'content-attachment.v13' ||
          version === 'content-attachment.v14' ||
          version === 'content-attachment.v15' ||
          version === 'content-attachment.v16' ||
          version === 'content-attachment.v17' ||
          version === 'content-attachment.v18' ||
          version === 'content-attachment.v19' ||
          version === 'content-attachment.v20'
            ? createContentAttachmentDecisionInput(plan, unit).codeMap
            : createContentAttachmentSelectionInput(plan, unit).codeMap,
      };
      expect(historical.userPrompt).toBe(
        version === 'content-attachment.v13' ||
          version === 'content-attachment.v14' ||
          version === 'content-attachment.v15' ||
          version === 'content-attachment.v16' ||
          version === 'content-attachment.v17' ||
          version === 'content-attachment.v18' ||
          version === 'content-attachment.v19' ||
          version === 'content-attachment.v20'
          ? raw.userPrompt
          : JSON.stringify(input.payload),
      );
      expect(raw.systemPrompt.startsWith(historical.systemPrompt)).toBe(true);
      expect(assembleContentAttachment(plan, [historical])).toEqual(result);
      expect(
        assembleContentAttachment(plan, [
          { ...historical, systemPrompt: raw.systemPrompt },
        ]).issues[0].reason,
      ).toContain('Audit does not match');
    }
    const forged = structuredClone(raw);
    (forged.codeMap as typeof input.codeMap).excerpts[0].evidence[0].charEnd++;
    expect(
      assembleContentAttachment(plan, [forged]).issues[0].reason,
    ).toContain('code map');
  });
  test('keeps numbered headings, balanced citations, Unicode, repeated sentences, whitespace and table-cell spans without normalizing text', () => {
    const cases: Array<[string, string[]]> = [
      ['29. Vessel (Fig. 2). Next.', ['29. Vessel (Fig. 2).', 'Next.']],
      [
        'Alpha [part. More] finished. Beta.',
        ['Alpha [part. More] finished.', 'Beta.'],
      ],
      ['A （Fig. 2）. B.', ['A （Fig. 2）.', 'B.']],
      [
        'Incomplete (ref 85. Next sentence. Last.',
        ['Incomplete (ref 85.', 'Next sentence.', 'Last.'],
      ],
      [
        ') Before. A (bad] still. End.',
        [') Before.', 'A (bad] still.', 'End.'],
      ],
      ['境界の一部。第二文。', ['境界の一部。', '第二文。']],
      ['  Same. Same.  ', ['Same.', 'Same.']],
      ['29.', ['29.']],
      ['', []],
      [' \n\t', []],
    ];
    for (const [text, expected] of cases) {
      const plan = fixture([text]);
      const input = createContentAttachmentSelectionInput(plan, plan.units[0]);
      expect(
        input.payload.current.excerpts.map((row) => row[4]),
        text,
      ).toEqual(expected);
      const raw = audit(plan, {
        ...empty(),
        assignments: input.codeMap.excerpts.map((e) => ({
          excerptRef: e.ref,
          candidateRefs: ['R1'],
          reason: '原文',
        })),
      });
      const result = assembleContentAttachment(plan, [raw]);
      expect(result.issues, text).toEqual([]);
      if (text.includes('Same.'))
        expect(result.contents[0].excerpts[0].occurrences).toHaveLength(2);
    }
    const plan = fixture(['Text.', '  '], true);
    const input = createContentAttachmentSelectionInput(plan, plan.units[0]);
    expect(
      input.payload.current.excerpts
        .filter((row) => row[1] === 'tableCell')
        .map((row) => row[4]),
    ).toEqual(['番号', '寸法', ' 7 ', '20']);
    expect(input.payload.current.tables[0].grid[0][0]).toEqual([
      'E2',
      null,
      2,
      1,
      true,
    ]);
    expect(input.payload.current.tables[0].grid[1][1]).toEqual([
      null,
      '',
      1,
      1,
      false,
    ]);
    const raw = audit(plan, {
      ...empty(),
      ignored: input.codeMap.excerpts.map((e) => ({
        excerptRef: e.ref,
        reason: '対象外',
      })),
    });
    expect(assembleContentAttachment(plan, [raw]).issues).toEqual([]);
    const cell = plan.units[0].sources.find(
      (s) => s.resource.kind === 'tableCell',
    )!;
    const partial = structuredClone(plan);
    partial.units[0].sources = [structuredClone(cell)];
    expect(
      createContentAttachmentSelectionInput(partial, partial.units[0]).payload
        .current.tables[0].grid[1][0],
    ).toEqual([null, ' 7 ', 1, 1, false]);
  });
  test('rejects missing, unknown or repeated IDs, invented quotes, invalid targets and conflicting exclusions without repairing responses', async () => {
    const plan = fixture(['First. Second.']);
    const base = audit(plan, {
      ...empty(),
      assignments: [
        { excerptRef: 'E1', candidateRefs: ['R1'], reason: '原文' },
        { excerptRef: 'E2', candidateRefs: ['R1'], reason: '原文' },
      ],
    });
    const variants: Array<(a: ContentAttachmentSelectionAudit) => void> = [
      (a) => {
        a.response.assignments.pop();
      },
      (a) => {
        a.response.assignments[0].excerptRef = 'E999';
      },
      (a) => {
        a.response.assignments.push(a.response.assignments[0]);
      },
      (a) => {
        a.response.assignments[0].candidateRefs = ['R999'];
      },
      (a) => {
        a.response.assignments[0].candidateRefs = ['R1', 'R1'];
      },
      (a) => {
        a.response.ignored.push({ excerptRef: 'E1', reason: '除外' });
      },
      (a) => {
        Object.assign(a.response.assignments[0], { quote: 'Invented text.' });
      },
      (a) => {
        delete a.codeMap;
      },
    ];
    for (const change of variants) {
      const raw = structuredClone(base);
      change(raw);
      const before = structuredClone(raw);
      const result = assembleContentAttachment(plan, [raw]);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.completedUnitIds).toEqual([]);
      expect(raw).toEqual(before);
    }
    const ignored = audit(plan, {
      ...empty(),
      ignored: [{ excerptRef: 'E999', reason: '除外' }],
    });
    expect(
      assembleContentAttachment(plan, [ignored]).issues.length,
    ).toBeGreaterThan(0);
    const unresolved = audit(plan, {
      ...empty(),
      unresolved: [
        { excerptRef: 'E1', candidateRefs: [], reason: '候補不足' },
        {
          excerptRef: 'E2',
          candidateRefs: ['R3', 'R4'],
          reason: '同一性未確定',
        },
      ],
    });
    expect(assembleContentAttachment(plan, [unresolved]).issues).toEqual([]);
    const blank = fixture(['  ']);
    await expect(
      attachContentUnit(blank, blank.units[0], {
        model: {} as never,
        maxRetries: 0,
      }),
    ).rejects.toThrow('No selectable');
  });
});
