import type { ProcessedDocument } from '@heripo/model';

import type { CandidateDeduplicationResult } from '../candidates/candidate-deduplication';
import type { CandidateDiscoveryResult } from '../candidates/candidate-discovery';
import type {
  ContentAttachmentAudit,
  ContentAttachmentResponse,
} from './types';

import { prepareCandidateDiscovery } from '../candidates/candidate-discovery';
import { buildDocumentResourceIndex } from '../resources/document-resource-index';
import { prepareContentAttachment } from './prepare';
import { createContentAttachmentRequest } from './request';

export const usage = {
  component: 'test',
  phase: 'test',
  model: 'primary' as const,
  modelName: 'mock',
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
};

export function fixture() {
  const doc: ProcessedDocument = {
    reportId: 'report',
    pageRangeMap: {
      1: { startPageNo: -1, endPageNo: -1 },
      2: { startPageNo: 0, endPageNo: 0 },
      3: { startPageNo: 1, endPageNo: 1 },
    },
    chapters: [
      {
        id: 'ch',
        originTitle: '調査',
        title: '調査',
        level: 1,
        pageNo: 1,
        textBlocks: [
          { id: 'cover', text: '報告書', pdfPageNo: 2 },
          {
            id: 'a',
            text: '井戸と廃棄層。',
            sourceRef: '#/texts/1',
            pdfPageNo: 3,
          },
          { id: 'b', text: '井戸と廃棄層。', pdfPageNo: 4 },
          { id: 'c', text: '前半の文は切れ', pdfPageNo: 4 },
          { id: 'd', text: 'たまま。', pdfPageNo: 4 },
          { id: 'repeated', text: '同文。同文。', pdfPageNo: 4 },
        ],
        imageIds: [],
        tableIds: ['table'],
        footnoteIds: [],
      },
    ],
    images: [],
    footnotes: [],
    tables: [
      {
        id: 'table',
        pdfPageNo: 3,
        numRows: 2,
        numCols: 3,
        grid: [
          [
            { text: '番号', rowSpan: 2, colSpan: 1, isHeader: true },
            { text: '寸法', rowSpan: 1, colSpan: 2, isHeader: true },
          ],
          [
            { text: '7', rowSpan: 1, colSpan: 1, isHeader: false },
            { text: '20', rowSpan: 1, colSpan: 1, isHeader: false },
            { text: '', rowSpan: 1, colSpan: 1, isHeader: false },
          ],
        ],
      },
    ],
  };
  const index = buildDocumentResourceIndex(doc);
  const dp = prepareCandidateDiscovery(index, {
    scopeChapterId: 'ch',
    inputSha256: 'hash',
    maxTextChars: 8000,
    tableRowsPerUnit: 12,
  });
  const evidence = {
    sourceId: 'id:a',
    resourceKey: '/chapters/0/textBlocks/1',
    resourceId: 'a',
    sourceRefs: ['#/texts/1'],
    pdfPageNo: 3,
    logicalPageRange: { startPageNo: 1, endPageNo: 1 },
    quote: '井戸と廃棄層。',
    charStart: 0,
    charEnd: 7,
  };
  const discovery: CandidateDiscoveryResult = {
    version: 'ledger-object-candidates.v1',
    inputSha256: 'hash',
    scopeChapterId: 'ch',
    scopeTitle: '調査',
    candidates: ['one', 'two'].map((id) => ({
      candidateId: id,
      status: 'proposed',
      recordKind: 'layer',
      sourceName: '廃棄層',
      sourceIdentifier: null,
      eligibilityBasis: 'explicit_context_unit',
      reason: '原文',
      chapterId: 'ch',
      unitIds: [dp.units[0].unitId],
      evidence: [evidence],
    })),
    issues: [],
    exclusions: [],
    completedUnitIds: dp.units.map((u) => u.unitId),
    totalUnits: dp.units.length,
    inspectedResourceCount: index.resources.length,
  };
  const groups: CandidateDeduplicationResult = {
    version: 'ledger-candidate-groups.v1',
    groups: [
      {
        groupId: 'g1',
        status: 'proposed',
        memberCandidateIds: ['one'],
        reason: '原文',
      },
      {
        groupId: 'g2',
        status: 'proposed',
        memberCandidateIds: ['two'],
        reason: '原文',
      },
    ],
    issues: [],
    uncertainMatches: [
      { leftCandidateId: 'one', rightCandidateId: 'two', reason: '未確定' },
    ],
  };
  const options = {
    inputSha256: 'hash',
    candidateSnapshotId: 'snapshot',
    pdfPageNumbers: [1, 2, 3, 4, 5],
    maxUnitChars: 8000,
  };
  return { doc, index, dp, discovery, groups, options };
}

export const prepare = async () => {
  const f = fixture();
  return prepareContentAttachment(
    f.index,
    f.dp,
    f.discovery,
    f.groups,
    f.options,
  );
};

export const empty = (): ContentAttachmentResponse => ({
  assignments: [],
  unresolved: [],
  ignoredPassages: [],
  ignoredSources: [],
});

export const audit = (
  plan: Awaited<ReturnType<typeof prepare>>,
  i: number,
  response: ContentAttachmentResponse,
): ContentAttachmentAudit => ({
  unitId: plan.units[i].unitId,
  ...createContentAttachmentRequest(
    plan,
    plan.units[i],
    'content-attachment.v1',
  ),
  response,
  usage,
});

export const ignore = (plan: Awaited<ReturnType<typeof prepare>>, i: number) =>
  plan.units[i].sources.map((s) => ({
    sourceId: s.sourceId,
    reason: '対象外',
  }));
