import type * as Shared from '@heripo/shared';

import type { ContentAttachmentRequiredResponse } from '../response';

import { Output } from 'ai';
import { expect, test, vi } from 'vitest';

import { createContentAttachmentGroundedInput } from '../grounding';
import { fixture, frozenSelection } from '../grounding.test-fixture';
import { inspectContentAttachmentIndependentReview } from './independent-review-inspection';
import { createContentAttachmentIndependentReviewRequest } from './independent-review-request';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

test('retrieves cross-chapter review alternatives from source names and complete source-linked inventories without initial semantic choices', () => {
  const { plan, unit } = fixture();
  for (const [ref, name] of [
    ['alternative-campaign', 'Period A'],
    ['unrelated', 'Stone bridge'],
  ]) {
    plan.registry.push({
      ...structuredClone(plan.registry[2]),
      ref,
      groupId: ref,
      recordKind: 'feature',
      mentions: [
        {
          ...structuredClone(plan.registry[2].mentions[0]),
          candidateId: ref,
          sourceName: name,
          chapterPath: [
            { id: 'other-campaign', originTitle: 'Other campaign' },
          ],
        },
      ],
    });
  }
  const input = createContentAttachmentGroundedInput(plan, unit);
  input.payload.current.bodyBlocks = [['bounded', ['E2']]];
  const selection: ContentAttachmentRequiredResponse = {
    decisions: {
      E1: { status: 'ignored', reason: 'First answer' },
      E2: { status: 'ignored', reason: 'First answer' },
    },
  };
  const before = structuredClone({ input, selection });
  const options = { includeBodyContext: true, crossChapterAreas: true };
  const legacy = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    options,
  );
  const request = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    { ...options, sourceGroundedCoverage: true },
  );
  expect(request.systemPrompt).toBe(legacy.systemPrompt);
  expect(request.coverage).toEqual({
    version: 'source-grounded.v1',
    referentMatches: [
      {
        excerptRef: 'E1',
        contextExcerptRefs: ['E1'],
        candidateRef: 'area',
        contextRef: 'C1',
        sourceName: 'area',
      },
      {
        excerptRef: 'E2',
        contextExcerptRefs: ['E2'],
        candidateRef: 'alternative-campaign',
        contextRef: 'C2',
        sourceName: 'Period A',
      },
    ],
  });
  expect(
    request.required
      .filter((r) => r.inventoryRef === 'U1')
      .map((r) => [r.excerptRef, r.candidateRefs]),
  ).toEqual([
    ['E1', ['opaque-nine', 'opaque-two']],
    ['E2', ['opaque-nine', 'opaque-two']],
  ]);
  expect(
    request.required
      .filter((r) => r.candidateRefs.includes('alternative-campaign'))
      .map((r) => r.excerptRef),
  ).toEqual(['E2']);
  expect(
    request.required.some((r) => r.candidateRefs.includes('unrelated')),
  ).toBe(false);
  const payload = JSON.parse(request.userPrompt);
  expect(payload).not.toHaveProperty('decisions');
  expect(
    payload.candidates.some((r: string[]) => r[0] === 'alternative-campaign'),
  ).toBe(true);
  const rawResponse = {
    reviews: Object.fromEntries(
      request.required.map((r) => [
        r.key,
        Object.fromEntries(
          r.candidateRefs.map((ref) => [
            ref,
            {
              attachment: 'excluded',
              relationshipSubject: 'not_alternative',
              contextRef: r.excerptRef,
              candidateEvidenceRefs: [
                input.citations.find((c) => c.candidateRef === ref)!.ref,
              ],
              reason:
                'Independent source comparison, not a predetermined inclusion',
            },
          ]),
        ),
      ]),
    ),
  };
  expect(request.schema.safeParse(rawResponse).success).toBe(true);
  const missing = structuredClone(rawResponse);
  const extra = request.required.find((r) =>
    r.candidateRefs.includes('alternative-campaign'),
  )!;
  delete missing.reviews[extra.key]['alternative-campaign'];
  expect(request.schema.safeParse(missing).success).toBe(false);
  const inspected = inspectContentAttachmentIndependentReview(
    input,
    selection,
    {
      coverage: request.coverage,
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      rawResponse: request.schema.parse(rawResponse),
      usage: {} as never,
      callAttempts: [],
    },
    options,
  );
  expect(inspected.issues).toEqual([]);
  expect(
    inspected.findings.some((f) => f.candidateRef === 'alternative-campaign'),
  ).toBe(true);
  expect({ input, selection }).toEqual(before);
  input.payload.current.bodyBlocks = [['bounded', ['E1', 'E2']]];
  const continuation = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    { ...options, sourceGroundedCoverage: true },
  );
  expect(
    continuation.required
      .filter((r) => r.candidateRefs.includes('alternative-campaign'))
      .map((r) => r.excerptRef),
  ).toEqual(['E1', 'E2']);
});

