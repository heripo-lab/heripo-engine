import type { CandidateEvidence } from '../candidates/candidate-discovery';
import type { ContentAttachmentGroundedResponse } from './grounding';
import type { ContentAttachmentRequiredResponse } from './response';
import type {
  ContentAttachmentAudit,
  ContentAttachmentPlan,
  ContentAttachmentResponse,
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
import { validateContentAttachmentIdentifierRanges } from './identifier-ranges';
import { createContentAttachmentInput } from './input';
import { createContentAttachmentOriginInput } from './origins';
import { CONTENT_ATTACHMENT_PROMPT_VERSION } from './prompts';
import { createContentAttachmentRequest } from './request';
import {
  createContentAttachmentResponseSchema,
  flattenContentAttachmentResponse,
} from './response';
import { inspectContentAttachmentIndependentReview } from './review/independent-review';
import { inspectContentAttachmentInventoryReview } from './review/inventory-review';
import { createContentAttachmentTableAnchorInput } from './tables/anchors';
import { validateContentAttachmentTables } from './tables/validation';
import {
  ignoredPassageSchema,
  savedSchema,
  savedSelectionSchema,
} from './types';

/** Replay bounded decisions; invalid assignments remain issues and never alter source strings. */
export function assembleContentAttachment(
  plan: ContentAttachmentPlan,
  audits: Array<ContentAttachmentAudit | ContentAttachmentSelectionAudit>,
): ContentAttachmentResult {
  const result: ContentAttachmentResult = {
    version: 'ledger-content-attachments.v1',
    reviewStatus: 'not_reviewed',
    completedUnitIds: [],
    totalUnits: plan.units.length,
    contents: [],
    unresolved: [],
    ignoredSources: [],
    ignoredPassages: [],
    issues: [],
  };
  for (const audit of audits) {
    const unit = plan.units.find((u) => u.unitId === audit.unitId);
    const issue = (reason: string) =>
      result.issues.push({ unitId: audit.unitId, reason });
    if (!unit || result.completedUnitIds.includes(audit.unitId)) {
      issue('Unknown or repeated unit audit');
      continue;
    }
    if (
      audit.promptVersion !== 'content-attachment.v1' &&
      audit.promptVersion !== 'content-attachment.v2' &&
      audit.promptVersion !== 'content-attachment.v3' &&
      audit.promptVersion !== 'content-attachment.v4' &&
      audit.promptVersion !== 'content-attachment.v5' &&
      audit.promptVersion !== 'content-attachment.v6' &&
      audit.promptVersion !== 'content-attachment.v7' &&
      audit.promptVersion !== 'content-attachment.v8' &&
      audit.promptVersion !== 'content-attachment.v9' &&
      audit.promptVersion !== 'content-attachment.v10' &&
      audit.promptVersion !== 'content-attachment.v11' &&
      audit.promptVersion !== 'content-attachment.v12' &&
      audit.promptVersion !== 'content-attachment.v13' &&
      audit.promptVersion !== 'content-attachment.v14' &&
      audit.promptVersion !== 'content-attachment.v15' &&
      audit.promptVersion !== 'content-attachment.v16' &&
      audit.promptVersion !== 'content-attachment.v17' &&
      audit.promptVersion !== 'content-attachment.v18' &&
      audit.promptVersion !== 'content-attachment.v19' &&
      audit.promptVersion !== 'content-attachment.v20' &&
      audit.promptVersion !== 'content-attachment.v21' &&
      audit.promptVersion !== 'content-attachment.v22' &&
      audit.promptVersion !== 'content-attachment.v23' &&
      audit.promptVersion !== 'content-attachment.v24' &&
      audit.promptVersion !== 'content-attachment.v25' &&
      audit.promptVersion !== 'content-attachment.v26' &&
      audit.promptVersion !== 'content-attachment.v27' &&
      audit.promptVersion !== 'content-attachment.v28' &&
      audit.promptVersion !== 'content-attachment.v29' &&
      audit.promptVersion !== 'content-attachment.v30' &&
      audit.promptVersion !== 'content-attachment.v31' &&
      audit.promptVersion !== 'content-attachment.v32' &&
      audit.promptVersion !== 'content-attachment.v33' &&
      audit.promptVersion !== 'content-attachment.v34' &&
      audit.promptVersion !== 'content-attachment.v35' &&
      audit.promptVersion !== 'content-attachment.v36' &&
      audit.promptVersion !== 'content-attachment.v37' &&
      audit.promptVersion !== 'content-attachment.v38' &&
      audit.promptVersion !== 'content-attachment.v39' &&
      audit.promptVersion !== 'content-attachment.v40' &&
      audit.promptVersion !== 'content-attachment.v41' &&
      audit.promptVersion !== 'content-attachment.v42' &&
      audit.promptVersion !== 'content-attachment.v43' &&
      audit.promptVersion !== 'content-attachment.v44' &&
      audit.promptVersion !== 'content-attachment.v45' &&
      audit.promptVersion !== 'content-attachment.v46' &&
      audit.promptVersion !== 'content-attachment.v47' &&
      audit.promptVersion !== 'content-attachment.v48' &&
      audit.promptVersion !== 'content-attachment.v49' &&
      audit.promptVersion !== 'content-attachment.v50' &&
      audit.promptVersion !== 'content-attachment.v51' &&
      audit.promptVersion !== 'content-attachment.v52' &&
      audit.promptVersion !== 'content-attachment.v53' &&
      audit.promptVersion !== 'content-attachment.v54' &&
      audit.promptVersion !== 'content-attachment.v55' &&
      audit.promptVersion !== 'content-attachment.v56' &&
      audit.promptVersion !== 'content-attachment.v57' &&
      audit.promptVersion !== 'content-attachment.v58' &&
      audit.promptVersion !== 'content-attachment.v59' &&
      audit.promptVersion !== 'content-attachment.v60' &&
      audit.promptVersion !== 'content-attachment.v61' &&
      audit.promptVersion !== 'content-attachment.v62' &&
      audit.promptVersion !== 'content-attachment.v63' &&
      audit.promptVersion !== 'content-attachment.v64' &&
      audit.promptVersion !== 'content-attachment.v65' &&
      audit.promptVersion !== 'content-attachment.v66' &&
      audit.promptVersion !== 'content-attachment.v67' &&
      audit.promptVersion !== 'content-attachment.v68' &&
      audit.promptVersion !== 'content-attachment.v69' &&
      audit.promptVersion !== 'content-attachment.v70' &&
      audit.promptVersion !== 'content-attachment.v71' &&
      audit.promptVersion !== 'content-attachment.v72' &&
      audit.promptVersion !== 'content-attachment.v73' &&
      audit.promptVersion !== CONTENT_ATTACHMENT_PROMPT_VERSION
    ) {
      issue('Unsupported attachment prompt version');
      continue;
    }
    const legacy = audit.promptVersion === 'content-attachment.v1';
    const selection =
      audit.promptVersion === 'content-attachment.v9' ||
      audit.promptVersion === 'content-attachment.v10' ||
      audit.promptVersion === 'content-attachment.v11' ||
      audit.promptVersion === 'content-attachment.v12' ||
      audit.promptVersion === 'content-attachment.v13' ||
      audit.promptVersion === 'content-attachment.v14' ||
      audit.promptVersion === 'content-attachment.v15' ||
      audit.promptVersion === 'content-attachment.v16' ||
      audit.promptVersion === 'content-attachment.v17' ||
      audit.promptVersion === 'content-attachment.v18' ||
      audit.promptVersion === 'content-attachment.v19' ||
      audit.promptVersion === 'content-attachment.v20' ||
      audit.promptVersion === 'content-attachment.v21' ||
      audit.promptVersion === 'content-attachment.v22' ||
      audit.promptVersion === 'content-attachment.v23' ||
      audit.promptVersion === 'content-attachment.v24' ||
      audit.promptVersion === 'content-attachment.v25' ||
      audit.promptVersion === 'content-attachment.v26' ||
      audit.promptVersion === 'content-attachment.v27' ||
      audit.promptVersion === 'content-attachment.v28' ||
      audit.promptVersion === 'content-attachment.v29' ||
      audit.promptVersion === 'content-attachment.v30' ||
      audit.promptVersion === 'content-attachment.v31' ||
      audit.promptVersion === 'content-attachment.v32' ||
      audit.promptVersion === 'content-attachment.v33' ||
      audit.promptVersion === 'content-attachment.v34' ||
      audit.promptVersion === 'content-attachment.v35' ||
      audit.promptVersion === 'content-attachment.v36' ||
      audit.promptVersion === 'content-attachment.v37' ||
      audit.promptVersion === 'content-attachment.v38' ||
      audit.promptVersion === 'content-attachment.v39' ||
      audit.promptVersion === 'content-attachment.v40' ||
      audit.promptVersion === 'content-attachment.v41' ||
      audit.promptVersion === 'content-attachment.v42' ||
      audit.promptVersion === 'content-attachment.v43' ||
      audit.promptVersion === 'content-attachment.v44' ||
      audit.promptVersion === 'content-attachment.v45' ||
      audit.promptVersion === 'content-attachment.v46' ||
      audit.promptVersion === 'content-attachment.v47' ||
      audit.promptVersion === 'content-attachment.v48' ||
      audit.promptVersion === 'content-attachment.v49' ||
      audit.promptVersion === 'content-attachment.v50' ||
      audit.promptVersion === 'content-attachment.v51' ||
      audit.promptVersion === 'content-attachment.v52' ||
      audit.promptVersion === 'content-attachment.v53' ||
      audit.promptVersion === 'content-attachment.v54' ||
      audit.promptVersion === 'content-attachment.v55' ||
      audit.promptVersion === 'content-attachment.v56' ||
      audit.promptVersion === 'content-attachment.v57' ||
      audit.promptVersion === 'content-attachment.v58' ||
      audit.promptVersion === 'content-attachment.v59' ||
      audit.promptVersion === 'content-attachment.v60' ||
      audit.promptVersion === 'content-attachment.v61' ||
      audit.promptVersion === 'content-attachment.v62' ||
      audit.promptVersion === 'content-attachment.v63' ||
      audit.promptVersion === 'content-attachment.v64' ||
      audit.promptVersion === 'content-attachment.v65' ||
      audit.promptVersion === 'content-attachment.v66' ||
      audit.promptVersion === 'content-attachment.v67' ||
      audit.promptVersion === 'content-attachment.v68' ||
      audit.promptVersion === 'content-attachment.v69' ||
      audit.promptVersion === 'content-attachment.v70' ||
      audit.promptVersion === 'content-attachment.v71' ||
      audit.promptVersion === 'content-attachment.v72' ||
      audit.promptVersion === 'content-attachment.v73' ||
      audit.promptVersion === 'content-attachment.v74';
    const selectionInput =
      audit.promptVersion === 'content-attachment.v59' ||
      audit.promptVersion === 'content-attachment.v60' ||
      audit.promptVersion === 'content-attachment.v61' ||
      audit.promptVersion === 'content-attachment.v62' ||
      audit.promptVersion === 'content-attachment.v63' ||
      audit.promptVersion === 'content-attachment.v64' ||
      audit.promptVersion === 'content-attachment.v65' ||
      audit.promptVersion === 'content-attachment.v66' ||
      audit.promptVersion === 'content-attachment.v67' ||
      audit.promptVersion === 'content-attachment.v68' ||
      audit.promptVersion === 'content-attachment.v69' ||
      audit.promptVersion === 'content-attachment.v70' ||
      audit.promptVersion === 'content-attachment.v71' ||
      audit.promptVersion === 'content-attachment.v72' ||
      audit.promptVersion === 'content-attachment.v73' ||
      audit.promptVersion === 'content-attachment.v74'
        ? createContentAttachmentGroundedInput(plan, unit)
        : audit.promptVersion === 'content-attachment.v55' ||
            audit.promptVersion === 'content-attachment.v56' ||
            audit.promptVersion === 'content-attachment.v57' ||
            audit.promptVersion === 'content-attachment.v58'
          ? createContentAttachmentOriginInput(plan, unit)
          : audit.promptVersion === 'content-attachment.v33' ||
              audit.promptVersion === 'content-attachment.v34' ||
              audit.promptVersion === 'content-attachment.v35' ||
              audit.promptVersion === 'content-attachment.v36' ||
              audit.promptVersion === 'content-attachment.v37' ||
              audit.promptVersion === 'content-attachment.v38' ||
              audit.promptVersion === 'content-attachment.v39' ||
              audit.promptVersion === 'content-attachment.v40' ||
              audit.promptVersion === 'content-attachment.v41' ||
              audit.promptVersion === 'content-attachment.v42' ||
              audit.promptVersion === 'content-attachment.v43' ||
              audit.promptVersion === 'content-attachment.v44' ||
              audit.promptVersion === 'content-attachment.v45' ||
              audit.promptVersion === 'content-attachment.v46' ||
              audit.promptVersion === 'content-attachment.v47' ||
              audit.promptVersion === 'content-attachment.v48' ||
              audit.promptVersion === 'content-attachment.v49' ||
              audit.promptVersion === 'content-attachment.v50' ||
              audit.promptVersion === 'content-attachment.v51' ||
              audit.promptVersion === 'content-attachment.v52' ||
              audit.promptVersion === 'content-attachment.v53' ||
              audit.promptVersion === 'content-attachment.v54'
            ? createContentAttachmentBodyBlockInput(plan, unit)
            : audit.promptVersion === 'content-attachment.v31' ||
                audit.promptVersion === 'content-attachment.v32'
              ? createContentAttachmentContextInput(plan, unit)
              : audit.promptVersion === 'content-attachment.v25' ||
                  audit.promptVersion === 'content-attachment.v26' ||
                  audit.promptVersion === 'content-attachment.v27' ||
                  audit.promptVersion === 'content-attachment.v28' ||
                  audit.promptVersion === 'content-attachment.v29' ||
                  audit.promptVersion === 'content-attachment.v30'
                ? createContentAttachmentTableAnchorInput(plan, unit)
                : selection
                  ? audit.promptVersion === 'content-attachment.v13' ||
                    audit.promptVersion === 'content-attachment.v14' ||
                    audit.promptVersion === 'content-attachment.v15' ||
                    audit.promptVersion === 'content-attachment.v16' ||
                    audit.promptVersion === 'content-attachment.v17' ||
                    audit.promptVersion === 'content-attachment.v18' ||
                    audit.promptVersion === 'content-attachment.v19' ||
                    audit.promptVersion === 'content-attachment.v20' ||
                    audit.promptVersion === 'content-attachment.v21' ||
                    audit.promptVersion === 'content-attachment.v22' ||
                    audit.promptVersion === 'content-attachment.v23' ||
                    audit.promptVersion === 'content-attachment.v24'
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
      continue;
    }
    const request = createContentAttachmentRequest(
      plan,
      unit,
      audit.promptVersion,
    );
    const selectors = new Map(
      unit.sources.map((s, i) => [
        legacy ? s.sourceId : `S${i + 1}`,
        s.sourceId,
      ]),
    );
    if (
      audit.promptVersion !== request.promptVersion ||
      audit.systemPrompt !== request.systemPrompt ||
      audit.userPrompt !== request.userPrompt
    ) {
      issue('Audit does not match the fixed input and registry');
      continue;
    }
    const fullCoverage =
      audit.promptVersion === 'content-attachment.v6' ||
      audit.promptVersion === 'content-attachment.v7' ||
      audit.promptVersion === 'content-attachment.v8' ||
      audit.promptVersion === 'content-attachment.v9' ||
      audit.promptVersion === 'content-attachment.v10' ||
      audit.promptVersion === 'content-attachment.v11' ||
      audit.promptVersion === 'content-attachment.v12' ||
      audit.promptVersion === 'content-attachment.v13' ||
      audit.promptVersion === 'content-attachment.v14' ||
      audit.promptVersion === 'content-attachment.v15' ||
      audit.promptVersion === 'content-attachment.v16' ||
      audit.promptVersion === 'content-attachment.v17' ||
      audit.promptVersion === 'content-attachment.v18' ||
      audit.promptVersion === 'content-attachment.v19' ||
      audit.promptVersion === 'content-attachment.v20' ||
      audit.promptVersion === 'content-attachment.v21' ||
      audit.promptVersion === 'content-attachment.v22' ||
      audit.promptVersion === 'content-attachment.v23' ||
      audit.promptVersion === 'content-attachment.v24' ||
      audit.promptVersion === 'content-attachment.v25' ||
      audit.promptVersion === 'content-attachment.v26' ||
      audit.promptVersion === 'content-attachment.v27' ||
      audit.promptVersion === 'content-attachment.v28' ||
      audit.promptVersion === 'content-attachment.v29' ||
      audit.promptVersion === 'content-attachment.v30' ||
      audit.promptVersion === 'content-attachment.v31' ||
      audit.promptVersion === 'content-attachment.v32' ||
      audit.promptVersion === 'content-attachment.v33' ||
      audit.promptVersion === 'content-attachment.v34' ||
      audit.promptVersion === 'content-attachment.v35' ||
      audit.promptVersion === 'content-attachment.v36' ||
      audit.promptVersion === 'content-attachment.v37' ||
      audit.promptVersion === 'content-attachment.v38' ||
      audit.promptVersion === 'content-attachment.v39' ||
      audit.promptVersion === 'content-attachment.v40' ||
      audit.promptVersion === 'content-attachment.v41' ||
      audit.promptVersion === 'content-attachment.v42' ||
      audit.promptVersion === 'content-attachment.v43' ||
      audit.promptVersion === 'content-attachment.v44' ||
      audit.promptVersion === 'content-attachment.v45' ||
      audit.promptVersion === 'content-attachment.v46' ||
      audit.promptVersion === 'content-attachment.v47' ||
      audit.promptVersion === 'content-attachment.v48' ||
      audit.promptVersion === 'content-attachment.v49' ||
      audit.promptVersion === 'content-attachment.v50' ||
      audit.promptVersion === 'content-attachment.v51' ||
      audit.promptVersion === 'content-attachment.v52' ||
      audit.promptVersion === 'content-attachment.v53' ||
      audit.promptVersion === 'content-attachment.v54' ||
      audit.promptVersion === 'content-attachment.v55' ||
      audit.promptVersion === 'content-attachment.v56' ||
      audit.promptVersion === 'content-attachment.v57' ||
      audit.promptVersion === 'content-attachment.v58' ||
      audit.promptVersion === 'content-attachment.v59' ||
      audit.promptVersion === 'content-attachment.v60' ||
      audit.promptVersion === 'content-attachment.v61' ||
      audit.promptVersion === 'content-attachment.v62' ||
      audit.promptVersion === 'content-attachment.v63' ||
      audit.promptVersion === 'content-attachment.v64' ||
      audit.promptVersion === 'content-attachment.v65' ||
      audit.promptVersion === 'content-attachment.v66' ||
      audit.promptVersion === 'content-attachment.v67' ||
      audit.promptVersion === 'content-attachment.v68' ||
      audit.promptVersion === 'content-attachment.v69' ||
      audit.promptVersion === 'content-attachment.v70' ||
      audit.promptVersion === 'content-attachment.v71' ||
      audit.promptVersion === 'content-attachment.v72' ||
      audit.promptVersion === 'content-attachment.v73' ||
      audit.promptVersion === CONTENT_ATTACHMENT_PROMPT_VERSION;
    if (
      audit.promptVersion === 'content-attachment.v42' ||
      audit.promptVersion === 'content-attachment.v43' ||
      audit.promptVersion === 'content-attachment.v44' ||
      audit.promptVersion === 'content-attachment.v45' ||
      audit.promptVersion === 'content-attachment.v46' ||
      audit.promptVersion === 'content-attachment.v47' ||
      audit.promptVersion === 'content-attachment.v48' ||
      audit.promptVersion === 'content-attachment.v49' ||
      audit.promptVersion === 'content-attachment.v50' ||
      audit.promptVersion === 'content-attachment.v51' ||
      audit.promptVersion === 'content-attachment.v52' ||
      audit.promptVersion === 'content-attachment.v53' ||
      audit.promptVersion === 'content-attachment.v54' ||
      audit.promptVersion === 'content-attachment.v55' ||
      audit.promptVersion === 'content-attachment.v56' ||
      audit.promptVersion === 'content-attachment.v57' ||
      audit.promptVersion === 'content-attachment.v58' ||
      audit.promptVersion === 'content-attachment.v59' ||
      audit.promptVersion === 'content-attachment.v60' ||
      audit.promptVersion === 'content-attachment.v61' ||
      audit.promptVersion === 'content-attachment.v62' ||
      audit.promptVersion === 'content-attachment.v63' ||
      audit.promptVersion === 'content-attachment.v64' ||
      audit.promptVersion === 'content-attachment.v65' ||
      audit.promptVersion === 'content-attachment.v66' ||
      audit.promptVersion === 'content-attachment.v67' ||
      audit.promptVersion === 'content-attachment.v68' ||
      audit.promptVersion === 'content-attachment.v69' ||
      audit.promptVersion === 'content-attachment.v70' ||
      audit.promptVersion === 'content-attachment.v71' ||
      audit.promptVersion === 'content-attachment.v72' ||
      audit.promptVersion === 'content-attachment.v73' ||
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
        continue;
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
      if (grounding.issues.length) continue;
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
      if (grounding.issues.length) continue;
    }
    if (
      audit.promptVersion === 'content-attachment.v61' ||
      audit.promptVersion === 'content-attachment.v62' ||
      audit.promptVersion === 'content-attachment.v63' ||
      audit.promptVersion === 'content-attachment.v64' ||
      audit.promptVersion === 'content-attachment.v65' ||
      audit.promptVersion === 'content-attachment.v66' ||
      audit.promptVersion === 'content-attachment.v67' ||
      audit.promptVersion === 'content-attachment.v68' ||
      audit.promptVersion === 'content-attachment.v69' ||
      audit.promptVersion === 'content-attachment.v70' ||
      audit.promptVersion === 'content-attachment.v71' ||
      audit.promptVersion === 'content-attachment.v72' ||
      audit.promptVersion === 'content-attachment.v73' ||
      audit.promptVersion === 'content-attachment.v74'
    ) {
      const reviewed = inspectContentAttachmentIndependentReview(
        createContentAttachmentGroundedInput(plan, unit),
        audit.rawResponse as ContentAttachmentRequiredResponse,
        audit.independentReview,
        {
          includeBodyContext: audit.promptVersion !== 'content-attachment.v61',
          preserveTentativeMembership:
            audit.promptVersion === 'content-attachment.v74',
          gateQualifierStage:
            audit.promptVersion === 'content-attachment.v73' ||
            audit.promptVersion === 'content-attachment.v74',
          checkClauseGrounds:
            audit.promptVersion === 'content-attachment.v72' ||
            audit.promptVersion === 'content-attachment.v73' ||
            audit.promptVersion === 'content-attachment.v74',
          boundAreaRecording:
            audit.promptVersion === 'content-attachment.v71' ||
            audit.promptVersion === 'content-attachment.v72' ||
            audit.promptVersion === 'content-attachment.v73' ||
            audit.promptVersion === 'content-attachment.v74',
          traceAreaRecording:
            audit.promptVersion === 'content-attachment.v70' ||
            audit.promptVersion === 'content-attachment.v71' ||
            audit.promptVersion === 'content-attachment.v72' ||
            audit.promptVersion === 'content-attachment.v73' ||
            audit.promptVersion === 'content-attachment.v74',
          reviewTableWork:
            audit.promptVersion === 'content-attachment.v69' ||
            audit.promptVersion === 'content-attachment.v70' ||
            audit.promptVersion === 'content-attachment.v71' ||
            audit.promptVersion === 'content-attachment.v72' ||
            audit.promptVersion === 'content-attachment.v73' ||
            audit.promptVersion === 'content-attachment.v74',
          boundAreaResultRecipients:
            audit.promptVersion === 'content-attachment.v68' ||
            audit.promptVersion === 'content-attachment.v69' ||
            audit.promptVersion === 'content-attachment.v70' ||
            audit.promptVersion === 'content-attachment.v71' ||
            audit.promptVersion === 'content-attachment.v72' ||
            audit.promptVersion === 'content-attachment.v73' ||
            audit.promptVersion === 'content-attachment.v74',
          qualifyBeforeIdentity:
            audit.promptVersion === 'content-attachment.v63' ||
            audit.promptVersion === 'content-attachment.v64' ||
            audit.promptVersion === 'content-attachment.v65' ||
            audit.promptVersion === 'content-attachment.v66' ||
            audit.promptVersion === 'content-attachment.v67' ||
            audit.promptVersion === 'content-attachment.v68' ||
            audit.promptVersion === 'content-attachment.v69' ||
            audit.promptVersion === 'content-attachment.v70' ||
            audit.promptVersion === 'content-attachment.v71' ||
            audit.promptVersion === 'content-attachment.v72' ||
            audit.promptVersion === 'content-attachment.v73' ||
            audit.promptVersion === 'content-attachment.v74',
          preserveAreaResults:
            audit.promptVersion === 'content-attachment.v67' ||
            audit.promptVersion === 'content-attachment.v68' ||
            audit.promptVersion === 'content-attachment.v69' ||
            audit.promptVersion === 'content-attachment.v70' ||
            audit.promptVersion === 'content-attachment.v71' ||
            audit.promptVersion === 'content-attachment.v72' ||
            audit.promptVersion === 'content-attachment.v73' ||
            audit.promptVersion === 'content-attachment.v74',
          preserveAreaWork:
            audit.promptVersion === 'content-attachment.v66' ||
            audit.promptVersion === 'content-attachment.v67' ||
            audit.promptVersion === 'content-attachment.v68' ||
            audit.promptVersion === 'content-attachment.v69' ||
            audit.promptVersion === 'content-attachment.v70' ||
            audit.promptVersion === 'content-attachment.v71' ||
            audit.promptVersion === 'content-attachment.v72' ||
            audit.promptVersion === 'content-attachment.v73' ||
            audit.promptVersion === 'content-attachment.v74',
          crossChapterAreas:
            audit.promptVersion === 'content-attachment.v65' ||
            audit.promptVersion === 'content-attachment.v66' ||
            audit.promptVersion === 'content-attachment.v67' ||
            audit.promptVersion === 'content-attachment.v68' ||
            audit.promptVersion === 'content-attachment.v69' ||
            audit.promptVersion === 'content-attachment.v70' ||
            audit.promptVersion === 'content-attachment.v71' ||
            audit.promptVersion === 'content-attachment.v72' ||
            audit.promptVersion === 'content-attachment.v73' ||
            audit.promptVersion === 'content-attachment.v74',
          reconcileRecipientRefs:
            audit.promptVersion === 'content-attachment.v64' ||
            audit.promptVersion === 'content-attachment.v65' ||
            audit.promptVersion === 'content-attachment.v66' ||
            audit.promptVersion === 'content-attachment.v67' ||
            audit.promptVersion === 'content-attachment.v68' ||
            audit.promptVersion === 'content-attachment.v69' ||
            audit.promptVersion === 'content-attachment.v70' ||
            audit.promptVersion === 'content-attachment.v71' ||
            audit.promptVersion === 'content-attachment.v72' ||
            audit.promptVersion === 'content-attachment.v73' ||
            audit.promptVersion === 'content-attachment.v74',
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
      if (reviewed.issues.length) continue;
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
      continue;
    }
    const before = result.issues.length;
    const inspected = new Set<string>();
    const used = new Set<string>();
    const handledExcerpts = new Set<string>();
    const seenSelections = new Set<string>();
    const select = (
      ref: string,
      category: string,
    ): CandidateEvidence[] | null => {
      const excerpt = selectionInput!.codeMap.excerpts.find(
        (e) => e.ref === ref,
      );
      if (!excerpt || seenSelections.has(`${category}:${ref}`)) {
        issue('Unknown or repeated excerpt reference');
        return null;
      }
      seenSelections.add(`${category}:${ref}`);
      return excerpt.evidence;
    };
    const covered = new Map<string, Array<[number, number]>>();
    const cover = (evidence: CandidateEvidence[]) => {
      for (const e of evidence) {
        const ranges = covered.get(e.sourceId) ?? [];
        ranges.push([e.charStart, e.charEnd]);
        covered.set(e.sourceId, ranges);
        inspected.add(e.sourceId);
        used.add(e.sourceId);
      }
    };
    const locate = (
      fragments: ContentAttachmentResponse['assignments'][number]['fragments'],
    ): CandidateEvidence[] | null => {
      const evidence: CandidateEvidence[] = [];
      let previous = -1;
      let previousEnd = 0;
      let kind: string | undefined;
      let table: string | undefined;
      for (const f of fragments) {
        const i = unit.sources.findIndex(
          (s) => s.sourceId === selectors.get(f.sourceId),
        );
        const r = unit.sources[i]?.resource;
        const start = r?.data.text.indexOf(f.quote) ?? -1;
        if (
          !r ||
          start < 0 ||
          r.data.text.indexOf(f.quote, start + 1) >= 0 ||
          i < previous ||
          (i === previous && start < previousEnd) ||
          (kind && kind !== r.kind) ||
          (r.kind === 'tableCell' && table && table !== r.tableId)
        )
          return null;
        previous = i;
        previousEnd = start + f.quote.length;
        kind = r.kind;
        if (r.kind === 'tableCell') table = r.tableId;
        evidence.push({
          sourceId: unit.sources[i].sourceId,
          resourceKey: r.key,
          resourceId: r.resourceId,
          sourceRefs: r.sourceRefs,
          pdfPageNo: r.pdfPageNo,
          logicalPageRange: r.logicalPageRange,
          quote: f.quote,
          charStart: start,
          charEnd: start + f.quote.length,
        });
      }
      return evidence;
    };
    const oldData = parsed?.success ? parsed.data : null;
    const newData = selected?.success ? selected.data : null;
    for (const [category, items] of [
      [
        'assignments',
        newData
          ? newData.assignments.map((item) => ({
              ...item,
              evidence: select(item.excerptRef, 'assignments'),
            }))
          : oldData!.assignments.map((item) => ({
              ...item,
              excerptRef: '',
              evidence: locate(item.fragments),
            })),
      ],
      [
        'unresolved',
        newData
          ? newData.unresolved.map((item) => ({
              ...item,
              evidence: select(item.excerptRef, 'unresolved'),
            }))
          : oldData!.unresolved.map((item) => ({
              ...item,
              excerptRef: '',
              evidence: locate(item.fragments),
            })),
      ],
    ] as const) {
      for (const item of items) {
        if (
          item.candidateRefs.some(
            (ref) => !plan.registry.some((r) => r.ref === ref),
          ) ||
          new Set(item.candidateRefs).size !== item.candidateRefs.length
        ) {
          issue('Unknown or repeated candidate reference');
          continue;
        }
        const evidence = item.evidence;
        if (!evidence) {
          issue(
            'Excerpt does not match exact ordered original block or cell fragments',
          );
          continue;
        }
        cover(evidence);
        if (selection) handledExcerpts.add(item.excerptRef);
        if (category === 'unresolved') {
          result.unresolved.push({
            unitId: unit.unitId,
            candidateRefs: item.candidateRefs,
            evidence,
            reason: item.reason,
          });
          continue;
        }
        const kind =
          unit.sources.find((s) => s.sourceId === evidence[0].sourceId)!
            .resource.kind === 'text'
            ? 'body'
            : 'table_item';
        for (const ref of item.candidateRefs) {
          let content = result.contents.find((c) => c.registryRef === ref);
          if (!content) {
            content = {
              registryRef: ref,
              groupId: plan.registry.find((r) => r.ref === ref)!.groupId,
              excerpts: [],
            };
            result.contents.push(content);
          }
          const fragments = evidence.map((f) => f.quote);
          let excerpt = content.excerpts.find(
            (e) =>
              e.kind === kind &&
              JSON.stringify(e.fragments) === JSON.stringify(fragments),
          );
          if (!excerpt) {
            excerpt = { kind, fragments, occurrences: [], reasons: [] };
            content.excerpts.push(excerpt);
          }
          if (
            !excerpt.occurrences.some(
              (o) => JSON.stringify(o.evidence) === JSON.stringify(evidence),
            )
          )
            excerpt.occurrences.push({ evidence });
          if (!excerpt.reasons.includes(item.reason))
            excerpt.reasons.push(item.reason);
        }
      }
    }
    if (fullCoverage) {
      const exclusions = newData
        ? newData.ignored.map((item) => ({
            ...item,
            evidence: select(item.excerptRef, 'ignored'),
          }))
        : oldData!.ignoredPassages!.map((item) => ({
            ...item,
            excerptRef: '',
            evidence: locate(item.fragments),
          }));
      for (const ignored of exclusions) {
        const evidence = ignored.evidence;
        if (!evidence) {
          issue(
            'Ignored passage does not match exact ordered original fragments',
          );
          continue;
        }
        if (
          evidence.some((e) =>
            covered
              .get(e.sourceId)
              ?.some(([start, end]) => start < e.charEnd && e.charStart < end),
          )
        ) {
          issue('Ignored passage overlaps an already accounted passage');
          continue;
        }
        cover(evidence);
        if (selection) handledExcerpts.add(ignored.excerptRef);
        result.ignoredPassages.push({
          unitId: unit.unitId,
          evidence,
          reason: ignored.reason,
        });
        if (
          audit.promptVersion === 'content-attachment.v12' ||
          audit.promptVersion === 'content-attachment.v13' ||
          audit.promptVersion === 'content-attachment.v14' ||
          audit.promptVersion === 'content-attachment.v15' ||
          audit.promptVersion === 'content-attachment.v16' ||
          audit.promptVersion === 'content-attachment.v17' ||
          audit.promptVersion === 'content-attachment.v18' ||
          audit.promptVersion === 'content-attachment.v19' ||
          audit.promptVersion === 'content-attachment.v20' ||
          audit.promptVersion === 'content-attachment.v21' ||
          audit.promptVersion === 'content-attachment.v22' ||
          audit.promptVersion === 'content-attachment.v23' ||
          audit.promptVersion === 'content-attachment.v24' ||
          audit.promptVersion === 'content-attachment.v25' ||
          audit.promptVersion === 'content-attachment.v26' ||
          audit.promptVersion === 'content-attachment.v27' ||
          audit.promptVersion === 'content-attachment.v28' ||
          audit.promptVersion === 'content-attachment.v29' ||
          audit.promptVersion === 'content-attachment.v30' ||
          audit.promptVersion === 'content-attachment.v31' ||
          audit.promptVersion === 'content-attachment.v32' ||
          audit.promptVersion === 'content-attachment.v33' ||
          audit.promptVersion === 'content-attachment.v34' ||
          audit.promptVersion === 'content-attachment.v35' ||
          audit.promptVersion === 'content-attachment.v36' ||
          audit.promptVersion === 'content-attachment.v37' ||
          audit.promptVersion === 'content-attachment.v38' ||
          audit.promptVersion === 'content-attachment.v39' ||
          audit.promptVersion === 'content-attachment.v40' ||
          audit.promptVersion === 'content-attachment.v41' ||
          audit.promptVersion === 'content-attachment.v42' ||
          audit.promptVersion === 'content-attachment.v43' ||
          audit.promptVersion === 'content-attachment.v44' ||
          audit.promptVersion === 'content-attachment.v45' ||
          audit.promptVersion === 'content-attachment.v46' ||
          audit.promptVersion === 'content-attachment.v47' ||
          audit.promptVersion === 'content-attachment.v48' ||
          audit.promptVersion === 'content-attachment.v49' ||
          audit.promptVersion === 'content-attachment.v50' ||
          audit.promptVersion === 'content-attachment.v51' ||
          audit.promptVersion === 'content-attachment.v52' ||
          audit.promptVersion === 'content-attachment.v53' ||
          audit.promptVersion === 'content-attachment.v54' ||
          audit.promptVersion === 'content-attachment.v55' ||
          audit.promptVersion === 'content-attachment.v56' ||
          audit.promptVersion === 'content-attachment.v57' ||
          audit.promptVersion === 'content-attachment.v58' ||
          audit.promptVersion === 'content-attachment.v59' ||
          audit.promptVersion === 'content-attachment.v60' ||
          audit.promptVersion === 'content-attachment.v61' ||
          audit.promptVersion === 'content-attachment.v62' ||
          audit.promptVersion === 'content-attachment.v63' ||
          audit.promptVersion === 'content-attachment.v64' ||
          audit.promptVersion === 'content-attachment.v65' ||
          audit.promptVersion === 'content-attachment.v66' ||
          audit.promptVersion === 'content-attachment.v67' ||
          audit.promptVersion === 'content-attachment.v68' ||
          audit.promptVersion === 'content-attachment.v69' ||
          audit.promptVersion === 'content-attachment.v70' ||
          audit.promptVersion === 'content-attachment.v71' ||
          audit.promptVersion === 'content-attachment.v72' ||
          audit.promptVersion === 'content-attachment.v73' ||
          audit.promptVersion === 'content-attachment.v74'
        ) {
          const source = unit.sources.find(
            (s) => s.sourceId === evidence[0].sourceId,
          )!.resource;
          const heading = evidence[0].quote;
          if (source.kind === 'text' && source.data.text.trim() === heading) {
            const matches = plan.registry.filter(
              (r) =>
                r.recordKind === 'artifact' &&
                r.mentions.some((m) => {
                  if (
                    !m.sourceIdentifier ||
                    !source.chapterIds.includes(m.chapterPath.at(-1)?.id ?? '')
                  )
                    return false;
                  const prefix = `${m.sourceIdentifier} ${m.sourceName}`;
                  return (
                    heading === prefix ||
                    (heading.startsWith(prefix) &&
                      /^ \([^()\r\n]*\)$/u.test(heading.slice(prefix.length)))
                  );
                }),
            );
            if (matches.length)
              issue(
                `Registered artifact heading cannot be ignored: ${ignored.excerptRef} (${matches.map((r) => r.ref).join(', ')})`,
              );
          }
        }
      }
    }
    for (const ignored of oldData?.ignoredSources ?? []) {
      const sourceId = selectors.get(ignored.sourceId);
      if (!sourceId || used.has(sourceId)) {
        issue('Ignored source is unknown or also used by a passage');
        continue;
      }
      inspected.add(sourceId);
      covered.set(sourceId, [
        [
          0,
          unit.sources.find((s) => s.sourceId === sourceId)!.resource.data.text
            .length,
        ],
      ]);
      result.ignoredSources.push({ unitId: unit.unitId, ...ignored, sourceId });
    }
    if (selectionInput) {
      for (const excerpt of selectionInput.codeMap.excerpts)
        if (!handledExcerpts.has(excerpt.ref))
          issue(`Unaccounted excerpt: ${excerpt.ref}`);
      for (const source of unit.sources)
        if (!/\S/u.test(source.resource.data.text)) {
          inspected.add(source.sourceId);
          covered.set(source.sourceId, [[0, source.resource.data.text.length]]);
        }
    }
    for (const source of unit.sources) {
      if (!inspected.has(source.sourceId))
        issue(`Unaccounted source: ${source.sourceId}`);
      else if (fullCoverage) {
        const text = source.resource.data.text;
        let cursor = 0;
        const gap = (end: number) => {
          const quote = text.slice(cursor, end);
          if (/\S/u.test(quote))
            issue(
              `Unaccounted text: ${source.sourceId} [${cursor}, ${end}) ${JSON.stringify(quote)}`,
            );
        };
        for (const [start, end] of covered
          .get(source.sourceId)!
          .sort((a, b) => a[0] - b[0])) {
          gap(start);
          cursor = Math.max(cursor, end);
        }
        gap(text.length);
      }
    }
    if (
      audit.promptVersion === 'content-attachment.v18' ||
      audit.promptVersion === 'content-attachment.v19' ||
      audit.promptVersion === 'content-attachment.v20' ||
      audit.promptVersion === 'content-attachment.v21' ||
      audit.promptVersion === 'content-attachment.v22' ||
      audit.promptVersion === 'content-attachment.v23' ||
      audit.promptVersion === 'content-attachment.v24' ||
      audit.promptVersion === 'content-attachment.v25' ||
      audit.promptVersion === 'content-attachment.v26' ||
      audit.promptVersion === 'content-attachment.v27' ||
      audit.promptVersion === 'content-attachment.v28' ||
      audit.promptVersion === 'content-attachment.v29' ||
      audit.promptVersion === 'content-attachment.v30' ||
      audit.promptVersion === 'content-attachment.v31' ||
      audit.promptVersion === 'content-attachment.v32' ||
      audit.promptVersion === 'content-attachment.v33' ||
      audit.promptVersion === 'content-attachment.v34' ||
      audit.promptVersion === 'content-attachment.v35' ||
      audit.promptVersion === 'content-attachment.v36' ||
      audit.promptVersion === 'content-attachment.v37' ||
      audit.promptVersion === 'content-attachment.v38' ||
      audit.promptVersion === 'content-attachment.v39' ||
      audit.promptVersion === 'content-attachment.v40' ||
      audit.promptVersion === 'content-attachment.v41' ||
      audit.promptVersion === 'content-attachment.v42' ||
      audit.promptVersion === 'content-attachment.v43' ||
      audit.promptVersion === 'content-attachment.v44' ||
      audit.promptVersion === 'content-attachment.v45' ||
      audit.promptVersion === 'content-attachment.v46' ||
      audit.promptVersion === 'content-attachment.v47' ||
      audit.promptVersion === 'content-attachment.v48' ||
      audit.promptVersion === 'content-attachment.v49' ||
      audit.promptVersion === 'content-attachment.v50' ||
      audit.promptVersion === 'content-attachment.v51' ||
      audit.promptVersion === 'content-attachment.v52' ||
      audit.promptVersion === 'content-attachment.v53' ||
      audit.promptVersion === 'content-attachment.v54' ||
      audit.promptVersion === 'content-attachment.v55' ||
      audit.promptVersion === 'content-attachment.v56' ||
      audit.promptVersion === 'content-attachment.v57' ||
      audit.promptVersion === 'content-attachment.v58' ||
      audit.promptVersion === 'content-attachment.v59' ||
      audit.promptVersion === 'content-attachment.v60' ||
      audit.promptVersion === 'content-attachment.v61' ||
      audit.promptVersion === 'content-attachment.v62' ||
      audit.promptVersion === 'content-attachment.v63' ||
      audit.promptVersion === 'content-attachment.v64' ||
      audit.promptVersion === 'content-attachment.v65' ||
      audit.promptVersion === 'content-attachment.v66' ||
      audit.promptVersion === 'content-attachment.v67' ||
      audit.promptVersion === 'content-attachment.v68' ||
      audit.promptVersion === 'content-attachment.v69' ||
      audit.promptVersion === 'content-attachment.v70' ||
      audit.promptVersion === 'content-attachment.v71' ||
      audit.promptVersion === 'content-attachment.v72' ||
      audit.promptVersion === 'content-attachment.v73' ||
      audit.promptVersion === 'content-attachment.v74'
    ) {
      for (const reason of validateContentAttachmentTables(
        plan,
        unit,
        selectionInput!.codeMap.excerpts,
        newData!,
        audit.promptVersion === 'content-attachment.v35' ||
          audit.promptVersion === 'content-attachment.v36' ||
          audit.promptVersion === 'content-attachment.v37' ||
          audit.promptVersion === 'content-attachment.v38' ||
          audit.promptVersion === 'content-attachment.v39' ||
          audit.promptVersion === 'content-attachment.v40' ||
          audit.promptVersion === 'content-attachment.v41' ||
          audit.promptVersion === 'content-attachment.v42' ||
          audit.promptVersion === 'content-attachment.v43' ||
          audit.promptVersion === 'content-attachment.v44' ||
          audit.promptVersion === 'content-attachment.v45' ||
          audit.promptVersion === 'content-attachment.v46' ||
          audit.promptVersion === 'content-attachment.v47' ||
          audit.promptVersion === 'content-attachment.v48' ||
          audit.promptVersion === 'content-attachment.v49' ||
          audit.promptVersion === 'content-attachment.v50' ||
          audit.promptVersion === 'content-attachment.v51' ||
          audit.promptVersion === 'content-attachment.v52' ||
          audit.promptVersion === 'content-attachment.v53' ||
          audit.promptVersion === 'content-attachment.v54' ||
          audit.promptVersion === 'content-attachment.v55' ||
          audit.promptVersion === 'content-attachment.v56' ||
          audit.promptVersion === 'content-attachment.v57' ||
          audit.promptVersion === 'content-attachment.v58' ||
          audit.promptVersion === 'content-attachment.v59' ||
          audit.promptVersion === 'content-attachment.v60' ||
          audit.promptVersion === 'content-attachment.v61' ||
          audit.promptVersion === 'content-attachment.v62' ||
          audit.promptVersion === 'content-attachment.v63' ||
          audit.promptVersion === 'content-attachment.v64' ||
          audit.promptVersion === 'content-attachment.v65' ||
          audit.promptVersion === 'content-attachment.v66' ||
          audit.promptVersion === 'content-attachment.v67' ||
          audit.promptVersion === 'content-attachment.v68' ||
          audit.promptVersion === 'content-attachment.v69' ||
          audit.promptVersion === 'content-attachment.v70' ||
          audit.promptVersion === 'content-attachment.v71' ||
          audit.promptVersion === 'content-attachment.v72' ||
          audit.promptVersion === 'content-attachment.v73' ||
          audit.promptVersion === 'content-attachment.v74',
      ))
        issue(reason);
    }
    if (
      audit.promptVersion === 'content-attachment.v45' ||
      audit.promptVersion === 'content-attachment.v46' ||
      audit.promptVersion === 'content-attachment.v47' ||
      audit.promptVersion === 'content-attachment.v48' ||
      audit.promptVersion === 'content-attachment.v49' ||
      audit.promptVersion === 'content-attachment.v50' ||
      audit.promptVersion === 'content-attachment.v51' ||
      audit.promptVersion === 'content-attachment.v52' ||
      audit.promptVersion === 'content-attachment.v53' ||
      audit.promptVersion === 'content-attachment.v54' ||
      audit.promptVersion === 'content-attachment.v55' ||
      audit.promptVersion === 'content-attachment.v56' ||
      audit.promptVersion === 'content-attachment.v57' ||
      audit.promptVersion === 'content-attachment.v58' ||
      audit.promptVersion === 'content-attachment.v59' ||
      audit.promptVersion === 'content-attachment.v60' ||
      audit.promptVersion === 'content-attachment.v61' ||
      audit.promptVersion === 'content-attachment.v62' ||
      audit.promptVersion === 'content-attachment.v63' ||
      audit.promptVersion === 'content-attachment.v64' ||
      audit.promptVersion === 'content-attachment.v65' ||
      audit.promptVersion === 'content-attachment.v66' ||
      audit.promptVersion === 'content-attachment.v67' ||
      audit.promptVersion === 'content-attachment.v68' ||
      audit.promptVersion === 'content-attachment.v69' ||
      audit.promptVersion === 'content-attachment.v70' ||
      audit.promptVersion === 'content-attachment.v71' ||
      audit.promptVersion === 'content-attachment.v72' ||
      audit.promptVersion === 'content-attachment.v73' ||
      audit.promptVersion === CONTENT_ATTACHMENT_PROMPT_VERSION
    ) {
      for (const reason of validateContentAttachmentIdentifierRanges(
        plan,
        selectionInput!.codeMap.excerpts,
        newData!,
        audit.promptVersion === 'content-attachment.v53' ||
          audit.promptVersion === 'content-attachment.v54' ||
          audit.promptVersion === 'content-attachment.v55' ||
          audit.promptVersion === 'content-attachment.v56' ||
          audit.promptVersion === 'content-attachment.v57' ||
          audit.promptVersion === 'content-attachment.v58' ||
          audit.promptVersion === 'content-attachment.v59' ||
          audit.promptVersion === 'content-attachment.v60' ||
          audit.promptVersion === 'content-attachment.v61' ||
          audit.promptVersion === 'content-attachment.v62' ||
          audit.promptVersion === 'content-attachment.v63' ||
          audit.promptVersion === 'content-attachment.v64' ||
          audit.promptVersion === 'content-attachment.v65' ||
          audit.promptVersion === 'content-attachment.v66' ||
          audit.promptVersion === 'content-attachment.v67' ||
          audit.promptVersion === 'content-attachment.v68' ||
          audit.promptVersion === 'content-attachment.v69' ||
          audit.promptVersion === 'content-attachment.v70' ||
          audit.promptVersion === 'content-attachment.v71' ||
          audit.promptVersion === 'content-attachment.v72' ||
          audit.promptVersion === 'content-attachment.v73' ||
          audit.promptVersion === CONTENT_ATTACHMENT_PROMPT_VERSION,
      ))
        issue(reason);
    }
    if (result.issues.length === before)
      result.completedUnitIds.push(unit.unitId);
  }
  return result;
}
