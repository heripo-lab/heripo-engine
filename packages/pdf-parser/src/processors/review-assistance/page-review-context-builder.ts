import type {
  DoclingBBox,
  DoclingDocument,
  DoclingPictureItem,
  DoclingProv,
  DoclingReference,
  DoclingTableCell,
  DoclingTableItem,
  DoclingTextItem,
} from '@heripo/model';

import { isAbsolute, join } from 'node:path';

import { matchTextToReferenceWithUnused } from '../../utils/text-reference-matcher';

export interface PageReviewTextBlock {
  ref: string;
  label: string;
  text: string;
  bbox?: DoclingBBox;
  textLayerReference?: string;
  previousRef?: string;
  nextRef?: string;
  repeatedAcrossPages?: boolean;
  suspectReasons: string[];
}

export interface PageReviewTable {
  ref: string;
  caption?: string;
  bbox?: DoclingBBox;
  gridPreview: string[][];
  emptyCellRatio: number;
  previousPageTableRefs?: string[];
  previousPageTableSummary?: string;
  nextPageTableRefs?: string[];
  nextPageTableSummary?: string;
  suspectReasons: string[];
}

export interface PageReviewPicture {
  ref: string;
  caption?: string;
  imageUri?: string;
  bbox?: DoclingBBox;
  suspectReasons: string[];
}

export interface PageReviewOrphanCaption {
  ref: string;
  text: string;
  bbox?: DoclingBBox;
  currentLabel: string;
  captionLikeBodyText: boolean;
  nearestMediaRefs: Array<{
    ref: string;
    kind: 'picture' | 'table';
    distance: number;
  }>;
}

export interface PageReviewMissingTextCandidate {
  text: string;
  source: 'text_layer';
  reason: 'unmatched_text_layer_block';
}

export interface PageReviewContext {
  pageNo: number;
  pageSize: { width: number; height: number } | null;
  pageImagePath: string;
  textBlocks: PageReviewTextBlock[];
  missingTextCandidates: PageReviewMissingTextCandidate[];
  tables: PageReviewTable[];
  pictures: PageReviewPicture[];
  orphanCaptions: PageReviewOrphanCaption[];
  footnotes: Array<{
    ref: string;
    text: string;
    marker?: string;
    bbox?: DoclingBBox;
  }>;
  layout: {
    readingOrderRefs: string[];
    visualOrderRefs: string[];
    bboxWarnings: Array<{ targetRef: string; reason: string }>;
  };
  domainPatterns: Array<{
    targetRef: string;
    pattern:
      | 'roman_numeral'
      | 'layer_code'
      | 'unit'
      | 'feature_number'
      | 'hanja_term'
      | 'institution_name';
    value: string;
  }>;
}

export interface PageReviewContextBuilderOptions {
  pageTexts?: Map<number, string>;
}

interface RefGeometry {
  ref: string;
  kind: 'text' | 'table' | 'picture';
  bbox?: DoclingBBox;
  pageNo: number;
}

interface DocumentFacts {
  readingOrderRefs: string[];
  repeatedTextRefs: Set<string>;
  linkedCaptionRefs: Set<string>;
  textByRef: Map<string, string>;
  tableRefsByPage: Map<number, string[]>;
  tableSummariesByPage: Map<number, string[]>;
}

const HEADING_MAX_LENGTH = 80;
const EMPTY_CELL_RATIO_THRESHOLD = 0.5;
const MAX_GRID_PREVIEW_ROWS = 8;
const MAX_GRID_PREVIEW_COLS = 8;

export class PageReviewContextBuilder {
  build(
    doc: DoclingDocument,
    outputDir: string,
    options: PageReviewContextBuilderOptions = {},
  ): PageReviewContext[] {
    const facts = this.buildDocumentFacts(doc);
    return this.getPageNumbers(doc).map((pageNo) =>
      this.buildPageContext(doc, outputDir, pageNo, facts, options),
    );
  }

