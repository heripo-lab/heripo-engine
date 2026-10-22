import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';

import { inspectContentAttachmentEvidenceWindowRecipients as inspect } from './content-attachment-evidence-window-inspection';
import { createContentAttachmentEvidenceWindowRequest } from './content-attachment-evidence-windows';
import { evidenceWindowFixture } from './content-attachment-evidence-windows.test-fixture';

const run = (
  f: Awaited<ReturnType<typeof evidenceWindowFixture>>,
  audit = { request: f.request, rawResponse: f.response },
) => inspect(f.document, f.plan, f.unit, f.segmentation, audit);

test('keeps valid Q/L raw decisions while producing explicit original-source interpretations', async () => {
  const noNetwork = vi.fn(() => {
    throw new Error('Network forbidden');
  });
  vi.stubGlobal('fetch', noNetwork);
  const f = await evidenceWindowFixture(true, true);
  const before = JSON.stringify({
    request: f.request,
    response: f.response,
    segmentation: f.segmentation,
  });
  const archived = JSON.parse(
    JSON.stringify({ request: f.request, rawResponse: f.response }),
  );
  const r = await run(f, archived);
  expect(r.issues).toEqual([]);
  expect(r.findings).toHaveLength(2);
  expect(r.windowSelections.length).toBeGreaterThan(0);
  expect(r.windowSelections[0]).toMatchObject({
    segmentRef: f.segmentRef,
    field: 'text',
    basis: 'direct',
    text: '현황',
    responsePath: `decisions.${f.segmentRef}.areaAssessments.R1.currentWordRanges.0`,
  });
  expect(r.findings[0].attachments[0].currentEvidence[0].range).toMatch(
    /^E\d+:W1-W1$/,
  );
  expect(
    JSON.stringify({
      request: f.request,
      response: f.response,
      segmentation: f.segmentation,
    }),
  ).toBe(before);
  expect(noNetwork).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test('retains legal context chains, disjoint spans, reverse order and cross-field reuse without automatic joining', async () => {
  const f = await evidenceWindowFixture(true);
  const source = f.request.sourceRequest.wordEvidence.sources.find(
    (s) => s.resourceKey === '/chapters/0/textBlocks/4',
  )!;
  const ranges = f.encode(source.ref + ':W16-W35');
  const d = f.response.decisions[f.segmentRef];
  for (const evidence of [
    ranges,
    [ranges[0], ranges[2]],
    [...ranges].reverse(),
  ]) {
    d.areaAssessments.R1.contextWordRanges = evidence;
    d.workScopeAssessment!.targetGroups[0].operationCoverage.consideredWordRanges =
      evidence;
    const r = await run(f);
    expect(r.issues).toEqual([]);
    expect(
      r.windowSelections
        .filter((s) =>
          s.responsePath.includes('areaAssessments.R1.contextWordRanges'),
        )
        .map((s) => s.windowRange),
    ).toEqual(evidence);
  }
});

test('preserves the legacy allowance for direct references in context without counting them as current support', async () => {
  const f = await evidenceWindowFixture();
  const d = f.response.decisions[f.segmentRef];
  const support = d.areaAssessments.R1;
  support.contextWordRanges = [...support.currentWordRanges];
  const ok = await run(f);
  expect(ok.issues).toEqual([]);
  expect(
    ok.windowSelections.find((s) =>
      s.responsePath.includes('areaAssessments.R1.contextWordRanges'),
    )?.basis,
  ).toBe('direct');
  support.currentWordRanges = [];
  const bad = await run(f);
  expect(bad.issues.length).toBeGreaterThan(0);
  expect(bad.findings).toEqual([]);
  expect(bad.windowSelections).toEqual([]);
});

test.each([
  ['unknown-window', 'Q9999:L1-L1', 'UNKNOWN_WINDOW'],
  ['noncanonical-alias', 'Q01:L1-L1', 'MALFORMED_WINDOW_RANGE'],
  ['endpoint-overflow', 'Q1:L1-L99', 'WINDOW_BOUNDARY_INVALID'],
  ['reversed-interval', 'Q1:L2-L1', 'WINDOW_BOUNDARY_INVALID'],
  [
    'model-supplied-locator',
    { range: 'Q1:L1-L1', charStart: 0 },
    'INVALID_SELECTION_TYPE',
  ],
])(
  'rejects %s without losing another valid segment or repairing raw selections',
  async (_name, range, code) => {
    const f = await evidenceWindowFixture(false, true);
    (f.response.decisions[f.segmentRef].areaAssessments.R1
      .currentWordRanges as unknown[]) = [range];
    const before = JSON.stringify(f.response);
    const r = await run(f);
    expect(r.issues.join(' ')).toContain(code);
    expect(r.issues.join(' ')).toContain(
      'areaAssessments.R1.currentWordRanges.0',
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].segmentRef).not.toBe(f.segmentRef);
    expect(r.windowSelections.every((s) => s.segmentRef !== f.segmentRef)).toBe(
      true,
    );
    expect(JSON.stringify(f.response)).toBe(before);
  },
);

test.each([
  'duplicate',
  'overlap',
  'context-as-current',
  'outside-current-segment',
])(
  'rejects %s with its original segment and response location',
  async (kind) => {
    const f = await evidenceWindowFixture(true, true),
      d = f.response.decisions[f.segmentRef];
    let code: string;
    if (kind === 'duplicate') {
      const current = d.areaAssessments.R1.currentWordRanges[0];
      d.areaAssessments.R1.currentWordRanges = [current, current];
      code = 'DUPLICATE_WINDOW_RANGE';
    } else if (kind === 'overlap') {
      const source = f.request.sourceRequest.wordEvidence.sources.find(
        (s) => s.resourceKey === '/chapters/0/textBlocks/4',
      )!;
      d.areaAssessments.R1.contextWordRanges = [
        ...f.encode(source.ref + ':W1-W3'),
        ...f.encode(source.ref + ':W3-W5'),
      ];
      code = 'OVERLAPPING_WORD_SELECTION';
    } else if (kind === 'context-as-current') {
      const w = f.request.windows.find(
        (w) =>
          w.sourceRef.startsWith('E') &&
          w.sourceRef !== f.request.sourceRequest.segmentSnapshot[0].excerptRef,
      )!;
      d.areaAssessments.R1.currentWordRanges = [w.ref + ':L1-L1'];
      code = 'CURRENT_SOURCE_MISMATCH';
    } else {
      d.areaAssessments.R1.currentWordRanges =
        f.response.decisions[
          f.request.sourceRequest.segmentSnapshot[1].ref
        ].areaAssessments.R1.currentWordRanges;
      code = 'OUTSIDE_CURRENT_SEGMENT';
    }
    const r = await run(f);
    expect(r.issues.join(' ')).toContain(code);
    expect(r.findings).toHaveLength(1);
  },
);

test.each([
  'request-digest',
  'window-map',
  'caption-field',
  'word-offset',
  'current-segmentation',
  'different-cap',
  'provider-schema',
  'unknown-version',
])(
  'rejects mixed or tampered %s snapshots before deriving any findings',
  async (kind) => {
    const f = await evidenceWindowFixture();
    const request = structuredClone(f.request);
    if (kind === 'request-digest') request.snapshotSha256 = 'foreign';
    if (kind === 'window-map') {
      request.windows[0].sourceRef = 'X999';
      const { snapshotSha256: _, ...data } = request;
      request.snapshotSha256 = createHash('sha256')
        .update(JSON.stringify(data))
        .digest('hex');
    }
    if (kind === 'caption-field')
      request.sourceRequest.contextBindings.sources.find(
        (b) => b.field === 'fullText',
      )!.field = 'text';
    if (kind === 'word-offset')
      request.sourceRequest.wordEvidence.sources[0].words[0].charEnd--;
    if (kind === 'current-segmentation')
      request.sourceRequest.segmentSnapshot[0].evidence[0].charEnd--;
    if (kind === 'different-cap') (request.maxWindowWords as number) = 8;
    if (kind === 'provider-schema') request.providerOutputSchema = {};
    if (kind === 'unknown-version') (request.version as string) = 'foreign';
    const r = await run(f, { request, rawResponse: f.response });
    expect(r.issues.join(' ')).toContain('REQUEST_SNAPSHOT_MISMATCH');
    expect(r.findings).toEqual([]);
    expect(r.windowSelections).toEqual([]);
  },
);

test('compares trusted original text and metadata rather than trusting self-consistent archived bindings', async () => {
  const f = await evidenceWindowFixture();
  f.document.tables[0].caption!.fullText = 'Changed caption';
  const r = await run(f);
  expect(r.issues.join(' ')).toContain('Invalid evidence-window audit');
  expect(r.findings).toEqual([]);
});

test('rejects malformed roots and unknown segments, while schema errors remain local to known segments', async () => {
  const f = await evidenceWindowFixture(false, true);
  for (const raw of [
    null,
    {},
    { decisions: { foreign: {} } },
    { decisions: {}, unexpected: 1 },
  ]) {
    const r = await inspect(f.document, f.plan, f.unit, f.segmentation, {
      request: f.request,
      rawResponse: raw,
    });
    expect(r.findings).toEqual([]);
    expect(r.issues.length).toBeGreaterThan(0);
  }
  (f.response.decisions[f.segmentRef] as any).nonAreaAttachments = 'invalid';
  const r = await run(f);
  expect(r.issues.length).toBeGreaterThan(0);
  expect(r.findings).toHaveLength(1);
  delete f.response.decisions[f.segmentRef];
  const missing = await run(f);
  expect(missing.issues.length).toBeGreaterThan(0);
  expect(missing.findings).toHaveLength(1);
});

test('retains broader but structurally valid evidence without claiming it proves the intended judgment', async () => {
  const f = await evidenceWindowFixture(true);
  const source = f.request.sourceRequest.wordEvidence.sources.find(
    (s) => s.resourceKey === '/chapters/0/textBlocks/4',
  )!;
  f.response.decisions[f.segmentRef].areaAssessments.R1.contextWordRanges =
    f.encode(source.ref + ':W1-W35');
  const result = await run(f);
  expect(result.issues).toEqual([]);
  expect(result.findings).toHaveLength(1);
});

test.each(['segment-recipients.v25', 'segment-recipients.v26'] as const)(
  'replays both window versions for %s without adopting a different prompt or changing raw decisions',
  async (baseVersion) => {
    const f = await evidenceWindowFixture(true, true);
    const results = [];
    const before = JSON.stringify(f.response);
    for (const version of [
      'content-evidence-windows.v1',
      'content-evidence-windows.v2',
    ] as const) {
      const request = await createContentAttachmentEvidenceWindowRequest(
        f.document,
        f.plan,
        f.unit,
        f.segmentation,
        f.options,
        baseVersion,
        version,
      );
      const audit = JSON.parse(
        JSON.stringify({ request, rawResponse: f.response }),
      );
      const result = await run(f, audit);
      expect(result.issues).toEqual([]);
      expect(result.findings).toHaveLength(2);
      results.push(result);
      audit.request.version =
        version === 'content-evidence-windows.v1'
          ? 'content-evidence-windows.v2'
          : 'content-evidence-windows.v1';
      const mixed = await run(f, audit);
      expect(mixed.issues.join(' ')).toContain('REQUEST_SNAPSHOT_MISMATCH');
      expect(mixed.findings).toEqual([]);
    }
    expect(results[0]).toEqual(results[1]);
    expect(JSON.stringify(f.response)).toBe(before);
  },
);
