import type { ProcessedDocument } from '@heripo/model';

import type { ContentAttachmentSegmentationAudit } from '../recipients/segmentation';
import type { AttachmentUnit, ContentAttachmentPlan } from '../types';
import type {
  ContentAttachmentSourceContextOptions,
  ContentAttachmentSourceContextRequest,
} from './source-context-types';

import { Output } from 'ai';
import { createHash } from 'node:crypto';

import { CONTENT_ATTACHMENT_WORD_RANGE_PATTERN } from '../recipients/word-evidence';
import { CONTENT_ATTACHMENT_EVIDENCE_WINDOW_POLICY } from './evidence-window-policy';
import { createContentAttachmentSourceContextRequest } from './source-context';
import {
  createContentAttachmentSourceContextReplaySnapshot,
  verifyOriginalSources,
} from './source-context-inspection';
import { resolveContentAttachmentSourceContextRange } from './source-context-range';

export const CONTENT_ATTACHMENT_EVIDENCE_WINDOWS_VERSION =
  'content-evidence-windows.v1' as const;
export const CONTENT_ATTACHMENT_EVIDENCE_WINDOWS_PROMPT_VERSION =
  'content-evidence-windows.v2' as const;
export type ContentAttachmentEvidenceWindowVersion =
  | typeof CONTENT_ATTACHMENT_EVIDENCE_WINDOWS_VERSION
  | typeof CONTENT_ATTACHMENT_EVIDENCE_WINDOWS_PROMPT_VERSION;
export interface ContentAttachmentEvidenceWindow {
  ref: string;
  sourceRef: string;
  originalWords: string[];
}
export interface ContentAttachmentEvidenceWindowRequest {
  version: ContentAttachmentEvidenceWindowVersion;
  executionMode: 'offline-only';
  baseVersion: 'segment-recipients.v25' | 'segment-recipients.v26';
  maxWindowWords: 16;
  contextOptions: ContentAttachmentSourceContextOptions;
  replaySnapshot: ReturnType<
    typeof createContentAttachmentSourceContextReplaySnapshot
  >;
  systemPrompt: string;
  userPrompt: string;
  providerOutputSchema: unknown;
  windows: ContentAttachmentEvidenceWindow[];
  sourceRequest: Pick<
    ContentAttachmentSourceContextRequest,
    'wordEvidence' | 'contextBindings' | 'segmentSnapshot' | 'candidateEvidence'
  >;
  snapshotSha256: string;
}

type View = {
  ref: string;
  text: string;
  words?: string[][];
  wordWindows?: { ref: string; words: string[][] }[];
};

/** Compress decimal alternatives without enumerating every source-wide interval. */
function numbers(values: string[]): string {
  const groups = new Map<string, string[]>();
  for (const first of [
    ...new Set(values.filter(Boolean).map((s) => s[0])),
  ].sort()) {
    const suffix = numbers(
      values.filter((s) => s.startsWith(first)).map((s) => s.slice(1)),
    );
    groups.set(suffix, [...(groups.get(suffix) ?? []), first]);
  }
  const parts = [...groups].map(
    ([suffix, digits]) =>
      (digits.length === 1 ? digits[0] : '[' + digits.join('') + ']') + suffix,
  );
  if (!parts.length) return '';
  const body = parts.length === 1 ? parts[0] : '(?:' + parts.join('|') + ')';
  return values.includes('') ? '(?:' + body + ')?' : body;
}

function windowSchema(
  schema: unknown,
  windows: ContentAttachmentEvidenceWindow[],
) {
  const groups = new Map<number, string[]>();
  for (const w of windows)
    groups.set(w.originalWords.length, [
      ...(groups.get(w.originalWords.length) ?? []),
      w.ref.slice(1),
    ]);
  const branches = [...groups].map(([length, refs]) => {
    const ranges = Array.from(
      { length },
      (_, i) =>
        'L' +
        (i + 1) +
        '-L' +
        numbers(
          Array.from({ length: length - i }, (_, j) => String(i + j + 1)),
        ),
    );
    return 'Q' + numbers(refs) + ':(?:' + ranges.join('|') + ')';
  });
  let replaced = 0;
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (
        obj.type === 'string' &&
        obj.pattern === CONTENT_ATTACHMENT_WORD_RANGE_PATTERN.source
      ) {
        replaced++;
        return { $ref: '#/definitions/WindowWordRange' };
      }
      return Object.fromEntries(
        Object.entries(obj).map(([key, v]) => [key, walk(v)]),
      );
    }
    return value;
  };
  const result = walk(schema) as { definitions: Record<string, unknown> };
  if (!replaced) throw new Error('Window schema contract differs: ' + replaced);
  result.definitions.WindowWordRange = {
    type: 'string',
    pattern: '^(?:' + branches.join('|') + ')$',
  };
  return result;
}