  private buildPageContext(
    doc: DoclingDocument,
    outputDir: string,
    pageNo: number,
    facts: DocumentFacts,
    options: PageReviewContextBuilderOptions,
  ): PageReviewContext {
    const pageSize = this.getPageSize(doc, pageNo);
    const readingOrderRefs = facts.readingOrderRefs.filter((ref) =>
      this.refBelongsToPage(doc, ref, pageNo),
    );
    const pageTextEntries = this.getPageTextEntries(doc, pageNo);
    const textLayerMatches = this.buildTextLayerMatches(
      pageTextEntries,
      pageNo,
      options.pageTexts,
    );

    const pageTableEntries = this.getPageTableEntries(doc, pageNo);
    const textBlocks = pageTextEntries.map((entry, promptIndex) =>
      this.buildTextBlock(
        entry.index,
        entry.item,
        pageNo,
        readingOrderRefs,
        textLayerMatches?.references,
        promptIndex,
        facts,
      ),
    );
    const tables = pageTableEntries.map((entry) =>
      this.buildTable(entry.index, entry.item, pageNo, facts),
    );
    const pictures = this.getPagePictureEntries(doc, pageNo).map((entry) =>
      this.buildPicture(entry.index, entry.item, pageNo, facts),
    );
    const geometries = this.buildPageGeometries(doc, pageNo);
    const visualOrderRefs = this.buildVisualOrder(geometries, pageSize);
    const bboxWarnings = geometries.flatMap((entry) => {
      const reason = this.getBboxWarningReason(entry.bbox, pageSize);
      return reason ? [{ targetRef: entry.ref, reason }] : [];
    });

    return {
      pageNo,
      pageSize,
      pageImagePath: this.getPageImagePath(doc, outputDir, pageNo),
      textBlocks,
      missingTextCandidates: this.buildMissingTextCandidates(
        textLayerMatches?.unusedBlocks,
        pageTableEntries,
      ),
      tables,
      pictures,
      orphanCaptions: this.buildOrphanCaptions(
        textBlocks,
        tables,
        pictures,
        facts,
        pageSize,
      ),
      footnotes: textBlocks
        .filter(
          (block) =>
            block.label === 'footnote' ||
            block.suspectReasons.includes('footnote_like_body_text'),
        )
        .map((block) => ({
          ref: block.ref,
          text: block.text,
          marker: this.extractFootnoteMarker(block.text),
          bbox: block.bbox,
        })),
      layout: {
        readingOrderRefs,
        visualOrderRefs,
        bboxWarnings,
      },
      domainPatterns: textBlocks.flatMap((block) =>
        this.detectDomainPatterns(block.ref, block.text),
      ),
    };
  }

  private buildDocumentFacts(doc: DoclingDocument): DocumentFacts {
    const readingOrderRefs = this.buildReadingOrderRefs(doc);
    const linkedCaptionRefs = new Set<string>();
    for (const picture of doc.pictures) {
      picture.captions.forEach((caption) =>
        linkedCaptionRefs.add(caption.$ref),
      );
    }
    for (const table of doc.tables) {
      table.captions.forEach((caption) => linkedCaptionRefs.add(caption.$ref));
    }

    return {
      readingOrderRefs,
      repeatedTextRefs: this.detectRepeatedTextRefs(doc),
      linkedCaptionRefs,
      textByRef: new Map(doc.texts.map((text) => [text.self_ref, text.text])),
      tableRefsByPage: this.buildTableRefsByPage(doc),
      tableSummariesByPage: this.buildTableSummariesByPage(doc),
    };
  }

  private buildReadingOrderRefs(doc: DoclingDocument): string[] {
    const order: string[] = [];
    const visited = new Set<string>();
    const groups = new Map(doc.groups.map((group) => [group.self_ref, group]));

    const visit = (ref: DoclingReference): void => {
      if (visited.has(ref.$ref)) return;
      visited.add(ref.$ref);

      const group = groups.get(ref.$ref);
      if (group) {
        group.children.forEach(visit);
        return;
      }
      order.push(ref.$ref);
    };

    doc.body.children.forEach(visit);
    doc.furniture.children.forEach(visit);

    for (const item of [...doc.texts, ...doc.tables, ...doc.pictures]) {
      if (!visited.has(item.self_ref)) {
        order.push(item.self_ref);
      }
    }

    return order;
  }

