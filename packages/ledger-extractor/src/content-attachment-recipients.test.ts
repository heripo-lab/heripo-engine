import type * as Shared from '@heripo/shared';

import type { ContentAttachmentCollectiveTrace } from './content-attachment-collective-trace';
import type { ContentAttachmentRecipientAudit } from './content-attachment-recipients';
import type { ContentAttachmentSegmentationAudit } from './content-attachment-segmentation';

import { LLMCaller, createAuditedModel } from '@heripo/shared';
import { Output } from 'ai';
import { expect, test, vi } from 'vitest';

import {
  createContentAttachmentRecipientRequest,
  inspectContentAttachmentRecipients,
  judgeContentAttachmentRecipients,
} from './content-attachment-recipients';
import { createContentAttachmentSegmentationRequest } from './content-attachment-segmentation';

type Input = Parameters<typeof createContentAttachmentRecipientRequest>[0];
vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));
function fixture(
  version?: Parameters<typeof createContentAttachmentRecipientRequest>[2],
) {
  const excerpts = [
    ['E1', 'text', ['C1'], null, '범위 측량. TR1 제토.'],
    ['E2', 'text', ['C1'], null, '도로 수혈 존재. 도로 연결.'],
    ['E3', 'text', ['C1'], null, '앞 문맥.'],
  ];
  const grounds = ['시굴범위', '트렌치 1'].map((quote, i) => ({
    sourceId: 'K' + i,
    resourceKey: '/candidate/' + i,
    resourceId: null,
    sourceRefs: [],
    pdfPageNo: 1,
    logicalPageRange: { startPageNo: 0, endPageNo: 0 },
    quote,
    charStart: 0,
    charEnd: quote.length,
  }));
  const input = {
    payload: {
      contexts: { C1: ['Survey'] },
      PRIVATE_EXPECTED: 'Do not transmit',
      candidates: grounds.map((g, i) => [
        `R${i + 1}`,
        'area',
        'C1',
        g.quote,
        null,
        [[`K${i + 1}.1`, g.quote]],
      ]),
      current: {
        excerpts,
        bodyBlocks: [['P1', ['E1', 'E2', 'E3']]],
        readOnlyContext: [],
        tables: [],
        tableCellColumns: [],
        registrationDecisions: [],
      },
      originTables: [
        { ref: 'U1', contexts: ['C1'], caption: 'Inventory', headers: [] },
      ],
      inventoryMembers: [['U1', ['R1', 'R2']]],
      originRows: [
        ['O1', 'U1', 1, []],
        ['O2', 'U1', 2, []],
      ],
      originAnchors: [
        ['R2', 'O1', 0],
        ['R1', 'O2', 0],
      ],
    },
    codeMap: {
      candidateRows: grounds.map((g, i) => ({
        ref: `R${i + 1}`,
        evidence: [g],
      })),
      excerpts: excerpts.map((e) => ({
        ref: e[0],
        evidence: [
          {
            ...grounds[0],
            sourceId: e[0],
            resourceKey: '/' + e[0],
            quote: e[4],
            charStart: 0,
            charEnd: (e[4] as string).length,
          },
        ],
      })),
      supportingBody: [],
    },
    PRIVATE_PRIOR_ANSWER: ['R1'],
  } as unknown as Input;
  const segmentation: ContentAttachmentSegmentationAudit = {
    ...createContentAttachmentSegmentationRequest(input, ['E1', 'E2']),
    rawResponse: {
      segments: {
        E1: [{ wordRanges: ['E1:W1-W2'] }, { wordRanges: ['E1:W3-W4'] }],
        E2: [{ wordRanges: ['E2:W1-W3'] }, { wordRanges: ['E2:W4-W5'] }],
      },
    },
    usage: {} as never,
    callAttempts: [],
  };
  const request = createContentAttachmentRecipientRequest(
    input,
    segmentation,
    version,
  );
  const support = (candidateRef: string, range: string) => ({
    candidateRef,
    currentWordRanges: [range],
    contextWordRanges: ['E3:W1-W2'],
    candidateEvidenceRefs: [candidateRef === 'R1' ? 'K1.1' : 'K2.1'],
    originRowRefs: [] as string[],
  });
  const trace: ContentAttachmentCollectiveTrace = {
    collectiveAssessment: {
      state: 'not_collective',
      currentWordRanges: [],
      contextWordRanges: [],
      reason: 'Direct source description.',
    },
    qualifierAssessment: {
      periodWordRanges: [],
      typeWordRanges: [],
      scopeWordRanges: [],
      reason: 'No qualifier needed.',
    },
    inventoryMembershipLinks: [],
  };
  const empty = {
    ...trace,
    attachments: [],
    recipientIdentityAlternatives: [],
    relationshipSubjectAlternatives: [],
    reason: 'Source-grounded disposition.',
  };
  const audit: ContentAttachmentRecipientAudit = {
    ...request,
    rawResponse: {
      decisions: {
        'E1:S1': { ...empty, attachments: [support('R1', 'E1:W1-W2')] },
        'E1:S2': {
          ...empty,
          attachments: [
            { ...support('R2', 'E1:W3-W4'), originRowRefs: ['O1'] },
          ],
        },
        'E2:S1': {
          ...empty,
          attachments: [support('R1', 'E2:W1-W3'), support('R2', 'E2:W1-W3')],
        },
        'E2:S2': {
          ...empty,
          relationshipSubjectAlternatives: [
            {
              role: 'subject' as const,
              candidateRefs: ['R1', 'R2'],
              currentWordRanges: ['E2:W4-W5'],
              contextWordRanges: ['E2:W1-W3'],
              candidateEvidenceRefs: ['K1.1', 'K2.1'],
              originRowRefs: ['O1'],
            },
          ],
        },
      },
    },
    usage: {} as never,
    callAttempts: [],
  };
  for (const segment of request.segmentSnapshot) {
    audit.rawResponse.decisions[segment.ref] = structuredClone(
      audit.rawResponse.decisions[segment.ref],
    );
    audit.rawResponse.decisions[segment.ref].inventoryReviews = {
      U1: {
        decision: 'rejected',
        currentWordRanges: segment.evidence.map((e) => e.range),
        contextWordRanges: [],
        ...(request.version === 'segment-recipients.v3'
          ? { inventoryContextRefs: ['C1'] }
          : {}),
        candidateEvidenceRefs: [],
        originRowRefs: [],
        reason: 'Direct work or relationship, not an inventory collective.',
      },
    };
  }
  return { input, segmentation, request, audit, support };
}

