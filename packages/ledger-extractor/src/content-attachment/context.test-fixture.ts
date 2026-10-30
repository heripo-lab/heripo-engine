import type { ProcessedDocument } from '@heripo/model';

import type { CandidateEvidence } from '../candidates/discovery-types';
import type { ContentAttachmentPlan } from './types';

import { buildDocumentResourceIndex } from '../resources/document-resource-index';

export function fixture() {
  const cell = (text: string, isHeader = false, colSpan = 1) => ({
    text,
    isHeader,
    rowSpan: 1,
    colSpan,
  });
  const doc: ProcessedDocument = {
    reportId: 'report',
    pageRangeMap: {},
    images: [],
    footnotes: [],
    chapters: [
      {
        id: 'pits',
        title: 'Pits',
        originTitle: 'Pits',
        level: 1,
        pageNo: 1,
        textBlocks: [
          {
            id: 'inventory',
            pdfPageNo: 1,
            text: 'Three pits were investigated.',
          },
          { id: 'subject', pdfPageNo: 1, text: 'Most were cut into red clay' },
          { id: 'body', pdfPageNo: 2, text: 'or gray clay. Their plans vary.' },
          { id: 'next', pdfPageNo: 4, text: 'Finds' },
          { id: 'after', pdfPageNo: 4, text: 'A vessel was recovered.' },
        ],
        tableIds: ['local', 'remote', 'remote-two'],
        imageIds: [],
        footnoteIds: [],
      },
      {
        id: 'other',
        title: 'Other survey',
        originTitle: 'Other survey',
        level: 1,
        pageNo: 3,
        textBlocks: [],
        tableIds: ['other'],
        imageIds: [],
        footnoteIds: [],
      },
    ],
    tables: [
      {
        id: 'local',
        pdfPageNo: 2,
        numRows: 2,
        numCols: 2,
        grid: [
          [cell('Number', true), cell('Shape', true)],
          [cell('1'), cell('round')],
        ],
      },
      {
        id: 'remote',
        pdfPageNo: 3,
        caption: { fullText: 'Original inventory' },
        numRows: 3,
        numCols: 3,
        grid: [
          [cell('Number', true), cell('Dimensions', true, 2)],
          [cell('2'), cell('round'), cell('12')],
          [cell('3'), cell('square'), cell('14')],
        ],
      },
      {
        id: 'other',
        pdfPageNo: 3,
        numRows: 2,
        numCols: 2,
        grid: [
          [cell('Number', true), cell('Shape', true)],
          [cell('2'), cell('round')],
        ],
      },
      {
        id: 'remote-two',
        pdfPageNo: 4,
        numRows: 1,
        numCols: 1,
        grid: [[cell('4')]],
      },
    ],
  };
  const index = buildDocumentResourceIndex(doc);
  const selected = index.resources
    .filter((r) => r.kind === 'text' || r.kind === 'tableCell')
    .map((resource) => ({ sourceId: `source:${resource.key}`, resource }));
  const mainPath = [{ id: 'pits', originTitle: 'Pits' }];
  const evidence = (key: string): CandidateEvidence => {
    const { resource: r, sourceId } = selected.find(
      (s) => s.resource.key === key,
    )!;
    return {
      sourceId,
      resourceKey: key,
      resourceId: r.resourceId,
      sourceRefs: r.sourceRefs,
      pdfPageNo: r.pdfPageNo,
      logicalPageRange: r.logicalPageRange,
      charStart: 0,
      charEnd: r.data.text.length,
      quote: r.data.text,
    };
  };
  const specs = [
    ['/tables/0/grid/1/0'],
    ['/tables/1/grid/1/0', '/tables/1/grid/1/1'],
    ['/tables/1/grid/2/0'],
    ['/tables/2/grid/1/0'],
    ['/chapters/0/textBlocks/0'],
    ['/tables/3/grid/0/0'],
  ];
  const plan: ContentAttachmentPlan = {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: 'hash',
    candidateSnapshotId: 'snapshot',
    registrySha256: 'registry',
    registryUncertainties: [],
    pages: [],
    registry: specs.map((keys, i) => ({
      ref: `R${i + 1}`,
      groupId: `long-group-${i}`,
      recordKind: 'feature',
      mentions: [
        {
          candidateId: `long-candidate-${i}`,
          sourceName: 'Pit',
          sourceIdentifier: String(i + 1),
          chapterPath:
            i === 3 ? [{ id: 'other', originTitle: 'Other survey' }] : mainPath,
          evidence: keys.map(evidence),
        },
      ],
    })),
    units: [1, 2, 3, 4].map((page) => ({
      unitId: `page-${page}`,
      pdfPageNo: page,
      sources: selected.filter((s) => s.resource.pdfPageNo === page),
      chapters: [{ chapterId: 'pits', path: mainPath }],
      tables: index.resources
        .filter((r) => r.kind === 'table')
        .filter((r) => r.pdfPageNo === page)
        .map((r) => ({ key: r.key, data: r.data })),
      readOnlyContext: [],
    })),
  };
  return { plan, unit: plan.units[1], evidence };
}
