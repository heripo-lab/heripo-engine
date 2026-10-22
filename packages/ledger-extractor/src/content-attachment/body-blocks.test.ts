import type { ContentAttachmentSelectionAudit } from './types';

import { describe, expect, test } from 'vitest';

import { assembleContentAttachment } from './assembly';
import { createContentAttachmentBodyBlockInput } from './body-blocks';
import { createContentAttachmentContextInput } from './context';
import { fixture } from './context.test-fixture';
import { createContentAttachmentRequest } from './request';

describe('original selectable body block input', () => {
  test('preserves distinct original blocks with identical text, skips whitespace and keeps table excerpts separate without changing source ranges', () => {
    const { plan, unit } = fixture();
    const original = unit.sources.find((s) => s.resource.kind === 'text')!;
    const repeated = structuredClone(original);
    repeated.sourceId = 'long-repeat-source';
    repeated.resource.key = '/long-repeat-resource';
    const blank = structuredClone(original);
    blank.sourceId = 'blank';
    blank.resource.key = '/blank-resource';
    blank.resource.data.text = '  \n ';
    unit.sources.push(repeated, blank);
    const before = structuredClone(plan);
    const old = createContentAttachmentContextInput(plan, unit);
    const input = createContentAttachmentBodyBlockInput(plan, unit);
    expect(input.payload.current.bodyBlockColumns).toEqual(['ref', 'excerpts']);
    expect(input.payload.current.bodyBlocks).toEqual([
      ['P1', ['E1', 'E2']],
      ['P2', ['E7', 'E8']],
    ]);
    expect(input.codeMap.bodyBlocks).toEqual([
      {
        ref: 'P1',
        sourceId: original.sourceId,
        resourceKey: original.resource.key,
        excerpts: ['E1', 'E2'],
      },
      {
        ref: 'P2',
        sourceId: repeated.sourceId,
        resourceKey: repeated.resource.key,
        excerpts: ['E7', 'E8'],
      },
    ]);
    expect(input.codeMap.excerpts).toEqual(old.codeMap.excerpts);
    const {
      bodyBlockColumns: _columns,
      bodyBlocks: _blocks,
      ...current
    } = input.payload.current;
    expect(current).toEqual(old.payload.current);
    expect(JSON.stringify(input.payload)).not.toContain('long-repeat');
    expect(plan).toEqual(before);
    const cells = unit.sources.filter((s) => s.resource.kind === 'tableCell');
    unit.sources = cells;
    expect(
      createContentAttachmentBodyBlockInput(plan, unit).payload.current
        .bodyBlocks,
    ).toEqual([]);
  });

  test('replays v31 and v32 without block bindings and replays v33 block bindings and rejects forged or selected block references', () => {
    const { plan, unit } = fixture();
    const current = createContentAttachmentBodyBlockInput(plan, unit);
    const old = createContentAttachmentContextInput(plan, unit);
    const request = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v41',
    );
    expect(request.promptVersion).toBe('content-attachment.v41');
    const latest = createContentAttachmentRequest(plan, unit);
    expect(latest.promptVersion).toBe('content-attachment.v74');
    expect(JSON.parse(latest.userPrompt).current).toEqual(
      JSON.parse(request.userPrompt).current,
    );
    expect(
      createContentAttachmentRequest(
        plan,
        unit,
        'content-attachment.v57',
      ).systemPrompt.startsWith(request.systemPrompt),
    ).toBe(true);
    expect(request.systemPrompt).not.toContain(
      'REQUIRED PER-E OUTPUT CONTRACT',
    );
    expect(JSON.parse(request.userPrompt)).toEqual(current.payload);
    expect(request.systemPrompt).toContain(
      'NONREGISTERED SUBJECTS STILL GOVERN FOLLOW-UP SENTENCES',
    );
    const raw: ContentAttachmentSelectionAudit = {
      unitId: unit.unitId,
      ...request,
      codeMap: current.codeMap,
      response: {
        assignments: ['E1', 'E2', 'E5', 'E6'].map((excerptRef) => ({
          excerptRef,
          candidateRefs: ['R1'],
          reason: 'Model selection',
        })),
        unresolved: [],
        ignored: ['E3', 'E4'].map((excerptRef) => ({
          excerptRef,
          reason: 'Header',
        })),
      },
      usage: {
        component: 'test',
        phase: 'test',
        model: 'primary',
        modelName: 'mock',
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      },
    };
    const before = structuredClone(raw);
    const result = assembleContentAttachment(plan, [raw]);
    expect(result.issues).toEqual([]);
    expect(raw).toEqual(before);
    for (const version of [
      'content-attachment.v31',
      'content-attachment.v32',
    ] as const) {
      const historicalRequest = createContentAttachmentRequest(
        plan,
        unit,
        version,
      );
      expect(JSON.parse(historicalRequest.userPrompt)).toEqual(old.payload);
      expect(historicalRequest.systemPrompt).not.toContain(
        'ORIGINAL SELECTABLE BODY BLOCKS',
      );
      expect(
        request.systemPrompt.startsWith(historicalRequest.systemPrompt),
      ).toBe(true);
      expect(
        assembleContentAttachment(plan, [
          { ...raw, ...historicalRequest, codeMap: old.codeMap },
        ]),
      ).toEqual(result);
    }
    const v33 = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v33',
    );
    expect(JSON.parse(v33.userPrompt)).toEqual(current.payload);
    expect(v33.systemPrompt).not.toContain(
      'PARTIAL FOLLOW-UPS PRESERVE QUALIFIED SET EVIDENCE',
    );
    expect(request.systemPrompt.startsWith(v33.systemPrompt)).toBe(true);
    expect(assembleContentAttachment(plan, [{ ...raw, ...v33 }])).toEqual(
      result,
    );
    for (const version of [
      'content-attachment.v34',
      'content-attachment.v35',
      'content-attachment.v36',
    ] as const) {
      const historical = createContentAttachmentRequest(plan, unit, version);
      expect(historical.userPrompt).toBe(request.userPrompt);
      expect(request.systemPrompt.startsWith(historical.systemPrompt)).toBe(
        true,
      );
      expect(historical.systemPrompt).not.toContain(
        'NONREGISTERED ANTECEDENTS GOVERN SUBSEQUENT DESCRIPTIONS',
      );
      expect(
        historical.systemPrompt.includes(
          'SURVEY AREA LAYOUT AND IDENTIFIED TRENCHES',
        ),
      ).toBe(version === 'content-attachment.v36');
      expect(
        assembleContentAttachment(plan, [{ ...raw, ...historical }]),
      ).toEqual(result);
    }
    const v37 = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v37',
    );
    expect(v37.userPrompt).toBe(request.userPrompt);
    expect(request.systemPrompt.startsWith(v37.systemPrompt)).toBe(true);
    expect(v37.systemPrompt).toContain(
      'NONREGISTERED ANTECEDENTS GOVERN SUBSEQUENT DESCRIPTIONS',
    );
    expect(v37.systemPrompt).not.toContain(
      'LATER INDIVIDUAL CLAUSES DO NOT ERASE EARLIER ESTABLISHED-SET DESCRIPTIONS',
    );
    expect(assembleContentAttachment(plan, [{ ...raw, ...v37 }])).toEqual(
      result,
    );
    const v38 = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v38',
    );
    expect(v38.userPrompt).toBe(request.userPrompt);
    expect(request.systemPrompt.startsWith(v38.systemPrompt)).toBe(true);
    expect(v38.systemPrompt).toContain(
      'LATER INDIVIDUAL CLAUSES DO NOT ERASE EARLIER ESTABLISHED-SET DESCRIPTIONS',
    );
    expect(v38.systemPrompt).not.toContain(
      'ROW OWNERS ARE REQUIRED, NOT EXCLUSIVE, TARGETS OF RELATION REMARKS',
    );
    expect(assembleContentAttachment(plan, [{ ...raw, ...v38 }])).toEqual(
      result,
    );
    const v39 = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v39',
    );
    expect(v39.userPrompt).toBe(request.userPrompt);
    expect(request.systemPrompt.startsWith(v39.systemPrompt)).toBe(true);
    expect(v39.systemPrompt).toContain(
      'ROW OWNERS ARE REQUIRED, NOT EXCLUSIVE, TARGETS OF RELATION REMARKS',
    );
    expect(v39.systemPrompt).not.toContain(
      'NEAREST EXPLICIT INVENTORY BOUNDS IMPLICIT FOLLOW-UPS',
    );
    expect(assembleContentAttachment(plan, [{ ...raw, ...v39 }])).toEqual(
      result,
    );
    const v40 = createContentAttachmentRequest(
      plan,
      unit,
      'content-attachment.v40',
    );
    expect(v40.userPrompt).toBe(request.userPrompt);
    expect(request.systemPrompt.startsWith(v40.systemPrompt)).toBe(true);
    expect(v40.systemPrompt).toContain(
      'NEAREST EXPLICIT INVENTORY BOUNDS IMPLICIT FOLLOW-UPS',
    );
    expect(v40.systemPrompt).not.toContain(
      'EACH REGISTERED INDIVIDUAL ARTIFACT HEADING IS AN INDEPENDENT REQUIRED E SELECTION',
    );
    expect(
      assembleContentAttachment(plan, [
        {
          ...raw,
          ...v40,
        },
      ]),
    ).toEqual(result);

    const forged = structuredClone(raw);
    (forged.codeMap as typeof current.codeMap).bodyBlocks[0].excerpts = ['E5'];
    expect(
      assembleContentAttachment(plan, [forged]).issues[0].reason,
    ).toContain('code map');
    const selected = structuredClone(raw);
    selected.response.assignments[0].excerptRef = 'P1';
    expect(
      assembleContentAttachment(plan, [selected]).issues.some((i) =>
        i.reason.includes('Unknown'),
      ),
    ).toBe(true);
  });
});
