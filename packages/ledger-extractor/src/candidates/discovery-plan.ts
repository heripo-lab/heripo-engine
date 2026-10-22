import type {
  DocumentResource,
  DocumentResourceIndex,
} from '../resources/document-resource-index';
import type {
  CandidateDiscoveryPlan,
  CandidateDiscoveryUnit,
} from './discovery-types';

/** Code chooses scope, chunk sizes and context; the model cannot schedule more work. */
export function prepareCandidateDiscovery(
  index: DocumentResourceIndex,
  options: {
    scopeChapterId: string;
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
  const root = index.resources.find(
    (r) => r.kind === 'chapter' && r.resourceId === options.scopeChapterId,
  );
  if (!root || root.kind !== 'chapter')
    throw new Error('Scope chapter not found');
  const chapters = index.resources.filter(
    (r): r is Extract<DocumentResource, { kind: 'chapter' }> =>
      r.kind === 'chapter',
  );
  const scoped = chapters.filter(
    (r) => r.key === root.key || r.key.startsWith(`${root.key}/children/`),
  );
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
  // Preserve original resources while assigning leading continuation blocks to the preceding sibling.
  for (let i = 1; i < scoped.length; i++) {
    const previous = scoped[i - 1];
    const current = scoped[i];
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
    scopeChapterId: options.scopeChapterId,
    scopeTitle: root.data.originTitle,
    inputSha256: options.inputSha256,
    units,
  };
}
