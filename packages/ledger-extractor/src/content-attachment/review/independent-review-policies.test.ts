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

test('reviews non-header table data independently even when first selection ignores every cell, with complete table and body context', () => {
  const { plan } = fixture();
  const unit = plan.units[1];
  unit.tables[0].data.grid[0][0].isHeader = true;
  const input = createContentAttachmentGroundedInput(plan, unit);
  input.payload.current.tables[0].grid[0].push([
    null,
    'Read-only context',
    1,
    1,
    false,
  ]);
  const selection: ContentAttachmentRequiredResponse = {
    decisions: Object.fromEntries(
      input.codeMap.excerpts.map((e) => [
        e.ref,
        { status: 'ignored', reason: 'First independent classification' },
      ]),
    ),
  };
  const before = structuredClone({ input, selection });
  const historical = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    { includeBodyContext: true },
  );
  const request = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    { includeBodyContext: true, reviewTableWork: true },
  );
  expect(historical.required.some((r) => r.excerptRef === 'E2')).toBe(false);
  expect(
    request.required.find((r) => r.key === 'E2:U1')?.candidateRefs,
  ).toEqual(['opaque-nine', 'opaque-two']);
  expect(request.required.some((r) => r.excerptRef === 'E1')).toBe(false);
  const payload = JSON.parse(request.userPrompt);
  expect(payload.excerpts).toEqual(input.payload.current.excerpts);
  expect(payload.currentTables).toEqual(input.payload.current.tables);
  expect(payload.originRows).toEqual(input.payload.originRows);
  expect(payload.originAnchors).toEqual(input.payload.originAnchors);
  expect(payload).not.toHaveProperty('decisions');
  const raw = {
    reviews: Object.fromEntries(
      request.required.map((r) => [
        r.key,
        Object.fromEntries(
          r.candidateRefs.map((ref) => [
            ref,
            {
              attachment: 'included',
              relationshipSubject: 'not_alternative',
              contextRef: r.excerptRef,
              candidateEvidenceRefs: [
                input.citations.find((c) => c.candidateRef === ref)!.ref,
              ],
              reason: 'Own source-grounded independent decision',
            },
          ]),
        ),
      ]),
    ),
  };
  expect(request.schema.safeParse(raw).success).toBe(true);
  const missing = structuredClone(raw);
  delete missing.reviews['E2:U1'];
  expect(request.schema.safeParse(missing).success).toBe(false);
  delete raw.reviews['E2:U1']['opaque-two'];
  expect(request.schema.safeParse(raw).success).toBe(false);
  expect({ input, selection }).toEqual(before);
});

test('shares layout recording and linked diary work criteria without forcing semantic answers or changing first evidence', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const options = {
    includeBodyContext: true,
    qualifyBeforeIdentity: true,
    reconcileRecipientRefs: true,
    crossChapterAreas: true,
    preserveAreaWork: true,
    preserveAreaResults: true,
    boundAreaResultRecipients: true,
  };
  const old = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v68',
    ),
    current = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v69',
    );
  const oldReview = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      options,
    ),
    review = createContentAttachmentIndependentReviewRequest(input, selection, {
      ...options,
      reviewTableWork: true,
    });
  const added = current.systemPrompt.slice(old.systemPrompt.length + 1);
  expect(current.systemPrompt).toBe(old.systemPrompt + '\n' + added);
  expect(review.systemPrompt).toBe(oldReview.systemPrompt + '\n' + added);
  expect(added).toContain('measuring their collective layout');
  expect(added).toContain(
    'inherit those source-established participants even without repeated names or numbers',
  );
  expect(added).toContain('whole-project and partial scopes distinct');
  expect(added).not.toMatch(/E7|E44|R1|화지산/);
  expect(current.userPrompt).toBe(old.userPrompt);
  const request = JSON.parse(review.userPrompt);
  expect(request.currentTables).toEqual([]);
  expect(request.excerpts).toEqual(input.payload.current.excerpts);
});

