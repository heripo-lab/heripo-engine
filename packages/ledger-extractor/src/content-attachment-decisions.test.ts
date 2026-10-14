import type { ProcessedDocument } from '@heripo/model';
import type { LanguageModel } from 'ai';

import type {
  ContentAttachmentPlan,
  ContentAttachmentSelectionAudit,
} from './content-attachment';
import type { ContentRegistrationDecision } from './content-attachment-decisions';

import { LLMCaller } from '@heripo/shared';
import { describe, expect, test, vi } from 'vitest';

import {
  assembleContentAttachment,
  attachContentUnit,
  createContentAttachmentRequest,
} from './content-attachment';
import { createContentAttachmentDecisionInput } from './content-attachment-decisions';
import { createContentAttachmentSelectionInput } from './content-attachment-excerpts';
import { buildDocumentResourceIndex } from './document-resource-index';

vi.mock('@heripo/shared', () => ({ LLMCaller: { call: vi.fn() } }));

function fixture() {
  const text = 'A ditch drains the well. A ditch lies beside soil.';
  const doc: ProcessedDocument = {
    reportId: 'report',
    pageRangeMap: {
      1: { startPageNo: 0, endPageNo: 0 },
      2: { startPageNo: 1, endPageNo: 1 },
    },
    chapters: [1, 2].map((page) => ({
      id: `ch-${page}`,
      originTitle: 'Well',
      title: 'Well',
      level: 1,
      pageNo: page,
      textBlocks: [
        {
          id: `txt-${page}`,
          text,
          sourceRef: `#/texts/${page}`,
          pdfPageNo: page,
        },
      ],
      tableIds: [],
      imageIds: [],
      footnoteIds: [],
    })),
    images: [],
    tables: [],
    footnotes: [],
  };
  const index = buildDocumentResourceIndex(doc);
  const plan: ContentAttachmentPlan = {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: 'input',
    candidateSnapshotId: 'snapshot',
    registrySha256: 'registry',
    registryUncertainties: [],
    registry: [1, 2, 3].map((n) => ({
      ref: `R${n}`,
      groupId: `g${n}`,
      recordKind: n === 1 ? 'feature' : 'layer',
      mentions: [
        {
          candidateId: `c${n}`,
          sourceName: n === 1 ? 'Well' : 'Soil',
          sourceIdentifier: null,
          chapterPath: [{ id: 'ch-1', originTitle: 'Well' }],
          evidence: [],
        },
      ],
    })),
    pages: [],
    units: index.resources
      .filter((r) => r.kind === 'text')
      .map((r) => ({
        unitId: `page-${r.pdfPageNo}`,
        pdfPageNo: r.pdfPageNo!,
        sources: [{ sourceId: `source:${r.key}`, resource: r }],
        chapters: [
          {
            chapterId: r.chapterIds[0],
            path: [{ id: r.chapterIds[0], originTitle: 'Well' }],
          },
        ],
        tables: [],
        readOnlyContext: [],
      })),
  };
  const decisions: ContentRegistrationDecision[] = plan.units.map((u, i) => {
    const { sourceId, resource: r } = u.sources[0];
    return {
      decisionId: `decision-${i}`,
      inputSha256: 'input',
      decision: 'not_independent_record',
      basis: 'no_independent_body_or_table_item',
      authority: 'author_confirmed',
      provenance: {
        reference: 'confirmed-scope',
        text: 'No independent account for this mention.',
      },
      evidence: {
        sourceId,
        resourceKey: r.key,
        resourceId: r.resourceId,
        sourceRefs: r.sourceRefs,
        pdfPageNo: r.pdfPageNo,
        logicalPageRange: r.logicalPageRange,
        charStart: 2,
        charEnd: 7,
        quote: 'ditch',
      },
    };
  });
  plan.registrationDecisions = decisions;
  return { plan, unit: plan.units[0] };
}

