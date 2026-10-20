import type * as Shared from '@heripo/shared';

import type { ContentAttachmentCollectiveTrace } from './content-attachment-collective-trace';
import type {
  ContentAttachmentAreaRecipientDecision,
  ContentAttachmentAreaRecipientResponse,
  ContentAttachmentRecipientAudit,
} from './content-attachment-recipients';
import type { ContentAttachmentSegmentationAudit } from './content-attachment-segmentation';
import type { ContentAttachmentWorkScopeAssessment } from './content-attachment-work-scope';

import { LLMCaller, createAuditedModel } from '@heripo/shared';
import { Output } from 'ai';
import { expect, test, vi } from 'vitest';

import { CONTENT_ATTACHMENT_AREA_RECIPIENT_ASSEMBLY_POLICY } from './content-attachment-area-assessments';
import {
  CONTENT_ATTACHMENT_INVENTORY_SUPPORT_POLICY,
  CONTENT_ATTACHMENT_MAPPED_INVENTORY_REVIEW_POLICY,
} from './content-attachment-inventory-reviews';
import {
  createContentAttachmentRecipientRequest,
  inspectContentAttachmentRecipients,
  judgeContentAttachmentRecipients,
} from './content-attachment-recipients';
import { createContentAttachmentSegmentationRequest } from './content-attachment-segmentation';
import { CONTENT_ATTACHMENT_WORK_GROUP_RELEVANCE_POLICY } from './content-attachment-work-scope';

