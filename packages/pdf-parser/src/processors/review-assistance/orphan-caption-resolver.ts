import type { DoclingBBox } from '@heripo/model';

import type {
  PageReviewContext,
  PageReviewOrphanCaption,
} from './page-review-context-builder';

export interface CaptionResolutionTarget {
  ref: string;
  kind: 'picture' | 'table';
  bbox?: DoclingBBox;
  caption?: string;
}

export interface OrphanCaptionResolution {
  targetRef: string;
  captionRef: string;
  text: string;
  confidence: number;
  reasons: string[];
}

const CAPTION_PATTERN =
  /^(?:fig(?:ure)?\.?|photo|plate|drawing|table|도면|사진|그림|삽도|표)\s*[\dⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ-]*[.)．:]?/iu;

export class OrphanCaptionResolver {
  resolve(
    context: PageReviewContext,
    targets: CaptionResolutionTarget[],
  ): OrphanCaptionResolution[] {
    const usedCaptionRefs = new Set<string>();
    const resolutions: OrphanCaptionResolution[] = [];

    for (const target of targets) {
      if (target.caption?.trim()) continue;
      const candidate = this.findCandidate(context, target, usedCaptionRefs);
      if (!candidate) continue;

      usedCaptionRefs.add(candidate.ref);
      resolutions.push({
        targetRef: target.ref,
        captionRef: candidate.ref,
        text: candidate.text,
        confidence: this.scoreCandidate(context, target, candidate),
        reasons: [
          candidate.captionLikeBodyText
            ? 'caption_like_body_text_linked'
            : 'orphan_caption_linked',
        ],
      });
    }

    return resolutions;
  }

  private findCandidate(
    context: PageReviewContext,
    target: CaptionResolutionTarget,
    usedCaptionRefs: Set<string>,
  ): PageReviewOrphanCaption | undefined {
    return context.orphanCaptions
      .filter((caption) => !usedCaptionRefs.has(caption.ref))
      .filter((caption) => this.looksLikeCaption(caption.text))
      .map((caption) => ({
        caption,
        distance:
          caption.nearestMediaRefs.find((entry) => entry.ref === target.ref)
            ?.distance ??
          this.bboxDistance(caption.bbox, target.bbox, context.pageSize),
      }))
      .sort((a, b) => a.distance - b.distance)
      .find(({ distance }) => distance < 0.35)?.caption;
  }

  private scoreCandidate(
    context: PageReviewContext,
    target: CaptionResolutionTarget,
    caption: PageReviewOrphanCaption,
  ): number {
    const distance =
      caption.nearestMediaRefs.find((entry) => entry.ref === target.ref)
        ?.distance ??
      this.bboxDistance(caption.bbox, target.bbox, context.pageSize);
    const proximityScore = Math.max(0, 1 - distance * 2);
    const labelScore = caption.currentLabel === 'caption' ? 0.15 : 0;
    const patternScore = this.looksLikeCaption(caption.text) ? 0.15 : 0;
    return Math.min(
      1,
      0.55 + proximityScore * 0.25 + labelScore + patternScore,
    );
  }

  private looksLikeCaption(text: string): boolean {
    return CAPTION_PATTERN.test(text.trim());
  }

  private bboxDistance(
    a: DoclingBBox | undefined,
    b: DoclingBBox | undefined,
    pageSize: { width: number; height: number } | null,
  ): number {
    if (!a || !b || !pageSize) return Number.POSITIVE_INFINITY;
    const centerA = this.bboxCenter(a, pageSize);
    const centerB = this.bboxCenter(b, pageSize);
    const dx = (centerA.x - centerB.x) / pageSize.width;
    const dy = (centerA.y - centerB.y) / pageSize.height;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private bboxCenter(
    bbox: DoclingBBox,
    pageSize: { width: number; height: number },
  ): { x: number; y: number } {
    const x = (Math.min(bbox.l, bbox.r) + Math.max(bbox.l, bbox.r)) / 2;
    if (bbox.coord_origin === 'BOTTOMLEFT') {
      const top = pageSize.height - Math.max(bbox.t, bbox.b);
      const bottom = pageSize.height - Math.min(bbox.t, bbox.b);
      return { x, y: (top + bottom) / 2 };
    }
    return {
      x,
      y: (Math.min(bbox.t, bbox.b) + Math.max(bbox.t, bbox.b)) / 2,
    };
  }
}
