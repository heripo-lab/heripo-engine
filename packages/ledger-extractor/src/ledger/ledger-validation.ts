import type { ProcessedDocument } from '@heripo/model';

import type { ContentAttachmentThinResult } from '../content-attachment/thin/assembly';
import type { ContentAttachmentPlan } from '../content-attachment/types';
import type {
  ArchaeologyLedgerResult,
  LedgerExtractionIssue,
  LedgerExtractionIssueCode,
  LedgerIssueSeverity,
} from './archaeology-ledger';

import { looseKey } from '../relations/record-names';
import { buildDocumentResourceIndex } from '../resources/document-resource-index';
import { createRecordEvidenceText } from './record-evidence';

export const LEDGER_VALIDATION_VERSION = 'ledger-validation.v1' as const;

export type LedgerValidationGroup =
  'structure' | 'hierarchy' | 'source' | 'fidelity';
/** One check: how many items it looked at and how many failed, so `0/0` is told apart from not checked. */
export interface LedgerValidationCheck {
  id: string;
  group: LedgerValidationGroup;
  code: LedgerExtractionIssueCode;
  severity: LedgerIssueSeverity;
  total: number;
  failed: number;
}
export interface LedgerValidationReport {
  version: typeof LEDGER_VALIDATION_VERSION;
  /** `failed` with any error, `warnings` with warnings only, else `passed`; info never changes it. */
  status: 'passed' | 'warnings' | 'failed';
  checks: LedgerValidationCheck[];
  issues: LedgerExtractionIssue[];
}

const norm = (text: string) => text.replace(/\s+/g, '');
const keyOf = (locator: string) => locator.split('#')[0];

/**
 * Validate an assembled ledger against the processed document it came from (spec §22), deterministically and
 * without model calls. Checks are grouped as structure (unique IDs, references, ledger IDs, images), hierarchy
 * (self-parent, cycles, parent evidence), source (record, excerpt and attribute sources, character spans
 * against the document, table cell pointers, source references, planned units) and fidelity (names and
 * identifiers in the record's evidence, attribute values and units as written, link evidence in either
 * record's text). Contract violations are errors. A name or identifier found in none of the record's
 * registration excerpts and name anchors, the captions of its registration tables, its chapter titles or its candidate
 * evidence is a warning; excerpts differing only in spacing and a key with differing values are info, kept
 * as written. The ledger is not changed and `reviewStatus` is never touched.
 */