type Input = Parameters<typeof createContentAttachmentRecipientRequest>[0];
vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));
function fixture(
  version: Parameters<
    typeof createContentAttachmentRecipientRequest
  >[2] = 'segment-recipients.v8',
  workSource = '범위 측량. TR1 제토.',
  groundQuotes = ['시굴범위', '트렌치 1'],
) {
  const excerpts = [
    ['E1', 'text', ['C1'], null, workSource],
    ['E2', 'text', ['C1'], null, '도로 수혈 존재. 도로 연결.'],
    ['E3', 'text', ['C1'], null, '앞 문맥.'],
  ];
  const grounds = groundQuotes.map((quote, i) => ({
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
    if (
      request.version === 'segment-recipients.v8' ||
      request.version === 'segment-recipients.v9' ||
      request.version === 'segment-recipients.v10' ||
      request.version === 'segment-recipients.v11' ||
      request.version === 'segment-recipients.v12' ||
      request.version === 'segment-recipients.v13' ||
      request.version === 'segment-recipients.v14' ||
      request.version === 'segment-recipients.v15' ||
      request.version === 'segment-recipients.v16' ||
      request.version === 'segment-recipients.v17'
    )
      audit.rawResponse.decisions[segment.ref].workScopeAssessment = {
        ...(request.version === 'segment-recipients.v14' ||
        request.version === 'segment-recipients.v15' ||
        request.version === 'segment-recipients.v16' ||
        request.version === 'segment-recipients.v17'
          ? { groupReviews: {} }
          : {}),
        state: 'not_applicable',
        currentWordRanges: segment.evidence.map((e) => e.range),
        targetGroups: [],
        reason: 'Synthetic baseline; operation coverage is tested separately.',
      };

    if (
      request.version === 'segment-recipients.v9' ||
      request.version === 'segment-recipients.v10' ||
      request.version === 'segment-recipients.v11' ||
      request.version === 'segment-recipients.v12' ||
      request.version === 'segment-recipients.v13' ||
      request.version === 'segment-recipients.v14' ||
      request.version === 'segment-recipients.v15' ||
      request.version === 'segment-recipients.v16' ||
      request.version === 'segment-recipients.v17'
    ) {
      const decision = audit.rawResponse.decisions[segment.ref];
      decision.areaAssessments = Object.fromEntries(
        ['R1', 'R2'].map((ref, i) => {
          const included = decision.attachments.some(
            (a) => a.candidateRef === ref,
          );
          const unresolved = decision.recipientIdentityAlternatives.some((a) =>
            a.candidateRefs.includes(ref),
          );
          return [
            ref,
            {
              disposition: included
                ? 'included'
                : unresolved
                  ? 'unresolved'
                  : 'excluded',
              currentWordRanges:
                included || unresolved
                  ? segment.evidence.map((e) => e.range)
                  : [],
              contextWordRanges: [],
              candidateEvidenceRefs: [`K${i + 1}.1`],
              reason: 'Synthetic independent area disposition.',
            },
          ];
        }),
      );
    }

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
      createContentAttachmentRecipientRequest(
        f.input,
        f.segmentation,
        f.audit.version,
      ),
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
  const current = singleAreaFixture();
  const usage = { inputTokens: 12, outputTokens: 6, totalTokens: 18 } as never;
  vi.mocked(LLMCaller.call).mockResolvedValue({
    output: current.audit.rawResponse,
    usage,
    usedFallback: false,
  });
  const onAttempt = vi.fn(),
    model = {} as never,
    abortSignal = new AbortController().signal;
  const result = await judgeContentAttachmentRecipients(
    current.input,
    current.segmentation,
    {
      model,
      maxRetries: 0,
      onAttempt,
      abortSignal,
    },
  );
  expect(createAuditedModel).toHaveBeenCalledWith(model, onAttempt);
  expect(LLMCaller.call).toHaveBeenCalledTimes(1);
  expect(LLMCaller.call).toHaveBeenCalledWith(
    expect.objectContaining({
      phase: 'segment-recipients',
      maxRetries: 0,
      abortSignal,
    }),
  );
  expect(result.rawResponse).toBe(current.audit.rawResponse);
  expect(result.usage).toBe(usage);
  expect(result.callAttempts).toEqual([]);
  expect(
    inspectContentAttachmentRecipients(
      current.input,
      current.segmentation,
      result,
    ).issues,
  ).toEqual([]);
});

function collectiveFixture(
  version?: Parameters<typeof createContentAttachmentRecipientRequest>[2],
) {
  const f = fixture(version);
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
    delete d.workScopeAssessment;
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
  const req = createContentAttachmentRecipientRequest(
    f.input,
    f.segmentation,
    f.audit.version,
  );
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
    createContentAttachmentRecipientRequest(
      f.input,
      f.segmentation,
      f.audit.version,
    ),
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
        createContentAttachmentRecipientRequest(
          f.input,
          f.segmentation,
          f.audit.version,
        ),
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
  for (const d of Object.values(raw.decisions)) {
    delete d.inventoryReviews;
    delete d.workScopeAssessment;
  }
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
        createContentAttachmentRecipientRequest(
          f.input,
          f.segmentation,
          f.audit.version,
        ),
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
  const f = collectiveFixture('segment-recipients.v7');
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
  const f = collectiveFixture('segment-recipients.v7');
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
  const f = collectiveFixture('segment-recipients.v7');
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

function workFixture() {
  const f = fixture(undefined, '범위·TR1 전체측량. TR1 제토.');
  const decision = f.audit.rawResponse.decisions['E1:S1'];
  const group: ContentAttachmentWorkScopeAssessment['targetGroups'][number] = {
    targetIdentification: {
      candidateRefs: ['R1', 'R2'],
      currentWordRanges: ['E1:W1-W2'],
      contextWordRanges: ['E3:W1-W2'],
      candidateEvidenceRefs: ['K1.1', 'K2.1'],
      originRowRefs: ['O1', 'O2'],
    },
    operationCoverage: {
      state: 'established',
      supportingWordRanges: ['E1:W1-W2'],
      consideredWordRanges: ['E3:W1-W2'],
      reason: 'The current operation explicitly covers both named targets.',
    },
  };
  decision.workScopeAssessment = {
    state: 'operation',
    currentWordRanges: ['E1:W1-W2'],
    targetGroups: [group],
    reason: 'Current measurement operation, independent of inventory findings.',
  };
  decision.attachments = [
    f.support('R1', 'E1:W1-W2'),
    f.support('R2', 'E1:W1-W2'),
  ];
  return { ...f, decision, group, assessment: decision.workScopeAssessment };
}

test('requires work assessments for every segment with keyed source IDs and no additional model call', () => {
  const f = workFixture();
  expect(f.request.schema.safeParse(f.audit.rawResponse).success).toBe(true);
  const raw = structuredClone(f.audit.rawResponse);
  delete raw.decisions['E1:S1'].workScopeAssessment;
  expect(f.request.schema.safeParse(raw).success).toBe(false);
  const group = raw.decisions['E1:S2'].workScopeAssessment!;
  group.targetGroups = [structuredClone(f.group)];
  group.targetGroups[0].targetIdentification.candidateRefs = ['foreign'];
  expect(f.request.schema.safeParse(raw).success).toBe(false);
  const before = JSON.stringify(f.audit);
  const inspected = inspectContentAttachmentRecipients(
    f.input,
    f.segmentation,
    f.audit,
  );
  expect(inspected.issues).toEqual([]);
  expect(inspected.findings[0].workScopeAssessment).toEqual(f.assessment);
  expect(
    inspected.findings[0].collectiveTrace!.collectiveAssessment.state,
  ).toBe('not_collective');
  expect(JSON.stringify(f.audit)).toBe(before);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});

test('reports absent coverage evidence separately from a whole-group disposition conflict without repairing either', () => {
  for (const state of ['not_collective', 'collective'] as const) {
    const f = workFixture();
    f.decision.collectiveAssessment!.state = state;
    f.decision.collectiveAssessment!.currentWordRanges = ['E1:W1-W2'];
    f.group.operationCoverage.supportingWordRanges = [];
    const missing = JSON.stringify(f.audit);
    expect(
      inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit)
        .issues,
    ).toEqual([
      'Invalid recipient work scope: E1:S1: Established operation lacks coverage evidence',
    ]);
    expect(JSON.stringify(f.audit)).toBe(missing);
    f.group.operationCoverage.state = 'not_established';
    const conflict = JSON.stringify(f.audit);
    const inspection = inspectContentAttachmentRecipients(
      f.input,
      f.segmentation,
      f.audit,
    );
    expect(inspection.issues).toEqual([
      'Invalid recipient work scope: E1:S1: Unestablished operation attaches entire target group',
    ]);
    expect(inspection.findings.map((f) => f.segmentRef)).not.toContain('E1:S1');
    expect(inspection.findings).toHaveLength(3);
    expect(JSON.stringify(f.audit)).toBe(conflict);
  }
});

test('preserves a separately supported recipient while declining unsupported all-member expansion', () => {
  const f = workFixture();
  f.group.operationCoverage.state = 'not_established';
  f.group.operationCoverage.supportingWordRanges = [];
  f.decision.attachments = [f.support('R1', 'E1:W1-W2')];
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([
    'Invalid recipient work scope: E1:S1: Confirmed work recipient lacks established scope',
  ]);
  const direct = structuredClone(f.group);
  direct.targetIdentification.candidateRefs = ['R1'];
  direct.targetIdentification.candidateEvidenceRefs = ['K1.1'];
  direct.targetIdentification.originRowRefs = [];
  direct.operationCoverage = {
    state: 'established',
    supportingWordRanges: ['E1:W1-W1'],
    consideredWordRanges: [],
    reason: 'Independent current scope target remains described.',
  };
  f.assessment.targetGroups.push(direct);
  const before = JSON.stringify(f.audit);
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
  expect(f.decision.recipientIdentityAlternatives).toEqual([]);
  expect(f.decision.relationshipSubjectAlternatives).toEqual([]);
  expect(JSON.stringify(f.audit)).toBe(before);
  f.decision.attachments = [];
  f.assessment.targetGroups = [];
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
});

test('rejects work classification gaps, foreign target provenance and invalid coverage evidence', () => {
  type Fixture = ReturnType<typeof workFixture>;
  const cases: Array<[(f: Fixture) => void, string]> = [
    [
      (f) => {
        f.assessment.currentWordRanges = [];
      },
      'Operation lacks current evidence',
    ],
    [
      (f) => {
        f.assessment.state = 'not_applicable';
      },
      'Non-operation has task target groups',
    ],
    [
      (f) => {
        f.group.operationCoverage.state = 'not_established';
      },
      'Unestablished operation asserts supporting evidence',
    ],
    [
      (f) => {
        f.group.targetIdentification.candidateEvidenceRefs = ['foreign'];
      },
      'Foreign candidate grounds',
    ],
    [
      (f) => {
        f.group.targetIdentification.candidateEvidenceRefs = ['K1.1'];
      },
      'Missing candidate grounds',
    ],
    [
      (f) => {
        f.group.targetIdentification.originRowRefs = ['foreign'];
      },
      'Foreign origin row',
    ],
    [
      (f) => {
        f.group.targetIdentification.currentWordRanges = ['E1:W3-W4'];
      },
      'Evidence outside segment',
    ],
    [
      (f) => {
        f.group.operationCoverage.consideredWordRanges = [
          'E3:W1-W2',
          'E3:W1-W2',
        ];
      },
      'Duplicate support',
    ],
    [
      (f) => {
        f.group.operationCoverage.supportingWordRanges = ['E999:W1-W1'];
      },
      'Unknown or reversed word range',
    ],
  ];
  for (const [mutate, message] of cases) {
    const f = workFixture();
    mutate(f);
    const before = JSON.stringify(f.audit);
    const inspection = inspectContentAttachmentRecipients(
      f.input,
      f.segmentation,
      f.audit,
    );
    expect(inspection.issues).toEqual([
      `Invalid recipient work scope: E1:S1: ${message}`,
    ]);
    expect(JSON.stringify(f.audit)).toBe(before);
  }
});

test('replays v7 without work-scope fields while v8 requests preserve source input and require those fields', async () => {
  const old = fixture('segment-recipients.v7');
  const original = JSON.stringify(old.audit);
  const oldInspection = inspectContentAttachmentRecipients(
    old.input,
    old.segmentation,
    old.audit,
  );
  expect(oldInspection.issues).toEqual([]);
  expect(oldInspection.findings[0]).not.toHaveProperty('workScopeAssessment');
  const current = createContentAttachmentRecipientRequest(
    old.input,
    old.segmentation,
    'segment-recipients.v8',
  );
  expect(current.version).toBe('segment-recipients.v8');
  expect(current.userPrompt).toBe(old.request.userPrompt);
  expect(current.systemPrompt.startsWith(old.request.systemPrompt)).toBe(true);
  expect(current.schema.safeParse(old.audit.rawResponse).success).toBe(false);
  const oldFormat = await Output.object({ schema: old.request.schema })
    .responseFormat;
  expect(JSON.stringify(oldFormat)).not.toContain('workScopeAssessment');
  expect(JSON.stringify(old.audit)).toBe(original);
});

function areaFixture() {
  return fixture('segment-recipients.v9', '부분범위 측량. 전체범위 조사.', [
    '부분범위 80㎡',
    '전체범위 200㎡',
  ]);
}

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
function providerSchemaIssues(value: unknown, path = '$'): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const schema = value as Record<string, unknown>;
  const issues = [
    'oneOf',
    'allOf',
    'not',
    'dependentRequired',
    'dependentSchemas',
    'if',
    'then',
    'else',
  ]
    .filter((key) => key in schema)
    .map((key) => `${path}.${key}`);
  if (path === '$' && 'anyOf' in schema) issues.push('$.anyOf');
  if ('$ref' in schema && Object.keys(schema).length !== 1)
    issues.push(`${path}.$ref siblings`);
  for (const key of [
    'properties',
    'definitions',
    '$defs',
    'patternProperties',
    'dependentSchemas',
  ]) {
    const entries = schema[key];
    if (entries && typeof entries === 'object')
      for (const [name, child] of Object.entries(entries))
        issues.push(...providerSchemaIssues(child, `${path}.${key}.${name}`));
  }
  for (const key of [
    'items',
    'additionalProperties',
    'not',
    'if',
    'then',
    'else',
  ])
    issues.push(...providerSchemaIssues(schema[key], `${path}.${key}`));
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    const branches = schema[key];
    if (Array.isArray(branches))
      branches.forEach((child, i) =>
        issues.push(...providerSchemaIssues(child, `${path}.${key}[${i}]`)),
      );
  }
  return issues;
}

function inclusiveSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(inclusiveSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key === 'oneOf' ? 'anyOf' : key,
      inclusiveSchema(child),
    ]),
  );
}

test('changes only exclusive schema composition in v15 while preserving the v14 prompt, input, decisions and R1', async () => {
  const old = fixture('segment-recipients.v14');
  const request = createContentAttachmentRecipientRequest(
    old.input,
    old.segmentation,
    'segment-recipients.v15',
  );
  expect(request.version).toBe('segment-recipients.v15');
  expect(request.systemPrompt).toBe(old.request.systemPrompt);
  expect(request.userPrompt).toBe(old.request.userPrompt);
  const previousFormat = await Output.object({ schema: old.request.schema })
    .responseFormat;
  const currentFormat = await Output.object({ schema: request.schema })
    .responseFormat;
  const previous =
    previousFormat?.type === 'json' ? previousFormat.schema : undefined;
  const current =
    currentFormat?.type === 'json' ? currentFormat.schema : undefined;
  expect(previous).toBeDefined();
  expect(current).toBeDefined();
  expect(providerSchemaIssues(previous)).toEqual([
    '$.definitions.RecipientDecision.properties.workScopeAssessment.oneOf',
    '$.definitions.RecipientDecision.properties.workScopeAssessment.oneOf[0].properties.groupReviews.properties.G1.oneOf',
  ]);
  expect(current).toEqual(inclusiveSchema(previous));
  expect(providerSchemaIssues(current)).toEqual([]);
  const before = JSON.stringify(old.audit);
  expect(request.schema.safeParse(old.audit.rawResponse).success).toBe(true);
  const currentInspection = inspectContentAttachmentRecipients(
    old.input,
    old.segmentation,
    { ...old.audit, ...request },
  );
  expect(currentInspection).toEqual(
    inspectContentAttachmentRecipients(old.input, old.segmentation, old.audit),
  );
  expect(currentInspection.findings[0].attachments[0].candidateRefs).toEqual([
    'R1',
  ]);
  expect(JSON.stringify(old.audit)).toBe(before);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});

