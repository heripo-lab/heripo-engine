import type { ProcessedDocument } from '@heripo/model';

import type {
  ContentAttachmentPlan,
  ContentAttachmentSelectionAudit,
  ContentAttachmentSelectionResponse,
} from './types';

import { buildDocumentResourceIndex } from '../resources/document-resource-index';
import { createContentAttachmentBodyBlockInput } from './body-blocks';
import { createContentAttachmentRequest } from './request';

export const s6 = [
  '우물은 조사대상지 중앙부의 평탄대지의 남쪽 해발 11.0m 지점에 위치한다.',
  '남쪽 조사 경계구역 과 접해있으며, 북쪽으로는 약 7.5m 거리를 두고 조선시대 건물지군이 위치하고 있다(사진 85.',
  '최 상부의 표토와 현대 퇴적층을 제거하자, 남서쪽 조사경계에 걸쳐 유구 윤곽선이 확인되었다.',
  '유구 윤곽선은 말각방형의 수혈에 서쪽으로 기다란 구가 부착된 평면형태이다(사진 103).',
];

export const empty = (): ContentAttachmentSelectionResponse => ({
  assignments: [],
  unresolved: [],
  ignored: [],
});

export function fixture(
  texts = [s6.join(' ')],
  table = false,
): ContentAttachmentPlan {
  const doc: ProcessedDocument = {
    reportId: 'report',
    pageRangeMap: { 122: { startPageNo: -1, endPageNo: -1 } },
    chapters: [
      {
        id: 'ch',
        originTitle: '調査',
        title: '調査',
        level: 1,
        pageNo: -1,
        textBlocks: texts.map((text, i) => ({
          id: `txt-${i}`,
          sourceRef: `#/texts/${i}`,
          pdfPageNo: 122,
          text,
        })),
        imageIds: [],
        tableIds: table ? ['table'] : [],
        footnoteIds: [],
      },
    ],
    images: [],
    footnotes: [],
    tables: table
      ? [
          {
            id: 'table',
            sourceRef: '#/tables/0',
            pdfPageNo: 122,
            numRows: 2,
            numCols: 3,
            grid: [
              [
                { text: '番号', rowSpan: 2, colSpan: 1, isHeader: true },
                { text: '寸法', rowSpan: 1, colSpan: 2, isHeader: true },
              ],
              [
                { text: ' 7 ', rowSpan: 1, colSpan: 1, isHeader: false },
                { text: '', rowSpan: 1, colSpan: 1, isHeader: false },
                { text: '20', rowSpan: 1, colSpan: 1, isHeader: false },
              ],
            ],
          },
        ]
      : [],
  };
  const index = buildDocumentResourceIndex(doc);
  const sources = index.resources
    .filter((r) => r.kind === 'text' || r.kind === 'tableCell')
    .map((resource) => ({ sourceId: `source:${resource.key}`, resource }));
  const path = [{ id: 'ch', originTitle: '調査' }];
  return {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: 'hash',
    candidateSnapshotId: 'snapshot',
    registrySha256: 'registry',
    registryUncertainties: [],
    registry: [
      'Well',
      'Modern deposit',
      'Topsoil',
      'Topsoil',
      'Natural ground',
    ].map((name, i) => ({
      ref: `R${i + 1}`,
      groupId: `g${i + 1}`,
      recordKind: i === 0 ? 'feature' : 'layer',
      mentions: [
        {
          candidateId: `c${i}`,
          sourceName: name,
          sourceIdentifier: null,
          chapterPath: path,
          evidence: [],
        },
      ],
    })),
    pages: [{ pdfPageNo: 122, unitIds: ['page-122'], status: 'planned' }],
    units: [
      {
        unitId: 'page-122',
        pdfPageNo: 122,
        sources,
        chapters: [{ chapterId: 'ch', path }],
        tables: index.resources
          .filter((r) => r.kind === 'table')
          .map((r) => ({ key: r.key, data: r.data })),
        readOnlyContext: [
          {
            resourceKey: 'context',
            text: 'Read-only context cannot be selected.',
          },
        ],
      },
    ],
  };
}

export function audit(
  plan: ContentAttachmentPlan,
  response: ContentAttachmentSelectionResponse,
  version:
    | 'content-attachment.v34'
    | 'content-attachment.v35'
    | 'content-attachment.v36'
    | 'content-attachment.v37'
    | 'content-attachment.v38'
    | 'content-attachment.v39'
    | 'content-attachment.v40'
    | 'content-attachment.v41' = 'content-attachment.v41',
): ContentAttachmentSelectionAudit {
  return {
    unitId: plan.units[0].unitId,
    ...createContentAttachmentRequest(plan, plan.units[0], version),
    codeMap: createContentAttachmentBodyBlockInput(plan, plan.units[0]).codeMap,
    response,
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
}

export const legacyAudit = (
  plan: ContentAttachmentPlan,
  response: ContentAttachmentSelectionResponse,
) => audit(plan, response, 'content-attachment.v34');
