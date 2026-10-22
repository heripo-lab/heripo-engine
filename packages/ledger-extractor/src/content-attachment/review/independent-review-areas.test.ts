import type * as Shared from '@heripo/shared';

import type { ContentAttachmentRequiredResponse } from '../response';

import { expect, test, vi } from 'vitest';

import { assembleContentAttachment } from '../assembly';
import { createContentAttachmentGroundedInput } from '../grounding';
import { fixture, frozenSelection } from '../grounding.test-fixture';
import { createContentAttachmentRequest } from '../request';
import { flattenContentAttachmentResponse } from '../response';
import { inspectContentAttachmentIndependentReview } from './independent-review-inspection';
import { createContentAttachmentIndependentReviewRequest } from './independent-review-request';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

test('preserves historical body review while qualifying collective evidence and relationship identity independently', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const archived = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v62',
    ),
    current = createContentAttachmentRequest(plan, unit),
    historicalReview = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      { includeBodyContext: true },
    ),
    currentReview = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      {
        includeBodyContext: true,
        qualifyBeforeIdentity: true,
        reconcileRecipientRefs: true,
      },
    );
  expect(current.userPrompt).toBe(archived.userPrompt);
  expect(currentReview.userPrompt).toBe(historicalReview.userPrompt);
  expect(currentReview.required).toEqual(historicalReview.required);
  expect(current.systemPrompt).toContain(
    'FIRST narrow that inventory by the CURRENT clause period',
  );
  expect(currentReview.systemPrompt).toContain(
    'attachment=included plus relationshipSubject=alternative',
  );
  expect(archived.systemPrompt).not.toContain('ORDERED CLAUSE JUDGMENT');
  expect(historicalReview.systemPrompt).not.toContain(
    'ORDERED CLAUSE JUDGMENT',
  );
  const raw = {
    reviews: Object.fromEntries(
      currentReview.required.map((r) => [
        r.key,
        Object.fromEntries(
          r.candidateRefs.map((ref) => [
            ref,
            {
              attachment: 'included',
              relationshipSubject: 'alternative',
              contextRef: r.excerptRef,
              candidateEvidenceRefs: [
                input.citations.find((c) => c.candidateRef === ref)!.ref,
              ],
              reason:
                'Original collective membership; relationship subject unresolved',
            },
          ]),
        ),
      ]),
    ),
  };
  expect(currentReview.schema.safeParse(raw).success).toBe(true);
  expect(historicalReview.schema.safeParse(raw).success).toBe(true);
  const audit = {
    systemPrompt: currentReview.systemPrompt,
    userPrompt: currentReview.userPrompt,
    rawResponse: currentReview.schema.parse(raw),
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, {
      includeBodyContext: true,
      qualifyBeforeIdentity: true,
      reconcileRecipientRefs: true,
    }).issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, {
      includeBodyContext: true,
    }).issues,
  ).toHaveLength(1);
});

test('retains original recipient lists and historical policy while checking area recipients and original numbers before return', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const legacyOptions = {
      includeBodyContext: true,
      qualifyBeforeIdentity: true,
    },
    options = { ...legacyOptions, reconcileRecipientRefs: true },
    historical = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v63',
    ),
    current = createContentAttachmentRequest(plan, unit),
    legacyReview = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      legacyOptions,
    ),
    currentReview = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      options,
    ),
    before = structuredClone(selection);
  expect(current.userPrompt).toBe(historical.userPrompt);
  expect(currentReview.userPrompt).toBe(legacyReview.userPrompt);
  expect(currentReview.required).toEqual(legacyReview.required);
  expect(current.systemPrompt).toContain(
    'inspect the candidateRefs array you will ACTUALLY return',
  );
  expect(currentReview.systemPrompt).toContain(
    'preserve the area alongside the qualified feature set',
  );
  expect(historical.systemPrompt).not.toContain(
    'FINAL RECIPIENT AND ORIGINAL-NUMBER RECONCILIATION',
  );
  expect(legacyReview.systemPrompt).not.toContain(
    'FINAL RECIPIENT AND ORIGINAL-NUMBER RECONCILIATION',
  );
  const raw = {
    reviews: Object.fromEntries(
      currentReview.required.map((r) => [
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
              reason: 'Fixture exclusion retained for independent judgment',
            },
          ]),
        ),
      ]),
    ),
  };
  expect(legacyReview.schema.safeParse(raw).success).toBe(true);
  const audit = {
    systemPrompt: currentReview.systemPrompt,
    userPrompt: currentReview.userPrompt,
    rawResponse: currentReview.schema.parse(raw),
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, options)
      .issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentIndependentReview(
      input,
      selection,
      audit,
      legacyOptions,
    ).issues,
  ).toHaveLength(1);
  expect(selection).toEqual(before);
});

