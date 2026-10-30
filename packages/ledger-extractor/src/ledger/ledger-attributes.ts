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
 * several places are all kept. Owner questions (a sentence that also names another record of the same kind)
 * become `attribute` review items (`attribute_owner_ambiguous`): one per sentence and value, listing every
 * record asked about that value and the other named records, so a value written once is reviewed once; each
 * record asked about is flagged. Owned table cells left without a header are reported in `issues` per table.
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
  // one item per sentence and value: the records asked about it in order, the other named records after them
  const grouped = new Map<string, typeof questions>();
  for (const q of questions) {
    const { locator } = q.attribute.metadata;
    const key = JSON.stringify([
      locator,
      q.attribute.sourceText,
      q.attribute.keyText,
      q.attribute.valueText,
    ]);
    grouped.set(key, [...(grouped.get(key) ?? []), q]);
  }
  const added: Array<Omit<LedgerReviewItem, 'id'>> = [...grouped.values()].map(
    (group) => {
      const recordIds = [...new Set(group.map((q) => q.recordId))];
      const { attribute } = group[0];
      return {
        kind: 'attribute',
        recordIds,
        confirmedRecordIds: [],
        reasons: ['attribute_owner_ambiguous'],
        candidateRecordIds: [
          ...new Set(group.flatMap((q) => q.otherRecordIds)),
        ].filter((id) => !recordIds.includes(id)),
        text: attribute.sourceText,
        locator: attribute.metadata.locator,
        pdfPageNo: attribute.metadata.pdfPageNo,
        detail: `${attribute.keyText}: ${attribute.valueText}`,
      };
    },
  );
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
