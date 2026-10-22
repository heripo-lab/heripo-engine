import type * as Shared from '@heripo/shared';

import type { ContentAttachmentWorkScopeAssessment } from './work-scope';

import { LLMCaller } from '@heripo/shared';
import { Output } from 'ai';
import { expect, test, vi } from 'vitest';

import { inspectContentAttachmentRecipients } from './inspection';
import {
  fixture,
  inclusiveSchema,
  providerSchemaIssues,
} from './recipients.test-fixture';
import { createContentAttachmentRecipientRequest } from './request';
import { CONTENT_ATTACHMENT_WORK_GROUP_RELEVANCE_POLICY } from './work-scope';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

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
