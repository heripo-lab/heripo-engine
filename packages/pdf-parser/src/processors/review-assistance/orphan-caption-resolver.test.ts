import type { DoclingBBox } from '@heripo/model';

import type { PageReviewContext } from './page-review-context-builder';

import { describe, expect, test } from 'vitest';

import { OrphanCaptionResolver } from './orphan-caption-resolver';

const pictureBbox: DoclingBBox = {
  l: 10,
  t: 10,
  r: 90,
  b: 50,
  coord_origin: 'TOPLEFT',
};

const captionBbox: DoclingBBox = {
  l: 15,
  t: 52,
  r: 80,
  b: 62,
  coord_origin: 'TOPLEFT',
};

function makeContext(
  overrides: Partial<PageReviewContext> = {},
): PageReviewContext {
  return {
    pageNo: 1,
    pageSize: { width: 100, height: 100 },
    pageImagePath: '/tmp/page.png',
    textBlocks: [],
    missingTextCandidates: [],
    tables: [],
    pictures: [],
    orphanCaptions: [
      {
        ref: '#/texts/1',
        text: 'Figure 1. Site',
        bbox: captionBbox,
        currentLabel: 'caption',
        captionLikeBodyText: false,
        nearestMediaRefs: [
          {
            ref: '#/pictures/0',
            kind: 'picture',
            distance: 0.1,
          },
        ],
      },
      {
        ref: '#/texts/2',
        text: 'Photo 2',
        bbox: captionBbox,
        currentLabel: 'text',
        captionLikeBodyText: true,
        nearestMediaRefs: [
          {
            ref: '#/pictures/0',
            kind: 'picture',
            distance: 0.2,
          },
        ],
      },
    ],
    footnotes: [],
    layout: {
      readingOrderRefs: [],
      visualOrderRefs: [],
      bboxWarnings: [],
    },
    domainPatterns: [],
    ...overrides,
  };
}

describe('OrphanCaptionResolver', () => {
  test('links the nearest caption-looking text once per target set', () => {
    const resolutions = new OrphanCaptionResolver().resolve(makeContext(), [
      { ref: '#/pictures/0', kind: 'picture', bbox: pictureBbox },
      { ref: '#/pictures/1', kind: 'picture', bbox: pictureBbox },
    ]);

    expect(resolutions[0]).toEqual({
      targetRef: '#/pictures/0',
      captionRef: '#/texts/1',
      text: 'Figure 1. Site',
      confidence: 1,
      reasons: ['orphan_caption_linked'],
    });
    expect(resolutions[1]).toMatchObject({
      targetRef: '#/pictures/1',
      captionRef: '#/texts/2',
      reasons: ['caption_like_body_text_linked'],
    });
  });

  test('uses bbox distance and bottom-left coordinates when nearest refs are absent', () => {
    const bottomLeftPicture: DoclingBBox = {
      l: 10,
      t: 90,
      r: 90,
      b: 50,
      coord_origin: 'BOTTOMLEFT',
    };
    const bottomLeftCaption: DoclingBBox = {
      l: 15,
      t: 48,
      r: 80,
      b: 38,
      coord_origin: 'BOTTOMLEFT',
    };
    const resolutions = new OrphanCaptionResolver().resolve(
      makeContext({
        orphanCaptions: [
          {
            ref: '#/texts/3',
            text: '사진 2',
            bbox: bottomLeftCaption,
            currentLabel: 'text',
            captionLikeBodyText: true,
            nearestMediaRefs: [],
          },
        ],
      }),
      [{ ref: '#/pictures/2', kind: 'picture', bbox: bottomLeftPicture }],
    );

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toMatchObject({
      targetRef: '#/pictures/2',
      captionRef: '#/texts/3',
      reasons: ['caption_like_body_text_linked'],
    });
    expect(resolutions[0].confidence).toBeGreaterThan(0.8);
  });

  test('skips existing captions, non-caption text, and unmeasurable candidates', () => {
    const resolver = new OrphanCaptionResolver();

    expect(
      resolver.resolve(makeContext(), [
        {
          ref: '#/pictures/0',
          kind: 'picture',
          bbox: pictureBbox,
          caption: 'Already linked',
        },
      ]),
    ).toEqual([]);

    expect(
      resolver.resolve(makeContext({ pageSize: null }), [
        { ref: '#/pictures/1', kind: 'picture' },
      ]),
    ).toEqual([]);
  });

  test('scores non-caption private candidates without pattern or label bonuses', () => {
    const resolver = new OrphanCaptionResolver() as unknown as {
      scoreCandidate: (
        context: PageReviewContext,
        target: { ref: string; kind: 'picture'; bbox?: DoclingBBox },
        caption: PageReviewContext['orphanCaptions'][number],
      ) => number;
    };

    expect(
      resolver.scoreCandidate(
        makeContext(),
        { ref: '#/pictures/0', kind: 'picture', bbox: pictureBbox },
        {
          ref: '#/texts/9',
          text: 'plain paragraph',
          bbox: captionBbox,
          currentLabel: 'text',
          captionLikeBodyText: false,
          nearestMediaRefs: [
            {
              ref: '#/pictures/0',
              kind: 'picture',
              distance: 0.1,
            },
          ],
        },
      ),
    ).toBe(0.75);
  });
});
