import type { ProcessedDocument } from '@heripo/model';

import type {
  ContentAttachmentPlan,
  ContentAttachmentSelectionAudit,
} from '../content-attachment';

import { expect, test } from 'vitest';

import { buildDocumentResourceIndex } from '../../resources/document-resource-index';
import { createContentAttachmentBodyBlockInput } from '../body-blocks';
import {
  assembleContentAttachment,
  createContentAttachmentRequest,
} from '../content-attachment';
import { originalIdentifierCellOwners } from './owners';
import { validateContentAttachmentTables } from './validation';

function fixture(): ContentAttachmentPlan {
  const cell = (text: string, isHeader = false) => ({
    text,
    isHeader,
    rowSpan: 1,
    colSpan: 1,
  });
  const doc: ProcessedDocument = {
    reportId: 'report',
    pageRangeMap: {},
    chapters: [],
    images: [],
    footnotes: [],
    tables: [
      {
        id: 'inventory',
        pdfPageNo: 1,
        numRows: 3,
        numCols: 4,
        caption: { fullText: 'Trench inventory' },
        grid: [
          [
            cell('Number', true),
            cell('Length', true),
            cell('Depth', true),
            cell('Features', true),
          ],
          [cell('1'), cell('18'), cell('2'), cell('Road')],
          [cell('2'), cell('15.2'), cell('1'), cell('Pit')],
        ],
      },
    ],
  };
  const index = buildDocumentResourceIndex(doc);
  const sources = index.resources
    .filter((r) => r.kind === 'tableCell')
    .map((resource) => ({ sourceId: `source:${resource.key}`, resource }));
  const evidence = (row: number, column: number) => {
    const source = sources.find(
      (s) => s.resource.key === `/tables/0/grid/${row}/${column}`,
    )!;
    return [
      {
        sourceId: source.sourceId,
        resourceKey: source.resource.key,
        resourceId: null,
        sourceRefs: [],
        pdfPageNo: 1,
        logicalPageRange: null,
        quote: source.resource.data.text,
        charStart: 0,
        charEnd: source.resource.data.text.length,
      },
    ];
  };
  return {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: 'input',
    candidateSnapshotId: 'snapshot',
    registrySha256: 'registry',
    registryUncertainties: [],
    registry: [
      {
        ref: 'R1',
        groupId: 'g1',
        recordKind: 'trench',
        mentions: [
          {
            candidateId: 'c1',
            sourceName: 'Trench',
            sourceIdentifier: '1',
            chapterPath: [],
            evidence: evidence(1, 0),
          },
        ],
      },
      {
        ref: 'R2',
        groupId: 'g2',
        recordKind: 'trench',
        mentions: [
          {
            candidateId: 'c2',
            sourceName: 'Trench',
            sourceIdentifier: '2',
            chapterPath: [],
            evidence: evidence(2, 0),
          },
        ],
      },
      {
        ref: 'R3',
        groupId: 'g3',
        recordKind: 'feature',
        mentions: [
          {
            candidateId: 'c3',
            sourceName: 'Pit',
            sourceIdentifier: null,
            chapterPath: [],
            evidence: evidence(2, 3),
          },
        ],
      },
    ],
    pages: [{ pdfPageNo: 1, unitIds: ['page-1'], status: 'planned' }],
    units: [
      {
        unitId: 'page-1',
        pdfPageNo: 1,
        sources,
        chapters: [],
        readOnlyContext: [],
        tables: index.resources
          .filter((r) => r.kind === 'table')
          .map((r) => ({ key: r.key, data: r.data })),
      },
    ],
  };
}

