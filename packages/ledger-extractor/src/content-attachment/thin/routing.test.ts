import type {
  AttachmentRegistryEntry,
  AttachmentUnit,
  ContentAttachmentPlan,
} from '../types';
import type { ContentAttachmentThinCompilation } from './compile-types';
import type {
  ContentAttachmentThinDecision,
  ContentAttachmentThinInspection,
} from './inspection';

import { describe, expect, test } from 'vitest';

import {
  CONTENT_ATTACHMENT_THIN_LARGE_COLLECTIVE_LIMIT,
  CONTENT_ATTACHMENT_THIN_LARGE_HANDLE_LIMIT,
  checkContentAttachmentThinOutliers,
  routeContentAttachmentThinSegments,
} from './routing';

const none = (segment: string): ContentAttachmentThinDecision => ({
  segment,
  kind: 'none',
  recipients: [],
  handles: [],
  excluded: [],
  recipientIdentityAlternatives: [],
  relationshipSubjectAlternatives: [],
  evidence: [],
});
const attach = (
  segment: string,
  recipients: string[],
  ia: string[][] = [],
  sa: string[][] = [],
): ContentAttachmentThinDecision => ({
  ...none(segment),
  kind: 'attach',
  recipients,
  recipientIdentityAlternatives: ia,
  relationshipSubjectAlternatives: sa,
});
const run = (
  ...decisions: ContentAttachmentThinDecision[]
): ContentAttachmentThinInspection => ({ issues: [], findings: [], decisions });

const entry = (
  ref: string,
  recordKind: AttachmentRegistryEntry['recordKind'],
  sourceName: string,
  sourceIdentifier: string | null = null,
): AttachmentRegistryEntry => ({
  ref,
  groupId: `g-${ref}`,
  recordKind,
  mentions: [
    {
      candidateId: `c-${ref}`,
      sourceName,
      sourceIdentifier,
      chapterPath: [],
      evidence: [],
    },
  ],
});
const texts = [
  '수혈 1호를 조사하였다.',
  '우물 상부 폐기층에서 출토된 편이다.',
  'Ⅳ층군 아래',
  '표토',
];
function fixture() {
  const sources = texts.map((text, i) => ({
    sourceId: `s${i}`,
    resource: {
      key: `/chapters/0/textBlocks/${i}`,
      resourceId: null,
      sourceRefs: [],
      chapterIds: [],
      pdfPageNo: 1,
      logicalPageRange: null,
      kind: 'text' as const,
      data: { id: `b${i}`, text, pdfPageNo: 1 },
    },
  }));
  const unit = {
    unitId: 'page-1',
    pdfPageNo: 1,
    sources,
    chapters: [],
    tables: [],
    readOnlyContext: [],
  } as unknown as AttachmentUnit;
  const plan = {
    units: [unit],
    registry: [
      entry('R1', 'area', '사업범위'),
      entry('R2', 'feature', '수혈', '1호'),
      entry('R3', 'feature', '수혈', '2호'),
      entry('R4', 'layer', '우물 상부 폐기층'),
      entry('R5', 'layer', '자연 퇴적층', 'Ⅳ층군'),
      entry('R6', 'layer', '표토'),
    ],
  } as unknown as ContentAttachmentPlan;
  const segments = ['E1:S1', 'E2:S1', 'E3:S1', 'E4:S1'];
  const compilation = {
    codeMap: {
      segments,
      segSpans: segments.map((seg, i) => ({
        seg,
        key: `/chapters/0/textBlocks/${i}`,
        charStart: 0,
        charEnd: texts[i].length,
        llm: true,
      })),
      handles: [],
    },
  } as unknown as ContentAttachmentThinCompilation;
  return { plan, unit, compilation, segments };
}

