import type { AttachmentUnit, ContentAttachmentPlan } from '../types';
import type { ContentAttachmentThinCompilation } from './compile';
import type { ContentAttachmentThinRequest } from './prompt';

import { createContentAttachmentThinInput } from './compile';
import { createContentAttachmentThinRequest } from './prompt';

export interface ContentAttachmentThinAudit {
  request: ContentAttachmentThinRequest;
  rawResponse: unknown;
}
/** One evidence range resolved to its original words and UTF-16 span. */
export interface ContentAttachmentThinEvidence {
  range: string;
  sourceRef: string;
  resourceKey: string;
  field: 'text' | 'caption';
  originalWords: string[];
  charStart: number;
  charEnd: number;
}
export interface ContentAttachmentThinDecision {
  segment: string;
  kind: 'attach' | 'none';
  /** Individual refs plus handle members, minus explicit exclusions, in registry order. */
  recipients: string[];
  handles: string[];
  excluded: string[];
  recipientIdentityAlternatives: string[][];
  relationshipSubjectAlternatives: string[][];
  evidence: ContentAttachmentThinEvidence[];
}
export interface ContentAttachmentThinInspection {
  /** Request or structural problems; decisions of segments named here are left out. */
  issues: string[];
  /** Non-blocking observations about otherwise valid decisions. */
  findings: string[];
  decisions: ContentAttachmentThinDecision[];
}

const RANGE = /^Q(\d+):L(\d+)-L(\d+)$/;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');
const isGroupArray = (v: unknown): v is string[][] =>
  Array.isArray(v) && v.every(isStringArray);

/** Original text, key and field behind every E and X ref of a compiled unit. */
function sourceTexts(unit: AttachmentUnit) {
  const texts = new Map<
    string,
    { resourceKey: string; field: 'text' | 'caption'; text: string }
  >();
  unit.sources.forEach((s, i) =>
    texts.set(`E${i + 1}`, {
      resourceKey: s.resource.key,
      field: 'text',
      text: s.resource.data.text,
    }),
  );
  unit.readOnlyContext.forEach((c, i) =>
    texts.set(`X${i + 1}`, {
      resourceKey: c.resourceKey,
      field: 'text',
      text: c.text,
    }),
  );
  for (const t of unit.tables)
    if (t.data.caption?.fullText)
      texts.set(`X${texts.size - unit.sources.length + 1}`, {
        resourceKey: t.key,
        field: 'caption',
        text: t.data.caption.fullText,
      });
  return texts;
}

function sameRequest(
  a: ContentAttachmentThinRequest,
  b: ContentAttachmentThinRequest,
) {
  return (
    a.version === b.version &&
    a.systemPrompt === b.systemPrompt &&
    a.userPrompt === b.userPrompt &&
    JSON.stringify(a.providerOutputSchema) ===
      JSON.stringify(b.providerOutputSchema)
  );
}

/**
 * Inspect one raw thin response against its recompiled request. The raw response is never changed.
 * A request that differs from the recompiled one invalidates the whole audit; a structurally invalid
 * segment is reported and left out, while the other segments are interpreted independently.
 */
