import type { ProcessedDocument } from '@heripo/model';

import type {
  AttachmentUnit,
  ContentAttachmentPlan,
} from './content-attachment';
import type {
  ContentAttachmentAreaRecipientResponse,
  ContentAttachmentRecipientAudit,
} from './content-attachment-recipients';
import type { ContentAttachmentSegmentationAudit } from './content-attachment-segmentation';
import type {
  ContentAttachmentSourceContextBinding,
  ContentAttachmentSourceContextOptions,
  ContentAttachmentSourceContextRequest,
} from './content-attachment-source-context';

import { Output } from 'ai';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { createContentAttachmentGroundedInput } from './content-attachment-grounding';
import { inspectContentAttachmentRecipientSelections } from './content-attachment-recipients';
import {
  CONTENT_ATTACHMENT_SOURCE_CONTEXT_VERSION,
  createContentAttachmentSourceContextRequest,
  resolveContentAttachmentSourceContextRange,
} from './content-attachment-source-context';
import { buildDocumentResourceIndex } from './document-resource-index';

/** Pure snapshot digests bind replay inputs; they do not authenticate a model observation. */
export function createContentAttachmentSourceContextReplaySnapshot(
  document: ProcessedDocument,
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
  segmentation: ContentAttachmentSegmentationAudit,
) {
  const digest = (value: unknown) =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    inputSha256: plan.inputSha256,
    candidateSnapshotId: plan.candidateSnapshotId,
    registrySha256: plan.registrySha256,
    unitId: unit.unitId,
    documentSha256: digest(document),
    planSha256: digest(plan),
    segmentationSha256: digest(segmentation),
  };
}

export interface ContentAttachmentSourceContextRecipientAudit extends ContentAttachmentRecipientAudit<ContentAttachmentAreaRecipientResponse> {
  version: 'segment-recipients.v25';
  contextVersion: typeof CONTENT_ATTACHMENT_SOURCE_CONTEXT_VERSION;
  contextOptions: ContentAttachmentSourceContextOptions;
  replaySnapshot: ReturnType<
    typeof createContentAttachmentSourceContextReplaySnapshot
  >;
  providerOutputSchema: unknown;
  wordEvidence: ContentAttachmentSourceContextRequest['wordEvidence'];
  contextBindings: ContentAttachmentSourceContextRequest['contextBindings'];
}

