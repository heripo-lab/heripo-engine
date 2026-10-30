import type { CaptionReferences } from '../media/caption-references';
import type { MediaCaptionIndex } from '../media/media-captions';
import type { MediaReferences } from '../media/media-references';
import type { DocumentResourceIndex } from '../resources/document-resource-index';
import type { ArchaeologyLedgerResult } from './archaeology-ledger';

import { describe, expect, test } from 'vitest';

import { collectSamePageCandidates } from '../media/same-page-candidates';
import { applyLedgerMedia } from './ledger-media';

const ledger = (issues: unknown[] = []): ArchaeologyLedgerResult =>
  ({
    ledger: { id: 'ledger-1', validationStatus: 'passed' },
    records: [
      { id: 'r1', sourceName: '1호 수혈', sourceIdentifier: '1호' },
      { id: 'r2', sourceName: '수혈', sourceIdentifier: '2' },
      { id: 'r3', sourceName: '기대' },
    ].map((r, ordinal) => ({ ...r, ordinal, needsReview: false })),
    sources: [
      { recordId: 'r2', pdfPageNo: 9 },
      { recordId: 'r1', pdfPageNo: 9 },
      { recordId: 'r1', pdfPageNo: 3 },
      { recordId: 'r3', pdfPageNo: null },
    ],
    mediaReferences: [],
    mediaCandidates: [],
    pending: ['attributes', 'media_references', 'links'],
    reviewItems: [{ id: 'review-1', kind: 'identity' }],
    issues,
  }) as unknown as ArchaeologyLedgerResult;
const captions = {
  entries: ['1', '2', '3'].map((n) => ({
    imageId: `img-${n}`,
    label: `사진 ${n}`,
    type: '사진',
    number: n,
    captionText: `사진 ${n} 캡션`,
  })),
} as unknown as MediaCaptionIndex;
const text = {
  references: [
    {
      recordId: 'r1',
      imageId: 'img-1',
      label: '사진 1',
      written: '사진 1~2',
      sourceId: 's1',
      locator: '/l/1',
      basis: 'text_reference',
    },
    {
      recordId: 'r1',
      imageId: 'img-2',
      label: '사진 2',
      written: '사진 1~2',
      sourceId: 's1',
      locator: '/l/1',
      basis: 'text_reference',
    },
  ],
  missing: [
    {
      recordId: 'r2',
      label: '사진 9',
      written: '사진 9',
      sourceId: 's2',
      locator: '/l/2',
      imageIds: [],
    },
  ],
  ambiguous: [
    {
      recordId: 'r3',
      label: '사진 5',
      written: '(사진 5)',
      sourceId: 's3',
      locator: '/l/3',
      imageIds: ['img-5a', 'img-5b'],
    },
  ],
} as unknown as MediaReferences;
const caption = {
  references: [
    {
      recordId: 'r1',
      imageId: 'img-1',
      label: '사진 1',
      written: '1호수혈',
      basis: 'caption_name',
    },
    {
      recordId: 'r2',
      imageId: 'img-3',
      label: '사진 3',
      written: '2~3호수혈',
      basis: 'caption_range',
    },
  ],
  severalNamed: [{ imageId: 'img-2', recordIds: ['r1', 'r2'] }],
  unresolvedRangeNumbers: [{ imageId: 'img-3', name: '4호 수혈' }],
  artifactNumberChecks: [
    {
      imageId: 'img-1',
      label: '사진 1',
      captionNumbers: ['1', '2'],
      agreeing: ['r1'],
      disagreeing: ['r3'],
    },
  ],
} as unknown as CaptionReferences;

describe('collectSamePageCandidates', () => {
  test('groups uncaptioned images with the records described on their page', () => {
    const index = {
      resources: [
        { kind: 'text', pdfPageNo: 9, data: { text: '' } },
        { kind: 'image', pdfPageNo: 9, data: { id: 'img-a' } },
        { kind: 'image', pdfPageNo: 9, data: { id: 'img-b' } },
        {
          kind: 'image',
          pdfPageNo: 9,
          data: { id: 'img-c', caption: { fullText: '사진 1' } },
        },
        { kind: 'image', pdfPageNo: 4, data: { id: 'img-d' } },
        { kind: 'image', pdfPageNo: 3, data: { id: 'img-e' } },
        { kind: 'image', pdfPageNo: null, data: { id: 'img-f' } },
      ],
    } as unknown as DocumentResourceIndex;

    expect(collectSamePageCandidates(index, ledger())).toEqual([
      { pdfPageNo: 3, imageIds: ['img-e'], recordIds: ['r1'] },
      { pdfPageNo: 9, imageIds: ['img-a', 'img-b'], recordIds: ['r1', 'r2'] },
    ]);
  });
});