test('shares an explicit original area-definition layout-recording check without changing evidence, coverage or semantic freedom', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const before = structuredClone({ input, selection });
  const options = {
    includeBodyContext: true,
    qualifyBeforeIdentity: true,
    reconcileRecipientRefs: true,
    crossChapterAreas: true,
    preserveAreaWork: true,
    preserveAreaResults: true,
    boundAreaResultRecipients: true,
    reviewTableWork: true,
  };
  const historical = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v69',
    ),
    current = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v70',
    );
  const oldReview = createContentAttachmentIndependentReviewRequest(
      input,
      selection,
      options,
    ),
    review = createContentAttachmentIndependentReviewRequest(input, selection, {
      ...options,
      traceAreaRecording: true,
    });
  const added = current.systemPrompt.slice(historical.systemPrompt.length + 1);
  expect(current.systemPrompt).toBe(historical.systemPrompt + '\n' + added);
  expect(review.systemPrompt).toBe(oldReview.systemPrompt + '\n' + added);
  expect(added).toContain('AREA DEFINITION -> LAYOUT -> RECORDING LINK CHECK');
  expect(added).toContain('area through its own K definition');
  expect(added).toContain('original E or body clause');
  expect(added).toContain('same-investigation recording links');
  expect(added).toContain('before omitting an independently described area');
  expect(added).toContain('specific missing or contradicted link');
  expect(added).not.toMatch(/E7|E4|R1|화지산|2,776/);
  expect(current.userPrompt).toBe(historical.userPrompt);
  expect(review.userPrompt).toBe(oldReview.userPrompt);
  expect(review.required).toEqual(oldReview.required);
  expect(JSON.parse(review.userPrompt)).not.toHaveProperty('decisions');
  const output = {
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
              reason:
                'Original link not established in this independent fixture judgment',
            },
          ]),
        ),
      ]),
    ),
  };
  expect(review.schema.safeParse(output).success).toBe(true);
  expect(oldReview.schema.safeParse(output).success).toBe(true);
  const audit = {
    systemPrompt: review.systemPrompt,
    userPrompt: review.userPrompt,
    rawResponse: review.schema.parse(output),
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, {
      ...options,
      traceAreaRecording: true,
    }).issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, options)
      .issues,
  ).toHaveLength(1);
  expect({ input, selection }).toEqual(before);
});

test('shares the area layout versus local unit work boundary while preserving historical prompts and independent judgment freedom', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const before = structuredClone({ input, selection });
  const options = {
    includeBodyContext: true,
    qualifyBeforeIdentity: true,
    reconcileRecipientRefs: true,
    crossChapterAreas: true,
    preserveAreaWork: true,
    preserveAreaResults: true,
    boundAreaResultRecipients: true,
    reviewTableWork: true,
    traceAreaRecording: true,
  };
  const old = createContentAttachmentRequest(
    plan,
    unit,
    'content-attachment.v70',
  );
  const current = createContentAttachmentRequest(
    plan,
    unit,
    'content-attachment.v71',
  );
  const oldReview = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    options,
  );
  const review = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    {
      ...options,
      boundAreaRecording: true,
    },
  );
  const added = current.systemPrompt.slice(old.systemPrompt.length + 1);
  expect(current.promptVersion).toBe('content-attachment.v71');
  expect(current.systemPrompt).toBe(old.systemPrompt + '\n' + added);
  expect(review.systemPrompt).toBe(oldReview.systemPrompt + '\n' + added);
  expect(added).toContain('AREA OWN LAYOUT/RECORD VS UNIT WORK BOUNDARY');
  expect(added).toContain('collective layout plan');
  expect(added).toContain('nearest explicit unit work subject');
  expect(added).toContain('involve several or all units');
  expect(added).toContain('not extra containing areas');
  expect(added).toContain(
    'Do not omit positively linked area layout documentation',
  );
  expect(added).not.toMatch(/E29|E34|E39|E44|E7|R1|화지산|2,776/);
  expect(current.userPrompt).toBe(old.userPrompt);
  expect(review.userPrompt).toBe(oldReview.userPrompt);
  expect(review.required).toEqual(oldReview.required);
  expect(JSON.parse(review.userPrompt)).not.toHaveProperty('decisions');
  const output = {
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
              reason:
                'Original evidence identifies unit work without area layout documentation',
            },
          ]),
        ),
      ]),
    ),
  };
  expect(oldReview.schema.safeParse(output).success).toBe(true);
  expect(review.schema.safeParse(output).success).toBe(true);
  const audit = {
    systemPrompt: review.systemPrompt,
    userPrompt: review.userPrompt,
    rawResponse: review.schema.parse(output),
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, {
      ...options,
      boundAreaRecording: true,
    }).issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, options)
      .issues,
  ).toHaveLength(1);
  expect({ input, selection }).toEqual(before);
});

