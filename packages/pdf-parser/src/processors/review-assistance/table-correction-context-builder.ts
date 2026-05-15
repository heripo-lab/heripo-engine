import type { DoclingBBox } from '@heripo/model';

import type {
  PageReviewContext,
  PageReviewOrphanCaption,
  PageReviewTable,
  PageReviewTextBlock,
} from './page-review-context-builder';
import type { ReviewAssistanceWorkItem } from './review-assistance-work-scheduler';

const TABLE_NEARBY_TEXT_RADIUS = 3;

export interface TableCorrectionTableIdentity {
  ref: string;
  caption?: string;
  bbox?: DoclingBBox;
  gridPreview: string[][];
  rowCount?: number;
  colCount?: number;
  hasSpans?: boolean;
  headerRows?: number[];
  headerColumns?: number[];
  unitHints?: string[];
  footnoteRefs?: string[];
  footnoteMarkers?: string[];
  emptyCellRatio: number;
  previousPageTableRefs?: string[];
  nextPageTableRefs?: string[];
  suspectReasons: string[];
}

export interface TableCorrectionContext {
  pageNo: number;
  pageSize: PageReviewContext['pageSize'];
  pageImagePath: string;
  targetTable: TableCorrectionTableIdentity;
  tableCountOnPage: number;
  otherTablesOnPage: TableCorrectionTableIdentity[];
  nearbyTextBlocks: PageReviewTextBlock[];
  orphanCaptions: PageReviewOrphanCaption[];
  validationHints: string[];
  scopedPageContext: PageReviewContext;
}

export class TableCorrectionContextBuilder {
  build(context: PageReviewContext): TableCorrectionContext[] {
    return context.tables.map((table) =>
      this.buildForTable(context, table.ref),
    );
  }

  buildForWorkItem(
    context: PageReviewContext,
    workItem: ReviewAssistanceWorkItem,
  ): TableCorrectionContext {
    const tableRef = workItem.targetRefs[0];
    if (!tableRef) {
      throw new Error('table_correction_target_ref_missing');
    }
    return this.buildForTable(context, tableRef);
  }

  buildForTable(
    context: PageReviewContext,
    tableRef: string,
  ): TableCorrectionContext {
    const table = context.tables.find((entry) => entry.ref === tableRef);
    if (!table) {
      throw new Error(`table_correction_target_ref_not_found:${tableRef}`);
    }

    const nearbyTextRefs = this.nearbyTextRefs(context, table.ref);
    const nearbyTextBlocks = context.textBlocks.filter((block) =>
      nearbyTextRefs.has(block.ref),
    );
    const orphanCaptions = context.orphanCaptions.filter((caption) =>
      caption.nearestMediaRefs.some(
        (media) => media.kind === 'table' && media.ref === table.ref,
      ),
    );
    const scopedRefs = new Set([
      table.ref,
      ...nearbyTextBlocks.map((block) => block.ref),
      ...orphanCaptions.map((caption) => caption.ref),
    ]);
    const scopedPageContext: PageReviewContext = {
      ...this.base(context),
      textBlocks: nearbyTextBlocks,
      missingTextCandidates: [],
      tables: [table],
      pictures: [],
      orphanCaptions,
      footnotes: context.footnotes.filter((footnote) =>
        scopedRefs.has(footnote.ref),
      ),
      layout: this.filterLayout(context, scopedRefs),
      domainPatterns: context.domainPatterns.filter((pattern) =>
        scopedRefs.has(pattern.targetRef),
      ),
    };

    return {
      pageNo: context.pageNo,
      pageSize: context.pageSize,
      pageImagePath: context.pageImagePath,
      targetTable: this.toIdentity(table),
      tableCountOnPage: context.tables.length,
      otherTablesOnPage: context.tables
        .filter((entry) => entry.ref !== table.ref)
        .map((entry) => this.toIdentity(entry)),
      nearbyTextBlocks,
      orphanCaptions,
      validationHints: this.buildValidationHints(table, context),
      scopedPageContext,
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

  private toIdentity(table: PageReviewTable): TableCorrectionTableIdentity {
    return {
      ref: table.ref,
      caption: table.caption,
      bbox: table.bbox,
      gridPreview: table.gridPreview,
      rowCount: table.rowCount,
      colCount: table.colCount,
      hasSpans: table.hasSpans,
      headerRows: table.headerRows,
      headerColumns: table.headerColumns,
      unitHints: table.unitHints,
      footnoteRefs: table.footnoteRefs,
      footnoteMarkers: table.footnoteMarkers,
      emptyCellRatio: table.emptyCellRatio,
      previousPageTableRefs: table.previousPageTableRefs,
      nextPageTableRefs: table.nextPageTableRefs,
      suspectReasons: table.suspectReasons,
    };
  }

  private buildValidationHints(
    table: PageReviewTable,
    context: PageReviewContext,
  ): string[] {
    const hints: string[] = [];
    if (context.tables.length > 1) hints.push('multiple_tables_on_page');
    if (!table.bbox) hints.push('target_table_bbox_missing');
    if (table.hasSpans) hints.push('span_cells_present');
    if ((table.headerRows?.length ?? 0) > 0)
      hints.push('column_headers_present');
    if ((table.headerColumns?.length ?? 0) > 0)
      hints.push('row_headers_present');
    if ((table.unitHints?.length ?? 0) > 0) hints.push('unit_hints_present');
    if (
      (table.footnoteRefs?.length ?? 0) > 0 ||
      (table.footnoteMarkers?.length ?? 0) > 0
    ) {
      hints.push('footnote_hints_present');
    }
    if (table.emptyCellRatio >= 0.5) hints.push('many_empty_cells_present');
    if (
      (table.previousPageTableRefs?.length ?? 0) > 0 ||
      (table.nextPageTableRefs?.length ?? 0) > 0
    ) {
      hints.push('continued_table_neighbors_present');
    }
    return hints;
  }

  private nearbyTextRefs(
    context: PageReviewContext,
    tableRef: string,
  ): Set<string> {
    const textRefs = new Set(context.textBlocks.map((block) => block.ref));
    const refs = new Set<string>();
    const index = context.layout.readingOrderRefs.indexOf(tableRef);
    if (index === -1) return refs;

    let before = 0;
    for (
      let offset = 1;
      offset <= index && before < TABLE_NEARBY_TEXT_RADIUS;
      offset += 1
    ) {
      const candidate = context.layout.readingOrderRefs[index - offset];
      if (textRefs.has(candidate)) {
        refs.add(candidate);
        before += 1;
      }
    }

    let after = 0;
    for (
      let offset = 1;
      index + offset < context.layout.readingOrderRefs.length &&
      after < TABLE_NEARBY_TEXT_RADIUS;
      offset += 1
    ) {
      const candidate = context.layout.readingOrderRefs[index + offset];
      if (textRefs.has(candidate)) {
        refs.add(candidate);
        after += 1;
      }
    }

    return refs;
  }

  private filterLayout(
    context: PageReviewContext,
    refs: Set<string>,
  ): PageReviewContext['layout'] {
    return {
      readingOrderRefs: context.layout.readingOrderRefs.filter((ref) =>
        refs.has(ref),
      ),
      visualOrderRefs: context.layout.visualOrderRefs.filter((ref) =>
        refs.has(ref),
      ),
      bboxWarnings: context.layout.bboxWarnings.filter((warning) =>
        refs.has(warning.targetRef),
      ),
    };
  }
}
