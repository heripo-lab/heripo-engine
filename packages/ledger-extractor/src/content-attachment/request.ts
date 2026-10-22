import type { ContentAttachmentPromptVersion } from './prompts';
import type { AttachmentUnit, ContentAttachmentPlan } from './types';

import { createContentAttachmentBodyBlockInput } from './body-blocks';
import { createContentAttachmentContextInput } from './context';
import { createContentAttachmentDecisionInput } from './decisions';
import { createContentAttachmentSelectionInput } from './excerpts';
import { createContentAttachmentGroundedInput } from './grounding';
import { createContentAttachmentInput } from './input';
import { createContentAttachmentOriginInput } from './origins';
import {
  CONTENT_ATTACHMENT_PROMPT_VERSION,
  contentAttachmentSystemPrompt,
} from './prompts';
import { createContentAttachmentTableAnchorInput } from './tables/anchors';

export function createContentAttachmentRequest(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
  promptVersion: ContentAttachmentPromptVersion = CONTENT_ATTACHMENT_PROMPT_VERSION,
) {
  if (!plan.units.some((u) => JSON.stringify(u) === JSON.stringify(unit)))
    throw new Error('Unknown attachment unit');
  const legacy = promptVersion === 'content-attachment.v1';
  return {
    promptVersion,
    systemPrompt: contentAttachmentSystemPrompt(promptVersion),
    userPrompt: JSON.stringify(
      promptVersion === 'content-attachment.v59' ||
        promptVersion === 'content-attachment.v60' ||
        promptVersion === 'content-attachment.v61' ||
        promptVersion === 'content-attachment.v62' ||
        promptVersion === 'content-attachment.v63' ||
        promptVersion === 'content-attachment.v64' ||
        promptVersion === 'content-attachment.v65' ||
        promptVersion === 'content-attachment.v66' ||
        promptVersion === 'content-attachment.v67' ||
        promptVersion === 'content-attachment.v68' ||
        promptVersion === 'content-attachment.v69' ||
        promptVersion === 'content-attachment.v70' ||
        promptVersion === 'content-attachment.v71' ||
        promptVersion === 'content-attachment.v72' ||
        promptVersion === 'content-attachment.v73' ||
        promptVersion === 'content-attachment.v74'
        ? createContentAttachmentGroundedInput(plan, unit).payload
        : promptVersion === 'content-attachment.v55' ||
            promptVersion === 'content-attachment.v56' ||
            promptVersion === 'content-attachment.v57' ||
            promptVersion === 'content-attachment.v58'
          ? createContentAttachmentOriginInput(plan, unit).payload
          : promptVersion === 'content-attachment.v33' ||
              promptVersion === 'content-attachment.v34' ||
              promptVersion === 'content-attachment.v35' ||
              promptVersion === 'content-attachment.v36' ||
              promptVersion === 'content-attachment.v37' ||
              promptVersion === 'content-attachment.v38' ||
              promptVersion === 'content-attachment.v39' ||
              promptVersion === 'content-attachment.v40' ||
              promptVersion === 'content-attachment.v41' ||
              promptVersion === 'content-attachment.v42' ||
              promptVersion === 'content-attachment.v43' ||
              promptVersion === 'content-attachment.v44' ||
              promptVersion === 'content-attachment.v45' ||
              promptVersion === 'content-attachment.v46' ||
              promptVersion === 'content-attachment.v47' ||
              promptVersion === 'content-attachment.v48' ||
              promptVersion === 'content-attachment.v49' ||
              promptVersion === 'content-attachment.v50' ||
              promptVersion === 'content-attachment.v51' ||
              promptVersion === 'content-attachment.v52' ||
              promptVersion === 'content-attachment.v53' ||
              promptVersion === 'content-attachment.v54'
            ? createContentAttachmentBodyBlockInput(plan, unit).payload
            : promptVersion === 'content-attachment.v31' ||
                promptVersion === 'content-attachment.v32'
              ? createContentAttachmentContextInput(plan, unit).payload
              : promptVersion === 'content-attachment.v25' ||
                  promptVersion === 'content-attachment.v26' ||
                  promptVersion === 'content-attachment.v27' ||
                  promptVersion === 'content-attachment.v28' ||
                  promptVersion === 'content-attachment.v29' ||
                  promptVersion === 'content-attachment.v30'
                ? createContentAttachmentTableAnchorInput(plan, unit).payload
                : legacy
                  ? {
                      inputSha256: plan.inputSha256,
                      candidateSnapshotId: plan.candidateSnapshotId,
                      registrySha256: plan.registrySha256,
                      registry: plan.registry,
                      registryUncertainties: plan.registryUncertainties,
                      unit,
                    }
                  : promptVersion === 'content-attachment.v13' ||
                      promptVersion === 'content-attachment.v14' ||
                      promptVersion === 'content-attachment.v15' ||
                      promptVersion === 'content-attachment.v16' ||
                      promptVersion === 'content-attachment.v17' ||
                      promptVersion === 'content-attachment.v18' ||
                      promptVersion === 'content-attachment.v19' ||
                      promptVersion === 'content-attachment.v20' ||
                      promptVersion === 'content-attachment.v21' ||
                      promptVersion === 'content-attachment.v22' ||
                      promptVersion === 'content-attachment.v23' ||
                      promptVersion === 'content-attachment.v24'
                    ? createContentAttachmentDecisionInput(plan, unit).payload
                    : promptVersion === 'content-attachment.v9' ||
                        promptVersion === 'content-attachment.v10' ||
                        promptVersion === 'content-attachment.v11' ||
                        promptVersion === 'content-attachment.v12'
                      ? createContentAttachmentSelectionInput(plan, unit)
                          .payload
                      : createContentAttachmentInput(plan, unit).payload,
    ),
  };
}
