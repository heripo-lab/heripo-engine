import type { PageReviewContext } from './page-review-context-builder';
import type { ReviewAssistanceWorkItem } from './review-assistance-work-scheduler';

/**
 * Number of text blocks to include on each side of a non-text target (table,
 * picture) when packing context for `table` and `picture_caption` work items.
 *
 * Plan D.2 requires the packed context to include the text immediately
 * before/after the target so the model can ground captions and continuation
 * candidates. We walk `layout.readingOrderRefs` outward from the target ref
 * and collect up to this many text refs in each direction.
 */
const NEARBY_TEXT_RADIUS = 2;

export class ReviewAssistanceContextPacker {
  pack(
    context: PageReviewContext,
    item: ReviewAssistanceWorkItem,
  ): PageReviewContext {
    const targetRefs = new Set(item.targetRefs);

    switch (item.kind) {
      case 'text_ocr_hanja':
        return this.packTextOcrContext(context, targetRefs);
      case 'text_integrity':
        return this.packTextIntegrityContext(context, targetRefs);
      case 'text_role_footnote':
        return this.packTextRoleContext(context, targetRefs);
      case 'table':
        return this.packTableContext(context, targetRefs);
      case 'picture_caption':
        return this.packPictureCaptionContext(context, targetRefs);
      case 'picture_split':
        return this.packPictureSplitContext(context, targetRefs);
      case 'layout_bbox_order':
        return this.packLayoutContext(context, targetRefs);
    }
    /* v8 ignore next -- the switch is exhaustive for ReviewAssistanceWorkItemKind. */
    return context;
  }

  private packTextOcrContext(
    context: PageReviewContext,
    targetRefs: Set<string>,
  ): PageReviewContext {
    const expandedTextRefs = this.expandTextRefsWithNeighbors(
      context,
      targetRefs,
    );
    return {
      ...this.base(context),
      textBlocks: context.textBlocks.filter((block) =>
        expandedTextRefs.has(block.ref),
      ),
      missingTextCandidates: [],
      tables: [],
      pictures: [],
      orphanCaptions: [],
      footnotes: [],
      layout: this.filterLayout(context, expandedTextRefs),
      domainPatterns: context.domainPatterns.filter((pattern) =>
        expandedTextRefs.has(pattern.targetRef),
      ),
    };
  }

  private packTextIntegrityContext(
    context: PageReviewContext,
    targetRefs: Set<string>,
  ): PageReviewContext {
    const textRefs = this.expandTextRefsWithNeighbors(context, targetRefs);
    const pictureRefs = this.refsFor(context.pictures, targetRefs);
    return {
      ...this.base(context),
      textBlocks: context.textBlocks.filter(
        (block) =>
          textRefs.has(block.ref) ||
          block.suspectReasons.some((reason) =>
            [
              'empty_text',
              'repeated_across_pages',
              'picture_internal_text',
            ].includes(reason),
          ),
      ),
      missingTextCandidates: context.missingTextCandidates,
      tables: [],
      pictures: context.pictures.filter((picture) =>
        pictureRefs.has(picture.ref),
      ),
      orphanCaptions: [],
      footnotes: [],
      layout: this.filterLayout(
        context,
        new Set([...textRefs, ...pictureRefs]),
      ),
      domainPatterns: [],
    };
  }

  private packTextRoleContext(
    context: PageReviewContext,
    targetRefs: Set<string>,
  ): PageReviewContext {
    const textRefs = this.expandTextRefsWithNeighbors(context, targetRefs);
    const tableRefs = this.refsFor(context.tables, targetRefs);
    const pictureRefs = this.refsFor(context.pictures, targetRefs);
    return {
      ...this.base(context),
      textBlocks: context.textBlocks.filter(
        (block) =>
          textRefs.has(block.ref) ||
          block.label === 'caption' ||
          block.label === 'footnote',
      ),
      missingTextCandidates: [],
      tables: context.tables.filter((table) => tableRefs.has(table.ref)),
      pictures: context.pictures.filter((picture) =>
        pictureRefs.has(picture.ref),
      ),
      orphanCaptions: context.orphanCaptions.filter((caption) =>
        targetRefs.has(caption.ref),
      ),
      footnotes: context.footnotes.filter((footnote) =>
        targetRefs.has(footnote.ref),
      ),
      layout: this.filterLayout(
        context,
        new Set([...textRefs, ...tableRefs, ...pictureRefs]),
      ),
      domainPatterns: [],
    };
  }

  private packTableContext(
    context: PageReviewContext,
    targetRefs: Set<string>,
  ): PageReviewContext {
    const tableRefs = this.refsFor(context.tables, targetRefs);
    const nearbyTextRefs = this.nearbyTextRefs(context, targetRefs);
    return {
      ...this.base(context),
      textBlocks: context.textBlocks.filter((block) =>
        nearbyTextRefs.has(block.ref),
      ),
      missingTextCandidates: [],
      tables: context.tables.filter((table) => tableRefs.has(table.ref)),
      pictures: [],
      orphanCaptions: context.orphanCaptions.filter((caption) =>
        caption.nearestMediaRefs.some(
          (media) => media.kind === 'table' && tableRefs.has(media.ref),
        ),
      ),
      footnotes: [],
      layout: this.filterLayout(
        context,
        new Set([...tableRefs, ...nearbyTextRefs]),
      ),
      domainPatterns: [],
    };
  }

