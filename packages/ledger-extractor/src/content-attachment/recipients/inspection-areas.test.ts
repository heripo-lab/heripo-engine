import type * as Shared from '@heripo/shared';

import { LLMCaller } from '@heripo/shared';
import { Output } from 'ai';
import { expect, test, vi } from 'vitest';

import { inspectContentAttachmentRecipients } from './inspection';
import {
  areaFixture,
  collectiveFixture,
  fixture,
} from './recipients.test-fixture';
import { createContentAttachmentRecipientRequest } from './request';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

test('requires every area judgment and its own grounds and reason even for non-work or excluded recipients', () => {
  const f = areaFixture();
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
  expect(
    f.audit.rawResponse.decisions['E2:S1'].workScopeAssessment!.state,
  ).toBe('not_applicable');
  for (const mutate of [
    (raw: typeof f.audit.rawResponse) => {
      delete raw.decisions['E1:S1'].areaAssessments;
    },
    (raw: typeof f.audit.rawResponse) => {
      delete raw.decisions['E1:S1'].areaAssessments!.R1;
    },
    (raw: typeof f.audit.rawResponse) => {
      raw.decisions['E1:S1'].areaAssessments!.R2.candidateEvidenceRefs = [];
    },
    (raw: typeof f.audit.rawResponse) => {
      raw.decisions['E1:S1'].areaAssessments!.R1.candidateEvidenceRefs = [];
    },
    (raw: typeof f.audit.rawResponse) => {
      raw.decisions['E1:S1'].areaAssessments!.R2.reason = '';
    },
    (raw: typeof f.audit.rawResponse) => {
      raw.decisions['E1:S1'].areaAssessments!.foreign = structuredClone(
        raw.decisions['E1:S1'].areaAssessments!.R1,
      );
    },
  ]) {
    const raw = structuredClone(f.audit.rawResponse);
    mutate(raw);
    expect(f.request.schema.safeParse(raw).success).toBe(false);
    const audit = { ...f.audit, rawResponse: raw };
    const before = JSON.stringify(audit);
    expect(
      inspectContentAttachmentRecipients(f.input, f.segmentation, audit),
    ).toEqual({
      issues: ['Invalid recipient response, request or source snapshot'],
      findings: [],
    });
    expect(JSON.stringify(audit)).toBe(before);
  }
  expect(LLMCaller.call).not.toHaveBeenCalled();
});

test('reports area inclusion or uncertainty without direct evidence and rejects foreign or duplicate provenance', () => {
  type F = ReturnType<typeof areaFixture>;
  const cases: Array<[(f: F) => void, string]> = [
    [
      (f) => {
        f.audit.rawResponse.decisions[
          'E1:S1'
        ].areaAssessments!.R1.currentWordRanges = [];
      },
      'Area inclusion or uncertainty lacks current evidence: R1',
    ],
    [
      (f) => {
        const a = f.audit.rawResponse.decisions['E1:S1'].areaAssessments!.R1;
        a.disposition = 'unresolved';
        a.currentWordRanges = [];
      },
      'Area inclusion or uncertainty lacks current evidence: R1',
    ],
    [
      (f) => {
        f.audit.rawResponse.decisions[
          'E1:S1'
        ].areaAssessments!.R1.candidateEvidenceRefs = ['K2.1'];
      },
      'Foreign candidate grounds',
    ],
    [
      (f) => {
        f.audit.rawResponse.decisions[
          'E1:S1'
        ].areaAssessments!.R1.candidateEvidenceRefs = ['K1.1', 'K1.1'];
      },
      'Duplicate support',
    ],
    [
      (f) => {
        f.audit.rawResponse.decisions[
          'E1:S1'
        ].areaAssessments!.R2.currentWordRanges = ['E1:W3-W4'];
      },
      'Evidence outside segment',
    ],
    [
      (f) => {
        f.audit.rawResponse.decisions[
          'E1:S1'
        ].areaAssessments!.R1.contextWordRanges = ['E999:W1-W1'];
      },
      'Unknown or reversed word range',
    ],
  ];
  for (const [mutate, reason] of cases) {
    const f = areaFixture();
    mutate(f);
    const before = JSON.stringify(f.audit);
    const inspection = inspectContentAttachmentRecipients(
      f.input,
      f.segmentation,
      f.audit,
    );
    expect(inspection.issues).toEqual([
      `Invalid recipient area assessment: E1:S1: ${reason}`,
    ]);
    expect(inspection.findings).toHaveLength(3);
    expect(JSON.stringify(f.audit)).toBe(before);
  }
});

