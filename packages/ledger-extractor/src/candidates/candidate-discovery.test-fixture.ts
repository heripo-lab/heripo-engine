import type { Chapter, ProcessedDocument } from '@heripo/model';

import type {
  CandidateDiscoveryAudit,
  CandidateDiscoveryResponse,
  CandidateDiscoveryUnit,
} from './discovery-types';

import { buildDocumentResourceIndex } from '../resources/document-resource-index';
import { prepareCandidateDiscovery } from './discovery-plan';
import {
  createCandidateDiscoveryRequest,
  getCandidateSources,
} from './discovery-request';

export const usage = {
  component: 'test',
  phase: 'test',
  model: 'primary' as const,
  modelName: 'mock',
  inputTokens: 1,
  outputTokens: 2,
  totalTokens: 3,
};

export const chapter = (overrides: Partial<Chapter> = {}): Chapter => ({
  id: 'root',
  originTitle: '조사 내용',
  title: '조사 내용',
  pageNo: 1,
  level: 1,
  textBlocks: [],
  imageIds: [],
  tableIds: [],
  footnoteIds: [],
  ...overrides,
});

export const input = (): ProcessedDocument => ({
  reportId: 'report',
  pageRangeMap: { 1: { startPageNo: 0, endPageNo: 0 } },
  chapters: [
    chapter({
      textBlocks: [
        { id: 'a', sourceRef: '#/texts/1', text: '1호 우물', pdfPageNo: 1 },
        { id: 'b', text: '우물의 독립 본문이다.', pdfPageNo: 2 },
        { id: 'c', text: '마지막 문단', pdfPageNo: 2 },
      ],
      tableIds: ['t'],
      children: [
        chapter({
          id: 'child',
          textBlocks: [{ text: '우물 상부 폐기층', pdfPageNo: 3 }],
        }),
        chapter({ id: 'empty' }),
      ],
    }),
  ],
  images: [],
  footnotes: [],
  tables: [
    {
      id: 't',
      sourceRef: '#/tables/0',
      pdfPageNo: 1,
      numRows: 2,
      numCols: 1,
      grid: [
        [{ text: '호수', colSpan: 1, rowSpan: 1, isHeader: true }],
        [{ text: '2호', colSpan: 1, rowSpan: 1, isHeader: false }],
      ],
    },
  ],
});

export const prepare = () =>
  prepareCandidateDiscovery(buildDocumentResourceIndex(input()), {
    scopeChapterId: 'root',
    inputSha256: 'hash',
    maxTextChars: 20,
    tableRowsPerUnit: 1,
  });

export const proposal = (
  unit: CandidateDiscoveryUnit,
): CandidateDiscoveryResponse['candidates'][number] => ({
  recordKind: 'feature',
  sourceName: '우물',
  identifierSourceId: null,
  sourceIdentifier: '1호',
  eligibilityBasis: 'independent_body',
  reason: '독립 설명',
  evidence: [
    { sourceId: getCandidateSources(unit)[0].sourceId, quote: '1호 우물' },
  ],
});

export const audit = (
  unit: CandidateDiscoveryUnit,
  response: CandidateDiscoveryResponse,
): CandidateDiscoveryAudit => ({
  unitId: unit.unitId,
  ...createCandidateDiscoveryRequest(unit),
  response,
  usage,
});
