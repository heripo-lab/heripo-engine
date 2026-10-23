import type {
  DocumentResource,
  DocumentResourceIndex,
} from '../resources/document-resource-index';
import type {
  CandidateDiscoveryPlan,
  CandidateDiscoveryUnit,
} from './discovery-types';

/**
 * Code chooses scope, chunk sizes and context; the model cannot schedule more work.
 * The scope is one chapter subtree or several distinct, non-nested subtrees planned in document order.
 */
export function prepareCandidateDiscovery(
  index: DocumentResourceIndex,
  options: {
    scopeChapterId: string | string[];
    inputSha256: string;
    maxTextChars: number;
    tableRowsPerUnit: number;
  },
): CandidateDiscoveryPlan {
  if (
    !Number.isInteger(options.maxTextChars) ||
    options.maxTextChars < 1 ||
    !Number.isInteger(options.tableRowsPerUnit) ||
    options.tableRowsPerUnit < 1
  )
    throw new Error('Discovery chunk limits must be positive integers');
  const chapters = index.resources.filter(
    (r): r is Extract<DocumentResource, { kind: 'chapter' }> =>
      r.kind === 'chapter',
  );
  const ids = [options.scopeChapterId].flat();
  const roots = chapters.filter((r) => ids.includes(r.resourceId!));
  if (!ids.length || roots.length !== new Set(ids).size)
    throw new Error('Scope chapter not found');
  if (
    roots.length !== ids.length ||
    roots.some((a) => roots.some((b) => b.key.startsWith(`${a.key}/children/`)))
  )
    throw new Error('Scope chapters must be distinct and not nested');
  const subtrees = roots.map((root) =>
    chapters.filter(
      (r) => r.key === root.key || r.key.startsWith(`${root.key}/children/`),
    ),
  );
  const scoped = subtrees.flat();
  const units: CandidateDiscoveryUnit[] = [];
  const textByChapter = new Map(
    scoped.map((chapter) => [
      chapter.resourceId!,
      index.resources.filter(
        (r): r is Extract<DocumentResource, { kind: 'text' }> =>
          r.kind === 'text' && r.chapterIds.includes(chapter.resourceId!),
      ),
    ]),
  );
  // Preserve original resources while assigning leading continuation blocks to the preceding sibling
  // of the same scope subtree; separate scopes are not adjacent in the document.
  for (const pair of subtrees.flatMap((tree) =>
    tree.slice(1).map((current, i) => [tree[i], current] as const),
  )) {
    const [previous, current] = pair;
    if (
      previous.key.slice(0, previous.key.lastIndexOf('/')) !==
      current.key.slice(0, current.key.lastIndexOf('/'))
    )
      continue;
    const texts = textByChapter.get(current.resourceId!)!;
    const heading = texts.findIndex((r) =>
      r.data.text.startsWith(current.data.originTitle),
    );
    if (heading > 0 && current.data.originTitle.length > 0) {
      textByChapter.get(previous.resourceId!)!.push(...texts.slice(0, heading));
      textByChapter.set(current.resourceId!, texts.slice(heading));
    }
  }
  for (const chapter of scoped) {
    const chapterId = chapter.resourceId!;
    const chapterPath = chapters
      .filter(
        (r) =>
          r.key === chapter.key || chapter.key.startsWith(`${r.key}/children/`),
      )
      .map((r) => ({ id: r.resourceId!, originTitle: r.data.originTitle }));
    const texts = textByChapter.get(chapterId)!;
    let start = 0;
    while (start < texts.length) {
      let end = start;
      let length = 0;
      while (
        end < texts.length &&
        (end === start ||
          length + texts[end].data.text.length <= options.maxTextChars)
      ) {
        length += texts[end].data.text.length;
        end++;
      }
      const firstGlobal = index.resources.indexOf(texts[start]);
      const lastGlobal = index.resources.indexOf(texts[end - 1]);
      const adjacent = index.resources
        .slice(0, firstGlobal)
        .filter((r) => r.kind === 'text')
        .slice(-2)
        .concat(
          index.resources
            .slice(lastGlobal + 1)
            .filter((r) => r.kind === 'text')
            .slice(0, 2),
        );
      units.push({
        unitId: `${chapter.key}:text:${start}`,
        chapterId,
        chapterPath,
        table: null,
        resources: texts.slice(start, end),
        context: adjacent.map((r) => ({ key: r.key, text: r.data.text })),
      });
      start = end;
    }
    const tables = index.resources.filter(
      (r): r is Extract<DocumentResource, { kind: 'table' }> =>
        r.kind === 'table' && r.chapterIds.includes(chapterId),
    );
    for (const table of tables) {
      const cells = index.resources.filter(
        (r): r is Extract<DocumentResource, { kind: 'tableCell' }> =>
          r.kind === 'tableCell' && r.key.startsWith(`${table.key}/grid/`),
      );
      for (
        let row = 0;
        row < table.data.grid.length;
        row += options.tableRowsPerUnit
      ) {
        units.push({
          unitId: `${table.key}:rows:${row}`,
          chapterId,
          chapterPath,
          table: {
            id: table.resourceId!,
            caption: table.data.caption?.fullText ?? null,
            headerRows: table.data.grid.slice(0, 2),
          },
          resources: cells.filter(
            (c) =>
              c.rowIndex >= row && c.rowIndex < row + options.tableRowsPerUnit,
          ),
          context: texts
            .map((t) => ({ key: t.key, text: t.data.text }))
            .filter((t) => t.text.length < 200)
            .slice(0, 6),
        });
      }
    }
  }
  return {
    scopeChapterId: roots[0].resourceId!,
    ...(roots.length > 1
      ? { scopeChapterIds: roots.map((r) => r.resourceId!) }
      : {}),
    scopeTitle: roots.map((r) => r.data.originTitle).join(' · '),
    inputSha256: options.inputSha256,
    units,
  };
}

/** Whether two discovery plans or results cover the same scope chapters. */
export function isSameCandidateDiscoveryScope(
  a: Pick<CandidateDiscoveryPlan, 'scopeChapterId' | 'scopeChapterIds'>,
  b: Pick<CandidateDiscoveryPlan, 'scopeChapterId' | 'scopeChapterIds'>,
) {
  return (
    a.scopeChapterId === b.scopeChapterId &&
    JSON.stringify(a.scopeChapterIds ?? []) ===
      JSON.stringify(b.scopeChapterIds ?? [])
  );
}