test('detects area judgment versus final attachment and identity-uncertainty conflicts without filling omissions', () => {
  type F = ReturnType<typeof areaFixture>;
  const cases: Array<[(f: F) => void, string]> = [
    [
      (f) => {
        f.audit.rawResponse.decisions['E1:S1'].attachments = [];
      },
      'R1',
    ],
    [
      (f) => {
        f.audit.rawResponse.decisions['E1:S1'].areaAssessments!.R1.disposition =
          'excluded';
      },
      'R1',
    ],
    [
      (f) => {
        f.audit.rawResponse.decisions['E1:S1'].areaAssessments!.R1.disposition =
          'unresolved';
      },
      'R1',
    ],
    [
      (f) => {
        const d = f.audit.rawResponse.decisions['E1:S1'];
        d.attachments = [];
        const { candidateRef, ...s } = f.support('R1', 'E1:W1-W2');
        d.recipientIdentityAlternatives = [
          { ...s, candidateRefs: [candidateRef] },
        ];
      },
      'R1',
    ],
    [
      (f) => {
        const { candidateRef, ...s } = f.support('R2', 'E1:W1-W2');
        f.audit.rawResponse.decisions['E1:S1'].recipientIdentityAlternatives = [
          { ...s, candidateRefs: [candidateRef] },
        ];
      },
      'R2',
    ],
  ];
  for (const [mutate, ref] of cases) {
    const f = areaFixture();
    mutate(f);
    const before = JSON.stringify(f.audit);
    const inspection = inspectContentAttachmentRecipients(
      f.input,
      f.segmentation,
      f.audit,
    );
    expect(inspection.issues).toEqual([
      `Invalid recipient area assessment: E1:S1: Area judgment and final recipients disagree: ${ref}`,
    ]);
    expect(inspection.findings.map((x) => x.segmentRef)).not.toContain('E1:S1');
    expect(JSON.stringify(f.audit)).toBe(before);
  }
});

test('preserves unresolved area grouping independently of relationship roles and retains rejected grounds', () => {
  const f = areaFixture(),
    d = f.audit.rawResponse.decisions['E2:S1'];
  d.attachments = [];
  d.recipientIdentityAlternatives = [
    {
      candidateRefs: ['R1', 'R2'],
      currentWordRanges: ['E2:W1-W3'],
      contextWordRanges: [],
      candidateEvidenceRefs: ['K1.1', 'K2.1'],
      originRowRefs: [],
    },
  ];
  for (const assessment of Object.values(d.areaAssessments!))
    assessment.disposition = 'unresolved';
  const before = JSON.stringify(f.audit);
  const result = inspectContentAttachmentRecipients(
    f.input,
    f.segmentation,
    f.audit,
  );
  expect(result.issues).toEqual([]);
  expect(
    result.findings[2].recipientIdentityAlternatives.map(
      (g) => g.candidateRefs,
    ),
  ).toEqual([['R1', 'R2']]);
  expect(result.findings[3].areaAssessments!.R1.disposition).toBe('excluded');
  expect(
    result.findings[3].relationshipSubjectAlternatives[0].candidateRefs,
  ).toEqual(['R1', 'R2']);
  expect(result.findings[0].areaAssessments!.R2).toEqual(
    f.audit.rawResponse.decisions['E1:S1'].areaAssessments!.R2,
  );
  expect(JSON.stringify(f.audit)).toBe(before);
  d.recipientIdentityAlternatives = [];
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([
    'Invalid recipient area assessment: E2:S1: Area judgment and final recipients disagree: R1',
  ]);
});

