import type {
  DoclingBody,
  DoclingDocument,
  DoclingPage,
  DoclingPictureItem,
  DoclingProv,
  DoclingTableData,
  DoclingTableItem,
  DoclingTextItem,
} from '@heripo/model';

import type {
  VlmBBox,
  VlmElementType,
  VlmPageElement,
  VlmPageResult,
} from '../types/vlm-page-result';

/** Metadata for document assembly */
export interface AssemblerMetadata {
  /** Document name (e.g., filename without extension) */
  name: string;
  /** Original filename */
  filename: string;
  /** Page dimensions in pixels (width x height at render DPI) */
  pageDimensions: Map<number, { width: number; height: number }>;
}

/** Tracked element metadata for caption linking */
interface TrackedElement {
  /** Page number this element belongs to */
  pageNo: number;
  /** Self reference path (e.g., '#/texts/0', '#/pictures/0') */
  selfRef: string;
  /** Element type from VLM */
  type: VlmElementType;
}

/** Element types classified as furniture (not in body) */
const FURNITURE_TYPES = new Set(['page_header', 'page_footer']);

/**
 * Converts VlmPageResult[] into a complete DoclingDocument.
 *
 * This is a pure data transformation with no I/O.
 * VLM outputs a simplified intermediate format; this assembler handles all
 * the mechanical work of building self_ref, $ref, prov, bbox coordinate
 * conversion, and furniture separation.
 */
export class DoclingDocumentAssembler {
  /**
   * Assemble a DoclingDocument from VLM page results.
   *
   * @param pageResults - VLM results for each page (1-based pageNo)
   * @param metadata - Document metadata and page dimensions
   * @returns Complete DoclingDocument (image URIs left empty for VlmDocumentBuilder)
   */
  assemble(
    pageResults: VlmPageResult[],
    metadata: AssemblerMetadata,
  ): DoclingDocument {
    const texts: DoclingTextItem[] = [];
    const pictures: DoclingPictureItem[] = [];
    const tables: DoclingTableItem[] = [];
    const bodyChildRefs: Array<{ $ref: string }> = [];
    const furnitureChildRefs: Array<{ $ref: string }> = [];
    const trackedElements: TrackedElement[] = [];

    // Sort page results by page number
    const sortedPages = [...pageResults].sort((a, b) => a.pageNo - b.pageNo);

    for (const page of sortedPages) {
      // Sort elements within each page by reading order
      const sortedElements = [...page.elements].sort(
        (a, b) => a.order - b.order,
      );

      for (const element of sortedElements) {
        const dims = metadata.pageDimensions.get(page.pageNo);
        const prov = this.buildProv(page.pageNo, element, dims);

        let selfRef: string;

        if (element.type === 'picture') {
          const idx = pictures.length;
          selfRef = `#/pictures/${idx}`;
          pictures.push(this.buildPictureItem(selfRef, prov));
        } else if (element.type === 'table') {
          const idx = tables.length;
          selfRef = `#/tables/${idx}`;
          tables.push(this.buildTableItem(selfRef, element, prov));
        } else {
          const idx = texts.length;
          selfRef = `#/texts/${idx}`;
          texts.push(this.buildTextItem(selfRef, element, prov));
        }

        trackedElements.push({
          pageNo: page.pageNo,
          selfRef,
          type: element.type,
        });

        // Only text-based types (page_header, page_footer) go to furniture
        if (FURNITURE_TYPES.has(element.type)) {
          furnitureChildRefs.push({ $ref: selfRef });
        } else {
          bodyChildRefs.push({ $ref: selfRef });
        }
      }
    }

    // Link caption text items to their nearest preceding picture or table
    this.linkCaptions(trackedElements, pictures, tables);

    const body: DoclingBody = {
      self_ref: '#/body',
      children: bodyChildRefs,
      content_layer: 'body',
      name: '_root_',
      label: 'unspecified',
    };

    const furniture: DoclingBody = {
      self_ref: '#/furniture',
      children: furnitureChildRefs,
      content_layer: 'furniture',
      name: '_root_',
      label: 'unspecified',
    };

    const pages = this.buildPages(sortedPages, metadata.pageDimensions);

    return {
      schema_name: 'DoclingDocument',
      version: '1.0.0',
      name: metadata.name,
      origin: {
        mimetype: 'application/pdf',
        binary_hash: 0,
        filename: metadata.filename,
      },
      furniture,
      body,
      groups: [],
      texts,
      pictures,
      tables,
      pages,
    };
  }

  /**
   * Build provenance info for an element.
   * Converts VLM normalized bbox (0-1, top-left) to DoclingDocument
   * absolute pixel bbox (BOTTOMLEFT origin).
   */
  private buildProv(
    pageNo: number,
    element: VlmPageElement,
    dims?: { width: number; height: number },
  ): DoclingProv[] {
    if (!element.bbox || !dims) {
      return [
        {
          page_no: pageNo,
          bbox: { l: 0, t: 0, r: 0, b: 0, coord_origin: 'BOTTOMLEFT' },
          charspan: [0, element.content.length],
        },
      ];
    }

    const bbox = this.convertBBox(element.bbox, dims.width, dims.height);

    return [
      {
        page_no: pageNo,
        bbox,
        charspan: [0, element.content.length],
      },
    ];
  }

