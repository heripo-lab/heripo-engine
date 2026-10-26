import type { Chapter, ProcessedDocument } from '@heripo/model';

import { describe, expect, test } from 'vitest';

import { buildDocumentResourceIndex } from '../resources/document-resource-index';
import { REPORT_SIGNALS_VERSION, collectReportSignals } from './report-signals';

const cell = (text: string) => ({
  text,
  rowSpan: 1,
  colSpan: 1,
  isHeader: false,
});
const table = (
  id: string,
  rows: string[][],
  caption?: string,
): ProcessedDocument['tables'][number] => ({
  id,
  pdfPageNo: 9,
  numRows: rows.length,
  numCols: rows[0]?.length ?? 0,
  grid: rows.map((r) => r.map(cell)),
  ...(caption ? { caption: { fullText: caption } } : {}),
});
const image = (id: string, caption?: string) => ({
  id,
  pdfPageNo: 3,
  path: `images/${id}.png`,
  ...(caption ? { caption: { fullText: caption } } : {}),
});
const chapter = (
  id: string,
  originTitle: string,
  texts: Array<string | { text: string; id?: string }>,
  extra: Partial<Chapter> = {},
): Chapter => ({
  id,
  originTitle,
  title: originTitle,
  pageNo: 1,
  level: 1,
  textBlocks: texts.map((t, i) =>
    typeof t === 'string'
      ? { id: `${id}-t${i}`, text: t, pdfPageNo: 2 }
      : { ...t, pdfPageNo: 2 },
  ),
  imageIds: [],
  tableIds: [],
  footnoteIds: [],
  ...extra,
});
const report = (chapters: Chapter[], extra: Partial<ProcessedDocument> = {}) =>
  ({
    reportId: 'report',
    pageRangeMap: {
      1: { startPageNo: 1, endPageNo: 1 },
      2: { startPageNo: 2, endPageNo: 2 },
    },
    chapters,
    images: [],
    tables: [],
    footnotes: [],
    ...extra,
  }) as ProcessedDocument;
const collect = (doc: ProcessedDocument) =>
  collectReportSignals(doc, buildDocumentResourceIndex(doc), {
    inputSha256: 'hash',
  });

