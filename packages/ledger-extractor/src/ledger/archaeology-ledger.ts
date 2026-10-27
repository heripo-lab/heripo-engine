import type {
  ContentAttachmentThinBasis,
  ContentAttachmentThinResult,
} from '../content-attachment/thin/assembly';
import type {
  AttachmentRegistryEntry,
  ContentAttachmentPlan,
  TextSource,
} from '../content-attachment/types';
import type { ReportScopeCompletion } from '../profile/report-scope';
import type { PlaceAliasSummary } from '../relations/place-aliases';

export const ARCHAEOLOGY_LEDGER_VERSION = 'archaeology-ledger.v1' as const;

/** Ledger tables or fields the engine does not extract yet; consumers show them as pending, not as empty findings. */
export const ARCHAEOLOGY_LEDGER_PENDING_PARTS = [
  'parent_hierarchy',
  'attributes',
  'media_references',
  'links',
] as const;
export type ArchaeologyLedgerPendingPart =
  (typeof ARCHAEOLOGY_LEDGER_PENDING_PARTS)[number];

export interface ArchaeologyLedger {
  id: string;
  processedDocumentId: string;
  revisionKind: 'extraction';
  schemaVersion: typeof ARCHAEOLOGY_LEDGER_VERSION;
  extractorVersion: string;
  /** Prompt version of the content attachment calls. */
  promptVersion: string;
  /** `not_run` until `applyLedgerValidation`; then from the severities of every issue. */
  validationStatus: 'not_run' | 'passed' | 'warnings' | 'failed';
  reviewStatus: 'not_reviewed';
  /** How the discovery scope was set, when the run completed a proposed scope (`completeReportScope`). */
  discoveryScope?: ReportScopeCompletion;
  /** The confirmed profile and the thin rules fixed in the attachment plan, when the plan has them. */
  reportProfile?: {
    profileSha256: string;
    source: 'router' | 'manual';
    thinPolicy?: ContentAttachmentPlan['thinPolicy'];
    thinPolicyDecisions?: ContentAttachmentPlan['thinPolicyDecisions'];
  };
  candidateSnapshotId: string;
  /** The injected place alias table parents were decided with, when one was applied. */
  placeAliases?: PlaceAliasSummary;
  extractedAt: string;
  createdAt: string;
}
/** One original sentence or table phrase of a record, unchanged; identical text shares one excerpt. */
export interface LedgerContentExcerpt {
  id: string;
  text: string;
  sourceIds: string[];
}
export interface LedgerRecord {
  id: string;
  ledgerId: string;
  /** The record that directly contains this one; set by `applyLedgerParents`, absent when undecided. */
  parentRecordId?: string;
  /**
   * How the parent was decided: by code from a find-spot phrase or table row, by an injected place alias rule
   * a person decided, or by unanimous judgment runs.
   */
  parentBasis?: 'code' | 'alias' | 'judgment';
  /** The original text that states the parent. */
  parentEvidence?: LedgerParentEvidence[];
  recordKind: AttachmentRegistryEntry['recordKind'];
  sourceIdentifier?: string;
  sourceName: string;
  content: LedgerContentExcerpt[];
  ordinal: number;
  /**
   * Set when a non-collective review item proposes this record without every run agreeing, or its identity is
   * uncertain; see `reviewItems`.
   */
  needsReview: boolean;
  reviewStatus: 'not_reviewed';
}
/** Original text stating a parent or a relation: a phrase, table cell, heading, chapter title or excerpt. */
export interface LedgerParentEvidence {
  kind:
    | 'phrase'
    | 'table_row'
    | 'heading_scope'
    | 'chapter_title'
    | 'excerpt'
    | 'alias_rule'
    | 'table_cell';
  /** For `alias_rule`: `<written> → <registered>`. */
  text: string;
  /** For `alias_rule`: the rule and the report text that states the correspondence. */
  ruleId?: string;
  quote?: string;
  locator?: string;
  chapterId?: string;
  pdfPageNo?: number | null;
}
/** A source-backed relation that is not the record's parent; not an ontology predicate. */
export interface LedgerRecordLink {
  id: string;
  ledgerId: string;
  fromRecordId: string;
  toRecordId: string;
  relationLabel: string;
  evidence: LedgerParentEvidence[];
  needsReview: boolean;
  /** How the link was decided: a source sentence or relation column rule; absent for links kept beside a parent. */
  basis?: 'rule' | 'table_column';
  /** True when the label reads the same both ways (`중복`, `인접`, `위치`). */
  symmetric?: boolean;
}
/** A source value of a record, kept as written: a table cell or a measurement phrase. */
export interface LedgerRecordAttribute {
  id: string;
  recordId: string;
  keyText: string;
  valueText: string;
  unitText?: string;
  sourceText: string;
  extractionMethod: 'table_mapping' | 'rule';
  /** Where the value is: the table cell or the excerpt source, and the page. */
  metadata: {
    pdfPageNo: number | null;
    tableId?: string;
    cellKey?: string;
    sourceId?: string;
    locator?: string;
  };
}
/** A record linked to an image by a figure reference in its own text or by the image's caption. */
export interface LedgerMediaReference {
  id: string;
  ledgerId: string;
  recordId: string;
  imageId: string;
  /** The record's images in order of first citation. */
  ordinal: number;
  /** The image's label as captioned, such as `사진 45`. */
  referenceLabel: string;
  /** The image caption exactly as preprocessed. */
  captionText: string;
  /** The label's words as written; no properties are inferred from the image. */
  captionProperties: { mediaType: string; sequenceNo: string };
  basis: 'text_reference' | 'caption_name' | 'caption_range';
  /** The citing excerpt or the caption text that names the record. */
  evidence: Array<{
    kind: 'excerpt' | 'caption';
    text: string;
    sourceId?: string;
    locator?: string;
  }>;
  needsReview: boolean;
}
/** Where an excerpt of a record occurs in the processed document. */
export interface LedgerRecordSource {
  id: string;
  recordId: string;
  chapterId?: string;
  textBlockId?: string;
  tableId?: string;
  tableCell?: { rowIndex: number; columnIndex: number };
  sourceRef?: string;
  pdfPageNo: number | null;
  /** The processed-document resource key and character span. */
  locator: string;
  excerpt: string;
  charStart: number;
  charEnd: number;
  /**
   * How the excerpt reached the record: the candidate's own registration evidence, a nearby block where the
   * record's name is written (`name_anchor`, see `applyLedgerNameAnchors`), or an attachment basis.
   */
  basis: 'registration' | 'name_anchor' | ContentAttachmentThinBasis;
}
/** Steps that report issues: assembly, the `apply*` stages and full validation. */
export type LedgerExtractionStage =
  'assembly' | 'media' | 'attributes' | 'links' | 'validation';