/** Compile an opt-in offline address contract, preserving the exact historical v1 default. */
export async function createContentAttachmentEvidenceWindowRequest(
  document: ProcessedDocument,
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
  segmentation: ContentAttachmentSegmentationAudit,
  options: ContentAttachmentSourceContextOptions = {},
  baseVersion:
    | 'segment-recipients.v25'
    | 'segment-recipients.v26' = 'segment-recipients.v26',
  windowVersion: ContentAttachmentEvidenceWindowVersion = CONTENT_ATTACHMENT_EVIDENCE_WINDOWS_VERSION,
): Promise<ContentAttachmentEvidenceWindowRequest> {
  if (
    windowVersion !== CONTENT_ATTACHMENT_EVIDENCE_WINDOWS_VERSION &&
    windowVersion !== CONTENT_ATTACHMENT_EVIDENCE_WINDOWS_PROMPT_VERSION
  )
    throw new Error('Invalid evidence-window version');
  if (
    baseVersion !== 'segment-recipients.v25' &&
    baseVersion !== 'segment-recipients.v26'
  )
    throw new Error('Invalid evidence-window base version');
  const source = createContentAttachmentSourceContextRequest(
    plan,
    unit,
    segmentation,
    options,
    baseVersion,
  );
  verifyOriginalSources(document, source, source);
  const payload = JSON.parse(source.userPrompt);
  const windows: ContentAttachmentEvidenceWindow[] = [];
  for (const view of [
    ...payload.current,
    ...payload.sourceContext.sources,
  ] as View[]) {
    const words = view.words!;
    view.wordWindows = [];
    for (let i = 0; i < words.length; i += 16) {
      const chunk = words.slice(i, i + 16),
        ref = 'Q' + (windows.length + 1);
      windows.push({
        ref,
        sourceRef: view.ref,
        originalWords: chunk.map((w) => w[0]),
      });
      view.wordWindows.push({
        ref,
        words: chunk.map(([word, text], j) => ['L' + (j + 1), word, text]),
      });
    }
    delete view.words;
  }
  payload.evidenceWindowContract = {
    wordWindowColumns: ['localRef', 'originalWordRef', 'literalSourceUnit'],
    selection:
      'Qref:Lstart-Lend, both endpoints inclusive; select multiple windows across a boundary. Original E/X/W identifiers and full source text remain authoritative. A window is only an evidence-addressing unit, not an independent assertion or work target.',
  };
  const format = await Output.object({ schema: source.schema }).responseFormat;
  if (format?.type !== 'json') throw new Error('Expected object output');
  const data = {
    version: windowVersion,
    executionMode: 'offline-only' as const,
    baseVersion,
    maxWindowWords: 16 as const,
    contextOptions: structuredClone(options),
    replaySnapshot: createContentAttachmentSourceContextReplaySnapshot(
      document,
      plan,
      unit,
      segmentation,
    ),
    systemPrompt:
      windowVersion === CONTENT_ATTACHMENT_EVIDENCE_WINDOWS_PROMPT_VERSION
        ? source.systemPrompt +
          '\n\n' +
          CONTENT_ATTACHMENT_EVIDENCE_WINDOW_POLICY
        : source.systemPrompt,
    userPrompt: JSON.stringify(payload),
    providerOutputSchema: windowSchema(format.schema, windows),
    windows,
    sourceRequest: structuredClone({
      wordEvidence: source.wordEvidence,
      contextBindings: source.contextBindings,
      segmentSnapshot: source.segmentSnapshot,
      candidateEvidence: source.candidateEvidence,
    }),
  };
  return {
    ...data,
    snapshotSha256: createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex'),
  };
}

