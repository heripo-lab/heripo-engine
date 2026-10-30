import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { ArchaeologyLedgerResult } from '../ledger/archaeology-ledger';
import type { MediaCaptionIndex } from './media-captions';
import type { MediaTextReference } from './media-references';

import { describe, expect, test } from 'vitest';

import {
  CAPTION_REFERENCES_VERSION,
  collectCaptionReferences,
} from './caption-references';

const 삼국 = [
  { id: 'ch-a', originTitle: 'A. 삼국시대' },
  { id: 'ch-a1', originTitle: '6) 수혈' },
];
const 조선 = [
  { id: 'ch-b', originTitle: 'B. 조선시대' },
  { id: 'ch-b1', originTitle: '4) 수혈' },
];
const entry = (
  groupId: string,
  recordKind: string,
  sourceName: string,
  sourceIdentifier: string | null,
  chapterPath: Array<{ id: string; originTitle: string }>,
) => ({
  ref: groupId,
  groupId,
  recordKind,
  mentions: [{ sourceName, sourceIdentifier, chapterPath, evidence: [] }],
});
const plan = {
  registry: [
    entry('P1s', 'feature', '수혈', '1호', 삼국),
    entry('P1j', 'feature', '수혈', '1', 조선),
    entry('P2s', 'feature', '수혈', '2호', 삼국),
    entry('P2j', 'feature', '수혈', '2호', 조선),
    entry('P3a', 'feature', '수혈', '3호', 삼국),
    entry('P3b', 'feature', '수혈', '3호', [
      삼국[0],
      { id: 'ch-a2', originTitle: '수혈' },
    ]),
    entry('P4a', 'feature', '수혈', '4호', [
      삼국[0],
      { id: 'ch-a3', originTitle: '수혈' },
    ]),
    entry('P4b', 'feature', '수혈', '4호', [
      삼국[0],
      { id: 'ch-a4', originTitle: '수혈' },
    ]),
    entry('P5x', 'feature', '수혈', '5', 삼국),
    entry('P5y', 'feature', '수혈', '5호', 삼국),
    entry('H1', 'feature', '건물지', '1호', [
      조선[0],
      { id: 'ch-b2', originTitle: '1) 건물지' },
    ]),
    entry('G', 'feature', '도로유구', null, 삼국),
    entry('A24', 'artifact', '기대', '24', 삼국),
    entry('A25', 'artifact', '뚜껑', '25', 삼국),
    entry('A99', 'artifact', '접시', '99', 삼국),
    entry('X', 'artifact', 'AB', null, [{ id: 'ch-z', originTitle: '1)' }]),
  ],
} as unknown as ContentAttachmentPlan;
const ledger = {
  records: plan.registry.map((e) => ({
    id: `record-${e.groupId}`,
    recordKind: e.recordKind,
    sourceName: e.mentions[0].sourceName,
    ...(e.mentions[0].sourceIdentifier
      ? { sourceIdentifier: e.mentions[0].sourceIdentifier }
      : {}),
  })),
} as unknown as ArchaeologyLedgerResult;
const image = (label: string, caption: string, chapterIds = ['ch-x']) => {
  const [type, number] = label.split(' ');
  return {
    imageId: `img-${number}`,
    resourceKey: `/images/${number}`,
    label,
    type,
    number,
    captionText: caption,
    chapterIds,
    pdfPageNo: 1,
  };
};
const captions = {
  entries: [
    image('도면 1', '도면 1 삼국시대 1호 수혈 평면도'),
    image('도면 2', '도면 2 조선시대 1호 수혈'),
    image('사진 3', '사진 3 조선시대 1~5호 수혈'),
    image('사진 4', '사진 4 삼국시대 3~5호 수혈', ['ch-a1']),
    image('사진 5', '사진 5 1호 건물지 및 2호 수혈'),
    image('사진 6', '사진 6 출토유물(24~25) 및 (26-28, 30)'),
    image('도면 7', '도면 7 9~5호 수혈, 1~99호 수혈, 3~4호 전경'),
    image('도면 8', '도면 8 1~2호 건물지와 주변 구상유구'),
    image('도면 9', '도면 9 조선시대 1호 수혈 및 1~2호 수혈평면도'),
    image('도면 10', '도면 10 유적 위치도'),
  ],
  byLabel: {},
  unparsedImageIds: [],
  uncaptionedImageIds: [],
} as unknown as MediaCaptionIndex;
const textRef = (recordId: string, imageId: string) =>
  ({ recordId, imageId }) as MediaTextReference;

describe('collectCaptionReferences', () => {
  test('links numbered names and series within the caption section and checks artifact numbers', () => {
    const result = collectCaptionReferences(captions, plan, ledger, [
      textRef('record-A24', 'img-6'),
      textRef('record-A25', 'img-6'),
      textRef('record-A99', 'img-6'),
      textRef('record-X', 'img-6'),
      textRef('record-P1s', 'img-6'),
      textRef('record-A24', 'img-10'),
    ]);
    const links = result.references.map((r) => [
      r.label,
      r.recordId.replace('record-', ''),
      r.basis,
    ]);

    expect(result.version).toBe(CAPTION_REFERENCES_VERSION);
    expect(links).toEqual([
      ['도면 1', 'P1s', 'caption_name'],
      ['도면 2', 'P1j', 'caption_name'],
      ['사진 3', 'P1j', 'caption_range'],
      ['사진 3', 'P2j', 'caption_range'],
      ['사진 4', 'P3a', 'caption_range'],
      ['사진 4', 'P5y', 'caption_range'],
      ['도면 8', 'H1', 'caption_range'],
      ['도면 9', 'P1j', 'caption_range'],
      ['도면 9', 'P2j', 'caption_range'],
    ]);
    expect(result.references[0]).toEqual({
      recordId: 'record-P1s',
      imageId: 'img-1',
      label: '도면 1',
      written: '1호수혈',
      basis: 'caption_name',
    });
    expect(result.references[2].written).toBe('1~5호수혈');
    expect(result.severalNamed).toEqual([
      {
        imageId: 'img-5',
        recordIds: ['record-P2s', 'record-P2j', 'record-H1'],
      },
    ]);
    expect(result.unresolvedRangeNumbers.map((u) => u.name)).toEqual([
      '3호 수혈',
      '4호 수혈',
      '5호 수혈',
      '4호 수혈',
      '3호 전경',
      '4호 전경',
      '2호 건물지',
    ]);
    expect(result.artifactNumberChecks).toEqual([
      {
        imageId: 'img-6',
        label: '사진 6',
        captionNumbers: ['24', '25', '26', '27', '28', '30'],
        agreeing: ['record-A24', 'record-A25'],
        disagreeing: ['record-A99', 'record-X'],
      },
    ]);
  });

  test('works without text references', () => {
    expect(
      collectCaptionReferences(captions, plan, ledger).artifactNumberChecks,
    ).toEqual([]);
  });
});