describe('applyLedgerMedia', () => {
  test('links records to images once with all evidence, keeps same-page images as candidates and adds media review items and issues', () => {
    const result = applyLedgerMedia(ledger(), {
      captions,
      text,
      caption,
      samePage: [
        { pdfPageNo: 9, imageIds: ['img-a'], recordIds: ['r1', 'r2'] },
      ],
    });

    expect(result.mediaReferences).toEqual([
      {
        id: 'media-1',
        ledgerId: 'ledger-1',
        recordId: 'r1',
        imageId: 'img-1',
        ordinal: 0,
        referenceLabel: '사진 1',
        captionText: '사진 1 캡션',
        captionProperties: { mediaType: '사진', sequenceNo: '1' },
        basis: 'text_reference',
        evidence: [
          {
            kind: 'excerpt',
            text: '사진 1~2',
            sourceId: 's1',
            locator: '/l/1',
          },
          { kind: 'caption', text: '사진 1 캡션' },
        ],
        needsReview: false,
      },
      expect.objectContaining({
        id: 'media-2',
        recordId: 'r1',
        imageId: 'img-2',
        ordinal: 1,
      }),
      expect.objectContaining({
        id: 'media-3',
        recordId: 'r2',
        ordinal: 0,
        basis: 'caption_range',
      }),
    ]);
    expect(result.reviewItems.slice(1)).toEqual([
      {
        id: 'review-2',
        kind: 'media',
        recordIds: ['r3'],
        confirmedRecordIds: [],
        reasons: ['media_ambiguous'],
        imageIds: ['img-5a', 'img-5b'],
        text: '(사진 5)',
        locator: '/l/3',
        detail: '사진 5',
      },
      {
        id: 'review-3',
        kind: 'media',
        recordIds: ['r1', 'r2'],
        confirmedRecordIds: [],
        reasons: ['media_caption_several'],
        imageIds: ['img-2'],
        text: '사진 2 캡션',
      },
    ]);
    expect(result.mediaCandidates).toEqual([
      {
        id: 'media-candidate-1',
        ledgerId: 'ledger-1',
        pdfPageNo: 9,
        imageIds: ['img-a'],
        recordIds: ['r1', 'r2'],
        basis: 'same_page',
      },
    ]);
    expect(result.records.map((r) => r.needsReview)).toEqual([
      false,
      false,
      true,
    ]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'REFERENCE_LABEL_MISMATCH',
        severity: 'warning',
        stage: 'media',
        message: '2 수혈 cites 사진 9, which no captioned image has',
        recordId: 'r2',
      }),
      expect.objectContaining({
        code: 'MEDIA_MATCH_AMBIGUOUS',
        severity: 'warning',
        stage: 'media',
        message: '사진 3 names 4호 수혈, which matches no single record',
        imageId: 'img-3',
      }),
      expect.objectContaining({
        code: 'REFERENCE_LABEL_MISMATCH',
        severity: 'warning',
        stage: 'media',
        message: '사진 1 lists 1,2 but not 기대',
        recordId: 'r3',
        imageId: 'img-1',
      }),
    ]);
    expect(result.ledger.validationStatus).toBe('passed');
    expect(result.pending).toEqual(['attributes', 'links']);
  });

  test('works with text references only and keeps an earlier warning', () => {
    const clean = {
      references: text.references,
      missing: [],
      ambiguous: [],
    } as unknown as MediaReferences;

    const passed = applyLedgerMedia(ledger(), { captions, text: clean });
    const warned = applyLedgerMedia(ledger(['earlier']), {
      captions,
      text: clean,
    });

    expect(passed.mediaReferences).toHaveLength(2);
    expect(passed.reviewItems).toHaveLength(1);
    expect(passed.mediaCandidates).toEqual([]);
    expect(passed.issues).toEqual([]);
    expect(warned.issues).toEqual(['earlier']);
  });
});