function requireMatch(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Check archived locators and complete W boundaries against the caller's frozen original document. */
function verifyOriginalSources(
  document: ProcessedDocument,
  request: ContentAttachmentSourceContextRequest,
  audit: ContentAttachmentSourceContextRecipientAudit,
) {
  const resources = new Map(
    buildDocumentResourceIndex(document).resources.map((r) => [r.key, r]),
  );
  for (const { table } of audit.contextBindings.tables)
    requireMatch(
      isDeepStrictEqual(resources.get(table.key)?.data, table.data),
      'Original context table differs',
    );
  for (const header of audit.contextBindings.headers)
    requireMatch(
      isDeepStrictEqual(resources.get(header.resourceKey)?.data, {
        text: header.text,
        rowSpan: header.rowSpan,
        colSpan: header.colSpan,
        isHeader: header.isHeader,
      }),
      'Original context header differs',
    );
  const sources = audit.wordEvidence.sources;
  requireMatch(
    new Set(sources.map((s) => s.ref)).size === sources.length,
    'Duplicate context source',
  );
  requireMatch(
    audit.contextBindings.sources.length === sources.length,
    'Context binding coverage differs',
  );
  for (const source of sources) {
    const bindings = audit.contextBindings.sources.filter(
      (b) => b.ref === source.ref,
    );
    requireMatch(bindings.length === 1, 'Missing or duplicate context binding');
    const binding = bindings[0];
    requireMatch(
      binding.resourceKey === source.resourceKey,
      'Context source locator differs',
    );
    const caption = binding.resourceKey.endsWith('/caption');
    const resource = resources.get(
      caption ? binding.resourceKey.slice(0, -8) : binding.resourceKey,
    );
    requireMatch(!!resource, 'Unknown original context resource');
    const original = caption
      ? resource.kind === 'table'
        ? resource.data.caption?.fullText
        : undefined
      : resource.kind === 'text' || resource.kind === 'tableCell'
        ? resource.data.text
        : undefined;
    requireMatch(
      typeof original === 'string' &&
        binding.field === (caption ? 'fullText' : 'text'),
      'Original context field differs',
    );
    requireMatch(
      Number.isInteger(binding.charStart) &&
        Number.isInteger(binding.charEnd) &&
        binding.charStart >= 0 &&
        binding.charEnd >= binding.charStart &&
        binding.charEnd <= original.length,
      'Original context offsets are invalid',
    );
    requireMatch(
      original.slice(binding.charStart, binding.charEnd) === binding.text &&
        binding.text === source.text,
      'Original context text differs',
    );
    const expectedMetadata = {
      resourceId: resource.resourceId,
      sourceRefs:
        caption && resource.kind === 'table'
          ? (resource.data.captionSourceRefs ?? [])
          : resource.sourceRefs,
      pdfPageNo: resource.pdfPageNo,
      logicalPageRange: resource.logicalPageRange,
    };
    requireMatch(
      isDeepStrictEqual(expectedMetadata, {
        resourceId: binding.resourceId,
        sourceRefs: binding.sourceRefs,
        pdfPageNo: binding.pdfPageNo,
        logicalPageRange: binding.logicalPageRange,
      }),
      'Original context metadata differs',
    );
    const words = [...source.text.matchAll(/\S+/gu)].map((m, i) => ({
      ref: `W${i + 1}`,
      charStart: m.index,
      charEnd: m.index + m[0].length,
    }));
    requireMatch(
      isDeepStrictEqual(words, source.words),
      'Original context word boundaries differ',
    );
  }
  for (const { evidence } of request.candidateEvidence) {
    const resource = resources.get(evidence.resourceKey);
    requireMatch(
      !!resource &&
        (resource.kind === 'text' || resource.kind === 'tableCell') &&
        resource.data.text.slice(evidence.charStart, evidence.charEnd) ===
          evidence.quote,
      'Original candidate grounds differ',
    );
  }
}

export type ContentAttachmentSourceContextRecipientInspection = ReturnType<
  typeof inspectContentAttachmentRecipientSelections
> & {
  sourceRanges: Array<
    ReturnType<typeof resolveContentAttachmentSourceContextRange> & {
      segmentRef: string;
      responsePath: string;
      sourceRefs: string[];
      pdfPageNo: number | null;
      logicalPageRange: ContentAttachmentSourceContextBinding['logicalPageRange'];
      resourceId: string | null;
    }
  >;
};

/** Inspect an explicitly bound context response without mutating segmentation, raw output or recipients. */
export async function inspectContentAttachmentSourceContextRecipients(
  document: ProcessedDocument,
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
  segmentation: ContentAttachmentSegmentationAudit,
  audit: ContentAttachmentSourceContextRecipientAudit,
): Promise<ContentAttachmentSourceContextRecipientInspection> {
  let request: ContentAttachmentSourceContextRequest;
  try {
    requireMatch(
      audit.version === 'segment-recipients.v25' &&
        audit.contextVersion === CONTENT_ATTACHMENT_SOURCE_CONTEXT_VERSION &&
        !!audit.contextOptions &&
        typeof audit.contextOptions === 'object',
      'Invalid source-context audit version or selection',
    );
    requireMatch(
      isDeepStrictEqual(
        audit.replaySnapshot,
        createContentAttachmentSourceContextReplaySnapshot(
          document,
          plan,
          unit,
          segmentation,
        ),
      ),
      'Source-context replay snapshot differs',
    );
    request = createContentAttachmentSourceContextRequest(
      plan,
      unit,
      segmentation,
      audit.contextOptions,
    );
    requireMatch(
      audit.systemPrompt === request.systemPrompt &&
        audit.userPrompt === request.userPrompt &&
        isDeepStrictEqual(audit.segmentSnapshot, request.segmentSnapshot) &&
        isDeepStrictEqual(audit.candidateEvidence, request.candidateEvidence),
      'Source-context request snapshot differs',
    );
    const format = await Output.object({ schema: request.schema })
      .responseFormat;
    requireMatch(
      format?.type === 'json' &&
        isDeepStrictEqual(audit.providerOutputSchema, format.schema),
      'Source-context provider schema differs',
    );
    verifyOriginalSources(document, request, audit);
    requireMatch(
      isDeepStrictEqual(audit.wordEvidence, request.wordEvidence) &&
        isDeepStrictEqual(audit.contextBindings, request.contextBindings),
      'Source-context word or binding snapshot differs',
    );
  } catch (error) {
    return {
      issues: [`Invalid source-context audit: ${(error as Error).message}`],
      findings: [],
      sourceRanges: [],
    };
  }
  const parsed = request.schema.safeParse(audit.rawResponse);
  if (!parsed.success)
    return {
      issues: parsed.error.issues.map(
        (issue) =>
          `Invalid recipient response: ${issue.path.join('.')}: ${issue.message}`,
      ),
      findings: [],
      sourceRanges: [],
    };
  const result = inspectContentAttachmentRecipientSelections(
    createContentAttachmentGroundedInput(plan, unit),
    segmentation,
    audit,
    request,
    parsed.data,
    request.wordEvidence,
  );
  const sourceRanges: ContentAttachmentSourceContextRecipientInspection['sourceRanges'] =
    [];
  for (const segment of result.findings) {
    const collect = (value: unknown, path: string) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key.endsWith('WordRanges') && Array.isArray(child)) {
          for (const [index, range] of child.entries()) {
            const resolved = resolveContentAttachmentSourceContextRange(
              request,
              range,
              segment.excerptRef,
            );
            const binding = request.contextBindings.sources.find(
              (b) => b.ref === resolved.sourceRef,
            )!;
            sourceRanges.push({
              ...resolved,
              segmentRef: segment.segmentRef,
              responsePath: `${path}.${key}.${index}`,
              sourceRefs: binding.sourceRefs,
              pdfPageNo: binding.pdfPageNo,
              logicalPageRange: binding.logicalPageRange,
              resourceId: binding.resourceId,
            });
          }
        } else collect(child, `${path}.${key}`);
      }
    };
    collect(
      parsed.data.decisions[segment.segmentRef],
      `decisions.${segment.segmentRef}`,
    );
  }
  return { ...result, sourceRanges };
}
