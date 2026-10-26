import type { ProcessedDocument } from '@heripo/model';

import type { ContentAttachmentThinResult } from '../content-attachment/thin/assembly';
import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { ArchaeologyLedgerResult } from './archaeology-ledger';

import { describe, expect, test } from 'vitest';

import {
  LEDGER_VALIDATION_VERSION,
  applyLedgerValidation,
  validateArchaeologyLedger,
} from './ledger-validation';

const document = {
  reportId: 'report-1',
  pageRangeMap: {},
  chapters: [
    {
      id: 'ch-1',
      originTitle: '1) 수혈',
      title: '1) 수혈',
      pageNo: 1,
      level: 1,
      textBlocks: [
        {
          id: 'txt-1',
          sourceRef: '#/texts/1',
          text: '1호 수혈은 원형이다. 길이 3m이다.',
          pdfPageNo: 1,
        },
        { id: 'txt-2', text: '2호 수혈  원형', pdfPageNo: 1 },
      ],
      imageIds: [],
      tableIds: [],
      footnoteIds: [],
    },
  ],
  images: [{ id: 'img-1', pdfPageNo: 1, path: 'a.png' }],
  tables: [
    {
      id: 'tbl-1',
      sourceRef: '#/tables/0',
      caption: { fullText: '표 1 수혈 속성' },
      pdfPageNo: 2,
      numRows: 2,
      numCols: 2,
      grid: [
        [
          { text: '번호', rowSpan: 1, colSpan: 1, isHeader: true },
          { text: '길이(cm)', rowSpan: 1, colSpan: 1, isHeader: true },
        ],
        [
          { text: '1', rowSpan: 1, colSpan: 1, isHeader: false },
          { text: '40', rowSpan: 1, colSpan: 1, isHeader: false },
        ],
      ],
    },
    {
      id: 'tbl-2',
      pdfPageNo: 3,
      numRows: 1,
      numCols: 1,
      grid: [[{ text: 'a', rowSpan: 1, colSpan: 1, isHeader: false }]],
    },
  ],
  footnotes: [],
} as unknown as ProcessedDocument;
const mention = (sourceName: string, title: string, quote: string) => ({
  sourceName,
  sourceIdentifier: null,
  chapterPath: [{ id: 'ch-1', originTitle: title }],
  evidence: [{ quote }],
});
const plan = {
  registry: [
    { groupId: 'A', mentions: [mention('수혈', '1) 수혈', '1호 수혈')] },
    { groupId: 'B', mentions: [mention('수혈', '표', '1')] },
    { groupId: 'C', mentions: [mention('토기', '기타', '2호')] },
  ],
  units: [{ unitId: 'u1' }, { unitId: 'u2' }],
} as unknown as ContentAttachmentPlan;
const attachments = {
  units: [{ unitId: 'u1' }],
  missingUnitIds: [],
} as unknown as ContentAttachmentThinResult;

const source = (
  id: string,
  recordId: string,
  locator: string,
  excerpt: string,
  extra: Record<string, unknown> = {},
) => {
  const [, span] = locator.split('#');
  const [charStart, charEnd] = span.split('-').map(Number);
  return {
    id,
    recordId: `record-${recordId}`,
    locator,
    charStart,
    charEnd,
    excerpt,
    pdfPageNo: 1,
    basis: 'registration',
    ...extra,
  };
};
const record = (
  id: string,
  sourceName: string,
  extra: Record<string, unknown> = {},
) => ({
  id: `record-${id}`,
  ledgerId: 'ledger-1',
  recordKind: 'feature',
  sourceName,
  content: [],
  ordinal: 0,
  needsReview: false,
  reviewStatus: 'not_reviewed',
  ...extra,
});
const excerpt = (id: string, text: string, sourceIds: string[]) => ({
  id,
  text,
  sourceIds,
});
const attribute = (
  id: string,
  recordId: string,
  keyText: string,
  valueText: string,
  metadata: Record<string, unknown>,
  unitText?: string,
) => ({
  id,
  recordId: `record-${recordId}`,
  keyText,
  valueText,
  ...(unitText ? { unitText } : {}),
  sourceText: valueText,
  extractionMethod: 'rule',
  metadata: { pdfPageNo: 1, ...metadata },
});
const link = (
  id: string,
  from: string,
  to: string,
  evidence: Array<Record<string, unknown>>,
) => ({
  id,
  ledgerId: 'ledger-1',
  fromRecordId: `record-${from}`,
  toRecordId: `record-${to}`,
  relationLabel: '중복',
  evidence,
  needsReview: false,
});

