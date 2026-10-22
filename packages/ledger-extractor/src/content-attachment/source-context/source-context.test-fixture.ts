import type { ProcessedDocument } from '@heripo/model';

import type { ContentAttachmentPlan } from '../content-attachment';
import type { ContentAttachmentSegmentationAudit } from '../recipients/segmentation';

import { buildDocumentResourceIndex } from '../../resources/document-resource-index';
import { createContentAttachmentGroundedInput } from '../grounding';
import { createContentAttachmentSegmentationRequest } from '../recipients/segmentation';

export function sourceContextFixture() {
  const cell = (text: string, isHeader = false) => ({
    text,
    isHeader,
    rowSpan: 1,
    colSpan: 1,
  });
  const headers = () => [
    cell('현장일수', true),
    cell('날짜', true),
    cell('작업내용', true),
  ];
  const document: ProcessedDocument = {
    reportId: 'unrelated-report',
    pageRangeMap: { 4: { startPageNo: -1, endPageNo: -1 } },
    images: [],
    footnotes: [],
    chapters: [
      {
        id: 'methods',
        title: 'Methods',
        originTitle: 'Methods',
        level: 1,
        pageNo: 1,
        imageIds: [],
        footnoteIds: [],
        tableIds: ['before', 'current'],
        textBlocks: [
          { id: 'scope', pdfPageNo: 1, text: '전체 조사범위 30㎡.' },
          { id: 'partial', pdfPageNo: 1, text: '시굴범위 10㎡.' },
          { id: 'heading', pdfPageNo: 2, text: '2) 발굴조사' },
          {
            id: 'definition',
            pdfPageNo: 2,
            text: '발굴조사는 전체 조사범위에서 실시하였다.',
          },
          {
            id: 'method',
            pdfPageNo: 3,
            text: '기록하였다. 조사 완료 후 현황 측량.\n3.5㎝ (미완 😀',
          },
          { id: 'bridge', pdfPageNo: 3, text: '조사 경과는 표9와 같다.' },
          { id: 'later', pdfPageNo: 6, text: '다음 장의 원문.' },
        ],
      },
    ],
    tables: [
      {
        id: 'before',
        pdfPageNo: 3,
        numRows: 2,
        numCols: 3,
        caption: { fullText: '표 9 조사 일지' },
        captionSourceRefs: ['#/texts/9'],
        grid: [headers(), [cell('7'), cell('2월 7일'), cell('준비 작업')]],
      },
      {
        id: 'current',
        pdfPageNo: 4,
        numRows: 3,
        numCols: 3,
        grid: [
          headers(),
          [cell('8'), cell('2월 8일'), cell('진행 작업')],
          [cell('9'), cell('2월 9일'), cell('현황 측량')],
        ],
      },
    ],
  };
  const index = buildDocumentResourceIndex(document);
  const selected = index.resources
    .filter((r) => r.kind === 'text' || r.kind === 'tableCell')
    .map((resource) => ({ sourceId: 'source:' + resource.key, resource }));
  const path = [{ id: 'methods', originTitle: 'Methods' }];
  const scope = selected.find(
    (s) => s.resource.key === '/chapters/0/textBlocks/0',
  )!;
  const plan: ContentAttachmentPlan = {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: 'source-hash',
    candidateSnapshotId: 'frozen-registry',
    registrySha256: 'registry-hash',
    registryUncertainties: [],
    pages: [],
    registry: [
      {
        ref: 'R1',
        groupId: 'long-area-group',
        recordKind: 'area',
        mentions: [
          {
            candidateId: 'long-area-mention',
            sourceName: '조사범위',
            sourceIdentifier: null,
            chapterPath: path,
            evidence: [
              {
                sourceId: scope.sourceId,
                resourceKey: scope.resource.key,
                resourceId: scope.resource.resourceId,
                sourceRefs: scope.resource.sourceRefs,
                pdfPageNo: 1,
                logicalPageRange: null,
                charStart: 0,
                charEnd: scope.resource.data.text.length,
                quote: scope.resource.data.text,
              },
            ],
          },
        ],
      },
    ],
    units: [1, 2, 3, 4, 6].map((page) => ({
      unitId: 'page-' + page,
      pdfPageNo: page,
      sources: selected.filter((s) => s.resource.pdfPageNo === page),
      chapters: [{ chapterId: 'methods', path }],
      tables: index.resources
        .filter((r) => r.kind === 'table')
        .filter((r) => r.pdfPageNo === page)
        .map((r) => ({ key: r.key, data: r.data })),
      readOnlyContext: [],
    })),
  };
  const unit = plan.units.find((u) => u.pdfPageNo === 4)!;
  unit.readOnlyContext = [0, 1, 2, 3].map((i) => ({
    resourceKey: `/chapters/0/textBlocks/${i}`,
    text: document.chapters[0].textBlocks[i].text,
  }));
  const segment = (
    target = unit,
    key = '/tables/1/grid/2/2',
    excerptIndex = 0,
  ) => {
    const input = createContentAttachmentGroundedInput(plan, target);
    const excerpt = input.codeMap.excerpts.filter(
      (e) => e.evidence[0].resourceKey === key,
    )[excerptIndex];
    const request = createContentAttachmentSegmentationRequest(input, [
      excerpt.ref,
    ]);
    const source = request.wordEvidence.sources.find(
      (s) => s.ref === excerpt.ref,
    )!;
    return {
      ...request,
      rawResponse: {
        segments: {
          [excerpt.ref]: [
            { wordRanges: [`${excerpt.ref}:W1-W${source.words.length}`] },
          ],
        },
      },
      usage: {} as never,
      callAttempts: [],
    } satisfies ContentAttachmentSegmentationAudit;
  };
  const pair = {
    precedingTableKey: '/tables/0',
    followingTableKey: '/tables/1',
    boundaryCellIndexes: [0, 1],
  };
  return { document, plan, unit, pair, segment };
}