test('keeps every registry candidate, original contexts and exact segments without exposing code locators or earlier answers', async () => {
  const { input, segmentation, request, audit } = fixture();
  const before = JSON.stringify({ input, segmentation, audit });
  const p = JSON.parse(request.userPrompt);
  expect(p.registry.candidates).toEqual(input.payload.candidates);
  expect(p.current.map((e: { ref: string }) => e.ref)).toEqual(['E1', 'E2']);
  expect(p.sourceContext.sources[0].words).toEqual([
    ['W1', '앞'],
    ['W2', '문맥.'],
  ]);
  expect(request.userPrompt).not.toContain('PRIVATE_PRIOR_ANSWER');
  expect(request.userPrompt).not.toContain('PRIVATE_EXPECTED');
  expect(request.userPrompt).not.toContain('/candidate/');
  const inspected = inspectContentAttachmentRecipients(
    input,
    segmentation,
    audit,
  );
  expect(inspected.issues).toEqual([]);
  expect(inspected.findings[0].attachments[0].currentEvidence[0].text).toBe(
    '범위 측량.',
  );
  expect(inspected.findings[3].attachments).toEqual([]);
  expect(
    inspected.findings[3].relationshipSubjectAlternatives[0].candidateRefs,
  ).toEqual(['R1', 'R2']);
  expect(JSON.stringify({ input, segmentation, audit })).toBe(before);
  const format = await Output.object({ schema: request.schema }).responseFormat;
  const check = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ('$ref' in node) expect(Object.keys(node)).toEqual(['$ref']);
    expect(node).not.toHaveProperty('allOf');
    Object.values(node).forEach(check);
  };
  check(format);
});

test('requires every segment key and separates valid recipient uncertainty from relationship uncertainty', () => {
  const { input, segmentation, audit, request, support } = fixture();
  const missing = structuredClone(audit.rawResponse);
  delete (missing.decisions as Record<string, unknown>)['E1:S1'];
  expect(request.schema.safeParse(missing).success).toBe(false);
  const attachment = support('R2', 'E1:W1-W2');
  const { candidateRef, ...evidence } = attachment;
  audit.rawResponse.decisions['E1:S1'].attachments = [];
  audit.rawResponse.decisions['E1:S1'].recipientIdentityAlternatives = [
    { ...evidence, candidateRefs: [candidateRef] },
  ] as never;
  const result = inspectContentAttachmentRecipients(input, segmentation, audit);
  expect(result.issues).toEqual([]);
  expect(
    result.findings[0].recipientIdentityAlternatives[0].candidateRefs,
  ).toEqual(['R2']);
});