/**
 * Issue codes of the implementation spec (§22), with `DUPLICATE_ID` for repeated ledger IDs and
 * `UNMAPPED_TABLE_CELL` for owned table cells left without a header.
 */
export type LedgerExtractionIssueCode =
  | 'DUPLICATE_ID'
  | 'AMBIGUOUS_RECORD_IDENTITY'
  | 'UNMAPPED_TABLE_CELL'
  | 'REFERENCE_LABEL_MISMATCH'
  | 'MEDIA_MATCH_AMBIGUOUS'
  | 'UNRESOLVED_LINK_TARGET'
  | 'INVALID_RESOURCE_REFERENCE'
  | 'PARENT_CYCLE'
  | 'MISSING_RECORD_SOURCE'
  | 'MISSING_ATTRIBUTE_SOURCE'
  | 'MISSING_CONTENT_SOURCE'
  | 'INVALID_CONTENT_SOURCE_REFERENCE'
  | 'INVALID_TABLE_CELL_POINTER'
  | 'UNSUPPORTED_CONTENT_CLAIM'
  | 'SOURCE_VALUE_MISMATCH'
  | 'UNRESOLVED_EVIDENCE_ASSIGNMENT'
  | 'DIFFERING_SOURCE_VALUES';
export type LedgerIssueSeverity = 'info' | 'warning' | 'error';
export interface LedgerExtractionIssue {
  code: LedgerExtractionIssueCode;
  severity: LedgerIssueSeverity;
  /** The step that found the issue. */
  stage: LedgerExtractionStage;
  recordId?: string;
  attributeId?: string;
  linkId?: string;
  imageId?: string;
  message: string;
  /** Where the problem is: a source locator, table cell key or resource key. */
  locator?: string;
}
/** Something a person must decide before the record set is reviewed; the engine never decides it. */
export interface LedgerReviewItem {
  id: string;
  kind:
    | 'segment'
    | 'identity'
    | 'profile_decision'
    | 'parent'
    | 'media'
    | 'attribute'
    | 'link';
  /** Records the item proposes or concerns. */
  recordIds: string[];
  /** Records every final run already agreed on for a segment. */
  confirmedRecordIds: string[];
  reasons: string[];
  text?: string;
  locator?: string;
  pdfPageNo?: number | null;
  /** A chapter collective whose members are exactly the proposed records, to decide all such items at once. */
  collective?: { path: string[]; kind: string; members: number };
  /** For a `parent` item: the records offered as the parent; for an `attribute` or `link` item: the other records the sentence names. */
  candidateRecordIds?: string[];
  /** For a `parent` item: each judgment run's answer as a record ID, `none` or `invalid`. */
  votes?: string[];
  /** For a `media` item: the images in question. */
  imageIds?: string[];
  detail?: string;
}
export interface ArchaeologyLedgerResult {
  ledger: ArchaeologyLedger;
  records: LedgerRecord[];
  sources: LedgerRecordSource[];
  /** Source attributes of records; empty until `applyLedgerAttributes` runs. */
  attributes: LedgerRecordAttribute[];
  /** Records linked to images; empty until `applyLedgerMedia` runs. */
  mediaReferences: LedgerMediaReference[];
  /** Relations kept beside a chosen parent; full relation extraction is still pending. */
  links: LedgerRecordLink[];
  pending: ArchaeologyLedgerPendingPart[];
  reviewItems: LedgerReviewItem[];
  issues: LedgerExtractionIssue[];
}

