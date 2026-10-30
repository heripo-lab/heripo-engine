import type { ProcessedDocument } from '@heripo/model';

import type { DocumentResource } from '../../resources/document-resource-index';
import type {
  AttachmentRegistryEntry,
  AttachmentUnit,
  ContentAttachmentPlan,
} from '../types';

import { describe, expect, test } from 'vitest';

import { buildDocumentResourceIndex } from '../../resources/document-resource-index';
import { createContentAttachmentThinInput } from './compile';
import { inspectContentAttachmentThinResponse } from './inspection';
import { createContentAttachmentThinRequest } from './prompt';

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
        id: 'survey',
        title: '시굴',
        originTitle: '시굴',
        level: 1,
        pageNo: 1,
        imageIds: [],
        footnoteIds: [],
        tableIds: ['log', 'blank'],
        textBlocks: [
          {
            id: 'b0',
            pdfPageNo: 1,
            text: '  수혈 1호와 수혈 2호를 조사하였다.',
          },
          { id: 'b1', pdfPageNo: 1, text: '앞선 문단' },
        ],
      },
    ],
    tables: [
      {
        id: 'log',
        pdfPageNo: 1,
        numRows: 1,
        numCols: 1,
        caption: { fullText: '표 1 일지' },
        grid: [[cell('흐림')]],
      },
      {
        id: 'blank',
        pdfPageNo: 1,
        numRows: 1,
        numCols: 1,
        grid: [[cell('')]],
      },
    ],
  };
  const index = buildDocumentResourceIndex(document);
  const sources = index.resources
    .filter(
      (r): r is Extract<DocumentResource, { kind: 'text' | 'tableCell' }> =>
        (r.kind === 'text' && r.key === '/chapters/0/textBlocks/0') ||
        r.kind === 'tableCell',
    )
    .map((resource) => ({ sourceId: `source:${resource.key}`, resource }));
  const path = [{ id: 'survey', originTitle: '시굴' }];
  const entry = (
    ref: string,
    recordKind: AttachmentRegistryEntry['recordKind'],
    sourceName: string,
    sourceIdentifier: string | null,
  ): AttachmentRegistryEntry => ({
    ref,
    groupId: `g-${ref}`,
    recordKind,
    mentions: [
      {
        candidateId: `c-${ref}`,
        sourceName,
        sourceIdentifier,
        chapterPath: path,
        evidence: [
          {
            sourceId: sources[0].sourceId,
            resourceKey: sources[0].resource.key,
            resourceId: null,
            sourceRefs: [],
            pdfPageNo: 1,
            logicalPageRange: null,
            quote: '수혈',
            charStart: 2,
            charEnd: 4,
          },
        ],
      },
    ],
  });
  const unit: AttachmentUnit = {
    unitId: 'page-1',
    pdfPageNo: 1,
    sources,
    chapters: [{ chapterId: 'survey', path }],
    tables: index.resources
      .filter(
        (r): r is Extract<DocumentResource, { kind: 'table' }> =>
          r.kind === 'table',
      )
      .map((r) => ({ key: r.key, data: r.data })),
    readOnlyContext: [
      { resourceKey: '/chapters/0/textBlocks/1', text: '앞선 문단' },
    ],
  };
  const plan: ContentAttachmentPlan = {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: 'input',
    candidateSnapshotId: 'snapshot',
    registrySha256: 'registry',
    registryUncertainties: [],
    registry: [
      entry('R1', 'area', '사업범위', null),
      entry('R2', 'feature', '수혈', '2호'),
      entry('R3', 'feature', '수혈', '1호'),
    ],
    pages: [{ pdfPageNo: 1, unitIds: ['page-1'], status: 'planned' }],
    units: [unit],
  };
  // object-format (v8) request; the array format (v10) has its own tests below
  const request = createContentAttachmentThinRequest(
    createContentAttachmentThinInput(plan, unit),
    { format: 'object' },
  );
  return { plan, unit, request };
}

const attach = (fields: Record<string, unknown> = {}) => ({
  k: 'a',
  r: [],
  h: [],
  x: [],
  ia: [],
  sa: [],
  e: [],
  ...fields,
});
const inspect = (rawResponse: unknown) => {
  const { plan, unit, request } = fixture();
  return inspectContentAttachmentThinResponse(plan, unit, {
    request,
    rawResponse,
  });
};