  private packPictureCaptionContext(
    context: PageReviewContext,
    targetRefs: Set<string>,
  ): PageReviewContext {
    const pictureRefs = this.refsFor(context.pictures, targetRefs);
    const textRefs = this.nearbyTextRefs(context, targetRefs);
    return {
      ...this.base(context),
      textBlocks: context.textBlocks.filter(
        (block) =>
          textRefs.has(block.ref) ||
          block.label === 'caption' ||
          block.suspectReasons.includes('caption_like_body_text') ||
          block.suspectReasons.includes('picture_internal_text'),
      ),
      missingTextCandidates: [],
      tables: [],
      pictures: context.pictures.filter((picture) =>
        pictureRefs.has(picture.ref),
      ),
      orphanCaptions: context.orphanCaptions.filter((caption) =>
        caption.nearestMediaRefs.some(
          (media) => media.kind === 'picture' && pictureRefs.has(media.ref),
        ),
      ),
      footnotes: [],
      layout: this.filterLayout(
        context,
        new Set([...pictureRefs, ...textRefs]),
      ),
      domainPatterns: [],
    };
  }

  private packPictureSplitContext(
    context: PageReviewContext,
    targetRefs: Set<string>,
  ): PageReviewContext {
    const pictureRefs = this.refsFor(context.pictures, targetRefs);
    return {
      ...this.base(context),
      textBlocks: [],
      missingTextCandidates: [],
      tables: [],
      pictures: context.pictures.filter((picture) =>
        pictureRefs.has(picture.ref),
      ),
      orphanCaptions: [],
      footnotes: [],
      layout: this.filterLayout(context, pictureRefs),
      domainPatterns: [],
    };
  }

  private packLayoutContext(
    context: PageReviewContext,
    targetRefs: Set<string>,
  ): PageReviewContext {
    return {
      ...this.base(context),
      textBlocks: context.textBlocks.filter((block) =>
        targetRefs.has(block.ref),
      ),
      missingTextCandidates: [],
      tables: context.tables.filter((table) => targetRefs.has(table.ref)),
      pictures: context.pictures.filter((picture) =>
        targetRefs.has(picture.ref),
      ),
      orphanCaptions: [],
      footnotes: [],
      layout: this.filterLayout(context, targetRefs),
      domainPatterns: [],
    };
  }

  private base(
    context: PageReviewContext,
  ): Pick<
    PageReviewContext,
    'pageNo' | 'reviewAssistanceEligibility' | 'pageSize' | 'pageImagePath'
  > {
    return {
      pageNo: context.pageNo,
      reviewAssistanceEligibility: context.reviewAssistanceEligibility,
      pageSize: context.pageSize,
      pageImagePath: context.pageImagePath,
    };
  }

  private refsFor<T extends { ref: string }>(
    entries: T[],
    targetRefs: Set<string>,
  ): Set<string> {
    return new Set(
      entries
        .filter((entry) => targetRefs.size === 0 || targetRefs.has(entry.ref))
        .map((entry) => entry.ref),
    );
  }

  /**
   * Collect text refs adjacent to the given non-text target refs.
   *
   * Used for `table` and `picture_caption` work items where `targetRefs`
   * contain table or picture refs that never match a text block's own ref.
   * We walk `layout.readingOrderRefs` outward from each target position and
   * collect up to `NEARBY_TEXT_RADIUS` text refs on each side. Returns an
   * empty set when the reading order does not contain any of the target
   * refs (e.g. reading order is empty or the target was excluded upstream).
   */
  private nearbyTextRefs(
    context: PageReviewContext,
    targetRefs: Set<string>,
  ): Set<string> {
    const textRefSet = new Set(context.textBlocks.map((block) => block.ref));
    const readingOrder = context.layout.readingOrderRefs;
    const nearby = new Set<string>();

    for (let index = 0; index < readingOrder.length; index += 1) {
      if (!targetRefs.has(readingOrder[index])) continue;
      let collectedBefore = 0;
      for (
        let offset = 1;
        offset <= index && collectedBefore < NEARBY_TEXT_RADIUS;
        offset += 1
      ) {
        const candidate = readingOrder[index - offset];
        if (textRefSet.has(candidate)) {
          nearby.add(candidate);
          collectedBefore += 1;
        }
      }
      let collectedAfter = 0;
      for (
        let offset = 1;
        index + offset < readingOrder.length &&
        collectedAfter < NEARBY_TEXT_RADIUS;
        offset += 1
      ) {
        const candidate = readingOrder[index + offset];
        if (textRefSet.has(candidate)) {
          nearby.add(candidate);
          collectedAfter += 1;
        }
      }
    }

    return nearby;
  }

  private expandTextRefsWithNeighbors(
    context: PageReviewContext,
    targetRefs: Set<string>,
  ): Set<string> {
    const refs = new Set(targetRefs);
    for (const block of context.textBlocks) {
      if (!targetRefs.has(block.ref)) continue;
      if (block.previousRef) refs.add(block.previousRef);
      if (block.nextRef) refs.add(block.nextRef);
    }
    return refs;
  }

  private filterLayout(
    context: PageReviewContext,
    targetRefs: Set<string>,
  ): PageReviewContext['layout'] {
    return {
      readingOrderRefs: context.layout.readingOrderRefs.filter((ref) =>
        targetRefs.has(ref),
      ),
      visualOrderRefs: context.layout.visualOrderRefs.filter((ref) =>
        targetRefs.has(ref),
      ),
      bboxWarnings: context.layout.bboxWarnings.filter((warning) =>
        targetRefs.has(warning.targetRef),
      ),
    };
  }
}
