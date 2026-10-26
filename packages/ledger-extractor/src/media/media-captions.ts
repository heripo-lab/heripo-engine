import type { DocumentResourceIndex } from '../resources/document-resource-index';

export const MEDIA_CAPTION_INDEX_VERSION = 'media-caption-index.v1' as const;

/**
 * Figure and photo labels as reports write them, longest first so `도판` is not read as `도`. They are matched
 * only when no Hangul letter precedes them, so `마도23-1` is not figure `도 23-1`.
 */
export const MEDIA_LABEL_TYPES = [
  '원색도판',
  '흑백도판',
  '도판',
  '도면',
  '사진',
  '삽도',
  '그림',
  '도',
] as const;
const TYPES = MEDIA_LABEL_TYPES.join('|');
const CAPTION_LABEL = new RegExp(`^(${TYPES})\\s*(\\d+(?:-\\d+)?)(?![\\d-])`);

export interface MediaCaptionEntry {
  imageId: string;
  /** Processed-document resource key of the image. */
  resourceKey: string;
  /** `<type> <number>`, such as `사진 45` or `도 12-1`. */
  label: string;
  type: string;
  number: string;
  /** The caption exactly as preprocessed. */
  captionText: string;
  chapterIds: string[];
  pdfPageNo: number | null;
}
export interface MediaCaptionIndex {
  version: typeof MEDIA_CAPTION_INDEX_VERSION;
  entries: MediaCaptionEntry[];
  /** Image IDs by label; a label with several images is ambiguous. */
  byLabel: Record<string, string[]>;
  /** Images with a caption whose number is not a known figure or photo label. */
  unparsedImageIds: string[];
  /** Images without a caption. */
  uncaptionedImageIds: string[];
}

/** `<type> <number>` with the number as written. */
export const mediaLabel = (type: string, number: string) => `${type} ${number}`;

/**
 * Index the processed document's image captions by figure or photo label (M0), deterministically and without
 * model calls. A caption's `num` (`도면 1`, `원색도판 3`, `사진 12-1`) gives the label; the caption text is kept
 * unchanged. Images without a caption or with a number that is not such a label are listed apart.
 */
export function indexMediaCaptions(
  index: DocumentResourceIndex,
): MediaCaptionIndex {
  const entries: MediaCaptionEntry[] = [];
  const byLabel: Record<string, string[]> = {};
  const unparsedImageIds: string[] = [];
  const uncaptionedImageIds: string[] = [];
  for (const r of index.resources) {
    if (r.kind !== 'image') continue;
    const caption = r.data.caption;
    if (!caption) {
      uncaptionedImageIds.push(r.data.id);
      continue;
    }
    const m = (caption.num ?? '').trim().match(CAPTION_LABEL);
    if (!m) {
      unparsedImageIds.push(r.data.id);
      continue;
    }
    const label = mediaLabel(m[1], m[2]);
    entries.push({
      imageId: r.data.id,
      resourceKey: r.key,
      label,
      type: m[1],
      number: m[2],
      captionText: caption.fullText,
      chapterIds: r.chapterIds,
      pdfPageNo: r.pdfPageNo,
    });
    (byLabel[label] ??= []).push(r.data.id);
  }
  return {
    version: MEDIA_CAPTION_INDEX_VERSION,
    entries,
    byLabel,
    unparsedImageIds,
    uncaptionedImageIds,
  };
}
