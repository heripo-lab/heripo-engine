import type * as Shared from '@heripo/shared';

import type { ContentRegistrationDecision } from './decisions';

import { describe, expect, test, vi } from 'vitest';

import { prepareCandidateDiscovery } from '../candidates/discovery-plan';
import { buildDocumentResourceIndex } from '../resources/document-resource-index';
import { fixture, prepare } from './content-attachment.test-fixture';
import { createContentAttachmentInput } from './input';
import { prepareContentAttachment } from './prepare';
import { createContentAttachmentRequest } from './request';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

describe('bounded content attachment', () => {
  test('snapshots caller-confirmed mention decisions without sharing mutable caller state', async () => {
    const f = fixture();
    const original = await prepare();
    const source = original.units
      .flatMap((u) => u.sources)
      .find((s) => s.resource.resourceId === 'a')!;
    const r = source.resource;
    const decisions: ContentRegistrationDecision[] = [
      {
        decisionId: 'author-scope',
        inputSha256: f.options.inputSha256,
        decision: 'not_independent_record',
        basis: 'no_independent_body_or_table_item',
        authority: 'author_confirmed',
        evidence: {
          sourceId: source.sourceId,
          resourceKey: r.key,
          resourceId: r.resourceId,
          sourceRefs: r.sourceRefs,
          pdfPageNo: r.pdfPageNo,
          logicalPageRange: r.logicalPageRange,
          charStart: 0,
          charEnd: 2,
          quote: r.data.text.slice(0, 2),
        },
        provenance: {
          reference: 'author-confirmation',
          text: 'Confirmed decision',
        },
      },
    ];
    const plan = await prepareContentAttachment(
      f.index,
      f.dp,
      f.discovery,
      f.groups,
      { ...f.options, registrationDecisions: decisions },
    );
    expect(plan.registrationDecisions).toEqual(decisions);
    decisions[0].provenance.text = 'Caller mutation';
    expect(plan.registrationDecisions![0].provenance.text).toBe(
      'Confirmed decision',
    );
    const unit = plan.units.find((u) =>
      u.sources.some((s) => s.sourceId === source.sourceId),
    )!;
    expect(
      JSON.parse(createContentAttachmentRequest(plan, unit).userPrompt).current
        .registrationDecisions,
    ).toHaveLength(1);
  });

  test('plans from the first physical page, retains gaps, whole table rows, original spans and signed logical pages without mutating inputs', async () => {
    const f = fixture(),
      before = structuredClone(f);
    const p = await prepareContentAttachment(
      f.index,
      f.dp,
      f.discovery,
      f.groups,
      { ...f.options, maxUnitChars: 1 },
    );
    expect(f).toEqual(before);
    expect(p.pages[0]).toEqual({
      pdfPageNo: 1,
      unitIds: [],
      status: 'no_body_or_table_text',
    });
    expect(p.pages.at(-1)?.pdfPageNo).toBe(5);
    expect(p.units[0].pdfPageNo).toBe(2);
    expect(p.units[0].sources[0].resource.logicalPageRange).toEqual({
      startPageNo: 0,
      endPageNo: 0,
    });
    expect(
      p.units.find((u) =>
        u.sources.some(
          (s) => s.resource.kind === 'tableCell' && s.resource.rowIndex === 1,
        ),
      )?.sources,
    ).toHaveLength(3);
    expect(p.units.find((u) => u.tables.length)?.tables[0].data.grid).toEqual(
      f.doc.tables[0].grid,
    );
    expect(p.registryUncertainties).toEqual(f.groups.uncertainMatches);
    expect(p.registrySha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await prepare()).registrySha256).toBe(p.registrySha256);
    const mixed = (await prepare()).units.find((u) => u.pdfPageNo === 3)!;
    expect(mixed.sources.at(-1)!.resource.kind).toBe('tableCell');
    expect(mixed.readOnlyContext.map((c) => c.text)).toEqual([
      '報告書',
      '井戸と廃棄層。',
      '前半の文は切れ',
    ]);
    const nested = fixture();
    nested.doc.chapters = [
      {
        ...nested.doc.chapters[0],
        id: 'parent',
        textBlocks: [],
        tableIds: [],
        children: nested.doc.chapters,
      },
    ];
    nested.index = buildDocumentResourceIndex(nested.doc);
    nested.dp = prepareCandidateDiscovery(nested.index, {
      scopeChapterId: 'ch',
      inputSha256: 'hash',
      maxTextChars: 8000,
      tableRowsPerUnit: 12,
    });
    nested.discovery.completedUnitIds = nested.dp.units.map((u) => u.unitId);
    nested.discovery.candidates.forEach((c) => {
      c.unitIds = [nested.dp.units[0].unitId];
      c.evidence[0].resourceKey = '/chapters/0/children/0/textBlocks/1';
    });
    expect(
      (
        await prepareContentAttachment(
          nested.index,
          nested.dp,
          nested.discovery,
          nested.groups,
          nested.options,
        )
      ).units[0].chapters[0].path.map((c) => c.id),
    ).toEqual(['parent', 'ch']);
    const noPages = fixture();
    noPages.index.resources = [];
    noPages.discovery.candidates.forEach((c) => {
      c.evidence = [];
    });
    expect(
      (
        await prepareContentAttachment(
          noPages.index,
          noPages.dp,
          noPages.discovery,
          noPages.groups,
          { ...noPages.options, pdfPageNumbers: [] },
        )
      ).pages,
    ).toEqual([]);
  });

  test('rejects incomplete, inconsistent or malformed snapshots and unlocated physical sources', async () => {
    for (const change of [
      (f: ReturnType<typeof fixture>) => {
        f.options.inputSha256 = 'other';
      },
      (f: ReturnType<typeof fixture>) => {
        f.options.candidateSnapshotId = '';
      },
      (f: ReturnType<typeof fixture>) => {
        f.options.maxUnitChars = 0;
      },
      (f: ReturnType<typeof fixture>) => {
        f.options.maxUnitChars = 1.5;
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.issues = ['invalid'];
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.groups = [];
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.groups[0].memberCandidateIds = [];
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.groups[0].memberCandidateIds = ['missing'];
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.groups[0].memberCandidateIds = ['one', 'one'];
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.groups.pop();
        f.groups.uncertainMatches = [];
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.groups[1].groupId = 'g1';
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.uncertainMatches[0].leftCandidateId = 'missing';
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.uncertainMatches[0].rightCandidateId = 'missing';
      },
      (f: ReturnType<typeof fixture>) => {
        f.groups.groups[0].memberCandidateIds.push('two');
        f.groups.groups.pop();
      },
      (f: ReturnType<typeof fixture>) => {
        f.discovery.candidates[0].recordKind = 'feature';
        f.groups.groups[0].memberCandidateIds.push('two');
        f.groups.groups.pop();
      },
      (f: ReturnType<typeof fixture>) => {
        f.discovery.candidates[0].evidence[0].quote = '不存在';
      },
      (f: ReturnType<typeof fixture>) => {
        f.discovery.candidates[0].evidence[0].resourceKey = '/missing';
      },
      (f: ReturnType<typeof fixture>) => {
        f.discovery.candidates[0].evidence[0].resourceKey = '/chapters/0';
      },
      (f: ReturnType<typeof fixture>) => {
        f.options.pdfPageNumbers = [0];
      },
      (f: ReturnType<typeof fixture>) => {
        f.index.resources.find((r) => r.kind === 'text')!.pdfPageNo = null;
      },
      (f: ReturnType<typeof fixture>) => {
        f.discovery.completedUnitIds = [];
      },
    ]) {
      const f = fixture();
      change(f);
      await expect(
        prepareContentAttachment(
          f.index,
          f.dp,
          f.discovery,
          f.groups,
          f.options,
        ),
      ).rejects.toThrow();
    }
  });

  test('encodes all candidate mentions and literal quotes with shared contexts, short selectors and a lossless code map', async () => {
    const p = await prepare();
    const alias = structuredClone(p.registry[0].mentions[0]);
    alias.candidateId = 'third-long-candidate-id';
    alias.sourceName = '別名';
    alias.sourceIdentifier = '7.';
    alias.chapterPath = [{ id: 'different-chapter', originTitle: '調査' }];
    alias.evidence = [
      { ...alias.evidence[0], quote: '前半' },
      { ...alias.evidence[0], quote: 'のまま' },
    ];
    p.registry[0].mentions.push(alias);
    const before = structuredClone(p);
    const { payload, codeMap } = createContentAttachmentInput(p, p.units[1]);
    expect(payload.candidates).toHaveLength(3);
    expect(payload.candidates.map((row) => row[0])).toEqual(['R1', 'R1', 'R2']);
    expect(payload.candidates[1]).toEqual([
      'R1',
      'layer',
      'C2',
      '別名',
      '7.',
      ['前半', 'のまま'],
    ]);
    expect(payload.contexts).toEqual({ C1: ['調査'], C2: ['調査'] });
    expect(payload.uncertainties[0].refs).toEqual(['R1', 'R2']);
    expect(codeMap.candidateRows[1]).toMatchObject({
      groupId: 'g1',
      candidateId: alias.candidateId,
      evidence: alias.evidence,
    });
    expect(codeMap.sources.map((s) => s.ref)).toEqual(
      p.units[1].sources.map((_, i) => `S${i + 1}`),
    );
    expect(codeMap.sources.map((s) => s.source)).toEqual(p.units[1].sources);
    expect(codeMap.contextPaths.C2).toEqual(alias.chapterPath);
    expect(payload.current.sources[1][3]).toEqual(['T1', 0, 0]);
    expect(payload.current.tables[0].grid[0][0]).toEqual([
      'S2',
      null,
      2,
      1,
      true,
    ]);
    expect(payload.current.tables[0].caption).toBeNull();
    const encoded = JSON.stringify(payload);
    for (const hidden of [
      'third-long-candidate-id',
      '/chapters/',
      '#/texts/',
      'inputSha256',
      'registrySha256',
      'charStart',
      'sourceRefs',
      'resourceKey',
      'groupId',
    ])
      expect(encoded).not.toContain(hidden);
    expect(createContentAttachmentInput(p, p.units[1])).toEqual({
      payload,
      codeMap,
    });
    expect(p).toEqual(before);
    expect(() =>
      createContentAttachmentInput(p, { ...p.units[1], unitId: 'outside' }),
    ).toThrow('Unknown');
    const f = fixture();
    f.doc.tables[0].caption = { fullText: '表の原文' };
    const index = buildDocumentResourceIndex(f.doc);
    const split = await prepareContentAttachment(
      index,
      f.dp,
      f.discovery,
      f.groups,
      { ...f.options, maxUnitChars: 1 },
    );
    const headerUnit = split.units.find(
      (u) => u.sources[0].resource.kind === 'tableCell',
    )!;
    const header = createContentAttachmentInput(split, headerUnit).payload;
    expect(header.current.tables[0].caption).toBe('表の原文');
    expect(header.current.tables[0].grid[1][0]).toEqual([
      null,
      '7',
      1,
      1,
      false,
    ]);
  });
});
