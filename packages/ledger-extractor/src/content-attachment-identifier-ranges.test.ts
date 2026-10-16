import type { ProcessedDocument } from '@heripo/model';

import type {
  ContentAttachmentPlan,
  ContentAttachmentSelectionAudit,
  ContentAttachmentSelectionResponse,
} from './content-attachment';

import { expect, test } from 'vitest';

import {
  assembleContentAttachment,
  createContentAttachmentRequest,
} from './content-attachment';
import { createContentAttachmentBodyBlockInput } from './content-attachment-body-blocks';
import { validateContentAttachmentIdentifierRanges } from './content-attachment-identifier-ranges';
import { buildDocumentResourceIndex } from './document-resource-index';

function fixture(text = 'TR6 ~ TR9, TR12 excavation') {
  const plan: ContentAttachmentPlan = {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: 'input',
    candidateSnapshotId: 'snapshot',
    registrySha256: 'registry',
    registryUncertainties: [],
    registry: [6, 7, 8, 9, 12].map((number) => ({
      ref: `object-${number}`,
      groupId: `group-${number}`,
      recordKind: 'trench',
      mentions: [
        {
          candidateId: `mention-${number}`,
          sourceName: 'Trench',
          sourceIdentifier: String(number),
          chapterPath: [{ id: 'survey', originTitle: 'Survey' }],
          evidence: [],
        },
      ],
    })),
    pages: [],
    units: [],
  };
  const evidence = {
    sourceId: 'source',
    resourceKey: '/tables/0/grid/0/0',
    resourceId: null,
    sourceRefs: [],
    pdfPageNo: 1,
    logicalPageRange: null,
    quote: text,
    charStart: 0,
    charEnd: text.length,
  };
  const excerpts = [{ ref: 'E1', evidence: [evidence] }];
  const response: ContentAttachmentSelectionResponse = {
    assignments: [
      {
        excerptRef: 'E1',
        candidateRefs: ['object-6', 'object-7', 'object-8', 'object-12'],
        reason: 'Full named range',
      },
    ],
    unresolved: [],
    ignored: [],
  };
  return { plan, excerpts, response };
}

test('reports a missing inclusive endpoint and interior member while preserving every input and response', () => {
  const f = fixture();
  const before = structuredClone(f);
  expect(
    validateContentAttachmentIdentifierRanges(f.plan, f.excerpts, f.response),
  ).toEqual([
    'Explicit identifier range must include object-9: E1 (TR6 ~ TR9)',
  ]);
  expect(f).toEqual(before);
  f.response.assignments[0].candidateRefs = ['object-6', 'object-9'];
  expect(
    validateContentAttachmentIdentifierRanges(f.plan, f.excerpts, f.response),
  ).toEqual([
    'Explicit identifier range must include object-7: E1 (TR6 ~ TR9)',
    'Explicit identifier range must include object-8: E1 (TR6 ~ TR9)',
  ]);
  f.response.assignments[0].candidateRefs.push('object-7', 'object-8');
  expect(
    validateContentAttachmentIdentifierRanges(f.plan, f.excerpts, f.response),
  ).toEqual([]);
});

test('accepts explicit name variants and separators, independent of registry order and duplicate mentions', () => {
  for (const text of [
    'TR6~9',
    'Trench 6–Trench 9',
    '트렌치 제6호～제9호',
    'TR6-Trench9',
    'TR6—TR9',
  ]) {
    const f = fixture(text);
    f.plan.registry.reverse();
    f.plan.registry[0].mentions.push(
      structuredClone(f.plan.registry[0].mentions[0]),
    );
    expect(
      validateContentAttachmentIdentifierRanges(f.plan, f.excerpts, f.response),
    ).toHaveLength(1);
  }
  const f = fixture('Pit (A) 6번 ~ Pit (A) 9번');
  for (const c of f.plan.registry) {
    c.recordKind = 'feature';
    c.mentions[0].sourceName = 'Pit (A)';
    c.mentions[0].sourceIdentifier = `제${c.mentions[0].sourceIdentifier}호`;
  }
  expect(
    validateContentAttachmentIdentifierRanges(f.plan, f.excerpts, f.response),
  ).toEqual([
    'Explicit identifier range must include object-9: E1 (Pit (A) 6번 ~ Pit (A) 9번)',
  ]);
});