test('reviews whole and partial area definitions across chapters and proposed body recipients without preselecting judgments', () => {
  const { plan, unit } = fixture();
  for (const [ref, kind, chapter] of [
    ['whole', 'area', 'Whole project definition'],
    ['remote', 'feature', 'Other investigation'],
    ['role', 'feature', 'Other investigation'],
    ['unrelated', 'feature', 'Unrelated definition'],
  ] as const) {
    const entry = structuredClone(plan.registry[2]);
    entry.ref = ref;
    entry.groupId = ref;
    entry.recordKind = kind;
    entry.mentions[0].candidateId = ref;
    entry.mentions[0].sourceName = ref;
    entry.mentions[0].chapterPath = [{ id: chapter, originTitle: chapter }];
    plan.registry.push(entry);
  }
  const input = createContentAttachmentGroundedInput(plan, unit),
    selection: ContentAttachmentRequiredResponse = frozenSelection(),
    options = {
      includeBodyContext: true,
      qualifyBeforeIdentity: true,
      reconcileRecipientRefs: true,
      crossChapterAreas: true,
    };
  selection.decisions.E1 = {
    status: 'assigned',
    candidateRefs: ['area', 'remote'],
    unresolved: {
      candidateRefs: ['role'],
      reason: 'Relationship alternatives',
    },
    reason: 'First judgment remains separate',
  };
  const before = structuredClone({ input, selection });
  const current = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    options,
  );
  const payload = JSON.parse(current.userPrompt);
  expect(
    payload.bodyReviewPools.map(
      (p: { candidateRefs: string[] }) => p.candidateRefs,
    ),
  ).toEqual([['area'], ['whole'], ['remote', 'role']]);
  expect(payload.candidates.some((r: string[]) => r[0] === 'unrelated')).toBe(
    false,
  );
  expect(payload).not.toHaveProperty('decisions');
  const archived = createContentAttachmentRequest(
    plan,
    unit,
    'content-attachment.v64',
  );
  expect(
    createContentAttachmentRequest(plan, unit, 'content-attachment.v65')
      .systemPrompt,
  ).toBe(
    archived.systemPrompt + '\n' + current.systemPrompt.split('\n').at(-1),
  );
  expect(current.systemPrompt).toContain(
    'A whole project site and a bounded survey or excavation portion are distinct recipients',
  );
  expect(archived.systemPrompt).not.toContain(
    'WHOLE PROJECT AND PARTIAL INVESTIGATION AREAS',
  );
  const raw = {
    reviews: Object.fromEntries(
      current.required.map((r) => [
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
                'Independent exclusion supported by the original definition',
            },
          ]),
        ),
      ]),
    ),
  };
  expect(current.schema.safeParse(raw).success).toBe(true);
  const missing = structuredClone(raw);
  delete missing.reviews['E1:B2'].whole;
  expect(current.schema.safeParse(missing).success).toBe(false);
  const review = {
    systemPrompt: current.systemPrompt,
    userPrompt: current.userPrompt,
    rawResponse: current.schema.parse(raw),
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, review, options)
      .issues,
  ).toEqual([]);
  const legacy = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    { includeBodyContext: true },
  );
  expect(JSON.parse(legacy.userPrompt).bodyReviewPools).toEqual([
    { ref: 'B1', context: 'C1', candidateRefs: ['area'] },
  ]);
  expect({ input, selection }).toEqual(before);

  selection.decisions.E1 = {
    status: 'ignored',
    reason: 'No direct description',
  };
  selection.decisions.E2 = {
    status: 'unresolved',
    candidateRefs: ['remote', 'role'],
    reason: 'Unresolved source identity',
  };
  const unresolved = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    options,
  );
  expect(
    JSON.parse(unresolved.userPrompt).bodyReviewPools.map(
      (p: { candidateRefs: string[] }) => p.candidateRefs,
    ),
  ).toContainEqual(['remote', 'role']);
  expect(
    unresolved.required.some(
      (r) => r.key === 'E1:B2' && r.candidateRefs.includes('whole'),
    ),
  ).toBe(true);
});