test('rejects invalid sources, empty registry and mismatched or duplicate original candidate quote bindings', () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.segmentation.systemPrompt = 'tampered';
    },
    (f: ReturnType<typeof fixture>) => {
      f.input.payload.candidates = [];
    },
    (f: ReturnType<typeof fixture>) => {
      f.input.codeMap.candidateRows = [];
    },
    (f: ReturnType<typeof fixture>) => {
      f.input.codeMap.candidateRows[0].ref = 'other';
    },
    (f: ReturnType<typeof fixture>) => {
      f.input.codeMap.candidateRows[0].evidence = [];
    },
    (f: ReturnType<typeof fixture>) => {
      f.input.codeMap.candidateRows[0].evidence[0].quote = 'changed';
    },
    (f: ReturnType<typeof fixture>) => {
      (
        f.input.payload.candidates as unknown as [
          string,
          string,
          string,
          string,
          null,
          [string, string][],
        ][]
      )[1][5][0][0] = 'K1.1';
    },
    (f: ReturnType<typeof fixture>) => {
      f.input.payload.current.excerpts = f.input.payload.current.excerpts.map(
        (e) => [e[0], e[1], e[2], e[3], ' '] as const,
      );
      f.input.codeMap.excerpts.forEach((e) => {
        e.evidence[0].quote = ' ';
        e.evidence[0].charEnd = 1;
      });
      f.segmentation = {
        ...createContentAttachmentSegmentationRequest(f.input, ['E1']),
        rawResponse: { segments: { E1: [] } },
        usage: {} as never,
        callAttempts: [],
      };
    },
  ]) {
    const f = fixture();
    mutate(f);
    expect(() =>
      createContentAttachmentRecipientRequest(f.input, f.segmentation),
    ).toThrow();
    expect(
      inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit),
    ).toEqual({ issues: ['Invalid recipient source input'], findings: [] });
  }
});

test('rejects forged response, request and provenance snapshots rather than repairing them', () => {
  for (const field of [
    'version',
    'systemPrompt',
    'userPrompt',
    'segmentSnapshot',
    'candidateEvidence',
    'rawResponse',
  ] as const) {
    const { input, segmentation, audit } = fixture();
    (audit as unknown as Record<string, unknown>)[field] = 'tampered';
    expect(
      inspectContentAttachmentRecipients(input, segmentation, audit),
    ).toEqual({
      issues: ['Invalid recipient response, request or source snapshot'],
      findings: [],
    });
  }
});

test('rejects duplicate/conflicting recipients and fabricated, out-of-segment or foreign evidence without changing raw responses', () => {
  type Fixture = ReturnType<typeof fixture>;
  for (const mutate of [
    (f: Fixture) => {
      f.audit.rawResponse.decisions['E1:S1'].attachments.push(
        f.support('R1', 'E1:W1-W2'),
      );
    },
    (f: Fixture) => {
      const { candidateRef, ...s } = f.support('R1', 'E1:W1-W2');
      f.audit.rawResponse.decisions['E1:S1'].recipientIdentityAlternatives = [
        { ...s, candidateRefs: [candidateRef] },
      ] as never;
    },
    (f: Fixture) => {
      f.audit.rawResponse.decisions[
        'E2:S2'
      ].relationshipSubjectAlternatives[0].candidateRefs = ['R1', 'R1'];
    },
    (f: Fixture) => {
      f.audit.rawResponse.decisions[
        'E1:S1'
      ].attachments[0].candidateEvidenceRefs = ['K1.1', 'K1.1'];
    },
    (f: Fixture) => {
      f.audit.rawResponse.decisions['E1:S1'].attachments[0].currentWordRanges =
        ['E1:W1-W2', 'E1:W1-W2'];
    },
    (f: Fixture) => {
      f.audit.rawResponse.decisions['E1:S1'].attachments[0].contextWordRanges =
        ['E3:W1-W2', 'E3:W1-W2'];
    },
    (f: Fixture) => {
      f.audit.rawResponse.decisions['E1:S2'].attachments[0].originRowRefs = [
        'O1',
        'O1',
      ];
    },
    (f: Fixture) => {
      f.audit.rawResponse.decisions['E1:S1'].attachments[0].currentWordRanges =
        ['E3:W1-W1'];
    },
    (f: Fixture) => {
      f.audit.rawResponse.decisions['E1:S1'].attachments[0].currentWordRanges =
        ['E1:W3-W4'];
    },
    (f: Fixture) => {
      f.audit.rawResponse.decisions['E1:S1'].attachments[0].contextWordRanges =
        ['E3:W99-W99'];
    },
    (f: Fixture) => {
      f.audit.rawResponse.decisions[
        'E1:S1'
      ].attachments[0].candidateEvidenceRefs = ['unknown'];
    },
    (f: Fixture) => {
      f.audit.rawResponse.decisions[
        'E1:S1'
      ].attachments[0].candidateEvidenceRefs = ['K2.1'];
    },
    (f: Fixture) => {
      f.audit.rawResponse.decisions[
        'E2:S2'
      ].relationshipSubjectAlternatives[0].candidateEvidenceRefs = ['K1.1'];
    },
    (f: Fixture) => {
      f.audit.rawResponse.decisions['E1:S1'].attachments[0].originRowRefs = [
        'unknown',
      ];
    },
    (f: Fixture) => {
      f.audit.rawResponse.decisions['E1:S1'].attachments[0].originRowRefs = [
        'O1',
      ];
    },
  ]) {
    const f = fixture();
    mutate(f);
    const before = JSON.stringify(f.audit);
    expect(
      inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit)
        .issues,
    ).toHaveLength(1);
    expect(JSON.stringify(f.audit)).toBe(before);
  }
});