test('shares meeting-only exclusion and actual recipient K qualifier checks without changing historical evidence or forcing review judgments', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const before = structuredClone({ input, selection });
  const options = {
    includeBodyContext: true,
    qualifyBeforeIdentity: true,
    reconcileRecipientRefs: true,
    crossChapterAreas: true,
    preserveAreaWork: true,
    preserveAreaResults: true,
    boundAreaResultRecipients: true,
    reviewTableWork: true,
    traceAreaRecording: true,
    boundAreaRecording: true,
  };
  const old = createContentAttachmentRequest(
    plan,
    unit,
    'content-attachment.v71',
  );
  const current = createContentAttachmentRequest(
    plan,
    unit,
    'content-attachment.v72',
  );
  const oldReview = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    options,
  );
  const review = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    {
      ...options,
      checkClauseGrounds: true,
    },
  );
  const added = current.systemPrompt.slice(old.systemPrompt.length + 1);
  expect(current.promptVersion).toBe('content-attachment.v72');
  expect(current.systemPrompt).toBe(old.systemPrompt + '\n' + added);
  expect(review.systemPrompt).toBe(oldReview.systemPrompt + '\n' + added);
  expect(added).toContain(
    'MEETING-ONLY EVENTS AND RETURNED CANDIDATE GROUNDS CHECK',
  );
  expect(added).toContain('neighboring E on its own supported recipients');
  expect(added).toContain('preserve an indivisible E');
  expect(added).toContain('Before returning ACTUAL recipients');
  expect(added).toContain(
    'a correct period written in the reason is not proof',
  );
  expect(added).toContain('own supplied literal name and K evidence');
  expect(added).toContain(
    'Do not mechanically exclude an area with no period label',
  );
  expect(added).not.toMatch(/E9|E10|R12|R13|R16|R18|화지산|백제|조선/);
  expect(current.userPrompt).toBe(old.userPrompt);
  expect(review.userPrompt).toBe(oldReview.userPrompt);
  expect(review.required).toEqual(oldReview.required);
  expect(JSON.parse(review.userPrompt)).not.toHaveProperty('decisions');
  const output = {
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
              reason:
                'Current clause and original candidate grounds do not establish direct description',
            },
          ]),
        ),
      ]),
    ),
  };
  expect(oldReview.schema.safeParse(output).success).toBe(true);
  expect(review.schema.safeParse(output).success).toBe(true);
  const audit = {
    systemPrompt: review.systemPrompt,
    userPrompt: review.userPrompt,
    rawResponse: review.schema.parse(output),
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, {
      ...options,
      checkClauseGrounds: true,
    }).issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, options)
      .issues,
  ).toHaveLength(1);
  expect({ input, selection }).toEqual(before);
});

test('shares per-candidate current qualifier and original cross-stage identity gates while preserving immutable evidence and independent judgment freedom', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const before = structuredClone({ input, selection });
  const options = {
    includeBodyContext: true,
    qualifyBeforeIdentity: true,
    reconcileRecipientRefs: true,
    crossChapterAreas: true,
    preserveAreaWork: true,
    preserveAreaResults: true,
    boundAreaResultRecipients: true,
    reviewTableWork: true,
    traceAreaRecording: true,
    boundAreaRecording: true,
    checkClauseGrounds: true,
  };
  const old = createContentAttachmentRequest(
    plan,
    unit,
    'content-attachment.v72',
  );
  const current = createContentAttachmentRequest(
    plan,
    unit,
    'content-attachment.v73',
  );
  const oldReview = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    options,
  );
  const review = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    {
      ...options,
      gateQualifierStage: true,
    },
  );
  const added = current.systemPrompt.slice(old.systemPrompt.length + 1);
  expect(current.promptVersion).toBe('content-attachment.v73');
  expect(current.systemPrompt).toBe(old.systemPrompt + '\n' + added);
  expect(review.systemPrompt).toBe(oldReview.systemPrompt + '\n' + added);
  expect(added).toContain(
    'CANDIDATE-LOCAL CURRENT QUALIFIER AND CROSS-STAGE IDENTITY GATES',
  );
  expect(added).toContain('BEFORE using a broader group or regional inventory');
  expect(added).toContain(
    'same current restriction to every comparable member',
  );
  expect(added).toContain(
    'original bridge between the actual relation referent and that candidate',
  );
  expect(added).toContain('not the bridge');
  expect(added).toContain(
    'Independently described areas without a period label',
  );
  expect(added).toContain(
    'original candidate names/numbers to decode opaque refs',
  );
  expect(added).not.toMatch(/E10|E7|R12|R13|R16|R30|화지산|백제|조선/);
  expect(current.userPrompt).toBe(old.userPrompt);
  expect(review.userPrompt).toBe(oldReview.userPrompt);
  expect(review.required).toEqual(oldReview.required);
  expect(JSON.parse(review.userPrompt)).not.toHaveProperty('decisions');
  const output = {
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
              reason:
                'Current clause and this candidate original evidence do not establish the required link',
            },
          ]),
        ),
      ]),
    ),
  };
  expect(oldReview.schema.safeParse(output).success).toBe(true);
  expect(review.schema.safeParse(output).success).toBe(true);
  const audit = {
    systemPrompt: review.systemPrompt,
    userPrompt: review.userPrompt,
    rawResponse: review.schema.parse(output),
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, {
      ...options,
      gateQualifierStage: true,
    }).issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, options)
      .issues,
  ).toHaveLength(1);
  expect({ input, selection }).toEqual(before);
});