test('shares body inventory boundaries and area fieldwork criteria without changing coverage or adopting independent choices', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection(),
    before = structuredClone({ input, selection }),
    options = {
      includeBodyContext: true,
      qualifyBeforeIdentity: true,
      reconcileRecipientRefs: true,
      crossChapterAreas: true,
    },
    historical = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v65',
    ),
    current = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v66',
    ),
    historicalReview = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      options,
    ),
    review = createContentAttachmentIndependentReviewRequest(input, selection, {
      ...options,
      preserveAreaWork: true,
    });
  const addedSelection = current.systemPrompt.slice(
      historical.systemPrompt.length + 1,
    ),
    addedReview = review.systemPrompt.slice(
      historicalReview.systemPrompt.length + 1,
    );
  expect(current.systemPrompt).toBe(
    historical.systemPrompt + '\n' + addedSelection,
  );
  expect(review.systemPrompt).toBe(
    historicalReview.systemPrompt + '\n' + addedReview,
  );
  expect(addedSelection).toBe(addedReview);
  expect(addedReview).toContain(
    'never extend that cell-specific ownership rule to a body aggregate',
  );
  expect(addedReview).toContain(
    'taking pre-investigation site photographs and making field records of that area',
  );
  expect(addedReview).toContain(
    'Distinguishing whole-project and partial areas must identify WHICH area owns the described work',
  );
  expect(current.userPrompt).toBe(historical.userPrompt);
  expect(review.userPrompt).toBe(historicalReview.userPrompt);
  expect(review.required).toEqual(historicalReview.required);
  const rawResponse = review.schema.parse({
    reviews: Object.fromEntries(
      review.required.map((r) => [
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
              reason: 'Independent judgment remains selectable',
            },
          ]),
        ),
      ]),
    ),
  });
  expect(historicalReview.schema.safeParse(rawResponse).success).toBe(true);
  const audit = {
    systemPrompt: review.systemPrompt,
    userPrompt: review.userPrompt,
    rawResponse,
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, {
      ...options,
      preserveAreaWork: true,
    }).issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, options)
      .issues,
  ).toHaveLength(1);
  expect({ input, selection }).toEqual(before);
});

test('shares identified area result eligibility without changing evidence coverage or forcing an independent disposition', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection(),
    before = structuredClone({ input, selection }),
    options = {
      includeBodyContext: true,
      qualifyBeforeIdentity: true,
      reconcileRecipientRefs: true,
      crossChapterAreas: true,
      preserveAreaWork: true,
    },
    historical = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v66',
    ),
    current = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v67',
    ),
    historicalReview = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      options,
    ),
    review = createContentAttachmentIndependentReviewRequest(input, selection, {
      ...options,
      preserveAreaResults: true,
    });
  const added = current.systemPrompt.slice(historical.systemPrompt.length + 1);
  expect(current.systemPrompt).toBe(historical.systemPrompt + '\n' + added);
  expect(review.systemPrompt).toBe(
    historicalReview.systemPrompt + '\n' + added,
  );
  expect(added).toContain(
    'directly describes that area own investigation results as well as the supported feature members',
  );
  expect(added).toContain(
    'Do not spread a body feature aggregate to every trench or unit',
  );
  expect(added).toContain(
    'do not spread a partial investigation result to a containing project area',
  );
  expect(current.userPrompt).toBe(historical.userPrompt);
  expect(review.userPrompt).toBe(historicalReview.userPrompt);
  expect(review.required).toEqual(historicalReview.required);
  expect(JSON.parse(review.userPrompt)).not.toHaveProperty('decisions');
  const rawResponse = review.schema.parse({
    reviews: Object.fromEntries(
      review.required.map((r) => [
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
              reason: 'Independent eligibility judgment retained',
            },
          ]),
        ),
      ]),
    ),
  });
  expect(historicalReview.schema.safeParse(rawResponse).success).toBe(true);
  const audit = {
    systemPrompt: review.systemPrompt,
    userPrompt: review.userPrompt,
    rawResponse,
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, {
      ...options,
      preserveAreaResults: true,
    }).issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, options)
      .issues,
  ).toHaveLength(1);
  expect({ input, selection }).toEqual(before);
});