test('makes only the recipient call and preserves its original response, attempts and usage', async () => {
  const { input, segmentation, audit } = fixture();
  const usage = { inputTokens: 12, outputTokens: 6, totalTokens: 18 } as never;
  vi.mocked(LLMCaller.call).mockResolvedValue({
    output: audit.rawResponse,
    usage,
    usedFallback: false,
  });
  const onAttempt = vi.fn(),
    model = {} as never,
    abortSignal = new AbortController().signal;
  const result = await judgeContentAttachmentRecipients(input, segmentation, {
    model,
    maxRetries: 0,
    onAttempt,
    abortSignal,
  });
  expect(createAuditedModel).toHaveBeenCalledWith(model, onAttempt);
  expect(LLMCaller.call).toHaveBeenCalledTimes(1);
  expect(LLMCaller.call).toHaveBeenCalledWith(
    expect.objectContaining({
      phase: 'segment-recipients',
      maxRetries: 0,
      abortSignal,
    }),
  );
  expect(result.rawResponse).toBe(audit.rawResponse);
  expect(result.usage).toBe(usage);
  expect(result.callAttempts).toEqual([]);
  expect(
    inspectContentAttachmentRecipients(input, segmentation, result).issues,
  ).toEqual([]);
});

function collectiveFixture() {
  const f = fixture();
  const members = Object.fromEntries(
    ['R1', 'R2'].map((ref, i) => [
      ref,
      {
        candidateEvidenceRefs: [`K${i + 1}.1`],
        originRowRefs: [i ? 'O1' : 'O2'],
        periodStatus: 'compatible',
        typeStatus: 'compatible',
        tentativeClassification: 'preserved',
        membership: 'linked',
        disposition: 'included',
        reason: 'Original membership with current qualifiers.',
      },
    ]),
  );
  const trace: ContentAttachmentCollectiveTrace = {
    collectiveAssessment: {
      state: 'collective',
      currentWordRanges: ['E2:W1-W3'],
      contextWordRanges: ['E3:W1-W2'],
      reason: 'Source-established set.',
    },
    qualifierAssessment: {
      periodWordRanges: ['E2:W1-W1'],
      typeWordRanges: ['E2:W1-W2'],
      scopeWordRanges: ['E3:W1-W2'],
      reason: 'Current restriction.',
    },
    inventoryMembershipLinks: [
      {
        inventoryRef: 'U1',
        contextWordRanges: ['E3:W1-W2'],
        members,
        reason: 'Original inventory for this account.',
      },
    ] as ContentAttachmentCollectiveTrace['inventoryMembershipLinks'],
  };
  trace.inventoryReviews = {
    U1: {
      ...f.audit.rawResponse.decisions['E2:S1'].inventoryReviews!.U1,
      decision: 'accepted',
      candidateEvidenceRefs: ['K1.1', 'K2.1'],
      originRowRefs: ['O1', 'O2'],
      reason: 'Original inventory connects this collective.',
    },
  };
  Object.assign(f.audit.rawResponse.decisions['E2:S1'], trace);
  return { ...f, trace };
}

test('requires every intermediate field and every original member of the model-selected inventory without choosing that inventory in input', async () => {
  const f = collectiveFixture();
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
  for (const field of [
    'collectiveAssessment',
    'qualifierAssessment',
    'inventoryMembershipLinks',
    'inventoryReviews',
  ]) {
    const raw = structuredClone(f.audit.rawResponse);
    delete (raw.decisions['E2:S1'] as unknown as Record<string, unknown>)[
      field
    ];
    expect(f.request.schema.safeParse(raw).success).toBe(false);
  }
  const raw = structuredClone(f.audit.rawResponse);
  delete raw.decisions['E2:S1'].inventoryMembershipLinks![0].members.R2;
  expect(f.request.schema.safeParse(raw).success).toBe(false);
  const format = await Output.object({ schema: f.request.schema })
    .responseFormat;
  const check = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    expect(v).not.toHaveProperty('allOf');
    if ('$ref' in v) expect(Object.keys(v)).toEqual(['$ref']);
    Object.values(v).forEach(check);
  };
  check(format);
});

