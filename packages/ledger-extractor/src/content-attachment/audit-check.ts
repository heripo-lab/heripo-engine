import type { ContentAttachmentGroundedResponse } from './grounding';
import type { ContentAttachmentRequiredResponse } from './response';
import type {
  ContentAttachmentAudit,
  ContentAttachmentPlan,
  ContentAttachmentResult,
  ContentAttachmentSelectionAudit,
} from './types';

import { z } from 'zod';

import { createContentAttachmentBodyBlockInput } from './body-blocks';
import { createContentAttachmentContextInput } from './context';
import { createContentAttachmentDecisionInput } from './decisions';
import { createContentAttachmentSelectionInput } from './excerpts';
import {
  createContentAttachmentGroundedInput,
  createContentAttachmentGroundedSchema,
  inspectContentAttachmentGrounding,
} from './grounding';
import { createContentAttachmentInput } from './input';
import { createContentAttachmentOriginInput } from './origins';
import { CONTENT_ATTACHMENT_PROMPT_VERSION } from './prompts';
import {
  isContentAttachmentPromptBetween,
  isContentAttachmentPromptVersion,
} from './prompts';
import { createContentAttachmentRequest } from './request';
import {
  createContentAttachmentResponseSchema,
  flattenContentAttachmentResponse,
} from './response';
import { inspectContentAttachmentIndependentReview } from './review/independent-review-inspection';
import { inspectContentAttachmentInventoryReview } from './review/inventory-review';
import { createContentAttachmentTableAnchorInput } from './tables/anchors';
import {
  ignoredPassageSchema,
  savedSchema,
  savedSelectionSchema,
} from './types';

/**
 * Check one saved audit against its unit, prompt version, fixed request, code map and response schemas.
 * Returns null after recording the issue when the audit cannot be replayed.
 */