test('separates area result eligibility from clause-qualified feature recipients in both stages without forcing either judgment', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection(),
    before = structuredClone({ input, selection }),
    options = {
      includeBodyContext: true,
      qualifyBeforeIdentity: true,
      reconcileRecipientRefs: true,
      crossChapterAreas: true,
      preserveAreaWork: true,
      preserveAreaResults: true,
    },
    historical = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v67',
    ),
    current = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v68',
    ),
    historicalReview = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      options,
    ),
    review = createContentAttachmentIndependentReviewRequest(input, selection, {
      ...options,
      boundAreaResultRecipients: true,
    });
  const added = current.systemPrompt.slice(historical.systemPrompt.length + 1);
  expect(current.systemPrompt).toBe(historical.systemPrompt + '\n' + added);
  expect(review.systemPrompt).toBe(
    historicalReview.systemPrompt + '\n' + added,
  );
  expect(added).toContain(
    'AREA RESULT PRESERVATION DOES NOT EXPAND FEATURE RECIPIENTS',
  );
  expect(added).toContain(
    'Area eligibility in (a) neither broadens nor narrows the feature set in (b)',
  );
  expect(added).toContain('CURRENT clause');
  expect(added).toContain('Original row co-occurrence');
  expect(added).toContain(
    'extending a named type set needs an original discourse or definition link',
  );
  expect(added).toContain('genuine relationship-subject alternatives');
  expect(added).not.toMatch(/R19|R21|화지산|E10/);
  expect(current.userPrompt).toBe(historical.userPrompt);
  expect(review.userPrompt).toBe(historicalReview.userPrompt);
  expect(review.required).toEqual(historicalReview.required);
  expect(JSON.parse(review.userPrompt)).not.toHaveProperty('decisions');
  const rawResponse = review.schema.parse({
    reviews: Object.fromEntries(
      review.required.map((r) => [
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
              reason: 'Independent eligibility judgment retained',
            },
          ]),
        ),
      ]),
    ),
  });
  expect(historicalReview.schema.safeParse(rawResponse).success).toBe(true);
  const audit = {
    systemPrompt: review.systemPrompt,
    userPrompt: review.userPrompt,
    rawResponse,
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, {
      ...options,
      boundAreaResultRecipients: true,
    }).issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, options)
      .issues,
  ).toHaveLength(1);
  expect({ input, selection }).toEqual(before);
});

test.each([
  'content-attachment.v64',
  'content-attachment.v65',
  'content-attachment.v66',
  'content-attachment.v67',
  'content-attachment.v68',
  'content-attachment.v69',
  'content-attachment.v70',
  'content-attachment.v71',
  'content-attachment.v72',
  'content-attachment.v73',
] as const)(
  'replays archived %s request and independent coverage after the live version advances',
  (version) => {
    const { plan, unit } = fixture(),
      input = createContentAttachmentGroundedInput(plan, unit),
      selection = frozenSelection(),
      request = createContentAttachmentRequest(plan, unit, version),
      review = createContentAttachmentIndependentReviewRequest(
        input,
        selection,
        {
          includeBodyContext: true,
          qualifyBeforeIdentity: true,
          reconcileRecipientRefs: true,
          crossChapterAreas: version !== 'content-attachment.v64',
          preserveAreaWork:
            version !== 'content-attachment.v64' &&
            version !== 'content-attachment.v65',
          preserveAreaResults:
            version === 'content-attachment.v67' ||
            version === 'content-attachment.v68' ||
            version === 'content-attachment.v69' ||
            version === 'content-attachment.v70' ||
            version === 'content-attachment.v71' ||
            version === 'content-attachment.v72' ||
            version === 'content-attachment.v73',
          boundAreaResultRecipients:
            version === 'content-attachment.v68' ||
            version === 'content-attachment.v69' ||
            version === 'content-attachment.v70' ||
            version === 'content-attachment.v71' ||
            version === 'content-attachment.v72' ||
            version === 'content-attachment.v73',
          reviewTableWork:
            version === 'content-attachment.v69' ||
            version === 'content-attachment.v70' ||
            version === 'content-attachment.v71' ||
            version === 'content-attachment.v72' ||
            version === 'content-attachment.v73',
          traceAreaRecording:
            version === 'content-attachment.v70' ||
            version === 'content-attachment.v71' ||
            version === 'content-attachment.v72' ||
            version === 'content-attachment.v73',
          boundAreaRecording:
            version === 'content-attachment.v71' ||
            version === 'content-attachment.v72' ||
            version === 'content-attachment.v73',
          checkClauseGrounds:
            version === 'content-attachment.v72' ||
            version === 'content-attachment.v73',
          gateQualifierStage: version === 'content-attachment.v73',
        },
      );
    const rawResponse = review.schema.parse({
      reviews: Object.fromEntries(
        review.required.map((r) => [
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
                reason: 'Independent archived judgment',
              },
            ]),
          ),
        ]),
      ),
    });
    const audit = {
      unitId: unit.unitId,
      ...request,
      rawResponse: selection,
      response: flattenContentAttachmentResponse(selection),
      codeMap: input.codeMap,
      usage: {} as never,
      independentReview: {
        systemPrompt: review.systemPrompt,
        userPrompt: review.userPrompt,
        rawResponse,
        usage: {} as never,
        callAttempts: [],
      },
    };
    const before = structuredClone(audit);
    const result = assembleContentAttachment(plan, [audit]);
    expect(result.issues).toEqual([]);
    expect(result.completedUnitIds).toEqual([unit.unitId]);
    expect(audit).toEqual(before);
  },
);