test('replays original v1 responses exactly and rejects unsupported request versions', () => {
  const f = fixture();
  const old = createContentAttachmentRecipientRequest(
    f.input,
    f.segmentation,
    'segment-recipients.v1',
  );
  const raw = structuredClone(f.audit.rawResponse);
  for (const d of Object.values(raw.decisions)) {
    delete d.inventoryReviews;
    delete d.collectiveAssessment;
    delete d.qualifierAssessment;
    delete d.inventoryMembershipLinks;
  }
  const audit = { ...f.audit, ...old, rawResponse: raw };
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, audit).issues,
  ).toEqual([]);
  expect(f.request.systemPrompt.startsWith(old.systemPrompt + '\n')).toBe(true);
  expect(f.request.userPrompt).toBe(old.userPrompt);
  expect(f.request.schema.safeParse(raw).success).toBe(false);
  expect(() =>
    createContentAttachmentRecipientRequest(
      f.input,
      f.segmentation,
      'unknown' as never,
    ),
  ).toThrow('Unsupported recipient version');
});

test('supports body-only collectives without inventing an inventory and rejects any table selection for an empty registry', async () => {
  const f = fixture();
  f.input.payload.inventoryMembers = [];
  f.input.payload.originTables = [];
  for (const d of Object.values(f.audit.rawResponse.decisions))
    d.inventoryReviews = {};
  const req = createContentAttachmentRecipientRequest(f.input, f.segmentation);
  Object.assign(f.audit, req);
  const d = f.audit.rawResponse.decisions['E1:S1'];
  d.collectiveAssessment = {
    state: 'uncertain',
    currentWordRanges: ['E1:W1-W2'],
    contextWordRanges: [],
    reason: 'Body-only bounded description.',
  };
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
  const raw = structuredClone(f.audit.rawResponse);
  raw.decisions['E1:S1'].inventoryMembershipLinks = [
    {
      inventoryRef: 'invented',
      contextWordRanges: [],
      members: {},
      reason: 'Invented.',
    },
  ];
  expect(req.schema.safeParse(raw).success).toBe(false);
  const format = await Output.object({ schema: req.schema }).responseFormat;
  expect(format?.type).toBe('json');
});

test('checks intermediate dispositions independently and reconciles included, unresolved, excluded and overlapping inventory votes without repair', () => {
  const f = collectiveFixture(),
    d = f.audit.rawResponse.decisions['E2:S1'];
  const member = d.inventoryMembershipLinks![0].members.R2;
  member.disposition = 'unresolved';
  member.membership = 'unresolved';
  member.periodStatus = 'unresolved';
  d.attachments = d.attachments.filter((a) => a.candidateRef !== 'R2');
  const { candidateRef, ...support } = f.support('R2', 'E2:W1-W3');
  d.recipientIdentityAlternatives = [
    { ...support, candidateRefs: [candidateRef] },
  ];
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
  member.disposition = 'excluded';
  member.typeStatus = 'incompatible';
  d.recipientIdentityAlternatives = [];
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
  f.input.payload.inventoryMembers.push(['U2', ['R2']]);
  f.input.payload.originTables.push({
    ref: 'U2',
    contexts: ['C1'],
    caption: 'Other',
    headers: [],
  });
  for (const decision of Object.values(f.audit.rawResponse.decisions)) {
    decision.inventoryReviews!.U2 = {
      ...decision.inventoryReviews!.U1,
      decision: 'rejected',
      candidateEvidenceRefs: [],
      originRowRefs: [],
    };
  }
  f.input.payload.originRows.push(['O3', 'U2', 1, []]);
  f.input.payload.originAnchors.push(['R2', 'O3', 0]);
  Object.assign(
    f.audit,
    createContentAttachmentRecipientRequest(f.input, f.segmentation),
  );
  d.inventoryMembershipLinks!.push({
    inventoryRef: 'U2',
    contextWordRanges: [],
    members: {
      R2: {
        ...member,
        disposition: 'included',
        typeStatus: 'compatible',
        membership: 'linked',
        originRowRefs: ['O3'],
      },
    },
    reason: 'Overlapping inventory.',
  });
  d.inventoryReviews!.U2.decision = 'accepted';
  d.attachments.push(f.support('R2', 'E2:W1-W3'));
  const before = JSON.stringify(f.audit);
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
  expect(JSON.stringify(f.audit)).toBe(before);
});