test.each([
  'oneOf',
  'allOf',
  'not',
  'dependentRequired',
  'dependentSchemas',
  'if',
  'then',
  'else',
])(
  'detects forbidden %s inside definitions, array items and nested union branches',
  (keyword) => {
    const synthetic = {
      type: 'object',
      properties: { decision: { $ref: '#/$defs/Decision' } },
      $defs: {
        Decision: {
          type: 'object',
          properties: {
            groups: {
              type: 'array',
              items: { anyOf: [{ type: 'null' }, { [keyword]: [] }] },
            },
          },
        },
      },
    };
    expect(providerSchemaIssues(synthetic)).toEqual([
      `$.$defs.Decision.properties.groups.items.anyOf[1].${keyword}`,
    ]);
  },
);

test('rejects a root union and reference siblings without mistaking literal keys or text for schema syntax', () => {
  expect(
    providerSchemaIssues({ anyOf: [{ type: 'string' }, { type: 'null' }] }),
  ).toEqual(['$.anyOf']);
  expect(
    providerSchemaIssues({
      type: 'object',
      properties: { nested: { $ref: '#/$defs/X', description: 'Sibling' } },
      $defs: { X: { type: 'string' } },
    }),
  ).toEqual(['$.properties.nested.$ref siblings']);
  expect(
    providerSchemaIssues({
      type: 'object',
      properties: {
        oneOf: { type: 'string', enum: ['allOf'] },
        not: {
          type: 'array',
          items: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
      definitions: { allOf: { type: 'string' } },
      description: 'oneOf is a literal here',
      additionalProperties: false,
    }),
  ).toEqual([]);
});

test('extends only the generic work relevance policy in v16 while preserving v15 input, schema, raw decisions and inspection', async () => {
  const f = fixture('segment-recipients.v16');
  const previous = createContentAttachmentRecipientRequest(
    f.input,
    f.segmentation,
    'segment-recipients.v15',
  );
  expect(f.request.systemPrompt).toBe(
    previous.systemPrompt +
      '\n' +
      CONTENT_ATTACHMENT_WORK_GROUP_RELEVANCE_POLICY,
  );
  expect(f.request.userPrompt).toBe(previous.userPrompt);
  expect(f.request.workGroups).toEqual(previous.workGroups);
  expect(
    await Output.object({ schema: f.request.schema }).responseFormat,
  ).toEqual(await Output.object({ schema: previous.schema }).responseFormat);
  const before = JSON.stringify(f.audit);
  const current = inspectContentAttachmentRecipients(
    f.input,
    f.segmentation,
    f.audit,
  );
  expect(current.issues).toEqual([]);
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, {
      ...f.audit,
      ...previous,
    }),
  ).toEqual(current);
  expect(JSON.stringify(f.audit)).toBe(before);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});

test('requires inline whole-group objects in v17 while retaining the exact v16 prompt and input', async () => {
  const f = fixture('segment-recipients.v17');
  const previous = createContentAttachmentRecipientRequest(
    f.input,
    f.segmentation,
    'segment-recipients.v16',
  );
  expect(f.request.version).toBe('segment-recipients.v17');
  expect(f.request.systemPrompt).toBe(previous.systemPrompt);
  expect(f.request.userPrompt).toBe(previous.userPrompt);
  expect(f.request.workGroups).toEqual(previous.workGroups);
  const format = await Output.object({ schema: f.request.schema })
    .responseFormat;
  expect(format?.type).toBe('json');
  expect(
    providerSchemaIssues(format?.type === 'json' ? format.schema : null),
  ).toEqual([]);
  expect(JSON.stringify(format)).toContain('fullGroupAssessment');
  expect(JSON.stringify(format)).not.toContain('targetGroupIndexes');
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});

test('inspects inline group membership, original evidence and coverage through the recipient API without repairing R1', () => {
  const f = fixture('segment-recipients.v17');
  f.input.payload.inventoryMembers = [['U1', ['R2']]];
  Object.assign(
    f.audit,
    createContentAttachmentRecipientRequest(
      f.input,
      f.segmentation,
      'segment-recipients.v17',
    ),
  );
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
      consideredWordRanges: ['E3:W1-W2'],
      reason: 'Synthetic source judgment.',
    },
  });
  d.workScopeAssessment = {
    state: 'operation',
    currentWordRanges: ['E1:W1-W2'],
    targetGroups: [target('R1', true)],
    reason: 'Independent area work.',
    groupReviews: {
      G1: {
        relevance: 'relevant',
        reason: 'Inspect the original whole group.',
        fullGroupAssessment: target('R2', false),
      },
    },
  };
  const valid = structuredClone(d.workScopeAssessment);
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([]);
  for (const [mutate, message] of [
    [
      (a: ContentAttachmentWorkScopeAssessment) => {
        a.groupReviews!.G1.fullGroupAssessment = target('R1', false);
      },
      'G1: Full work group member mismatch',
    ],
    [
      (a: ContentAttachmentWorkScopeAssessment) => {
        a.groupReviews!.G1.fullGroupAssessment!.targetIdentification.candidateEvidenceRefs =
          ['K1.1'];
      },
      'Foreign candidate grounds',
    ],
    [
      (a: ContentAttachmentWorkScopeAssessment) => {
        a.groupReviews!.G1.fullGroupAssessment!.targetIdentification.currentWordRanges =
          ['E1:W3-W4'];
      },
      'Evidence outside segment',
    ],
    [
      (a: ContentAttachmentWorkScopeAssessment) => {
        a.groupReviews!.G1.fullGroupAssessment!.operationCoverage.consideredWordRanges =
          [];
      },
      'Full work group lacks considered coverage evidence',
    ],
  ] as const) {
    d.workScopeAssessment = structuredClone(valid);
    mutate(d.workScopeAssessment);
    const before = JSON.stringify(f.audit);
    expect(
      inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit)
        .issues,
    ).toEqual([expect.stringContaining(message)]);
    expect(JSON.stringify(f.audit)).toBe(before);
  }
  d.workScopeAssessment = structuredClone(valid);
  delete d.workScopeAssessment.groupReviews!.G1.fullGroupAssessment;
  const before = JSON.stringify(f.audit);
  expect(
    inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit).issues,
  ).toEqual([
    expect.stringContaining(
      'Invalid recipient response: decisions.E1:S1.workScopeAssessment',
    ),
  ]);
  expect(JSON.stringify(f.audit)).toBe(before);
  expect(d.attachments.map((a) => a.candidateRef)).toEqual(['R1']);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});