test('expands a proposed singleton to its original inventory without claiming unrelated passages describe that remote inventory', () => {
  const { plan, unit } = fixture();
  const input = createContentAttachmentGroundedInput(plan, unit);
  input.payload.originTables[0].contexts = ['remote-table'];
  const selection: ContentAttachmentRequiredResponse = {
    decisions: {
      E1: {
        status: 'unresolved',
        candidateRefs: ['opaque-nine'],
        reason: 'Uncertain original choice',
      },
      E2: {
        status: 'assigned',
        candidateRefs: ['area'],
        reason: 'Independent body choice',
        unresolved: null,
      },
    },
  };
  const options = { includeBodyContext: true, crossChapterAreas: true };
  const before = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    options,
  );
  const after = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    { ...options, sourceGroundedCoverage: true },
  );
  expect(before.required.some((r) => r.inventoryRef === 'U1')).toBe(false);
  expect(
    after.required
      .filter((r) => r.inventoryRef === 'U1')
      .map((r) => [r.excerptRef, r.candidateRefs]),
  ).toEqual([['E1', ['opaque-nine', 'opaque-two']]]);
  expect(
    createContentAttachmentIndependentReviewRequest(input, selection, {
      sourceGroundedCoverage: true,
    }).coverage,
  ).toEqual({ version: 'source-grounded.v1', referentMatches: [] });
});

test('grounds independent word ranges in immutable current excerpts and read-only context, replaying a separate evidence version', async () => {
  const { plan, unit } = fixture();
  unit.readOnlyContext = [
    {
      resourceKey: '/chapters/0/textBlocks/0',
      text: 'Area work. Period A features.',
    },
  ];
  const input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const options = {
    includeBodyContext: true,
    crossChapterAreas: true,
    sourceGroundedCoverage: true,
    reviewTableWork: true,
  };
  const before = structuredClone({ input, selection });
  const legacy = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    options,
  );
  const request = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    { ...options, wordEvidence: true },
  );
  expect(request.required).toEqual(legacy.required);
  expect(request.wordEvidence?.version).toBe('word-ranges.v1');
  expect(request.systemPrompt).toContain(
    'For EACH candidate independently inspect ALL substantive clauses/actions',
  );
  expect(request.systemPrompt.startsWith(legacy.systemPrompt)).toBe(true);
  const payload = JSON.parse(request.userPrompt);
  expect(payload.excerpts[0][4]).toEqual([
    ['W1', 'Area'],
    ['W2', 'work.'],
  ]);
  expect(payload.readOnlyContext[0][0]).toBe('X1');
  expect(payload.candidates).toEqual(JSON.parse(legacy.userPrompt).candidates);
  expect(payload).not.toHaveProperty('decisions');
  const reviews = Object.fromEntries(
    request.required.map((r) => [
      r.key,
      Object.fromEntries(
        r.candidateRefs.map((ref) => [
          ref,
          {
            attachment: 'excluded',
            relationshipSubject: 'not_alternative',
            contextRef: r.excerptRef,
            candidateEvidenceRefs: [
              input.citations.find((c) => c.candidateRef === ref)!.ref,
            ],
            reason: 'Independent source judgment',
            wordRanges: [] as string[],
          },
        ]),
      ),
    ]),
  );
  reviews['E1:B1'].area.attachment = 'included';
  reviews['E1:B1'].area.wordRanges = ['E1:W1-W2', 'E2:W1-W1', 'X1:W1-W2'];
  reviews['E2:U1']['opaque-nine'].relationshipSubject = 'alternative';
  reviews['E2:U1']['opaque-nine'].wordRanges = ['E2:W1-W1'];
  const audit = {
    coverage: request.coverage,
    wordEvidence: request.wordEvidence,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    rawResponse: request.schema.parse({ reviews }),
    usage: {} as never,
    callAttempts: [],
  };
  const inspected = inspectContentAttachmentIndependentReview(
    input,
    selection,
    audit,
    options,
  );
  expect(inspected.issues).toEqual([]);
  expect(
    inspected.findings
      .find((f) => f.excerptRef === 'E1' && f.candidateRef === 'area')
      ?.wordEvidence?.map((r) => [r.basis, r.text]),
  ).toEqual([
    ['direct', 'Area work.'],
    ['context', 'Period'],
    ['context', 'Area work.'],
  ]);
  const format = await Output.object({ schema: request.schema }).responseFormat;
  expect(format?.type).toBe('json');
  const missing = structuredClone(audit.rawResponse);
  delete missing.reviews['E1:B1'].area.wordRanges;
  expect(request.schema.safeParse(missing).success).toBe(false);
  for (const ranges of [
    [],
    ['X1:W1-W2'],
    ['E99:W1-W1'],
    ['E1:W2-W1'],
    ['E1:W1-W99'],
    ['E1:W1-W1', 'E1:W1-W1'],
  ]) {
    const invalid = structuredClone(audit);
    invalid.rawResponse.reviews['E1:B1'].area.wordRanges = ranges;
    expect(
      inspectContentAttachmentIndependentReview(
        input,
        selection,
        invalid,
        options,
      ).issues,
    ).toContain('Invalid independent word evidence: E1:B1:area');
  }
  for (const attachment of ['unresolved', 'excluded'] as const) {
    const invalid = structuredClone(audit);
    invalid.rawResponse.reviews['E1:B1'].area.attachment = attachment;
    invalid.rawResponse.reviews['E1:B1'].area.relationshipSubject =
      'alternative';
    invalid.rawResponse.reviews['E1:B1'].area.wordRanges = [];
    expect(
      inspectContentAttachmentIndependentReview(
        input,
        selection,
        invalid,
        options,
      ).issues.length,
    ).toBeGreaterThan(0);
  }
  const forged = structuredClone(audit);
  forged.wordEvidence!.sources[0].words[0].charEnd++;
  expect(
    inspectContentAttachmentIndependentReview(input, selection, forged, options)
      .issues.length,
  ).toBeGreaterThan(0);
  expect(
    inspectContentAttachmentIndependentReview(
      input,
      selection,
      { ...audit, wordEvidence: undefined },
      { ...options, wordEvidence: true },
    ).issues.length,
  ).toBeGreaterThan(0);
  expect({ input, selection }).toEqual(before);
});