test('assesses area work independently while retaining its separate operation-coverage requirement', () => {
  const f = areaFixture(),
    d = f.audit.rawResponse.decisions['E1:S1'];
  d.workScopeAssessment = {
    state: 'operation',
    currentWordRanges: ['E1:W1-W2'],
    reason: 'Independent boundary work.',
    targetGroups: [
      {
        targetIdentification: {
          candidateRefs: ['R1'],
          currentWordRanges: ['E1:W1-W2'],
          contextWordRanges: [],
          candidateEvidenceRefs: ['K1.1'],
          originRowRefs: [],
        },
        operationCoverage: {
          state: 'established',
          supportingWordRanges: ['E1:W1-W2'],
          consideredWordRanges: [],
          reason: 'Current action names this area.',
        },
      },
    ],
  };
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
  d.workScopeAssessment.targetGroups[0].operationCoverage.supportingWordRanges =
    [];
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([
    'Invalid recipient work scope: E1:S1: Established operation lacks coverage evidence',
  ]);
});

test('derives complete area keys from the full registry, deduplicates mentions and permits an empty area set', () => {
  const f = areaFixture();
  f.input.payload.contexts.C2 = ['Other investigation chapter'];
  f.input.payload.candidates.push([
    'R1',
    'area',
    'C2',
    'Another area mention',
    null,
    [['K3.1', '부분범위 80㎡']],
  ]);
  f.input.codeMap.candidateRows.push({ ...f.input.codeMap.candidateRows[0] });
  f.input.payload.candidates.push([
    'R3',
    'feature',
    'C1',
    'Feature',
    null,
    [['K4.1', '유구 A']],
  ]);
  f.input.codeMap.candidateRows.push({
    ref: 'R3',
    groupId: 'synthetic-feature-group',
    candidateId: 'synthetic-feature-mention',
    evidence: [
      {
        ...f.input.codeMap.candidateRows[0].evidence[0],
        quote: '유구 A',
        charEnd: 4,
      },
    ],
  });
  f.input.payload.candidates.push([
    'R4',
    'area',
    'C2',
    'Outside area',
    null,
    [['K5.1', '외곽범위 50㎡']],
  ]);
  f.input.codeMap.candidateRows.push({
    ref: 'R4',
    groupId: 'synthetic-area-group',
    candidateId: 'synthetic-area-mention',
    evidence: [
      {
        ...f.input.codeMap.candidateRows[0].evidence[0],
        quote: '외곽범위 50㎡',
        charEnd: '외곽범위 50㎡'.length,
      },
    ],
  });
  const request = createContentAttachmentRecipientRequest(
    f.input,
    f.segmentation,
    f.request.version,
  );
  Object.assign(f.audit, request);
  expect(request.schema.safeParse(f.audit.rawResponse).success).toBe(false);
  for (const decision of Object.values(f.audit.rawResponse.decisions))
    decision.areaAssessments!.R4 = {
      disposition: 'excluded',
      currentWordRanges: [],
      contextWordRanges: [],
      candidateEvidenceRefs: ['K5.1'],
      reason:
        'Other area in a different chapter still receives a source-grounded review.',
    };
  expect(request.schema.safeParse(f.audit.rawResponse).success).toBe(true);
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
  const raw = structuredClone(f.audit.rawResponse);
  raw.decisions['E1:S1'].areaAssessments!.R3 = structuredClone(
    raw.decisions['E1:S1'].areaAssessments!.R1,
  );
  expect(request.schema.safeParse(raw).success).toBe(false);
  f.input.payload.candidates = f.input.payload.candidates.map((r) => [
    r[0],
    'feature',
    ...r.slice(2),
  ]);
  const emptyRequest = createContentAttachmentRecipientRequest(
    f.input,
    f.segmentation,
    f.request.version,
  );
  Object.assign(f.audit, emptyRequest);
  for (const d of Object.values(f.audit.rawResponse.decisions))
    d.areaAssessments = {};
  expect(emptyRequest.schema.safeParse(f.audit.rawResponse).success).toBe(true);
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
});

