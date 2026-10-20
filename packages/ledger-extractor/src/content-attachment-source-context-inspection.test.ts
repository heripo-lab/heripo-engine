import type { ContentAttachmentSourceContextRecipientAudit } from './content-attachment-source-context-inspection';

import { Output } from 'ai';
import { expect, test, vi } from 'vitest';

import { createContentAttachmentGroundedInput } from './content-attachment-grounding';
import {
  createContentAttachmentRecipientRequest,
  inspectContentAttachmentRecipients,
} from './content-attachment-recipients';
import { createContentAttachmentSegmentationRequest } from './content-attachment-segmentation';
import { createContentAttachmentSourceContextRequest } from './content-attachment-source-context';
import {
  createContentAttachmentSourceContextReplaySnapshot,
  inspectContentAttachmentSourceContextRecipients,
} from './content-attachment-source-context-inspection';
import { sourceContextFixture } from './content-attachment-source-context.test-fixture';

type Audit = ContentAttachmentSourceContextRecipientAudit;
async function fixture(twoSegments = false, tablePairs = true) {
  const f = sourceContextFixture();
  const document = structuredClone(f.document);
  const input = createContentAttachmentGroundedInput(f.plan, f.unit);
  let segmentation = f.segment();
  if (twoSegments) {
    const refs = [segmentation.excerptRefs[0], 'E1'];
    const request = createContentAttachmentSegmentationRequest(input, refs);
    segmentation = {
      ...request,
      rawResponse: {
        segments: Object.fromEntries(
          refs.map((ref) => [
            ref,
            [
              {
                wordRanges: [
                  `${ref}:W1-W${request.wordEvidence.sources.find((s) => s.ref === ref)!.words.length}`,
                ],
              },
            ],
          ]),
        ),
      },
      usage: {} as never,
      callAttempts: [],
    };
  }
  const options = tablePairs ? { tablePairs: [f.pair] } : {};
  const request = createContentAttachmentSourceContextRequest(
    f.plan,
    f.unit,
    segmentation,
    options,
  );
  const caption = request.contextBindings.sources.find(
    (s) => s.field === 'fullText',
  );
  const context =
    caption?.ref ??
    request.wordEvidence.sources.find((s) => s.ref.startsWith('X'))!.ref;
  const contextWords = request.wordEvidence.sources.find(
    (s) => s.ref === context,
  )!.words.length;
  const contextRange = `${context}:W1-W${contextWords}`;
  const kRefs = request.candidateEvidence
    .filter((k) => k.candidateRef === 'R1')
    .map((k) => k.ref);
  const decisions = Object.fromEntries(
    request.segmentSnapshot.map((segment) => {
      const ranges = segment.evidence.map((e) => e.range);
      const direct = segment.excerptRef === segmentation.excerptRefs[0];
      const support = {
        currentWordRanges: direct ? ranges : [],
        contextWordRanges: [contextRange],
        candidateEvidenceRefs: kRefs,
        originRowRefs: [],
      };
      return [
        segment.ref,
        {
          nonAreaAttachments: [],
          areaAssessments: {
            R1: {
              disposition: direct ? 'included' : 'excluded',
              ...support,
              reason:
                'Synthetic provenance fixture, not an archaeological judgment.',
            },
          },
          recipientIdentityAlternatives: [],
          relationshipSubjectAlternatives: [],
          reason: 'Unchanged response contract fixture.',
          workScopeAssessment: {
            reason: 'Synthetic work-state fixture.',
            state: direct ? 'operation' : 'not_applicable',
            currentWordRanges: ranges,
            targetGroups: direct
              ? [
                  {
                    targetIdentification: { candidateRefs: ['R1'], ...support },
                    operationCoverage: {
                      state: 'established',
                      supportingWordRanges: ranges,
                      consideredWordRanges: [contextRange],
                      reason: 'Synthetic field/coverage consistency fixture.',
                    },
                  },
                ]
              : [],
            groupReviews: {},
          },
          collectiveAssessment: {
            state: 'not_collective',
            currentWordRanges: [],
            contextWordRanges: [contextRange],
            reason: 'No inventory adopted.',
          },
          qualifierAssessment: {
            periodWordRanges: [],
            typeWordRanges: [],
            scopeWordRanges: [],
            reason: 'No qualifiers selected.',
          },
          inventoryReviews: {},
          inventoryMembershipLinks: [],
        },
      ];
    }),
  );
  const format = await Output.object({ schema: request.schema }).responseFormat;
  if (format?.type !== 'json') throw new Error('Expected object output');
  const audit: Audit = JSON.parse(
    JSON.stringify({
      version: request.version,
      contextVersion: request.contextVersion,
      contextOptions: options,
      replaySnapshot: createContentAttachmentSourceContextReplaySnapshot(
        document,
        f.plan,
        f.unit,
        segmentation,
      ),
      providerOutputSchema: format.schema,
      wordEvidence: request.wordEvidence,
      contextBindings: request.contextBindings,
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      segmentSnapshot: request.segmentSnapshot,
      candidateEvidence: request.candidateEvidence,
      rawResponse: { decisions },
      usage: { model: 'manual-fixture' },
      callAttempts: [],
    }),
  );
  const run = () =>
    inspectContentAttachmentSourceContextRecipients(
      document,
      f.plan,
      f.unit,
      segmentation,
      audit,
    );
  const refresh = () => {
    audit.replaySnapshot = createContentAttachmentSourceContextReplaySnapshot(
      document,
      f.plan,
      f.unit,
      segmentation,
    );
  };
  return {
    ...f,
    document,
    input,
    segmentation,
    request,
    audit,
    run,
    refresh,
    context,
    contextRange,
    ref: request.segmentSnapshot[0].ref,
  };
}

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

