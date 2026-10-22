import type { ProcessedDocument } from '@heripo/model';

import type { ContentAttachmentGroundedResponse } from './grounding';
import type { ContentAttachmentPlan } from './types';

import { buildDocumentResourceIndex } from '../resources/document-resource-index';

export function fixture(repeatedOrigins = false) {
  const path = [{ id: 'c', originTitle: 'Survey' }];
  const doc = {
    reportId: 'test',
    pageRangeMap: {},
    images: [],
    footnotes: [],
    chapters: [
      {
        id: 'c',
        originTitle: 'Survey',
        title: 'Survey',
        level: 1,
        pageNo: 1,
        imageIds: [],
        tableIds: [],
        footnoteIds: [],
        textBlocks: [
          { id: 'body', pdfPageNo: 1, text: 'Area work. Period A features.' },
        ],
      },
    ],
    tables: [
      {
        id: 't',
        pdfPageNo: 2,
        numRows: 2,
        numCols: 1,
        grid: [
          [
            {
              text: 'Tentative road (A)',
              rowSpan: 1,
              colSpan: 1,
              isHeader: false,
            },
          ],
          [{ text: 'Pit (B)', rowSpan: 1, colSpan: 1, isHeader: false }],
        ],
      },
    ],
  } as ProcessedDocument;
  if (repeatedOrigins)
    doc.tables.push({
      ...structuredClone(doc.tables[0]),
      id: 'second-table',
      pdfPageNo: 3,
    });
  const index = buildDocumentResourceIndex(doc),
    sources = index.resources
      .filter((r) => r.kind === 'text' || r.kind === 'tableCell')
      .map((resource) => ({ sourceId: resource.key, resource }));
  const evidence = (key: string) => {
    const r = sources.find((s) => s.resource.key === key)!.resource;
    return {
      sourceId: key,
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
  const plan: ContentAttachmentPlan = {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: 'h',
    candidateSnapshotId: 's',
    registrySha256: 'r',
    registryUncertainties: [],
    pages: [],
    registry: [
      ['opaque-nine', '/tables/0/grid/0/0'],
      ['opaque-two', '/tables/0/grid/1/0'],
      ['area', '/chapters/0/textBlocks/0'],
    ].map(([ref, key]) => ({
      ref,
      groupId: ref,
      recordKind: ref === 'area' ? 'area' : 'feature',
      mentions: [
        {
          candidateId: ref,
          sourceName: ref,
          sourceIdentifier: null,
          chapterPath: path,
          evidence: [evidence(key)],
        },
      ],
    })),
    units: [
      {
        unitId: 'b',
        pdfPageNo: 1,
        sources: sources.filter((s) => s.resource.kind === 'text'),
        chapters: [{ chapterId: 'c', path }],
        tables: [],
        readOnlyContext: [],
      },
      {
        unitId: 't',
        pdfPageNo: 2,
        sources: sources.filter((s) => s.resource.kind === 'tableCell'),
        chapters: [{ chapterId: 'c', path }],
        readOnlyContext: [],
        tables: index.resources
          .filter((r) => r.kind === 'table')
          .map((r) => ({ key: r.key, data: r.data })),
      },
    ],
  };
  if (repeatedOrigins)
    plan.registry[0].mentions.push({
      ...structuredClone(plan.registry[0].mentions[0]),
      candidateId: 'repeated',
      evidence: [evidence('/tables/1/grid/0/0')],
    });
  return { plan, unit: plan.units[0] };
}

export function response(): ContentAttachmentGroundedResponse {
  return {
    decisions: {
      E1: {
        status: 'assigned',
        candidateRefs: ['area'],
        reason: 'Area work',
        unresolved: null,
      },
      E2: {
        status: 'assigned',
        candidateRefs: ['opaque-nine'],
        reason: 'Current set',
        unresolved: null,
      },
    },
    inventoryAudits: [
      {
        excerptRef: 'E2',
        inventoryRef: 'U1',
        members: {
          'opaque-nine': { state: 'included' },
          'opaque-two': {
            state: 'excluded',
            contextRef: 'E2',
            candidateEvidenceRefs: ['K2.1'],
            reason: 'Different period',
          },
        },
      },
    ],
    exclusions: [],
  };
}

export function frozenSelection() {
  return {
    decisions: {
      ...response().decisions,
      E2: {
        status: 'assigned' as const,
        candidateRefs: ['area', 'opaque-nine'],
        reason: 'Collective and area description',
        unresolved: {
          candidateRefs: ['opaque-nine', 'opaque-two'],
          reason: 'Independent relationship subject alternatives',
        },
      },
    },
  };
}

export function independentMember(
  attachment: 'included' | 'excluded' | 'unresolved',
  relationshipSubject: 'alternative' | 'not_alternative',
  evidence: string,
) {
  return {
    attachment,
    relationshipSubject,
    contextRef: 'E2',
    candidateEvidenceRefs: [evidence],
    reason: 'Original source-based independent judgment',
  };
}
