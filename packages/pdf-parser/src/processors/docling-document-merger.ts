import type { DoclingDocument, DoclingPictureItem } from '@heripo/model';

/** Offsets for remapping $ref paths across chunks */
interface RefOffsets {
  texts: number;
  pictures: number;
  tables: number;
  groups: number;
}

/** Regex matching $ref paths that need offset remapping */
const REF_PATTERN = /^#\/(texts|pictures|tables|groups)\/(\d+)$/;

/** Regex matching image URIs like "images/pic_N.png" */
const IMAGE_URI_PATTERN = /^images\/pic_(\d+)\.png$/;

/**
 * Merges multiple DoclingDocuments into a single document.
 *
 * Handles $ref remapping, image path remapping, and pages merging
 * so that the merged result is indistinguishable from a single-pass conversion.
 */
export class DoclingDocumentMerger {
  /**
   * Merge an array of DoclingDocuments into one.
   * The first chunk's metadata (schema_name, version, name, origin) is used as the base.
   *
   * @param chunks - Array of DoclingDocument objects to merge (must have at least 1)
   * @returns Merged DoclingDocument
   */
  merge(chunks: DoclingDocument[]): DoclingDocument {
    if (chunks.length === 0) {
      throw new Error('Cannot merge zero chunks');
    }

    if (chunks.length === 1) {
      return chunks[0];
    }

    // Start with a deep clone of the first chunk as the base
    const base = structuredClone(chunks[0]);

    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i];
      const offsets: RefOffsets = {
        texts: base.texts.length,
        pictures: base.pictures.length,
        tables: base.tables.length,
        groups: base.groups.length,
      };

      // Merge texts
      for (const text of chunk.texts) {
        const remapped = structuredClone(text);
        remapped.self_ref = this.remapRef(remapped.self_ref, offsets);
        if (remapped.parent) {
          remapped.parent.$ref = this.remapRef(remapped.parent.$ref, offsets);
        }
        remapped.children = remapped.children.map((c) => ({
          $ref: this.remapRef(c.$ref, offsets),
        }));
        base.texts.push(remapped);
      }

      // Merge pictures
      for (const picture of chunk.pictures) {
        const remapped = structuredClone(picture);
        remapped.self_ref = this.remapRef(remapped.self_ref, offsets);
        if (remapped.parent) {
          remapped.parent.$ref = this.remapRef(remapped.parent.$ref, offsets);
        }
        remapped.children = remapped.children.map((c) => ({
          $ref: this.remapRef(c.$ref, offsets),
        }));
        remapped.captions = remapped.captions.map((c) => ({
          $ref: this.remapRef(c.$ref, offsets),
        }));
        // Remap image URI
        this.remapPictureImageUri(remapped, offsets);
        base.pictures.push(remapped);
      }

      // Merge tables
      for (const table of chunk.tables) {
        const remapped = structuredClone(table);
        remapped.self_ref = this.remapRef(remapped.self_ref, offsets);
        if (remapped.parent) {
          remapped.parent.$ref = this.remapRef(remapped.parent.$ref, offsets);
        }
        remapped.children = remapped.children.map((c) => ({
          $ref: this.remapRef(c.$ref, offsets),
        }));
        remapped.captions = remapped.captions.map((c) => ({
          $ref: this.remapRef(c.$ref, offsets),
        }));
        remapped.footnotes = remapped.footnotes.map((f) => ({
          $ref: this.remapRef(f.$ref, offsets),
        }));
        base.tables.push(remapped);
      }

      // Merge groups
      for (const group of chunk.groups) {
        const remapped = structuredClone(group);
        remapped.self_ref = this.remapRef(remapped.self_ref, offsets);
        if (remapped.parent) {
          remapped.parent.$ref = this.remapRef(remapped.parent.$ref, offsets);
        }
        remapped.children = remapped.children.map((c) => ({
          $ref: this.remapRef(c.$ref, offsets),
        }));
        base.groups.push(remapped);
      }

      // Merge body children
      for (const child of chunk.body.children) {
        base.body.children.push({
          $ref: this.remapRef(child.$ref, offsets),
        });
      }

      // Merge furniture children
      for (const child of chunk.furniture.children) {
        base.furniture.children.push({
          $ref: this.remapRef(child.$ref, offsets),
        });
      }

      // Merge pages (keys are global page number strings, so no collision)
      Object.assign(base.pages, chunk.pages);
    }

    return base;
  }

  /**
   * Remap a $ref string by applying offsets.
   * Only refs matching "#/{texts|pictures|tables|groups}/{N}" are remapped.
   * Refs like "#/body" or "#/furniture" pass through unchanged.
   */
  remapRef(ref: string, offsets: RefOffsets): string {
    const match = REF_PATTERN.exec(ref);
    if (!match) {
      return ref;
    }

    const kind = match[1] as keyof RefOffsets;
    const index = parseInt(match[2], 10);
    return `#/${kind}/${index + offsets[kind]}`;
  }

  /**
   * Remap image URI in a picture item by applying the pictures offset.
   * Transforms "images/pic_N.png" → "images/pic_{N+offset}.png"
   */
  private remapPictureImageUri(
    picture: DoclingPictureItem,
    offsets: RefOffsets,
  ): void {
    // DoclingPictureItem may have an `image` field at runtime from Docling output
    const rec = picture as unknown as { image?: { uri?: string } };
    const image = rec.image;
    if (!image?.uri) return;

    const match = IMAGE_URI_PATTERN.exec(image.uri);
    if (match) {
      const index = parseInt(match[1], 10);
      image.uri = `images/pic_${index + offsets.pictures}.png`;
    }
  }
}