function singleAreaFixture(
  kinds = ['area', 'feature'],
  version: Parameters<
    typeof createContentAttachmentRecipientRequest
  >[2] = 'segment-recipients.v18',
) {
  const f = fixture('segment-recipients.v17');
  f.input.payload.candidates.forEach((row, i) => {
    row[1] = kinds[i];
  });
  const request = createContentAttachmentRecipientRequest(
    f.input,
    f.segmentation,
    version,
  );
  const areas = new Set(
    f.input.payload.candidates
      .filter((r) => r[1] === 'area')
      .map((r) => r[0] as string),
  );
  const decisions: Record<string, ContentAttachmentAreaRecipientDecision> = {};
  for (const [ref, d] of Object.entries(f.audit.rawResponse.decisions)) {
    const { attachments, areaAssessments, ...rest } = structuredClone(d);
    decisions[ref] = {
      ...rest,
      nonAreaAttachments: attachments.filter((a) => !areas.has(a.candidateRef)),
      areaAssessments: Object.fromEntries(
        [...areas].map((area) => [
          area,
          {
            ...areaAssessments![area],
            originRowRefs:
              attachments.find((a) => a.candidateRef === area)?.originRowRefs ??
              [],
          },
        ]),
      ),
    };
  }
  const audit: ContentAttachmentRecipientAudit<ContentAttachmentAreaRecipientResponse> =
    {
      ...request,
      rawResponse: { decisions },
      usage: {} as never,
      callAttempts: [],
    };
  return { input: f.input, segmentation: f.segmentation, request, audit };
}

test('uses a single v18 area decision and returns a separate validated derived response with original provenance', async () => {
  const f = singleAreaFixture();
  const previous = createContentAttachmentRecipientRequest(
    f.input,
    f.segmentation,
    'segment-recipients.v17',
  );
  expect(f.request.version).toBe('segment-recipients.v18');
  expect(f.request.userPrompt).toBe(previous.userPrompt);
  expect(f.request.systemPrompt).toBe(
    previous.systemPrompt
      .replace(
        'with attachments, recipientIdentityAlternatives',
        'with nonAreaAttachments, recipientIdentityAlternatives',
      )
      .replace(
        'and never adds/removes recipients, repairs source or changes raw output.',
        'and never revises recipient judgments, repairs source or changes raw output.',
      ) +
      '\n' +
      CONTENT_ATTACHMENT_AREA_RECIPIENT_ASSEMBLY_POLICY,
  );
  const format = await Output.object({ schema: f.request.schema })
    .responseFormat;
  expect(format?.type).toBe('json');
  expect(
    providerSchemaIssues(format?.type === 'json' ? format.schema : null),
  ).toEqual([]);
  expect(JSON.stringify(format)).toContain('nonAreaAttachments');
  expect(JSON.stringify(format)).not.toContain('"attachments":');
  const rawBefore = JSON.stringify(f.audit);
  const result = inspectContentAttachmentRecipients(
    f.input,
    f.segmentation,
    f.audit,
  );
  expect(result.issues).toEqual([]);
  const d = result.derivedResponse!;
  expect(d.decisions['E1:S1'].attachments).toEqual([
    {
      candidateRef: 'R1',
      currentWordRanges: ['E1:W1-W2'],
      contextWordRanges: [],
      candidateEvidenceRefs: ['K1.1'],
      originRowRefs: [],
    },
  ]);
  expect(d.attachmentOrigins['E1:S1']).toEqual([
    { candidateRef: 'R1', field: 'areaAssessments', areaRef: 'R1' },
  ]);
  expect(d.attachmentOrigins['E1:S2']).toEqual([
    { candidateRef: 'R2', field: 'nonAreaAttachments', index: 0 },
  ]);
  expect(d.decisions['E1:S2'].attachments[0].originRowRefs).toEqual(['O1']);
  expect(d.decisions['E2:S2'].relationshipSubjectAlternatives).toEqual(
    f.audit.rawResponse.decisions['E2:S2'].relationshipSubjectAlternatives,
  );
  expect(JSON.stringify(f.audit)).toBe(rawBefore);
  d.decisions['E1:S1'].attachments[0].currentWordRanges.push('E3:W1-W2');
  expect(JSON.stringify(f.audit)).toBe(rawBefore);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});

test.each([
  [
    'missing area key',
    (d: ContentAttachmentAreaRecipientDecision) => {
      delete d.areaAssessments.R1;
    },
  ],
  [
    'extra area key',
    (d: ContentAttachmentAreaRecipientDecision) => {
      d.areaAssessments.R99 = d.areaAssessments.R1;
    },
  ],
  [
    'area in non-area list',
    (d: ContentAttachmentAreaRecipientDecision) => {
      d.nonAreaAttachments.push({
        candidateRef: 'R1',
        currentWordRanges: ['E1:W1-W2'],
        contextWordRanges: [],
        candidateEvidenceRefs: ['K1.1'],
        originRowRefs: [],
      });
    },
  ],
  [
    'unknown non-area ref',
    (d: ContentAttachmentAreaRecipientDecision) => {
      d.nonAreaAttachments.push({
        candidateRef: 'R99',
        currentWordRanges: ['E1:W1-W2'],
        contextWordRanges: [],
        candidateEvidenceRefs: ['K1.1'],
        originRowRefs: [],
      });
    },
  ],
  [
    'missing origin rows',
    (d: ContentAttachmentAreaRecipientDecision) => {
      delete (d.areaAssessments.R1 as { originRowRefs?: string[] })
        .originRowRefs;
    },
  ],
  [
    'missing own grounds',
    (d: ContentAttachmentAreaRecipientDecision) => {
      d.areaAssessments.R1.candidateEvidenceRefs = [];
    },
  ],
  [
    'duplicate legacy final field',
    (d: ContentAttachmentAreaRecipientDecision) => {
      Object.assign(d, { attachments: [] });
    },
  ],
])(
  'rejects %s in the raw v18 schema and never fabricates a derived response',
  (_, mutate) => {
    const f = singleAreaFixture();
    mutate(f.audit.rawResponse.decisions['E1:S1']);
    const before = JSON.stringify(f.audit);
    expect(f.request.schema.safeParse(f.audit.rawResponse).success).toBe(false);
    const result = inspectContentAttachmentRecipients(
      f.input,
      f.segmentation,
      f.audit,
    );
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.findings).toEqual([]);
    expect(result.derivedResponse).toBeUndefined();
    expect(JSON.stringify(f.audit)).toBe(before);
  },
);

