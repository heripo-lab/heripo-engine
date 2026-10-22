import type * as Shared from '@heripo/shared';

import type { ContentAttachmentRequiredResponse } from '../response';

import { expect, test, vi } from 'vitest';

import { createContentAttachmentGroundedInput } from '../grounding';
import { fixture, frozenSelection } from '../grounding.test-fixture';
import { createContentAttachmentRequest } from '../request';
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