describe('checkContentAttachmentThinOutliers', () => {
  test('flags a run that alone differs on more than a quarter and at least three segments', () => {
    const segments = ['S1', 'S2', 'S3', 'S4', 'S5'];
    const agreed = run(...segments.map((s) => attach(s, ['R2'])));
    const lone = run(
      none('S1'),
      attach('S2', ['R2', 'R3']),
      attach('S3', ['R2'], [['R3', 'R2']]),
      attach('S4', ['R2']),
      attach('S5', ['R2']),
    );

    const result = checkContentAttachmentThinOutliers(segments, [
      agreed,
      lone,
      agreed,
    ]);

    expect(result.rates).toEqual([
      { rate: 0, count: 0 },
      { rate: 0.6, count: 3 },
      { rate: 0, count: 0 },
    ]);
    expect(result.flagged).toEqual([1]);
  });

  test('does not flag a high share on fewer than three segments or a missing decision alone', () => {
    const segments = ['S1', 'S2'];
    const result = checkContentAttachmentThinOutliers(segments, [
      run(attach('S1', ['R2']), attach('S2', ['R2'])),
      run(none('S1'), none('S2')),
      run(attach('S1', ['R2']), attach('S2', ['R2'])),
    ]);

    expect(result.rates[1]).toEqual({ rate: 1, count: 2 });
    expect(result.flagged).toEqual([]);
    expect(
      checkContentAttachmentThinOutliers([], [run(), run(), run()]).rates,
    ).toEqual([
      { rate: 0, count: 0 },
      { rate: 0, count: 0 },
      { rate: 0, count: 0 },
    ]);
  });

  test('treats an invalid decision as its own value and requires three runs', () => {
    const result = checkContentAttachmentThinOutliers(
      ['S1'],
      [run(none('S1')), run(), run(none('S1'))],
    );

    expect(result.rates[1]).toEqual({ rate: 1, count: 1 });
    expect(() =>
      checkContentAttachmentThinOutliers(['S1'], [run(), run()]),
    ).toThrow('Expected exactly three runs');
  });
});