  private detectRepeatedTextRefs(doc: DoclingDocument): Set<string> {
    const byText = new Map<string, Array<{ ref: string; pageNo: number }>>();
    for (const item of doc.texts) {
      const normalized = this.normalizeText(item.text);
      if (normalized.length < 2) continue;
      for (const pageNo of this.getProvPageNumbers(item.prov)) {
        const entries = byText.get(normalized) ?? [];
        entries.push({ ref: item.self_ref, pageNo });
        byText.set(normalized, entries);
      }
    }

    const repeated = new Set<string>();
    for (const entries of byText.values()) {
      const pageCount = new Set(entries.map((entry) => entry.pageNo)).size;
      if (pageCount < 2) continue;
      entries.forEach((entry) => repeated.add(entry.ref));
    }
    return repeated;
  }

  private buildTableRefsByPage(doc: DoclingDocument): Map<number, string[]> {
    const byPage = new Map<number, string[]>();
    doc.tables.forEach((table, index) => {
      const ref = `#/tables/${index}`;
      for (const pageNo of this.getProvPageNumbers(table.prov)) {
        const entries = byPage.get(pageNo) ?? [];
        entries.push(ref);
        byPage.set(pageNo, entries);
      }
    });
    return byPage;
  }

  private buildTableSummariesByPage(
    doc: DoclingDocument,
  ): Map<number, string[]> {
    const byPage = new Map<number, string[]>();
    doc.tables.forEach((table, index) => {
      const ref = `#/tables/${index}`;
      const summary = this.summarizeTable(ref, table);
      for (const pageNo of this.getProvPageNumbers(table.prov)) {
        const entries = byPage.get(pageNo) ?? [];
        entries.push(summary);
        byPage.set(pageNo, entries);
      }
    });
    return byPage;
  }

  private getPageNumbers(doc: DoclingDocument): number[] {
    return Object.values(doc.pages)
      .map((page) => page.page_no)
      .sort((a, b) => a - b);
  }

  private getPageSize(
    doc: DoclingDocument,
    pageNo: number,
  ): { width: number; height: number } | null {
    const page = Object.values(doc.pages).find((p) => p.page_no === pageNo);
    return page?.size ?? null;
  }

  private getPageImagePath(
    doc: DoclingDocument,
    outputDir: string,
    pageNo: number,
  ): string {
    const page = Object.values(doc.pages).find((p) => p.page_no === pageNo);
    const uri = page?.image?.uri || `pages/page_${pageNo - 1}.png`;
    return isAbsolute(uri) ? uri : join(outputDir, uri);
  }

  private getPageTextEntries(
    doc: DoclingDocument,
    pageNo: number,
  ): Array<{ index: number; item: DoclingTextItem }> {
    return doc.texts
      .map((item, index) => ({ index, item }))
      .filter(({ item }) => item.prov.some((prov) => prov.page_no === pageNo));
  }

  private getPageTableEntries(
    doc: DoclingDocument,
    pageNo: number,
  ): Array<{ index: number; item: DoclingTableItem }> {
    return doc.tables
      .map((item, index) => ({ index, item }))
      .filter(({ item }) => item.prov.some((prov) => prov.page_no === pageNo));
  }

  private getPagePictureEntries(
    doc: DoclingDocument,
    pageNo: number,
  ): Array<{ index: number; item: DoclingPictureItem }> {
    return doc.pictures
      .map((item, index) => ({ index, item }))
      .filter(({ item }) => item.prov.some((prov) => prov.page_no === pageNo));
  }

  private buildTextLayerMatches(
    pageTextEntries: Array<{ index: number; item: DoclingTextItem }>,
    pageNo: number,
    pageTexts?: Map<number, string>,
  ): { references: Map<number, string>; unusedBlocks: string[] } | undefined {
    const pageText = pageTexts?.get(pageNo);
    if (!pageText) return undefined;
    return matchTextToReferenceWithUnused(pageTextEntries, pageText);
  }

