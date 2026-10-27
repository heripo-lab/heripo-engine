import type { ProcessedDocument } from '@heripo/model';

import type { ContentAttachmentThinResult } from '../content-attachment/thin/assembly';
import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { RelationParentJudgment } from '../relations/parent-judgment';

import { beforeEach, describe, expect, test, vi } from 'vitest';

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
import { buildArchaeologyLedger } from './build-ledger';
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

vi.mock('../attributes/table-attributes', () => ({
  collectTableAttributes: vi.fn(() => 'tableAttributes'),
}));
vi.mock('../attributes/text-attributes', () => ({
  collectTextAttributes: vi.fn(() => 'textAttributes'),
}));
vi.mock('../links/record-links', () => ({
  resolveRecordLinks: vi.fn(() => 'recordLinks'),
}));
vi.mock('../links/relation-sentences', () => ({
  collectRelationSentences: vi.fn(() => 'relationSentences'),
}));
vi.mock('../media/caption-references', () => ({
  collectCaptionReferences: vi.fn(() => 'mediaCaption'),
}));
vi.mock('../media/media-captions', () => ({
  indexMediaCaptions: vi.fn(() => 'captions'),
}));
vi.mock('../media/media-references', () => ({
  collectMediaReferences: vi.fn(() => ({ references: 'textReferences' })),
}));
vi.mock('../media/same-page-candidates', () => ({
  collectSamePageCandidates: vi.fn(() => 'samePage'),
}));
vi.mock('../relations/place-aliases', () => ({
  placeAliasesSha256: vi.fn(async () => 'sha'),
  validatePlaceAliases: vi.fn(),
}));
vi.mock('../relations/relation-parents', () => ({
  resolveRelationParents: vi.fn(() => 'parents'),
}));
vi.mock('../relations/relation-signals', () => ({
  collectRelationSignals: vi.fn(() => 'signals'),
}));
vi.mock('../resources/document-resource-index', () => ({
  buildDocumentResourceIndex: vi.fn(() => 'index'),
}));
vi.mock('./archaeology-ledger', () => ({
  assembleArchaeologyLedger: vi.fn(() => 'assembled'),
}));
vi.mock('./ledger-attributes', () => ({
  applyLedgerAttributes: vi.fn(() => 'withAttributes'),
}));
vi.mock('./ledger-links', () => ({
  applyLedgerLinks: vi.fn(() => 'withLinks'),
}));
vi.mock('./ledger-media', () => ({
  applyLedgerMedia: vi.fn(() => 'withMedia'),
}));
vi.mock('./ledger-name-anchors', () => ({
  applyLedgerNameAnchors: vi.fn(() => 'withAnchors'),
}));
vi.mock('./ledger-order', () => ({
  sortArchaeologyLedger: vi.fn(() => 'sorted'),
}));
vi.mock('./ledger-parents', () => ({
  applyLedgerParents: vi.fn(() => 'withParents'),
}));
vi.mock('./ledger-validation', () => ({
  applyLedgerValidation: vi.fn(() => 'validated'),
  validateArchaeologyLedger: vi.fn(() => 'validation'),
}));

const document = { reportId: 'report-1' } as unknown as ProcessedDocument;
const plan = { units: [] } as unknown as ContentAttachmentPlan;
const attachments = {} as ContentAttachmentThinResult;
const meta = {
  ledgerId: 'ledger-1',
  extractorVersion: '0.2.0',
  extractedAt: 't1',
  createdAt: 't2',
};