  /**
   * Convert VLM normalized bbox (0-1, top-left origin) to
   * DoclingDocument absolute pixel bbox (BOTTOMLEFT origin).
   *
   * VLM: (0,0) = top-left,  (1,1) = bottom-right
   * Docling: (0,0) = bottom-left, (w,h) = top-right
   */
  private convertBBox(vlmBbox: VlmBBox, pageWidth: number, pageHeight: number) {
    return {
      l: vlmBbox.l * pageWidth,
      r: vlmBbox.r * pageWidth,
      t: (1 - vlmBbox.t) * pageHeight, // Y-axis flip: top in VLM = high Y in BOTTOMLEFT
      b: (1 - vlmBbox.b) * pageHeight, // Y-axis flip: bottom in VLM = low Y in BOTTOMLEFT
      coord_origin: 'BOTTOMLEFT' as const,
    };
  }

  private buildTextItem(
    selfRef: string,
    element: VlmPageElement,
    prov: DoclingProv[],
  ): DoclingTextItem {
    const item: DoclingTextItem = {
      self_ref: selfRef,
      children: [],
      content_layer: 'body',
      label: element.type,
      prov,
      orig: element.content,
      text: element.content,
    };

    if (element.type === 'section_header' && element.level !== undefined) {
      item.level = element.level;
    }

    if (element.type === 'list_item') {
      item.enumerated = element.marker
        ? /^\d+[.)]/.test(element.marker)
        : false;
      if (element.marker !== undefined) {
        item.marker = element.marker;
      }
    }

    return item;
  }

  private buildPictureItem(
    selfRef: string,
    prov: DoclingProv[],
  ): DoclingPictureItem {
    return {
      self_ref: selfRef,
      children: [],
      content_layer: 'body',
      label: 'picture',
      prov,
      captions: [],
      references: [],
      footnotes: [],
      annotations: [],
    };
  }

  private buildTableItem(
    selfRef: string,
    _element: VlmPageElement,
    prov: DoclingProv[],
  ): DoclingTableItem {
    // Tables from VLM are initially stored as text content.
    // Structured table parsing can be added in a future iteration.
    const emptyData: DoclingTableData = {
      table_cells: [],
      num_rows: 0,
      num_cols: 0,
      grid: [],
    };

    return {
      self_ref: selfRef,
      children: [],
      content_layer: 'body',
      label: 'table',
      prov,
      captions: [],
      references: [],
      footnotes: [],
      data: emptyData,
    };
  }

  /**
   * Link caption text items to their nearest preceding picture or table
   * on the same page.
   *
   * Archaeological reports follow a consistent pattern: a picture/table is
   * immediately followed by its caption in reading order. This method finds
   * the nearest preceding picture or table for each caption element and adds
   * a $ref to that item's captions array.
   */
  private linkCaptions(
    trackedElements: TrackedElement[],
    pictures: DoclingPictureItem[],
    tables: DoclingTableItem[],
  ): void {
    for (let i = 0; i < trackedElements.length; i++) {
      const element = trackedElements[i];
      if (element.type !== 'caption') continue;

      // Search backward for the nearest preceding picture or table on the same page
      for (let j = i - 1; j >= 0; j--) {
        const candidate = trackedElements[j];
        if (candidate.pageNo !== element.pageNo) break;

        if (candidate.type === 'picture') {
          const pictureIndex = this.extractIndex(candidate.selfRef);
          if (pictureIndex !== null) {
            pictures[pictureIndex].captions.push({ $ref: element.selfRef });
          }
          break;
        }

        if (candidate.type === 'table') {
          const tableIndex = this.extractIndex(candidate.selfRef);
          if (tableIndex !== null) {
            tables[tableIndex].captions.push({ $ref: element.selfRef });
          }
          break;
        }
      }
    }
  }

  /**
   * Extract the numeric index from a self_ref path.
   * e.g., '#/pictures/0' → 0, '#/tables/3' → 3
   */
  private extractIndex(selfRef: string): number | null {
    const parts = selfRef.split('/');
    const index = Number(parts[parts.length - 1]);
    return Number.isNaN(index) ? null : index;
  }

  /**
   * Build page entries. Image URIs are left empty — VlmDocumentBuilder fills them.
   */
  private buildPages(
    pageResults: VlmPageResult[],
    pageDimensions: Map<number, { width: number; height: number }>,
  ): Record<string, DoclingPage> {
    const pages: Record<string, DoclingPage> = {};

    for (const page of pageResults) {
      const dims = pageDimensions.get(page.pageNo);
      const key = String(page.pageNo);

      pages[key] = {
        page_no: page.pageNo,
        size: {
          width: dims?.width ?? 0,
          height: dims?.height ?? 0,
        },
        image: {
          mimetype: 'image/png',
          dpi: 144,
          size: {
            width: dims?.width ?? 0,
            height: dims?.height ?? 0,
          },
          uri: '', // Filled by VlmDocumentBuilder
        },
      };
    }

    return pages;
  }
}
