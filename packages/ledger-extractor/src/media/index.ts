export {
  MEDIA_CAPTION_INDEX_VERSION,
  MEDIA_LABEL_TYPES,
  indexMediaCaptions,
  mediaLabel,
} from './media-captions';
export type { MediaCaptionEntry, MediaCaptionIndex } from './media-captions';
export {
  MEDIA_REFERENCES_VERSION,
  collectMediaReferences,
} from './media-references';
export type {
  MediaReferenceProblem,
  MediaReferences,
  MediaTextReference,
} from './media-references';
export {
  CAPTION_REFERENCES_VERSION,
  collectCaptionReferences,
} from './caption-references';
export type {
  CaptionReferences,
  MediaArtifactNumberCheck,
  MediaCaptionReference,
} from './caption-references';
export { collectSamePageCandidates } from './same-page-candidates';
export type { MediaSamePageGroup } from './same-page-candidates';