test('rejects forged intermediate source links, incomplete support and contradictions without substituting final answers', () => {
  type F = ReturnType<typeof collectiveFixture>;
  const member = (f: F) => f.trace.inventoryMembershipLinks[0].members.R1;
  for (const mutate of [
    (f: F) => {
      f.trace.collectiveAssessment.currentWordRanges = [];
    },
    (f: F) => {
      f.trace.collectiveAssessment.state = 'not_collective';
    },
    (f: F) => {
      f.trace.collectiveAssessment.currentWordRanges = ['E2:W1-W3', 'E2:W1-W3'];
    },
    (f: F) => {
      f.trace.collectiveAssessment.currentWordRanges = ['E3:W1-W1'];
    },
    (f: F) => {
      f.trace.collectiveAssessment.currentWordRanges = ['E2:W4-W5'];
    },
    (f: F) => {
      f.trace.qualifierAssessment.periodWordRanges = ['E2:W99-W99'];
    },
    (f: F) => {
      f.trace.inventoryMembershipLinks.push(
        f.trace.inventoryMembershipLinks[0],
      );
    },
    (f: F) => {
      member(f).candidateEvidenceRefs = ['K1.1', 'K1.1'];
    },
    (f: F) => {
      member(f).originRowRefs = ['O2', 'O2'];
    },
    (f: F) => {
      member(f).candidateEvidenceRefs = ['K2.1'];
    },
    (f: F) => {
      member(f).originRowRefs = ['missing'];
    },
    (f: F) => {
      member(f).originRowRefs = ['O1'];
    },
    (f: F) => {
      f.input.payload.originRows.push(['O3', 'U2', 1, []]);
      f.input.payload.originAnchors.push(['R1', 'O3', 0]);
      Object.assign(
        f.audit,
        createContentAttachmentRecipientRequest(f.input, f.segmentation),
      );
      member(f).originRowRefs = ['O3'];
    },
    (f: F) => {
      member(f).periodStatus = 'incompatible';
    },
    (f: F) => {
      member(f).typeStatus = 'incompatible';
    },
    (f: F) => {
      member(f).membership = 'not_linked';
    },
    (f: F) => {
      f.audit.rawResponse.decisions['E2:S1'].attachments = [];
    },
    (f: F) => {
      member(f).disposition = 'unresolved';
    },
    (f: F) => {
      member(f).disposition = 'excluded';
    },
  ]) {
    const f = collectiveFixture();
    mutate(f);
    const before = JSON.stringify(f.audit);
    expect(
      inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit)
        .issues,
    ).toHaveLength(1);
    expect(JSON.stringify(f.audit)).toBe(before);
  }
});

test('requires all supplied inventory reviews even for non-collectives and preserves their rejected evidence', () => {
  const f = fixture();
  const d = f.audit.rawResponse.decisions['E1:S1'];
  d.inventoryReviews!.U1.candidateEvidenceRefs = ['K1.1'];
  d.inventoryReviews!.U1.originRowRefs = ['O2'];
  const before = JSON.stringify(f.audit);
  const inspected = inspectContentAttachmentRecipients(
    f.input,
    f.segmentation,
    f.audit,
  );
  expect(inspected.issues).toEqual([]);
  expect(inspected.findings[0].collectiveTrace!.inventoryReviews).toEqual(
    d.inventoryReviews,
  );
  expect(JSON.stringify(f.audit)).toBe(before);
  for (const change of [
    (raw: typeof f.audit.rawResponse) => {
      delete raw.decisions['E1:S1'].inventoryReviews!.U1;
    },
    (raw: typeof f.audit.rawResponse) => {
      raw.decisions['E1:S1'].inventoryReviews!.invented =
        d.inventoryReviews!.U1;
    },
    (raw: typeof f.audit.rawResponse) => {
      raw.decisions['E1:S1'].inventoryReviews!.U1.currentWordRanges = [];
    },
  ]) {
    const raw = structuredClone(f.audit.rawResponse);
    change(raw);
    expect(f.request.schema.safeParse(raw).success).toBe(false);
  }
});