  private buildMissingTextCandidates(
    unusedBlocks: string[] | undefined,
    pageTableEntries: Array<{ index: number; item: DoclingTableItem }>,
  ): PageReviewMissingTextCandidate[] {
    const tableText = this.normalizeText(
      pageTableEntries
        .flatMap((entry) => entry.item.data.grid)
        .flatMap((row) => row.map((cell) => cell.text ?? ''))
        .join(' '),
    );
    return (unusedBlocks ?? [])
      .map((text) => text.trim())
      .filter(Boolean)
      .filter((text) => {
        const normalized = this.normalizeText(text);
        return !tableText.includes(normalized);
      })
      .map((text) => ({
        text,
        source: 'text_layer' as const,
        reason: 'unmatched_text_layer_block' as const,
      }));
  }

  private buildTextBlock(
    index: number,
    item: DoclingTextItem,
    pageNo: number,
    readingOrderRefs: string[],
    references: Map<number, string> | undefined,
    promptIndex: number,
    facts: DocumentFacts,
  ): PageReviewTextBlock {
    const ref = `#/texts/${index}`;
    const orderIndex = readingOrderRefs.indexOf(ref);
    const suspectReasons = this.detectTextSuspectReasons(item, facts, ref);

    return {
      ref,
      label: item.label,
      text: item.text,
      bbox: this.getProvForPage(item.prov, pageNo)?.bbox,
      textLayerReference: references?.get(promptIndex),
      previousRef:
        orderIndex > 0 ? readingOrderRefs[orderIndex - 1] : undefined,
      nextRef:
        orderIndex >= 0 && orderIndex < readingOrderRefs.length - 1
          ? readingOrderRefs[orderIndex + 1]
          : undefined,
      repeatedAcrossPages: facts.repeatedTextRefs.has(ref),
      suspectReasons,
    };
  }

  private detectTextSuspectReasons(
    item: DoclingTextItem,
    facts: DocumentFacts,
    ref: string,
  ): string[] {
    const reasons: string[] = [];
    const trimmed = item.text.trim();
    if (trimmed.length <= 1 && item.label === 'text') {
      reasons.push('empty_text');
    }
    if (this.looksLikeOcrNoise(item.text)) {
      reasons.push('ocr_noise');
    }
    if (this.looksLikeHanjaOcrCandidate(trimmed)) {
      reasons.push('hanja_ocr_candidate');
    }
    if (
      item.label === 'section_header' &&
      trimmed.length > HEADING_MAX_LENGTH
    ) {
      reasons.push('heading_too_long');
    }
    if (facts.repeatedTextRefs.has(ref)) {
      reasons.push('repeated_across_pages');
    }
    if (item.label === 'text' && this.looksLikeCaption(trimmed)) {
      reasons.push('caption_like_body_text');
    }
    if (item.label !== 'footnote' && this.looksLikeFootnote(trimmed)) {
      reasons.push('footnote_like_body_text');
    }
    if (item.label === 'caption' && !facts.linkedCaptionRefs.has(ref)) {
      reasons.push('orphan_caption');
    }
    return reasons;
  }

  private buildTable(
    index: number,
    item: DoclingTableItem,
    pageNo: number,
    facts: DocumentFacts,
  ): PageReviewTable {
    const ref = `#/tables/${index}`;
    const gridPreview = this.buildGridPreview(item.data.grid);
    const emptyCellRatio = this.getEmptyCellRatio(item.data.grid);
    const suspectReasons: string[] = [];

    if (!this.getCaptionText(item.captions, facts)) {
      suspectReasons.push('table_missing_caption');
    }
    if (emptyCellRatio >= EMPTY_CELL_RATIO_THRESHOLD) {
      suspectReasons.push('table_many_empty_cells');
    }
    if (this.hasAdjacentCompatibleTable(item, pageNo, facts)) {
      suspectReasons.push('multi_page_table_candidate');
    }

    return {
      ref,
      caption: this.getCaptionText(item.captions, facts),
      bbox: this.getProvForPage(item.prov, pageNo)?.bbox,
      gridPreview,
      emptyCellRatio,
      previousPageTableRefs: facts.tableRefsByPage.get(pageNo - 1),
      previousPageTableSummary: facts.tableSummariesByPage
        .get(pageNo - 1)
        ?.join('\n'),
      nextPageTableRefs: facts.tableRefsByPage.get(pageNo + 1),
      nextPageTableSummary: facts.tableSummariesByPage
        .get(pageNo + 1)
        ?.join('\n'),
      suspectReasons,
    };
  }