const cleanLedger = (sourceName = '수혈') =>
  ({
    ledger: { id: 'ledger-1' },
    records: [
      record('B', sourceName, {
        sourceIdentifier: '1',
        content: [excerpt('e7', '1', ['s3'])],
      }),
    ],
    sources: [
      source('s3', 'B', '/tables/0/grid/1/0#0-1', '1', {
        tableId: 'tbl-1',
        tableCell: { rowIndex: 1, columnIndex: 0 },
        sourceRef: '#/tables/0',
      }),
    ],
    attributes: [
      attribute(
        'a1',
        'B',
        '길이(cm)',
        '40',
        { cellKey: '/tables/0/grid/1/1' },
        'cm',
      ),
    ],
    mediaReferences: [],
    links: [],
    pending: [],
    reviewItems: [],
    issues: [],
  }) as unknown as ArchaeologyLedgerResult;

const brokenLedger = () => {
  const clean = cleanLedger();
  return {
    ...clean,
    records: [
      record('A', '수혈', {
        sourceIdentifier: '1호',
        parentRecordId: 'record-B',
        parentBasis: 'code',
        parentEvidence: [{ kind: 'phrase', text: '1호 수혈' }],
        content: [
          excerpt('e1', '1호 수혈은 원형이다.', ['s1']),
          excerpt('e2', '1호 수혈은  원형이다.', ['s1']),
          excerpt('e3', 'x', []),
          excerpt('e4', '2호', ['s5']),
          excerpt('e5', 'y', ['s-missing']),
          excerpt('e6', '다른 문장', ['s1']),
        ],
      }),
      { ...clean.records[0], parentRecordId: 'record-C' },
      record('C', '토기', {
        sourceIdentifier: '9',
        parentRecordId: 'record-B',
        parentBasis: 'judgment',
        parentEvidence: [{ kind: 'excerpt', text: '2호' }],
      }),
      record('D', '우물', {
        ledgerId: 'ledger-other',
        parentRecordId: 'record-D',
        parentBasis: 'code',
        parentEvidence: [{ kind: 'phrase', text: '우물' }],
      }),
      record('E', '2호', { parentRecordId: 'record-A' }),
    ],
    sources: [
      source(
        's1',
        'A',
        '/chapters/0/textBlocks/0#0-12',
        '1호 수혈은 원형이다.',
        {
          sourceRef: '#/texts/1',
        },
      ),
      source('s2', 'A', '/chapters/0/textBlocks/0#13-20', 'XX', {
        basis: 'model_unanimous',
        sourceRef: '#/wrong',
      }),
      ...clean.sources,
      source('s4', 'B', '/tables/0/grid/5/0#0-1', '1', {
        tableId: 'tbl-x',
        tableCell: { rowIndex: 5, columnIndex: 0 },
      }),
      source('s5', 'C', '/chapters/0/textBlocks/1#0-2', '2호'),
      source('s6', 'E', '/chapters/0/textBlocks/1#0-2', '2호'),
      source('s7', 'A', '/tables/0/grid/1/1#0-2', '40', {
        basis: 'model_unanimous',
        tableId: 'tbl-x',
        tableCell: { rowIndex: 0, columnIndex: 0 },
      }),
      source('s8', 'E', '/tables/1/grid/0/0#0-1', 'a', {
        tableId: 'tbl-2',
        tableCell: { rowIndex: 0, columnIndex: 0 },
      }),
    ],
    attributes: [
      ...clean.attributes,
      attribute('a2', 'A', '길이', '5m', { sourceId: 's1' }, 'km'),
      attribute('a3', 'A', '길이', '3m', { sourceId: 's-missing' }),
      attribute('a4', 'B', '길이(cm)', '41', {
        cellKey: '/tables/0/grid/1/1',
      }),
      attribute('a5', 'E', '비고', 'a', { cellKey: '/tables/1' }),
    ],
    mediaReferences: [
      {
        id: 'm1',
        ledgerId: 'ledger-1',
        recordId: 'record-A',
        imageId: 'img-1',
      },
      {
        id: 'm2',
        ledgerId: 'ledger-1',
        recordId: 'record-Z',
        imageId: 'img-9',
      },
    ],
    links: [
      link('l1', 'A', 'B', [
        {
          kind: 'excerpt',
          text: '1호 수혈은 원형이다.',
          quote: '1호 수혈은 원형이다.',
        },
      ]),
      link('l2', 'B', 'A', []),
      link('l3', 'A', 'B', [
        { kind: 'table_cell', text: '길이: 40', locator: '/tables/0/grid/1/1' },
        { kind: 'phrase', text: 'x' },
      ]),
      link('l4', 'D', 'Z', [{ kind: 'excerpt', text: '없는 문장' }]),
      link('l5', 'A', 'B', [{ kind: 'table_cell', text: '' }]),
    ],
    reviewItems: [
      {
        id: 'review-1',
        kind: 'media',
        recordIds: ['record-A'],
        confirmedRecordIds: [],
        candidateRecordIds: ['record-Q'],
        imageIds: ['img-1'],
      },
      {
        id: 'review-1',
        kind: 'identity',
        recordIds: [],
        confirmedRecordIds: [],
      },
    ],
  } as unknown as ArchaeologyLedgerResult;
};

