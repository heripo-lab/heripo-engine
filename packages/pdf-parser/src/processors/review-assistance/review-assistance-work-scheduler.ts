import type {
  ReviewAssistanceTaskDefinition,
  ReviewAssistanceTaskId,
} from '../../prompts/review-assistance-prompt';
import type { PageReviewContext } from './page-review-context-builder';

import { REVIEW_ASSISTANCE_TASKS } from '../../prompts/review-assistance-prompt';

export type ReviewAssistanceWorkItemKind =
  | 'text_ocr_hanja'
  | 'text_integrity'
  | 'text_role_footnote'
  | 'table'
  | 'picture_caption'
  | 'picture_split'
  | 'layout_bbox_order';

export type ReviewAssistanceWorkItemPriority = 'required' | 'normal' | 'low';

export type ReviewAssistanceContextBudget = 'tiny' | 'small' | 'medium';

export interface ReviewAssistanceWorkItem {
  id: string;
  kind: ReviewAssistanceWorkItemKind;
  pageNo: number;
  targetRefs: string[];
  priority: ReviewAssistanceWorkItemPriority;
  contextBudget: ReviewAssistanceContextBudget;
  eligibility: PageReviewContext['reviewAssistanceEligibility'];
  task: ReviewAssistanceTaskDefinition;
}

const TASK_BY_ID = new Map<
  ReviewAssistanceTaskId,
  ReviewAssistanceTaskDefinition
>(REVIEW_ASSISTANCE_TASKS.map((task) => [task.id, task]));

const KIND_TO_TASK_ID: Record<
  ReviewAssistanceWorkItemKind,
  ReviewAssistanceTaskId
> = {
  text_ocr_hanja: 'text_ocr_hanja',
  text_integrity: 'text_integrity',
  text_role_footnote: 'text_role_footnote',
  table: 'tables',
  picture_caption: 'pictures_captions',
  picture_split: 'pictures_captions',
  layout_bbox_order: 'layout_bbox_order',
};

// `picture_internal_text` is intentionally excluded: text overlays inside a
// picture bbox are treated as part of the opaque image and must not generate
// any review-assistance work. The prompt context builder also strips these
// blocks from the LLM's view so a future regression here cannot leak them.
const TEXT_INTEGRITY_REASONS = new Set(['empty_text', 'repeated_across_pages']);

const TEXT_ROLE_REASONS = new Set([
  'heading_too_long',
  'repeated_across_pages',
  'caption_like_body_text',
  'footnote_like_body_text',
]);

const SEVERE_TABLE_REASONS = new Set(['multi_page_table_candidate']);

export class ReviewAssistanceWorkScheduler {
  build(context: PageReviewContext): ReviewAssistanceWorkItem[] {
    if (!context.reviewAssistanceEligibility.eligible) return [];

    return [
      ...this.buildTextOcrItems(context),
      ...this.buildTextIntegrityItems(context),
      ...this.buildTextRoleItems(context),
      ...this.buildTableItems(context),
      ...this.buildPictureCaptionItems(context),
      ...this.buildPictureSplitItems(context),
      ...this.buildLayoutItems(context),
    ];
  }

  private buildTextOcrItems(
    context: PageReviewContext,
  ): ReviewAssistanceWorkItem[] {
    const targetRefs = context.textBlocks
      .filter(
        (block) =>
          block.suspectReasons.includes('ocr_noise') ||
          block.suspectReasons.includes('hanja_ocr_candidate') ||
          context.domainPatterns.some(
            (pattern) => pattern.targetRef === block.ref,
          ),
      )
      .map((block) => block.ref);

    if (targetRefs.length === 0 && context.textBlocks.length === 0) {
      return [];
    }

    return this.chunkRefs(
      targetRefs.length > 0
        ? targetRefs
        : context.textBlocks.slice(0, 1).map((block) => block.ref),
      4,
    ).map((refs, index) =>
      this.createItem(context, 'text_ocr_hanja', refs, {
        priority: 'required',
        contextBudget: 'tiny',
        suffix: String(index + 1),
      }),
    );
  }

  private buildTextIntegrityItems(
    context: PageReviewContext,
  ): ReviewAssistanceWorkItem[] {
    const textRefs = context.textBlocks
      .filter((block) =>
        block.suspectReasons.some((reason) =>
          TEXT_INTEGRITY_REASONS.has(reason),
        ),
      )
      .map((block) => block.ref);
    const targetRefs = this.unique([
      ...textRefs,
      ...context.pictures.map((picture) => picture.ref),
    ]);

    if (targetRefs.length === 0 && context.missingTextCandidates.length === 0) {
      return [];
    }

    return [
      this.createItem(context, 'text_integrity', targetRefs, {
        priority: 'normal',
        contextBudget: 'small',
      }),
    ];
  }

