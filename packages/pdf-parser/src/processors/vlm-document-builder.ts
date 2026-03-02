import type { LoggerMethods } from '@heripo/logger';
import type { DoclingDocument } from '@heripo/model';

import { basename } from 'node:path';

/**
 * Fills image URIs into a DoclingDocument assembled by DoclingDocumentAssembler.
 *
 * The assembler creates a structurally complete document with empty image URIs.
 * This builder maps page images and picture images to the document using
 * relative paths that match the output directory layout.
 *
 * Output directory convention:
 *   outputDir/
 *     pages/page_0.png      → pages["1"].image.uri = "pages/page_0.png"
 *     pages/page_1.png      → pages["2"].image.uri = "pages/page_1.png"
 *     images/image_0.png    → pictures[0] (by index convention)
 *     images/image_1.png    → pictures[1] (by index convention)
 */
export class VlmDocumentBuilder {
  private readonly logger: LoggerMethods;

  constructor(logger: LoggerMethods) {
    this.logger = logger;
  }

  /**
   * Fill image URIs in the DoclingDocument.
   *
   * @param doc - DoclingDocument with empty image URIs (from assembler)
   * @param pageFiles - Page image file paths (index 0 → page 1)
   * @param imageFiles - Picture image relative paths (from VlmImageExtractor)
   * @returns Updated DoclingDocument with page image URIs filled
   */
  build(
    doc: DoclingDocument,
    pageFiles: string[],
    imageFiles: string[],
  ): DoclingDocument {
    this.mapPageImages(doc, pageFiles);

    // Picture images are stored by convention: pictures[i] → imageFiles[i].
    // DoclingPictureItem has no URI field, so we log the mapping status.
    if (imageFiles.length > 0) {
      this.logger.info(
        `[VlmDocumentBuilder] Mapped ${imageFiles.length} picture images`,
      );
    }

    if (imageFiles.length !== doc.pictures.length) {
      this.logger.warn(
        `[VlmDocumentBuilder] Picture count mismatch: ${doc.pictures.length} in document, ${imageFiles.length} image files`,
      );
    }

    this.logger.info(
      `[VlmDocumentBuilder] Document built: ${Object.keys(doc.pages).length} pages, ${doc.texts.length} texts, ${doc.pictures.length} pictures, ${doc.tables.length} tables`,
    );

    return doc;
  }

  /**
   * Map page image file paths to page entries in the document.
   * Sets each page's image.uri to a relative path like "pages/page_0.png".
   */
  private mapPageImages(doc: DoclingDocument, pageFiles: string[]): void {
    let mappedCount = 0;

    for (let i = 0; i < pageFiles.length; i++) {
      const pageNo = i + 1;
      const key = String(pageNo);
      const page = doc.pages[key];

      if (page) {
        const filename = basename(pageFiles[i]);
        page.image.uri = `pages/${filename}`;
        mappedCount++;
      }
    }

    this.logger.info(`[VlmDocumentBuilder] Mapped ${mappedCount} page images`);
  }
}