export function validateArchaeologyLedger(
  result: ArchaeologyLedgerResult,
  inputs: {
    document: ProcessedDocument;
    plan: ContentAttachmentPlan;
    attachments?: ContentAttachmentThinResult;
  },
): LedgerValidationReport {
  const { document, plan, attachments } = inputs;
  const index = buildDocumentResourceIndex(document);
  const resourceByKey = new Map(index.resources.map((r) => [r.key, r]));
  const textOf = (key: string) => {
    const resource = resourceByKey.get(key);
    return resource && 'text' in resource.data
      ? (resource.data.text as string)
      : null;
  };
  const records = new Map(result.records.map((r) => [r.id, r]));
  const sources = new Map(result.sources.map((s) => [s.id, s]));
  const sourcesOf = new Map<string, typeof result.sources>();
  for (const s of result.sources)
    sourcesOf.set(s.recordId, [...(sourcesOf.get(s.recordId) ?? []), s]);
  const images = new Set(document.images.map((i) => i.id));
  const tables = new Map(document.tables.map((t) => [t.id, t]));

  const checks: LedgerValidationCheck[] = [];
  const issues: LedgerExtractionIssue[] = [];
  const check = <T>(
    id: string,
    group: LedgerValidationGroup,
    code: LedgerExtractionIssueCode,
    severity: LedgerIssueSeverity,
    items: T[],
    failing: (
      item: T,
    ) => Omit<LedgerExtractionIssue, 'code' | 'severity' | 'stage'> | null,
  ) => {
    let failed = 0;
    for (const item of items) {
      const issue = failing(item);
      if (!issue) continue;
      failed++;
      issues.push({ code, severity, stage: 'validation', ...issue });
    }
    checks.push({ id, group, code, severity, total: items.length, failed });
  };

  // structure
  const ids = [
    ...result.records,
    ...result.sources,
    ...result.attributes,
    ...result.mediaReferences,
    ...result.mediaCandidates,
    ...result.layerMentions,
    ...result.links,
    ...result.reviewItems,
  ].map((x) => x.id);
  const seen = new Set<string>();
  check('unique_ids', 'structure', 'DUPLICATE_ID', 'error', ids, (id) => {
    if (!seen.has(id)) {
      seen.add(id);
      return null;
    }
    return { message: `ID ${id} is used more than once` };
  });
  const references: Array<[string, string]> = [
    ...result.sources.map((s): [string, string] => [
      `source ${s.id}`,
      s.recordId,
    ]),
    ...result.attributes.map((a): [string, string] => [
      `attribute ${a.id}`,
      a.recordId,
    ]),
    ...result.mediaReferences.map((m): [string, string] => [
      `media ${m.id}`,
      m.recordId,
    ]),
    ...result.mediaCandidates.flatMap((m) =>
      m.recordIds.map((id): [string, string] => [`media ${m.id}`, id]),
    ),
    ...result.layerMentions.flatMap((m) =>
      [m.layerRecordId, ...m.recordIds].map((id): [string, string] => [
        `layer mention ${m.id}`,
        id,
      ]),
    ),
    ...result.links.flatMap((l): Array<[string, string]> => [
      [`link ${l.id}`, l.fromRecordId],
      [`link ${l.id}`, l.toRecordId],
    ]),
    ...result.reviewItems.flatMap((i) =>
      [
        ...i.recordIds,
        ...i.confirmedRecordIds,
        ...(i.candidateRecordIds ?? []),
      ].map((id): [string, string] => [`review ${i.id}`, id]),
    ),
    ...result.records.flatMap((r): Array<[string, string]> =>
      r.parentRecordId ? [[`parent of ${r.id}`, r.parentRecordId]] : [],
    ),
  ];
  check(
    'record_references',
    'structure',
    'INVALID_RESOURCE_REFERENCE',
    'error',
    references,
    ([from, id]) =>
      records.has(id)
        ? null
        : { message: `${from} names missing record ${id}` },
  );
  const owned = [
    ...result.records,
    ...result.mediaReferences,
    ...result.mediaCandidates,
    ...result.layerMentions,
    ...result.links,
  ];
  check(
    'ledger_ids',
    'structure',
    'INVALID_RESOURCE_REFERENCE',
    'error',
    owned,
    (x) =>
      x.ledgerId === result.ledger.id
        ? null
        : { message: `${x.id} belongs to ledger ${x.ledgerId}` },
  );
  const imageRefs = [
    ...result.mediaReferences.map((m) => m.imageId),
    ...result.mediaCandidates.flatMap((m) => m.imageIds),
    ...result.reviewItems.flatMap((i) => i.imageIds ?? []),
  ];
  check(
    'image_references',
    'structure',
    'INVALID_RESOURCE_REFERENCE',
    'error',
    imageRefs,
    (id) => (images.has(id) ? null : { message: `image ${id} is missing` }),
  );

  // hierarchy
  check(
    'no_self_parent',
    'hierarchy',
    'PARENT_CYCLE',
    'error',
    result.records,
    (r) =>
      r.parentRecordId === r.id
        ? { recordId: r.id, message: `${r.id} is its own parent` }
        : null,
  );
  // a record on a cycle longer than one; a self-parent is reported above
  const onCycle = (id: string) => {
    const visited = new Set<string>();
    for (
      let p = records.get(id)?.parentRecordId;
      p;
      p = records.get(p)?.parentRecordId
    ) {
      if (p === id) return true;
      if (visited.has(p)) return false;
      visited.add(p);
    }
    return false;
  };
  check(
    'no_cycle',
    'hierarchy',
    'PARENT_CYCLE',
    'error',
    result.records,
    (r) =>
      r.parentRecordId !== r.id && onCycle(r.id)
        ? { recordId: r.id, message: `the parents of ${r.id} form a cycle` }
        : null,
  );
  check(
    'parent_evidence',
    'hierarchy',
    'UNSUPPORTED_CONTENT_CLAIM',
    'error',
    result.records.filter((r) => r.parentRecordId),
    (r) =>
      r.parentBasis && r.parentEvidence?.length
        ? null
        : { recordId: r.id, message: `the parent of ${r.id} has no evidence` },
  );

  // source
  check(
    'record_sources',
    'source',
    'MISSING_RECORD_SOURCE',
    'error',
    result.records,
    (r) =>
      sourcesOf.get(r.id)?.some((s) => s.basis === 'registration')
        ? null
        : { recordId: r.id, message: `${r.id} has no registration source` },
  );
  const excerpts = result.records.flatMap((r) =>
    r.content.map((c) => ({ record: r, excerpt: c })),
  );
  check(
    'excerpt_sources',
    'source',
    'MISSING_CONTENT_SOURCE',
    'error',
    excerpts,
    ({ record, excerpt }) =>
      excerpt.sourceIds.length
        ? null
        : {
            recordId: record.id,
            message: `excerpt ${excerpt.id} has no source`,
          },
  );
  const excerptSources = excerpts.flatMap(({ record, excerpt }) =>
    excerpt.sourceIds.map((sourceId) => ({ record, excerpt, sourceId })),
  );
  check(
    'excerpt_source_owner',
    'source',
    'INVALID_CONTENT_SOURCE_REFERENCE',
    'error',
    excerptSources,
    ({ record, excerpt, sourceId }) => {
      const source = sources.get(sourceId);
      if (!source)
        return {
          recordId: record.id,
          message: `excerpt ${excerpt.id} names missing source ${sourceId}`,
        };
      if (source.recordId !== record.id)
        return {
          recordId: record.id,
          message: `excerpt ${excerpt.id} uses source ${sourceId} of ${source.recordId}`,
          locator: source.locator,
        };
      return norm(source.excerpt) === norm(excerpt.text)
        ? null
        : {
            recordId: record.id,
            message: `excerpt ${excerpt.id} differs from its source ${sourceId}`,
            locator: source.locator,
          };
    },
  );
  check(
    'source_resources',
    'source',
    'INVALID_RESOURCE_REFERENCE',
    'error',
    result.sources,
    (s) =>
      resourceByKey.has(keyOf(s.locator))
        ? null
        : {
            recordId: s.recordId,
            message: `source ${s.id} points to a missing resource`,
            locator: s.locator,
          },
  );
  check(
    'source_spans',
    'source',
    'SOURCE_VALUE_MISMATCH',
    'error',
    result.sources.filter((s) => resourceByKey.has(keyOf(s.locator))),
    (s) =>
      textOf(keyOf(s.locator))?.slice(s.charStart, s.charEnd) === s.excerpt
        ? null
        : {
            recordId: s.recordId,
            message: `source ${s.id} is not the document text at its span`,
            locator: s.locator,
          },
  );
  check(
    'source_refs',
    'source',
    'SOURCE_VALUE_MISMATCH',
    'error',
    result.sources.filter(
      (s) => s.sourceRef && resourceByKey.has(keyOf(s.locator)),
    ),
    (s) => {
      // table cells carry their table's sourceRef
      const refs = resourceByKey.get(keyOf(s.locator))!.sourceRefs;
      return refs.includes(s.sourceRef!)
        ? null
        : {
            recordId: s.recordId,
            message: `source ${s.id} has sourceRef ${s.sourceRef}, not its resource's`,
            locator: s.locator,
          };
    },
  );
  check(
    'table_cells',
    'source',
    'INVALID_TABLE_CELL_POINTER',
    'error',
    result.sources.filter((s) => s.tableCell),
    (s) =>
      tables.get(s.tableId!)?.grid[s.tableCell!.rowIndex]?.[
        s.tableCell!.columnIndex
      ]
        ? null
        : {
            recordId: s.recordId,
            message: `source ${s.id} points to a missing cell of ${s.tableId}`,
            locator: s.locator,
          },
  );
  const attributeText = (a: (typeof result.attributes)[number]) =>
    a.metadata.cellKey
      ? textOf(a.metadata.cellKey)
      : (sources.get(a.metadata.sourceId!)?.excerpt ?? null);
  check(
    'attribute_sources',
    'source',
    'MISSING_ATTRIBUTE_SOURCE',
    'error',
    result.attributes,
    (a) =>
      attributeText(a) !== null
        ? null
        : {
            recordId: a.recordId,
            attributeId: a.id,
            message: `attribute ${a.id} has no source`,
          },
  );
  check(
    'planned_units',
    'source',
    'UNRESOLVED_EVIDENCE_ASSIGNMENT',
    'error',
    attachments ? plan.units : [],
    (u) =>
      attachments!.units.some((x) => x.unitId === u.unitId) &&
      !attachments!.missingUnitIds.includes(u.unitId)
        ? null
        : { message: `planned unit ${u.unitId} has no tracked attachment` },
  );
  check(
    'spacing_variant_excerpts',
    'source',
    'DIFFERING_SOURCE_VALUES',
    'info',
    excerpts,
    ({ record, excerpt }) => {
      const first = record.content.find(
        (c) => norm(c.text) === norm(excerpt.text),
      )!;
      return first === excerpt
        ? null
        : {
            recordId: record.id,
            message: `excerpts ${first.id} and ${excerpt.id} differ only in spacing; both kept as written`,
          };
    },
  );

  // fidelity
  const evidenceText = createRecordEvidenceText(result, plan, document);
  check(
    'record_names',
    'fidelity',
    'UNSUPPORTED_CONTENT_CLAIM',
    'warning',
    result.records,
    (r) =>
      evidenceText(r.id).includes(norm(r.sourceName))
        ? null
        : {
            recordId: r.id,
            message: `name "${r.sourceName}" is not written in the record's evidence`,
          },
  );
  check(
    'record_identifiers',
    'fidelity',
    'UNSUPPORTED_CONTENT_CLAIM',
    'warning',
    result.records.filter((r) => r.sourceIdentifier),
    (r) =>
      evidenceText(r.id).includes(norm(r.sourceIdentifier!))
        ? null
        : {
            recordId: r.id,
            message: `identifier "${r.sourceIdentifier}" is not written in the record's evidence`,
          },
  );
  check(
    'attribute_values',
    'fidelity',
    'SOURCE_VALUE_MISMATCH',
    'error',
    result.attributes.filter((a) => attributeText(a) !== null),
    (a) =>
      norm(attributeText(a)!).includes(norm(a.valueText))
        ? null
        : {
            recordId: a.recordId,
            attributeId: a.id,
            message: `value "${a.valueText}" is not its source text`,
          },
  );
  check(
    'attribute_units',
    'fidelity',
    'SOURCE_VALUE_MISMATCH',
    'error',
    result.attributes.filter((a) => a.unitText),
    (a) =>
      `${a.keyText}${a.valueText}`.includes(a.unitText!)
        ? null
        : {
            recordId: a.recordId,
            attributeId: a.id,
            message: `unit "${a.unitText}" is not written in key or value`,
          },
  );
  check(
    'link_evidence',
    'fidelity',
    'UNSUPPORTED_CONTENT_CLAIM',
    'error',
    result.links,
    (l) => {
      const stated = (quote: string) =>
        [l.fromRecordId, l.toRecordId].some((id) =>
          (sourcesOf.get(id) ?? []).some((s) =>
            norm(s.excerpt).includes(norm(quote)),
          ),
        );
      const supported =
        l.evidence.length > 0 &&
        l.evidence.every((e) =>
          e.kind === 'excerpt'
            ? stated(e.quote ?? e.text)
            : e.kind === 'table_cell'
              ? resourceByKey.has(e.locator ?? '')
              : true,
        );
      return supported
        ? null
        : {
            linkId: l.id,
            recordId: l.fromRecordId,
            message: `link ${l.id} (${l.relationLabel}) has evidence neither record states`,
          };
    },
  );
  const byKey = new Map<string, string[]>();
  for (const a of result.attributes) {
    const key = `${a.recordId}|${norm(a.keyText)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), norm(a.valueText)]);
  }
  check(
    'differing_values',
    'fidelity',
    'DIFFERING_SOURCE_VALUES',
    'info',
    [...byKey],
    ([key, values]) =>
      new Set(values).size > 1
        ? {
            recordId: key.split('|')[0],
            message: `${new Set(values).size} different values for ${key.split('|')[1]}; all kept`,
          }
        : null,
  );
  // records of one kind written with the same name (`29호 수혈`, `29 수혈`): numbering restarted per period
  const sameName = new Map<string, typeof result.records>();
  const nameOf = (r: (typeof result.records)[number]) =>
    r.sourceIdentifier && !r.sourceName.includes(r.sourceIdentifier)
      ? `${r.sourceIdentifier}${r.sourceName}`
      : r.sourceName;
  for (const r of result.records) {
    const key = `${r.recordKind}|${looseKey(nameOf(r))}`;
    sameName.set(key, [...(sameName.get(key) ?? []), r]);
  }
  check(
    'same_name_records',
    'fidelity',
    'AMBIGUOUS_RECORD_IDENTITY',
    'info',
    [...sameName.values()],
    (group) =>
      group.length > 1
        ? {
            recordId: group[0].id,
            message: `${group.length} records share the name ${looseKey(nameOf(group[0]))}: ${group.map((r) => r.id).join(', ')}; told apart by chapter`,
          }
        : null,
  );

  const severities = new Set(issues.map((i) => i.severity));
  return {
    version: LEDGER_VALIDATION_VERSION,
    status: severities.has('error')
      ? 'failed'
      : severities.has('warning')
        ? 'warnings'
        : 'passed',
    checks,
    issues,
  };
}

/**
 * Put a validation report into the ledger: its issues join the stage issues, a record named by a warning flags
 * `needsReview` (a name or identifier missing from its evidence), and `validationStatus` is decided once from
 * every issue: `failed` with any error, `warnings` with any warning, else `passed`; info never changes it.
 * `reviewStatus` is untouched, since passing checks is not a person's review.
 */
export function applyLedgerValidation(
  result: ArchaeologyLedgerResult,
  report: LedgerValidationReport,
): ArchaeologyLedgerResult {
  const issues = [...result.issues, ...report.issues];
  const severities = new Set(issues.map((i) => i.severity));
  const flagged = new Set(
    report.issues
      .filter((i) => i.severity === 'warning' && i.recordId)
      .map((i) => i.recordId),
  );
  return {
    ...result,
    ledger: {
      ...result.ledger,
      validationStatus: severities.has('error')
        ? 'failed'
        : severities.has('warning')
          ? 'warnings'
          : 'passed',
    },
    records: result.records.map((r) =>
      flagged.has(r.id) ? { ...r, needsReview: true } : r,
    ),
    issues,
  };
}