export function inspectContentAttachmentThinResponse(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
  audit: ContentAttachmentThinAudit,
): ContentAttachmentThinInspection {
  const compilation: ContentAttachmentThinCompilation =
    createContentAttachmentThinInput(plan, unit);
  if (
    !sameRequest(audit.request, createContentAttachmentThinRequest(compilation))
  )
    return {
      issues: ['request differs from the recompiled request'],
      findings: [],
      decisions: [],
    };
  const { codeMap } = compilation;
  const d = isObject(audit.rawResponse) ? audit.rawResponse.d : undefined;
  if (!isObject(d))
    return {
      issues: ['response has no decision object d'],
      findings: [],
      decisions: [],
    };

  const issues: string[] = [];
  const findings: string[] = [];
  const decisions: ContentAttachmentThinDecision[] = [];
  for (const key of Object.keys(d))
    if (!codeMap.segments.includes(key))
      issues.push(`${key}: unexpected segment`);
  const candidates = new Set(codeMap.candidateRefs);
  const handles = new Map(codeMap.handles.map((h) => [h.ref, h.members]));
  const windows = new Map(codeMap.windows.map((w) => [w.ref, w]));
  const texts = sourceTexts(unit);
  const registryOrder = plan.registry.map((r) => r.ref);

  for (const segment of codeMap.segments) {
    const value = d[segment];
    const problems: string[] = [];
    if (!isObject(value)) {
      issues.push(`${segment}: missing decision`);
      continue;
    }
    if (value.k === 'n') {
      if (Object.keys(value).length !== 1)
        issues.push(`${segment}: none decision has extra fields`);
      else
        decisions.push({
          segment,
          kind: 'none',
          recipients: [],
          handles: [],
          excluded: [],
          recipientIdentityAlternatives: [],
          relationshipSubjectAlternatives: [],
          evidence: [],
        });
      continue;
    }
    const fields = ['k', 'r', 'h', 'x', 'ia', 'sa', 'e'];
    const { r, h, x, ia, sa, e } = value;
    if (
      value.k !== 'a' ||
      Object.keys(value).length !== fields.length ||
      !fields.every((f) => f in value) ||
      !isStringArray(r) ||
      !isStringArray(h) ||
      !isStringArray(x) ||
      !isGroupArray(ia) ||
      !isGroupArray(sa) ||
      !isStringArray(e)
    ) {
      issues.push(`${segment}: malformed decision`);
      continue;
    }
    for (const ref of [...r, ...ia.flat(), ...sa.flat()])
      if (!candidates.has(ref)) problems.push(`unknown candidate ${ref}`);
    for (const ref of h)
      if (!handles.has(ref)) problems.push(`unknown handle ${ref}`);
    for (const ref of x)
      if (!h.some((hr) => handles.get(hr)?.includes(ref)))
        problems.push(`exclusion ${ref} is not a member of a returned handle`);
    const evidence: ContentAttachmentThinEvidence[] = [];
    for (const range of e) {
      const m = RANGE.exec(range);
      const w = m && windows.get(`Q${m[1]}`);
      const a = Number(m?.[2]);
      const b = Number(m?.[3]);
      if (!w || a < 1 || a > b || b > w.originalWords.length) {
        problems.push(`invalid range ${range}`);
        continue;
      }
      const source = texts.get(w.sourceRef)!;
      const offsets = [...source.text.matchAll(/\S+/g)];
      const originalWords = w.originalWords.slice(a - 1, b);
      const first = offsets[Number(originalWords[0].slice(1)) - 1];
      const last = offsets[Number(originalWords.at(-1)!.slice(1)) - 1];
      evidence.push({
        range,
        sourceRef: w.sourceRef,
        resourceKey: source.resourceKey,
        field: source.field,
        originalWords,
        charStart: first.index,
        charEnd: last.index + last[0].length,
      });
    }
    if (problems.length) {
      issues.push(...problems.map((p) => `${segment}: ${p}`));
      continue;
    }
    const members = new Set([
      ...r,
      ...h.flatMap((hr) => handles.get(hr)!).filter((m) => !x.includes(m)),
    ]);
    const recipients = registryOrder.filter((ref) => members.has(ref));
    if (!recipients.length && !ia.length && !sa.length)
      findings.push(`${segment}: attachment decision without targets`);
    if (new Set(e).size !== e.length)
      findings.push(`${segment}: repeated evidence range`);
    for (let i = 0; i < evidence.length; i++)
      for (let j = i + 1; j < evidence.length; j++) {
        const p = evidence[i];
        const q = evidence[j];
        if (
          p.range !== q.range &&
          p.sourceRef === q.sourceRef &&
          p.charStart < q.charEnd &&
          q.charStart < p.charEnd
        )
          findings.push(
            `${segment}: overlapping evidence ${p.range} ${q.range}`,
          );
      }
    decisions.push({
      segment,
      kind: 'attach',
      recipients,
      handles: h,
      excluded: x,
      recipientIdentityAlternatives: ia,
      relationshipSubjectAlternatives: sa,
      evidence,
    });
  }
  return { issues, findings: [...new Set(findings)], decisions };
}