describe('buildArchaeologyLedger', () => {
  beforeEach(() => {
    vi.mocked(validatePlaceAliases).mockReturnValue({
      errors: [],
      warnings: ['w'],
    });
  });

  test('runs every step in order on the previous result, then validates and sorts', async () => {
    const built = await buildArchaeologyLedger({
      document,
      plan,
      attachments,
      meta,
    });

    expect(assembleArchaeologyLedger).toHaveBeenCalledWith(plan, attachments, {
      ...meta,
      processedDocumentId: 'report-1',
    });
    expect(validatePlaceAliases).not.toHaveBeenCalled();
    expect(collectRelationSignals).toHaveBeenCalledWith(plan, 'assembled', {});
    expect(resolveRelationParents).toHaveBeenCalledWith('signals', 'assembled');
    expect(applyLedgerParents).toHaveBeenCalledWith('assembled', 'parents', []);
    expect(buildDocumentResourceIndex).toHaveBeenCalledWith(document);
    expect(indexMediaCaptions).toHaveBeenCalledWith('index');
    expect(collectMediaReferences).toHaveBeenCalledWith(
      'captions',
      'withParents',
    );
    expect(collectCaptionReferences).toHaveBeenCalledWith(
      'captions',
      plan,
      'withParents',
      'textReferences',
    );
    expect(collectSamePageCandidates).toHaveBeenCalledWith(
      'index',
      'withParents',
    );
    expect(applyLedgerMedia).toHaveBeenCalledWith('withParents', {
      captions: 'captions',
      text: { references: 'textReferences' },
      caption: 'mediaCaption',
      samePage: 'samePage',
    });
    expect(collectTableAttributes).toHaveBeenCalledWith('index', plan);
    expect(collectTextAttributes).toHaveBeenCalledWith(plan, 'withMedia');
    expect(applyLedgerAttributes).toHaveBeenCalledWith('withMedia', {
      table: 'tableAttributes',
      text: 'textAttributes',
    });
    expect(collectRelationSentences).toHaveBeenCalledWith(
      plan,
      'withAttributes',
      'tableAttributes',
    );
    expect(resolveRecordLinks).toHaveBeenCalledWith('relationSentences');
    expect(applyLedgerLinks).toHaveBeenCalledWith(
      'withAttributes',
      'recordLinks',
    );
    expect(applyLedgerNameAnchors).toHaveBeenCalledWith(
      'withLinks',
      plan,
      document,
    );
    expect(validateArchaeologyLedger).toHaveBeenCalledWith('withAnchors', {
      document,
      plan,
      attachments,
    });
    expect(applyLedgerValidation).toHaveBeenCalledWith(
      'withAnchors',
      'validation',
    );
    expect(sortArchaeologyLedger).toHaveBeenCalledWith('validated', document);
    expect(built).toEqual({
      result: 'sorted',
      validation: 'validation',
      placeAliases: { status: 'none' },
      stages: {
        signals: 'signals',
        parents: 'parents',
        captions: 'captions',
        mediaText: { references: 'textReferences' },
        mediaCaption: 'mediaCaption',
        samePage: 'samePage',
        tableAttributes: 'tableAttributes',
        textAttributes: 'textAttributes',
        relationSentences: 'relationSentences',
        recordLinks: 'recordLinks',
      },
    });
  });

  test('applies a valid place alias table and saved judgments', async () => {
    const table = { rules: [{ id: 'rule-1' }] };
    const judgments = [{ recordId: 'r1' }] as RelationParentJudgment[];

    const built = await buildArchaeologyLedger({
      document,
      plan,
      attachments,
      meta: { ...meta, processedDocumentId: 'doc-9' },
      placeAliases: table,
      parentJudgments: judgments,
    });

    expect(assembleArchaeologyLedger).toHaveBeenCalledWith(
      plan,
      attachments,
      expect.objectContaining({ processedDocumentId: 'doc-9' }),
    );
    expect(validatePlaceAliases).toHaveBeenCalledWith(plan, 'assembled', table);
    expect(placeAliasesSha256).toHaveBeenCalledWith(table);
    expect(collectRelationSignals).toHaveBeenCalledWith(plan, 'assembled', {
      placeAliases: table,
      placeAliasesSha256: 'sha',
    });
    expect(applyLedgerParents).toHaveBeenCalledWith(
      'assembled',
      'parents',
      judgments,
    );
    expect(built.placeAliases).toEqual({
      status: 'applied',
      ruleIds: ['rule-1'],
      sha256: 'sha',
      warnings: ['w'],
    });
  });

  test('leaves an invalid place alias table unapplied', async () => {
    vi.mocked(validatePlaceAliases).mockReturnValue({
      errors: ['bad'],
      warnings: [],
    });

    const built = await buildArchaeologyLedger({
      document,
      plan,
      attachments,
      meta,
      placeAliases: { rules: 'nope' },
    });

    expect(placeAliasesSha256).not.toHaveBeenCalled();
    expect(collectRelationSignals).toHaveBeenCalledWith(plan, 'assembled', {});
    expect(built.placeAliases).toEqual({ status: 'invalid', errors: ['bad'] });
  });

  test('records a completed discovery scope in the ledger header', async () => {
    vi.mocked(assembleArchaeologyLedger).mockReturnValueOnce({
      ledger: { id: 'ledger-1' },
    } as never);
    const discoveryScope = { scopeChapterIds: ['ch-1'] } as never;

    await buildArchaeologyLedger({
      document,
      plan,
      attachments,
      meta,
      discoveryScope,
    });

    expect(collectRelationSignals).toHaveBeenCalledWith(
      plan,
      { ledger: { id: 'ledger-1', discoveryScope } },
      {},
    );
  });
});
