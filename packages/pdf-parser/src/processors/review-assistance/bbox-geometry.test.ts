import type { DoclingBBox } from '@heripo/model';

import { describe, expect, test } from 'vitest';

import {
  bboxContainmentRatio,
  bboxGeometryOptionsForPage,
  bboxToTopLeftRect,
  rectArea,
  rectIntersectionArea,
  topLeftRectToBbox,
} from './bbox-geometry';

const topLeftBbox: DoclingBBox = {
  l: 10,
  t: 20,
  r: 30,
  b: 50,
  coord_origin: 'TOPLEFT',
};

const bottomLeftBbox: DoclingBBox = {
  l: 0,
  t: 90,
  r: 20,
  b: 10,
  coord_origin: 'BOTTOMLEFT',
};

describe('bbox-geometry', () => {
  test('converts TOPLEFT bbox to a top-left rect verbatim', () => {
    expect(bboxToTopLeftRect(topLeftBbox, null)).toEqual({
      left: 10,
      top: 20,
      right: 30,
      bottom: 50,
    });
  });

  test('flips BOTTOMLEFT bbox using the page height', () => {
    expect(
      bboxToTopLeftRect(bottomLeftBbox, { width: 100, height: 100 }),
    ).toEqual({
      left: 0,
      top: 10,
      right: 20,
      bottom: 90,
    });
  });

  test('falls back to max(bbox.t, bbox.b) when page size is missing', () => {
    expect(bboxToTopLeftRect(bottomLeftBbox, null)).toEqual({
      left: 0,
      top: 0,
      right: 20,
      bottom: 80,
    });
  });

  test('uses shared fallback height when provided for BOTTOMLEFT conversion', () => {
    expect(
      bboxToTopLeftRect(bottomLeftBbox, null, { fallbackPageHeight: 200 }),
    ).toEqual({
      left: 0,
      top: 110,
      right: 20,
      bottom: 190,
    });
    expect(
      topLeftRectToBbox(
        { left: 0, top: 110, right: 20, bottom: 190 },
        bottomLeftBbox,
        null,
        { fallbackPageHeight: 200 },
      ),
    ).toMatchObject({
      l: 0,
      r: 20,
      t: 90,
      b: 10,
      coord_origin: 'BOTTOMLEFT',
    });
  });

  test('builds shared page geometry options only when page size is missing', () => {
    const tallerBbox: DoclingBBox = {
      l: 0,
      t: 130,
      r: 20,
      b: 120,
      coord_origin: 'BOTTOMLEFT',
    };
    const invalidBbox: DoclingBBox = {
      l: 0,
      t: Number.NaN,
      r: 20,
      b: Number.NaN,
      coord_origin: 'BOTTOMLEFT',
    };

    expect(
      bboxGeometryOptionsForPage(
        [undefined, bottomLeftBbox, null, tallerBbox],
        null,
      ),
    ).toEqual({ fallbackPageHeight: 130 });
    expect(
      bboxGeometryOptionsForPage([bottomLeftBbox], {
        width: 100,
        height: 100,
      }),
    ).toEqual({});
    expect(bboxGeometryOptionsForPage([undefined, invalidBbox], null)).toEqual(
      {},
    );
  });

  test('round-trips bbox through top-left rect for both coord origins', () => {
    const pageSize = { width: 100, height: 100 };
    expect(
      topLeftRectToBbox(
        bboxToTopLeftRect(topLeftBbox, pageSize),
        topLeftBbox,
        pageSize,
      ),
    ).toMatchObject({
      l: 10,
      t: 20,
      r: 30,
      b: 50,
      coord_origin: 'TOPLEFT',
    });
    expect(
      topLeftRectToBbox(
        bboxToTopLeftRect(bottomLeftBbox, pageSize),
        bottomLeftBbox,
        pageSize,
      ),
    ).toMatchObject({
      l: 0,
      t: 90,
      r: 20,
      b: 10,
      coord_origin: 'BOTTOMLEFT',
    });
  });

  test('defaults coord_origin to TOPLEFT when missing on conversion back', () => {
    const result = topLeftRectToBbox(
      { left: 0, top: 0, right: 10, bottom: 10 },
      { l: 0, t: 0, r: 10, b: 10 } as DoclingBBox,
      null,
    );
    expect(result.coord_origin).toBe('TOPLEFT');
  });

  test('uses max(original.t, original.b) when converting BOTTOMLEFT back without page size', () => {
    const result = topLeftRectToBbox(
      { left: 0, top: 10, right: 20, bottom: 80 },
      bottomLeftBbox,
      null,
    );
    expect(result).toMatchObject({
      l: 0,
      r: 20,
      t: 80,
      b: 10,
      coord_origin: 'BOTTOMLEFT',
    });
  });

  test('computes rect area and intersection', () => {
    expect(rectArea({ left: 0, top: 0, right: 10, bottom: 5 })).toBe(50);
    expect(rectArea({ left: 5, top: 5, right: 1, bottom: 1 })).toBe(0);
    expect(
      rectIntersectionArea(
        { left: 0, top: 0, right: 10, bottom: 10 },
        { left: 5, top: 5, right: 15, bottom: 15 },
      ),
    ).toBe(25);
    expect(
      rectIntersectionArea(
        { left: 0, top: 0, right: 10, bottom: 10 },
        { left: 20, top: 20, right: 30, bottom: 30 },
      ),
    ).toBe(0);
  });

  test('computes bbox containment ratio with zero-area guard', () => {
    const pageSize = { width: 100, height: 100 };
    const inner: DoclingBBox = {
      l: 5,
      t: 5,
      r: 15,
      b: 15,
      coord_origin: 'TOPLEFT',
    };
    const outer: DoclingBBox = {
      l: 0,
      t: 0,
      r: 20,
      b: 20,
      coord_origin: 'TOPLEFT',
    };
    expect(bboxContainmentRatio(inner, outer, pageSize)).toBeCloseTo(1);

    const partial: DoclingBBox = {
      l: 10,
      t: 10,
      r: 30,
      b: 30,
      coord_origin: 'TOPLEFT',
    };
    expect(bboxContainmentRatio(partial, outer, pageSize)).toBeCloseTo(0.25);

    const zeroArea: DoclingBBox = {
      l: 10,
      t: 10,
      r: 10,
      b: 10,
      coord_origin: 'TOPLEFT',
    };
    expect(bboxContainmentRatio(zeroArea, outer, pageSize)).toBe(0);
  });

  test('uses one inferred fallback height for containment without page size', () => {
    const outer: DoclingBBox = {
      l: 0,
      t: 200,
      r: 100,
      b: 100,
      coord_origin: 'BOTTOMLEFT',
    };
    const belowOuter: DoclingBBox = {
      l: 10,
      t: 90,
      r: 20,
      b: 80,
      coord_origin: 'BOTTOMLEFT',
    };
    const insideOuter: DoclingBBox = {
      l: 10,
      t: 180,
      r: 20,
      b: 160,
      coord_origin: 'BOTTOMLEFT',
    };

    expect(bboxContainmentRatio(belowOuter, outer, null)).toBe(0);
    expect(bboxContainmentRatio(insideOuter, outer, null)).toBe(1);
  });
});