  private buildPicture(
    index: number,
    item: DoclingPictureItem,
    pageNo: number,
    facts: DocumentFacts,
  ): PageReviewPicture {
    const caption = this.resolveCaptionRefs(item.captions, facts);
    const image = (item as unknown as { image?: { uri?: string } }).image;
    const suspectReasons = caption ? [] : ['image_missing_caption'];
    const bbox = this.getProvForPage(item.prov, pageNo)?.bbox;
    if (bbox && this.isLargePictureBbox(bbox)) {
      suspectReasons.push('large_picture_split_candidate');
    }
    return {
      ref: `#/pictures/${index}`,
      caption,
      imageUri: image?.uri,
      bbox,
      suspectReasons,
    };
  }

  private buildPageGeometries(
    doc: DoclingDocument,
    pageNo: number,
  ): RefGeometry[] {
    return [
      ...this.getPageTextEntries(doc, pageNo).map(({ index, item }) => ({
        ref: `#/texts/${index}`,
        kind: 'text' as const,
        bbox: this.getProvForPage(item.prov, pageNo)?.bbox,
        pageNo,
      })),
      ...this.getPageTableEntries(doc, pageNo).map(({ index, item }) => ({
        ref: `#/tables/${index}`,
        kind: 'table' as const,
        bbox: this.getProvForPage(item.prov, pageNo)?.bbox,
        pageNo,
      })),
      ...this.getPagePictureEntries(doc, pageNo).map(({ index, item }) => ({
        ref: `#/pictures/${index}`,
        kind: 'picture' as const,
        bbox: this.getProvForPage(item.prov, pageNo)?.bbox,
        pageNo,
      })),
    ];
  }

  private buildVisualOrder(
    geometries: RefGeometry[],
    pageSize: { width: number; height: number } | null,
  ): string[] {
    return geometries
      .filter((entry) => entry.bbox)
      .sort((a, b) => {
        const boxA = this.toTopLeftRect(a.bbox!, pageSize);
        const boxB = this.toTopLeftRect(b.bbox!, pageSize);
        return boxA.top - boxB.top || boxA.left - boxB.left;
      })
      .map((entry) => entry.ref);
  }

