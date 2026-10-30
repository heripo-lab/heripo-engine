import type { Chapter, ProcessedDocument } from '@heripo/model';

import type { ReportRouterInput } from './report-router';

import { describe, expect, test } from 'vitest';

import { buildDocumentResourceIndex } from '../resources/document-resource-index';
import { REPORT_TRAIT_IDS } from './report-profile';
import {
  REPORT_PROFILE_PROPOSAL_VERSION,
  REPORT_ROUTER_VERSION,
  REPORT_TRAIT_DEFINITIONS,
  createReportRouterRequest,
  createReportRouterSchema,
  inspectReportRouterResponse,
} from './report-router';
import { collectReportSignals } from './report-signals';

const cell = (text: string) => ({
  text,
  rowSpan: 1,
  colSpan: 1,
  isHeader: false,
});
const chapter = (
  id: string,
  originTitle: string,
  texts: string[],
  extra: Partial<Chapter> = {},
): Chapter => ({
  id,
  originTitle,
  title: originTitle,
  pageNo: 1,
  level: 1,
  textBlocks: texts.map((text, i) => ({
    id: `${id}-t${i}`,
    text,
    pdfPageNo: 2,
  })),
  imageIds: [],
  tableIds: [],
  footnoteIds: [],
  ...extra,
});
const document = (): ProcessedDocument =>
  ({
    reportId: 'report',
    pageRangeMap: { 1: { startPageNo: 1, endPageNo: 1 } },
    chapters: [
      chapter('ch-0', 'I. 머리말', ['배경 문단이다.']),
      chapter(
        'ch-1',
        'IV. 조사 내용',
        [
          '1트렌치',
          '2009년 지표조사에서 성벽이 보고된 바 있다.',
          '유구는 확인되지 않았다.',
          '마도23-1',
          '청자발',
          'Celadon bowl',
          '높이 3.4cm',
          '마도23-2',
          '마도23-3',
          '매도23-1',
          '교란층 복토층 Ⅳ층군 아래',
          '복토층 위',
        ],
        {
          tableIds: ['log', 'registry', 'empty'],
          children: [chapter('ch-2', '1) 트렌치', ['트렌치 서술이다.'])],
        },
      ),
      chapter('ch-3', '부록', []),
    ],
    images: [],
    tables: [
      {
        id: 'log',
        pdfPageNo: 3,
        numRows: 1,
        numCols: 2,
        grid: [[cell('일자'), cell('작업 내용')]],
      },
      {
        id: 'registry',
        pdfPageNo: 4,
        numRows: 4,
        numCols: 2,
        caption: { fullText: '표 1' },
        grid: [
          ['번호', '유물명'],
          ['1', '청자'],
          ['2', '백자'],
          ['3', '기와'],
        ].map((r) => r.map(cell)),
      },
      { id: 'empty', pdfPageNo: 4, numRows: 0, numCols: 0, grid: [] },
    ],
    footnotes: [],
  }) as unknown as ProcessedDocument;
const build = (doc = document()) => {
  const index = buildDocumentResourceIndex(doc);
  const signals = collectReportSignals(doc, index, { inputSha256: 'hash' });
  return { index, signals, request: createReportRouterRequest(index, signals) };
};
const trait = (id: string, value = 'unclear', extra: object = {}) => ({
  id,
  value,
  confidence: 'medium',
  reason: '근거',
  evidence: [],
  signals: [],
  ...extra,
});
const response = (extra: object = {}) => ({
  traits: REPORT_TRAIT_IDS.map((id) => trait(id)),
  scopeChapterIds: ['ch-1'],
  scopeReasons: [{ chapterId: 'ch-1', reason: '조사 내용' }],
  newTraits: [],
  unknowns: [],
  ...extra,
});

