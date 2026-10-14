import type {
  AttachmentUnit,
  ContentAttachmentPlan,
} from './content-attachment';

/** Build a deterministic model view and a separate, lossless code-only locator map. */
export function createContentAttachmentInput(
  plan: ContentAttachmentPlan,
  unit: AttachmentUnit,
) {
  if (!plan.units.some((u) => JSON.stringify(u) === JSON.stringify(unit)))
    throw new Error('Unknown attachment unit');
  const contexts: Record<string, string[]> = {};
  const contextPaths: Record<
    string,
    AttachmentUnit['chapters'][number]['path']
  > = {};
  const contextIds = new Map<string, string>();
  const contextRef = (path: AttachmentUnit['chapters'][number]['path']) => {
    const key = JSON.stringify(path);
    let ref = contextIds.get(key);
    if (!ref) {
      ref = `C${contextIds.size + 1}`;
      contextIds.set(key, ref);
      contexts[ref] = path.map((c) => c.originTitle);
      contextPaths[ref] = path;
    }
    return ref;
  };
  const candidateRows: Array<{
    ref: string;
    groupId: string;
    candidateId: string;
    evidence: ContentAttachmentPlan['registry'][number]['mentions'][number]['evidence'];
  }> = [];
  const candidateRefs = new Map<string, string>();
  const candidates = plan.registry.flatMap((g) =>
    g.mentions.map((m) => {
      candidateRefs.set(m.candidateId, g.ref);
      candidateRows.push({
        ref: g.ref,
        groupId: g.groupId,
        candidateId: m.candidateId,
        evidence: m.evidence,
      });
      return [
        g.ref,
        g.recordKind,
        contextRef(m.chapterPath),
        m.sourceName,
        m.sourceIdentifier,
        m.evidence.map((e) => e.quote),
      ] as const;
    }),
  );
  const sourceMap = unit.sources.map((source, i) => ({
    ref: `S${i + 1}`,
    source,
  }));
  const tableMap = unit.tables.map((table, i) => ({ ref: `T${i + 1}`, table }));
  const chapterContexts = new Map(
    unit.chapters.map((c) => [c.chapterId, contextRef(c.path)]),
  );
  const sources = sourceMap.map(
    ({ ref, source: { resource: r } }) =>
      [
        ref,
        r.kind,
        r.chapterIds.map((id) => chapterContexts.get(id)!),
        r.kind === 'tableCell'
          ? [
              tableMap.find((t) => t.table.data.id === r.tableId)!.ref,
              r.rowIndex,
              r.columnIndex,
            ]
          : null,
        r.data.text,
      ] as const,
  );
  const tables = tableMap.map(({ ref, table }) => ({
    ref,
    caption: table.data.caption?.fullText ?? null,
    grid: table.data.grid.map((row, r) =>
      row.map((cell, c) => {
        const source = sourceMap.find(
          (s) =>
            s.source.resource.kind === 'tableCell' &&
            s.source.resource.tableId === table.data.id &&
            s.source.resource.rowIndex === r &&
            s.source.resource.columnIndex === c,
        );
        return [
          source?.ref ?? null,
          source ? null : cell.text,
          cell.rowSpan,
          cell.colSpan,
          cell.isHeader,
        ] as const;
      }),
    ),
  }));
  const payload = {
    columns: ['ref', 'kind', 'context', 'name', 'number', 'quotes'],
    contexts,
    candidates,
    uncertainties: plan.registryUncertainties.map((m) => ({
      refs: [
        candidateRefs.get(m.leftCandidateId)!,
        candidateRefs.get(m.rightCandidateId)!,
      ],
      reason: m.reason,
    })),
    current: {
      contexts: [...chapterContexts.values()],
      sourceColumns: ['ref', 'kind', 'contexts', 'tableCell', 'text'],
      sources,
      tableCellColumns: [
        'sourceRef',
        'contextText',
        'rowSpan',
        'colSpan',
        'isHeader',
      ],
      tables,
      readOnlyContext: unit.readOnlyContext.map((c) => c.text),
    },
  };
  const codeMap = {
    inputSha256: plan.inputSha256,
    candidateSnapshotId: plan.candidateSnapshotId,
    registrySha256: plan.registrySha256,
    unitId: unit.unitId,
    contextPaths,
    candidateRows,
    sources: sourceMap,
    tables: tableMap,
  };
  return { payload, codeMap };
}
