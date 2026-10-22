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
  isContentAttachmentPromptBetween,
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
      isContentAttachmentPromptBetween(promptVersion, 59, 74)
        ? createContentAttachmentGroundedInput(plan, unit).payload
        : isContentAttachmentPromptBetween(promptVersion, 55, 58)
          ? createContentAttachmentOriginInput(plan, unit).payload
          : isContentAttachmentPromptBetween(promptVersion, 33, 54)
            ? createContentAttachmentBodyBlockInput(plan, unit).payload
            : isContentAttachmentPromptBetween(promptVersion, 31, 32)
              ? createContentAttachmentContextInput(plan, unit).payload
              : isContentAttachmentPromptBetween(promptVersion, 25, 30)
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
                  : isContentAttachmentPromptBetween(promptVersion, 13, 24)
                    ? createContentAttachmentDecisionInput(plan, unit).payload
                    : isContentAttachmentPromptBetween(promptVersion, 9, 12)
                      ? createContentAttachmentSelectionInput(plan, unit)
                          .payload
                      : createContentAttachmentInput(plan, unit).payload,
    ),
  };
}