describe('createReportRouterRequest', () => {
  test('builds the v2 request from the table of contents, compact signals and quotable excerpts', () => {
    const doc = document();
    delete (doc.chapters[1].children![0].textBlocks[0] as { id?: string }).id;
    const { request, signals } = build(doc);
    const input = JSON.parse(request.userPrompt) as ReportRouterInput;

    expect(request.version).toBe(REPORT_ROUTER_VERSION);
    expect(request.systemPrompt).toContain('Use only sourceId values listed');
    expect(request.providerOutputSchema).toEqual(createReportRouterSchema());
    expect(JSON.stringify(request.providerOutputSchema)).not.toContain('ch-1');
    expect(input.traits).toEqual(
      REPORT_TRAIT_IDS.map((id) => ({
        id,
        definition: REPORT_TRAIT_DEFINITIONS[id],
      })),
    );
    expect(input.toc.map((c) => c[0])).toEqual(
      signals.toc.map((c) => c.chapterId),
    );
    expect(input.signals).toMatchObject({
      trenchHeadings: 1,
      logTables: { count: 1, rows: 1 },
      identifierPatterns: [
        { prefix: '마도', count: 3, variants: [['매도', 1]] },
      ],
    });
    const roles = Object.fromEntries(
      input.excerpts.map((e) => [e.sourceId, e.role]),
    );
    expect(roles).toMatchObject({
      'id:ch-1-t0': 'trench',
      'id:ch-1-t4': 'catalogEntry',
      'table:log': 'tableHeader',
      'table:registry': 'tableHeader',
    });
    expect(roles).not.toHaveProperty('id:ch-0-t0');
    expect(roles['path:/chapters/1/children/0/textBlocks/0']).toBe(
      'opening:ch-2',
    );
    expect(
      input.excerpts.find((e) => e.sourceId === 'table:registry')?.text,
    ).toBe('[ch-1 p4 · 표 1] 번호 | 유물명 || 1 | 청자');
    expect(input.excerpts.find((e) => e.sourceId === 'table:log')?.text).toBe(
      '[ch-1 p3] 일자 | 작업 내용 || ',
    );
    expect(Object.keys(roles)).not.toContain('table:empty');
    const withImages = document();
    withImages.chapters[1].imageIds = ['a', 'b', 'c', 'd', 'e'];
    withImages.images = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
      id,
      pdfPageNo: 1,
      path: `${id}.png`,
    })) as ProcessedDocument['images'];
    expect(
      (JSON.parse(build(withImages).request.userPrompt) as ReportRouterInput)
        .signals.uncaptionedImagesByChapter,
    ).toEqual([['ch-1', 5, 1]]);
  });

  test('skips signal samples that are not in the index', () => {
    const { index, signals } = build();
    signals.signals.trenchHeadings.samples.push({
      chapterId: 'ch-1',
      pdfPageNo: 1,
      sourceId: 'id:missing',
      text: '',
    });

    const input = JSON.parse(
      createReportRouterRequest(index, signals).userPrompt,
    ) as ReportRouterInput;

    expect(input.excerpts.map((e) => e.sourceId)).not.toContain('id:missing');
  });
});

