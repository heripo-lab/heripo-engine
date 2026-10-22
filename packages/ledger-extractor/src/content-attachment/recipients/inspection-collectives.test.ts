import type * as Shared from '@heripo/shared';

import { Output } from 'ai';
import { expect, test, vi } from 'vitest';

import { inspectContentAttachmentRecipients } from './inspection';
import { collectiveFixture, fixture } from './recipients.test-fixture';
import { createContentAttachmentRecipientRequest } from './request';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

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