describe('collectReportSignals', () => {
  test('counts generic report signals with source samples', () => {
    const doc = report(
      [
        chapter(
          'ch-1',
          'IV. 조사 내용',
          [
            '머리 문단은 트렌치 앞에 있으며 조사 과정을 정리하였다.',
            '1트렌치',
            '10 × 10m 크기의 그리드를 설정하고 23-1구역을 조사하였다.',
            '23-2구역 제토조사',
            '유구는 확인되지 않았으며 교란층만 남아 있었다.',
            '2009년 지표조사에서 성벽이 보고된 바 있다.',
            '토층은 복토층과 Ⅳ층군 아래로 이어지며,',
            { text: '조사 결과 복토층 아래에서 기반층이 확인되었으나 그' },
            '마도23-1 마도발굴23-1',
            '마도23-2',
            '마도23-3',
            '매도23-1',
            'AB7-9',
            '높이 3.4cm 입지름 10.8cm',
            'Celadon bowl',
            '교란층 복토층',
          ],
          { imageIds: ['i1', 'i2', 'i3', 'i4', 'i5'], tableIds: ['log'] },
        ),
        chapter('ch-2', '부록 유물 목록', [], {
          imageIds: ['j1', 'j2', 'j3', 'j4', 'j5'],
          tableIds: ['registry'],
        }),
        chapter('ch-3', '맺음말', [], { imageIds: ['k1'] }),
      ],
      {
        images: [
          ...['i1', 'i2', 'i3', 'i4'].map((id) => image(id)),
          image('i5', '사진 5'),
          ...['j1', 'j2', 'j3', 'j4', 'j5'].map((id) => image(id, id)),
          image('k1'),
        ],
        tables: [
          table('log', [
            ['일자', '작업 내용'],
            ['8월 1일', '제토'],
          ]),
          table(
            'registry',
            [
              ['번호', '유물명'],
              ['1', '청자'],
              ['1', '백자'],
              ['2', '기와'],
            ],
            '표 1 유물 목록',
          ),
          table('empty', []),
          table('loose', [['연번', '명칭'], [], ['', 'x'], ['', 'y']]),
        ],
      },
    );
    delete (doc.chapters[0].textBlocks[7] as { id?: string }).id;

    const signals = collect(doc);

    expect(signals).toMatchObject({
      version: REPORT_SIGNALS_VERSION,
      inputSha256: 'hash',
      size: {
        pages: 2,
        chapters: 3,
        textBlocks: 16,
        tables: 4,
        captionedTables: 1,
        images: 11,
        captionedImages: 6,
      },
    });
    expect(signals.toc[0]).toMatchObject({
      chapterId: 'ch-1',
      depth: 0,
      images: 5,
      captionedImages: 1,
      tables: 1,
      investigationLike: true,
      appendixLike: false,
    });
    const s = signals.signals;
    expect(s.investigationLikeChapters.map((c) => c.chapterId)).toEqual([
      'ch-1',
      'ch-2',
    ]);
    expect(s.appendixLikeChapters).toEqual([
      { chapterId: 'ch-2', title: '부록 유물 목록', tables: 1 },
    ]);
    expect(s.trenchHeadings.count).toBe(1);
    expect(s.trenchHeadings.samples[0]).toEqual({
      chapterId: 'ch-1',
      pdfPageNo: 2,
      sourceId: 'id:ch-1-t1',
      text: '1트렌치',
    });
    expect(s.gridUnits).toMatchObject({ gridSizeMentions: 1, unitMentions: 2 });
    expect(s.noRemainsSentences.count).toBe(1);
    expect(s.priorInvestigationMentions).toMatchObject({
      count: 1,
      chapters: ['ch-1'],
    });
    expect(s.midSentenceBlockRate).toMatchObject({
      proseBlocks: 8,
      midSentenceBlocks: 2,
      rate: 0.25,
    });
    expect(s.midSentenceBlockRate.samples[1].sourceId).toBe(
      'path:/chapters/0/textBlocks/7',
    );
    expect(s.uncaptionedImagesByChapter).toEqual([
      {
        chapterId: 'ch-1',
        title: 'IV. 조사 내용',
        images: 5,
        uncaptionedRate: 0.8,
      },
    ]);
    expect(s.identifierPatterns).toHaveLength(1);
    expect(s.identifierPatterns[0]).toMatchObject({
      prefix: '마도',
      count: 3,
      variants: [{ prefix: '매도', count: 1 }],
    });
    expect(s.catalogFieldBlocks).toMatchObject({
      measurementBlocks: 1,
      latinOnlyBlocks: 1,
    });
    expect(s.logTables).toEqual({
      count: 1,
      rows: 2,
      headers: ['일자|작업 내용'],
    });
    expect(s.registryTables).toEqual([
      {
        tableId: 'registry',
        chapterId: 'ch-2',
        chapterTitle: '부록 유물 목록',
        pdfPageNo: 9,
        rows: 4,
        cols: 2,
        captioned: true,
        firstColumnUniqueRate: 0.67,
        appendixLike: true,
        header: '번호|유물명',
      },
      expect.objectContaining({
        tableId: 'loose',
        chapterId: undefined,
        firstColumnUniqueRate: 0,
        appendixLike: false,
      }),
    ]);
    expect(s.stratigraphy.numberedLayerUnits).toEqual([
      { name: 'Ⅳ층군', sections: 1 },
    ]);
    expect(s.stratigraphy.namedLayers[0]).toEqual({
      name: '복토층',
      sections: 1,
    });
  });

  test('reports no identifier pattern and a zero rate when the report has neither', () => {
    const none = collect(report([chapter('ch-1', '머리말', ['짧다'])]));
    const few = collect(
      report([chapter('ch-1', '머리말', ['마도23-1', '마도23-2'])]),
    );

    expect(none.signals.identifierPatterns).toEqual([]);
    expect(none.signals.midSentenceBlockRate.rate).toBe(0);
    expect(few.signals.identifierPatterns).toEqual([]);
  });
});