test('shares tentative inventory membership and separate attachment/role criteria without changing replay evidence or forcing independent outcomes', () => {
  const { plan, unit } = fixture(),
    input = createContentAttachmentGroundedInput(plan, unit),
    selection = frozenSelection();
  const before = structuredClone({ input, selection });
  const options = {
    includeBodyContext: true,
    qualifyBeforeIdentity: true,
    reconcileRecipientRefs: true,
    crossChapterAreas: true,
    preserveAreaWork: true,
    preserveAreaResults: true,
    boundAreaResultRecipients: true,
    reviewTableWork: true,
    traceAreaRecording: true,
    boundAreaRecording: true,
    checkClauseGrounds: true,
    gateQualifierStage: true,
  };
  const old = createContentAttachmentRequest(
    plan,
    unit,
    'content-attachment.v73',
  );
  const current = createContentAttachmentRequest(plan, unit);
  const oldReview = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    options,
  );
  const review = createContentAttachmentIndependentReviewRequest(
    input,
    selection,
    {
      ...options,
      preserveTentativeMembership: true,
    },
  );
  const added = current.systemPrompt.slice(old.systemPrompt.length + 1);
  expect(current.promptVersion).toBe('content-attachment.v74');
  expect(current.systemPrompt).toBe(old.systemPrompt + '\n' + added);
  expect(review.systemPrompt).toBe(oldReview.systemPrompt + '\n' + added);
  expect(added).toContain(
    'TENTATIVE CLASSIFICATION IS NOT INVENTORY EXCLUSION',
  );
  expect(added).toContain(
    'Confirmed inventory membership does not mean confirmed classification',
  );
  expect(added).toContain('Do not treat tentative Type T as an unrelated type');
  expect(added).toContain('TWO independent decisions');
  expect(added).toContain('nested unresolved.candidateRefs');
  expect(added).toContain(
    'attachment=included and relationshipSubject=alternative',
  );
  expect(added).toContain(
    'collective-only E without an unresolved relationship',
  );
  expect(added).toContain(
    'genuinely incompatible period or investigation stage still excludes',
  );
  expect(added).not.toMatch(/E8|E10|R23|R30|화지산|백제|조선/);
  expect(current.userPrompt).toBe(old.userPrompt);
  expect(review.userPrompt).toBe(oldReview.userPrompt);
  expect(review.required).toEqual(oldReview.required);
  expect(JSON.parse(review.userPrompt)).not.toHaveProperty('decisions');
  const output = {
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
              reason:
                'This independent fixture judgment lacks an original membership link',
            },
          ]),
        ),
      ]),
    ),
  };
  expect(oldReview.schema.safeParse(output).success).toBe(true);
  expect(review.schema.safeParse(output).success).toBe(true);
  const audit = {
    systemPrompt: review.systemPrompt,
    userPrompt: review.userPrompt,
    rawResponse: review.schema.parse(output),
    usage: {} as never,
    callAttempts: [],
  };
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, {
      ...options,
      preserveTentativeMembership: true,
    }).issues,
  ).toEqual([]);
  expect(
    inspectContentAttachmentIndependentReview(input, selection, audit, options)
      .issues,
  ).toHaveLength(1);
  expect({ input, selection }).toEqual(before);
});