test('requires segment-first review with complete word and candidate coverage while retaining older word-only audits', async () => {
  const { plan, unit } = fixture();
  const input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const options = {
    includeBodyContext: true,
    crossChapterAreas: true,
    reviewTableWork: true,
    sourceGroundedCoverage: true,
  };
  const legacy = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    { ...options, wordEvidence: true },
  );
  const request = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    { ...options, segmentReview: true },
  );
  expect(request.segmentReview).toEqual({ version: 'segment-review.v1' });
  expect(request.wordEvidence!.version).toBe('word-ranges.v1');
  expect(request.required).toEqual(legacy.required);
  expect(request.userPrompt).toBe(legacy.userPrompt);
  expect(request.systemPrompt.startsWith(legacy.systemPrompt)).toBe(true);
  expect(request.systemPrompt).toContain(
    'Before candidate judgments, return segments',
  );
  const segments = Object.fromEntries(
    request
      .wordEvidence!.sources.filter((source) =>
        request.required.some((r) => r.excerptRef === source.ref),
      )
      .map((source) => [
        source.ref,
        source.ref === 'E1'
          ? [
              { kind: 'substantive', wordRanges: ['E1:W1-W1'] },
              { kind: 'substantive', wordRanges: ['E1:W2-W2'] },
            ]
          : [
              {
                kind: 'substantive',
                wordRanges: [`${source.ref}:W1-${source.words.at(-1)!.ref}`],
              },
            ],
      ]),
  );
  const reviews = Object.fromEntries(
    request.required.map((r) => [
      r.key,
      Object.fromEntries(
        r.candidateRefs.map((ref) => {
          const included = r.excerptRef === 'E1' && ref === 'area';
          return [
            ref,
            {
              segmentDecisions: segments[r.excerptRef].map((_, i) => ({
                segment: i + 1,
                attachment: included && i === 0 ? 'included' : 'excluded',
                relationshipSubject: 'not_alternative',
                reason: 'This action subject is judged independently',
              })),
              attachment: included ? 'included' : 'excluded',
              relationshipSubject: 'not_alternative',
              contextRef: r.excerptRef,
              candidateEvidenceRefs: [
                input.citations.find((c) => c.candidateRef === ref)!.ref,
              ],
              reason: 'Aggregate independent verdict',
              wordRanges: included ? ['E1:W1-W1'] : [],
            },
          ];
        }),
      ),
    ]),
  );
  const audit = {
    segmentReview: request.segmentReview,
    wordEvidence: request.wordEvidence,
    coverage: request.coverage,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    rawResponse: request.schema.parse({ segments, reviews }),
    usage: {} as never,
    callAttempts: [],
  };
  const before = structuredClone({ input, selection, audit });
  const result = inspectContentAttachmentIndependentReview(
    input,
    selection,
    audit,
    options,
  );
  expect(result.issues).toEqual([]);
  expect(
    result.findings
      .find((f) => f.excerptRef === 'E1' && f.candidateRef === 'area')!
      .segmentEvidence!.map((s) => [
        s.segment,
        s.decision.attachment,
        s.evidence[0].text,
      ]),
  ).toEqual([
    [1, 'included', 'Area'],
    [2, 'excluded', 'work.'],
  ]);
  expect({ input, selection, audit }).toEqual(before);
  const format = await Output.object({ schema: request.schema }).responseFormat;
  expect(format?.type).toBe('json');
  const schema = JSON.parse(JSON.stringify(format)).schema;
  expect(schema.required).toEqual(['segments', 'reviews']);
  expect(schema.properties.segments.required.toSorted()).toEqual(['E1', 'E2']);
  expect(schema.definitions.IndependentSegment.properties.wordRanges).toEqual({
    $ref: '#/definitions/IndependentSegmentWordRanges',
  });
  expect(schema.definitions.IndependentSegmentWordRanges.minItems).toBe(1);
  const inspectRefs = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ('$ref' in node) expect(Object.keys(node)).toEqual(['$ref']);
    for (const child of Object.values(node)) inspectRefs(child);
  };
  inspectRefs(schema);
  const emptyRange = structuredClone(audit.rawResponse);
  emptyRange.segments!.E1[0].wordRanges = [];
  expect(request.schema.safeParse(emptyRange).success).toBe(false);
  const absent = structuredClone(audit.rawResponse);
  delete absent.segments!.E1;
  expect(request.schema.safeParse(absent).success).toBe(false);
  delete absent.segments;
  expect(request.schema.safeParse(absent).success).toBe(false);
  const missingDecision = structuredClone(audit);
  delete missingDecision.rawResponse.reviews['E1:B1'].area.segmentDecisions;
  expect(request.schema.safeParse(missingDecision.rawResponse).success).toBe(
    false,
  );
  const uncovered = structuredClone(audit);
  uncovered.rawResponse.segments!.E1.pop();
  const uncoveredResult = inspectContentAttachmentIndependentReview(
    input,
    selection,
    uncovered,
    options,
  );
  expect(uncoveredResult.issues).toContain('Invalid independent segments: E1');
  expect(uncoveredResult.findings.every((f) => f.excerptRef !== 'E1')).toBe(
    true,
  );
  const incomplete = structuredClone(audit);
  incomplete.rawResponse.reviews['E1:B1'].area.segmentDecisions!.pop();
  expect(
    inspectContentAttachmentIndependentReview(
      input,
      selection,
      incomplete,
      options,
    ).issues,
  ).toContain('Invalid independent segment decisions: E1:B1:area');
  const contradictory = structuredClone(audit);
  contradictory.rawResponse.reviews['E1:B1'].area.attachment = 'excluded';
  expect(
    inspectContentAttachmentIndependentReview(
      input,
      selection,
      contradictory,
      options,
    ).issues,
  ).toContain('Invalid independent segment decisions: E1:B1:area');
  expect(
    inspectContentAttachmentIndependentReview(
      input,
      selection,
      { ...audit, segmentReview: undefined },
      { ...options, segmentReview: true },
    ).issues,
  ).toHaveLength(1);
  // The word-only contract still accepts the exact pre-segmentation shape.
  const oldRaw = structuredClone(audit.rawResponse);
  delete oldRaw.segments;
  for (const members of Object.values(oldRaw.reviews))
    for (const answer of Object.values(members)) delete answer.segmentDecisions;
  const oldAudit = {
    ...audit,
    segmentReview: undefined,
    systemPrompt: legacy.systemPrompt,
    rawResponse: legacy.schema.parse(oldRaw),
  };
  expect(
    inspectContentAttachmentIndependentReview(
      input,
      selection,
      oldAudit,
      options,
    ).issues,
  ).toEqual([]);
  const emptyInput = structuredClone(input);
  emptyInput.payload.current.excerpts = emptyInput.payload.current.excerpts.map(
    (e) => [e[0], e[1], e[2], e[3], ''],
  );
  for (const e of emptyInput.payload.current.excerpts) {
    const binding = emptyInput.codeMap.excerpts.find((b) => b.ref === e[0])!;
    binding.evidence[0].quote = '';
    binding.evidence[0].charEnd = binding.evidence[0].charStart;
  }
  expect(
    createContentAttachmentIndependentReviewRequest(emptyInput, selection, {
      ...options,
      segmentReview: true,
    }).wordEvidence!.sources.every((s) => s.words.length === 0),
  ).toBe(true);
});
