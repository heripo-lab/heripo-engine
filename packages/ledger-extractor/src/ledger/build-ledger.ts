import type { ProcessedDocument } from '@heripo/model';

import type { TableAttributes } from '../attributes/table-attributes';
import type { TextAttributes } from '../attributes/text-attributes';
import type { ContentAttachmentThinResult } from '../content-attachment/thin/assembly';
import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { RecordLinks } from '../links/record-links';
import type { RelationSentences } from '../links/relation-sentences';
import type { CaptionReferences } from '../media/caption-references';
import type { MediaCaptionIndex } from '../media/media-captions';
import type { MediaReferences } from '../media/media-references';
import type { MediaSamePageGroup } from '../media/same-page-candidates';
import type { ReportScopeCompletion } from '../profile/report-scope';
import type { RelationParentJudgment } from '../relations/parent-judgment';
import type { PlaceAliasTable } from '../relations/place-aliases';
import type { RelationParents } from '../relations/relation-parents';
import type { RelationSignals } from '../relations/relation-signals';
import type { ArchaeologyLedgerResult } from './archaeology-ledger';
import type { LedgerValidationReport } from './ledger-validation';

import { collectTableAttributes } from '../attributes/table-attributes';
import { collectTextAttributes } from '../attributes/text-attributes';
import { resolveRecordLinks } from '../links/record-links';
import { collectRelationSentences } from '../links/relation-sentences';
import { collectCaptionReferences } from '../media/caption-references';
import { indexMediaCaptions } from '../media/media-captions';
import { collectMediaReferences } from '../media/media-references';
import { collectSamePageCandidates } from '../media/same-page-candidates';
import {
  placeAliasesSha256,
  validatePlaceAliases,
} from '../relations/place-aliases';
import { resolveRelationParents } from '../relations/relation-parents';
import { collectRelationSignals } from '../relations/relation-signals';
import { buildDocumentResourceIndex } from '../resources/document-resource-index';
import { assembleArchaeologyLedger } from './archaeology-ledger';
import { applyLedgerAttributes } from './ledger-attributes';
import { applyLedgerLinks } from './ledger-links';
import { applyLedgerMedia } from './ledger-media';
import { applyLedgerNameAnchors } from './ledger-name-anchors';
import { sortArchaeologyLedger } from './ledger-order';
import { applyLedgerParents } from './ledger-parents';
import {
  applyLedgerValidation,
  validateArchaeologyLedger,
} from './ledger-validation';

export interface BuildArchaeologyLedgerInput {
  document: ProcessedDocument;
  plan: ContentAttachmentPlan;
  /** The saved thin attachment result of `plan`. */
  attachments: ContentAttachmentThinResult;
  meta: {
    ledgerId: string;
    /** Defaults to the document's `reportId`. */
    processedDocumentId?: string;
    extractorVersion: string;
    extractedAt: string;
    createdAt: string;
  };
  /** A place alias table a person decided; applied only when it validates against the plan and ledger. */
  placeAliases?: unknown;
  /** Saved parent judgment runs; without them parent questions stay as review items. */
  parentJudgments?: RelationParentJudgment[];
  /** How the discovery scope was completed, recorded in the ledger header. */
  discoveryScope?: ReportScopeCompletion;
}
/** Whether the given place alias table was applied. */
export type PlaceAliasOutcome =
  | { status: 'none' }
  | { status: 'applied'; ruleIds: string[]; sha256: string; warnings: string[] }
  /** The table no longer fits the plan or ledger; it is not applied. */
  | { status: 'invalid'; errors: string[] };
export interface BuildArchaeologyLedgerResult {
  result: ArchaeologyLedgerResult;
  validation: LedgerValidationReport;
  placeAliases: PlaceAliasOutcome;
  /** What each step produced, for measurement and debugging. */
  stages: {
    signals: RelationSignals;
    parents: RelationParents;
    captions: MediaCaptionIndex;
    mediaText: MediaReferences;
    mediaCaption: CaptionReferences;
    samePage: MediaSamePageGroup[];
    tableAttributes: TableAttributes;
    textAttributes: TextAttributes;
    relationSentences: RelationSentences;
    recordLinks: RecordLinks;
  };
}

