import type { ProcessedDocument } from '@heripo/model';

import type {
  AttachmentUnit,
  ContentAttachmentPlan,
} from './content-attachment';
import type { ContentAttachmentEvidenceWindowRequest } from './content-attachment-evidence-windows';
import type {
  ContentAttachmentAreaRecipientDecision,
  ContentAttachmentAreaRecipientResponse,
} from './content-attachment-recipients';
import type { ContentAttachmentSegmentationAudit } from './content-attachment-segmentation';

import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

import {
  CONTENT_ATTACHMENT_EVIDENCE_WINDOWS_PROMPT_VERSION,
  CONTENT_ATTACHMENT_EVIDENCE_WINDOWS_VERSION,
  createContentAttachmentEvidenceWindowRequest,
  resolveContentAttachmentEvidenceWindowRange,
} from './content-attachment-evidence-windows';
import { createContentAttachmentGroundedInput } from './content-attachment-grounding';
import { inspectContentAttachmentRecipientSelections } from './content-attachment-recipients';
import { createContentAttachmentSourceContextRequest } from './content-attachment-source-context';

export interface ContentAttachmentEvidenceWindowAudit {
  request: ContentAttachmentEvidenceWindowRequest;
  rawResponse: unknown;
}
type Selection = ReturnType<
  typeof resolveContentAttachmentEvidenceWindowRange
> & { segmentRef: string; responsePath: string };
export type ContentAttachmentEvidenceWindowInspection = ReturnType<
  typeof inspectContentAttachmentRecipientSelections
> & { windowSelections: Selection[] };

/** Rebuild the trusted request before interpreting any archived Q/L selection. */
export async function inspectContentAttachmentEvidenceWindowRecipients(
  document: ProcessedDocument,
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
  segmentation: ContentAttachmentSegmentationAudit,
  audit: ContentAttachmentEvidenceWindowAudit,
): Promise<ContentAttachmentEvidenceWindowInspection> {
  let request: ContentAttachmentEvidenceWindowRequest;
  let decisions: Record<string, unknown>;
  try {
    if (
      audit.request.version !== CONTENT_ATTACHMENT_EVIDENCE_WINDOWS_VERSION &&
      audit.request.version !==
        CONTENT_ATTACHMENT_EVIDENCE_WINDOWS_PROMPT_VERSION
    )
      throw new Error('REQUEST_SNAPSHOT_MISMATCH');
    request = await createContentAttachmentEvidenceWindowRequest(
      document,
      plan,
      unit,
      segmentation,
      audit.request.contextOptions,
      audit.request.baseVersion,
      audit.request.version,
    );
    if (!isDeepStrictEqual(request, audit.request))
      throw new Error('REQUEST_SNAPSHOT_MISMATCH');
    const root = z
      .strictObject({ decisions: z.record(z.string(), z.unknown()) })
      .parse(audit.rawResponse);
    decisions = root.decisions;
    if (
      Object.keys(decisions).some(
        (ref) =>
          !request.sourceRequest.segmentSnapshot.some((s) => s.ref === ref),
      )
    )
      throw new Error('UNKNOWN_RESPONSE_SEGMENT');
  } catch (error) {
    return {
      issues: ['Invalid evidence-window audit: ' + (error as Error).message],
      findings: [],
      windowSelections: [],
    };
  }
  const source = createContentAttachmentSourceContextRequest(
    plan,
    unit,
    segmentation,
    request.contextOptions,
    request.baseVersion,
  );
  const schema = source.schema as z.ZodObject<{
    decisions: z.ZodObject<
      Record<string, z.ZodType<ContentAttachmentAreaRecipientDecision>>
    >;
  }>;
  const issues: string[] = [],
    selections: Selection[] = [];
  const projected: ContentAttachmentAreaRecipientResponse = { decisions: {} };
  for (const segment of source.segmentSnapshot) {
    const pending: Selection[] = [];
    try {
      const walk = (value: unknown, path: string): unknown => {
        if (Array.isArray(value))
          return value.map((child, i) => walk(child, path + '.' + i));
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(
          Object.entries(value).map(([key, child]) => {
            const nextPath = path + '.' + key;
            if (!key.endsWith('WordRanges') || !Array.isArray(child))
              return [key, walk(child, nextPath)];
            const seen = new Set<string>(),
              ranges: Selection[] = [];
            const converted = child.map((range: unknown, index) => {
              const responsePath = nextPath + '.' + index;
              if (typeof range !== 'string')
                throw new Error(responsePath + ': INVALID_SELECTION_TYPE');
              if (seen.has(range))
                throw new Error(responsePath + ': DUPLICATE_WINDOW_RANGE');
              seen.add(range);
              let resolved: ReturnType<
                typeof resolveContentAttachmentEvidenceWindowRange
              >;
              try {
                resolved = resolveContentAttachmentEvidenceWindowRange(
                  request,
                  range,
                  segment.ref,
                  key === 'currentWordRanges',
                );
              } catch (error) {
                throw new Error(responsePath + ': ' + (error as Error).message);
              }
              if (
                ranges.some(
                  (r) =>
                    r.sourceRef === resolved.sourceRef &&
                    r.charStart < resolved.charEnd &&
                    resolved.charStart < r.charEnd,
                )
              )
                throw new Error(responsePath + ': OVERLAPPING_WORD_SELECTION');
              const selection = {
                ...resolved,
                segmentRef: segment.ref,
                responsePath,
              };
              ranges.push(selection);
              pending.push(selection);
              return resolved.originalRange;
            });
            return [key, converted];
          }),
        );
      };
      // Only a derived interpretation is passed to legacy checks; audit.rawResponse is never modified.
      const decision = schema.shape.decisions.shape[segment.ref].parse(
        walk(decisions[segment.ref], 'decisions.' + segment.ref),
      );
      projected.decisions[segment.ref] = decision;
      selections.push(...pending);
    } catch (error) {
      issues.push(segment.ref + ': ' + (error as Error).message);
    }
  }
  const validSegments = source.segmentSnapshot.filter((s) =>
    Object.hasOwn(projected.decisions, s.ref),
  );
  const result = inspectContentAttachmentRecipientSelections(
    createContentAttachmentGroundedInput(plan, unit),
    segmentation,
    { ...source, rawResponse: projected, usage: {} as never, callAttempts: [] },
    { ...source, segmentSnapshot: validSegments },
    projected,
    source.wordEvidence,
  );
  const accepted = new Set(result.findings.map((f) => f.segmentRef));
  return {
    ...result,
    issues: [...issues, ...result.issues],
    windowSelections: selections.filter((s) => accepted.has(s.segmentRef)),
  };
}
