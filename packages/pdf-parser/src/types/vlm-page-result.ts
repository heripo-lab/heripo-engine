/**
 * Intermediate format produced by VLM page-by-page processing.
 * Intentionally kept simple so VLM prompts stay short and accurate.
 * The DoclingDocumentAssembler converts these into a full DoclingDocument.
 */

/** Allowed element types matching DoclingDocument text labels */
export type VlmElementType =
  | 'text'
  | 'section_header'
  | 'caption'
  | 'footnote'
  | 'page_header'
  | 'page_footer'
  | 'list_item'
  | 'picture'
  | 'table';

/**
 * Normalized bounding box with coordinates in the range 0.0 to 1.0,
 * using top-left origin (standard image coordinates).
 */
export interface VlmBBox {
  /** Left edge (0.0 = left boundary) */
  l: number;
  /** Top edge (0.0 = top boundary) */
  t: number;
  /** Right edge (1.0 = right boundary) */
  r: number;
  /** Bottom edge (1.0 = bottom boundary) */
  b: number;
}

/** A single content element detected on a page by VLM */
export interface VlmPageElement {
  /** Element type */
  type: VlmElementType;

  /** Text content (empty string for picture elements) */
  content: string;

  /** Heading depth for section_header (1 = top-level) */
  level?: number;

  /** List marker for list_item (e.g., "1)", "a.", "\u2022") */
  marker?: string;

  /** Reading order within the page (top-to-bottom, left-to-right) */
  order: number;

  /**
   * Bounding box in normalized coordinates (0.0-1.0, top-left origin).
   * - Text elements: optional (included in prov if present)
   * - Picture elements: **required** (used for image cropping)
   */
  bbox?: VlmBBox;
}

/** VLM output for a single page */
export interface VlmPageResult {
  /** 1-based page number */
  pageNo: number;

  /** All content elements detected on this page */
  elements: VlmPageElement[];
}