/**
 * Build the archaeology ledger from saved inputs in one call, deterministically and without model calls:
 * assembly from the thin attachment result; the place alias table when it validates; relation signals, code
 * parents and saved judgments; figures and photos; table and text attributes; record links; name anchors where
 * registration evidence misses a record's name; full validation,
 * which decides `validationStatus`; and the spec §23 order. Model steps (candidate discovery, thin attachment,
 * parent judgments) run elsewhere and come in as their saved results, so the same inputs give the same ledger.
 */
export async function buildArchaeologyLedger(
  input: BuildArchaeologyLedgerInput,
): Promise<BuildArchaeologyLedgerResult> {
  const { document, plan, attachments, meta } = input;
  const base = assembleArchaeologyLedger(plan, attachments, {
    ledgerId: meta.ledgerId,
    processedDocumentId: meta.processedDocumentId ?? document.reportId,
    extractorVersion: meta.extractorVersion,
    extractedAt: meta.extractedAt,
    createdAt: meta.createdAt,
  });
  const assembled = input.discoveryScope
    ? {
        ...base,
        ledger: { ...base.ledger, discoveryScope: input.discoveryScope },
      }
    : base;

  let placeAliases: PlaceAliasOutcome = { status: 'none' };
  let aliasOptions = {};
  if (input.placeAliases !== undefined) {
    const { errors, warnings } = validatePlaceAliases(
      plan,
      assembled,
      input.placeAliases,
    );
    if (errors.length) placeAliases = { status: 'invalid', errors };
    else {
      const table = input.placeAliases as PlaceAliasTable;
      const sha256 = await placeAliasesSha256(table);
      aliasOptions = { placeAliases: table, placeAliasesSha256: sha256 };
      placeAliases = {
        status: 'applied',
        ruleIds: table.rules.map((r) => r.id),
        sha256,
        warnings,
      };
    }
  }

  const signals = collectRelationSignals(plan, assembled, aliasOptions);
  const parents = resolveRelationParents(signals, assembled);
  const withParents = applyLedgerParents(
    assembled,
    parents,
    input.parentJudgments ?? [],
  );

  const index = buildDocumentResourceIndex(document);
  const captions = indexMediaCaptions(index);
  const mediaText = collectMediaReferences(captions, withParents);
  const mediaCaption = collectCaptionReferences(
    captions,
    plan,
    withParents,
    mediaText.references,
  );
  const samePage = collectSamePageCandidates(index, withParents);
  const withMedia = applyLedgerMedia(withParents, {
    captions,
    text: mediaText,
    caption: mediaCaption,
    samePage,
  });

  const tableAttributes = collectTableAttributes(index, plan);
  const textAttributes = collectTextAttributes(plan, withMedia);
  const withAttributes = applyLedgerAttributes(withMedia, {
    table: tableAttributes,
    text: textAttributes,
  });

  const relationSentences = collectRelationSentences(
    plan,
    withAttributes,
    tableAttributes,
  );
  const recordLinks = resolveRecordLinks(relationSentences);
  const withLinks = applyLedgerLinks(withAttributes, recordLinks);
  // where names are written when the registration evidence misses them
  const withAnchors = applyLedgerNameAnchors(withLinks, plan, document);

  const validation = validateArchaeologyLedger(withAnchors, {
    document,
    plan,
    attachments,
  });
  const result = sortArchaeologyLedger(
    applyLedgerValidation(withAnchors, validation),
    document,
  );
  return {
    result,
    validation,
    placeAliases,
    stages: {
      signals,
      parents,
      captions,
      mediaText,
      mediaCaption,
      samePage,
      tableAttributes,
      textAttributes,
      relationSentences,
      recordLinks,
    },
  };
}
