import type { CandidateEvidence } from '../candidates/discovery-types';
import type { ContentAttachmentSelectionAudit } from './types';

import { describe, expect, test } from 'vitest';

import { assembleContentAttachment } from './assembly';
import {
  adjacentAttachmentBody,
  createContentAttachmentContextInput,
} from './context';
import { fixture } from './context.test-fixture';
import { createContentAttachmentRequest } from './request';
import { createContentAttachmentTableAnchorInput } from './tables/anchors';

describe('read-only original body and table context', () => {
  test('retains preceding inventory and qualified split text around a table-ended batch and supplies exact nonlocal candidate rows', () => {
    const { plan, unit } = fixture(),
      before = structuredClone(plan);
    const input = createContentAttachmentContextInput(plan, unit),
      old = createContentAttachmentTableAnchorInput(plan, unit);
    expect(input.payload.current.readOnlyContext.map((r) => r[2])).toEqual([
      'Three pits were investigated.',
      'Most were cut into red clay',
      'Finds',
      'A vessel was recovered.',
    ]);
    expect(input.payload.current.excerpts).toEqual(
      old.payload.current.excerpts,
    );
    expect(input.codeMap.excerpts).toEqual(old.codeMap.excerpts);
    expect(input.payload.supportingRows).toEqual([
      [
        'M1',
        'Q1',
        1,
        [
          [0, '2'],
          [1, 'round'],
        ],
      ],
      ['M2', 'Q1', 2, [[0, '3']]],
      ['M3', 'Q2', 0, [[0, '4']]],
    ]);
    expect(input.payload.supportingAnchors).toEqual([
      ['R2', 'M1', 0],
      ['R2', 'M1', 1],
      ['R3', 'M2', 0],
      ['R6', 'M3', 0],
    ]);
    expect(input.payload.supportingTables[0]).toEqual({
      ref: 'Q1',
      contexts: ['C1'],
      caption: 'Original inventory',
      headers: [
        [0, 0, 'Number', 1, 1, true],
        [0, 1, 'Dimensions', 1, 2, true],
      ],
    });
    expect(input.payload.supportingTables[1]).toEqual({
      ref: 'Q2',
      contexts: ['C1'],
      caption: null,
      headers: [],
    });
    expect(input.codeMap.supportingAnchors[0].evidence).toEqual(
      plan.registry[1].mentions[0].evidence[0],
    );
    expect(input.codeMap.supportingBody[0].resourceKey).toBe(
      '/chapters/0/textBlocks/0',
    );
    const headerProbe = structuredClone(plan);
    headerProbe.units[2].tables[0].data.grid[0][1].isHeader = false;
    expect(
      createContentAttachmentContextInput(headerProbe, headerProbe.units[1])
        .payload.supportingTables[0].headers[1],
    ).toEqual([0, 1, 'Dimensions', 1, 2, false]);
    expect(input.payload.supportingAnchors.some((a) => a[0] === 'R4')).toBe(
      false,
    );
    expect(
      input.payload.supportingRows
        .flatMap((r) => r[3])
        .some((c) => c[1] === '12'),
    ).toBe(false);
    for (const hidden of [
      'long-group',
      'long-candidate',
      'resourceKey',
      'charStart',
      '/tables/',
    ])
      expect(JSON.stringify(input.payload)).not.toContain(hidden);
    plan.registry.reverse();
    const reversed = createContentAttachmentContextInput(plan, unit);
    expect(reversed.payload.supportingRows).toEqual(
      input.payload.supportingRows,
    );
    expect([...reversed.payload.supportingAnchors].sort()).toEqual(
      [...input.payload.supportingAnchors].sort(),
    );
    plan.registry.reverse();
    expect(plan).toEqual(before);
  });

  test('handles table-only batches, document edges, unsorted pages and caller context without mutating or selecting them', () => {
    const { plan, unit } = fixture();
    const texts = plan.units
      .flatMap((u) => u.sources)
      .map((s) => s.resource)
      .filter((r) => r.kind === 'text');
    const cells = unit.sources.filter((s) => s.resource.kind === 'tableCell');
    expect(
      adjacentAttachmentBody(
        [...texts.slice(3), ...texts.slice(0, 3)],
        cells,
        2,
      ).map((c) => c.text),
    ).toEqual([
      'Most were cut into red clay',
      'or gray clay. Their plans vary.',
      'Finds',
      'A vessel was recovered.',
    ]);
    expect(adjacentAttachmentBody(texts, cells, 0).map((c) => c.text)).toEqual([
      'Three pits were investigated.',
      'Most were cut into red clay',
    ]);
    expect(adjacentAttachmentBody(texts, cells, 99).map((c) => c.text)).toEqual(
      ['Finds', 'A vessel was recovered.'],
    );
    expect(adjacentAttachmentBody([], cells, 2)).toEqual([]);
    const first = plan.units[0];
    expect(
      adjacentAttachmentBody(texts, first.sources, 1).map((c) => c.text),
    ).toEqual(['or gray clay. Their plans vary.', 'Finds']);
    unit.sources.reverse();
    expect(
      createContentAttachmentContextInput(plan, unit).payload.current
        .readOnlyContext[0][2],
    ).toBe('Three pits were investigated.');
    unit.readOnlyContext = [
      { resourceKey: '/caller', text: 'Caller context is evidence only.' },
    ];
    plan.registry[0].mentions[0].chapterPath = [];
    expect(
      createContentAttachmentContextInput(
        plan,
        unit,
      ).payload.current.readOnlyContext.at(-1),
    ).toEqual(['B5', [], 'Caller context is evidence only.']);
    unit.sources = cells;
    const none = createContentAttachmentContextInput(plan, unit);
    expect(
      none.payload.current.excerpts.every((e) => e[1] === 'tableCell'),
    ).toBe(true);
    plan.registry = [];
    const noAnchors = createContentAttachmentContextInput(plan, unit);
    expect(noAnchors.payload.supportingRows).toEqual([]);
    expect(noAnchors.payload.supportingTables).toEqual([]);
  });

  test('deduplicates aliases and ignores missing or body evidence while rejecting changed original cell ranges', () => {
    const { plan, unit } = fixture();
    const alias = structuredClone(plan.registry[1].mentions[0]);
    alias.candidateId = 'alias';
    plan.registry[1].mentions.push(alias);
    const missing = structuredClone(plan.registry[1].mentions[0]);
    missing.candidateId = 'missing';
    missing.evidence[0].resourceKey = '/missing';
    missing.evidence = missing.evidence.slice(0, 1);
    plan.registry[1].mentions.push(missing);
    const input = createContentAttachmentContextInput(plan, unit);
    expect(
      input.payload.supportingAnchors.filter((a) => a[0] === 'R2'),
    ).toHaveLength(2);
    expect(
      input.codeMap.supportingAnchors.filter((a) => a.candidateRef === 'R2'),
    ).toHaveLength(4);
    const mutations: Array<(e: CandidateEvidence) => void> = [
      (e) => {
        e.charStart = 0.5;
      },
      (e) => {
        e.charEnd = 1.5;
      },
      (e) => {
        e.charStart = -1;
      },
      (e) => {
        e.charEnd = 0;
      },
      (e) => {
        e.charEnd = 999;
      },
      (e) => {
        e.quote = 'invented';
      },
    ];
    for (const mutate of mutations) {
      const p = structuredClone(plan);
      mutate(p.registry[1].mentions[0].evidence[0]);
      expect(() => createContentAttachmentContextInput(p, p.units[1])).toThrow(
        'differs from original cell',
      );
    }
  });

  test('keeps context nonselectable, rejects forged support maps and replays exact v30 audits without filling semantic targets', () => {
    const { plan, unit } = fixture(),
      input = createContentAttachmentContextInput(plan, unit),
      old = createContentAttachmentTableAnchorInput(plan, unit);
    const headers = new Set(['E3', 'E4']);
    const raw: ContentAttachmentSelectionAudit = {
      unitId: unit.unitId,
      ...createContentAttachmentRequest(plan, unit, 'content-attachment.v32'),
      codeMap: input.codeMap,
      response: {
        assignments: input.codeMap.excerpts
          .filter((e) => !headers.has(e.ref))
          .map((e) => ({
            excerptRef: e.ref,
            candidateRefs: ['R1'],
            reason: 'Selected by model',
          })),
        unresolved: [],
        ignored: [...headers].map((excerptRef) => ({
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
    const before = structuredClone(raw),
      result = assembleContentAttachment(plan, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.contents.map((c) => c.registryRef)).toEqual(['R1']);
    expect(raw).toEqual(before);
    const historical = {
      ...raw,
      ...createContentAttachmentRequest(plan, unit, 'content-attachment.v30'),
      codeMap: old.codeMap,
    };
    expect(assembleContentAttachment(plan, [historical])).toEqual(result);
    expect(historical.systemPrompt).not.toContain(
      'READ-ONLY BODY AND SUPPORTING TABLE',
    );
    expect(raw.systemPrompt.startsWith(historical.systemPrompt)).toBe(true);
    const previousContext = {
      ...raw,
      ...createContentAttachmentRequest(plan, unit, 'content-attachment.v31'),
    };
    expect(previousContext.userPrompt).toBe(raw.userPrompt);
    expect(previousContext.codeMap).toEqual(raw.codeMap);
    expect(assembleContentAttachment(plan, [previousContext])).toEqual(result);
    expect(raw.systemPrompt.startsWith(previousContext.systemPrompt)).toBe(
      true,
    );

    const forged = structuredClone(raw);
    (forged.codeMap as typeof input.codeMap).supportingRows[0].rowIndex = 99;
    expect(
      assembleContentAttachment(plan, [forged]).issues[0].reason,
    ).toContain('code map');
    const selected = structuredClone(raw);
    selected.response.assignments[0].excerptRef = 'B1';
    expect(
      assembleContentAttachment(plan, [selected]).issues.some((i) =>
        i.reason.includes('Unknown'),
      ),
    ).toBe(true);
  });
});