test.each([
  [
    'missing current area support',
    (d: ContentAttachmentAreaRecipientDecision) => {
      d.areaAssessments.R1.currentWordRanges = [];
    },
    'Area inclusion or uncertainty lacks current evidence',
  ],
  [
    'foreign candidate support',
    (d: ContentAttachmentAreaRecipientDecision) => {
      d.areaAssessments.R1.candidateEvidenceRefs = ['K2.1'];
    },
    'Foreign candidate grounds',
  ],
  [
    'outside current segment',
    (d: ContentAttachmentAreaRecipientDecision) => {
      d.areaAssessments.R1.currentWordRanges = ['E1:W3-W4'];
    },
    'Evidence outside segment',
  ],
  [
    'foreign original row',
    (d: ContentAttachmentAreaRecipientDecision) => {
      d.areaAssessments.R1.originRowRefs = ['O1'];
    },
    'Foreign origin row',
  ],
  [
    'duplicate row evidence',
    (d: ContentAttachmentAreaRecipientDecision) => {
      d.areaAssessments.R1.originRowRefs = ['O2', 'O2'];
    },
    'Duplicate support',
  ],
])(
  'retains %s rejection during v18 validation and excludes the invalid derived segment',
  (_, mutate, message) => {
    const f = singleAreaFixture();
    mutate(f.audit.rawResponse.decisions['E1:S1']);
    const before = JSON.stringify(f.audit);
    expect(f.request.schema.safeParse(f.audit.rawResponse).success).toBe(true);
    const result = inspectContentAttachmentRecipients(
      f.input,
      f.segmentation,
      f.audit,
    );
    expect(result.issues).toEqual([expect.stringContaining(message)]);
    expect(result.derivedResponse!.decisions).not.toHaveProperty('E1:S1');
    expect(result.derivedResponse!.attachmentOrigins).not.toHaveProperty(
      'E1:S1',
    );
    expect(JSON.stringify(f.audit)).toBe(before);
  },
);

test('keeps unresolved mixed recipient groups and relationship subjects separate without regrouping', () => {
  const f = singleAreaFixture();
  const d = f.audit.rawResponse.decisions['E2:S1'];
  d.nonAreaAttachments = [];
  d.areaAssessments.R1.disposition = 'unresolved';
  d.recipientIdentityAlternatives = [
    {
      candidateRefs: ['R1', 'R2'],
      currentWordRanges: ['E2:W1-W3'],
      contextWordRanges: [],
      candidateEvidenceRefs: ['K1.1', 'K2.1'],
      originRowRefs: ['O1', 'O2'],
    },
  ];
  const before = JSON.stringify(f.audit);
  let result = inspectContentAttachmentRecipients(
    f.input,
    f.segmentation,
    f.audit,
  );
  expect(result.issues).toEqual([]);
  expect(
    result.derivedResponse!.decisions['E2:S1'].recipientIdentityAlternatives,
  ).toEqual(d.recipientIdentityAlternatives);
  expect(result.derivedResponse!.decisions['E2:S1'].attachments).toEqual([]);
  expect(
    result.derivedResponse!.decisions['E2:S2'].relationshipSubjectAlternatives,
  ).toEqual(
    f.audit.rawResponse.decisions['E2:S2'].relationshipSubjectAlternatives,
  );
  expect(JSON.stringify(f.audit)).toBe(before);
  d.recipientIdentityAlternatives = [];
  result = inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit);
  expect(result.issues).toEqual([
    expect.stringContaining('Area judgment and final recipients disagree: R1'),
  ]);
});

test.each(['included', 'excluded'] as const)(
  'rejects an area judged %s that also appears in recipient-identity alternatives',
  (disposition) => {
    const f = singleAreaFixture();
    const d = f.audit.rawResponse.decisions['E1:S1'];
    d.areaAssessments.R1.disposition = disposition;
    d.recipientIdentityAlternatives = [
      {
        candidateRefs: ['R1'],
        currentWordRanges: ['E1:W1-W2'],
        contextWordRanges: [],
        candidateEvidenceRefs: ['K1.1'],
        originRowRefs: [],
      },
    ];
    const result = inspectContentAttachmentRecipients(
      f.input,
      f.segmentation,
      f.audit,
    );
    expect(result.issues).toHaveLength(1);
    expect(result.derivedResponse!.decisions).not.toHaveProperty('E1:S1');
  },
);

test.each([
  ['area', 'area'],
  ['feature', 'feature'],
])(
  'handles registry kinds %j without inventing missing candidate types',
  (...kinds) => {
    const f = singleAreaFixture(kinds);
    const result = inspectContentAttachmentRecipients(
      f.input,
      f.segmentation,
      f.audit,
    );
    expect(result.issues).toEqual([]);
    if (kinds[0] === 'area') {
      const invalid = structuredClone(f.audit.rawResponse);
      invalid.decisions['E1:S1'].nonAreaAttachments = [
        {
          candidateRef: 'R1',
          currentWordRanges: ['E1:W1-W2'],
          contextWordRanges: [],
          candidateEvidenceRefs: ['K1.1'],
          originRowRefs: [],
        },
      ];
      expect(f.request.schema.safeParse(invalid).success).toBe(false);
    } else
      expect(
        result.derivedResponse!.attachmentOrigins['E2:S1'].every(
          (o) => o.field === 'nonAreaAttachments',
        ),
      ).toBe(true);
  },
);

