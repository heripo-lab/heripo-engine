import type { ContentAttachmentSelectionAudit } from './types';

import { describe, expect, test } from 'vitest';

import { assembleContentAttachment } from './assembly';
import { attachContentUnit } from './attach-unit';
import { createContentAttachmentDecisionInput } from './decisions';
import { createContentAttachmentSelectionInput } from './excerpts';
import { audit, empty, fixture, s6 } from './excerpts.test-fixture';
import { createContentAttachmentRequest } from './request';

describe('immutable content excerpt selection', () => {
  test('freezes four S6 sentences with decimals and an unclosed parenthesis, then resolves confirmed and uncertain IDs to unchanged original ranges', () => {
    const plan = fixture(),
      unit = plan.units[0];
    const input = createContentAttachmentSelectionInput(plan, unit);
    expect(input.payload.current.excerpts.map((row) => row[4])).toEqual(s6);
    expect(input.codeMap.excerpts.map((e) => e.evidence[0])).toMatchObject([
      { charStart: 0, charEnd: 42 },
      { charStart: 43, charEnd: 108 },
      { charStart: 109, charEnd: 160 },
      { charStart: 161, charEnd: 210 },
    ]);
    expect(input.payload.candidates).toHaveLength(5);
    expect(JSON.stringify(input.payload)).not.toContain('charStart');
    expect(input.codeMap.segmentation).toMatchObject({
      version: 'sentence-excerpts.v1',
      locale: 'en',
      icu: expect.any(String),
    });
    const raw = audit(plan, {
      assignments: s6.map((_, i) => ({
        excerptRef: `E${i + 1}`,
        candidateRefs: i === 2 ? ['R1', 'R2'] : ['R1'],
        reason: '原文に明示',
      })),
      unresolved: [
        {
          excerptRef: 'E3',
          candidateRefs: ['R3', 'R4'],
          reason: '表土の同一性は未確定',
        },
      ],
      ignored: [],
    });
    const before = structuredClone([plan, raw]);
    const result = assembleContentAttachment(plan, [raw]);
    expect(result.issues).toEqual([]);
    expect(result.completedUnitIds).toEqual(['page-122']);
    expect(result.contents[0].excerpts.map((e) => e.fragments)).toEqual(
      s6.map((s) => [s]),
    );
    expect(result.unresolved[0].evidence).toEqual(
      result.contents[1].excerpts[0].occurrences[0].evidence,
    );
    expect(result.unresolved[0].evidence[0]).toMatchObject({
      resourceId: 'txt-0',
      sourceRefs: ['#/texts/0'],
      logicalPageRange: { startPageNo: -1, endPageNo: -1 },
      quote: s6[2],
    });
    expect([plan, raw]).toEqual(before);
    expect(raw.promptVersion).toBe('content-attachment.v41');
    expect(raw.systemPrompt).toContain('Never return quotes');
    for (const version of [
      'content-attachment.v9',
      'content-attachment.v10',
      'content-attachment.v11',
      'content-attachment.v12',
      'content-attachment.v13',
      'content-attachment.v14',
      'content-attachment.v15',
      'content-attachment.v16',
      'content-attachment.v17',
      'content-attachment.v18',
      'content-attachment.v19',
      'content-attachment.v20',
      'content-attachment.v21',
      'content-attachment.v22',
      'content-attachment.v23',
      'content-attachment.v24',
    ] as const) {
      const historical = {
        ...raw,
        ...createContentAttachmentRequest(plan, unit, version),
        codeMap:
          version === 'content-attachment.v13' ||
          version === 'content-attachment.v14' ||
          version === 'content-attachment.v15' ||
          version === 'content-attachment.v16' ||
          version === 'content-attachment.v17' ||
          version === 'content-attachment.v18' ||
          version === 'content-attachment.v19' ||
          version === 'content-attachment.v20' ||
          version === 'content-attachment.v21' ||
          version === 'content-attachment.v22' ||
          version === 'content-attachment.v23' ||
          version === 'content-attachment.v24'
            ? createContentAttachmentDecisionInput(plan, unit).codeMap
            : createContentAttachmentSelectionInput(plan, unit).codeMap,
      };
      expect(historical.userPrompt).toBe(
        version === 'content-attachment.v13' ||
          version === 'content-attachment.v14' ||
          version === 'content-attachment.v15' ||
          version === 'content-attachment.v16' ||
          version === 'content-attachment.v17' ||
          version === 'content-attachment.v18' ||
          version === 'content-attachment.v19' ||
          version === 'content-attachment.v20' ||
          version === 'content-attachment.v21' ||
          version === 'content-attachment.v22' ||
          version === 'content-attachment.v23' ||
          version === 'content-attachment.v24'
          ? JSON.stringify(
              createContentAttachmentDecisionInput(plan, unit).payload,
            )
          : JSON.stringify(input.payload),
      );
      expect(raw.systemPrompt.startsWith(historical.systemPrompt)).toBe(true);
      expect(assembleContentAttachment(plan, [historical])).toEqual(result);
      expect(
        assembleContentAttachment(plan, [
          { ...historical, systemPrompt: raw.systemPrompt },
        ]).issues[0].reason,
      ).toContain('Audit does not match');
    }
    const forged = structuredClone(raw);
    (forged.codeMap as typeof input.codeMap).excerpts[0].evidence[0].charEnd++;
    expect(
      assembleContentAttachment(plan, [forged]).issues[0].reason,
    ).toContain('code map');
  });

  test('keeps numbered headings, balanced citations, Unicode, repeated sentences, whitespace and table-cell spans without normalizing text', () => {
    const cases: Array<[string, string[]]> = [
      ['29. Vessel (Fig. 2). Next.', ['29. Vessel (Fig. 2).', 'Next.']],
      [
        'Alpha [part. More] finished. Beta.',
        ['Alpha [part. More] finished.', 'Beta.'],
      ],
      ['A （Fig. 2）. B.', ['A （Fig. 2）.', 'B.']],
      [
        'Incomplete (ref 85. Next sentence. Last.',
        ['Incomplete (ref 85.', 'Next sentence.', 'Last.'],
      ],
      [
        ') Before. A (bad] still. End.',
        [') Before.', 'A (bad] still.', 'End.'],
      ],
      ['境界の一部。第二文。', ['境界の一部。', '第二文。']],
      ['  Same. Same.  ', ['Same.', 'Same.']],
      ['29.', ['29.']],
      ['', []],
      [' \n\t', []],
    ];
    for (const [text, expected] of cases) {
      const plan = fixture([text]);
      const input = createContentAttachmentSelectionInput(plan, plan.units[0]);
      expect(
        input.payload.current.excerpts.map((row) => row[4]),
        text,
      ).toEqual(expected);
      const raw = audit(plan, {
        ...empty(),
        assignments: input.codeMap.excerpts.map((e) => ({
          excerptRef: e.ref,
          candidateRefs: ['R1'],
          reason: '原文',
        })),
      });
      const result = assembleContentAttachment(plan, [raw]);
      expect(result.issues, text).toEqual([]);
      if (text.includes('Same.'))
        expect(result.contents[0].excerpts[0].occurrences).toHaveLength(2);
    }
    const plan = fixture(['Text.', '  '], true);
    const input = createContentAttachmentSelectionInput(plan, plan.units[0]);
    expect(
      input.payload.current.excerpts
        .filter((row) => row[1] === 'tableCell')
        .map((row) => row[4]),
    ).toEqual(['番号', '寸法', ' 7 ', '20']);
    expect(input.payload.current.tables[0].grid[0][0]).toEqual([
      'E2',
      null,
      2,
      1,
      true,
    ]);
    expect(input.payload.current.tables[0].grid[1][1]).toEqual([
      null,
      '',
      1,
      1,
      false,
    ]);
    const raw = audit(plan, {
      ...empty(),
      ignored: input.codeMap.excerpts.map((e) => ({
        excerptRef: e.ref,
        reason: '対象外',
      })),
    });
    expect(assembleContentAttachment(plan, [raw]).issues).toEqual([]);
    const cell = plan.units[0].sources.find(
      (s) => s.resource.kind === 'tableCell',
    )!;
    const partial = structuredClone(plan);
    partial.units[0].sources = [structuredClone(cell)];
    expect(
      createContentAttachmentSelectionInput(partial, partial.units[0]).payload
        .current.tables[0].grid[1][0],
    ).toEqual([null, ' 7 ', 1, 1, false]);
  });

  test('rejects missing, unknown or repeated IDs, invented quotes, invalid targets and conflicting exclusions without repairing responses', async () => {
    const plan = fixture(['First. Second.']);
    const base = audit(plan, {
      ...empty(),
      assignments: [
        { excerptRef: 'E1', candidateRefs: ['R1'], reason: '原文' },
        { excerptRef: 'E2', candidateRefs: ['R1'], reason: '原文' },
      ],
    });
    const variants: Array<(a: ContentAttachmentSelectionAudit) => void> = [
      (a) => {
        a.response.assignments.pop();
      },
      (a) => {
        a.response.assignments[0].excerptRef = 'E999';
      },
      (a) => {
        a.response.assignments.push(a.response.assignments[0]);
      },
      (a) => {
        a.response.assignments[0].candidateRefs = ['R999'];
      },
      (a) => {
        a.response.assignments[0].candidateRefs = ['R1', 'R1'];
      },
      (a) => {
        a.response.ignored.push({ excerptRef: 'E1', reason: '除外' });
      },
      (a) => {
        Object.assign(a.response.assignments[0], { quote: 'Invented text.' });
      },
      (a) => {
        delete a.codeMap;
      },
    ];
    for (const change of variants) {
      const raw = structuredClone(base);
      change(raw);
      const before = structuredClone(raw);
      const result = assembleContentAttachment(plan, [raw]);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.completedUnitIds).toEqual([]);
      expect(raw).toEqual(before);
    }
    const ignored = audit(plan, {
      ...empty(),
      ignored: [{ excerptRef: 'E999', reason: '除外' }],
    });
    expect(
      assembleContentAttachment(plan, [ignored]).issues.length,
    ).toBeGreaterThan(0);
    const unresolved = audit(plan, {
      ...empty(),
      unresolved: [
        { excerptRef: 'E1', candidateRefs: [], reason: '候補不足' },
        {
          excerptRef: 'E2',
          candidateRefs: ['R3', 'R4'],
          reason: '同一性未確定',
        },
      ],
    });
    expect(assembleContentAttachment(plan, [unresolved]).issues).toEqual([]);
    const blank = fixture(['  ']);
    await expect(
      attachContentUnit(blank, blank.units[0], {
        model: {} as never,
        maxRetries: 0,
      }),
    ).rejects.toThrow('No selectable');
  });
});
