import type * as Shared from '@heripo/shared';

import { Output } from 'ai';
import { expect, test, vi } from 'vitest';

import { inspectContentAttachmentRecipients } from './inspection';
import { fixture } from './recipients.test-fixture';
import { createContentAttachmentRecipientRequest } from './request';
import { createContentAttachmentSegmentationRequest } from './segmentation';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

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