describe('mention-scoped registration decisions', () => {
  test('binds only an exact occurrence, preserves other mentions and replay, and never repairs uncertain responses', async () => {
    const { plan, unit } = fixture();
    const before = structuredClone(plan);
    const input = createContentAttachmentDecisionInput(plan, unit);
    expect(input.payload.current.registrationDecisions).toEqual([
      {
        ref: 'D1',
        excerptRef: 'E1',
        mention: 'ditch',
        decision: 'not_independent_record',
        basis: 'no_independent_body_or_table_item',
        authority: 'author_confirmed',
      },
    ]);
    expect(input.payload.current.excerpts).toEqual(
      createContentAttachmentSelectionInput(plan, unit).payload.current
        .excerpts,
    );
    expect(input.codeMap.registrationDecisionSnapshot).toEqual(
      plan.registrationDecisions,
    );
    expect(input.codeMap.registrationDecisionBindings).toEqual([
      { ref: 'D1', decisionId: 'decision-0', excerptRef: 'E1' },
    ]);
    expect(
      createContentAttachmentDecisionInput(plan, plan.units[1]).payload.current
        .registrationDecisions[0],
    ).toMatchObject({ ref: 'D2', excerptRef: 'E1' });
    expect(plan).toEqual(before);
    const request = createContentAttachmentRequest(plan, unit);
    expect(JSON.parse(request.userPrompt)).toEqual(input.payload);
    const response = {
      assignments: [
        {
          excerptRef: 'E1',
          candidateRefs: ['R1'],
          reason: 'Direct well context',
        },
        { excerptRef: 'E2', candidateRefs: ['R1'], reason: 'Other context' },
      ],
      unresolved: [
        {
          excerptRef: 'E2',
          candidateRefs: ['R2', 'R3'],
          reason: 'Uncertain soil identity',
        },
      ],
      ignored: [],
    };
    const usage = {
      component: 'test',
      phase: 'test',
      model: 'primary' as const,
      modelName: 'mock',
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    };
    vi.mocked(LLMCaller.call).mockResolvedValue({
      output: response,
      usage,
      usedFallback: false,
    });
    const audit = await attachContentUnit(plan, unit, {
      model: {} as LanguageModel,
      maxRetries: 0,
    });
    expect(LLMCaller.call).toHaveBeenCalledTimes(1);
    expect(audit.response).toEqual(response);
    expect(audit.codeMap).toEqual(input.codeMap);
    const saved = structuredClone(audit);
    const result = assembleContentAttachment(plan, [audit]);
    expect(result.issues).toEqual([]);
    expect(result.unresolved[0].candidateRefs).toEqual(['R2', 'R3']);
    expect(result.contents[0].excerpts).toHaveLength(2);
    expect(audit).toEqual(saved);
    const historical: ContentAttachmentSelectionAudit = {
      ...audit,
      ...createContentAttachmentRequest(plan, unit, 'content-attachment.v12'),
      codeMap: createContentAttachmentSelectionInput(plan, unit).codeMap,
    };
    expect(
      JSON.parse(historical.userPrompt).current.registrationDecisions,
    ).toBeUndefined();
    expect(assembleContentAttachment(plan, [historical])).toEqual(result);
    const forged = structuredClone(audit);
    (
      forged.codeMap as typeof input.codeMap
    ).registrationDecisionSnapshot[0].provenance.text = 'changed';
    expect(
      assembleContentAttachment(plan, [forged]).issues[0].reason,
    ).toContain('code map');
    const unresolved = structuredClone(audit);
    unresolved.response.unresolved.push({
      excerptRef: 'E1',
      candidateRefs: [],
      reason: 'Unwanted missing candidate concern',
    });
    expect(
      assembleContentAttachment(plan, [unresolved]).unresolved,
    ).toHaveLength(2);
    expect(unresolved.response.unresolved[1].candidateRefs).toEqual([]);
    const without = structuredClone(plan);
    delete without.registrationDecisions;
    expect(
      createContentAttachmentDecisionInput(without, unit).payload.current
        .registrationDecisions,
    ).toEqual([]);
  });

  test('rejects foreign, ambiguous, inexact or cross-sentence decisions before calling a model', async () => {
    const { plan, unit } = fixture();
    const mutate: Array<(p: ContentAttachmentPlan) => void> = [
      (p) => {
        p.registrationDecisions![0].decisionId = '';
      },
      (p) => {
        p.registrationDecisions![1].decisionId =
          p.registrationDecisions![0].decisionId;
      },
      (p) => {
        p.registrationDecisions![0].inputSha256 = 'other';
      },
      (p) => {
        Object.assign(p.registrationDecisions![0], { decision: 'proposed' });
      },
      (p) => {
        Object.assign(p.registrationDecisions![0], { basis: 'unknown' });
      },
      (p) => {
        Object.assign(p.registrationDecisions![0], {
          authority: 'llm_proposed',
        });
      },
      (p) => {
        p.registrationDecisions![0].provenance.reference = '';
      },
      (p) => {
        p.registrationDecisions![0].provenance.text = '';
      },
      (p) => {
        p.registrationDecisions![0].evidence.resourceKey = 'missing';
      },
      (p) => {
        p.units.push(structuredClone(p.units[0]));
      },
      (p) => {
        p.registrationDecisions![0].evidence.charStart = 0.5;
      },
      (p) => {
        p.registrationDecisions![0].evidence.charEnd = 7.5;
      },
      (p) => {
        p.registrationDecisions![0].evidence.charStart = -1;
      },
      (p) => {
        p.registrationDecisions![0].evidence.charEnd = 2;
      },
      (p) => {
        p.registrationDecisions![0].evidence.charEnd = 999;
      },
      (p) => {
        p.registrationDecisions![0].evidence.quote = ' ';
      },
      (p) => {
        p.registrationDecisions![0].evidence.quote = 'Ditch';
      },
      (p) => {
        p.registrationDecisions![0].evidence.sourceRefs = ['wrong'];
      },
      (p) => {
        const e = p.registrationDecisions![0].evidence;
        e.charStart = 0;
        e.charEnd = 26;
        e.quote = p.units[0].sources[0].resource.data.text.slice(0, 26);
      },
    ];
    for (const change of mutate) {
      const invalid = structuredClone(plan);
      change(invalid);
      expect(() =>
        createContentAttachmentDecisionInput(invalid, invalid.units[0]),
      ).toThrow(/Registration decision|registration decision/);
      await expect(
        attachContentUnit(invalid, invalid.units[0], {
          model: {} as LanguageModel,
          maxRetries: 0,
        }),
      ).rejects.toThrow();
    }
    expect(LLMCaller.call).not.toHaveBeenCalled();
    expect(() =>
      createContentAttachmentDecisionInput(plan, {
        ...unit,
        unitId: 'unknown',
      }),
    ).toThrow('Unknown');
  });
});