test('keeps original v2 request schemas and inspection independent of new inventory reviews', () => {
  const f = collectiveFixture();
  const old = createContentAttachmentRecipientRequest(
    f.input,
    f.segmentation,
    'segment-recipients.v2',
  );
  const raw = structuredClone(f.audit.rawResponse);
  for (const d of Object.values(raw.decisions)) delete d.inventoryReviews;
  const audit = { ...f.audit, ...old, rawResponse: raw };
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, audit).issues,
  ).toEqual([]);
  expect(f.request.userPrompt).toBe(old.userPrompt);
  raw.decisions['E2:S1'].inventoryMembershipLinks!.push(
    raw.decisions['E2:S1'].inventoryMembershipLinks![0],
  );
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, audit).issues,
  ).toHaveLength(1);
  expect(old.systemPrompt).toContain('an empty inventoryMembershipLinks list');
  expect(f.request.systemPrompt).toContain(
    'inventoryReviews requires every supplied original inventory key',
  );
  expect(f.request.schema.safeParse(raw).success).toBe(false);
});

test('retains uncertain table connections and body-only collective conclusions without adopting memberships', () => {
  const f = fixture(),
    d = f.audit.rawResponse.decisions['E1:S1'];
  d.inventoryReviews!.U1.decision = 'uncertain';
  d.collectiveAssessment!.state = 'uncertain';
  d.collectiveAssessment!.currentWordRanges = ['E1:W1-W2'];
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
  d.collectiveAssessment!.state = 'collective';
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
  d.inventoryReviews!.U1.decision = 'rejected';
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
});

test('reports foreign inventory-review evidence and review/conclusion/membership contradictions without repair', () => {
  type F = ReturnType<typeof collectiveFixture>;
  const review = (f: F) => f.trace.inventoryReviews!.U1;
  for (const mutate of [
    (f: F) => {
      review(f).candidateEvidenceRefs = ['K1.1', 'K1.1'];
    },
    (f: F) => {
      review(f).originRowRefs = ['O1', 'O1'];
    },
    (f: F) => {
      review(f).candidateEvidenceRefs = ['foreign'];
    },
    (f: F) => {
      review(f).originRowRefs = ['foreign'];
    },
    (f: F) => {
      review(f).currentWordRanges = ['E2:W4-W5'];
    },
    (f: F) => {
      review(f).contextWordRanges = ['E3:W99-W99'];
    },
    (f: F) => {
      f.trace.collectiveAssessment.state = 'uncertain';
    },
    (f: F) => {
      review(f).decision = 'rejected';
    },
    (f: F) => {
      f.trace.inventoryMembershipLinks.length = 0;
    },
    (f: F) => {
      f.trace.collectiveAssessment.state = 'not_collective';
      f.trace.inventoryMembershipLinks.length = 0;
    },
    (f: F) => {
      review(f).decision = 'uncertain';
      f.trace.collectiveAssessment.state = 'not_collective';
      f.trace.inventoryMembershipLinks.length = 0;
    },
    (f: F) => {
      f.input.payload.inventoryMembers[0][1] = ['R1'];
      review(f).candidateEvidenceRefs = ['K2.1'];
      delete f.trace.inventoryMembershipLinks[0].members.R2;
      Object.assign(
        f.audit,
        createContentAttachmentRecipientRequest(f.input, f.segmentation),
      );
    },
  ]) {
    const f = collectiveFixture();
    mutate(f);
    const before = JSON.stringify(f.audit);
    expect(
      inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit)
        .issues,
    ).toHaveLength(1);
    expect(JSON.stringify(f.audit)).toBe(before);
  }
});

test('maps original inventory contexts in code without adding them to raw model reviews', () => {
  const f = fixture();
  const before = JSON.stringify(f.audit);
  const inspected = inspectContentAttachmentRecipients(
    f.input,
    f.segmentation,
    f.audit,
  );
  expect(inspected.issues).toEqual([]);
  for (const finding of inspected.findings) {
    expect(finding.inventoryContexts).toEqual({
      U1: { contextRefs: ['C1'], chapterPaths: [['Survey']] },
    });
    expect(finding.collectiveTrace!.inventoryReviews!.U1).not.toHaveProperty(
      'inventoryContextRefs',
    );
  }
  expect(JSON.stringify(f.audit)).toBe(before);
  const format = structuredClone(f.audit.rawResponse);
  for (const value of ['C1', 'U1']) {
    format.decisions['E1:S1'].inventoryReviews!.U1.inventoryContextRefs = [
      value,
    ];
    expect(f.request.schema.safeParse(format).success).toBe(false);
  }
  const old = createContentAttachmentRecipientRequest(
    f.input,
    f.segmentation,
    'segment-recipients.v3',
  );
  expect(f.request.userPrompt).toBe(old.userPrompt);
  const mapped = createContentAttachmentRecipientRequest(
    f.input,
    f.segmentation,
    'segment-recipients.v4',
  );
  expect(mapped.systemPrompt).toBe(
    old.systemPrompt.replace('table-owned inventoryContextRefs, ', ''),
  );
  expect(f.request.systemPrompt.startsWith(mapped.systemPrompt)).toBe(true);
});

