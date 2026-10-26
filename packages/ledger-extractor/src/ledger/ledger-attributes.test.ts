import type { TableAttributes } from '../attributes/table-attributes';
import type {
  TextAttribute,
  TextAttributes,
} from '../attributes/text-attributes';
import type { ArchaeologyLedgerResult } from './archaeology-ledger';

import { describe, expect, test } from 'vitest';

import { applyLedgerAttributes } from './ledger-attributes';

const ledger = (issues: unknown[] = []): ArchaeologyLedgerResult =>
  ({
    ledger: { id: 'ledger-1', validationStatus: 'passed' },
    records: ['r1', 'r2', 'r3'].map((id, ordinal) => ({
      id,
      ordinal,
      needsReview: false,
    })),
    sources: [],
    attributes: [],
    mediaReferences: [],
    links: [],
    pending: ['attributes', 'links'],
    reviewItems: [{ id: 'review-1', kind: 'identity' }],
    issues,
  }) as unknown as ArchaeologyLedgerResult;
const tableAttribute = (cellKey: string, unitText?: string) => ({
  recordId: 'r1',
  keyText: '규모(cm) / 길이',
  valueText: '28',
  ...(unitText ? { unitText } : {}),
  sourceText: '28',
  extractionMethod: 'table_mapping' as const,
  metadata: {
    tableId: 'tbl-0',
    cellKey,
    rowIndex: 2,
    logicalColumn: 1,
    layout: 'columns' as const,
    pdfPageNo: 5,
  },
});
const table = {
  version: 'table-attributes.v2',
  attributes: [
    tableAttribute('/tables/0/grid/2/1', 'cm'),
    tableAttribute('/tables/0/grid/3/1'),
  ],
  tables: [],
  cellsWithoutHeader: [
    { recordId: 'r1', cellKey: '/tables/0/grid/2/4', text: '0.5' },
    { recordId: 'r1', cellKey: '/tables/0/grid/3/4', text: '0.7' },
    { recordId: 'r2', cellKey: '/tables/3/grid/1/2', text: '9' },
  ],
} as TableAttributes;
const textAttribute = (
  recordId: string,
  valueText: string,
  unitText?: string,
): TextAttribute => ({
  recordId,
  keyText: '깊이',
  valueText,
  ...(unitText ? { unitText } : {}),
  sourceText: `2호 수혈과 11호 수혈은 ${valueText}이다.`,
  extractionMethod: 'rule',
  metadata: {
    kind: 'measurement',
    sourceId: 's1',
    locator: '/l/1',
    pdfPageNo: 7,
  },
});
const text: TextAttributes = {
  version: 'text-attributes.v2',
  attributes: [textAttribute('r3', '깊이 9cm', 'cm'), textAttribute('r3', '9')],
  ownerQuestions: [
    {
      recordId: 'r2',
      otherRecordIds: ['r3'],
      attribute: textAttribute('r2', '깊이 20cm', 'cm'),
    },
  ],
};

describe('applyLedgerAttributes', () => {
  test('keeps table then text attributes, asks about shared sentences and reports headerless cells', () => {
    const result = applyLedgerAttributes(ledger(), { table, text });

    expect(result.attributes).toEqual([
      {
        id: 'attribute-1',
        recordId: 'r1',
        keyText: '규모(cm) / 길이',
        valueText: '28',
        unitText: 'cm',
        sourceText: '28',
        extractionMethod: 'table_mapping',
        metadata: {
          pdfPageNo: 5,
          tableId: 'tbl-0',
          cellKey: '/tables/0/grid/2/1',
        },
      },
      expect.not.objectContaining({ unitText: expect.anything() }),
      {
        id: 'attribute-3',
        recordId: 'r3',
        keyText: '깊이',
        valueText: '깊이 9cm',
        unitText: 'cm',
        sourceText: '2호 수혈과 11호 수혈은 깊이 9cm이다.',
        extractionMethod: 'rule',
        metadata: { pdfPageNo: 7, sourceId: 's1', locator: '/l/1' },
      },
      expect.not.objectContaining({ unitText: expect.anything() }),
    ]);
    expect(result.attributes[1].id).toBe('attribute-2');
    expect(result.reviewItems.slice(1)).toEqual([
      {
        id: 'review-2',
        kind: 'attribute',
        recordIds: ['r2'],
        confirmedRecordIds: [],
        reasons: ['attribute_owner_ambiguous'],
        candidateRecordIds: ['r3'],
        text: '2호 수혈과 11호 수혈은 깊이 20cm이다.',
        locator: '/l/1',
        pdfPageNo: 7,
        detail: '깊이: 깊이 20cm',
      },
    ]);
    expect(result.records.map((r) => r.needsReview)).toEqual([
      false,
      true,
      false,
    ]);
    expect(result.pending).toEqual(['links']);
    expect(result.issues).toEqual([
      {
        code: 'UNMAPPED_TABLE_CELL',
        severity: 'info',
        stage: 'attributes',
        message: '2 owned cells of /tables/0 have no header and were not kept',
        locator: '/tables/0',
      },
      expect.objectContaining({
        code: 'UNMAPPED_TABLE_CELL',
        severity: 'info',
        stage: 'attributes',
        message: '1 owned cells of /tables/3 have no header and were not kept',
      }),
    ]);
    expect(result.ledger.validationStatus).toBe('passed');
  });

  test('passes with no sources and keeps earlier warnings', () => {
    const empty = applyLedgerAttributes(ledger(), {});
    const warned = applyLedgerAttributes(ledger(['earlier']), {});

    expect(empty.attributes).toEqual([]);
    expect(empty.reviewItems).toHaveLength(1);
    expect(empty.issues).toEqual([]);
    expect(warned.issues).toEqual(['earlier']);
  });
});
