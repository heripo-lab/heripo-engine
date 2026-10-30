import type { ArchaeologyLedgerResult } from '../ledger/archaeology-ledger';
import type { DocumentResourceIndex } from '../resources/document-resource-index';

import { describe, expect, test } from 'vitest';

import {
  MEDIA_CAPTION_INDEX_VERSION,
  indexMediaCaptions,
  mediaLabel,
} from './media-captions';
import {
  MEDIA_REFERENCES_VERSION,
  collectMediaReferences,
} from './media-references';

const image = (id: string, caption?: { num?: string; fullText: string }) => ({
  kind: 'image',
  key: `/images/${id}`,
  chapterIds: ['ch-1'],
  pdfPageNo: 7,
  data: { id, ...(caption ? { caption } : {}) },
});
const index = {
  resources: [
    { kind: 'text', key: '/t/0', data: { text: '도면 1' } },
    image('img-1', { num: '도면 1', fullText: '도면 1 유적 위치도' }),
    image('img-45', { num: '사진 45', fullText: '사진 45 1호 수혈' }),
    image('img-46', { num: '사진 46', fullText: '사진 46' }),
    image('img-47', { num: '사진 47', fullText: '사진 47' }),
    image('img-12a', { num: ' 도 12-1 ', fullText: '도 12-1 청자' }),
    image('img-90a', { num: '사진 90', fullText: '사진 90 전경' }),
    image('img-90b', { num: '사진 90', fullText: '사진 90 근경' }),
    image('img-x', { num: '표 3', fullText: '표 3 일지' }),
    image('img-y', { fullText: '번호 없는 캡션' }),
    image('img-z'),
  ],
} as unknown as DocumentResourceIndex;

describe('indexMediaCaptions', () => {
  test('indexes captions by figure or photo label and lists the rest', () => {
    const captions = indexMediaCaptions(index);

    expect(captions.version).toBe(MEDIA_CAPTION_INDEX_VERSION);
    expect(captions.entries[0]).toEqual({
      imageId: 'img-1',
      resourceKey: '/images/img-1',
      label: '도면 1',
      type: '도면',
      number: '1',
      captionText: '도면 1 유적 위치도',
      chapterIds: ['ch-1'],
      pdfPageNo: 7,
    });
    expect(captions.byLabel['도 12-1']).toEqual(['img-12a']);
    expect(captions.byLabel['사진 90']).toEqual(['img-90a', 'img-90b']);
    expect(captions.unparsedImageIds).toEqual(['img-x', 'img-y']);
    expect(captions.uncaptionedImageIds).toEqual(['img-z']);
    expect(mediaLabel('사진', '3')).toBe('사진 3');
  });
});

describe('collectMediaReferences', () => {
  test('links expanded labels to single images and reports missing and shared labels', () => {
    const source = (id: string, recordId: string, excerpt: string) => ({
      id,
      recordId,
      excerpt,
      locator: `/loc/${id}`,
      pdfPageNo: 3,
    });
    const ledger = {
      sources: [
        source('s1', 'r1', '(1) 1호 수혈 (도면 1, 사진 45~47)'),
        source('s2', 'r1', '도면 1 참조, 사진 46·47'),
        source('s3', 'r2', '사진 90, 도면 2, 도 12-1, 사진 1~200, 사진 9~5'),
        source('s4', 'r3', '마도23-1 청자발 (도 12-1)'),
      ],
    } as unknown as ArchaeologyLedgerResult;

    const result = collectMediaReferences(indexMediaCaptions(index), ledger);

    expect(result.version).toBe(MEDIA_REFERENCES_VERSION);
    expect(
      result.references.map((r) => [r.recordId, r.label, r.imageId]),
    ).toEqual([
      ['r1', '도면 1', 'img-1'],
      ['r1', '사진 45', 'img-45'],
      ['r1', '사진 46', 'img-46'],
      ['r1', '사진 47', 'img-47'],
      ['r2', '도 12-1', 'img-12a'],
      ['r3', '도 12-1', 'img-12a'],
    ]);
    expect(result.references[1]).toEqual({
      recordId: 'r1',
      imageId: 'img-45',
      label: '사진 45',
      written: '사진 45~47',
      sourceId: 's1',
      locator: '/loc/s1',
      pdfPageNo: 3,
      basis: 'text_reference',
    });
    expect(result.ambiguous).toEqual([
      {
        recordId: 'r2',
        label: '사진 90',
        written: '사진 90',
        sourceId: 's3',
        locator: '/loc/s3',
        imageIds: ['img-90a', 'img-90b'],
      },
    ]);
    expect(result.missing.map((p) => p.label)).toEqual([
      '도면 2',
      '사진 1',
      '사진 200',
      '사진 9',
      '사진 5',
    ]);
  });
});
