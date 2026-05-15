import type { PageReviewContext } from './page-review-context-builder';
import type { ReviewAssistanceWorkItem } from './review-assistance-work-scheduler';

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

  private nearbyTextRefs(
    context: PageReviewContext,
    targetRefs: Set<string>,
  ): Set<string> {
    const directTextRefs = new Set(
      context.textBlocks
        .filter((block) => targetRefs.has(block.ref))
        .map((block) => block.ref),
    );
    return this.expandTextRefsWithNeighbors(context, directTextRefs);
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