const corruptions: Array<[string, (a: Audit) => void]> = [
  [
    'body masquerading as caption',
    (a) => {
      const b = a.contextBindings.sources[0];
      b.resourceKey = '/chapters/0/textBlocks/0/caption';
      b.field = 'fullText';
      a.wordEvidence.sources.find((s) => s.ref === b.ref)!.resourceKey =
        b.resourceKey;
    },
  ],
  [
    'field',
    (a) => {
      a.contextBindings.sources.find((s) => s.field === 'fullText')!.field =
        'text';
    },
  ],
  [
    'offset',
    (a) => {
      const b = a.contextBindings.sources.find((s) => s.field === 'fullText')!;
      b.charStart = 1;
      b.charEnd++;
    },
  ],
  [
    'negative offset',
    (a) => {
      a.contextBindings.sources[0].charStart = -1;
    },
  ],
  [
    'fractional offset',
    (a) => {
      a.contextBindings.sources[0].charStart = 0.5;
    },
  ],
  [
    'fractional end',
    (a) => {
      a.contextBindings.sources[0].charEnd = 0.5;
    },
  ],
  [
    'reversed offset',
    (a) => {
      a.contextBindings.sources[0].charEnd = -1;
    },
  ],
  [
    'past-end offset',
    (a) => {
      a.contextBindings.sources[0].charEnd = 999;
    },
  ],
  [
    'text',
    (a) => {
      a.contextBindings.sources[0].text = 'different';
    },
  ],
  [
    'word boundary',
    (a) => {
      a.wordEvidence.sources.find((s) =>
        s.resourceKey.endsWith('/caption'),
      )!.words[1].charStart = 1;
    },
  ],
  [
    'missing binding',
    (a) => {
      a.contextBindings.sources.pop();
    },
  ],
  [
    'duplicate binding',
    (a) => {
      a.contextBindings.sources[0] = a.contextBindings.sources[1];
    },
  ],
  [
    'duplicate source',
    (a) => {
      a.wordEvidence.sources[0] = a.wordEvidence.sources[1];
    },
  ],
  [
    'locator disagreement',
    (a) => {
      a.contextBindings.sources[0].resourceKey = '/missing';
    },
  ],
  [
    'unknown resource',
    (a) => {
      const b = a.contextBindings.sources[0];
      b.resourceKey = '/missing';
      a.wordEvidence.sources.find((s) => s.ref === b.ref)!.resourceKey =
        b.resourceKey;
    },
  ],
  [
    'unsupported native field',
    (a) => {
      const b = a.contextBindings.sources[0];
      b.resourceKey = '/chapters/0';
      a.wordEvidence.sources.find((s) => s.ref === b.ref)!.resourceKey =
        b.resourceKey;
    },
  ],
  [
    'native metadata',
    (a) => {
      a.contextBindings.sources[0].pdfPageNo = 99;
    },
  ],
  [
    'header',
    (a) => {
      a.contextBindings.headers[0].colSpan++;
    },
  ],
  [
    'table',
    (a) => {
      a.contextBindings.tables[0].table.data.caption = { fullText: 'invented' };
    },
  ],
  [
    'prompt mix',
    (a) => {
      a.userPrompt = 'old or unrelated request';
    },
  ],
  [
    'system prompt',
    (a) => {
      a.systemPrompt += 'changed';
    },
  ],
  [
    'segment snapshot',
    (a) => {
      a.segmentSnapshot = [];
    },
  ],
  [
    'candidate snapshot',
    (a) => {
      a.candidateEvidence = [];
    },
  ],
  [
    'provider schema',
    (a) => {
      a.providerOutputSchema = { type: 'string' };
    },
  ],
  [
    'replay snapshot',
    (a) => {
      a.replaySnapshot.documentSha256 = 'different';
    },
  ],
  [
    'wrong recipient version',
    (a) => {
      (a as { version: string }).version = 'segment-recipients.v24';
    },
  ],
  [
    'wrong context version',
    (a) => {
      (a as { contextVersion: string }).contextVersion = 'context.future';
    },
  ],
  [
    'missing context version',
    (a) => {
      delete (a as Partial<Audit>).contextVersion;
    },
  ],
  [
    'missing selection',
    (a) => {
      delete (a as Partial<Audit>).contextOptions;
    },
  ],
  [
    'invalid selection',
    (a) => {
      (a as unknown as { contextOptions: number }).contextOptions = 1;
    },
  ],
  [
    'binding snapshot',
    (a) => {
      a.wordEvidence.sources[0].originalRef = 'different';
    },
  ],
];
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