  private buildOrphanCaptions(
    textBlocks: PageReviewTextBlock[],
    tables: PageReviewTable[],
    pictures: PageReviewPicture[],
    facts: DocumentFacts,
    pageSize: { width: number; height: number } | null,
  ): PageReviewOrphanCaption[] {
    const media = [
      ...pictures.map((picture) => ({
        ref: picture.ref,
        kind: 'picture' as const,
        bbox: picture.bbox,
      })),
      ...tables.map((table) => ({
        ref: table.ref,
        kind: 'table' as const,
        bbox: table.bbox,
      })),
    ];

    return textBlocks
      .filter((block) => {
        const isOrphanCaption =
          block.label === 'caption' && !facts.linkedCaptionRefs.has(block.ref);
        return (
          isOrphanCaption ||
          block.suspectReasons.includes('caption_like_body_text')
        );
      })
      .map((block) => ({
        ref: block.ref,
        text: block.text,
        bbox: block.bbox,
        currentLabel: block.label,
        captionLikeBodyText: block.suspectReasons.includes(
          'caption_like_body_text',
        ),
        nearestMediaRefs: media
          .map((entry) => ({
            ref: entry.ref,
            kind: entry.kind,
            distance: this.bboxDistance(block.bbox, entry.bbox, pageSize),
          }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 3),
      }));
  }

  private detectDomainPatterns(
    targetRef: string,
    text: string,
  ): PageReviewContext['domainPatterns'] {
    const patterns: PageReviewContext['domainPatterns'] = [];
    this.pushPattern(
      patterns,
      targetRef,
      'roman_numeral',
      text,
      /[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/gu,
    );
    this.pushPattern(
      patterns,
      targetRef,
      'layer_code',
      text,
      /(?:layer|stratum|strat(?:igraphic)?\s?unit|SU|locus|context|deposit|층위|토층|[A-Z]-?\d{1,3})/giu,
    );
    this.pushPattern(
      patterns,
      targetRef,
      'unit',
      text,
      /\d+(?:\.\d+)?\s?(?:cm|m|㎝|㎡|m²)/giu,
    );
    this.pushPattern(
      patterns,
      targetRef,
      'feature_number',
      text,
      /(?:feature|pit|ditch|burial|tomb|grave|wall|kiln|hearth|house|structure|trench|locus|context|unit|遺構|住居|墓|窯|溝|土坑|竪穴|주거지|수혈|토광묘|유구|구상유구)\s?(?:no\.?|#)?\s?\d*/giu,
    );
    this.pushPattern(patterns, targetRef, 'hanja_term', text, /[一-龯]+/gu);
    this.pushPattern(
      patterns,
      targetRef,
      'institution_name',
      text,
      /(?:institute|university|museum|foundation|archaeolog(?:y|ical)|heritage|research|center|centre|文化財|硏究院|博物館|研究所|財團|財|株|社|문화재연구원|박물관|연구소)/giu,
    );
    return patterns;
  }

  private pushPattern(
    patterns: PageReviewContext['domainPatterns'],
    targetRef: string,
    pattern: PageReviewContext['domainPatterns'][number]['pattern'],
    text: string,
    regex: RegExp,
  ): void {
    const matches = text.match(regex) ?? [];
    for (const value of matches.slice(0, 5)) {
      patterns.push({ targetRef, pattern, value });
    }
  }

  private getCaptionText(
    refs: DoclingReference[],
    facts: DocumentFacts,
  ): string | undefined {
    return this.resolveCaptionRefs(refs, facts);
  }

  private resolveCaptionRefs(
    refs: DoclingReference[],
    facts: DocumentFacts,
  ): string | undefined {
    const captions = refs
      .map((ref) => facts.textByRef.get(ref.$ref))
      .filter((text): text is string => Boolean(text?.trim()));
    return captions.length > 0 ? captions.join('\n') : undefined;
  }

  private buildGridPreview(grid: DoclingTableCell[][]): string[][] {
    return grid
      .slice(0, MAX_GRID_PREVIEW_ROWS)
      .map((row) =>
        row
          .slice(0, MAX_GRID_PREVIEW_COLS)
          .map((cell) => cell.text?.trim() ?? ''),
      );
  }

  private getEmptyCellRatio(grid: DoclingTableCell[][]): number {
    let total = 0;
    let empty = 0;
    for (const row of grid) {
      for (const cell of row) {
        total += 1;
        if (!cell.text?.trim()) {
          empty += 1;
        }
      }
    }
    return total === 0 ? 0 : empty / total;
  }

  private hasAdjacentCompatibleTable(
    table: DoclingTableItem,
    pageNo: number,
    facts: DocumentFacts,
  ): boolean {
    if (table.data.num_cols <= 0) return false;
    return (
      (facts.tableSummariesByPage.get(pageNo - 1)?.length ?? 0) > 0 ||
      (facts.tableSummariesByPage.get(pageNo + 1)?.length ?? 0) > 0
    );
  }

  private summarizeTable(ref: string, table: DoclingTableItem): string {
    const firstRow = table.data.grid[0]
      ?.map((cell) => cell.text?.trim() ?? '')
      .filter(Boolean)
      .join(' | ');
    return `${ref} rows=${table.data.num_rows} cols=${table.data.num_cols}${firstRow ? ` firstRow=${firstRow}` : ''}`;
  }

  private refBelongsToPage(
    doc: DoclingDocument,
    ref: string,
    pageNo: number,
  ): boolean {
    const item = this.resolveRef(doc, ref);
    return item?.prov.some((prov) => prov.page_no === pageNo) ?? false;
  }

  private resolveRef(
    doc: DoclingDocument,
    ref: string,
  ):
    | { prov: DoclingProv[]; text?: string; label?: string }
    | DoclingTableItem
    | DoclingPictureItem
    | undefined {
    const [collection, rawIndex] = ref.replace('#/', '').split('/');
    const index = Number(rawIndex);
    if (!Number.isInteger(index)) return undefined;
    if (collection === 'texts') return doc.texts[index];
    if (collection === 'tables') return doc.tables[index];
    if (collection === 'pictures') return doc.pictures[index];
    return undefined;
  }

  private getProvForPage(
    prov: DoclingProv[],
    pageNo: number,
  ): DoclingProv | undefined {
    return prov.find((entry) => entry.page_no === pageNo);
  }

  private getProvPageNumbers(prov: DoclingProv[]): number[] {
    return [...new Set(prov.map((entry) => entry.page_no))];
  }

  private normalizeText(text: string): string {
    return text.replace(/\s+/g, '').toLowerCase();
  }

  private looksLikeOcrNoise(text: string): boolean {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 4) return false;
    const shortTokens = tokens.filter((token) => token.length <= 1).length;
    return shortTokens / tokens.length >= 0.7;
  }

  private looksLikeCaption(text: string): boolean {
    return /^(?:도면|도판|사진|삽도|그림|표|Fig\.?|Figure|Plate|Photo|Table)\s*[\dⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ-]/iu.test(
      text,
    );
  }

  private looksLikeHanjaOcrCandidate(text: string): boolean {
    if (!text) return false;
    if (/[一-龯]/u.test(text)) return false;
    if (/[（(][A-Za-z0-9Il|!*_+\-=\\/?:;,.]{2,}[）)]/u.test(text)) {
      return true;
    }
    if (/[A-Za-z0-9Il|!*_+\-=\\/?:;,.]{3,}[）)]/u.test(text)) {
      return true;
    }
    return /[（(](?:주|재|사)[）)]/u.test(text);
  }

  private looksLikeFootnote(text: string): boolean {
    return /^(?:\d+[\).]|[*†‡])\s*\S+/.test(text);
  }

