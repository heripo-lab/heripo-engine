import type { DoclingBBox } from '@heripo/model';

/**
 * Shared bbox geometry helpers for review assistance.
 *
 * Docling bboxes use either `TOPLEFT` or `BOTTOMLEFT` coordinate origins.
 * These helpers normalize bboxes to a top-left rectangle so different
 * processors (detector, context builder, validator) can compute geometry
 * the same way. When page size is unknown, the fallback height is the
 * larger of `bbox.t` and `bbox.b`, which preserves the bbox shape even if
 * the absolute page position is approximate. For comparisons across multiple
 * bboxes on the same page, pass shared options from `bboxGeometryOptionsForPage`
 * so all BOTTOMLEFT bboxes are flipped against the same approximate height.
 */

export interface TopLeftRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type PageSize = { width: number; height: number } | null;

export interface BboxGeometryOptions {
  fallbackPageHeight?: number;
}

export function bboxGeometryOptionsForPage(
  bboxes: Iterable<DoclingBBox | null | undefined>,
  pageSize: PageSize,
): BboxGeometryOptions {
  if (pageSize) return {};

  let fallbackPageHeight: number | undefined;
  for (const bbox of bboxes) {
    if (!bbox) continue;
    const maxY = Math.max(bbox.t, bbox.b);
    if (!Number.isFinite(maxY)) continue;
    fallbackPageHeight =
      fallbackPageHeight === undefined
        ? maxY
        : Math.max(fallbackPageHeight, maxY);
  }

  return fallbackPageHeight === undefined ? {} : { fallbackPageHeight };
}

export function bboxToTopLeftRect(
  bbox: DoclingBBox,
  pageSize: PageSize,
  options: BboxGeometryOptions = {},
): TopLeftRect {
  const left = Math.min(bbox.l, bbox.r);
  const right = Math.max(bbox.l, bbox.r);
  if (bbox.coord_origin === 'BOTTOMLEFT') {
    const pageHeight =
      pageSize?.height ??
      options.fallbackPageHeight ??
      Math.max(bbox.t, bbox.b);
    return {
      left,
      right,
      top: pageHeight - Math.max(bbox.t, bbox.b),
      bottom: pageHeight - Math.min(bbox.t, bbox.b),
    };
  }
  return {
    left,
    right,
    top: Math.min(bbox.t, bbox.b),
    bottom: Math.max(bbox.t, bbox.b),
  };
}

export function topLeftRectToBbox(
  rect: TopLeftRect,
  original: DoclingBBox,
  pageSize: PageSize,
  options: BboxGeometryOptions = {},
): DoclingBBox {
  if (original.coord_origin === 'BOTTOMLEFT') {
    const pageHeight =
      pageSize?.height ??
      options.fallbackPageHeight ??
      Math.max(original.t, original.b);
    return {
      l: rect.left,
      r: rect.right,
      t: pageHeight - rect.top,
      b: pageHeight - rect.bottom,
      coord_origin: 'BOTTOMLEFT',
    };
  }
  return {
    l: rect.left,
    t: rect.top,
    r: rect.right,
    b: rect.bottom,
    coord_origin: original.coord_origin || 'TOPLEFT',
  };
}

export function rectArea(rect: TopLeftRect): number {
  return (
    Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top)
  );
}

export function rectIntersectionArea(a: TopLeftRect, b: TopLeftRect): number {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

export function bboxContainmentRatio(
  inner: DoclingBBox,
  outer: DoclingBBox,
  pageSize: PageSize,
): number {
  const options = bboxGeometryOptionsForPage([inner, outer], pageSize);
  const innerRect = bboxToTopLeftRect(inner, pageSize, options);
  const outerRect = bboxToTopLeftRect(outer, pageSize, options);
  const innerArea = rectArea(innerRect);
  if (innerArea === 0) return 0;
  return rectIntersectionArea(innerRect, outerRect) / innerArea;
}
