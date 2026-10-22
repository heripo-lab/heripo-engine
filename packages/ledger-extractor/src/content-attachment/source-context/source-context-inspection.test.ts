import type { Audit } from './source-context-inspection.test-fixture';

import { expect, test, vi } from 'vitest';

import { inspectContentAttachmentRecipients } from '../recipients/inspection';
import { createContentAttachmentRecipientRequest } from '../recipients/request';
import { corruptions, fixture } from './source-context-inspection.test-fixture';

test('validates new caption and cell evidence without changing the raw response or segmentation', async () => {
  const f = await fixture();
  const before = JSON.stringify(f.audit),
    segBefore = JSON.stringify(f.segmentation);
  const noNetwork = vi.fn(() => {
    throw new Error('Network forbidden');
  });
  vi.stubGlobal('fetch', noNetwork);
  const result = await f.run();
  expect(result.issues).toEqual([]);
  expect(result.findings).toHaveLength(1);
  expect(
    result.derivedResponse!.decisions[f.ref].attachments.map(
      (a) => a.candidateRef,
    ),
  ).toEqual(['R1']);
  expect(
    result.sourceRanges.find((r) => r.range === f.contextRange),
  ).toMatchObject({
    field: 'fullText',
    text: '표 9 조사 일지',
    resourceKey: '/tables/0/caption',
    charStart: 0,
    charEnd: 9,
  });
  expect(result.sourceRanges.every((r) => r.segmentRef === f.ref)).toBe(true);
  expect(JSON.stringify(f.audit)).toBe(before);
  expect(JSON.stringify(f.segmentation)).toBe(segBefore);
  expect(noNetwork).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  const legacy = createContentAttachmentRecipientRequest(
    f.input,
    f.segmentation,
    'segment-recipients.v25',
  );
  const raw = structuredClone(f.audit.rawResponse);
  const oldContext = f.segmentation.wordEvidence.sources.find((s) =>
    s.ref.startsWith('X'),
  )!;
  const replace = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(replace)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replace(x)]))
        : v === f.contextRange
          ? `${oldContext.ref}:W1-W${oldContext.words.length}`
          : v;
  const legacyAudit = {
    ...f.audit,
    ...legacy,
    rawResponse: replace(raw) as Audit['rawResponse'],
  };
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, legacyAudit)
      .issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, {
      ...f.audit,
      version: 'segment-recipients.v25',
    }).issues,
  ).toEqual(['Invalid recipient response, request or source snapshot']);
});

test('supports no extra context and preserves native text fragments and absolute offsets', async () => {
  const f = await fixture(false, false);
  expect((await f.run()).issues).toEqual([]);
  f.audit.rawResponse.decisions[f.ref].qualifierAssessment!.scopeWordRanges = [
    f.contextRange,
  ];
  expect((await f.run()).issues).toEqual([]);
});

for (const [label, mutate] of corruptions)
  test(`rejects ${label} before returning any findings without repairing raw data`, async () => {
    const f = await fixture();
    mutate(f.audit);
    const raw = JSON.stringify(f.audit.rawResponse);
    const result = await f.run();
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.findings).toEqual([]);
    expect(result.sourceRanges).toEqual([]);
    expect(result.derivedResponse).toBeUndefined();
    expect(JSON.stringify(f.audit.rawResponse)).toBe(raw);
  });

for (const range of ['X999:W1-W1', 'X17:W1-W999', 'X17:W4-W1'])
  test(`keeps other segments after a bad selected range ${range}`, async () => {
    const f = await fixture(true);
    f.audit.rawResponse.decisions[f.ref].areaAssessments.R1.contextWordRanges =
      [range.replace('X17', f.context)];
    const before = JSON.stringify(f.audit.rawResponse);
    const result = await f.run();
    expect(result.issues).toHaveLength(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].segmentRef).not.toBe(f.ref);
    expect(result.sourceRanges.every((r) => r.segmentRef !== f.ref)).toBe(true);
    expect(JSON.stringify(f.audit.rawResponse)).toBe(before);
  });

test('rejects X as current evidence and keeps all new ranges in collective and work checks', async () => {
  const f = await fixture();
  const d = f.audit.rawResponse.decisions[f.ref];
  d.areaAssessments.R1.currentWordRanges = [f.contextRange];
  expect((await f.run()).issues[0]).toContain('area assessment');
  d.areaAssessments.R1.currentWordRanges =
    f.request.segmentSnapshot[0].evidence.map((e) => e.range);
  d.workScopeAssessment!.currentWordRanges = [f.contextRange];
  expect((await f.run()).issues[0]).toContain('work scope');
  d.workScopeAssessment!.currentWordRanges =
    d.areaAssessments.R1.currentWordRanges;
  d.collectiveAssessment!.currentWordRanges = [f.contextRange];
  expect((await f.run()).issues).toHaveLength(1);
  d.collectiveAssessment!.currentWordRanges = [];
  expect((await f.run()).issues).toEqual([]);
  d.workScopeAssessment!.targetGroups[0].operationCoverage.supportingWordRanges.push(
    f.contextRange,
  );
  expect((await f.run()).issues).toEqual([]);
  d.relationshipSubjectAlternatives.push({
    role: 'subject',
    candidateRefs: ['R1'],
    currentWordRanges: d.areaAssessments.R1.currentWordRanges,
    contextWordRanges: [f.contextRange],
    candidateEvidenceRefs: d.areaAssessments.R1.candidateEvidenceRefs,
    originRowRefs: [],
  });
  expect((await f.run()).issues).toEqual([]);
});

test('reports schema errors without altering the original raw object', async () => {
  const f = await fixture();
  delete (
    f.audit.rawResponse.decisions[f.ref] as Partial<
      (typeof f.audit.rawResponse.decisions)[string]
    >
  ).areaAssessments;
  const before = JSON.stringify(f.audit.rawResponse);
  const result = await f.run();
  expect(result.issues[0]).toContain('Invalid recipient response');
  expect(result.findings).toEqual([]);
  expect(JSON.stringify(f.audit.rawResponse)).toBe(before);
});

test('checks the trusted original independently from a self-consistent archived request', async () => {
  const f = await fixture();
  f.document.tables[0].caption!.fullText = 'different original';
  f.refresh();
  expect((await f.run()).issues[0]).toContain('Original context table');
  const g = await fixture();
  g.document.chapters[0].textBlocks[4].text = 'different original';
  g.refresh();
  expect((await g.run()).issues[0]).toContain('Original context');
});
