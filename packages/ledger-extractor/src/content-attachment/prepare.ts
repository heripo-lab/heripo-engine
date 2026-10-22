import type { CandidateDeduplicationResult } from '../candidates/candidate-deduplication';
import type {
  CandidateDiscoveryPlan,
  CandidateDiscoveryResult,
} from '../candidates/discovery-types';
import type {
  DocumentResource,
  DocumentResourceIndex,
} from '../resources/document-resource-index';
import type { ContentRegistrationDecision } from './decisions';
import type {
  AttachmentUnit,
  ContentAttachmentPlan,
  TextSource,
} from './types';

import { createCandidateDeduplicationRequest } from '../candidates/candidate-deduplication';
import { adjacentAttachmentBody } from './context';

async function digest(value: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
/** Prepare all pages without model calls, preserving the original index and candidate snapshot. */
export async function prepareContentAttachment(
  index: DocumentResourceIndex,
  discoveryPlan: CandidateDiscoveryPlan,
  discovery: CandidateDiscoveryResult,
  groups: CandidateDeduplicationResult,
  options: {
    inputSha256: string;
    candidateSnapshotId: string;
    pdfPageNumbers: number[];
    maxUnitChars: number;
    registrationDecisions?: ContentRegistrationDecision[];
  },
): Promise<ContentAttachmentPlan> {
  createCandidateDeduplicationRequest(discoveryPlan, discovery);
  if (
    options.inputSha256 !== discovery.inputSha256 ||
    !options.candidateSnapshotId ||
    !Number.isInteger(options.maxUnitChars) ||
    options.maxUnitChars < 1 ||
    groups.issues.length ||
    !groups.groups.length
  )
    throw new Error(
      'A matching complete candidate snapshot and positive chunk limit are required',
    );
  const byId = new Map(discovery.candidates.map((c) => [c.candidateId, c]));
  const assigned = new Set<string>();
  const registry = groups.groups.map((g, i) => {
    if (!g.memberCandidateIds.length)
      throw new Error('Invalid registry partition');
    const members = g.memberCandidateIds.map((id) => {
      const c = byId.get(id);
      if (!c || assigned.has(id)) throw new Error('Invalid registry partition');
      assigned.add(id);
      for (const e of c.evidence) {
        const r = index.resources.find((r) => r.key === e.resourceKey);
        if (
          !r ||
          !(r.kind === 'text' || r.kind === 'tableCell') ||
          r.data.text.slice(e.charStart, e.charEnd) !== e.quote
        )
          throw new Error('Candidate evidence differs from original input');
      }
      return c;
    });
    if (members.some((c) => c.recordKind !== members[0].recordKind))
      throw new Error('Invalid registry partition');
    return {
      ref: `R${i + 1}`,
      groupId: g.groupId,
      recordKind: members[0].recordKind,
      mentions: members.map((c) => ({
        candidateId: c.candidateId,
        sourceName: c.sourceName,
        sourceIdentifier: c.sourceIdentifier,
        chapterPath: discoveryPlan.units.find((u) =>
          c.unitIds.includes(u.unitId),
        )!.chapterPath,
        evidence: c.evidence,
      })),
    };
  });
  if (
    assigned.size !== byId.size ||
    new Set(registry.map((r) => r.groupId)).size !== registry.length ||
    groups.uncertainMatches.some(
      (m) =>
        !byId.has(m.leftCandidateId) ||
        !byId.has(m.rightCandidateId) ||
        registry.find((r) =>
          r.mentions.some((c) => c.candidateId === m.leftCandidateId),
        ) ===
          registry.find((r) =>
            r.mentions.some((c) => c.candidateId === m.rightCandidateId),
          ),
    )
  )
    throw new Error('Invalid registry partition');
  const sources = index.resources.filter(
    (r): r is TextSource => r.kind === 'text' || r.kind === 'tableCell',
  );
  const pageNos = [
    ...options.pdfPageNumbers,
    ...index.resources.flatMap((r) =>
      r.pdfPageNo === null ? [] : [r.pdfPageNo],
    ),
  ];
  if (
    pageNos.some((n) => !Number.isInteger(n) || n < 1) ||
    sources.some((r) => r.pdfPageNo === null)
  )
    throw new Error('Invalid physical page number');
  const pages: ContentAttachmentPlan['pages'] = [];
  const units: AttachmentUnit[] = [];
  const texts = index.resources.filter(
    (r): r is Extract<DocumentResource, { kind: 'text' }> => r.kind === 'text',
  );
  const chapters = index.resources.filter(
    (r): r is Extract<DocumentResource, { kind: 'chapter' }> =>
      r.kind === 'chapter',
  );
  for (let page = 1; page <= Math.max(0, ...pageNos); page++) {
    const onPage = sources.filter((r) => r.pdfPageNo === page);
    const atoms: TextSource[][] = [];
    for (const r of onPage) {
      const previous = atoms.at(-1)?.[0];
      if (
        r.kind === 'tableCell' &&
        previous?.kind === 'tableCell' &&
        previous.tableId === r.tableId &&
        previous.rowIndex === r.rowIndex
      )
        atoms.at(-1)!.push(r);
      else atoms.push([r]);
    }
    const batches: TextSource[][] = [];
    let batch: TextSource[] = [];
    let length = 0;
    for (const atom of atoms) {
      const size = atom.reduce((n, r) => n + r.data.text.length, 0);
      if (batch.length && length + size > options.maxUnitChars) {
        batches.push(batch);
        batch = [];
        length = 0;
      }
      batch.push(...atom);
      length += size;
    }
    if (batch.length) batches.push(batch);
    const pageUnits = batches.map((resources, i): AttachmentUnit => {
      const adjacent = adjacentAttachmentBody(
        texts,
        resources.map((resource) => ({
          sourceId: `path:${resource.key}`,
          resource,
        })),
        page,
      );
      return {
        unitId: `page-${page}:part-${i}`,
        pdfPageNo: page,
        sources: resources.map((r) => ({
          sourceId: `path:${r.key}`,
          resource: r,
        })),
        chapters: [...new Set(resources.flatMap((r) => r.chapterIds))].map(
          (chapterId) => {
            const chapter = chapters.find((c) => c.resourceId === chapterId)!;
            return {
              chapterId,
              path: chapters
                .filter(
                  (c) =>
                    chapter.key === c.key ||
                    chapter.key.startsWith(`${c.key}/children/`),
                )
                .map((c) => ({
                  id: c.resourceId!,
                  originTitle: c.data.originTitle,
                })),
            };
          },
        ),
        tables: index.resources
          .filter(
            (r): r is Extract<DocumentResource, { kind: 'table' }> =>
              r.kind === 'table' && r.pdfPageNo === page,
          )
          .map((r) => ({ key: r.key, data: r.data })),
        readOnlyContext: adjacent,
      };
    });
    units.push(...pageUnits);
    pages.push({
      pdfPageNo: page,
      unitIds: pageUnits.map((u) => u.unitId),
      status: pageUnits.length ? 'planned' : 'no_body_or_table_text',
    });
  }
  return {
    version: 'ledger-content-attachment-plan.v1',
    inputSha256: options.inputSha256,
    candidateSnapshotId: options.candidateSnapshotId,
    registrySha256: await digest(
      JSON.stringify({ registry, uncertainties: groups.uncertainMatches }),
    ),
    registry,
    registryUncertainties: groups.uncertainMatches,
    ...(options.registrationDecisions
      ? {
          registrationDecisions: structuredClone(options.registrationDecisions),
        }
      : {}),
    pages,
    units,
  };
}
