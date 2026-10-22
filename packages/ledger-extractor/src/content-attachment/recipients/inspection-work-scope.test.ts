import type * as Shared from '@heripo/shared';

import { LLMCaller } from '@heripo/shared';
import { Output } from 'ai';
import { expect, test, vi } from 'vitest';

import { inspectContentAttachmentRecipients } from './inspection';
import { fixture, workFixture } from './recipients.test-fixture';
import { createContentAttachmentRecipientRequest } from './request';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

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