test('replays v8 source and inspection unchanged while v9 adds only required area judgments', async () => {
  const old = fixture('segment-recipients.v8');
  const before = JSON.stringify(old.audit);
  const inspected = inspectContentAttachmentRecipients(
    old.input,
    old.segmentation,
    old.audit,
  );
  expect(inspected.issues).toEqual([]);
  expect(inspected.findings[0]).not.toHaveProperty('areaAssessments');
  expect(inspected.findings[0]).toHaveProperty('workScopeAssessment');
  const current = createContentAttachmentRecipientRequest(
    old.input,
    old.segmentation,
    'segment-recipients.v9',
  );
  expect(current.version).toBe('segment-recipients.v9');
  expect(current.userPrompt).toBe(old.request.userPrompt);
  expect(current.systemPrompt.startsWith(old.request.systemPrompt)).toBe(true);
  expect(current.schema.safeParse(old.audit.rawResponse).success).toBe(false);
  const historicalFormat = await Output.object({ schema: old.request.schema })
    .responseFormat;
  expect(JSON.stringify(historicalFormat)).not.toContain('areaAssessments');
  const currentFormat = await Output.object({ schema: current.schema })
    .responseFormat;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    expect(node).not.toHaveProperty('allOf');
    if ('$ref' in node) expect(Object.keys(node)).toEqual(['$ref']);
    Object.values(node).forEach(visit);
  };
  visit(currentFormat);
  expect(JSON.stringify(old.audit)).toBe(before);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});

test('retains an independently described area outside an accepted inventory and detects its otherwise silent omission', () => {
  const f = collectiveFixture('segment-recipients.v9');
  f.input.payload.candidates[1][1] = 'feature';
  f.input.payload.inventoryMembers = [['U1', ['R2']]];
  delete f.trace.inventoryMembershipLinks[0].members.R1;
  f.trace.inventoryReviews!.U1.candidateEvidenceRefs = ['K2.1'];
  f.trace.inventoryReviews!.U1.originRowRefs = ['O1'];
  for (const d of Object.values(f.audit.rawResponse.decisions))
    delete d.areaAssessments!.R2;
  Object.assign(
    f.audit,
    createContentAttachmentRecipientRequest(
      f.input,
      f.segmentation,
      f.request.version,
    ),
  );
  const d = f.audit.rawResponse.decisions['E2:S1'];
  expect(d.workScopeAssessment!.state).toBe('not_applicable');
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
  d.attachments = d.attachments.filter((a) => a.candidateRef !== 'R1');
  const before = JSON.stringify(f.audit);
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([
    'Invalid recipient area assessment: E2:S1: Area judgment and final recipients disagree: R1',
  ]);
  expect(JSON.stringify(f.audit)).toBe(before);
});

test.each([
  ['segment-recipients.v9', 'segment-recipients.v10'],
  ['segment-recipients.v10', 'segment-recipients.v11'],
  ['segment-recipients.v11', 'segment-recipients.v12'],
  ['segment-recipients.v12', 'segment-recipients.v13'],
] as const)(
  'preserves %s schema, input and raw inspection while %s extends only interpretation',
  async (oldVersion, currentVersion) => {
    const f = fixture(currentVersion);
    const before = JSON.stringify(f.audit);
    const historical = createContentAttachmentRecipientRequest(
      f.input,
      f.segmentation,
      oldVersion,
    );
    const oldAudit = { ...f.audit, ...historical };
    const current = inspectContentAttachmentRecipients(
      f.input,
      f.segmentation,
      f.audit,
    );
    expect(f.request.version).toBe(currentVersion);
    expect(f.request.userPrompt).toBe(historical.userPrompt);
    expect(f.request.systemPrompt.startsWith(historical.systemPrompt)).toBe(
      true,
    );
    expect(f.request.systemPrompt).not.toBe(historical.systemPrompt);
    const currentFormat = await Output.object({ schema: f.request.schema })
      .responseFormat;
    const oldFormat = await Output.object({ schema: historical.schema })
      .responseFormat;
    expect(currentFormat).toEqual(oldFormat);
    expect(historical.schema.safeParse(f.audit.rawResponse).success).toBe(true);
    expect(current.issues).toEqual([]);
    expect(
      inspectContentAttachmentRecipients(f.input, f.segmentation, oldAudit),
    ).toEqual(current);
    expect(JSON.stringify(f.audit)).toBe(before);
    expect(LLMCaller.call).not.toHaveBeenCalled();
  },
);