  private buildTextRoleItems(
    context: PageReviewContext,
  ): ReviewAssistanceWorkItem[] {
    const textRefs = context.textBlocks
      .filter(
        (block) =>
          block.label === 'caption' ||
          block.label === 'footnote' ||
          block.suspectReasons.some((reason) => TEXT_ROLE_REASONS.has(reason)),
      )
      .map((block) => block.ref);
    const targetRefs = this.unique([
      ...textRefs,
      ...context.orphanCaptions.map((caption) => caption.ref),
      ...context.footnotes.map((footnote) => footnote.ref),
      ...context.tables.map((table) => table.ref),
      ...context.pictures.map((picture) => picture.ref),
    ]);

    if (targetRefs.length === 0) return [];

    return [
      this.createItem(context, 'text_role_footnote', targetRefs, {
        priority: 'normal',
        contextBudget: 'small',
      }),
    ];
  }

  private buildTableItems(
    context: PageReviewContext,
  ): ReviewAssistanceWorkItem[] {
    return context.tables.map((table) =>
      this.createItem(context, 'table', [table.ref], {
        priority: this.priorityForTableReasons(table.suspectReasons),
        contextBudget: 'small',
      }),
    );
  }

  private buildPictureCaptionItems(
    context: PageReviewContext,
  ): ReviewAssistanceWorkItem[] {
    return context.pictures.map((picture) =>
      this.createItem(
        context,
        'picture_caption',
        this.unique([
          picture.ref,
          ...context.orphanCaptions
            .filter((caption) =>
              caption.nearestMediaRefs.some(
                (media) =>
                  media.kind === 'picture' && media.ref === picture.ref,
              ),
            )
            .map((caption) => caption.ref),
        ]),
        {
          priority: 'normal',
          contextBudget: 'small',
        },
      ),
    );
  }

  private buildPictureSplitItems(
    context: PageReviewContext,
  ): ReviewAssistanceWorkItem[] {
    return context.pictures
      .filter((picture) => picture.splitCandidate)
      .map((picture) =>
        this.createItem(context, 'picture_split', [picture.ref], {
          priority: 'required',
          contextBudget: 'tiny',
        }),
      );
  }

  private buildLayoutItems(
    context: PageReviewContext,
  ): ReviewAssistanceWorkItem[] {
    const visualOrderChanged =
      context.layout.readingOrderRefs.join('\u0000') !==
      context.layout.visualOrderRefs.join('\u0000');
    if (!visualOrderChanged && context.layout.bboxWarnings.length === 0) {
      return [];
    }

    return [
      this.createItem(
        context,
        'layout_bbox_order',
        this.unique([
          ...context.layout.readingOrderRefs,
          ...context.layout.visualOrderRefs,
          ...context.layout.bboxWarnings.map((warning) => warning.targetRef),
        ]),
        {
          priority: 'low',
          contextBudget: 'medium',
        },
      ),
    ];
  }

  private createItem(
    context: PageReviewContext,
    kind: ReviewAssistanceWorkItemKind,
    targetRefs: string[],
    options: {
      priority: ReviewAssistanceWorkItemPriority;
      contextBudget: ReviewAssistanceContextBudget;
      suffix?: string;
    },
  ): ReviewAssistanceWorkItem {
    const task = TASK_BY_ID.get(KIND_TO_TASK_ID[kind]);
    /* v8 ignore next -- every work item kind is mapped to a task id above. */
    if (!task) {
      throw new Error(`No review assistance task definition for ${kind}`);
    }
    const uniqueTargetRefs = this.unique(targetRefs);
    return {
      id: this.buildId(context.pageNo, kind, uniqueTargetRefs, options.suffix),
      kind,
      pageNo: context.pageNo,
      targetRefs: uniqueTargetRefs,
      priority: options.priority,
      contextBudget: options.contextBudget,
      eligibility: context.reviewAssistanceEligibility,
      task,
    };
  }

  private buildId(
    pageNo: number,
    kind: ReviewAssistanceWorkItemKind,
    targetRefs: string[],
    suffix?: string,
  ): string {
    const targetPart =
      targetRefs.length > 0
        ? targetRefs.map((ref) => ref.replaceAll(/[^\w-]+/g, '_')).join('-')
        : 'page';
    return this.compactId(
      [`page-${pageNo}`, kind, targetPart, suffix].filter(Boolean).join(':'),
    );
  }

  private compactId(value: string): string {
    return value.length <= 180
      ? value
      : `${value.slice(0, 160)}-${value.length}`;
  }

  private chunkRefs(refs: string[], size: number): string[][] {
    const chunks: string[][] = [];
    for (let index = 0; index < refs.length; index += size) {
      chunks.push(refs.slice(index, index + size));
    }
    return chunks;
  }

  private unique(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
  }

  /**
   * Tables surfaced as `multi_page_table_candidate` are escalated to
   * `required` priority because continuation links are easy to lose during
   * structural review. Other suspect reasons (e.g. `table_missing_caption`,
   * `table_many_empty_cells`) are informational and stay at `normal`.
   *
   * Previous behavior used `reason.includes('table')` which matched every
   * suspect reason starting with `table_` and silently promoted nearly every
   * table to `required`.
   */
  private priorityForTableReasons(
    reasons: string[],
  ): ReviewAssistanceWorkItemPriority {
    return reasons.some((reason) => SEVERE_TABLE_REASONS.has(reason))
      ? 'required'
      : 'normal';
  }
}