/** Resolve only against a freshly compiled trusted request, never an unverified audit map. */
export function resolveContentAttachmentEvidenceWindowRange(
  request: ContentAttachmentEvidenceWindowRequest,
  range: string,
  segmentRef: string,
  currentOnly = false,
) {
  const match = /^(Q[1-9]\d*):L([1-9]\d*)-L([1-9]\d*)$/.exec(range);
  if (!match) throw new Error('MALFORMED_WINDOW_RANGE');
  const window = request.windows.find((w) => w.ref === match[1]);
  if (!window) throw new Error('UNKNOWN_WINDOW');
  const start = Number(match[2]),
    end = Number(match[3]);
  if (
    start > end ||
    !window.originalWords[start - 1] ||
    !window.originalWords[end - 1]
  )
    throw new Error('WINDOW_BOUNDARY_INVALID');
  const segment = request.sourceRequest.segmentSnapshot.find(
    (s) => s.ref === segmentRef,
  );
  if (!segment) throw new Error('UNKNOWN_SEGMENT');
  const originalRange =
    window.sourceRef +
    ':' +
    window.originalWords[start - 1] +
    '-' +
    window.originalWords[end - 1];
  const resolved = resolveContentAttachmentSourceContextRange(
    request.sourceRequest as ContentAttachmentSourceContextRequest,
    originalRange,
    segment.excerptRef,
  );
  if (currentOnly) {
    if (resolved.basis !== 'direct') throw new Error('CURRENT_SOURCE_MISMATCH');
    const source = request.sourceRequest.wordEvidence.sources.find(
      (s) => s.ref === resolved.sourceRef,
    )!;
    const offset = request.sourceRequest.contextBindings.sources.find(
      (b) => b.ref === source.ref,
    )!.charStart;
    const selected = source.words.filter(
      (w) =>
        w.charStart >= resolved.charStart - offset &&
        w.charEnd <= resolved.charEnd - offset,
    );
    if (
      selected.some(
        (w) =>
          !segment.evidence.some(
            (e) => w.charStart >= e.charStart && w.charEnd <= e.charEnd,
          ),
      )
    )
      throw new Error('OUTSIDE_CURRENT_SEGMENT');
  }
  const binding = request.sourceRequest.contextBindings.sources.find(
    (b) => b.ref === resolved.sourceRef,
  )!;
  return {
    ...resolved,
    windowRange: range,
    originalRange,
    sourceRefs: binding.sourceRefs,
    pdfPageNo: binding.pdfPageNo,
    logicalPageRange: binding.logicalPageRange,
    resourceId: binding.resourceId,
  };
}

/** Project a verified ordered chain by slicing original text, without editing model selections. */
export function projectContentAttachmentEvidenceWindowChain(
  request: ContentAttachmentEvidenceWindowRequest,
  ranges: string[],
  segmentRef: string,
  currentOnly = false,
) {
  if (!ranges.length) throw new Error('EMPTY_WINDOW_CHAIN');
  const selections = ranges.map((range) =>
    resolveContentAttachmentEvidenceWindowRange(
      request,
      range,
      segmentRef,
      currentOnly,
    ),
  );
  const first = selections[0];
  for (let i = 1; i < selections.length; i++) {
    const before = selections[i - 1],
      next = selections[i];
    if (next.sourceRef !== first.sourceRef)
      throw new Error('DIFFERENT_ORIGINAL_SOURCE');
    const previousEnd = Number(before.originalRange.match(/-W(\d+)$/)![1]);
    const nextStart = Number(next.originalRange.match(/:W(\d+)-/)![1]);
    if (nextStart <= previousEnd) throw new Error('NONMONOTONIC_CHAIN');
    if (nextStart !== previousEnd + 1)
      throw new Error('NONCONTIGUOUS_ORIGINAL_WORDS');
  }
  const binding = request.sourceRequest.contextBindings.sources.find(
    (b) => b.ref === first.sourceRef,
  )!;
  const charEnd = selections.at(-1)!.charEnd;
  return {
    sourceRef: first.sourceRef,
    resourceKey: first.resourceKey,
    field: first.field,
    charStart: first.charStart,
    charEnd,
    text: binding.text.slice(
      first.charStart - binding.charStart,
      charEnd - binding.charStart,
    ),
    selections,
  };
}