test('preserves original area-row support and validates operation coverage against assembled area recipients', () => {
  const f = singleAreaFixture();
  f.input.payload.inventoryMembers = [];
  for (const decision of Object.values(f.audit.rawResponse.decisions))
    decision.inventoryReviews = {};
  Object.assign(
    f.audit,
    createContentAttachmentRecipientRequest(f.input, f.segmentation),
  );
  const d = f.audit.rawResponse.decisions['E1:S1'];
  d.areaAssessments.R1.originRowRefs = ['O2'];
  d.workScopeAssessment = {
    state: 'operation',
    currentWordRanges: ['E1:W1-W2'],
    targetGroups: [],
    groupReviews: {},
    reason: 'Area boundary operation.',
  };
  let result = inspectContentAttachmentRecipients(
    f.input,
    f.segmentation,
    f.audit,
  );
  expect(result.issues).toEqual([
    expect.stringContaining('Confirmed work recipient lacks established scope'),
  ]);
  expect(result.derivedResponse!.decisions).not.toHaveProperty('E1:S1');
  d.workScopeAssessment.targetGroups = [
    {
      targetIdentification: {
        candidateRefs: ['R1'],
        currentWordRanges: ['E1:W1-W2'],
        contextWordRanges: [],
        candidateEvidenceRefs: ['K1.1'],
        originRowRefs: ['O2'],
      },
      operationCoverage: {
        state: 'established',
        supportingWordRanges: ['E1:W1-W2'],
        consideredWordRanges: [],
        reason: 'Direct operation-to-area support.',
      },
    },
  ];
  result = inspectContentAttachmentRecipients(f.input, f.segmentation, f.audit);
  expect(result.issues).toEqual([]);
  expect(
    result.derivedResponse!.decisions['E1:S1'].attachments[0].originRowRefs,
  ).toEqual(['O2']);
});

test('does not pretend that deterministic area assembly corrects a semantically wrong included judgment', () => {
  const f = singleAreaFixture();
  const d = f.audit.rawResponse.decisions['E2:S2'];
  d.areaAssessments.R1 = {
    disposition: 'included',
    currentWordRanges: ['E2:W4-W5'],
    contextWordRanges: ['E2:W1-W3'],
    candidateEvidenceRefs: ['K1.1'],
    originRowRefs: [],
    reason: 'Synthetic deliberately wrong area interpretation.',
  };
  const result = inspectContentAttachmentRecipients(
    f.input,
    f.segmentation,
    f.audit,
  );
  expect(result.issues).toEqual([]);
  expect(
    result.derivedResponse!.decisions['E2:S2'].attachments.map(
      (a) => a.candidateRef,
    ),
  ).toEqual(['R1']);
  expect(d.nonAreaAttachments).toEqual([]);
});

test('adds only the independent uncertainty wording in v19 while preserving v18 input, schema and derived judgments', async () => {
  const previous = singleAreaFixture();
  const current = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v19',
  );
  const policy =
    'When the sole uncertainty is which candidate is the individual subject of a relationship, return only relationshipSubjectAlternatives; do not duplicate that uncertainty in recipientIdentityAlternatives.\n\nIf both uncertainty types are returned, ground each in a distinct unresolved source referent or independent predicate. Select its supporting evidence IDs in the existing fields and explain the distinction in the existing reason. Repeating the same uncertainty under another role does not establish a second uncertainty. Candidate overlap alone neither establishes nor invalidates two independent judgments.';
  const historicalRequest = createContentAttachmentRecipientRequest(
    current.input,
    current.segmentation,
    'segment-recipients.v19',
  );
  expect(historicalRequest.version).toBe('segment-recipients.v19');
  expect(current.request.systemPrompt).toBe(
    previous.request.systemPrompt.replace(
      '\nFor every attachment or alternative,',
      '\n' + policy + '\nFor every attachment or alternative,',
    ),
  );
  expect(historicalRequest.systemPrompt).toBe(current.request.systemPrompt);
  expect(current.request.userPrompt).toBe(previous.request.userPrompt);
  expect(current.request.segmentSnapshot).toEqual(
    previous.request.segmentSnapshot,
  );
  expect(current.request.candidateEvidence).toEqual(
    previous.request.candidateEvidence,
  );
  const oldFormat = await Output.object({ schema: previous.request.schema })
    .responseFormat;
  const newFormat = await Output.object({ schema: current.request.schema })
    .responseFormat;
  expect(newFormat).toEqual(oldFormat);
  const before = JSON.stringify(current.audit.rawResponse);
  expect(
    inspectContentAttachmentRecipients(
      current.input,
      current.segmentation,
      current.audit,
    ),
  ).toEqual(
    inspectContentAttachmentRecipients(
      previous.input,
      previous.segmentation,
      previous.audit,
    ),
  );
  expect(JSON.stringify(current.audit.rawResponse)).toBe(before);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});

function expandProviderSchema(
  value: unknown,
  definitions?: Record<string, unknown>,
): unknown {
  if (Array.isArray(value))
    return value.map((child) => expandProviderSchema(child, definitions));
  if (!value || typeof value !== 'object') return value;
  const node = value as Record<string, unknown>;
  const defs = definitions ?? (node.definitions as Record<string, unknown>);
  if (typeof node.$ref === 'string') {
    const key = node.$ref.slice('#/definitions/'.length);
    expect(defs).toHaveProperty(key);
    return expandProviderSchema(defs[key], defs);
  }
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key !== 'definitions')
      .map(([key, child]) => [key, expandProviderSchema(child, defs)]),
  );
}