test('replays v3 context selection and rejects its foreign or duplicate context references without mapping them', () => {
  const f = fixture('segment-recipients.v3');
  const original = JSON.stringify(f.audit);
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit)
      .findings[0],
  ).not.toHaveProperty('inventoryContexts');
  expect(JSON.stringify(f.audit)).toBe(original);
  for (const values of [['C1', 'C1'], ['foreign'], ['U1']]) {
    const audit = {
      ...f.audit,
      rawResponse: structuredClone(f.audit.rawResponse),
    };
    audit.rawResponse.decisions[
      'E1:S1'
    ].inventoryReviews!.U1.inventoryContextRefs = values;
    const before = JSON.stringify(audit);
    expect(
      inspectContentAttachmentRecipients(f.input, f.segmentation, audit).issues,
    ).toHaveLength(1);
    expect(JSON.stringify(audit)).toBe(before);
  }
  const raw = structuredClone(f.audit.rawResponse);
  delete raw.decisions['E1:S1'].inventoryReviews!.U1.inventoryContextRefs;
  expect(f.request.schema.safeParse(raw).success).toBe(false);
});

test('keeps established membership independent of unresolved individual dating and still rejects explicit period conflicts', async () => {
  const f = collectiveFixture();
  const member = f.trace.inventoryMembershipLinks[0].members.R1;
  member.periodStatus = 'unresolved';
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
  expect(member.membership).toBe('linked');
  expect(member.disposition).toBe('included');
  const old = createContentAttachmentRecipientRequest(
    f.input,
    f.segmentation,
    'segment-recipients.v4',
  );
  expect(f.request.userPrompt).toBe(old.userPrompt);
  const currentFormat = await Output.object({ schema: f.request.schema })
    .responseFormat;
  const oldFormat = await Output.object({ schema: old.schema }).responseFormat;
  expect(currentFormat).toEqual(oldFormat);
  expect(f.request.systemPrompt).toContain(
    'Do not convert chronology precision alone into recipientIdentityAlternatives',
  );
  expect(f.request.systemPrompt).toContain(
    'exclude members with explicit incompatible grounds',
  );
  const historicalAudit = { ...f.audit, ...old };
  const before = JSON.stringify(historicalAudit);
  expect(
    inspectContentAttachmentRecipients(
      f.input,
      f.segmentation,
      historicalAudit,
    ),
  ).toEqual(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit),
  );
  expect(JSON.stringify(historicalAudit)).toBe(before);
  member.periodStatus = 'incompatible';
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toHaveLength(1);
});

test('preserves v5 schemas and findings while adding only generic current-type boundaries', async () => {
  const f = collectiveFixture();
  const old = createContentAttachmentRecipientRequest(
    f.input,
    f.segmentation,
    'segment-recipients.v5',
  );
  expect(f.request.userPrompt).toBe(old.userPrompt);
  expect(f.request.systemPrompt.startsWith(old.systemPrompt)).toBe(true);
  const currentFormat = await Output.object({ schema: f.request.schema })
    .responseFormat;
  const oldFormat = await Output.object({ schema: old.schema }).responseFormat;
  expect(currentFormat).toEqual(oldFormat);
  const audit = { ...f.audit, ...old };
  const before = JSON.stringify(audit);
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, audit),
  ).toEqual(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit),
  );
  expect(JSON.stringify(audit)).toBe(before);
  const member = f.trace.inventoryMembershipLinks[0].members.R1;
  member.typeStatus = 'incompatible';
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toHaveLength(1);
  expect(member.disposition).toBe('included');
});

test('replays v6 judgments unchanged with work-event coverage added only to the current prompt', async () => {
  const f = collectiveFixture();
  const old = createContentAttachmentRecipientRequest(
    f.input,
    f.segmentation,
    'segment-recipients.v6',
  );
  expect(f.request.userPrompt).toBe(old.userPrompt);
  expect(f.request.systemPrompt.startsWith(old.systemPrompt)).toBe(true);
  const currentFormat = await Output.object({ schema: f.request.schema })
    .responseFormat;
  const oldFormat = await Output.object({ schema: old.schema }).responseFormat;
  expect(currentFormat).toEqual(oldFormat);
  const audit = { ...f.audit, ...old };
  const before = JSON.stringify(audit);
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, audit),
  ).toEqual(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit),
  );
  expect(JSON.stringify(audit)).toBe(before);
});