  private extractFootnoteMarker(text: string): string | undefined {
    return /^(?<marker>\d+[\).]|[*†‡])/.exec(text.trim())?.groups?.marker;
  }

  private isLargePictureBbox(bbox: DoclingBBox): boolean {
    return Math.abs(bbox.r - bbox.l) * Math.abs(bbox.t - bbox.b) > 100_000;
  }

  private getBboxWarningReason(
    bbox: DoclingBBox | undefined,
    pageSize: { width: number; height: number } | null,
  ): string | null {
    if (!bbox) return null;
    const rect = this.toTopLeftRect(bbox, pageSize);
    if (rect.right <= rect.left || rect.bottom <= rect.top) {
      return 'invalid_bbox_order';
    }
    if (!pageSize) return null;
    if (
      rect.left < 0 ||
      rect.top < 0 ||
      rect.right > pageSize.width ||
      rect.bottom > pageSize.height
    ) {
      return 'bbox_outside_page';
    }
    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    if (width < pageSize.width * 0.005 || height < pageSize.height * 0.005) {
      return 'bbox_too_small';
    }
    return null;
  }

  private bboxDistance(
    a: DoclingBBox | undefined,
    b: DoclingBBox | undefined,
    pageSize: { width: number; height: number } | null,
  ): number {
    if (!a || !b) return Number.POSITIVE_INFINITY;
    const rectA = this.toTopLeftRect(a, pageSize);
    const rectB = this.toTopLeftRect(b, pageSize);
    const centerA = {
      x: (rectA.left + rectA.right) / 2,
      y: (rectA.top + rectA.bottom) / 2,
    };
    const centerB = {
      x: (rectB.left + rectB.right) / 2,
      y: (rectB.top + rectB.bottom) / 2,
    };
    return Math.hypot(centerA.x - centerB.x, centerA.y - centerB.y);
  }

  private toTopLeftRect(
    bbox: DoclingBBox,
    pageSize: { width: number; height: number } | null,
  ): { left: number; top: number; right: number; bottom: number } {
    if (bbox.coord_origin === 'BOTTOMLEFT' && pageSize) {
      return {
        left: Math.min(bbox.l, bbox.r),
        top: pageSize.height - Math.max(bbox.t, bbox.b),
        right: Math.max(bbox.l, bbox.r),
        bottom: pageSize.height - Math.min(bbox.t, bbox.b),
      };
    }
    return {
      left: Math.min(bbox.l, bbox.r),
      top: Math.min(bbox.t, bbox.b),
      right: Math.max(bbox.l, bbox.r),
      bottom: Math.max(bbox.t, bbox.b),
    };
  }
}
