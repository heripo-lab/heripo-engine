import type * as Shared from '@heripo/shared';

import type {
  ContentAttachmentAudit,
  ContentAttachmentResponse,
} from './types';

import { describe, expect, test, vi } from 'vitest';

import { assembleContentAttachment } from './assembly';
import { empty, prepare, usage } from './content-attachment.test-fixture';
import { createContentAttachmentInput } from './input';
import { createContentAttachmentRequest } from './request';

vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  LLMCaller: { call: vi.fn() },
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

describe('bounded content attachment', () => {
  test('keeps sentence decisions separate, shares only the explicit context sentence and replays historical compact audits', async () => {
    const p = await prepare();
    const unit = p.units[2];
    unit.sources[0].resource.data.text =
      '壺は埋土から出土した。口縁は外反する。';
    const response: ContentAttachmentResponse = {
      assignments: [
        {
          candidateRefs: ['R1', 'R2'],
          fragments: [{ sourceId: 'S1', quote: '壺は埋土から出土した。' }],
          reason: '出土文脈を共有',
        },
        {
          candidateRefs: ['R1'],
          fragments: [{ sourceId: 'S1', quote: '口縁は外反する。' }],
          reason: '形態のみ',
        },
      ],
      unresolved: [],
      ignoredPassages: [],
      ignoredSources: unit.sources
        .slice(1)
        .map((_, i) => ({ sourceId: `S${i + 2}`, reason: '対象外' })),
    };
    const raw: ContentAttachmentAudit = {
      unitId: unit.unitId,
      ...createContentAttachmentRequest(p, unit, 'content-attachment.v8'),
      response,
      usage,
      codeMap: createContentAttachmentInput(p, unit).codeMap,
    };
    const before = structuredClone(raw);
    const result = assembleContentAttachment(p, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.contents[0].excerpts.map((e) => e.fragments)).toEqual([
      ['壺は埋土から出土した。'],
      ['口縁は外反する。'],
    ]);
    expect(result.contents[1].excerpts.map((e) => e.fragments)).toEqual([
      ['壺は埋土から出土した。'],
    ]);
    expect(
      result.contents[0].excerpts[1].occurrences[0].evidence[0].charStart,
    ).toBe('壺は埋土から出土した。'.length);
    expect(raw).toEqual(before);
    const current = createContentAttachmentRequest(
      p,
      unit,
      'content-attachment.v8',
    );
    const historical = createContentAttachmentRequest(
      p,
      unit,
      'content-attachment.v2',
    );
    expect(current.promptVersion).toBe('content-attachment.v8');
    expect(current.systemPrompt).toContain('exactly ONE original sentence');
    expect(current.systemPrompt).toContain(
      'include ALL those candidateRefs in the SAME item',
    );
    expect(current.userPrompt).toBe(historical.userPrompt);
    expect(current.systemPrompt).not.toBe(historical.systemPrompt);
    const v3 = createContentAttachmentRequest(p, unit, 'content-attachment.v3');
    expect(current.userPrompt).toBe(v3.userPrompt);
    expect(v3.systemPrompt).not.toContain('SOURCE CONTAINERS VS EXCERPT UNITS');
    expect(current.systemPrompt).toContain(
      'SOURCE CONTAINERS VS EXCERPT UNITS',
    );
    expect(assembleContentAttachment(p, [{ ...raw, ...v3 }])).toEqual(result);
    const v2 = { ...raw, ...historical };
    expect(assembleContentAttachment(p, [v2])).toEqual(result);
    expect(
      assembleContentAttachment(p, [
        { ...raw, promptVersion: 'content-attachment.v2' },
      ]).issues[0].reason,
    ).toContain('Audit does not match');
  });

  test('retains a leading boundary fragment and two following sentence decisions under the same source without merging or restoring them', async () => {
    const p = await prepare();
    const unit = p.units[2];
    const quotes = [
      'その一部である。',
      '壁は石組みである。',
      '内面は円形である。',
    ];
    const original = quotes.join('');
    unit.sources[0].resource.data.text = original;
    const response: ContentAttachmentResponse = {
      assignments: quotes.map((quote) => ({
        candidateRefs: ['R1'],
        fragments: [{ sourceId: 'S1', quote }],
        reason: '原文の一部',
      })),
      unresolved: [],
      ignoredPassages: [],
      ignoredSources: unit.sources
        .slice(1)
        .map((_, i) => ({ sourceId: `S${i + 2}`, reason: '対象外' })),
    };
    const raw: ContentAttachmentAudit = {
      unitId: unit.unitId,
      ...createContentAttachmentRequest(p, unit, 'content-attachment.v8'),
      response,
      usage,
      codeMap: createContentAttachmentInput(p, unit).codeMap,
    };
    const before = structuredClone(raw);
    const result = assembleContentAttachment(p, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.contents[0].excerpts.map((e) => e.fragments)).toEqual(
      quotes.map((q) => [q]),
    );
    expect(
      result.contents[0].excerpts.map(
        (e) => e.occurrences[0].evidence[0].charStart,
      ),
    ).toEqual([0, quotes[0].length, quotes[0].length + quotes[1].length]);
    expect(
      result.contents[0].excerpts.every(
        (e) =>
          e.occurrences[0].evidence[0].sourceId === unit.sources[0].sourceId,
      ),
    ).toBe(true);
    expect(unit.sources[0].resource.data.text).toBe(original);
    expect(raw).toEqual(before);
    expect(raw.systemPrompt).toContain(
      'put ONLY its leading incomplete sentence fragment',
    );
    expect(raw.systemPrompt).toContain(
      'every following complete sentence MUST be a separate item',
    );
    expect(raw.systemPrompt).not.toContain(
      'Return each original source block fragment separately in fragments',
    );
  });

  test('preserves a registered object heading verbatim while ignoring a generic category and retains historical v4 replay', async () => {
    const p = await prepare(),
      unit = p.units[0];
    const heading = '7. 土器 (図2、写真3)';
    unit.sources[0].resource.data.text = heading;
    const category = structuredClone(unit.sources[0]);
    category.sourceId = 'path:/category';
    category.resource.key = '/category';
    category.resource.resourceId = 'category';
    category.resource.data.text = '遺物';
    unit.sources.push(category);
    const response: ContentAttachmentResponse = {
      assignments: [
        {
          candidateRefs: ['R1'],
          fragments: [{ sourceId: 'S1', quote: heading }],
          reason: '登録済み対象の番号と名称',
        },
      ],
      unresolved: [],
      ignoredPassages: [],
      ignoredSources: [{ sourceId: 'S2', reason: '分類見出し' }],
    };
    const raw: ContentAttachmentAudit = {
      unitId: unit.unitId,
      ...createContentAttachmentRequest(p, unit, 'content-attachment.v8'),
      response,
      usage,
      codeMap: createContentAttachmentInput(p, unit).codeMap,
    };
    const before = structuredClone(raw);
    const result = assembleContentAttachment(p, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.contents[0].excerpts[0].fragments).toEqual([heading]);
    expect(result.ignoredSources[0].sourceId).toBe(category.sourceId);
    expect(result.contents).toHaveLength(1);
    expect(raw).toEqual(before);
    const v4 = createContentAttachmentRequest(p, unit, 'content-attachment.v4');
    expect(v4.userPrompt).toBe(raw.userPrompt);
    expect(v4.systemPrompt).toContain(
      'A title, contents entry or generic category alone',
    );
    expect(raw.systemPrompt).not.toContain(
      'A title, contents entry or generic category alone',
    );
    expect(raw.systemPrompt).toContain('HEADING ELIGIBILITY');
    expect(raw.systemPrompt).toContain('assign the ENTIRE unchanged heading');
    expect(raw.systemPrompt).toContain('ALREADY REGISTERED');
    expect(assembleContentAttachment(p, [{ ...raw, ...v4 }])).toEqual(result);
  });

  test('reports an omitted middle sentence and exact uncovered ranges without altering raw decisions or historical v5 replay', async () => {
    const p = await prepare(),
      unit = p.units[0];
    unit.sources[0].resource.data.text = '形態。 方向を推定する。 規模。';
    const response: ContentAttachmentResponse = {
      ...empty(),
      assignments: ['形態。', '規模。'].map((quote) => ({
        candidateRefs: ['R1'],
        fragments: [{ sourceId: 'S1', quote }],
        reason: '原文',
      })),
    };
    const raw: ContentAttachmentAudit = {
      unitId: unit.unitId,
      ...createContentAttachmentRequest(p, unit, 'content-attachment.v8'),
      response,
      usage,
      codeMap: createContentAttachmentInput(p, unit).codeMap,
    };
    const before = structuredClone([p, raw]);
    const result = assembleContentAttachment(p, [raw]);
    expect(result.issues).toEqual([
      {
        unitId: unit.unitId,
        reason:
          'Unaccounted text: path:/chapters/0/textBlocks/0 [3, 13) " 方向を推定する。 "',
      },
    ]);
    expect(result.completedUnitIds).toEqual([]);
    expect(result.contents[0].excerpts.map((e) => e.fragments)).toEqual([
      ['形態。'],
      ['規模。'],
    ]);
    expect([p, raw]).toEqual(before);
    const historical = {
      ...structuredClone(raw),
      ...createContentAttachmentRequest(p, unit, 'content-attachment.v5'),
    };
    delete historical.response.ignoredPassages;
    expect(assembleContentAttachment(p, [historical]).issues).toEqual([]);
    expect(historical.systemPrompt).not.toContain(
      'EXHAUSTIVE PASSAGE ACCOUNTING',
    );
    expect(raw.systemPrompt).toContain(
      'including direction, orientation, uncertainty and interpretation',
    );
    expect(raw.systemPrompt).toContain('founded on or constructed on');
    expect(raw.systemPrompt).toContain('a layer number need not occur');
    expect(raw.userPrompt).toBe(historical.userPrompt);
  });

  test('accounts for shared foundations, unresolved identity, partial exclusions and whitespace while retaining exact evidence', async () => {
    const p = await prepare(),
      unit = p.units[0];
    unit.sources[0].resource.data.text =
      '井戸は岩盤に築く。\n\t対象不明。 比較対象。\n';
    const response: ContentAttachmentResponse = {
      assignments: [
        {
          candidateRefs: ['R1', 'R2'],
          fragments: [{ sourceId: 'S1', quote: '井戸は岩盤に築く。' }],
          reason: '造営基盤を共有',
        },
      ],
      unresolved: [
        {
          candidateRefs: [],
          fragments: [{ sourceId: 'S1', quote: '対象不明。' }],
          reason: '同一性不明',
        },
      ],
      ignoredPassages: [
        {
          fragments: [{ sourceId: 'S1', quote: '比較対象。' }],
          reason: '比較例',
        },
      ],
      ignoredSources: [],
    };
    const raw: ContentAttachmentAudit = {
      unitId: unit.unitId,
      ...createContentAttachmentRequest(p, unit, 'content-attachment.v8'),
      response,
      usage,
      codeMap: createContentAttachmentInput(p, unit).codeMap,
    };
    const before = structuredClone([p, raw]);
    const result = assembleContentAttachment(p, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.completedUnitIds).toEqual([unit.unitId]);
    expect(result.contents.map((c) => c.excerpts[0].fragments)).toEqual([
      ['井戸は岩盤に築く。'],
      ['井戸は岩盤に築く。'],
    ]);
    expect(result.ignoredPassages[0]).toMatchObject({
      unitId: unit.unitId,
      reason: '比較例',
      evidence: [
        { quote: '比較対象。', charStart: 17, charEnd: 22, pdfPageNo: 2 },
      ],
    });
    expect(result.reviewStatus).toBe('not_reviewed');
    expect([p, raw]).toEqual(before);
    const overlap = structuredClone(raw);
    overlap.response.ignoredPassages![0].fragments[0].quote = '対象不明。';
    expect(
      assembleContentAttachment(p, [overlap]).issues.some((i) =>
        i.reason.includes('overlaps'),
      ),
    ).toBe(true);
    const invalid = structuredClone(raw);
    invalid.response.ignoredPassages![0].fragments[0].quote = '修正文';
    expect(
      assembleContentAttachment(p, [invalid]).issues.some((i) =>
        i.reason.includes('Ignored passage does not match'),
      ),
    ).toBe(true);
    const conflict = structuredClone(raw);
    conflict.response.ignoredSources.push({
      sourceId: 'S1',
      reason: '全体除外',
    });
    expect(
      assembleContentAttachment(p, [conflict]).issues.some((i) =>
        i.reason.includes('also used'),
      ),
    ).toBe(true);
    const repeated = structuredClone(raw);
    repeated.response.ignoredPassages!.push(
      repeated.response.ignoredPassages![0],
    );
    expect(
      assembleContentAttachment(p, [repeated]).issues.some((i) =>
        i.reason.includes('overlaps'),
      ),
    ).toBe(true);
  });

  test('detects uncovered leading and trailing text, table-cell substrings and punctuation without sentence guessing', async () => {
    const p = await prepare(),
      unit = p.units[0];
    unit.sources[0].resource.data.text = '前。中央。後。';
    const raw: ContentAttachmentAudit = {
      unitId: unit.unitId,
      ...createContentAttachmentRequest(p, unit, 'content-attachment.v8'),
      response: {
        ...empty(),
        assignments: [
          {
            candidateRefs: ['R1'],
            fragments: [{ sourceId: 'S1', quote: '中央' }],
            reason: '原文',
          },
        ],
      },
      usage,
      codeMap: createContentAttachmentInput(p, unit).codeMap,
    };
    expect(
      assembleContentAttachment(p, [raw]).issues.map((i) => i.reason),
    ).toEqual([
      'Unaccounted text: path:/chapters/0/textBlocks/0 [0, 2) "前。"',
      'Unaccounted text: path:/chapters/0/textBlocks/0 [4, 7) "。後。"',
    ]);
    const tableUnit = p.units[1];
    const cellIndex = tableUnit.sources.findIndex(
      (s) => s.resource.kind === 'tableCell' && s.resource.data.text === '20',
    );
    const cellRef = `S${cellIndex + 1}`;
    const tableAudit: ContentAttachmentAudit = {
      unitId: tableUnit.unitId,
      ...createContentAttachmentRequest(p, tableUnit, 'content-attachment.v8'),
      response: {
        ...empty(),
        assignments: [
          {
            candidateRefs: ['R1'],
            fragments: [{ sourceId: cellRef, quote: '2' }],
            reason: '原文',
          },
        ],
        ignoredSources: tableUnit.sources.flatMap((_, i) =>
          i === cellIndex ? [] : [{ sourceId: `S${i + 1}`, reason: '対象外' }],
        ),
      },
      usage,
      codeMap: createContentAttachmentInput(p, tableUnit).codeMap,
    };
    expect(
      assembleContentAttachment(p, [tableAudit]).issues[0].reason,
    ).toContain('[1, 2) "0"');
    const missingField = structuredClone(raw);
    delete missingField.response.ignoredPassages;
    expect(assembleContentAttachment(p, [missingField]).issues[0].reason).toBe(
      'Invalid attachment response schema',
    );
  });

  test('retains confirmed sentence assignments alongside ambiguous layer alternatives and preserves strict v6 replay', async () => {
    const p = await prepare(),
      unit = p.units[0];
    const direction = 'The structure faces east.';
    const removal =
      'Topsoil and the modern deposit were removed to reveal the structure.';
    const foundation = 'The structure was founded on weathered bedrock.';
    unit.sources[0].resource.data.text = [direction, removal, foundation].join(
      ' ',
    );
    const template = p.registry[0];
    p.registry = [
      'Structure',
      'Topsoil',
      'Topsoil',
      'Modern deposit',
      'Natural ground',
    ].map((name, i) => ({
      ...structuredClone(template),
      ref: `R${i + 1}`,
      groupId: `g${i + 1}`,
      recordKind: i === 0 ? 'feature' : 'layer',
      mentions: [
        {
          ...structuredClone(template.mentions[0]),
          candidateId: `candidate-${i}`,
          sourceName: name,
        },
      ],
    }));
    const response: ContentAttachmentResponse = {
      assignments: [
        {
          candidateRefs: ['R1'],
          fragments: [{ sourceId: 'S1', quote: direction }],
          reason: 'Direction',
        },
        {
          candidateRefs: ['R1', 'R4'],
          fragments: [{ sourceId: 'S1', quote: removal }],
          reason: 'Confirmed feature and deposit',
        },
        {
          candidateRefs: ['R1', 'R5'],
          fragments: [{ sourceId: 'S1', quote: foundation }],
          reason: 'Identified construction foundation',
        },
      ],
      unresolved: [
        {
          candidateRefs: ['R2', 'R3'],
          fragments: [{ sourceId: 'S1', quote: removal }],
          reason: 'Topsoil name alone cannot distinguish the existing layers',
        },
      ],
      ignoredPassages: [],
      ignoredSources: [],
    };
    const raw: ContentAttachmentAudit = {
      unitId: unit.unitId,
      ...createContentAttachmentRequest(p, unit, 'content-attachment.v8'),
      response,
      usage,
      codeMap: createContentAttachmentInput(p, unit).codeMap,
    };
    const before = structuredClone([p, raw]);
    const result = assembleContentAttachment(p, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.completedUnitIds).toEqual([unit.unitId]);
    expect(result.contents.map((c) => c.registryRef)).toEqual([
      'R1',
      'R4',
      'R5',
    ]);
    expect(result.contents[0].excerpts.map((e) => e.fragments)).toEqual([
      [direction],
      [removal],
      [foundation],
    ]);
    expect(result.unresolved[0].candidateRefs).toEqual(['R2', 'R3']);
    expect(result.unresolved[0].evidence).toEqual(
      result.contents[1].excerpts[0].occurrences[0].evidence,
    );
    expect([p, raw]).toEqual(before);
    const v6 = createContentAttachmentRequest(p, unit, 'content-attachment.v6');
    expect(raw.systemPrompt.startsWith(v6.systemPrompt + '\n')).toBe(true);
    expect(raw.systemPrompt).toContain('plausible alternative layer refs');
    expect(raw.systemPrompt).toContain('ambiguous layer alternatives ONLY');
    expect(raw.userPrompt).toBe(v6.userPrompt);
    expect(assembleContentAttachment(p, [{ ...raw, ...v6 }])).toEqual(result);
    const incomplete = structuredClone(raw);
    incomplete.response.assignments.shift();
    const currentIssues = assembleContentAttachment(p, [incomplete]).issues;
    expect(currentIssues[0].reason).toContain('Unaccounted text:');
    expect(
      assembleContentAttachment(p, [{ ...incomplete, ...v6 }]).issues,
    ).toEqual(currentIssues);
  });

  test('preserves owner words without expanding model-selected targets and retains direct sharing and strict v7 replay', async () => {
    const p = await prepare(),
      unit = p.units[0];
    const quotes = [
      'Feature A upper fill yielded sherds.',
      'Jar X was recovered from Feature A upper fill.',
      'Jar X was recovered from Feature A.',
      'Feature A was cut into Layer B.',
    ];
    unit.sources[0].resource.data.text = quotes.join(' ');
    const template = p.registry[0];
    p.registry = ['Feature A', 'Feature A upper fill', 'Jar X', 'Layer B'].map(
      (name, i) => ({
        ...structuredClone(template),
        ref: `R${i + 1}`,
        groupId: `g${i + 1}`,
        recordKind: i === 0 ? 'feature' : i === 2 ? 'artifact' : 'layer',
        mentions: [
          {
            ...structuredClone(template.mentions[0]),
            candidateId: `candidate-${i}`,
            sourceName: name,
          },
        ],
      }),
    );
    const refs = [['R2'], ['R3', 'R2'], ['R3', 'R1'], ['R1', 'R4']];
    const raw: ContentAttachmentAudit = {
      unitId: unit.unitId,
      ...createContentAttachmentRequest(p, unit, 'content-attachment.v8'),
      usage,
      codeMap: createContentAttachmentInput(p, unit).codeMap,
      response: {
        ...empty(),
        assignments: quotes.map((quote, i) => ({
          candidateRefs: refs[i],
          fragments: [{ sourceId: 'S1', quote }],
          reason: 'Directly described targets',
        })),
      },
    };
    const before = structuredClone([p, raw]);
    const result = assembleContentAttachment(p, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.completedUnitIds).toEqual([unit.unitId]);
    expect(
      result.contents
        .find((c) => c.registryRef === 'R1')!
        .excerpts.map((e) => e.fragments),
    ).toEqual([[quotes[2]], [quotes[3]]]);
    expect(
      result.contents
        .find((c) => c.registryRef === 'R2')!
        .excerpts.map((e) => e.fragments),
    ).toEqual([[quotes[0]], [quotes[1]]]);
    expect(
      result.contents
        .find((c) => c.registryRef === 'R3')!
        .excerpts.map((e) => e.fragments),
    ).toEqual([[quotes[1]], [quotes[2]]]);
    expect(
      result.contents.find((c) => c.registryRef === 'R4')!.excerpts[0]
        .fragments,
    ).toEqual([quotes[3]]);
    expect([p, raw]).toEqual(before);
    const v7 = createContentAttachmentRequest(p, unit, 'content-attachment.v7');
    expect(raw.systemPrompt.startsWith(v7.systemPrompt + '\n')).toBe(true);
    expect(v7.systemPrompt).not.toContain(
      'NESTED OWNER NAMES DO NOT PROPAGATE EXCERPTS',
    );
    expect(raw.systemPrompt).toContain('Preserve the full original sentence');
    expect(raw.systemPrompt).toContain(
      'without guessing individual artifacts or adding the owner feature',
    );
    expect(raw.userPrompt).toBe(v7.userPrompt);
    expect(assembleContentAttachment(p, [{ ...raw, ...v7 }])).toEqual(result);
    const missingSentence = structuredClone(raw);
    missingSentence.response.assignments.shift();
    const currentIssues = assembleContentAttachment(p, [
      missingSentence,
    ]).issues;
    expect(currentIssues[0].reason).toContain('Unaccounted text:');
    expect(
      assembleContentAttachment(p, [{ ...missingSentence, ...v7 }]).issues,
    ).toEqual(currentIssues);
    const missingField = structuredClone(raw);
    delete missingField.response.ignoredPassages;
    expect(
      assembleContentAttachment(p, [{ ...missingField, ...v7 }]).issues[0]
        .reason,
    ).toBe('Invalid attachment response schema');
  });
});