test('preserves v20 wording, input and judgments while sharing equivalent provider definitions', async () => {
  const previous = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v19',
  );
  const current = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v20',
  );
  const policy =
    "Identify the current operation's source-defined targets separately from the group's membership. Return established whole-group coverage only when the operation's targets are supported as covering the full identified group. Plural wording, matching counts, method definitions or inventory membership alone do not establish this connection; no particular word is required.\n\nUse the existing evidence IDs and reason to explain the operation-to-target connection or gap. Keep group-identification grounds in targetIdentification, positive coverage grounds in supportingWordRanges, and inspected but insufficient grounds in consideredWordRanges. If whole-group coverage is not established, retain group relevance and independently supported area or subset attachments.";
  const anchor =
    '\n\nThese work-assessment rules do not narrow source-established collective findings';
  expect(current.request.systemPrompt).toBe(
    previous.request.systemPrompt.replace(anchor, '\n\n' + policy + anchor),
  );
  const historicalRequest = createContentAttachmentRecipientRequest(
    current.input,
    current.segmentation,
    'segment-recipients.v20',
  );
  expect(historicalRequest.version).toBe('segment-recipients.v20');
  expect(historicalRequest.systemPrompt).toBe(current.request.systemPrompt);
  expect(current.request.userPrompt).toBe(previous.request.userPrompt);
  expect(current.request.segmentSnapshot).toEqual(
    previous.request.segmentSnapshot,
  );
  expect(current.request.candidateEvidence).toEqual(
    previous.request.candidateEvidence,
  );
  const shared = await Output.object({ schema: current.request.schema })
    .responseFormat;
  const original = await Output.object({ schema: previous.request.schema })
    .responseFormat;
  expect(expandProviderSchema(shared)).toEqual(expandProviderSchema(original));
  expect(JSON.stringify(shared)).toContain('#/definitions/WorkTargetGroup');
  expect(JSON.stringify(shared)).toContain('#/definitions/WorkGroupReview');
  expect(JSON.stringify(original)).not.toContain('WorkGroupReview');
  const before = JSON.stringify(current.audit.rawResponse);
  expect(
    inspectContentAttachmentRecipients(
      current.input,
      current.segmentation,
      current.audit,
    ),
  ).toEqual(
    inspectContentAttachmentRecipients(
      previous.input,
      previous.segmentation,
      previous.audit,
    ),
  );
  expect(JSON.stringify(current.audit.rawResponse)).toBe(before);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});

test('adds only the approved v21 returned-work-object check while preserving v20 input, schema and inspection', async () => {
  const previous = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v20',
  );
  const current = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v21',
  );
  const policy =
    'Before returning an operation segment, cross-check every recipient in nonAreaAttachments and every included areaAssessments entry against the work-scope objects actually returned. Each must appear in targetIdentification.candidateRefs of an assessment with operationCoverage.state = established, in workScopeAssessment.targetGroups or groupReviews.*.fullGroupAssessment.\n\nFor a source-supported independent work target outside the reviewed inventory groups, return its own targetGroups assessment with positive operation evidence in the existing fields. If that assessment is missing, include it; do not remove the supported recipient or invent support to satisfy this check.\n\nPreserve the existing full-group/subset judgments and uncertainty decisions. Identity or membership evidence alone does not establish operation coverage. This check does not require work objects for not_applicable segments.';
  const request = createContentAttachmentRecipientRequest(
    current.input,
    current.segmentation,
    'segment-recipients.v21',
  );
  expect(request.version).toBe('segment-recipients.v21');
  expect(current.request.systemPrompt).toBe(
    previous.request.systemPrompt + '\n\n' + policy,
  );
  expect(request.systemPrompt).toBe(current.request.systemPrompt);
  expect(current.request.userPrompt).toBe(previous.request.userPrompt);
  expect(current.request.segmentSnapshot).toEqual(
    previous.request.segmentSnapshot,
  );
  expect(current.request.candidateEvidence).toEqual(
    previous.request.candidateEvidence,
  );
  expect(current.request.workGroups).toEqual(previous.request.workGroups);
  expect(
    await Output.object({ schema: current.request.schema }).responseFormat,
  ).toEqual(
    await Output.object({ schema: previous.request.schema }).responseFormat,
  );
  const before = JSON.stringify(current.audit.rawResponse);
  expect(
    inspectContentAttachmentRecipients(
      current.input,
      current.segmentation,
      current.audit,
    ),
  ).toEqual(
    inspectContentAttachmentRecipients(
      previous.input,
      previous.segmentation,
      previous.audit,
    ),
  );
  expect(JSON.stringify(current.audit.rawResponse)).toBe(before);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});

test('clarifies optional inventory support in v22 while preserving the v21 input, provider schema and raw inspection', async () => {
  const previous = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v21',
  );
  const current = singleAreaFixture(
    ['area', 'feature'],
    'segment-recipients.v22',
  );
  const request = createContentAttachmentRecipientRequest(
    current.input,
    current.segmentation,
  );
  expect(request.version).toBe('segment-recipients.v22');
  expect(request.systemPrompt).toBe(
    previous.request.systemPrompt.replace(
      CONTENT_ATTACHMENT_MAPPED_INVENTORY_REVIEW_POLICY,
      CONTENT_ATTACHMENT_MAPPED_INVENTORY_REVIEW_POLICY +
        '\n\n' +
        CONTENT_ATTACHMENT_INVENTORY_SUPPORT_POLICY,
    ),
  );
  expect(request.userPrompt).toBe(previous.request.userPrompt);
  expect(request.segmentSnapshot).toEqual(previous.request.segmentSnapshot);
  expect(request.candidateEvidence).toEqual(previous.request.candidateEvidence);
  expect(request.workGroups).toEqual(previous.request.workGroups);
  expect(
    await Output.object({ schema: request.schema }).responseFormat,
  ).toEqual(
    await Output.object({ schema: previous.request.schema }).responseFormat,
  );
  const before = JSON.stringify(current.audit.rawResponse);
  expect(
    inspectContentAttachmentRecipients(
      current.input,
      current.segmentation,
      current.audit,
    ),
  ).toEqual(
    inspectContentAttachmentRecipients(
      previous.input,
      previous.segmentation,
      previous.audit,
    ),
  );
  expect(JSON.stringify(current.audit.rawResponse)).toBe(before);
  expect(LLMCaller.call).not.toHaveBeenCalled();
});
