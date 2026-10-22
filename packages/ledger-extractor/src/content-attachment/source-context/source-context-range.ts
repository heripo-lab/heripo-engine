import type { ContentAttachmentSourceContextRequest } from './source-context-types';

import { resolveContentAttachmentWordRange } from '../recipients/word-evidence';

/** Resolve against the separate context snapshot, retaining exact original field and offsets. */
export function resolveContentAttachmentSourceContextRange(
  request: ContentAttachmentSourceContextRequest,
  range: string,
  currentExcerptRef: string,
) {
  const resolved = resolveContentAttachmentWordRange(
    request.wordEvidence,
    range,
    currentExcerptRef,
  );
  const binding = request.contextBindings.sources.find(
    (s) => s.ref === resolved.sourceRef,
  );
  if (
    !binding ||
    binding.resourceKey !== resolved.resourceKey ||
    binding.text.slice(resolved.charStart, resolved.charEnd) !== resolved.text
  )
    throw new Error('Context word range differs from original binding');
  return {
    ...resolved,
    field: binding.field,
    charStart: binding.charStart + resolved.charStart,
    charEnd: binding.charStart + resolved.charEnd,
  };
}
