import type { TableAttributes } from '../attributes/table-attributes';
import type { TextAttributes } from '../attributes/text-attributes';
import type {
  ArchaeologyLedgerResult,
  LedgerExtractionIssue,
  LedgerRecordAttribute,
  LedgerReviewItem,
} from './archaeology-ledger';

/**
 * Put source attributes into an assembled ledger (A4), deterministically and without model calls. Table
 * attributes come first, then text attributes, each kept as written with where it is; values found in
 * several places are all kept. An owner question (a sentence that also names another record of the same
 * kind) becomes an `attribute` review item (`attribute_owner_ambiguous`) with its value and the other
 * records, and flags the record. Owned table cells left without a header are reported in `issues` per table.
 * `attributes` leaves `pending`.
 */
export function applyLedgerAttributes(
  result: ArchaeologyLedgerResult,
  sources: { table?: TableAttributes; text?: TextAttributes },
): ArchaeologyLedgerResult {
  const attributes: LedgerRecordAttribute[] = [
    ...(sources.table?.attributes ?? []).map((a) => ({
      recordId: a.recordId,
      keyText: a.keyText,
      valueText: a.valueText,
      ...(a.unitText ? { unitText: a.unitText } : {}),
      sourceText: a.sourceText,
      extractionMethod: a.extractionMethod,
      metadata: {
        pdfPageNo: a.metadata.pdfPageNo,
        tableId: a.metadata.tableId,
        cellKey: a.metadata.cellKey,
      },
    })),
    ...(sources.text?.attributes ?? []).map((a) => ({
      recordId: a.recordId,
      keyText: a.keyText,
      valueText: a.valueText,
      ...(a.unitText ? { unitText: a.unitText } : {}),
      sourceText: a.sourceText,
      extractionMethod: a.extractionMethod,
      metadata: {
        pdfPageNo: a.metadata.pdfPageNo,
        sourceId: a.metadata.sourceId,
        locator: a.metadata.locator,
      },
    })),
  ].map((a, i) => ({
    id: `attribute-${result.attributes.length + i + 1}`,
    ...a,
  }));

  const questions = sources.text?.ownerQuestions ?? [];
  const added: Array<Omit<LedgerReviewItem, 'id'>> = questions.map((q) => ({
    kind: 'attribute',
    recordIds: [q.recordId],
    confirmedRecordIds: [],
    reasons: ['attribute_owner_ambiguous'],
    candidateRecordIds: q.otherRecordIds,
    text: q.attribute.sourceText,
    locator: q.attribute.metadata.locator,
    pdfPageNo: q.attribute.metadata.pdfPageNo,
    detail: `${q.attribute.keyText}: ${q.attribute.valueText}`,
  }));
  const headerless = new Map<string, number>();
  for (const c of sources.table?.cellsWithoutHeader ?? []) {
    const table = c.cellKey.replace(/\/grid\/.*$/, '');
    headerless.set(table, (headerless.get(table) ?? 0) + 1);
  }
  const issues = [...headerless].map(([table, n]): LedgerExtractionIssue => ({
    code: 'UNMAPPED_TABLE_CELL',
    severity: 'info',
    stage: 'attributes',
    message: `${n} owned cells of ${table} have no header and were not kept`,
    locator: table,
  }));
  const flagged = new Set(questions.map((q) => q.recordId));
  return {
    ...result,
    records: result.records.map((r) =>
      flagged.has(r.id) ? { ...r, needsReview: true } : r,
    ),
    attributes: [...result.attributes, ...attributes],
    pending: result.pending.filter((p) => p !== 'attributes'),
    reviewItems: [
      ...result.reviewItems,
      ...added.map((item, i) => ({
        id: `review-${result.reviewItems.length + i + 1}`,
        ...item,
      })),
    ],
    issues: [...result.issues, ...issues],
  };
}