export function checkContentAttachmentAudit(
  plan: ContentAttachmentPlan,
  result: ContentAttachmentResult,
  audit: ContentAttachmentAudit | ContentAttachmentSelectionAudit,
) {
  const unit = plan.units.find((u) => u.unitId === audit.unitId);
  const issue = (reason: string) =>
    result.issues.push({ unitId: audit.unitId, reason });
  if (!unit || result.completedUnitIds.includes(audit.unitId)) {
    issue('Unknown or repeated unit audit');
    return null;
  }
  if (!isContentAttachmentPromptVersion(audit.promptVersion)) {
    issue('Unsupported attachment prompt version');
    return null;
  }
  const legacy = audit.promptVersion === 'content-attachment.v1';
  const selection = isContentAttachmentPromptBetween(
    audit.promptVersion,
    9,
    74,
  );
  const selectionInput = isContentAttachmentPromptBetween(
    audit.promptVersion,
    59,
    74,
  )
    ? createContentAttachmentGroundedInput(plan, unit)
    : isContentAttachmentPromptBetween(audit.promptVersion, 55, 58)
      ? createContentAttachmentOriginInput(plan, unit)
      : isContentAttachmentPromptBetween(audit.promptVersion, 33, 54)
        ? createContentAttachmentBodyBlockInput(plan, unit)
        : isContentAttachmentPromptBetween(audit.promptVersion, 31, 32)
          ? createContentAttachmentContextInput(plan, unit)
          : isContentAttachmentPromptBetween(audit.promptVersion, 25, 30)
            ? createContentAttachmentTableAnchorInput(plan, unit)
            : selection
              ? isContentAttachmentPromptBetween(audit.promptVersion, 13, 24)
                ? createContentAttachmentDecisionInput(plan, unit)
                : createContentAttachmentSelectionInput(plan, unit)
              : null;
  if (
    !legacy &&
    JSON.stringify(audit.codeMap) !==
      JSON.stringify(
        selectionInput?.codeMap ??
          createContentAttachmentInput(plan, unit).codeMap,
      )
  ) {
    issue('Audit code map does not match the fixed input and registry');
    return null;
  }
  const request = createContentAttachmentRequest(
    plan,
    unit,
    audit.promptVersion,
  );
  const selectors = new Map(
    unit.sources.map((s, i) => [legacy ? s.sourceId : `S${i + 1}`, s.sourceId]),
  );
  if (
    audit.promptVersion !== request.promptVersion ||
    audit.systemPrompt !== request.systemPrompt ||
    audit.userPrompt !== request.userPrompt
  ) {
    issue('Audit does not match the fixed input and registry');
    return null;
  }
  const fullCoverage =
    isContentAttachmentPromptBetween(audit.promptVersion, 6, 73) ||
    audit.promptVersion === CONTENT_ATTACHMENT_PROMPT_VERSION;
  if (
    isContentAttachmentPromptBetween(audit.promptVersion, 42, 73) ||
    audit.promptVersion === CONTENT_ATTACHMENT_PROMPT_VERSION
  ) {
    const raw = (
      audit.promptVersion === 'content-attachment.v59'
        ? createContentAttachmentGroundedSchema(
            createContentAttachmentGroundedInput(plan, unit),
          )
        : createContentAttachmentResponseSchema(
            selectionInput!.codeMap.excerpts.map((e) => e.ref),
            plan.registry.map((r) => r.ref),
          )
    ).safeParse(audit.rawResponse);
    if (
      !raw.success ||
      JSON.stringify(flattenContentAttachmentResponse(raw.data)) !==
        JSON.stringify(audit.response)
    ) {
      issue('Invalid required excerpt response or inconsistent projection');
      return null;
    }
  }
  if (audit.promptVersion === 'content-attachment.v59') {
    const grounding = inspectContentAttachmentGrounding(
      createContentAttachmentGroundedInput(plan, unit),
      audit.rawResponse as ContentAttachmentGroundedResponse,
    );
    for (const reason of grounding.issues) issue(reason);
    if (grounding.exclusions.length)
      (result.exclusionEvidence ??= []).push(
        ...grounding.exclusions.map((e) => ({ ...e, unitId: unit.unitId })),
      );
    if (grounding.issues.length) return null;
  }
  if (audit.promptVersion === 'content-attachment.v60') {
    const grounding = inspectContentAttachmentInventoryReview(
      createContentAttachmentGroundedInput(plan, unit),
      audit.rawResponse as ContentAttachmentRequiredResponse,
      audit.inventoryReview,
    );
    for (const reason of grounding.issues) issue(reason);
    if (grounding.exclusions.length)
      (result.exclusionEvidence ??= []).push(
        ...grounding.exclusions.map((e) => ({ ...e, unitId: unit.unitId })),
      );
    if (grounding.issues.length) return null;
  }
  if (isContentAttachmentPromptBetween(audit.promptVersion, 61, 74)) {
    const reviewed = inspectContentAttachmentIndependentReview(
      createContentAttachmentGroundedInput(plan, unit),
      audit.rawResponse as ContentAttachmentRequiredResponse,
      audit.independentReview,
      {
        includeBodyContext: audit.promptVersion !== 'content-attachment.v61',
        preserveTentativeMembership:
          audit.promptVersion === 'content-attachment.v74',
        gateQualifierStage: isContentAttachmentPromptBetween(
          audit.promptVersion,
          73,
          74,
        ),
        checkClauseGrounds: isContentAttachmentPromptBetween(
          audit.promptVersion,
          72,
          74,
        ),
        boundAreaRecording: isContentAttachmentPromptBetween(
          audit.promptVersion,
          71,
          74,
        ),
        traceAreaRecording: isContentAttachmentPromptBetween(
          audit.promptVersion,
          70,
          74,
        ),
        reviewTableWork: isContentAttachmentPromptBetween(
          audit.promptVersion,
          69,
          74,
        ),
        boundAreaResultRecipients: isContentAttachmentPromptBetween(
          audit.promptVersion,
          68,
          74,
        ),
        qualifyBeforeIdentity: isContentAttachmentPromptBetween(
          audit.promptVersion,
          63,
          74,
        ),
        preserveAreaResults: isContentAttachmentPromptBetween(
          audit.promptVersion,
          67,
          74,
        ),
        preserveAreaWork: isContentAttachmentPromptBetween(
          audit.promptVersion,
          66,
          74,
        ),
        crossChapterAreas: isContentAttachmentPromptBetween(
          audit.promptVersion,
          65,
          74,
        ),
        reconcileRecipientRefs: isContentAttachmentPromptBetween(
          audit.promptVersion,
          64,
          74,
        ),
      },
    );
    for (const reason of reviewed.issues) issue(reason);
    if (reviewed.findings.length)
      (result.independentReviewFindings ??= []).push(
        ...reviewed.findings.map((f) => ({ ...f, unitId: unit.unitId })),
      );
    if (reviewed.disagreements.length)
      (result.reviewDisagreements ??= []).push(
        ...reviewed.disagreements.map((f) => ({ ...f, unitId: unit.unitId })),
      );
    if (reviewed.issues.length) return null;
  }
  const parsed = selection
    ? null
    : (fullCoverage
        ? savedSchema.extend({
            ignoredPassages: ignoredPassageSchema(z.string()),
          })
        : savedSchema
      ).safeParse(audit.response);
  const selected = selection
    ? savedSelectionSchema.safeParse(audit.response)
    : null;
  if (parsed?.success === false || selected?.success === false) {
    issue('Invalid attachment response schema');
    return null;
  }
  return {
    unit,
    issue,
    selection,
    selectionInput,
    selectors,
    fullCoverage,
    parsed,
    selected,
  };
}
