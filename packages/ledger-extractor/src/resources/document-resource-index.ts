import type {
  Chapter,
  PageRange,
  ProcessedDocument,
  ProcessedFootnote,
  ProcessedImage,
  ProcessedTable,
  ProcessedTableCell,
  TextBlock,
} from '@heripo/model';

interface ResourceLocation {
  /** JSON pointer into this exact processed-document snapshot; not a ledger ID. */
  key: string;
  resourceId: string | null;
  sourceRefs: string[];
  /** Direct chapter assignments from the input, without inferred reassignment. */
  chapterIds: string[];
  pdfPageNo: number | null;
  logicalPageRange: PageRange | null;
}

export type DocumentResource = ResourceLocation &
  (
    | { kind: 'chapter'; data: Omit<Chapter, 'children' | 'textBlocks'> }
    | { kind: 'text'; data: TextBlock }
    | { kind: 'image'; data: ProcessedImage }
    | { kind: 'table'; data: ProcessedTable }
    | {
        kind: 'tableCell';
        tableId: string;
        /** Zero-based indexes into the actual grid, not expanded span coordinates. */
        rowIndex: number;
        columnIndex: number;
        data: ProcessedTableCell;
      }
    | { kind: 'footnote'; data: ProcessedFootnote }
  );

export interface DocumentResourceIndex {
  version: 'document-resource-index.v1';
  reportId: string;
  /** Storage traversal order, not reconstructed PDF reading order. */
  resources: DocumentResource[];
}

export interface DocumentResourceQuery {
  kind?: DocumentResource['kind'];
  chapterId?: string;
  resourceId?: string;
  sourceRef?: string;
  pdfPageNo?: number;
  logicalPageNo?: number;
  /** Literal, case-sensitive substring of ID, source references, text or caption. */
  text?: string;
}

/** Build the S0 index without LLM calls, I/O, text normalization or input mutation. */
export function buildDocumentResourceIndex(
  document: ProcessedDocument,
): DocumentResourceIndex {
  const resources: DocumentResource[] = [];
  const memberships = new Map<string, string[]>();
  const refs = (ref: string | undefined): string[] =>
    ref === undefined ? [] : [ref];
  const location = (
    key: string,
    resourceId: string | undefined,
    sourceRefs: string[],
    chapterIds: string[],
    pdfPageNo: number,
  ): ResourceLocation => ({
    key,
    resourceId: resourceId ?? null,
    sourceRefs,
    chapterIds,
    pdfPageNo,
    logicalPageRange: document.pageRangeMap[pdfPageNo] ?? null,
  });
  const visit = (chapters: Chapter[], prefix: string): void => {
    chapters.forEach((chapter, index) => {
      const key = `${prefix}/${index}`;
      const { children, textBlocks, ...data } = chapter;
      resources.push({
        key,
        kind: 'chapter',
        resourceId: chapter.id,
        sourceRefs: chapter.sourceRefs ?? [],
        chapterIds: [chapter.id],
        pdfPageNo: null,
        logicalPageRange: {
          startPageNo: chapter.pageNo,
          endPageNo: chapter.pageNo,
        },
        data,
      });
      textBlocks.forEach((block, blockIndex) => {
        resources.push({
          ...location(
            `${key}/textBlocks/${blockIndex}`,
            block.id,
            refs(block.sourceRef),
            [chapter.id],
            block.pdfPageNo,
          ),
          kind: 'text',
          data: block,
        });
      });
      for (const [kind, ids] of [
        ['image', chapter.imageIds],
        ['table', chapter.tableIds],
        ['footnote', chapter.footnoteIds],
      ] as const) {
        for (const id of ids) {
          const membershipKey = `${kind}:${id}`;
          const assigned = memberships.get(membershipKey) ?? [];
          if (!assigned.includes(chapter.id)) assigned.push(chapter.id);
          memberships.set(membershipKey, assigned);
        }
      }
      visit(children ?? [], `${key}/children`);
    });
  };
  visit(document.chapters, '/chapters');
  document.images.forEach((image, index) => {
    resources.push({
      ...location(
        `/images/${index}`,
        image.id,
        [...refs(image.sourceRef), ...(image.captionSourceRefs ?? [])],
        memberships.get(`image:${image.id}`) ?? [],
        image.pdfPageNo,
      ),
      kind: 'image',
      data: image,
    });
  });
  document.tables.forEach((table, index) => {
    const base = location(
      `/tables/${index}`,
      table.id,
      [...refs(table.sourceRef), ...(table.captionSourceRefs ?? [])],
      memberships.get(`table:${table.id}`) ?? [],
      table.pdfPageNo,
    );
    resources.push({ ...base, kind: 'table', data: table });
    table.grid.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        resources.push({
          ...base,
          key: `${base.key}/grid/${rowIndex}/${columnIndex}`,
          resourceId: null,
          sourceRefs: refs(table.sourceRef),
          kind: 'tableCell',
          tableId: table.id,
          rowIndex,
          columnIndex,
          data: cell,
        });
      });
    });
  });
  document.footnotes.forEach((footnote, index) => {
    resources.push({
      ...location(
        `/footnotes/${index}`,
        footnote.id,
        refs(footnote.sourceRef),
        memberships.get(`footnote:${footnote.id}`) ?? [],
        footnote.pdfPageNo,
      ),
      kind: 'footnote',
      data: footnote,
    });
  });
  return {
    version: 'document-resource-index.v1',
    reportId: document.reportId,
    resources,
  };
}

/** All supplied filters are combined with AND; duplicates remain distinct. */
export function queryDocumentResources(
  index: DocumentResourceIndex,
  query: DocumentResourceQuery = {},
): DocumentResource[] {
  return index.resources.filter((resource) => {
    if (query.kind !== undefined && resource.kind !== query.kind) return false;
    if (
      query.chapterId !== undefined &&
      !resource.chapterIds.includes(query.chapterId)
    )
      return false;
    if (
      query.resourceId !== undefined &&
      resource.resourceId !== query.resourceId
    )
      return false;
    if (
      query.sourceRef !== undefined &&
      !resource.sourceRefs.includes(query.sourceRef)
    )
      return false;
    if (query.pdfPageNo !== undefined && resource.pdfPageNo !== query.pdfPageNo)
      return false;
    if (query.logicalPageNo !== undefined) {
      const range = resource.logicalPageRange;
      if (
        range === null ||
        query.logicalPageNo < range.startPageNo ||
        query.logicalPageNo > range.endPageNo
      )
        return false;
    }
    if (query.text !== undefined) {
      let text: string;
      switch (resource.kind) {
        case 'chapter':
          text = `${resource.data.originTitle}\n${resource.data.title}`;
          break;
        case 'image':
        case 'table':
          text = resource.data.caption?.fullText ?? '';
          break;
        default:
          text = resource.data.text;
      }
      if (
        ![
          resource.key,
          resource.resourceId ?? '',
          ...resource.sourceRefs,
          text,
        ].some((value) => value.includes(query.text!))
      )
        return false;
    }
    return true;
  });
}
