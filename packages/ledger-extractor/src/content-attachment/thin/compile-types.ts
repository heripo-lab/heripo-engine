import type { createContentAttachmentGroundedInput } from '../grounding';
import type { AttachmentRegistryEntry } from '../types';
import type { ContentAttachmentThinRowBinding } from './row-owners';

export const CONTENT_ATTACHMENT_THIN_COMPILE_VERSION =
  'content-attachment-thin-compile.v1' as const;
/**
 * Compilation under the plan's `local` layer policy, where a single-unit layer is offered only in its unit and
 * in the units next to it that share its evidence chapter.
 */
export const CONTENT_ATTACHMENT_THIN_LOCAL_COMPILE_VERSION =
  'content-attachment-thin-compile.v3' as const;
/**
 * Compilation under the plan's `linked` continuity policy: the read-only blocks before a unit's first body
 * block join its reading order and list the offered candidates whose evidence they are. v4 with `all` layers.
 */
export const CONTENT_ATTACHMENT_THIN_LINKED_COMPILE_VERSION =
  'content-attachment-thin-compile.v4' as const;
/** `linked` continuity together with the `local` layer policy. */
export const CONTENT_ATTACHMENT_THIN_LOCAL_LINKED_COMPILE_VERSION =
  'content-attachment-thin-compile.v5' as const;

/** Maximum original words addressed by one Q window. */
export const CONTENT_ATTACHMENT_THIN_WINDOW_WORDS = 16;
/** A chapter whose title core appears in the unit contributes all its candidates up to this size. */
export const CONTENT_ATTACHMENT_THIN_CHAPTER_MEMBER_LIMIT = 30;

/** Kinds that are document-wide referents and are always offered (layers: see the plan's layer policy). */
export const ALWAYS_OFFERED_KINDS = new Set<
  AttachmentRegistryEntry['recordKind']
>(['area', 'trench', 'layer']);

export type Words = string[];
export type WindowRow = [string, Words];
export type CandidateRow = ReturnType<
  typeof createContentAttachmentGroundedInput
>['payload']['candidates'][number];

export interface ContentAttachmentThinWindow {
  ref: string;
  sourceRef: string;
  originalWords: string[];
}
export interface ContentAttachmentThinSegmentSpan {
  seg: string;
  key: string;
  charStart: number;
  charEnd: number;
  llm: boolean;
  owner?: string | null;
  /** Table cells only: the row owner followed by candidates registered from the cell. */
  codeTargets?: string[];
}
export interface ContentAttachmentThinHandle {
  ref: string;
  path: string[];
  kind: AttachmentRegistryEntry['recordKind'];
  members: string[];
}
export interface ContentAttachmentThinCell {
  ref: string;
  header: boolean;
  windows: WindowRow[];
  rowOwner?: string;
  registeredInCell?: string[];
  segments?: Array<[string, string[]]>;
}
export interface ContentAttachmentThinInput {
  candidateColumns: string[];
  contexts: Record<string, string[]>;
  candidates: CandidateRow[];
  uncertainties: Array<{ refs: string[]; reason: string }>;
  handleColumns: ['ref', 'chapterPath', 'kind', 'memberCount'];
  handles: Array<[string, string, string, number]>;
  chapters: string[];
  bodyBlocks: Array<{
    ref: string;
    windows: WindowRow[];
    segments: Array<[string, string[]]>;
  }>;
  bodySequences: string[][];
  tableLocations: Array<{
    ref: string;
    pdfPage: number;
    rowCount: number;
    captionRef: string | null;
  }>;
  tables: Array<{
    ref: string;
    rows: Array<{ index: number; cells: ContentAttachmentThinCell[] }>;
  }>;
  readOnlyContext: Array<{
    ref: string;
    windows: WindowRow[];
    /** Linked continuity only: offered candidates whose evidence this preceding block is. */
    evidenceOf?: string[];
  }>;
}
export interface ContentAttachmentThinCodeMap {
  unitId: string;
  /** Segments the model must judge, in input order. */
  segments: string[];
  /** Candidate refs offered to the model after prefiltering. */
  candidateRefs: string[];
  windows: ContentAttachmentThinWindow[];
  /** [segment, row owner, ...candidates registered from the cell] */
  codeAssigned: Array<[string, ...string[]]>;
  /** Under `trivial: 'code'`: segments decided by code as describing no candidate, never asked of the model. */
  codeNone?: string[];
  segSpans: ContentAttachmentThinSegmentSpan[];
  rowBindings: ContentAttachmentThinRowBinding[];
  handles: Array<{ ref: string; members: string[] }>;
}
export interface ContentAttachmentThinCompilation {
  version:
    | typeof CONTENT_ATTACHMENT_THIN_COMPILE_VERSION
    | typeof CONTENT_ATTACHMENT_THIN_LOCAL_COMPILE_VERSION
    | typeof CONTENT_ATTACHMENT_THIN_LINKED_COMPILE_VERSION
    | typeof CONTENT_ATTACHMENT_THIN_LOCAL_LINKED_COMPILE_VERSION;
  input: ContentAttachmentThinInput;
  codeMap: ContentAttachmentThinCodeMap;
}