describe('routeContentAttachmentThinSegments', () => {
  test('confirms unanimous non-area targets and keeps agreed uncertainty groups', () => {
    const { plan, unit, compilation } = fixture();
    const decisions = () => [
      attach('E1:S1', ['R2'], [['R2', 'R3']]),
      none('E2:S1'),
      attach('E3:S1', ['R5']),
      none('E4:S1'),
    ];

    const routed = routeContentAttachmentThinSegments(plan, unit, compilation, [
      run(...decisions()),
      run(...decisions()),
      run(...decisions()),
    ]);

    expect(routed[0]).toEqual({
      segment: 'E1:S1',
      status: 'auto',
      reasons: [],
      confirmed: ['R2'],
      contested: [],
      areaSuggestions: [],
      layerSuggestions: [],
      recipientIdentityAlternatives: [['R2', 'R3']],
      relationshipSubjectAlternatives: [],
    });
    expect(routed[1]).toMatchObject({
      segment: 'E2:S1',
      status: 'review',
      reasons: ['layer'],
      layerSuggestions: ['R4'],
    });
    expect(routed[2]).toMatchObject({
      status: 'auto',
      confirmed: ['R5'],
      layerSuggestions: [],
    });
    expect(routed[3]).toMatchObject({ status: 'auto', layerSuggestions: [] });
  });

  test('reviews contested targets, areas, differing groups and invalid runs', () => {
    const { plan, unit, compilation } = fixture();

    const routed = routeContentAttachmentThinSegments(plan, unit, compilation, [
      run(
        attach('E1:S1', ['R1', 'R2', 'R3']),
        attach('E2:S1', [], [], [['R2', 'R3']]),
        none('E3:S1'),
        none('E4:S1'),
      ),
      run(
        attach('E1:S1', ['R1', 'R2']),
        attach('E2:S1', ['R4']),
        none('E3:S1'),
      ),
      run(
        attach('E1:S1', ['R1', 'R2']),
        attach('E2:S1', ['R4']),
        none('E3:S1'),
        none('E4:S1'),
      ),
    ]);

    expect(routed[0]).toMatchObject({
      status: 'review',
      reasons: ['contested_targets', 'area'],
      confirmed: ['R2'],
      contested: [{ ref: 'R3', votes: 1 }],
      areaSuggestions: [{ ref: 'R1', votes: 3 }],
    });
    expect(routed[1]).toMatchObject({
      reasons: ['contested_targets', 'uncertainty_differs', 'layer'],
      contested: [{ ref: 'R4', votes: 2 }],
      layerSuggestions: ['R4'],
      relationshipSubjectAlternatives: [],
    });
    expect(routed[3]).toMatchObject({
      status: 'review',
      reasons: ['invalid_run'],
      recipientIdentityAlternatives: [],
    });
  });

  test('votes on areas like other targets under the unanimous area policy', () => {
    const { plan, unit, compilation } = fixture();
    plan.registry.push(entry('R7', 'area', '발굴범위'));
    plan.thinPolicy = { layers: 'all', areas: 'unanimous' };

    const routed = routeContentAttachmentThinSegments(plan, unit, compilation, [
      run(
        attach('E1:S1', ['R1', 'R2']),
        attach('E2:S1', ['R7']),
        none('E3:S1'),
        none('E4:S1'),
      ),
      run(
        attach('E1:S1', ['R1', 'R2']),
        none('E2:S1'),
        none('E3:S1'),
        none('E4:S1'),
      ),
      run(
        attach('E1:S1', ['R1', 'R2']),
        none('E2:S1'),
        none('E3:S1'),
        none('E4:S1'),
      ),
    ]);

    expect(routed[0]).toMatchObject({
      status: 'auto',
      reasons: [],
      confirmed: ['R1', 'R2'],
      areaSuggestions: [],
    });
    expect(routed[1]).toMatchObject({
      status: 'review',
      reasons: ['contested_targets', 'layer'],
      confirmed: [],
      contested: [{ ref: 'R7', votes: 1 }],
      areaSuggestions: [],
    });
  });

  test('reviews unanimous collective attachments above the target limit', () => {
    const { plan, unit, compilation } = fixture();
    const many = Array.from(
      { length: CONTENT_ATTACHMENT_THIN_LARGE_COLLECTIVE_LIMIT + 1 },
      (_, i) => `R${100 + i}`,
    );
    plan.registry.push(...many.map((ref) => entry(ref, 'feature', '유구')));
    const decisions = () => [
      attach('E1:S1', many),
      attach('E2:S1', many.slice(1), [], []),
      none('E3:S1'),
      none('E4:S1'),
    ];

    const routed = routeContentAttachmentThinSegments(plan, unit, compilation, [
      run(...decisions()),
      run(...decisions()),
      run(...decisions()),
    ]);

    expect(routed[0]).toMatchObject({
      status: 'review',
      reasons: ['large_collective'],
      confirmed: many,
    });
    expect(routed[1].reasons).not.toContain('large_collective');
  });

  test('reviews unanimous targets confirmed through handles above the handle limit', () => {
    const { plan, unit, compilation } = fixture();
    const big = Array.from(
      { length: CONTENT_ATTACHMENT_THIN_LARGE_HANDLE_LIMIT + 1 },
      (_, i) => `R${100 + i}`,
    );
    const small = big.slice(1);
    plan.registry.push(...big.map((ref) => entry(ref, 'artifact', '청자')));
    compilation.codeMap.handles = [
      { ref: 'H1', members: big },
      { ref: 'H2', members: small },
    ];
    const viaHandle = (segment: string, handle: string, members: string[]) => ({
      ...attach(segment, members),
      handles: [handle],
    });
    const decisions = () => [
      viaHandle('E1:S1', 'H1', big),
      viaHandle('E2:S1', 'H2', small),
      attach('E3:S1', big),
      viaHandle('E4:S1', 'H9', small),
    ];

    const routed = routeContentAttachmentThinSegments(plan, unit, compilation, [
      run(...decisions()),
      run(...decisions()),
      run(...decisions()),
    ]);

    expect(routed[0]).toMatchObject({
      status: 'review',
      reasons: ['large_handle'],
      confirmed: big,
    });
    expect(routed.slice(1).map((s) => s.reasons)).not.toContainEqual(
      expect.arrayContaining(['large_handle']),
    );
  });

  test('sends every segment to review for a whole-unit review and requires a run', () => {
    const { plan, unit, compilation, segments } = fixture();

    const routed = routeContentAttachmentThinSegments(
      plan,
      unit,
      compilation,
      [run(...segments.map(none))],
      { wholeUnitReview: true },
    );

    expect(routed.map((s) => s.reasons[0])).toEqual([
      'whole_unit',
      'whole_unit',
      'whole_unit',
      'whole_unit',
    ]);
    expect(() =>
      routeContentAttachmentThinSegments(plan, unit, compilation, []),
    ).toThrow('Expected at least one run');
  });

  test('narrows a shared layer name to the nearest local layer only under the local policy', () => {
    const { plan, unit, compilation } = fixture();
    const setText = (i: number, text: string) => {
      unit.sources[i].resource.data.text = text;
      compilation.codeMap.segSpans[i].charEnd = text.length;
    };
    setText(0, '교란층 위 수혈 1호');
    setText(3, '교란층 아래 표토');
    const layer = (ref: string, key: string | null) => {
      const e = entry(ref, 'layer', '교란층');
      if (key)
        e.mentions[0].evidence = [
          { resourceKey: key } as (typeof e.mentions)[0]['evidence'][0],
        ];
      return e;
    };
    plan.registry.push(
      layer('R10', '/chapters/0/textBlocks/1'),
      layer('R11', '/chapters/0/textBlocks/2'),
      layer('R12', '/chapters/9/textBlocks/0'),
      layer('R13', null),
    );
    const runs = () => [
      run(none('E1:S1'), none('E2:S1'), none('E3:S1'), none('E4:S1')),
    ];

    const all = routeContentAttachmentThinSegments(
      plan,
      unit,
      compilation,
      runs(),
    );
    plan.thinPolicy = { layers: 'local' };
    compilation.codeMap.candidateRefs = ['R4', 'R10', 'R11', 'R12', 'R13'];
    const local = routeContentAttachmentThinSegments(
      plan,
      unit,
      compilation,
      runs(),
    );

    expect(all[0].layerSuggestions).toEqual(['R10', 'R11', 'R12', 'R13']);
    expect(all[3].layerSuggestions).toEqual(['R10', 'R11', 'R12', 'R13']);
    expect(local[0].layerSuggestions).toEqual(['R10']);
    expect(local[3].layerSuggestions).toEqual(['R11']);
    expect(local[1].layerSuggestions).toEqual(['R4']);
    compilation.codeMap.candidateRefs = ['R10', 'R11', 'R12', 'R13'];
    expect(
      routeContentAttachmentThinSegments(plan, unit, compilation, runs())[1]
        .layerSuggestions,
    ).toEqual([]);
  });

  test("suggests a neighbouring unit's layer only to a segment in its chapter under the local policy", () => {
    const { plan, unit, compilation } = fixture();
    unit.chapters = [
      {
        chapterId: 'trial',
        path: [
          { id: 'survey', originTitle: 'IV. 조사내용' },
          { id: 'trial', originTitle: '2. 시굴조사' },
        ],
      },
    ];
    plan.units = [
      {
        ...unit,
        unitId: 'page-0',
        sources: [{ resource: { key: '/next/0' } }],
      },
      unit,
    ] as unknown as AttachmentUnit[];
    unit.sources[0].resource.data.text =
      '교란층과 역석층, 아스콘층 복토층 패각층';
    unit.sources[0].resource.chapterIds = ['trial'];
    unit.sources[2].resource.data.text = '역석층';
    unit.sources[3].resource.data.text = '역석층';
    unit.sources[3].resource.chapterIds = ['unlisted'];
    compilation.codeMap.segSpans[0].charEnd = 22;
    compilation.codeMap.segSpans[2].charEnd = 3;
    compilation.codeMap.segSpans[3].charEnd = 3;
    const layer = (
      ref: string,
      name: string,
      chapterId: string,
      key: string | null = '/next/0',
    ) => {
      const e = entry(ref, 'layer', name);
      e.mentions[0].chapterPath = [{ id: chapterId, originTitle: chapterId }];
      if (key)
        e.mentions[0].evidence = [
          { resourceKey: key } as (typeof e.mentions)[0]['evidence'][0],
        ];
      return e;
    };
    plan.registry.push(
      layer('R20', '교란층', 'trial'),
      layer('R21', '역석층', 'excavation'),
      layer('R22', '아스콘층', 'survey'),
      layer('R23', '복토층', 'excavation', null),
      layer('R24', '패각층', 'excavation', '/chapters/0/textBlocks/0'),
    );
    plan.thinPolicy = { layers: 'local' };
    compilation.codeMap.candidateRefs = ['R20', 'R21', 'R22', 'R23', 'R24'];

    const routed = routeContentAttachmentThinSegments(plan, unit, compilation, [
      run(none('E1:S1'), none('E2:S1'), none('E3:S1'), none('E4:S1')),
    ]);

    expect(routed[0].layerSuggestions).toEqual(['R20', 'R22', 'R23', 'R24']);
    expect(routed[2].layerSuggestions).toEqual(['R21']);
    expect(routed[3].layerSuggestions).toEqual([]);
  });
});
