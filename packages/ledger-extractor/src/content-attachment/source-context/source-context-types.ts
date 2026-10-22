import type { CandidateEvidence } from '../../candidates/discovery-types';
import type { createContentAttachmentGroundedInput } from '../grounding';
import type { createContentAttachmentRecipientRequest } from '../recipients/request';
import type { ContentAttachmentWordEvidenceSnapshot } from '../recipients/word-evidence';

export const CONTENT_ATTACHMENT_SOURCE_CONTEXT_VERSION =
  'content-source-context.v1' as const;

export interface ContentAttachmentTableContextPair {
  precedingTableKey: string;
  followingTableKey: string;
  /** Native grid cell indexes to expose at the page boundary, never expanded columns. */
  boundaryCellIndexes: number[];
}
export interface ContentAttachmentSourceContextOptions {
  /** Explicit source selection only; supplying a pair does not establish continuation. */
  tablePairs?: ContentAttachmentTableContextPair[];
}
export interface ContentAttachmentSourceContextBinding {
  ref: string;
  resourceKey: string;
  field: 'text' | 'fullText';
  sourceRefs: string[];
  resourceId: string | null;
  pdfPageNo: number | null;
  logicalPageRange: CandidateEvidence['logicalPageRange'];
  charStart: number;
  charEnd: number;
  text: string;
}
export interface SourceView {
  ref: string;
  text: string;
  words: string[][];
  kind: 'body' | 'tableCell' | 'tableCaption';
  contexts: string[];
  pdfPage: number | null;
  blockIndex?: number;
  tableCell?: [string, number, number];
  tableRef?: string;
}
export interface TableView {
  ref: string;
  caption: string | null;
  rows: Array<{
    index: number;
    cells: Array<
      readonly [string | null, string | null, number, number, boolean]
    >;
  }>;
}

export type ContentAttachmentSourceContextRequest = ReturnType<
  typeof createContentAttachmentRecipientRequest
> & {
  contextVersion: typeof CONTENT_ATTACHMENT_SOURCE_CONTEXT_VERSION;
  wordEvidence: ContentAttachmentWordEvidenceSnapshot;
  contextBindings: {
    sources: ContentAttachmentSourceContextBinding[];
    tables: ReturnType<
      typeof createContentAttachmentGroundedInput
    >['codeMap']['tables'];
    headers: Array<{
      tableRef: string;
      resourceKey: string;
      rowIndex: number;
      cellIndex: number;
      text: string;
      rowSpan: number;
      colSpan: number;
      isHeader: boolean;
    }>;
  };
};
