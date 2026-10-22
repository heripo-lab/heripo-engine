import type { Audit } from './source-context-inspection.test-fixture';

import { Output } from 'ai';
import { expect, test } from 'vitest';

import { createContentAttachmentSourceContextRequest } from './source-context';
import {
  createContentAttachmentSourceContextReplaySnapshot,
  inspectContentAttachmentSourceContextRecipients,
} from './source-context-inspection';
import { fixture } from './source-context-inspection.test-fixture';
import { sourceContextFixture } from './source-context.test-fixture';

test('preserves captions without source references and verifies candidate-only grounds against originals', async () => {
  const base = sourceContextFixture();
  delete base.document.tables[0].captionSourceRefs;
  const document = structuredClone(base.document),
    segmentation = base.segment(),
    options = { tablePairs: [base.pair] };
  const request = createContentAttachmentSourceContextRequest(
    base.plan,
    base.unit,
    segmentation,
    options,
  );
  const f = await fixture();
  const format = await Output.object({ schema: request.schema }).responseFormat;
  if (format?.type !== 'json') throw new Error('Expected object output');
  const audit: Audit = {
    ...f.audit,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    segmentSnapshot: request.segmentSnapshot,
    candidateEvidence: request.candidateEvidence,
    providerOutputSchema: format.schema,
    wordEvidence: request.wordEvidence,
    contextBindings: request.contextBindings,
    replaySnapshot: createContentAttachmentSourceContextReplaySnapshot(
      document,
      base.plan,
      base.unit,
      segmentation,
    ),
  };
  const result = await inspectContentAttachmentSourceContextRecipients(
    document,
    base.plan,
    base.unit,
    segmentation,
    audit,
  );
  expect(result.issues).toEqual([]);
  const g = await fixture(false, false);
  g.unit.readOnlyContext = [];
  const changedSeg = g.segment();
  const changedRequest = createContentAttachmentSourceContextRequest(
    g.plan,
    g.unit,
    changedSeg,
    {},
  );
  const changedFormat = await Output.object({ schema: changedRequest.schema })
    .responseFormat;
  if (changedFormat?.type !== 'json') throw new Error('Expected object output');
  const changedAudit: Audit = {
    ...g.audit,
    ...changedRequest,
    version: 'segment-recipients.v25',
    contextOptions: {},
    providerOutputSchema: changedFormat.schema,
    replaySnapshot: createContentAttachmentSourceContextReplaySnapshot(
      g.document,
      g.plan,
      g.unit,
      changedSeg,
    ),
  };
  g.document.chapters[0].textBlocks[0].text = 'different scope definition';
  changedAudit.replaySnapshot =
    createContentAttachmentSourceContextReplaySnapshot(
      g.document,
      g.plan,
      g.unit,
      changedSeg,
    );
  expect(
    (
      await inspectContentAttachmentSourceContextRecipients(
        g.document,
        g.plan,
        g.unit,
        changedSeg,
        changedAudit,
      )
    ).issues[0],
  ).toContain('Original candidate grounds');
});

test('validates table-cell candidate grounds without changing inventory or work-group contracts', async () => {
  const f = await fixture();
  const source = f.plan.units
    .find((u) => u.pdfPageNo === 3)!
    .sources.find((s) => s.resource.key === '/tables/0/grid/1/0')!;
  const r = source.resource;
  f.plan.registry[0].mentions[0].evidence = [
    {
      sourceId: source.sourceId,
      resourceKey: r.key,
      resourceId: r.resourceId,
      sourceRefs: r.sourceRefs,
      pdfPageNo: r.pdfPageNo,
      logicalPageRange: r.logicalPageRange,
      charStart: 0,
      charEnd: r.data.text.length,
      quote: r.data.text,
    },
  ];
  const segmentation = f.segment(),
    request = createContentAttachmentSourceContextRequest(
      f.plan,
      f.unit,
      segmentation,
      { tablePairs: [f.pair] },
    ),
    format = await Output.object({ schema: request.schema }).responseFormat;
  if (format?.type !== 'json') throw new Error('Expected object output');
  const audit: Audit = {
    ...f.audit,
    ...request,
    version: 'segment-recipients.v25',
    providerOutputSchema: format.schema,
    replaySnapshot: createContentAttachmentSourceContextReplaySnapshot(
      f.document,
      f.plan,
      f.unit,
      segmentation,
    ),
  };
  const d = audit.rawResponse.decisions[f.ref];
  d.inventoryReviews = {
    U1: {
      decision: 'rejected',
      currentWordRanges: d.areaAssessments.R1.currentWordRanges,
      contextWordRanges: [f.contextRange],
      candidateEvidenceRefs: [],
      originRowRefs: [],
      reason: 'Inventory is not adopted as a collective.',
    },
  };
  d.workScopeAssessment!.groupReviews = {
    G1: {
      relevance: 'relevant',
      reason: 'One source-bound work target.',
      fullGroupAssessment: d.workScopeAssessment!.targetGroups[0],
    },
  };
  const result = await inspectContentAttachmentSourceContextRecipients(
    f.document,
    f.plan,
    f.unit,
    segmentation,
    audit,
  );
  expect(result.issues).toEqual([]);
  expect(
    result.sourceRanges.some((r) =>
      r.responsePath.includes('inventoryReviews'),
    ),
  ).toBe(true);
  expect(
    result.sourceRanges.some((r) =>
      r.responsePath.includes('fullGroupAssessment'),
    ),
  ).toBe(true);
});