const summary = (report: ReturnType<typeof validateArchaeologyLedger>) =>
  Object.fromEntries(
    report.checks.map((c) => [c.id, `${c.failed}/${c.total}`]),
  );

describe('validateArchaeologyLedger', () => {
  test('counts every check and reports contract violations with codes and severities', () => {
    const report = validateArchaeologyLedger(brokenLedger(), {
      document,
      plan,
      attachments,
    });

    expect(report.version).toBe(LEDGER_VALIDATION_VERSION);
    expect(report.status).toBe('failed');
    expect(summary(report)).toEqual({
      unique_ids: '1/27',
      record_references: '3/32',
      ledger_ids: '1/12',
      image_references: '1/3',
      no_self_parent: '1/5',
      no_cycle: '2/5',
      parent_evidence: '2/5',
      record_sources: '1/5',
      excerpt_sources: '1/7',
      excerpt_source_owner: '3/6',
      source_resources: '1/8',
      source_spans: '1/7',
      source_refs: '1/3',
      table_cells: '2/4',
      attribute_sources: '2/5',
      planned_units: '1/2',
      spacing_variant_excerpts: '1/7',
      record_names: '2/5',
      record_identifiers: '1/3',
      attribute_values: '2/3',
      attribute_units: '1/2',
      link_evidence: '3/5',
      differing_values: '2/3',
      same_name_records: '1/4',
    });
    expect(report.issues).toHaveLength(
      report.checks.reduce((n, c) => n + c.failed, 0),
    );
    expect(report.checks[0]).toEqual({
      id: 'unique_ids',
      group: 'structure',
      code: 'DUPLICATE_ID',
      severity: 'error',
      total: 27,
      failed: 1,
    });
    const messages = report.issues.map(
      (i) => `${i.severity} ${i.code} ${i.message}`,
    );
    expect(messages).toEqual(
      expect.arrayContaining([
        'error DUPLICATE_ID ID review-1 is used more than once',
        'error INVALID_RESOURCE_REFERENCE media m2 names missing record record-Z',
        'error INVALID_RESOURCE_REFERENCE record-D belongs to ledger ledger-other',
        'error INVALID_RESOURCE_REFERENCE image img-9 is missing',
        'error PARENT_CYCLE record-D is its own parent',
        'error PARENT_CYCLE the parents of record-B form a cycle',
        'error UNSUPPORTED_CONTENT_CLAIM the parent of record-E has no evidence',
        'error MISSING_RECORD_SOURCE record-D has no registration source',
        'error MISSING_CONTENT_SOURCE excerpt e3 has no source',
        'error INVALID_CONTENT_SOURCE_REFERENCE excerpt e4 uses source s5 of record-C',
        'error INVALID_CONTENT_SOURCE_REFERENCE excerpt e5 names missing source s-missing',
        'error INVALID_CONTENT_SOURCE_REFERENCE excerpt e6 differs from its source s1',
        'error INVALID_RESOURCE_REFERENCE source s4 points to a missing resource',
        'error SOURCE_VALUE_MISMATCH source s2 is not the document text at its span',
        "error SOURCE_VALUE_MISMATCH source s2 has sourceRef #/wrong, not its resource's",
        'error INVALID_TABLE_CELL_POINTER source s7 points to a missing cell of tbl-x',
        'error MISSING_ATTRIBUTE_SOURCE attribute a3 has no source',
        'error UNRESOLVED_EVIDENCE_ASSIGNMENT planned unit u2 has no tracked attachment',
        'info DIFFERING_SOURCE_VALUES excerpts e1 and e2 differ only in spacing; both kept as written',
        'warning UNSUPPORTED_CONTENT_CLAIM name "우물" is not written in the record\'s evidence',
        'warning UNSUPPORTED_CONTENT_CLAIM identifier "9" is not written in the record\'s evidence',
        'error SOURCE_VALUE_MISMATCH value "41" is not its source text',
        'error SOURCE_VALUE_MISMATCH unit "km" is not written in key or value',
        'error UNSUPPORTED_CONTENT_CLAIM link l4 (중복) has evidence neither record states',
        'info DIFFERING_SOURCE_VALUES 2 different values for 길이(cm); all kept',
        'info AMBIGUOUS_RECORD_IDENTITY 2 records share the name 1수혈: record-A, record-B; told apart by chapter',
      ]),
    );
    expect(report.issues.find((i) => i.attributeId === 'a2')).toMatchObject({
      recordId: 'record-A',
    });
    expect(report.issues.find((i) => i.linkId === 'l2')).toMatchObject({
      recordId: 'record-B',
    });
    expect(
      report.issues.find((i) => i.message.startsWith('source s2 is not')),
    ).toMatchObject({ locator: '/chapters/0/textBlocks/0#13-20' });
  });

  test('passes a clean ledger, warns on a name without evidence and skips unit tracking without attachments', () => {
    const clean = validateArchaeologyLedger(cleanLedger(), { document, plan });
    const named = validateArchaeologyLedger(cleanLedger('토기'), {
      document,
      plan,
    });

    expect(clean.status).toBe('passed');
    expect(
      validateArchaeologyLedger(cleanLedger('1 수혈'), { document, plan })
        .status,
    ).toBe('passed');
    expect(clean.issues).toEqual([]);
    expect(clean.checks.find((c) => c.id === 'planned_units')).toMatchObject({
      total: 0,
      failed: 0,
    });
    expect(named.status).toBe('warnings');
    expect(named.issues).toEqual([
      {
        code: 'UNSUPPORTED_CONTENT_CLAIM',
        severity: 'warning',
        stage: 'validation',
        recordId: 'record-B',
        message: 'name "토기" is not written in the record\'s evidence',
      },
    ]);
  });
});

