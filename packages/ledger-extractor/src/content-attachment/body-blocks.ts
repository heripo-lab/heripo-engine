import type { AttachmentUnit, ContentAttachmentPlan } from './types';

import { createContentAttachmentContextInput } from './context';

/** Preserve original selectable body boundaries without repeating text or resolving subjects. */
export function createContentAttachmentBodyBlockInput(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
) {
  const base = createContentAttachmentContextInput(plan, unit);
  const bindings = unit.sources
    .filter((source) => source.resource.kind === 'text')
    .flatMap((source) => {
      const excerpts = base.codeMap.excerpts
        .filter((e) =>
          e.evidence.some((f) => f.resourceKey === source.resource.key),
        )
        .map((e) => e.ref);
      return excerpts.length
        ? [
            {
              sourceId: source.sourceId,
              resourceKey: source.resource.key,
              excerpts,
            },
          ]
        : [];
    })
    .map((block, i) => ({ ref: `P${i + 1}`, ...block }));
  return {
    payload: {
      ...base.payload,
      current: {
        ...base.payload.current,
        bodyBlockColumns: ['ref', 'excerpts'],
        bodyBlocks: bindings.map((b) => [b.ref, b.excerpts] as const),
      },
    },
    codeMap: { ...base.codeMap, bodyBlocks: bindings },
  };
}
