import type * as Shared from '@heripo/shared';

import type { ContentAttachmentAudit } from './types';

import { describe, expect, test, vi } from 'vitest';

import { assembleContentAttachment } from './assembly';
import {
  audit,
  empty,
  ignore,
  prepare,
  usage,
} from './content-attachment.test-fixture';
import { createContentAttachmentInput } from './input';
import { createContentAttachmentRequest } from './request';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

describe('bounded content attachment', () => {
  test('attaches a sentence to multiple candidates, retains all exact occurrences and separates unchanged table cells and split block fragments', async () => {
    const p = await prepare();
    const source = (i: number, id: string) =>
      p.units[i].sources.find((s) => s.resource.resourceId === id)!.sourceId;
    const a = audit(p, 1, {
      assignments: [
        {
          candidateRefs: ['R1', 'R2'],
          fragments: [{ sourceId: source(1, 'a'), quote: '井戸と廃棄層。' }],
          reason: '共有',
        },
        {
          candidateRefs: ['R1'],
          fragments: p.units[1].sources
            .filter(
              (s) =>
                s.resource.kind === 'tableCell' &&
                s.resource.rowIndex === 1 &&
                s.resource.columnIndex < 2,
            )
            .map((s) => ({
              sourceId: s.sourceId,
              quote: s.resource.data.text,
            })),
          reason: '表項目',
        },
      ],
      unresolved: [],
      ignoredPassages: [],
      ignoredSources: p.units[1].sources
        .filter(
          (s) =>
            s.resource.kind === 'tableCell' &&
            (s.resource.rowIndex === 0 || s.resource.columnIndex === 2),
        )
        .map((s) => ({ sourceId: s.sourceId, reason: '見出しまたは空欄' })),
    });
    const b = audit(p, 2, {
      assignments: [
        {
          candidateRefs: ['R1'],
          fragments: [{ sourceId: source(2, 'b'), quote: '井戸と廃棄層。' }],
          reason: '共有',
        },
        {
          candidateRefs: ['R1'],
          fragments: [{ sourceId: source(2, 'b'), quote: '井戸と廃棄層。' }],
          reason: '共有',
        },
        {
          candidateRefs: ['R1'],
          fragments: [
            { sourceId: source(2, 'c'), quote: '前半の文は切れ' },
            { sourceId: source(2, 'd'), quote: 'たまま。' },
          ],
          reason: '分割原文',
        },
      ],
      unresolved: [
        {
          candidateRefs: [],
          fragments: [
            { sourceId: source(2, 'repeated'), quote: '同文。同文。' },
          ],
          reason: '対応不明',
        },
      ],
      ignoredPassages: [],
      ignoredSources: [],
    });
    const before = structuredClone([p, a, b]);
    const result = assembleContentAttachment(p, [a, b]);
    expect(result.issues).toEqual([]);
    expect(result.completedUnitIds).toHaveLength(2);
    expect(result.totalUnits).toBe(3);
    expect(result.reviewStatus).toBe('not_reviewed');
    expect(result.contents[0].excerpts[0].occurrences).toHaveLength(2);
    expect(result.contents[0].excerpts[1]).toMatchObject({
      kind: 'table_item',
      fragments: ['7', '20'],
    });
    expect(result.contents[1].excerpts).toHaveLength(1);
    expect(result.unresolved[0].candidateRefs).toEqual([]);
    expect([p, a, b]).toEqual(before);
  });

  test('keeps invalid selectors, quotes, ambiguous locations, fragment order and unaccounted sources visible without repair', async () => {
    const p = await prepare();
    const source = p.units[2].sources[0].sourceId;
    const f = { sourceId: source, quote: '井戸と廃棄層。' };
    for (const item of [
      { candidateRefs: ['outside'], fragments: [f], reason: 'x' },
      { candidateRefs: ['R1', 'R1'], fragments: [f], reason: 'x' },
      {
        candidateRefs: ['R1'],
        fragments: [{ ...f, sourceId: 'outside' }],
        reason: 'x',
      },
      {
        candidateRefs: ['R1'],
        fragments: [{ ...f, quote: '修正原文' }],
        reason: 'x',
      },
      { candidateRefs: ['R1'], fragments: [f, f], reason: 'x' },
      {
        candidateRefs: ['R1'],
        fragments: [
          { sourceId: p.units[2].sources.at(-1)!.sourceId, quote: '同文。' },
        ],
        reason: 'x',
      },
      {
        candidateRefs: ['R1'],
        fragments: [
          { sourceId: p.units[2].sources[2].sourceId, quote: 'たまま。' },
          { sourceId: p.units[2].sources[1].sourceId, quote: '前半の文は切れ' },
        ],
        reason: 'x',
      },
    ]) {
      const raw = audit(p, 2, { ...empty(), assignments: [item] });
      const before = structuredClone(raw);
      const result = assembleContentAttachment(p, [raw]);
      expect(result.contents).toEqual([]);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.completedUnitIds).toEqual([]);
      expect(raw).toEqual(before);
    }
    const mixed = audit(p, 1, {
      ...empty(),
      assignments: [
        {
          candidateRefs: ['R1'],
          fragments: [
            {
              sourceId: p.units[1].sources[0].sourceId,
              quote: '井戸と廃棄層。',
            },
            { sourceId: p.units[1].sources[1].sourceId, quote: '番号' },
          ],
          reason: 'x',
        },
      ],
    });
    expect(assembleContentAttachment(p, [mixed]).issues[0].reason).toContain(
      'fragments',
    );
    const badTable = structuredClone(p);
    const other = badTable.units[1].sources[2].resource;
    if (other.kind === 'tableCell') other.tableId = 'other';
    const raw = audit(badTable, 1, {
      ...empty(),
      assignments: [
        {
          candidateRefs: ['R1'],
          fragments: badTable.units[1].sources.slice(1, 3).map((s) => ({
            sourceId: s.sourceId,
            quote: s.resource.data.text,
          })),
          reason: 'x',
        },
      ],
    });
    expect(assembleContentAttachment(badTable, [raw]).contents).toEqual([]);
  });

  test('requires exact audit bindings, source coverage and non-conflicting ignore decisions', async () => {
    const p = await prepare();
    const a = audit(p, 0, {
      ...empty(),
      ignoredPassages: [],
      ignoredSources: ignore(p, 0),
    });
    expect(assembleContentAttachment(p, [a, a]).issues[0].reason).toContain(
      'repeated',
    );
    for (const change of [
      { unitId: 'missing' },
      { promptVersion: 'other' },
      { systemPrompt: 'other' },
      { userPrompt: 'other' },
      { response: null },
    ])
      expect(
        assembleContentAttachment(p, [
          { ...a, ...change } as ContentAttachmentAudit,
        ]).issues,
      ).not.toEqual([]);
    const source = p.units[0].sources[0];
    const conflict = audit(p, 0, {
      assignments: [
        {
          candidateRefs: ['R1'],
          fragments: [
            { sourceId: source.sourceId, quote: source.resource.data.text },
          ],
          reason: 'x',
        },
      ],
      unresolved: [],
      ignoredPassages: [],
      ignoredSources: [...ignore(p, 0), { sourceId: 'outside', reason: 'x' }],
    });
    expect(assembleContentAttachment(p, [conflict]).issues).toHaveLength(2);
    expect(assembleContentAttachment(p, []).completedUnitIds).toEqual([]);
    expect(
      assembleContentAttachment(p, [audit(p, 0, empty())]).issues[0].reason,
    ).toContain('Unaccounted');
  });

  test('replays compact selectors to exact original provenance while preserving raw decisions and rejecting forged maps', async () => {
    const p = await prepare();
    const raw: ContentAttachmentAudit = {
      unitId: p.units[1].unitId,
      ...createContentAttachmentRequest(p, p.units[1], 'content-attachment.v8'),
      response: {
        assignments: [
          {
            candidateRefs: ['R1', 'R2'],
            fragments: [{ sourceId: 'S1', quote: '井戸と廃棄層。' }],
            reason: '共有',
          },
        ],
        unresolved: [],
        ignoredPassages: [],
        ignoredSources: p.units[1].sources
          .slice(1)
          .map((_, i) => ({ sourceId: `S${i + 2}`, reason: '対象外' })),
      },
      usage,
      codeMap: createContentAttachmentInput(p, p.units[1]).codeMap,
    };
    const before = structuredClone(raw);
    const result = assembleContentAttachment(p, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.contents).toHaveLength(2);
    expect(
      result.contents[0].excerpts[0].occurrences[0].evidence[0],
    ).toMatchObject({
      sourceId: p.units[1].sources[0].sourceId,
      sourceRefs: ['#/texts/1'],
      charStart: 0,
      charEnd: 7,
    });
    expect(result.ignoredSources[0].sourceId).toBe(
      p.units[1].sources[1].sourceId,
    );
    expect(raw).toEqual(before);
    for (const change of [
      (a: ContentAttachmentAudit) => {
        delete a.codeMap;
      },
      (a: ContentAttachmentAudit) => {
        a.codeMap!.inputSha256 = 'other';
      },
      (a: ContentAttachmentAudit) => {
        a.codeMap!.sources[0].source.resource.sourceRefs = ['changed'];
      },
    ]) {
      const changed = structuredClone(raw);
      change(changed);
      expect(
        assembleContentAttachment(p, [changed]).issues[0].reason,
      ).toContain('code map');
    }
    const invalid = structuredClone(raw);
    invalid.response.assignments[0].fragments[0].sourceId =
      p.units[1].sources[0].sourceId;
    expect(assembleContentAttachment(p, [invalid]).contents).toEqual([]);
    const legacy = audit(p, 0, {
      ...empty(),
      ignoredPassages: [],
      ignoredSources: ignore(p, 0),
    });
    expect(
      assembleContentAttachment(p, [legacy, raw]).completedUnitIds,
    ).toHaveLength(2);
  });
});
