import type * as Shared from '@heripo/shared';

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
