import type * as Shared from '@heripo/shared';

import type { ContentAttachmentAreaRecipientDecision } from './types';

import { LLMCaller } from '@heripo/shared';
import { Output } from 'ai';
import { expect, test, vi } from 'vitest';

import { CONTENT_ATTACHMENT_AREA_RECIPIENT_ASSEMBLY_POLICY } from './area-assessments';
import { inspectContentAttachmentRecipients } from './inspection';
import {
  providerSchemaIssues,
  singleAreaFixture,
} from './recipients.test-fixture';
import { createContentAttachmentRecipientRequest } from './request';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

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