describe('inspectContentAttachmentThinResponse', () => {
  test('compiles the expected segments, windows and handles for the fixture', () => {
    const { request } = fixture();

    expect(
      (
        request.providerOutputSchema as {
          properties: { d: { required: string[] } };
        }
      ).properties.d.required,
    ).toEqual(['E1:S1', 'E2:S1']);
    expect(JSON.parse(request.userPrompt).readOnlyContext).toEqual([
      { ref: 'X1', windows: [['Q3', ['앞선', '문단']]] },
      { ref: 'X2', windows: [['Q4', ['표', '1', '일지']]] },
    ]);
  });

  test('rejects a request that differs from the recompiled request', () => {
    const { plan, unit, request } = fixture();

    const result = inspectContentAttachmentThinResponse(plan, unit, {
      request: { ...request, systemPrompt: `${request.systemPrompt} ` },
      rawResponse: { d: {} },
    });

    expect(result).toEqual({
      issues: ['request differs from the recompiled request'],
      findings: [],
      decisions: [],
    });
  });

  test('rejects a response without a decision object', () => {
    expect(inspect(null).issues).toEqual(['response has no decision object d']);
    expect(inspect({ d: [] }).issues).toEqual([
      'response has no decision object d',
    ]);
  });

  test('resolves handles, exclusions and evidence spans from body, read-only and caption sources', () => {
    const raw = {
      d: {
        'E1:S1': attach({
          r: ['R1'],
          h: ['H2'],
          x: ['R2'],
          ia: [['R2', 'R3']],
          e: ['Q1:L1-L2', 'Q3:L2-L2', 'Q4:L1-L3'],
        }),
        'E2:S1': { k: 'n' },
      },
    };
    const before = JSON.stringify(raw);

    const result = inspect(raw);

    expect(JSON.stringify(raw)).toBe(before);
    expect(result.issues).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.decisions).toEqual([
      {
        segment: 'E1:S1',
        kind: 'attach',
        recipients: ['R1', 'R3'],
        handles: ['H2'],
        excluded: ['R2'],
        recipientIdentityAlternatives: [['R2', 'R3']],
        relationshipSubjectAlternatives: [],
        evidence: [
          {
            range: 'Q1:L1-L2',
            sourceRef: 'E1',
            resourceKey: '/chapters/0/textBlocks/0',
            field: 'text',
            originalWords: ['W1', 'W2'],
            charStart: 2,
            charEnd: 8,
          },
          {
            range: 'Q3:L2-L2',
            sourceRef: 'X1',
            resourceKey: '/chapters/0/textBlocks/1',
            field: 'text',
            originalWords: ['W2'],
            charStart: 3,
            charEnd: 5,
          },
          {
            range: 'Q4:L1-L3',
            sourceRef: 'X2',
            resourceKey: '/tables/0',
            field: 'caption',
            originalWords: ['W1', 'W2', 'W3'],
            charStart: 0,
            charEnd: 6,
          },
        ],
      },
      {
        segment: 'E2:S1',
        kind: 'none',
        recipients: [],
        handles: [],
        excluded: [],
        recipientIdentityAlternatives: [],
        relationshipSubjectAlternatives: [],
        evidence: [],
      },
    ]);
  });

  test('reports structural problems per segment and keeps the valid segments', () => {
    const result = inspect({
      d: {
        'E1:S1': attach({
          r: ['R9'],
          ia: [['R8']],
          sa: [['R7']],
          h: ['H9'],
          x: ['R2'],
          e: ['bad', 'Q9:L1-L1', 'Q1:L0-L1', 'Q1:L3-L2', 'Q1:L1-L9'],
        }),
        'E2:S1': { k: 'n' },
        'E3:S1': { k: 'n' },
      },
    });

    expect(result.issues).toEqual([
      'E3:S1: unexpected segment',
      'E1:S1: unknown candidate R9',
      'E1:S1: unknown candidate R8',
      'E1:S1: unknown candidate R7',
      'E1:S1: unknown handle H9',
      'E1:S1: exclusion R2 is not a member of a returned handle',
      'E1:S1: invalid range bad',
      'E1:S1: invalid range Q9:L1-L1',
      'E1:S1: invalid range Q1:L0-L1',
      'E1:S1: invalid range Q1:L3-L2',
      'E1:S1: invalid range Q1:L1-L9',
    ]);
    expect(result.decisions.map((d) => d.segment)).toEqual(['E2:S1']);
  });

  test.each([
    ['missing decision', { 'E2:S1': { k: 'n' } }, 'E1:S1: missing decision'],
    [
      'extra none field',
      { 'E1:S1': { k: 'n', r: [] }, 'E2:S1': { k: 'n' } },
      'E1:S1: none decision has extra fields',
    ],
    [
      'unknown kind',
      { 'E1:S1': attach({ k: 'b' }), 'E2:S1': { k: 'n' } },
      'E1:S1: malformed decision',
    ],
    [
      'extra field',
      { 'E1:S1': attach({ z: [] }), 'E2:S1': { k: 'n' } },
      'E1:S1: malformed decision',
    ],
    [
      'missing field',
      {
        'E1:S1': { k: 'a', r: [], h: [], x: [], ia: [], sa: [], z: [] },
        'E2:S1': { k: 'n' },
      },
      'E1:S1: malformed decision',
    ],
    [
      'ref list type',
      { 'E1:S1': attach({ r: 'R1' }), 'E2:S1': { k: 'n' } },
      'E1:S1: malformed decision',
    ],
    [
      'handle list type',
      { 'E1:S1': attach({ h: [1] }), 'E2:S1': { k: 'n' } },
      'E1:S1: malformed decision',
    ],
    [
      'exclusion list type',
      { 'E1:S1': attach({ x: null }), 'E2:S1': { k: 'n' } },
      'E1:S1: malformed decision',
    ],
    [
      'identity groups type',
      { 'E1:S1': attach({ ia: ['R1'] }), 'E2:S1': { k: 'n' } },
      'E1:S1: malformed decision',
    ],
    [
      'subject groups type',
      { 'E1:S1': attach({ sa: [[1]] }), 'E2:S1': { k: 'n' } },
      'E1:S1: malformed decision',
    ],
    [
      'evidence type',
      { 'E1:S1': attach({ e: [1] }), 'E2:S1': { k: 'n' } },
      'E1:S1: malformed decision',
    ],
  ])('rejects a %s', (_, d, issue) => {
    const result = inspect({ d });

    expect(result.issues).toEqual([issue]);
    expect(result.decisions.map((x) => x.segment)).toEqual(['E2:S1']);
  });

  test('notes attachments without targets, repeated ranges and overlapping evidence', () => {
    const result = inspect({
      d: {
        'E1:S1': attach({
          e: ['Q1:L1-L2', 'Q1:L1-L2', 'Q1:L2-L3', 'Q1:L4-L4', 'Q3:L1-L1'],
        }),
        'E2:S1': attach({ sa: [['R2', 'R3']] }),
      },
    });

    expect(result.issues).toEqual([]);
    expect(result.findings).toEqual([
      'E1:S1: attachment decision without targets',
      'E1:S1: repeated evidence range',
      'E1:S1: overlapping evidence Q1:L1-L2 Q1:L2-L3',
    ]);
    expect(result.decisions[1].relationshipSubjectAlternatives).toEqual([
      ['R2', 'R3'],
    ]);
  });
});