test('requires the original trench owner alongside an inventory feature despite another trench number appearing as depth, and preserves historical audits', () => {
  const plan = fixture(),
    unit = plan.units[0];
  const compiled = createContentAttachmentBodyBlockInput(plan, unit);
  const raw: ContentAttachmentSelectionAudit = {
    unitId: unit.unitId,
    ...createContentAttachmentRequest(plan, unit, 'content-attachment.v41'),
    codeMap: compiled.codeMap,
    response: {
      assignments: compiled.codeMap.excerpts.slice(4).map((e) => ({
        excerptRef: e.ref,
        candidateRefs: [
          Number(e.ref.slice(1)) < 9 ? 'R1' : e.ref === 'E12' ? 'R3' : 'R2',
        ],
        reason: 'Original inventory cell',
      })),
      unresolved: [],
      ignored: compiled.codeMap.excerpts
        .slice(0, 4)
        .map((e) => ({ excerptRef: e.ref, reason: 'Header' })),
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
  const before = structuredClone([plan, raw]);
  expect(raw.systemPrompt).toContain('TRENCH INVENTORY CELLS DESCRIBE BOTH');
  const previous = createContentAttachmentRequest(
    plan,
    unit,
    'content-attachment.v34',
  );
  expect(raw.systemPrompt.startsWith(previous.systemPrompt)).toBe(true);
  expect(raw.userPrompt).toBe(previous.userPrompt);
  expect(
    assembleContentAttachment(plan, [{ ...raw, ...previous }]).issues,
  ).toEqual([]);
  const result = assembleContentAttachment(plan, [raw]);
  expect(result.issues.map((i) => i.reason)).toEqual([
    'Identified table-row cell must include R2: E12',
  ]);
  expect(result.completedUnitIds).toEqual([]);
  expect([plan, raw]).toEqual(before);
  const valid = structuredClone(raw);
  valid.response.assignments.at(-1)!.candidateRefs = ['R2', 'R3'];
  expect(assembleContentAttachment(plan, [valid]).issues).toEqual([]);
  expect(assembleContentAttachment(plan, [valid]).completedUnitIds).toEqual([
    'page-1',
  ]);
  const header = structuredClone(valid);
  header.response.ignored.shift();
  header.response.assignments.push({
    excerptRef: 'E1',
    candidateRefs: ['R1'],
    reason: 'Wrong header assignment',
  });
  expect(
    assembleContentAttachment(plan, [header]).issues.map((i) => i.reason),
  ).toEqual(['Generic table header must be ignored: E1']);
});

test('uses exact source identifier ranges and segment boundaries, preserving ambiguity rather than caption or numeric guesses', () => {
  const plan = fixture(),
    table = plan.units[0].tables[0];
  const owners = () => originalIdentifierCellOwners(plan, table);
  expect(owners()).toEqual([
    [null, null, null, null],
    ['R1', 'R1', 'R1', 'R1'],
    ['R2', 'R2', 'R2', 'R2'],
  ]);
  const second = plan.registry[1].mentions[0];
  second.evidence[0].resourceKey = '/different-table/grid/2/0';
  expect(owners()[2]).toEqual([null, null, null, null]);
  second.evidence[0].resourceKey = '/tables/0/grid/2/0';
  for (const change of [
    () => {
      second.evidence[0].quote = 'wrong';
    },
    () => {
      second.evidence[0].charStart = 1;
    },
    () => {
      second.evidence[0].charEnd = 0;
    },
    () => {
      second.sourceIdentifier = '';
    },
    () => {
      second.sourceIdentifier = ' 2 ';
    },
  ]) {
    const saved = structuredClone(second);
    change();
    expect(owners()[2]).toEqual([null, null, null, null]);
    Object.assign(second, saved);
  }
  const right = structuredClone(plan.registry[0]);
  right.ref = 'R4';
  right.groupId = 'g4';
  right.mentions[0].candidateId = 'c4';
  right.mentions[0].sourceIdentifier = '2';
  right.mentions[0].evidence[0].resourceKey = '/tables/0/grid/1/2';
  right.mentions[0].evidence[0].sourceId = 'source:/tables/0/grid/1/2';
  right.mentions[0].evidence[0].quote = '2';
  plan.registry.push(right);
  expect(owners()[1]).toEqual(['R1', 'R1', 'R4', 'R4']);
  const duplicate = structuredClone(right);
  duplicate.ref = 'R5';
  plan.registry.push(duplicate);
  expect(owners()[1]).toEqual(['R1', 'R1', null, null]);
  const compiled = createContentAttachmentBodyBlockInput(plan, plan.units[0]);
  expect(
    validateContentAttachmentTables(
      plan,
      plan.units[0],
      [],
      { assignments: [], ignored: [], unresolved: [] },
      true,
    ),
  ).toEqual([]);
  expect(
    validateContentAttachmentTables(
      plan,
      plan.units[0],
      compiled.codeMap.excerpts,
      {
        assignments: [],
        ignored: compiled.codeMap.excerpts.map((e) => ({
          excerptRef: e.ref,
          reason: 'Unchanged',
        })),
        unresolved: [],
      },
      true,
    ),
  ).toEqual([
    'Identified table-row cell must include R1: E5',
    'Identified table-row cell must include R1: E6',
    'Identified table-row cell must include R2: E9',
    'Identified table-row cell must include R2: E10',
    'Identified table-row cell must include R2: E11',
    'Identified table-row cell must include R2: E12',
  ]);
});