describe('applyLedgerValidation', () => {
  const issue = (
    severity: 'info' | 'warning' | 'error',
    recordId?: string,
  ) => ({
    code: 'UNSUPPORTED_CONTENT_CLAIM' as const,
    severity,
    stage: 'validation' as const,
    ...(recordId ? { recordId } : {}),
    message: severity,
  });
  const report = (issues: ReturnType<typeof issue>[]) => ({
    version: LEDGER_VALIDATION_VERSION,
    status: 'passed' as const,
    checks: [],
    issues,
  });

  test('decides the status from every issue and flags records named by warnings', () => {
    const ledger = cleanLedger();
    const warned = applyLedgerValidation(
      ledger,
      report([issue('warning', 'record-B'), issue('warning'), issue('info')]),
    );
    const failed = applyLedgerValidation(
      { ...ledger, issues: [issue('error')] },
      report([]),
    );
    const passed = applyLedgerValidation(
      ledger,
      report([issue('info', 'record-B')]),
    );

    expect(warned.ledger.validationStatus).toBe('warnings');
    expect(warned.records[0].needsReview).toBe(true);
    expect(warned.issues).toHaveLength(3);
    expect(failed.ledger.validationStatus).toBe('failed');
    expect(passed.ledger.validationStatus).toBe('passed');
    expect(passed.records[0].needsReview).toBe(false);
    expect(ledger.records[0].needsReview).toBe(false);
  });
});