describe('inspectReportRouterResponse', () => {
  test('turns a clean response into a proposal without repairing it', () => {
    const { request } = build();
    const raw = response({
      traits: REPORT_TRAIT_IDS.map((id) =>
        id === 'trench_survey'
          ? trait(id, 'yes', {
              evidence: [{ sourceId: 'id:ch-1-t0', quote: '트렌치' }],
            })
          : id === 'uncaptioned_figures'
            ? trait(id, 'no', { signals: ['size'] })
            : trait(id),
      ),
      newTraits: [
        {
          name: 'x',
          definition: 'd',
          evidence: [{ sourceId: 'table:log', quote: '일자' }],
        },
      ],
      unknowns: ['없음'],
    });

    const result = inspectReportRouterResponse(request, raw);

    expect(result.issues).toEqual([]);
    expect(result.proposal).toMatchObject({
      version: REPORT_PROFILE_PROPOSAL_VERSION,
      routerVersion: REPORT_ROUTER_VERSION,
      scopeChapterIds: ['ch-1'],
      unknowns: ['없음'],
      issues: [],
    });
    expect(
      result.proposal?.traits.find((t) => t.id === 'trench_survey'),
    ).toMatchObject({
      value: 'yes',
      issues: [],
    });
  });

  test('lists quote, support, signal and trait problems without dropping the traits', () => {
    const { request } = build();
    const traits = REPORT_TRAIT_IDS.filter((id) => id !== 'few_remains').map(
      (id) => trait(id),
    );
    traits[0] = trait('multi_chapter_scope', 'yes');
    traits[1] = trait('trench_survey', 'no', {
      evidence: [
        { sourceId: 'id:none', quote: 'a' },
        { sourceId: 'id:ch-1-t0', quote: '' },
        { sourceId: 'id:ch-1-t0', quote: '없는 문장' },
      ],
      signals: ['made_up'],
    });
    const raw = response({
      traits: [...traits, trait('grid_survey'), trait('x-other')],
      newTraits: [
        {
          name: 'n',
          definition: 'd',
          evidence: [{ sourceId: 'id:ch-1-t0', quote: 'zz' }],
        },
      ],
    });

    const result = inspectReportRouterResponse(request, raw);

    expect(result.proposal?.issues).toEqual([
      'unknown trait x-other',
      'repeated trait grid_survey',
      'missing trait few_remains',
    ]);
    expect(
      result.proposal?.traits.find((t) => t.id === 'trench_survey')?.issues,
    ).toEqual([
      'unknown source id:none',
      'quote not exact in id:ch-1-t0',
      'quote not exact in id:ch-1-t0',
      'unknown signal made_up',
    ]);
    expect(result.issues).toContain('multi_chapter_scope: yes without support');
    expect(result.issues).toContain(
      'new trait n: quote not exact in id:ch-1-t0',
    );
    expect(inspectReportRouterResponse(request, { traits: 'x' })).toEqual({
      issues: ['Response does not match the router schema'],
      proposal: null,
    });
  });

  test('flags a yes that the measured signals cannot support', () => {
    const quiet = document();
    quiet.chapters = [chapter('ch-1', 'IV. 조사 내용', ['조사하였다.'])];
    quiet.tables = [];
    const yes = (id: string) => trait(id, 'yes', { signals: ['size'] });
    const contradicted = [
      'trench_survey',
      'catalog_artifacts',
      'log_tables',
      'appendix_registry',
      'ocr_identifier_noise',
    ];
    const run = (doc: ProcessedDocument) =>
      inspectReportRouterResponse(
        build(doc).request,
        response({
          traits: REPORT_TRAIT_IDS.map((id) =>
            contradicted.includes(id) ? yes(id) : trait(id),
          ),
        }),
      ).issues;
    const measured = document();
    measured.chapters[1].textBlocks = measured.chapters[1].textBlocks.filter(
      (b) => !/^(마도|매도)/.test(b.text),
    );
    const latinOnly = document();
    latinOnly.chapters[1].textBlocks = [
      { id: 'l', text: 'Celadon bowl', pdfPageNo: 1 },
    ];

    expect(run(quiet)).toEqual(
      contradicted.map((id) => `${id}: yes contradicts the measured signals`),
    );
    expect(run(document())).toEqual([]);
    expect(run(measured)).toEqual([
      'ocr_identifier_noise: yes contradicts the measured signals',
    ]);
    expect(run(latinOnly)).not.toContain(
      'catalog_artifacts: yes contradicts the measured signals',
    );
  });

  test('checks scope chapters against the table of contents', () => {
    const { request } = build();
    const scope = (scopeChapterIds: string[], scopeReasons = [] as object[]) =>
      inspectReportRouterResponse(
        request,
        response({ scopeChapterIds, scopeReasons }),
      ).issues;

    expect(scope([])).toEqual(['scope has no chapter']);
    expect(scope(['ch-9'])).toEqual(['unknown scope chapter ch-9']);
    expect(scope(['ch-1', 'ch-1'])).toEqual(['scope chapters are repeated']);
    expect(scope(['ch-1', 'ch-2'])).toEqual(['scope chapter ch-2 is nested']);
    expect(scope(['ch-2', 'ch-3', 'ch-0', 'ch-9'])).toEqual([
      'unknown scope chapter ch-9',
    ]);
    expect(scope(['ch-1'], [{ chapterId: 'ch-3', reason: 'x' }])).toEqual([
      'scope reason for chapter ch-3 outside the scope',
    ]);
  });
});