describe('inspectContentAttachmentThinResponse with the array format', () => {
  const arrayAudit = (
    rawResponse: unknown,
    version?: 'content-attachment-thin.v10' | 'content-attachment-thin.v12',
  ) => {
    const { plan, unit } = fixture();
    const request = createContentAttachmentThinRequest(
      createContentAttachmentThinInput(plan, unit),
      version ? { version } : {},
    );
    return {
      inspection: inspectContentAttachmentThinResponse(plan, unit, {
        request,
        rawResponse,
      }),
      request,
    };
  };

  test('reads one item per segment like the object format and replays the saved request version', () => {
    const decisions = { 'E1:S1': attach({ r: ['R3'] }), 'E2:S1': { k: 'n' } };
    const object = inspect({ d: decisions });

    const { inspection, request } = arrayAudit({
      d: [
        { s: 'E2:S1', k: 'n' },
        { s: 'E1:S1', ...attach({ r: ['R3'] }) },
      ],
    });

    const v10 = arrayAudit(
      {
        d: [
          { s: 'E1:S1', ...attach({ r: ['R3'] }) },
          { s: 'E2:S1', k: 'n' },
        ],
      },
      'content-attachment-thin.v10',
    );

    const v12 = arrayAudit(
      {
        d: [
          { s: 'E1:S1', ...attach({ r: ['R3'] }) },
          { s: 'E2:S1', k: 'n' },
        ],
      },
      'content-attachment-thin.v12',
    );

    expect(v12.request.version).toBe('content-attachment-thin.v12');
    expect(v12.inspection.issues).toEqual([]);
    expect(request.version).toBe('content-attachment-thin.v13');
    expect(v10.request.version).toBe('content-attachment-thin.v10');
    expect(v10.inspection.issues).toEqual([]);
    expect(inspection.issues).toEqual([]);
    expect(
      [...inspection.decisions].sort((a, b) =>
        a.segment.localeCompare(b.segment),
      ),
    ).toEqual(object.decisions);
  });

  test('reports a missing array, items without a segment, repeated and unknown segments', () => {
    expect(arrayAudit({ d: {} }).inspection.issues).toEqual([
      'response has no decision array d',
    ]);

    const { inspection } = arrayAudit({
      d: [
        { k: 'n' },
        'E1:S1',
        { s: 'E1:S1', k: 'n' },
        { s: 'E1:S1', ...attach({ r: ['R3'] }) },
        { s: 'E9:S1', k: 'n' },
      ],
    });

    expect(inspection.issues).toEqual([
      'malformed decision item',
      'malformed decision item',
      'E1:S1: repeated segment',
      'E9:S1: unexpected segment',
      'E2:S1: missing decision',
    ]);
    expect(inspection.decisions).toEqual([]);
  });
});