test('does not infer members from measurements, dates, day counts, partial names or malformed ranges', () => {
  for (const text of [
    '6~9 cm',
    '2020–2024',
    'day 6–9',
    'XTR6~9',
    'TR6.2~9',
    'TR6~9cm',
    'TR9~6',
    'TR9007199254740992~9007199254740993',
    'TR6~9007199254740992',
  ]) {
    const f = fixture(text);
    expect(
      validateContentAttachmentIdentifierRanges(f.plan, f.excerpts, f.response),
    ).toEqual([]);
  }
  const f = fixture('TR6 ~ Pit9');
  const c = structuredClone(f.plan.registry[3]);
  c.ref = 'pit9';
  c.recordKind = 'feature';
  c.mentions[0].sourceName = 'Pit';
  f.plan.registry.push(c);
  expect(
    validateContentAttachmentIdentifierRanges(f.plan, f.excerpts, f.response),
  ).toEqual([]);
});

test('requires a confirmed member in one original context and never chooses ambiguous or absent candidates', () => {
  const f = fixture();
  f.response.assignments[0].candidateRefs = ['object-12'];
  expect(
    validateContentAttachmentIdentifierRanges(f.plan, f.excerpts, f.response),
  ).toEqual([]);
  f.response.assignments[0].candidateRefs = ['object-6'];
  const other = structuredClone(f.plan.registry[3]);
  other.ref = 'other9';
  other.mentions[0].chapterPath[0].id = 'other-survey';
  f.plan.registry.push(other);
  expect(
    validateContentAttachmentIdentifierRanges(f.plan, f.excerpts, f.response),
  ).toHaveLength(3);
  f.response.assignments[0].candidateRefs.push('other9');
  expect(
    validateContentAttachmentIdentifierRanges(f.plan, f.excerpts, f.response),
  ).toEqual([]);
  f.response.assignments[0].candidateRefs = [
    'object-6',
    'object-7',
    'object-8',
  ];
  other.mentions[0].chapterPath[0].id = 'survey';
  expect(
    validateContentAttachmentIdentifierRanges(f.plan, f.excerpts, f.response),
  ).toEqual([]);
  f.plan.registry = f.plan.registry.filter(
    (c) => !['object-9', 'other9'].includes(c.ref),
  );
  expect(
    validateContentAttachmentIdentifierRanges(f.plan, f.excerpts, f.response),
  ).toEqual([]);
});

test('preserves exclusions and identity-only uncertainties, ignores unsupported identifiers, and deduplicates repeated range findings', () => {
  const f = fixture();
  f.response.assignments = [];
  f.response.unresolved = [
    {
      excerptRef: 'E1',
      candidateRefs: ['object-6'],
      reason: 'Unknown investigation',
    },
  ];
  expect(
    validateContentAttachmentIdentifierRanges(f.plan, f.excerpts, f.response),
  ).toEqual([]);
  f.response.ignored = [{ excerptRef: 'E1', reason: 'Previous investigation' }];
  expect(
    validateContentAttachmentIdentifierRanges(f.plan, f.excerpts, f.response),
  ).toEqual([]);
  const invalid = fixture();
  for (const [i, c] of invalid.plan.registry.entries())
    c.mentions[0].sourceIdentifier = [null, '', 'x', '9007199254740992', '6-1'][
      i
    ];
  expect(
    validateContentAttachmentIdentifierRanges(
      invalid.plan,
      invalid.excerpts,
      invalid.response,
    ),
  ).toEqual([]);
  const empty = fixture();
  empty.plan.registry.forEach((c) => {
    c.recordKind = 'feature';
    c.mentions[0].sourceName = '';
  });
  expect(
    validateContentAttachmentIdentifierRanges(
      empty.plan,
      empty.excerpts,
      empty.response,
    ),
  ).toEqual([]);
  const repeated = fixture();
  repeated.excerpts[0].evidence.push(
    structuredClone(repeated.excerpts[0].evidence[0]),
  );
  expect(
    validateContentAttachmentIdentifierRanges(
      repeated.plan,
      repeated.excerpts,
      repeated.response,
    ),
  ).toHaveLength(1);
});