/**
 * Assemble the archaeology ledger from what the engine extracts today: the frozen candidate registry (records),
 * the thin content attachments (content excerpts and their sources), review items and the plan's profile
 * decisions. Excerpt text is cut unchanged from the processed-document resources in the plan; a registration
 * quote is used where its resource is outside the plan. Parent hierarchy, attributes, media references and
 * links are not extracted yet and are listed as pending. Deterministic, no model calls; IDs derive from the
 * registry group IDs and positions.
 */
export function assembleArchaeologyLedger(
  plan: ContentAttachmentPlan,
  attachments: ContentAttachmentThinResult,
  options: {
    ledgerId: string;
    processedDocumentId: string;
    extractorVersion: string;
    extractedAt: string;
    createdAt: string;
  },
): ArchaeologyLedgerResult {
  const resources = new Map<string, TextSource>();
  for (const unit of plan.units)
    for (const s of unit.sources) resources.set(s.resource.key, s.resource);
  const recordIdOf = new Map(
    plan.registry.map((r) => [r.ref, `record-${r.groupId}`]),
  );
  const sources: LedgerRecordSource[] = [];
  const excerptsOf = new Map<string, Map<string, LedgerContentExcerpt>>();
  const seen = new Set<string>();
  const addSource = (
    recordId: string,
    location: Omit<LedgerRecordSource, 'id' | 'recordId'>,
  ) => {
    const key = `${recordId}|${location.locator}`;
    if (seen.has(key)) return;
    seen.add(key);
    const id = `source-${sources.length + 1}`;
    sources.push({ id, recordId, ...location });
    const excerpts = excerptsOf.get(recordId) ?? new Map();
    excerptsOf.set(recordId, excerpts);
    const excerpt = excerpts.get(location.excerpt) ?? {
      id: `${recordId}-excerpt-${excerpts.size + 1}`,
      text: location.excerpt,
      sourceIds: [],
    };
    excerpt.sourceIds.push(id);
    excerpts.set(location.excerpt, excerpt);
  };
  const locate = (
    resourceKey: string,
    charStart: number,
    charEnd: number,
    fallback?: {
      quote: string;
      pdfPageNo: number | null;
      sourceRefs: string[];
    },
  ): Omit<LedgerRecordSource, 'id' | 'recordId' | 'basis'> => {
    const r = resources.get(resourceKey);
    const base = {
      locator: `${resourceKey}#${charStart}-${charEnd}`,
      charStart,
      charEnd,
    };
    if (!r)
      return {
        ...base,
        pdfPageNo: fallback!.pdfPageNo,
        ...(fallback!.sourceRefs[0]
          ? { sourceRef: fallback!.sourceRefs[0] }
          : {}),
        excerpt: fallback!.quote,
      };
    return {
      ...base,
      pdfPageNo: r.pdfPageNo,
      ...(r.chapterIds.length ? { chapterId: r.chapterIds.at(-1) } : {}),
      ...(r.kind === 'text' && r.resourceId
        ? { textBlockId: r.resourceId }
        : {}),
      ...(r.kind === 'tableCell'
        ? {
            tableId: r.tableId,
            tableCell: { rowIndex: r.rowIndex, columnIndex: r.columnIndex },
          }
        : {}),
      ...(r.sourceRefs[0] ? { sourceRef: r.sourceRefs[0] } : {}),
      excerpt: r.data.text.slice(charStart, charEnd),
    };
  };

  // registration evidence first, so every record keeps the text it was found by
  for (const entry of plan.registry)
    for (const mention of entry.mentions)
      for (const e of mention.evidence)
        addSource(recordIdOf.get(entry.ref)!, {
          ...locate(e.resourceKey, e.charStart, e.charEnd, e),
          basis: 'registration',
        });
  for (const content of attachments.contents)
    for (const x of content.excerpts)
      addSource(recordIdOf.get(content.registryRef)!, {
        ...locate(x.resourceKey, x.charStart, x.charEnd),
        basis: x.basis,
      });

  const reviewItems: LedgerReviewItem[] = [];
  const toRecords = (refs: string[]) =>
    [...new Set(refs)].map((ref) => recordIdOf.get(ref)!);
  for (const item of attachments.reviewItems) {
    const location = locate(item.resourceKey, item.charStart, item.charEnd);
    reviewItems.push({
      id: `review-${reviewItems.length + 1}`,
      kind: 'segment',
      recordIds: toRecords([
        ...item.confirmed,
        ...item.contested.map((v) => v.ref),
        ...item.areaSuggestions.map((v) => v.ref),
        ...item.layerSuggestions,
      ]),
      confirmedRecordIds: toRecords(item.confirmed),
      reasons: item.reasons,
      text: location.excerpt,
      locator: location.locator,
      pdfPageNo: location.pdfPageNo,
      ...(item.collectiveHandle
        ? {
            collective: {
              path: item.collectiveHandle.path,
              kind: item.collectiveHandle.kind,
              members: item.collectiveHandle.members,
            },
          }
        : {}),
    });
  }
  const refOfCandidate = new Map(
    plan.registry.flatMap((r) => r.mentions.map((m) => [m.candidateId, r.ref])),
  );
  for (const u of plan.registryUncertainties) {
    const refs = [u.leftCandidateId, u.rightCandidateId].map((id) =>
      refOfCandidate.get(id)!,
    );
    reviewItems.push({
      id: `review-${reviewItems.length + 1}`,
      kind: 'identity',
      recordIds: toRecords(refs),
      confirmedRecordIds: [],
      reasons: ['identity_uncertain'],
      detail: u.reason,
    });
  }
  for (const d of plan.thinPolicyDecisions ?? [])
    if (d.needsDecision)
      reviewItems.push({
        id: `review-${reviewItems.length + 1}`,
        kind: 'profile_decision',
        recordIds: [],
        confirmedRecordIds: [],
        reasons: ['profile_decision'],
        detail: `${d.branch}=${d.value} (${d.trait}=${d.traitValue})`,
      });

  // a record every run already agreed on is not in question for that item; a collective item is decided once
  // for the whole set, so it does not flag each member
  const flagged = new Set(
    reviewItems.flatMap((i) =>
      i.collective
        ? []
        : i.recordIds.filter((id) => !i.confirmedRecordIds.includes(id)),
    ),
  );
  const records: LedgerRecord[] = plan.registry.map((entry, ordinal) => {
    const id = recordIdOf.get(entry.ref)!;
    const first = entry.mentions[0];
    return {
      id,
      ledgerId: options.ledgerId,
      recordKind: entry.recordKind,
      ...(first.sourceIdentifier
        ? { sourceIdentifier: first.sourceIdentifier }
        : {}),
      sourceName: first.sourceName,
      content: [...(excerptsOf.get(id)?.values() ?? [])],
      ordinal,
      needsReview: flagged.has(id),
      reviewStatus: 'not_reviewed',
    };
  });
  const issues: LedgerExtractionIssue[] = [
    ...attachments.issues.map((i): LedgerExtractionIssue => ({
      code: 'UNRESOLVED_EVIDENCE_ASSIGNMENT',
      severity: 'warning',
      stage: 'assembly',
      message: `${i.unitId}: ${i.reason}`,
    })),
    ...attachments.missingUnitIds.map((id): LedgerExtractionIssue => ({
      code: 'UNRESOLVED_EVIDENCE_ASSIGNMENT',
      severity: 'error',
      stage: 'assembly',
      message: `${id}: unit not attached`,
    })),
  ];
  return {
    ledger: {
      id: options.ledgerId,
      processedDocumentId: options.processedDocumentId,
      revisionKind: 'extraction',
      schemaVersion: ARCHAEOLOGY_LEDGER_VERSION,
      extractorVersion: options.extractorVersion,
      promptVersion: attachments.method,
      validationStatus: 'not_run',
      reviewStatus: 'not_reviewed',
      ...(plan.profile
        ? {
            reportProfile: {
              ...plan.profile,
              ...(plan.thinPolicy ? { thinPolicy: plan.thinPolicy } : {}),
              ...(plan.thinPolicyDecisions
                ? { thinPolicyDecisions: plan.thinPolicyDecisions }
                : {}),
            },
          }
        : {}),
      candidateSnapshotId: plan.candidateSnapshotId,
      extractedAt: options.extractedAt,
      createdAt: options.createdAt,
    },
    records,
    sources,
    attributes: [],
    mediaReferences: [],
    links: [],
    pending: [...ARCHAEOLOGY_LEDGER_PENDING_PARTS],
    reviewItems,
    issues,
  };
}