test('adds required work reviews in v14 without changing v13 prompt, source fields or historical inspection', async () => {
  const f = fixture('segment-recipients.v14');
  const historical = createContentAttachmentRecipientRequest(
    f.input,
    f.segmentation,
    'segment-recipients.v13',
  );
  expect(f.request.systemPrompt).toBe(historical.systemPrompt);
  const { workGroupColumns, workGroups, ...source } = JSON.parse(
    f.request.userPrompt,
  );
  expect(workGroupColumns).toEqual(['ref', 'inventoryRef', 'recordKind']);
  expect(workGroups).toEqual([['G1', 'U1', 'area']]);
  expect(source).toEqual(JSON.parse(historical.userPrompt));
  expect(f.request.workGroups![0].candidateRefs).toEqual(['R1', 'R2']);
  const before = JSON.stringify(f.audit);
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
  const oldResponse = structuredClone(f.audit.rawResponse);
  for (const d of Object.values(oldResponse.decisions))
    delete d.workScopeAssessment!.groupReviews;
  expect(historical.schema.safeParse(oldResponse).success).toBe(true);
  expect(f.request.schema.safeParse(oldResponse).success).toBe(false);
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, {
      ...f.audit,
      ...historical,
      rawResponse: oldResponse,
    }).issues,
  ).toEqual([]);
  const format = await Output.object({ schema: f.request.schema })
    .responseFormat;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    expect(node).not.toHaveProperty('allOf');
    if ('$ref' in node) expect(Object.keys(node)).toEqual(['$ref']);
    Object.values(node).forEach(visit);
  };
  visit(format);
  expect(JSON.stringify(format)).toContain('groupReviews');
  expect(JSON.stringify(f.audit)).toBe(before);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});

test.each([
  'segment-recipients.v14',
  'segment-recipients.v15',
  'segment-recipients.v16',
] as const)(
  'inspects %s references per segment and preserves raw R1 when rejecting an invalid work review',
  (version) => {
    const f = fixture(version);
    f.input.payload.inventoryMembers = [['U1', ['R2']]];
    const request = createContentAttachmentRecipientRequest(
      f.input,
      f.segmentation,
      version,
    );
    Object.assign(f.audit, request);
    const d = f.audit.rawResponse.decisions['E1:S1'];
    const target = (ref: string, established: boolean) => ({
      targetIdentification: {
        candidateRefs: [ref],
        currentWordRanges: ['E1:W1-W2'],
        contextWordRanges: [],
        candidateEvidenceRefs: [ref === 'R1' ? 'K1.1' : 'K2.1'],
        originRowRefs: [],
      },
      operationCoverage: {
        state: established
          ? ('established' as const)
          : ('not_established' as const),
        supportingWordRanges: established ? ['E1:W1-W2'] : [],
        consideredWordRanges: [],
        reason: 'Synthetic source judgment.',
      },
    });
    d.workScopeAssessment = {
      state: 'operation',
      currentWordRanges: ['E1:W1-W2'],
      targetGroups: [target('R1', true), target('R2', false)],
      groupReviews: {
        G1: {
          relevance: 'relevant',
          targetGroupIndexes: [1],
          reason: 'Inspect the original registered group.',
        },
      },
      reason: 'Independent area work.',
    };
    let inspected = inspectContentAttachmentRecipients(
      f.input,
      f.segmentation,
      f.audit,
    );
    expect(inspected.issues).toEqual([]);
    expect(inspected.findings[0].attachments[0].candidateRefs).toEqual(['R1']);
    d.workScopeAssessment.groupReviews!.G1.targetGroupIndexes = [0];
    const before = JSON.stringify(f.audit);
    inspected = inspectContentAttachmentRecipients(
      f.input,
      f.segmentation,
      f.audit,
    );
    expect(inspected.issues).toEqual([
      'Invalid recipient work scope: E1:S1: G1[0]: Work group member mismatch',
    ]);
    expect(inspected.findings).toHaveLength(3);
    expect(d.attachments.map((a) => a.candidateRef)).toEqual(['R1']);
    expect(JSON.stringify(f.audit)).toBe(before);
    delete d.workScopeAssessment.groupReviews!.G1;
    expect(
      inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit)
        .issues,
    ).toEqual([
      expect.stringContaining(
        version === 'segment-recipients.v14'
          ? 'E1:S1.workScopeAssessment.groupReviews.G1'
          : 'E1:S1.workScopeAssessment',
      ),
    ]);
    expect(d.attachments.map((a) => a.candidateRef)).toEqual(['R1']);
  },
);

/** Inspect schema locations, not literal property names or source strings containing keywords. */