test('rejects missing named range members in current assembly while retaining exact v44 replay and original model decisions', () => {
  const { plan, response } = fixture();
  const doc: ProcessedDocument = {
    reportId: 'report',
    pageRangeMap: {},
    chapters: [],
    images: [],
    footnotes: [],
    tables: [
      {
        id: 'diary',
        pdfPageNo: 1,
        numRows: 1,
        numCols: 1,
        grid: [
          [{ text: 'TR6 ~ TR9', rowSpan: 1, colSpan: 1, isHeader: false }],
        ],
      },
    ],
  };
  // Original identifiers live elsewhere; the diary has no registration anchors.
  const index = buildDocumentResourceIndex(doc);
  plan.units = [
    {
      unitId: 'page-1',
      pdfPageNo: 1,
      chapters: [],
      readOnlyContext: [],
      tables: index.resources
        .filter((r) => r.kind === 'table')
        .map((r) => ({ key: r.key, data: r.data })),
      sources: index.resources
        .filter((r) => r.kind === 'tableCell')
        .map((resource) => ({ sourceId: 'source', resource })),
    },
  ];
  const unit = plan.units[0],
    compiled = createContentAttachmentBodyBlockInput(plan, unit);
  const rawResponse = {
    decisions: {
      E1: {
        status: 'assigned' as const,
        candidateRefs: [...response.assignments[0].candidateRefs],
        reason: 'Full named range',
        unresolved: null,
      },
    },
  };
  const audit: ContentAttachmentSelectionAudit = {
    unitId: unit.unitId,
    ...createContentAttachmentRequest(plan, unit),
    codeMap: compiled.codeMap,
    response,
    rawResponse,
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
  const before = structuredClone(audit);
  expect(audit.systemPrompt).toContain('INCLUSIVE EXPLICIT IDENTIFIER RANGES');
  expect(
    assembleContentAttachment(plan, [audit]).issues.map((i) => i.reason),
  ).toEqual([
    'Explicit identifier range must include object-9: E1 (TR6 ~ TR9)',
  ]);
  expect(assembleContentAttachment(plan, [audit]).completedUnitIds).toEqual([]);
  expect(audit).toEqual(before);
  const historical = {
    ...audit,
    ...createContentAttachmentRequest(plan, unit, 'content-attachment.v44'),
  };
  expect(audit.systemPrompt.startsWith(historical.systemPrompt)).toBe(true);
  expect(historical.systemPrompt).not.toContain(
    'INCLUSIVE EXPLICIT IDENTIFIER RANGES',
  );
  expect(historical.userPrompt).toBe(audit.userPrompt);
  expect(assembleContentAttachment(plan, [historical]).issues).toEqual([]);
  const v45 = {
    ...audit,
    ...createContentAttachmentRequest(plan, unit, 'content-attachment.v45'),
  };
  expect(audit.systemPrompt.startsWith(v45.systemPrompt)).toBe(true);
  expect(v45.userPrompt).toBe(audit.userPrompt);
  expect(assembleContentAttachment(plan, [v45])).toEqual(
    assembleContentAttachment(plan, [audit]),
  );
  expect(v45.systemPrompt).not.toContain('CURRENT CLAUSE PERIOD');
  const v46 = {
    ...audit,
    ...createContentAttachmentRequest(plan, unit, 'content-attachment.v46'),
  };
  expect(audit.systemPrompt.startsWith(v46.systemPrompt)).toBe(true);
  expect(v46.userPrompt).toBe(audit.userPrompt);
  expect(assembleContentAttachment(plan, [v46])).toEqual(
    assembleContentAttachment(plan, [audit]),
  );
  expect(v46.systemPrompt).not.toContain('ESTABLISHED FEATURE GROUPS REMAIN');
  const v47 = {
    ...audit,
    ...createContentAttachmentRequest(plan, unit, 'content-attachment.v47'),
  };
  expect(audit.systemPrompt.startsWith(v47.systemPrompt)).toBe(true);
  expect(v47.userPrompt).toBe(audit.userPrompt);
  expect(assembleContentAttachment(plan, [v47])).toEqual(
    assembleContentAttachment(plan, [audit]),
  );
  expect(v47.systemPrompt).not.toContain('SET-LEVEL EVIDENCE ATTACHMENT');
  const v48 = {
    ...audit,
    ...createContentAttachmentRequest(plan, unit, 'content-attachment.v48'),
  };
  expect(audit.systemPrompt.startsWith(v48.systemPrompt)).toBe(true);
  expect(v48.userPrompt).toBe(audit.userPrompt);
  expect(assembleContentAttachment(plan, [v48])).toEqual(
    assembleContentAttachment(plan, [audit]),
  );
  expect(v48.systemPrompt).not.toContain(
    'QUANTITIES REMAIN WITH THEIR ORIGINAL',
  );
  const v49 = {
    ...audit,
    ...createContentAttachmentRequest(plan, unit, 'content-attachment.v49'),
  };
  expect(audit.systemPrompt.startsWith(v49.systemPrompt)).toBe(true);
  expect(v49.userPrompt).toBe(audit.userPrompt);
  expect(assembleContentAttachment(plan, [v49])).toEqual(
    assembleContentAttachment(plan, [audit]),
  );
  expect(v49.systemPrompt).not.toContain('CONFIRMED SET MEMBERSHIP SUPPORTS');
  const v50 = {
    ...audit,
    ...createContentAttachmentRequest(plan, unit, 'content-attachment.v50'),
  };
  expect(audit.systemPrompt.startsWith(v50.systemPrompt)).toBe(true);
  expect(v50.userPrompt).toBe(audit.userPrompt);
  expect(assembleContentAttachment(plan, [v50])).toEqual(
    assembleContentAttachment(plan, [audit]),
  );
  expect(v50.systemPrompt).not.toContain(
    'NO STATED RESTRICTION IS NOT POSITIVE',
  );
  const v51 = {
    ...audit,
    ...createContentAttachmentRequest(plan, unit, 'content-attachment.v51'),
  };
  expect(audit.systemPrompt.startsWith(v51.systemPrompt)).toBe(true);
  expect(v51.userPrompt).toBe(audit.userPrompt);
  expect(assembleContentAttachment(plan, [v51])).toEqual(
    assembleContentAttachment(plan, [audit]),
  );
  expect(v51.systemPrompt).not.toContain(
    'DO NOT REQUIRE INDIVIDUAL REIDENTIFICATION',
  );
  const v52 = {
    ...audit,
    ...createContentAttachmentRequest(plan, unit, 'content-attachment.v52'),
  };
  expect(audit.systemPrompt.startsWith(v52.systemPrompt)).toBe(true);
  expect(v52.systemPrompt).not.toContain(
    'CROSS-CHECK EACH EXPLICITLY LISTED IDENTIFIER',
  );
  expect(assembleContentAttachment(plan, [v52])).toEqual(
    assembleContentAttachment(plan, [audit]),
  );
  const forged = structuredClone(historical);
  forged.response.assignments[0].reason = 'Changed';
  expect(assembleContentAttachment(plan, [forged]).issues[0].reason).toContain(
    'inconsistent projection',
  );

  const singletonPlan = structuredClone(plan),
    singletonUnit = singletonPlan.units[0];
  singletonUnit.sources[0].resource.data.text = 'TR6 ~ TR9, TR12';
  singletonUnit.tables[0].data.grid[0][0].text = 'TR6 ~ TR9, TR12';
  const singletonRefs = ['object-6', 'object-7', 'object-8', 'object-9'];
  const singletonAudit = {
    ...audit,
    ...createContentAttachmentRequest(singletonPlan, singletonUnit),
    codeMap: createContentAttachmentBodyBlockInput(singletonPlan, singletonUnit)
      .codeMap,
    rawResponse: {
      decisions: {
        E1: {
          status: 'assigned' as const,
          candidateRefs: singletonRefs,
          reason: 'Original named members',
          unresolved: null,
        },
      },
    },
    response: {
      assignments: [
        {
          excerptRef: 'E1',
          candidateRefs: singletonRefs,
          reason: 'Original named members',
        },
      ],
      unresolved: [],
      ignored: [],
    },
  };
  const untouched = structuredClone(singletonAudit);
  expect(
    assembleContentAttachment(singletonPlan, [singletonAudit]).issues.map(
      (i) => i.reason,
    ),
  ).toEqual(['Explicit identifier must include object-12: E1 (TR12)']);
  expect(
    assembleContentAttachment(singletonPlan, [singletonAudit]).completedUnitIds,
  ).toEqual([]);
  expect(singletonAudit).toEqual(untouched);
  const oldSingletonAudit = {
    ...singletonAudit,
    ...createContentAttachmentRequest(
      singletonPlan,
      singletonUnit,
      'content-attachment.v52',
    ),
  };
  expect(
    assembleContentAttachment(singletonPlan, [oldSingletonAudit]).issues,
  ).toEqual([]);
});

test('checks individually named list members against original numbers rather than opaque refs', () => {
  const f = fixture('TR6 ~ TR9, TR12 excavation');
  const refs = ['entry-z', 'entry-a', 'entry-y', 'entry-b', 'entry-x'];
  for (const [i, candidate] of f.plan.registry.entries())
    candidate.ref = refs[i];
  f.response.assignments[0].candidateRefs = refs.slice(0, 4);
  const before = structuredClone(f);
  expect(
    validateContentAttachmentIdentifierRanges(f.plan, f.excerpts, f.response),
  ).toEqual([]);
  expect(
    validateContentAttachmentIdentifierRanges(
      f.plan,
      f.excerpts,
      f.response,
      true,
    ),
  ).toEqual(['Explicit identifier must include entry-x: E1 (TR12)']);
  expect(f).toEqual(before);
  f.response.assignments[0].candidateRefs.push('entry-x');
  expect(
    validateContentAttachmentIdentifierRanges(
      f.plan,
      f.excerpts,
      f.response,
      true,
    ),
  ).toEqual([]);
  f.excerpts[0].evidence[0].quote = 'TR6, Trench 9, 트렌치 12';
  f.response.assignments[0].candidateRefs = ['entry-z'];
  expect(
    validateContentAttachmentIdentifierRanges(
      f.plan,
      f.excerpts,
      f.response,
      true,
    ),
  ).toEqual([
    'Explicit identifier must include entry-b: E1 (Trench 9)',
    'Explicit identifier must include entry-x: E1 (트렌치 12)',
  ]);
});

test('keeps named singleton checks bounded by original scope and unique identity', () => {
  const f = fixture('TR6, TR12');
  f.response.assignments[0].candidateRefs = ['object-6'];
  const other = structuredClone(f.plan.registry[4]);
  other.ref = 'other12';
  other.mentions[0].chapterPath[0].id = 'other';
  f.plan.registry.push(other);
  expect(
    validateContentAttachmentIdentifierRanges(
      f.plan,
      f.excerpts,
      f.response,
      true,
    ),
  ).toEqual(['Explicit identifier must include object-12: E1 (TR12)']);
  f.response.assignments[0].candidateRefs.push('other12');
  expect(
    validateContentAttachmentIdentifierRanges(
      f.plan,
      f.excerpts,
      f.response,
      true,
    ),
  ).toEqual([]);
  f.response.assignments[0].candidateRefs = ['object-6'];
  other.mentions[0].chapterPath[0].id = 'survey';
  expect(
    validateContentAttachmentIdentifierRanges(
      f.plan,
      f.excerpts,
      f.response,
      true,
    ),
  ).toEqual([]);
  f.excerpts[0].evidence[0].quote = 'TR12';
  expect(
    validateContentAttachmentIdentifierRanges(
      f.plan,
      f.excerpts,
      f.response,
      true,
    ),
  ).toEqual([]);
  f.response.assignments = [];
  expect(
    validateContentAttachmentIdentifierRanges(
      f.plan,
      f.excerpts,
      f.response,
      true,
    ),
  ).toEqual([]);
  const different = fixture('Pit 6, Trench 12');
  different.plan.registry[0].recordKind = 'feature';
  different.plan.registry[0].mentions[0].sourceName = 'Pit';
  different.response.assignments[0].candidateRefs = ['object-6'];
  expect(
    validateContentAttachmentIdentifierRanges(
      different.plan,
      different.excerpts,
      different.response,
      true,
    ),
  ).toEqual([]);
});

test('does not reinterpret malformed ranges, measurements or unlabeled numbers as singleton lists', () => {
  for (const text of [
    'TR6~9cm',
    'TR6~9007199254740992',
    'TR9~6',
    'XTR6, 12',
    'TR6.2, 12',
    '6, 12 cm',
    '2020, 2024',
    'TR6 ~ Pit9',
    'TR9007199254740992',
  ]) {
    const f = fixture(text);
    f.response.assignments[0].candidateRefs = ['object-6'];
    expect(
      validateContentAttachmentIdentifierRanges(
        f.plan,
        f.excerpts,
        f.response,
        true,
      ),
    ).toEqual([]);
  }
});