test('resolves current body excerpts to absolute field offsets while retaining their local segment boundary', async () => {
  const f = await fixture(),
    unit = f.plan.units.find((u) => u.pdfPageNo === 3)!,
    segmentation = f.segment(unit, '/chapters/0/textBlocks/4', 1),
    options = { tablePairs: [f.pair] };
  const request = createContentAttachmentSourceContextRequest(
      f.plan,
      unit,
      segmentation,
      options,
    ),
    format = await Output.object({ schema: request.schema }).responseFormat;
  if (format?.type !== 'json') throw new Error('Expected object output');
  const range = request.segmentSnapshot[0].evidence[0].range,
    ref = request.segmentSnapshot[0].ref,
    caption = request.contextBindings.sources.find(
      (b) => b.field === 'fullText',
    )!,
    context = `${caption.ref}:W1-W4`;
  const replace = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(replace)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replace(x)]))
        : v === f.contextRange
          ? context
          : v === f.request.segmentSnapshot[0].evidence[0].range
            ? range
            : v;
  const decision = replace(
    f.audit.rawResponse.decisions[f.ref],
  ) as Audit['rawResponse']['decisions'][string];
  const audit: Audit = {
    ...f.audit,
    ...request,
    version: 'segment-recipients.v25',
    contextOptions: options,
    providerOutputSchema: format.schema,
    replaySnapshot: createContentAttachmentSourceContextReplaySnapshot(
      f.document,
      f.plan,
      unit,
      segmentation,
    ),
    rawResponse: { decisions: { [ref]: decision } },
  };
  const result = await inspectContentAttachmentSourceContextRecipients(
    f.document,
    f.plan,
    unit,
    segmentation,
    audit,
  );
  expect(result.issues).toEqual([]);
  const evidence = result.sourceRanges.find((r) => r.range === range)!;
  expect(evidence.charStart).toBeGreaterThan(0);
  expect(
    f.document.chapters[0].textBlocks[4].text.slice(
      evidence.charStart,
      evidence.charEnd,
    ),
  ).toBe(evidence.text);
});

test('rejects a direct selection from a sibling segment of the same E', async () => {
  const f = await fixture(),
    s = structuredClone(f.segmentation);
  const e = s.excerptRefs[0];
  s.rawResponse.segments[e] = [
    { wordRanges: [`${e}:W1-W1`] },
    { wordRanges: [`${e}:W2-W2`] },
  ];
  const request = createContentAttachmentSourceContextRequest(
      f.plan,
      f.unit,
      s,
      f.audit.contextOptions,
    ),
    format = await Output.object({ schema: request.schema }).responseFormat;
  if (format?.type !== 'json') throw new Error('Expected object output');
  const decisions = Object.fromEntries(
    request.segmentSnapshot.map((segment) => {
      const d = structuredClone(f.audit.rawResponse.decisions[f.ref]),
        ranges = segment.evidence.map((e) => e.range);
      d.areaAssessments.R1.currentWordRanges = ranges;
      d.workScopeAssessment!.currentWordRanges = ranges;
      d.workScopeAssessment!.targetGroups[0].targetIdentification.currentWordRanges =
        ranges;
      d.workScopeAssessment!.targetGroups[0].operationCoverage.supportingWordRanges =
        ranges;
      return [segment.ref, d];
    }),
  );
  decisions[
    request.segmentSnapshot[0].ref
  ].areaAssessments.R1.currentWordRanges = [`${e}:W2-W2`];
  const audit: Audit = {
    ...f.audit,
    ...request,
    version: 'segment-recipients.v25',
    providerOutputSchema: format.schema,
    replaySnapshot: createContentAttachmentSourceContextReplaySnapshot(
      f.document,
      f.plan,
      f.unit,
      s,
    ),
    rawResponse: { decisions },
  };
  const result = await inspectContentAttachmentSourceContextRecipients(
    f.document,
    f.plan,
    f.unit,
    s,
    audit,
  );
  expect(result.issues).toHaveLength(1);
  expect(result.findings.map((f) => f.segmentRef)).toEqual([
    request.segmentSnapshot[1].ref,
  ]);
});

test('replays v25 and inspects opt-in v26 with identical context and schema while rejecting mixed prompts', async () => {
  const f = await fixture();
  const oldAudit = JSON.stringify(f.audit);
  const previous = await f.run();
  const request = createContentAttachmentSourceContextRequest(
    f.plan,
    f.unit,
    f.segmentation,
    f.audit.contextOptions,
    'segment-recipients.v26',
  );
  expect(request.userPrompt).toBe(f.audit.userPrompt);
  expect(request.wordEvidence).toEqual(f.audit.wordEvidence);
  expect(request.contextBindings).toEqual(f.audit.contextBindings);
  const format = await Output.object({ schema: request.schema }).responseFormat;
  expect(format?.type).toBe('json');
  if (format?.type !== 'json') throw new Error('Expected object output');
  expect(format.schema).toEqual(f.audit.providerOutputSchema);
  const audit: Audit = {
    ...f.audit,
    version: 'segment-recipients.v26',
    systemPrompt: request.systemPrompt,
  };
  expect(
    await inspectContentAttachmentSourceContextRecipients(
      f.document,
      f.plan,
      f.unit,
      f.segmentation,
      audit,
    ),
  ).toEqual(previous);
  expect(
    (
      await inspectContentAttachmentSourceContextRecipients(
        f.document,
        f.plan,
        f.unit,
        f.segmentation,
        { ...audit, systemPrompt: f.audit.systemPrompt },
      )
    ).issues,
  ).toEqual([
    'Invalid source-context audit: Source-context request snapshot differs',
  ]);
  expect(JSON.stringify(f.audit)).toBe(oldAudit);
});
