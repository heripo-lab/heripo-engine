import type { DoclingBBox } from './docling-document';

export type ReviewAssistanceReportSchemaName = 'HeripoReviewAssistanceReport';

export type ReviewAssistanceReportVersion = '1.0';

export type ReviewAssistanceDisposition =
  | 'auto_applied'
  | 'proposal'
  | 'skipped';

export type ReviewAssistanceFailurePolicy = 'partial_page';

export type ReviewAssistancePageStatus = 'succeeded' | 'failed';

export type ReviewAssistanceIssueCategory =
  | 'text'
  | 'table'
  | 'caption'
  | 'picture'
  | 'reading_order'
  | 'role'
  | 'text_integrity'
  | 'paragraph'
  | 'footnote'
  | 'bbox'
  | 'multi_page_table'
  | 'domain_pattern'
  | 'review_execution';

export type ReviewAssistanceIssueSeverity = 'info' | 'warning' | 'error';

export type ReviewAssistanceProgressSubstage =
  | 'review-assistance:prepare'
  | 'review-assistance:page'
  | 'review-assistance:patch'
  | 'review-assistance:write-report';

export type ReviewAssistanceProgressStatus =
  | 'started'
  | 'progress'
  | 'completed'
  | 'failed';

export interface ReviewAssistanceTableCell {
  text: string;
  bbox?: DoclingBBox;
  rowSpan?: number;
  colSpan?: number;
  columnHeader?: boolean;
  rowHeader?: boolean;
}

export interface ReviewAssistanceImageRegion {
  id?: string;
  bbox: DoclingBBox;
  imageUri?: string;
  caption?: string;
}

export type ReviewAssistanceCommand =
  | { op: 'replaceText'; textRef: string; text: string }
  | {
      op: 'addText';
      pageNo: number;
      bbox: DoclingBBox;
      text: string;
      label: string;
      afterRef?: string;
    }
  | { op: 'updateTextRole'; textRef: string; label: string }
  | { op: 'removeText'; textRef: string }
  | {
      op: 'mergeTexts';
      textRefs: string[];
      text: string;
      keepRef: string;
    }
  | {
      op: 'splitText';
      textRef: string;
      parts: Array<{ text: string; label?: string }>;
    }
  | {
      op: 'updateTableCell';
      tableRef: string;
      row: number;
      col: number;
      text: string;
    }
  | {
      op: 'replaceTable';
      tableRef: string;
      grid: ReviewAssistanceTableCell[][];
      caption?: string;
    }
  | {
      op: 'linkContinuedTable';
      sourceTableRef: string;
      continuedTableRef: string;
      relation: 'continues_on_next_page' | 'continued_from_previous_page';
    }
  | { op: 'updatePictureCaption'; pictureRef: string; caption: string }
  | {
      op: 'addPicture';
      pageNo: number;
      bbox: DoclingBBox;
      imageUri: string;
      caption?: string;
    }
  | {
      op: 'splitPicture';
      pictureRef: string;
      regions: ReviewAssistanceImageRegion[];
    }
  | { op: 'hidePicture'; pictureRef: string; reason: string }
  | { op: 'updateBbox'; targetRef: string; bbox: DoclingBBox }
  | { op: 'linkFootnote'; markerTextRef: string; footnoteTextRef: string }
  | {
      op: 'moveNode';
      sourceRef: string;
      targetRef: string;
      position: 'before' | 'after';
    };

export interface ReviewAssistanceDecisionEvidence {
  imageEvidence?: string;
  textLayerEvidence?: string;
  suspectReasons?: string[];
  previousBbox?: DoclingBBox;
  snappedBbox?: DoclingBBox;
  generatedRefs?: string[];
}

export interface ReviewAssistanceDecision {
  id: string;
  pageNo: number;
  /** Present only when validation produced a normalized command. */
  command?: ReviewAssistanceCommand;
  /** Original op when validation rejected the payload before normalization. */
  invalidOp?: string;
  confidence: number;
  disposition: ReviewAssistanceDisposition;
  reasons: string[];
  evidence?: ReviewAssistanceDecisionEvidence;
  metadata?: Record<string, unknown>;
}

export interface ReviewAssistanceIssue {
  id: string;
  pageNo: number;
  category: ReviewAssistanceIssueCategory;
  type: string;
  severity: ReviewAssistanceIssueSeverity;
  description: string;
  confidence?: number;
  refs?: string[];
  bbox?: DoclingBBox;
  reasons?: string[];
}

export interface ReviewAssistancePageResult {
  pageNo: number;
  status: ReviewAssistancePageStatus;
  decisions: ReviewAssistanceDecision[];
  issues: ReviewAssistanceIssue[];
  error?: {
    message: string;
    code?: string;
  };
}

export interface ReviewAssistanceReport {
  schemaName: ReviewAssistanceReportSchemaName;
  version: ReviewAssistanceReportVersion;
  reportId: string;
  source: {
    doclingResult: 'result.json';
    ocrOriginSnapshot?: 'result_ocr_origin.json';
    originSnapshot?: 'result_review_origin.json';
  };
  options: {
    enabled: true;
    concurrency: number;
    autoApplyThreshold: number;
    proposalThreshold: number;
    maxRetries: number;
    temperature: number;
    failurePolicy: ReviewAssistanceFailurePolicy;
  };
  summary: {
    pageCount: number;
    pagesSucceeded: number;
    pagesFailed: number;
    autoAppliedCount: number;
    proposalCount: number;
    skippedCount: number;
    issueCount: number;
    layoutIssueCount?: number;
    textIntegrityIssueCount?: number;
  };
  pages: ReviewAssistancePageResult[];
}

export interface ReviewAssistanceProgressEvent {
  substage: ReviewAssistanceProgressSubstage;
  status: ReviewAssistanceProgressStatus;
  reportId: string;
  pageNo?: number;
  pageCount?: number;
  completedPages?: number;
  failedPages?: number;
  commandCount?: number;
  autoAppliedCount?: number;
  proposalCount?: number;
  message?: string;
}
