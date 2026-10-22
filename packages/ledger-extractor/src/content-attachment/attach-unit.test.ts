import type * as Shared from '@heripo/shared';
import type { LanguageModel } from 'ai';

import { LLMCaller, createAuditedModel } from '@heripo/shared';
import { describe, expect, test, vi } from 'vitest';

import { assembleContentAttachment } from './assembly';
import { attachContentUnit } from './attach-unit';
import { createContentAttachmentBodyBlockInput } from './body-blocks';
import { prepare, usage } from './content-attachment.test-fixture';
import { createContentAttachmentGroundedInput } from './grounding';
import { createContentAttachmentRequest } from './request';
import { createContentAttachmentIndependentReviewRequest } from './review/independent-review';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

describe('bounded content attachment', () => {
  test('runs exactly one selected unit, constrains source/candidate choices and propagates model failure', async () => {
    const p = await prepare();
    const response = {
      decisions: { E1: { status: 'ignored' as const, reason: '対象外' } },
    };
    vi.mocked(LLMCaller.call).mockResolvedValue({
      output: response,
      usage,
      usedFallback: false,
    });
    const compiled = createContentAttachmentGroundedInput(p, p.units[0]);
    const reviewRequest = createContentAttachmentIndependentReviewRequest(
      compiled,
      response,
      {
        segmentReview: true,
        wordEvidence: true,
        sourceGroundedCoverage: true,
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
        preserveTentativeMembership: true,
      },
    );
    const reviewOutput = reviewRequest.schema.parse({
      segments: Object.fromEntries(
        reviewRequest
          .wordEvidence!.sources.filter((source) =>
            reviewRequest.required.some((r) => r.excerptRef === source.ref),
          )
          .map((source) => [
            source.ref,
            [
              {
                kind: 'substantive',
                wordRanges: [`${source.ref}:W1-${source.words.at(-1)!.ref}`],
              },
            ],
          ]),
      ),
      reviews: Object.fromEntries(
        reviewRequest.required.map((r) => [
          r.key,
          Object.fromEntries(
            r.candidateRefs.map((ref) => [
              ref,
              {
                segmentDecisions: [
                  {
                    segment: 1,
                    attachment: 'excluded',
                    relationshipSubject: 'not_alternative',
                    reason: 'Fixture non-object judgment',
                  },
                ],
                wordRanges: [],
                attachment: 'excluded',
                relationshipSubject: 'not_alternative',
                contextRef: r.excerptRef,
                candidateEvidenceRefs: [
                  compiled.citations.find((c) => c.candidateRef === ref)!.ref,
                ],
                reason: 'Fixture cover is not an object description',
              },
            ]),
          ),
        ]),
      ),
    });
    vi.mocked(LLMCaller.call)
      .mockResolvedValueOnce({ output: response, usage, usedFallback: false })
      .mockResolvedValueOnce({
        output: reviewOutput,
        usage,
        usedFallback: false,
      });
    const model = {} as LanguageModel;
    const onAttempt = vi.fn();
    const attempts = [
      {
        sequence: 1,
        modelId: 'mock',
        provider: 'openai.responses',
        startedAt: 'start',
        completedAt: 'end',
        outcome: 'returned' as const,
        finishReason: { unified: 'stop' },
        apiStatus: 'completed',
        incompleteDetails: null,
        responseId: 'resp-original',
        requestBody: { input: 'original' },
        responseBody: { id: 'resp-original', status: 'completed' },
        content: [],
        usage: null,
        error: null,
      },
    ];
    vi.mocked(createAuditedModel).mockReturnValueOnce({
      model: model as Exclude<LanguageModel, string>,
      attempts,
    });
    const out = await attachContentUnit(p, p.units[0], {
      model,
      maxRetries: 0,
      onAttempt,
    });
    expect(createAuditedModel).toHaveBeenCalledWith(model, onAttempt);
    expect(out.callAttempts).toBe(attempts);
    expect(LLMCaller.call).toHaveBeenCalledTimes(2);
    expect(out.rawResponse).toBe(response);
    expect(out.response).toEqual({
      assignments: [],
      unresolved: [],
      ignored: [{ excerptRef: 'E1', reason: '対象外' }],
    });
    const before = structuredClone(out);
    const {
      independentReviewFindings: _findings,
      reviewDisagreements: _disagreements,
      ...initialResult
    } = assembleContentAttachment(p, [out]);
    expect(assembleContentAttachment(p, [out]).issues).toEqual([]);
    expect(out).toEqual(before);
    const archivedUserPrompt = createContentAttachmentRequest(
      p,
      p.units[0],
      'content-attachment.v54',
    ).userPrompt;
    const preservedPrompt = createContentAttachmentRequest(
      p,
      p.units[0],
      'content-attachment.v57',
    ).systemPrompt;
    const v42 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v42',
      ),
    };
    expect(archivedUserPrompt).toBe(v42.userPrompt);
    expect(preservedPrompt.startsWith(v42.systemPrompt)).toBe(true);
    expect(v42.systemPrompt).not.toContain(
      'CARRY PREVIOUS-INVESTIGATION SUBJECTS THROUGH CATEGORY FRAGMENTS AND THEIR NEXT CONTEXT',
    );
    expect(assembleContentAttachment(p, [v42])).toEqual(initialResult);
    const alteredHistoricalProjection = structuredClone(v42);
    alteredHistoricalProjection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredHistoricalProjection]).issues[0]
        .reason,
    ).toContain('inconsistent projection');
    const v43 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v43',
      ),
    };
    expect(archivedUserPrompt).toBe(v43.userPrompt);
    expect(preservedPrompt.startsWith(v43.systemPrompt)).toBe(true);
    expect(v43.systemPrompt).not.toContain(
      'RESOLVE DIFFERENT REGISTRY AND NARRATIVE NAMES THROUGH ORIGINAL IDENTITY EVIDENCE',
    );
    expect(assembleContentAttachment(p, [v43])).toEqual(initialResult);
    const alteredV43Projection = structuredClone(v43);
    alteredV43Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV43Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const v45 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v45',
      ),
    };
    expect(archivedUserPrompt).toBe(v45.userPrompt);
    expect(preservedPrompt.startsWith(v45.systemPrompt)).toBe(true);
    expect(v45.systemPrompt).not.toContain('CURRENT CLAUSE PERIOD');
    expect(out.systemPrompt).toContain('CURRENT CLAUSE PERIOD');
    expect(out.systemPrompt).toContain('ELLIPTICAL TABLE WORK SUBJECTS');
    expect(assembleContentAttachment(p, [v45])).toEqual(initialResult);
    const alteredV45Projection = structuredClone(v45);
    alteredV45Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV45Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const v46 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v46',
      ),
    };
    expect(archivedUserPrompt).toBe(v46.userPrompt);
    expect(preservedPrompt.startsWith(v46.systemPrompt)).toBe(true);
    expect(v46.systemPrompt).not.toContain('ESTABLISHED FEATURE GROUPS REMAIN');
    expect(out.systemPrompt).toContain('ESTABLISHED FEATURE GROUPS REMAIN');
    expect(out.systemPrompt).toContain('INVESTIGATION-STAGE IDENTITY BOUNDS');
    expect(assembleContentAttachment(p, [v46])).toEqual(initialResult);
    const alteredV46Projection = structuredClone(v46);
    alteredV46Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV46Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const v47 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v47',
      ),
    };
    expect(archivedUserPrompt).toBe(v47.userPrompt);
    expect(preservedPrompt.startsWith(v47.systemPrompt)).toBe(true);
    expect(v47.systemPrompt).not.toContain('SET-LEVEL EVIDENCE ATTACHMENT');
    expect(out.systemPrompt).toContain('SET-LEVEL EVIDENCE ATTACHMENT');
    expect(out.systemPrompt).toContain('PARTIAL RELATION IDENTITY');
    expect(assembleContentAttachment(p, [v47])).toEqual(initialResult);
    const alteredV47Projection = structuredClone(v47);
    alteredV47Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV47Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const v48 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v48',
      ),
    };
    expect(archivedUserPrompt).toBe(v48.userPrompt);
    expect(preservedPrompt.startsWith(v48.systemPrompt)).toBe(true);
    expect(v48.systemPrompt).not.toContain(
      'QUANTITIES REMAIN WITH THEIR ORIGINAL',
    );
    expect(out.systemPrompt).toContain('QUANTITIES REMAIN WITH THEIR ORIGINAL');
    expect(out.systemPrompt).toContain('BOTH RELATION ENDPOINTS REQUIRE');
    expect(assembleContentAttachment(p, [v48])).toEqual(initialResult);
    const alteredV48Projection = structuredClone(v48);
    alteredV48Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV48Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const v49 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v49',
      ),
    };
    expect(archivedUserPrompt).toBe(v49.userPrompt);
    expect(preservedPrompt.startsWith(v49.systemPrompt)).toBe(true);
    expect(v49.systemPrompt).not.toContain('CONFIRMED SET MEMBERSHIP SUPPORTS');
    expect(out.systemPrompt).toContain('CONFIRMED SET MEMBERSHIP SUPPORTS');
    expect(out.systemPrompt).toContain('NEAREST EXPLICIT WORK SUBJECT LIMITS');
    expect(assembleContentAttachment(p, [v49])).toEqual(initialResult);
    const alteredV49Projection = structuredClone(v49);
    alteredV49Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV49Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const v50 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v50',
      ),
    };
    expect(archivedUserPrompt).toBe(v50.userPrompt);
    expect(preservedPrompt.startsWith(v50.systemPrompt)).toBe(true);
    expect(v50.systemPrompt).not.toContain(
      'NO STATED RESTRICTION IS NOT POSITIVE',
    );
    expect(out.systemPrompt).toContain('NO STATED RESTRICTION IS NOT POSITIVE');
    expect(assembleContentAttachment(p, [v50])).toEqual(initialResult);
    const alteredV50Projection = structuredClone(v50);
    alteredV50Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV50Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const v51 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v51',
      ),
    };
    expect(archivedUserPrompt).toBe(v51.userPrompt);
    expect(preservedPrompt.startsWith(v51.systemPrompt)).toBe(true);
    expect(v51.systemPrompt).not.toContain(
      'DO NOT REQUIRE INDIVIDUAL REIDENTIFICATION',
    );
    expect(out.systemPrompt).toContain(
      'DO NOT REQUIRE INDIVIDUAL REIDENTIFICATION',
    );
    expect(out.systemPrompt).toContain('NARROW THE VERIFIED ANTECEDENT SET');
    expect(assembleContentAttachment(p, [v51])).toEqual(initialResult);
    const alteredV51Projection = structuredClone(v51);
    alteredV51Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV51Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const v52 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v52',
      ),
    };
    expect(archivedUserPrompt).toBe(v52.userPrompt);
    expect(preservedPrompt.startsWith(v52.systemPrompt)).toBe(true);
    expect(v52.systemPrompt).not.toContain(
      'CROSS-CHECK EACH EXPLICITLY LISTED IDENTIFIER',
    );
    expect(out.systemPrompt).toContain(
      'CROSS-CHECK EACH EXPLICITLY LISTED IDENTIFIER',
    );
    expect(assembleContentAttachment(p, [v52])).toEqual(initialResult);
    const alteredV52Projection = structuredClone(v52);
    alteredV52Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV52Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const v53 = {
      ...out,
      rawResponse: { decisions: out.rawResponse!.decisions },
      codeMap: createContentAttachmentBodyBlockInput(p, p.units[0]).codeMap,
      ...createContentAttachmentRequest(
        p,
        p.units[0],
        'content-attachment.v53',
      ),
    };
    expect(archivedUserPrompt).toBe(v53.userPrompt);
    expect(preservedPrompt.startsWith(v53.systemPrompt)).toBe(true);
    expect(v53.systemPrompt).not.toContain(
      'IDENTIFIER CROSS-CHECKING IS LOCAL',
    );
    expect(out.systemPrompt).toContain('IDENTIFIER CROSS-CHECKING IS LOCAL');
    expect(out.systemPrompt).toContain(
      'COMPLETE COLLECTIVE RECIPIENTS AND RELATIONSHIP-SUBJECT ALTERNATIVES',
    );
    expect(assembleContentAttachment(p, [v53])).toEqual(initialResult);
    const alteredV53Projection = structuredClone(v53);
    alteredV53Projection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [alteredV53Projection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const withoutRaw = structuredClone(out);
    delete withoutRaw.rawResponse;
    expect(
      assembleContentAttachment(p, [withoutRaw]).issues[0].reason,
    ).toContain('required excerpt');
    const changedProjection = structuredClone(out);
    changedProjection.response.ignored[0].reason = 'changed';
    expect(
      assembleContentAttachment(p, [changedProjection]).issues[0].reason,
    ).toContain('inconsistent projection');
    const call = vi.mocked(LLMCaller.call).mock.calls[0][0];
    expect(call.schema.safeParse(response).success).toBe(true);
    expect(call.schema.safeParse({ decisions: {} }).success).toBe(false);
    expect(
      call.schema.safeParse({
        decisions: {
          E1: {
            status: 'assigned',
            candidateRefs: ['missing'],
            reason: 'x',
            unresolved: null,
          },
        },
      }).success,
    ).toBe(false);
    vi.mocked(LLMCaller.call).mockRejectedValue(new Error('model failed'));
    await expect(
      attachContentUnit(p, p.units[0], {
        model: {} as LanguageModel,
        maxRetries: 0,
      }),
    ).rejects.toThrow('model failed');
    await expect(
      attachContentUnit(
        p,
        { ...p.units[0], sources: [] },
        { model: {} as LanguageModel, maxRetries: 0 },
      ),
    ).rejects.toThrow('No selectable');
    expect(() =>
      createContentAttachmentRequest(p, { ...p.units[0], unitId: 'outside' }),
    ).toThrow('Unknown');
  });
});
